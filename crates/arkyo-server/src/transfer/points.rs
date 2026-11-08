//! Restore points of a project (spec 2026-11-07-sauvegardes-design §5):
//! `.arkyo` files under `<data>/backups/projects/<projectId>/`, named
//! `<AAAAMMJJ-HHMMSS>[-<n>]-<auto|manuel|avant-restauration>.arkyo` (UTC),
//! with an index `points.json` per project. The index is a cache: it is
//! reconciled with the files at each read (rebuilt when absent or damaged,
//! a removed file leaves it, an unknown one is read). The points of a
//! deleted project stay.
//!
//! A point holds the rows only (no `uploads/` entry, the manifest lists the
//! referenced paths): the files stay in `<data>/uploads`, which the server
//! never empties; a download repacks the point with the current files.
//!
//! Automatic points: every `intervalHours`, each project is exported; when
//! the digest of its own rows ([`state_digest`]) equals the one of its last
//! point, nothing is written. Retention: the `keep` latest automatic and « avant
//! restauration » points of each project (counted together); the manual
//! points are kept until deleted.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::archive::{self, Author};
use super::graph::{classification, Class};
use super::import::blocking;
use super::{collect, Bundle, RootKind, TransferError};
use crate::http::AppState;
use crate::users::User;

const INDEX: &str = "points.json";
const SETTINGS_KEY: &str = "backups.projects";
/// Delay before the first automatic pass after the start.
const FIRST_PASS: Duration = Duration::from_secs(5 * 60);
/// How often the scheduler rereads the settings.
const TICK: Duration = Duration::from_secs(60);
/// Age past which a temporary file left by a crash is removed.
const STALE_TMP: Duration = Duration::from_secs(3600);
/// Upper bound of the retention setting.
const MAX_KEEP: u32 = 1000;
/// Maximum length of a label, in characters.
pub const MAX_LABEL: usize = 200;

/// The kind of a point, the end of its file name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PointKind {
    Auto,
    Manual,
    BeforeRestore,
}

impl PointKind {
    const ALL: [PointKind; 3] = [PointKind::Auto, PointKind::Manual, PointKind::BeforeRestore];

    pub fn suffix(self) -> &'static str {
        match self {
            PointKind::Auto => "auto",
            PointKind::Manual => "manuel",
            PointKind::BeforeRestore => "avant-restauration",
        }
    }

    /// The kind of a point from its id: the suffix ends it (a same-second
    /// collision inserts `-<n>` before the suffix).
    pub fn of_id(id: &str) -> Option<PointKind> {
        Self::ALL.into_iter().find(|k| {
            id.strip_suffix(k.suffix())
                .is_some_and(|rest| rest.ends_with('-'))
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    /// The file name without its extension.
    pub id: String,
    pub project_id: String,
    /// The name of the project in the point.
    pub project_name: String,
    pub kind: PointKind,
    #[serde(default)]
    pub label: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub author: Option<Author>,
    /// [`state_digest`] of the point's rows.
    pub digest: String,
    /// Size of the file, in bytes.
    pub size: u64,
}

/// A project that has points (possibly deleted).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPoints {
    pub id: String,
    /// The project name of its last point.
    pub name: String,
    pub count: usize,
    pub last_point: Option<Point>,
}

/// AppConfig `backups.projects`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    pub enabled: bool,
    /// 1, 6 or 24.
    pub interval_hours: u32,
    /// Automatic points kept per project.
    pub keep: u32,
}

impl Default for ProjectSettings {
    fn default() -> Self {
        ProjectSettings {
            enabled: true,
            interval_hours: 1,
            keep: 48,
        }
    }
}

impl ProjectSettings {
    pub fn is_valid(&self) -> bool {
        matches!(self.interval_hours, 1 | 6 | 24) && (1..=MAX_KEEP).contains(&self.keep)
    }
}

/// The stored settings, or the defaults when absent or invalid.
pub async fn load_settings(pool: &SqlitePool) -> ProjectSettings {
    let v: Option<String> =
        sqlx::query_scalar(r#"SELECT "value" FROM "AppConfig" WHERE "key" = ?"#)
            .bind(SETTINGS_KEY)
            .fetch_optional(pool)
            .await
            .unwrap_or_default();
    v.and_then(|v| serde_json::from_str::<ProjectSettings>(&v).ok())
        .filter(ProjectSettings::is_valid)
        .unwrap_or_default()
}

pub async fn save_settings(pool: &SqlitePool, s: &ProjectSettings) -> Result<(), sqlx::Error> {
    let value = serde_json::to_string(s).unwrap_or_default();
    sqlx::query(
        r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES (?,?,?,?)
           ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt""#,
    )
    .bind(crate::ids::new_id())
    .bind(SETTINGS_KEY)
    .bind(value)
    .bind(crate::ids::now_iso())
    .execute(pool)
    .await?;
    Ok(())
}

// ── Folders and index ───────────────────────────────────────────────────────

fn plain_project_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// A point id as the routes accept it (`^[0-9A-Za-z-]+$`).
pub fn plain_point_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn root_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("backups").join("projects")
}

fn dir_in(data_dir: &Path, project_id: &str) -> Option<PathBuf> {
    plain_project_id(project_id).then(|| root_dir(data_dir).join(project_id))
}

/// The folder of the points of a project.
pub fn project_dir(st: &AppState, project_id: &str) -> Result<PathBuf, TransferError> {
    dir_in(&st.data_dir, project_id)
        .ok_or_else(|| TransferError::Invalid("Identifiant de projet invalide.".into()))
}

/// The lock of a project's folder: one writer at a time (point, deletion,
/// retention).
fn lock_of(dir: &Path) -> Arc<tokio::sync::Mutex<()>> {
    static LOCKS: OnceLock<StdMutex<HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>> =
        OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    locks.entry(dir.to_path_buf()).or_default().clone()
}

fn read_index(dir: &Path) -> Option<Vec<Point>> {
    let bytes = std::fs::read(dir.join(INDEX)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Writes the index atomically (temporary file, then rename).
fn write_index(dir: &Path, points: &[Point]) -> std::io::Result<()> {
    let tmp = dir.join(format!("{INDEX}.{}.tmp", crate::ids::new_id()));
    std::fs::write(&tmp, serde_json::to_vec_pretty(points)?)?;
    std::fs::rename(&tmp, dir.join(INDEX)).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

/// The point files of the folder: id → size.
fn point_files(dir: &Path) -> HashMap<String, u64> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return HashMap::new();
    };
    entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let id = name.strip_suffix(".arkyo")?;
            if !plain_point_id(id) || PointKind::of_id(id).is_none() {
                return None;
            }
            let meta = e.metadata().ok().filter(|m| m.is_file())?;
            Some((id.to_string(), meta.len()))
        })
        .collect()
}

/// Reads a point from its file; `None` when it is not a point of the project.
fn read_point(dir: &Path, project_id: &str, id: &str, size: u64) -> Option<Point> {
    let kind = PointKind::of_id(id)?;
    let (m, bundle) = archive::read_archive(&dir.join(format!("{id}.arkyo"))).ok()?;
    let root = m
        .roots
        .iter()
        .find(|r| r.kind == RootKind::Project && r.id == project_id)?;
    Some(Point {
        id: id.to_string(),
        project_id: project_id.to_string(),
        project_name: root.name.clone(),
        kind,
        label: m.label,
        created_at: m.created_at,
        author: m.created_by,
        digest: state_digest(&bundle),
        size,
    })
}

/// The points of the folder, oldest first, the index reconciled with the
/// files (and rewritten when it differed).
fn load(dir: &Path, project_id: &str) -> Vec<Point> {
    let files = point_files(dir);
    let index = read_index(dir);
    let mut changed = index.is_none();
    let mut seen = HashSet::new();
    let mut points: Vec<Point> = index.unwrap_or_default();
    let before = points.len();
    points.retain(|p| {
        p.project_id == project_id
            && files.get(&p.id) == Some(&p.size)
            && PointKind::of_id(&p.id) == Some(p.kind)
            && seen.insert(p.id.clone())
    });
    changed |= points.len() != before;
    for (id, size) in &files {
        if seen.contains(id) {
            continue;
        }
        match read_point(dir, project_id, id, *size) {
            Some(p) => {
                points.push(p);
                changed = true;
            }
            None => tracing::warn!("restore point unreadable: {}", dir.join(id).display()),
        }
    }
    points.sort_by(|a, b| (&a.created_at, &a.id).cmp(&(&b.created_at, &b.id)));
    if changed && dir.is_dir() {
        if let Err(e) = write_index(dir, &points) {
            tracing::warn!("restore points index of {}: {e}", dir.display());
        }
    }
    points
}

/// The points of a project, newest first (none for an invalid id).
pub fn list_points(data_dir: &Path, project_id: &str) -> Vec<Point> {
    let Some(dir) = dir_in(data_dir, project_id) else {
        return Vec::new();
    };
    let mut points = load(&dir, project_id);
    points.reverse();
    points
}

/// The projects that have points, deleted ones included.
pub fn list_projects(data_dir: &Path) -> Vec<ProjectPoints> {
    let Ok(entries) = std::fs::read_dir(root_dir(data_dir)) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for e in entries.flatten() {
        let Ok(id) = e.file_name().into_string() else {
            continue;
        };
        if !plain_project_id(&id) || !e.path().is_dir() {
            continue;
        }
        let points = list_points(data_dir, &id);
        let Some(last) = points.first().cloned() else {
            continue;
        };
        out.push(ProjectPoints {
            id,
            name: last.project_name.clone(),
            count: points.len(),
            last_point: Some(last),
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

/// The point `point_id` of a project and its file (`None` for an invalid
/// id or a point absent from the index).
pub fn find_point(data_dir: &Path, project_id: &str, point_id: &str) -> Option<(Point, PathBuf)> {
    if !plain_point_id(point_id) {
        return None;
    }
    let dir = dir_in(data_dir, project_id)?;
    let point = load(&dir, project_id)
        .into_iter()
        .find(|p| p.id == point_id)?;
    let path = dir.join(format!("{point_id}.arkyo"));
    Some((point, path))
}

// ── Creation, deletion, retention ───────────────────────────────────────────

/// The digest of the project's own state: its owned rows and the panels it
/// uses, not the catalogue (a catalogue edit is not a change of the
/// project). An unclassified table (a newer file) counts.
pub fn state_digest(bundle: &Bundle) -> String {
    archive::data_digest_of(bundle, |table| {
        classification()
            .iter()
            .find(|(t, _)| *t == table)
            .is_none_or(|(_, c)| matches!(c, Class::Owned | Class::Dependency))
    })
}

pub fn author_of(user: &User) -> Author {
    Author {
        id: user.id.clone(),
        name: user.name.clone(),
        email: Some(user.email.clone()),
    }
}

/// A free file path for a point of `kind` created now.
fn free_path(dir: &Path, kind: PointKind) -> (String, PathBuf) {
    let stamp = jiff::Timestamp::now().strftime("%Y%m%d-%H%M%S").to_string();
    let suffix = kind.suffix();
    let mut id = format!("{stamp}-{suffix}");
    let mut n = 1;
    while dir.join(format!("{id}.arkyo")).exists() {
        id = format!("{stamp}-{n}-{suffix}");
        n += 1;
    }
    let path = dir.join(format!("{id}.arkyo"));
    (id, path)
}

/// Writes a point of the current state of the project (one read snapshot).
/// `Auto`: `None` when the rows equal those of the project's last point.
pub async fn create_point(
    st: &AppState,
    project_id: &str,
    kind: PointKind,
    label: Option<String>,
    author: Option<Author>,
) -> Result<Option<Point>, TransferError> {
    let dir = project_dir(st, project_id)?;
    let lock = lock_of(&dir);
    let _guard = lock.lock().await;
    let roots = [(RootKind::Project, project_id.to_string())];
    let bundle = {
        let mut tx = crate::db::begin_read(&st.pool).await?;
        let bundle = collect(&mut tx, &roots).await;
        tx.rollback().await?;
        bundle?
    };
    let digest = state_digest(&bundle);
    let project_id = project_id.to_string();
    blocking(move || {
        let mut points = load(&dir, &project_id);
        if kind == PointKind::Auto && points.last().is_some_and(|p| p.digest == digest) {
            return Ok(None);
        }
        std::fs::create_dir_all(&dir)?;
        let (id, path) = free_path(&dir, kind);
        let part = dir.join(format!("{id}.arkyo.part"));
        // Rows only: the files stay in `<data>/uploads` (never deleted by
        // the server); a download adds them.
        let manifest = match archive::write_rows_only(&bundle, author, label, &part) {
            Ok(m) => m,
            Err(e) => {
                let _ = std::fs::remove_file(&part);
                return Err(e);
            }
        };
        if let Err(e) = std::fs::rename(&part, &path) {
            let _ = std::fs::remove_file(&part);
            return Err(e.into());
        }
        let point = Point {
            id,
            project_name: bundle
                .roots
                .first()
                .map(|r| r.name.clone())
                .unwrap_or_default(),
            project_id,
            kind,
            label: manifest.label,
            created_at: manifest.created_at,
            author: manifest.created_by,
            digest,
            size: std::fs::metadata(&path)?.len(),
        };
        points.push(point.clone());
        // The file is there: a failed index write is caught up on next read.
        if let Err(e) = write_index(&dir, &points) {
            tracing::warn!("restore points index of {}: {e}", dir.display());
        }
        Ok(Some(point))
    })
    .await
}

/// Writes the current state of the project as a point « avant
/// restauration », before a restore replaces it.
pub async fn snapshot_before_restore(
    st: &AppState,
    project_id: &str,
    user: &User,
) -> Result<(), TransferError> {
    create_point(
        st,
        project_id,
        PointKind::BeforeRestore,
        None,
        Some(author_of(user)),
    )
    .await?;
    Ok(())
}

/// Removes a point; `false` when there is no such point.
pub async fn delete_point(
    st: &AppState,
    project_id: &str,
    point_id: &str,
) -> Result<bool, TransferError> {
    let Some(dir) = dir_in(&st.data_dir, project_id) else {
        return Ok(false);
    };
    if !plain_point_id(point_id) {
        return Ok(false);
    }
    let lock = lock_of(&dir);
    let _guard = lock.lock().await;
    let (project_id, point_id) = (project_id.to_string(), point_id.to_string());
    blocking(move || {
        let mut points = load(&dir, &project_id);
        let Some(i) = points.iter().position(|p| p.id == point_id) else {
            return Ok(false);
        };
        match std::fs::remove_file(dir.join(format!("{point_id}.arkyo"))) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
        points.remove(i);
        write_index(&dir, &points)?;
        Ok(true)
    })
    .await
}

/// Removes temporary files of the folder left by a crash.
fn sweep(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !(name.ends_with(".arkyo.part") || name.ends_with(".tmp")) {
            continue;
        }
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > STALE_TMP);
        if old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// Keeps the `keep` latest automatic and « avant restauration » points of
/// the project; returns how many were removed.
async fn prune(data_dir: &Path, project_id: &str, keep: u32) -> usize {
    let Some(dir) = dir_in(data_dir, project_id) else {
        return 0;
    };
    let lock = lock_of(&dir);
    let _guard = lock.lock().await;
    let project_id = project_id.to_string();
    let res = blocking(move || {
        sweep(&dir);
        let points = load(&dir, &project_id);
        let rotating = points
            .iter()
            .filter(|p| p.kind != PointKind::Manual)
            .count();
        let mut excess = rotating.saturating_sub(keep as usize);
        if excess == 0 {
            return Ok(0);
        }
        let mut kept = Vec::with_capacity(points.len());
        let mut removed = 0;
        // Oldest first.
        for p in points {
            if excess > 0 && p.kind != PointKind::Manual {
                excess -= 1;
                match std::fs::remove_file(dir.join(format!("{}.arkyo", p.id))) {
                    Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                        tracing::warn!("cannot remove restore point {}: {e}", p.id);
                        kept.push(p);
                    }
                    _ => removed += 1,
                }
            } else {
                kept.push(p);
            }
        }
        write_index(&dir, &kept)?;
        Ok(removed)
    })
    .await;
    res.unwrap_or_else(|e| {
        tracing::warn!("restore points retention: {e}");
        0
    })
}

/// One automatic pass: a point of every project whose rows changed since
/// its last point, then the retention of every project folder (deleted
/// projects included). Returns how many points were written.
pub async fn run_auto_pass(st: &AppState) -> usize {
    let settings = load_settings(&st.pool).await;
    let ids: Vec<String> =
        match sqlx::query_scalar(r#"SELECT "id" FROM "Project" ORDER BY "createdAt", "id""#)
            .fetch_all(&st.pool)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("automatic restore points: {e}");
                Vec::new()
            }
        };
    let mut created = 0;
    for id in ids {
        match create_point(st, &id, PointKind::Auto, None, None).await {
            Ok(Some(_)) => created += 1,
            Ok(None) => {}
            // Deleted meanwhile.
            Err(TransferError::NotFound(..)) => {}
            Err(e) => tracing::warn!("automatic restore point of {id}: {e}"),
        }
    }
    let folders: Vec<String> = std::fs::read_dir(root_dir(&st.data_dir))
        .map(|d| {
            d.flatten()
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();
    for id in folders {
        prune(&st.data_dir, &id, settings.keep).await;
    }
    created
}

/// Starts the automatic points: a first pass 5 minutes after the start,
/// then one every `intervalHours` while enabled (the settings are reread
/// every minute).
pub fn spawn_scheduler(st: AppState) {
    tokio::spawn(async move {
        tokio::time::sleep(FIRST_PASS).await;
        let mut last: Option<Instant> = None;
        loop {
            let s = load_settings(&st.pool).await;
            let every = Duration::from_secs(u64::from(s.interval_hours) * 3600);
            if s.enabled && last.is_none_or(|t| t.elapsed() >= every) {
                let n = run_auto_pass(&st).await;
                tracing::info!(points = n, "automatic restore points");
                last = Some(Instant::now());
            }
            tokio::time::sleep(TICK).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{plain_point_id, PointKind};

    #[test]
    fn kind_is_read_from_the_end_of_the_id() {
        assert_eq!(
            PointKind::of_id("20261107-100000-auto"),
            Some(PointKind::Auto)
        );
        assert_eq!(
            PointKind::of_id("20261107-100000-2-manuel"),
            Some(PointKind::Manual)
        );
        assert_eq!(
            PointKind::of_id("20261107-100000-1-avant-restauration"),
            Some(PointKind::BeforeRestore)
        );
        assert_eq!(PointKind::of_id("auto"), None);
        assert_eq!(PointKind::of_id("20261107-100000-autre"), None);
        assert!(plain_point_id("20261107-100000-auto"));
        assert!(!plain_point_id("../x"));
        assert!(!plain_point_id("a.arkyo"));
        assert!(!plain_point_id(""));
    }
}
