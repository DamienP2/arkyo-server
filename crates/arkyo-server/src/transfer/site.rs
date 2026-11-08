//! Full backup of the site (spec 2026-11-07-sauvegardes-design §6): a zip
//! `Arkyo-site-<AAAAMMJJ-HHMMSS>.zip` (local time of the server) holding
//! `manifest.json`, `arkyo.db` (a consistent copy made by `VACUUM INTO`),
//! `config.json`, `uploads/**` and `backups/projects/**`.
//!
//! Restore: the archive is checked (its base extracted into `<data>/tmp`),
//! then staged as `<data>/restore-pending.zip` and applied at the next
//! start, before the base is opened ([`apply_pending_restore`]): the
//! current data moves to `<data>/before-restore-<horodatage>/`, the archive
//! is unpacked, renamed `restore-applied-<horodatage>.zip` (the commit
//! point), then `db::open` runs the (additive) migrations. The outcome is
//! kept in `<data>/restore-status.json`. The `config.json` of the
//! archive replaces the current one as is: port and address are settings of
//! the site, restored with it. `backups/site/` (the site backups themselves),
//! `update/`, `logs/` and `tmp/` are neither saved nor replaced.
//!
//! Automatic backups: every day once the local hour set has passed, when no
//! backup of that day is in the folder; the `keep` latest are kept.

use std::fs::File;
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use super::archive::safe_rel;
use super::import::blocking;
use super::{RemoveOnDrop, TransferError};
use crate::http::AppState;

const FORMAT: &str = "arkyo-server-site";
const VERSION: u32 = 1;
pub const SETTINGS_KEY: &str = "backups.site";
/// The staged archive, applied at the next start.
pub const PENDING: &str = "restore-pending.zip";
const PREFIX: &str = "Arkyo-site-";
const DB: &str = "arkyo.db";
const CONFIG: &str = "config.json";
const MANIFEST: &str = "manifest.json";
/// The folders of the data directory a backup carries.
const TREES: [&str; 2] = ["uploads", "backups/projects"];
/// What a restore replaces (and sets aside), relative to the data directory.
const REPLACED: [&str; 6] = [
    "arkyo.db",
    "arkyo.db-wal",
    "arkyo.db-shm",
    CONFIG,
    "uploads",
    "backups/projects",
];
/// Maximum sum of the declared uncompressed sizes of a site archive.
const MAX_TOTAL: u64 = 64 * 1024 * 1024 * 1024;
/// Upper bound of the retention setting.
const MAX_KEEP: u32 = 1000;
/// How often the scheduler checks whether the daily backup is due.
const TICK: Duration = Duration::from_secs(60);
/// Delay before a failed automatic backup is tried again.
const RETRY: Duration = Duration::from_secs(3600);
const BAD_DIR: &str = "Dossier inaccessible";
/// A destination folder inside the saved data.
pub const INSIDE_DATA: &str = "Ce dossier fait partie des données sauvegardées.";
/// A backup whose base comes from a newer version (still restorable under
/// the additive rule) or whose format is newer (refused).
pub const NEWER: &str = "Cette sauvegarde vient d'une version plus récente de Strata Arkyo.";
/// Marker of a restore being applied (crash recovery).
const IN_PROGRESS: &str = "restore-in-progress.json";
/// Outcome of the last restore applied at startup.
const STATUS: &str = "restore-status.json";
/// Age past which a temporary file left by a crash is removed.
const STALE: Duration = Duration::from_secs(3600);

fn bad() -> TransferError {
    TransferError::Invalid("Archive invalide.".into())
}

fn zip_err(_: zip::result::ZipError) -> TransferError {
    bad()
}

// ── Settings ────────────────────────────────────────────────────────────────

/// AppConfig `backups.site`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteSettings {
    pub enabled: bool,
    /// Local hour of the daily backup (0–23).
    pub hour: u32,
    /// Destination folder; `None` = `<data>/backups/site`.
    #[serde(default)]
    pub dir: Option<String>,
    /// Backups kept in the folder.
    pub keep: u32,
}

impl Default for SiteSettings {
    fn default() -> Self {
        SiteSettings {
            enabled: true,
            hour: 3,
            dir: None,
            keep: 7,
        }
    }
}

impl SiteSettings {
    /// Hour and retention in range, folder absolute (its existence is
    /// checked by [`check_dir`] when it is set).
    pub fn is_valid(&self) -> bool {
        self.hour < 24
            && (1..=MAX_KEEP).contains(&self.keep)
            && self
                .dir
                .as_deref()
                .is_none_or(|d| Path::new(d).is_absolute())
    }

    /// A blank folder means the default one.
    pub fn normalized(mut self) -> Self {
        self.dir = self
            .dir
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty());
        self
    }
}

/// The stored settings, or the defaults when absent or invalid.
pub async fn load_settings(pool: &SqlitePool) -> SiteSettings {
    let v: Option<String> =
        sqlx::query_scalar(r#"SELECT "value" FROM "AppConfig" WHERE "key" = ?"#)
            .bind(SETTINGS_KEY)
            .fetch_optional(pool)
            .await
            .unwrap_or_default();
    v.and_then(|v| serde_json::from_str::<SiteSettings>(&v).ok())
        .filter(SiteSettings::is_valid)
        .unwrap_or_default()
}

pub async fn save_settings(pool: &SqlitePool, s: &SiteSettings) -> Result<(), sqlx::Error> {
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

/// The folder the backups of the site go to.
pub fn backup_dir(data_dir: &Path, s: &SiteSettings) -> PathBuf {
    match &s.dir {
        Some(d) => PathBuf::from(d),
        None => data_dir.join("backups").join("site"),
    }
}

/// Checks a destination folder: an absolute path to an existing folder this
/// process can write in (a probe file is created then removed), else
/// « Dossier inaccessible » ; never inside the saved data (`uploads/`,
/// `backups/projects/`), else [`INSIDE_DATA`].
pub fn check_dir(data_dir: &Path, dir: &str) -> Result<(), &'static str> {
    let dir = Path::new(dir);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err(BAD_DIR);
    }
    let real = std::fs::canonicalize(dir).map_err(|_| BAD_DIR)?;
    let base = std::fs::canonicalize(data_dir).unwrap_or_else(|_| data_dir.to_path_buf());
    for tree in TREES {
        let saved = std::fs::canonicalize(data_dir.join(tree)).unwrap_or_else(|_| base.join(tree));
        if real.starts_with(&saved) {
            return Err(INSIDE_DATA);
        }
    }
    let probe = dir.join(format!(".arkyo-probe-{}", crate::ids::new_id()));
    let ok = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .and_then(|mut f| f.write_all(b"x"))
        .is_ok();
    let _ = std::fs::remove_file(&probe);
    if ok {
        Ok(())
    } else {
        Err(BAD_DIR)
    }
}

/// Whether the file was last written more than [`STALE`] ago.
fn stale(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age > STALE)
}

/// Removes the temporaries a crash may leave: `Arkyo-site-*.zip.part` in the
/// backup folder and `restore-pending.zip.part`, last written more than an
/// hour ago (the copies of the base in `<data>/tmp` are swept with the
/// other temporaries of that folder).
pub fn sweep_stale(data_dir: &Path, backup_dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(backup_dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let part = name.strip_suffix(".part").is_some_and(is_backup_name);
            if part && stale(&e.path()) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let pending_part = data_dir.join(format!("{PENDING}.part"));
    if stale(&pending_part) {
        let _ = std::fs::remove_file(&pending_part);
    }
}

// ── Names and listing ───────────────────────────────────────────────────────

/// One backup of the site in its folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBackup {
    pub name: String,
    /// Size of the file, in bytes.
    pub size: u64,
    /// From the name (local time of the server), in UTC.
    pub created_at: String,
    #[serde(skip)]
    pub path: PathBuf,
}

/// The `AAAAMMJJ-HHMMSS` of a backup name (`^Arkyo-site-\d{8}-\d{6}\.zip$`).
fn stamp_of(name: &str) -> Option<&str> {
    let stamp = name.strip_prefix(PREFIX)?.strip_suffix(".zip")?;
    let b = stamp.as_bytes();
    let ok = b.len() == 15
        && b[8] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 8 || c.is_ascii_digit());
    ok.then_some(stamp)
}

/// Whether `name` is the name of a backup of the site.
pub fn is_backup_name(name: &str) -> bool {
    stamp_of(name).is_some()
}

fn local_datetime(stamp: &str) -> Option<jiff::civil::DateTime> {
    jiff::civil::DateTime::strptime("%Y%m%d-%H%M%S", stamp).ok()
}

/// The UTC ISO date of a local stamp.
fn created_at(stamp: &str) -> Option<String> {
    let zoned = local_datetime(stamp)?
        .to_zoned(jiff::tz::TimeZone::system())
        .ok()?;
    Some(
        zoned
            .timestamp()
            .strftime("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string(),
    )
}

/// The backup names of the folder, oldest first.
fn backup_names(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| stamp_of(n).is_some_and(|s| local_datetime(s).is_some()))
        .collect();
    names.sort();
    names
}

/// The backups of the folder, newest first.
pub fn list_site_backups(dir: &Path) -> Vec<SiteBackup> {
    let mut out: Vec<SiteBackup> = backup_names(dir)
        .into_iter()
        .filter_map(|name| {
            let path = dir.join(&name);
            let size = std::fs::metadata(&path).ok()?.len();
            let created_at = created_at(stamp_of(&name)?)?;
            Some(SiteBackup {
                name,
                size,
                created_at,
                path,
            })
        })
        .collect();
    out.reverse();
    out
}

/// Keeps the `keep` latest backups of the folder; returns how many were
/// removed.
pub fn prune_site_backups(dir: &Path, keep: u32) -> usize {
    let names = backup_names(dir);
    let excess = names.len().saturating_sub(keep as usize);
    let mut removed = 0;
    for name in names.iter().take(excess) {
        match std::fs::remove_file(dir.join(name)) {
            Ok(()) => removed += 1,
            Err(e) => tracing::warn!("cannot remove site backup {name}: {e}"),
        }
    }
    removed
}

/// Whether the daily backup is due at `now` (local time): the hour set has
/// passed and no backup of the day is among `names`.
pub fn is_due(now: jiff::civil::DateTime, hour: u32, names: &[String]) -> bool {
    if u32::try_from(now.hour()).unwrap_or(0) < hour {
        return false;
    }
    let today = now.date().strftime("%Y%m%d").to_string();
    !names
        .iter()
        .filter_map(|n| stamp_of(n))
        .any(|s| s.starts_with(&today))
}

// ── Ownership ───────────────────────────────────────────────────────────────

/// The owner the written files are given back to: the data directory's,
/// when root writes in a directory it does not own (`sudo arkyo-server
/// backup` in `/var/lib/arkyo`); otherwise nothing changes.
#[derive(Debug, Clone, Copy)]
struct Owner {
    #[cfg(unix)]
    ids: Option<(u32, u32)>,
}

impl Owner {
    fn of(data_dir: &Path) -> Owner {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            // SAFETY: geteuid has no preconditions and cannot fail.
            let euid = unsafe { libc::geteuid() };
            let ids = std::fs::metadata(data_dir)
                .ok()
                .filter(|m| crate::db::should_chown(euid, m.uid()))
                .map(|m| (m.uid(), m.gid()));
            Owner { ids }
        }
        #[cfg(not(unix))]
        {
            let _ = data_dir;
            Owner {}
        }
    }

    /// A file just written, through its descriptor.
    fn file(&self, f: &File) {
        #[cfg(unix)]
        if let Some((uid, gid)) = self.ids {
            let _ = std::os::unix::fs::fchown(f, Some(uid), Some(gid));
        }
        #[cfg(not(unix))]
        let _ = f;
    }

    /// The folders from `base` (excluded) to `dir` (included), never
    /// following a symlink.
    fn dirs(&self, base: &Path, dir: &Path) {
        #[cfg(unix)]
        if let (Some((uid, gid)), Ok(rel)) = (self.ids, dir.strip_prefix(base)) {
            let mut cur = base.to_path_buf();
            for c in rel.components() {
                cur.push(c);
                let _ = std::os::unix::fs::lchown(&cur, Some(uid), Some(gid));
            }
        }
        #[cfg(not(unix))]
        let _ = (base, dir);
    }
}

// ── Backup ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteManifest {
    pub format: String,
    pub version: u32,
    pub app_version: String,
    pub created_at: String,
    /// The latest migration applied to the saved base.
    pub migration: i64,
}

fn local_stamp() -> String {
    jiff::Zoned::now().strftime("%Y%m%d-%H%M%S").to_string()
}

/// Writes a backup of the site in `out_dir` (created when absent):
/// `<name>.part`, then renamed. One backup at a time.
pub async fn create_site_backup(
    pool: &SqlitePool,
    data_dir: &Path,
    out_dir: &Path,
) -> Result<SiteBackup, TransferError> {
    static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = LOCK.lock().await;
    let owner = Owner::of(data_dir);
    let tmp = data_dir.join("tmp");
    tokio::fs::create_dir_all(&tmp)
        .await
        .map_err(TransferError::Storage)?;
    owner.dirs(data_dir, &tmp);
    let copy = tmp.join(format!("site-{}.db", crate::ids::new_id()));
    let _remove = RemoveOnDrop(copy.clone());
    let target = copy
        .to_str()
        .ok_or_else(|| TransferError::Invalid(BAD_DIR.into()))?
        .to_string();
    let migration: i64 =
        sqlx::query_scalar(r#"SELECT COALESCE(MAX("version"), 0) FROM "_sqlx_migrations""#)
            .fetch_one(pool)
            .await?;
    // One read snapshot, on a connection of its own: writers go on (WAL).
    sqlx::query("VACUUM INTO ?")
        .bind(target)
        .execute(pool)
        .await?;
    let manifest = SiteManifest {
        format: FORMAT.into(),
        version: VERSION,
        app_version: env!("CARGO_PKG_VERSION").into(),
        created_at: crate::ids::now_iso(),
        migration,
    };
    let (data_dir, out_dir) = (data_dir.to_path_buf(), out_dir.to_path_buf());
    blocking(move || {
        std::fs::create_dir_all(&out_dir).map_err(TransferError::Storage)?;
        let owner = if out_dir.starts_with(&data_dir) {
            owner.dirs(&data_dir, &out_dir);
            owner
        } else {
            Owner::of(&out_dir)
        };
        let (name, stamp) = free_name(&out_dir)?;
        let path = out_dir.join(&name);
        let part = out_dir.join(format!("{name}.part"));
        if let Err(e) = write_site_zip(&part, &manifest, &copy, &data_dir, &out_dir, owner) {
            let _ = std::fs::remove_file(&part);
            return Err(e);
        }
        if let Err(e) = std::fs::rename(&part, &path) {
            let _ = std::fs::remove_file(&part);
            return Err(e.into());
        }
        Ok(SiteBackup {
            size: std::fs::metadata(&path)?.len(),
            created_at: created_at(&stamp).unwrap_or_else(crate::ids::now_iso),
            name,
            path,
        })
    })
    .await
}

/// A name not taken in `dir` (a backup in the same second waits for the
/// next one).
fn free_name(dir: &Path) -> Result<(String, String), TransferError> {
    for _ in 0..5 {
        let stamp = local_stamp();
        let name = format!("{PREFIX}{stamp}.zip");
        if !dir.join(&name).exists() && !dir.join(format!("{name}.part")).exists() {
            return Ok((name, stamp));
        }
        std::thread::sleep(Duration::from_millis(1000));
    }
    Err(TransferError::Io(io::Error::from(
        io::ErrorKind::AlreadyExists,
    )))
}

fn write_site_zip(
    out: &Path,
    manifest: &SiteManifest,
    db_copy: &Path,
    data_dir: &Path,
    out_dir: &Path,
    owner: Owner,
) -> Result<(), TransferError> {
    let opts = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .large_file(true);
    // Never clobbers the `.part` of another process.
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(out)?;
    owner.file(&file);
    let mut z = ZipWriter::new(BufWriter::new(file));
    z.start_file(MANIFEST, opts).map_err(zip_err)?;
    serde_json::to_writer(&mut z, manifest).map_err(|_| bad())?;
    z.start_file(DB, opts).map_err(zip_err)?;
    io::copy(&mut File::open(db_copy)?, &mut z)?;
    let config = data_dir.join(CONFIG);
    if std::fs::symlink_metadata(&config).is_ok_and(|m| m.is_file()) {
        z.start_file(CONFIG, opts).map_err(zip_err)?;
        io::copy(&mut File::open(&config)?, &mut z)?;
    }
    // The destination folder is never saved into itself.
    let skip = std::fs::canonicalize(out_dir).ok();
    for tree in TREES {
        add_tree(&mut z, &data_dir.join(tree), tree, skip.as_deref(), opts)?;
    }
    let file = z
        .finish()
        .map_err(zip_err)?
        .into_inner()
        .map_err(|e| e.into_error())?;
    file.sync_all()?;
    Ok(())
}

/// Adds the regular files under `dir` as `<prefix>/<relative path>`
/// (symlinks and temporary files left aside).
fn add_tree<W: Write + io::Seek>(
    z: &mut ZipWriter<W>,
    dir: &Path,
    prefix: &str,
    skip: Option<&Path>,
    opts: SimpleFileOptions,
) -> Result<(), TransferError> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(());
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let Ok(name) = e.file_name().into_string() else {
            continue;
        };
        let Ok(kind) = e.file_type() else {
            continue;
        };
        let rel = format!("{prefix}/{name}");
        if kind.is_dir() {
            let path = e.path();
            if skip.is_some_and(|s| std::fs::canonicalize(&path).is_ok_and(|p| p == s)) {
                continue;
            }
            add_tree(z, &path, &rel, skip, opts)?;
        } else if kind.is_file() {
            let temporary = [".part", ".tmp", ".part-transfer"]
                .iter()
                .any(|s| name.ends_with(s));
            if temporary || !safe_rel(&rel) {
                continue;
            }
            z.start_file(rel.as_str(), opts).map_err(zip_err)?;
            io::copy(&mut File::open(e.path())?, z)?;
        }
    }
    Ok(())
}

/// Creates a backup in the folder of the settings, then applies the
/// retention. A folder set but missing is an error (never created: it may
/// be an unmounted share).
pub async fn run_backup(st: &AppState, s: &SiteSettings) -> Result<SiteBackup, TransferError> {
    let dir = backup_dir(&st.data_dir, s);
    let exists = tokio::fs::metadata(&dir).await.is_ok_and(|m| m.is_dir());
    if s.dir.is_some() && !exists {
        return Err(TransferError::Invalid(BAD_DIR.into()));
    }
    let (data_dir, swept) = (st.data_dir.clone(), dir.clone());
    blocking(move || {
        sweep_stale(&data_dir, &swept);
        Ok(())
    })
    .await?;
    let backup = create_site_backup(&st.pool, &st.data_dir, &dir).await?;
    let keep = s.keep;
    blocking(move || Ok(prune_site_backups(&dir, keep))).await?;
    Ok(backup)
}

/// Starts the daily backups: every minute, a backup when it is due
/// ([`is_due`]); a failure is tried again an hour later.
pub fn spawn_scheduler(st: AppState) {
    tokio::spawn(async move {
        let mut failed: Option<Instant> = None;
        loop {
            tokio::time::sleep(TICK).await;
            let s = load_settings(&st.pool).await;
            if !s.enabled || failed.is_some_and(|t| t.elapsed() < RETRY) {
                continue;
            }
            let dir = backup_dir(&st.data_dir, &s);
            let names = blocking(move || Ok(backup_names(&dir)))
                .await
                .unwrap_or_default();
            if !is_due(jiff::Zoned::now().datetime(), s.hour, &names) {
                continue;
            }
            match run_recorded(&st, &s).await {
                Ok(b) => {
                    failed = None;
                    tracing::info!(name = b.name, size = b.size, "automatic site backup");
                }
                Err(e) => {
                    failed = Some(Instant::now());
                    tracing::warn!("automatic site backup: {e}");
                }
            }
        }
    });
}

/// [`run_backup`], its outcome kept as the last error of the site backups
/// (set on failure, cleared on success).
pub async fn run_recorded(st: &AppState, s: &SiteSettings) -> Result<SiteBackup, TransferError> {
    let res = run_backup(st, s).await;
    let message = res.as_ref().err().map(ToString::to_string);
    super::record_last_error(&st.pool, SETTINGS_KEY, message).await;
    res
}

// ── Verification ────────────────────────────────────────────────────────────

fn open(path: &Path) -> Result<ZipArchive<File>, TransferError> {
    ZipArchive::new(File::open(path)?).map_err(zip_err)
}

/// Checks the entry names (safe relative paths), the total declared size,
/// the manifest and the presence of the base.
fn check(z: &mut ZipArchive<File>) -> Result<SiteManifest, TransferError> {
    let mut total: u64 = 0;
    let mut has_db = false;
    // Two files differing only by case would clash on a case-insensitive
    // disk (macOS, Windows).
    let mut files = std::collections::HashSet::new();
    for i in 0..z.len() {
        let e = z.by_index_raw(i).map_err(zip_err)?;
        total = total.saturating_add(e.size());
        let name = e.name().map_err(zip_err)?;
        let rel = name.strip_suffix('/').unwrap_or(&name);
        if !safe_rel(rel) {
            return Err(bad());
        }
        if !e.is_dir() && !files.insert(rel.to_lowercase()) {
            return Err(bad());
        }
        has_db |= rel == DB && !e.is_dir();
    }
    if total > MAX_TOTAL {
        return Err(TransferError::Invalid("Archive trop volumineuse.".into()));
    }
    let m: Value = {
        let e = z.by_name(MANIFEST).map_err(zip_err)?;
        let size = e.size();
        serde_json::from_reader(io::BufReader::new(e.take(size))).map_err(|_| bad())?
    };
    if m.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err(TransferError::Invalid(
            "Ce fichier n'est pas une sauvegarde du site Strata Arkyo.".into(),
        ));
    }
    if m.get("version").and_then(Value::as_u64).unwrap_or(0) > u64::from(VERSION) {
        return Err(TransferError::Invalid(NEWER.into()));
    }
    let manifest: SiteManifest = serde_json::from_value(m).map_err(|_| bad())?;
    if !has_db {
        return Err(bad());
    }
    Ok(manifest)
}

/// Copies at most `limit` bytes of `r` to `w`; a read error goes through
/// `on_read`, a write error is [`TransferError::Storage`]. Returns the bytes
/// copied.
fn pump(
    r: &mut impl Read,
    w: &mut impl Write,
    limit: u64,
    on_read: fn(io::Error) -> TransferError,
) -> Result<u64, TransferError> {
    let mut buf = vec![0u8; 64 * 1024];
    let mut done: u64 = 0;
    while done < limit {
        let want = usize::try_from(limit - done).map_or(buf.len(), |l| l.min(buf.len()));
        let n = match r.read(&mut buf[..want]) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(on_read(e)),
        };
        w.write_all(&buf[..n]).map_err(TransferError::Storage)?;
        done += n as u64;
    }
    Ok(done)
}

/// Copies exactly the declared `size` bytes of `entry` to `out`, then reads
/// it to its end (which checks its CRC). A read or format error is
/// « Archive invalide. », a write error [`TransferError::Storage`].
pub(crate) fn copy_entry(
    entry: &mut impl Read,
    size: u64,
    out: &mut impl Write,
) -> Result<(), TransferError> {
    let n = pump(entry, out, size, |_| bad())?;
    let mut more = [0u8; 1];
    if n != size || entry.read(&mut more).map_err(|_| bad())? != 0 {
        return Err(bad());
    }
    Ok(())
}

/// Opens the base read-only: a SQLite file holding the migrations table,
/// whose quick check passes.
fn check_base(path: &Path) -> Result<(), TransferError> {
    let mut head = [0u8; 16];
    File::open(path)?.read_exact(&mut head).map_err(|_| bad())?;
    if &head != b"SQLite format 3\0" {
        return Err(bad());
    }
    let path = path.to_path_buf();
    // A runtime of its own, on a thread of its own: callable from anywhere
    // (CLI, blocking task, test).
    let ok = std::thread::spawn(move || -> Result<bool, String> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        rt.block_on(async {
            use sqlx::{Connection, SqliteConnection};
            let opts = sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&path)
                .read_only(true);
            let mut c = SqliteConnection::connect_with(&opts)
                .await
                .map_err(|e| e.to_string())?;
            let tables: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
            )
            .fetch_one(&mut c)
            .await
            .map_err(|e| e.to_string())?;
            let check: String = sqlx::query_scalar("PRAGMA quick_check")
                .fetch_one(&mut c)
                .await
                .map_err(|e| e.to_string())?;
            let _ = c.close().await;
            Ok(tables == 1 && check == "ok")
        })
    })
    .join();
    match ok {
        Ok(Ok(true)) => Ok(()),
        Ok(Err(e)) => {
            tracing::warn!("site backup base unreadable: {e}");
            Err(bad())
        }
        _ => Err(bad()),
    }
}

/// Checks a site archive: format, safe paths, and a base SQLite opens
/// read-only, from a copy extracted into `work_dir` (`<data>/tmp`: the
/// system temporary folder may be a small tmpfs).
pub fn verify_site_archive(path: &Path, work_dir: &Path) -> Result<SiteManifest, TransferError> {
    let mut z = open(path)?;
    let manifest = check(&mut z)?;
    std::fs::create_dir_all(work_dir).map_err(TransferError::Storage)?;
    let tmp = work_dir.join(format!("verify-{}.db", crate::ids::new_id()));
    let _remove = RemoveOnDrop(tmp.clone());
    {
        let mut e = z.by_name(DB).map_err(zip_err)?;
        let size = e.size();
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(TransferError::Storage)?;
        let mut f = BufWriter::new(file);
        copy_entry(&mut e, size, &mut f)?;
        f.flush().map_err(TransferError::Storage)?;
    }
    check_base(&tmp)?;
    Ok(manifest)
}

// ── Restore ─────────────────────────────────────────────────────────────────

/// Checks `archive` and copies it to `<data>/restore-pending.zip`, applied
/// at the next start.
pub fn stage_restore(data_dir: &Path, archive: &Path) -> Result<SiteManifest, TransferError> {
    stage(data_dir, archive, false)
}

/// [`stage_restore`] of a file of `<data>/tmp`, moved rather than copied.
pub fn stage_restore_moving(
    data_dir: &Path,
    archive: &Path,
) -> Result<SiteManifest, TransferError> {
    stage(data_dir, archive, true)
}

fn stage(data_dir: &Path, archive: &Path, moving: bool) -> Result<SiteManifest, TransferError> {
    std::fs::create_dir_all(data_dir).map_err(TransferError::Storage)?;
    let owner = Owner::of(data_dir);
    let work = data_dir.join("tmp");
    std::fs::create_dir_all(&work).map_err(TransferError::Storage)?;
    owner.dirs(data_dir, &work);
    let manifest = verify_site_archive(archive, &work)?;
    let dest = data_dir.join(PENDING);
    if moving && std::fs::rename(archive, &dest).is_ok() {
        return Ok(manifest);
    }
    let part = data_dir.join(format!("{PENDING}.part"));
    if stale(&part) {
        let _ = std::fs::remove_file(&part);
    }
    // Never clobbers the copy of another process.
    let mut out = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&part)
    {
        Ok(f) => f,
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
            return Err(TransferError::Invalid(
                "Une autre restauration est en cours de préparation.".into(),
            ))
        }
        Err(e) => return Err(TransferError::Storage(e)),
    };
    owner.file(&out);
    let copied = File::open(archive)
        .map_err(TransferError::Io)
        .and_then(|mut src| pump(&mut src, &mut out, u64::MAX, TransferError::Io))
        .and_then(|_| out.sync_all().map_err(TransferError::Storage))
        .and_then(|()| std::fs::rename(&part, &dest).map_err(TransferError::Storage));
    if let Err(e) = copied {
        let _ = std::fs::remove_file(&part);
        return Err(e);
    }
    Ok(manifest)
}

/// Identity of the staged file, to recognise one already applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingId {
    pub size: u64,
    pub modified_ns: u64,
}

fn pending_id(path: &Path) -> Option<PendingId> {
    let m = std::fs::metadata(path).ok()?;
    let modified = m
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    Some(PendingId {
        size: m.len(),
        modified_ns: u64::try_from(modified.as_nanos()).ok()?,
    })
}

/// A restore staged and not applied yet (`pending` of `GET
/// /api/system/backups/site`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingRestore {
    /// When it was staged (the file's modification time).
    pub created_at: String,
    /// `createdAt` of the backup it holds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_created_at: Option<String>,
    pub size: u64,
}

/// The staged restore, if any (not one already applied whose archive could
/// not be removed).
pub fn pending_restore(data_dir: &Path) -> Option<PendingRestore> {
    let path = data_dir.join(PENDING);
    let meta = std::fs::metadata(&path).ok().filter(|m| m.is_file())?;
    if already_applied(data_dir, &path) {
        return None;
    }
    let created_at = meta
        .modified()
        .ok()
        .and_then(|t| jiff::Timestamp::try_from(t).ok())
        .map(|t| t.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
        .unwrap_or_default();
    let backup_created_at = open(&path).ok().and_then(|mut z| {
        let e = z.by_name(MANIFEST).ok()?;
        let size = e.size();
        let m: Value = serde_json::from_reader(io::BufReader::new(e.take(size))).ok()?;
        m.get("createdAt")?.as_str().map(str::to_string)
    });
    Some(PendingRestore {
        created_at,
        backup_created_at,
        size: meta.len(),
    })
}

/// Cancels the staged restore; `false` when there is none.
pub fn cancel_pending_restore(data_dir: &Path) -> io::Result<bool> {
    match std::fs::remove_file(data_dir.join(PENDING)) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

/// `<data>/restore-status.json`: the outcome of the last restore applied at
/// startup (`lastRestore` of `GET /api/system/backups/site`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreStatus {
    pub ok: bool,
    pub at: String,
    /// The archive, as kept in the data directory
    /// (`restore-applied-…zip`, `restore-failed-…zip`).
    pub archive: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// `createdAt` of the backup restored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup_created_at: Option<String>,
    /// Set when the applied archive could be neither renamed nor removed:
    /// the next start recognises it and does not apply it again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<PendingId>,
}

pub fn read_restore_status(data_dir: &Path) -> Option<RestoreStatus> {
    serde_json::from_slice(&std::fs::read(data_dir.join(STATUS)).ok()?).ok()
}

/// Writes `value` at `path` atomically and durably (temporary file, sync,
/// rename).
fn write_json(path: &Path, value: &impl Serialize, owner: Owner) -> io::Result<()> {
    let tmp = path.with_extension(format!("{}.tmp", crate::ids::new_id()));
    let res = (|| {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        owner.file(&f);
        f.write_all(&serde_json::to_vec_pretty(value)?)?;
        f.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res
}

fn write_status(data_dir: &Path, status: &RestoreStatus, owner: Owner) {
    if let Err(e) = write_json(&data_dir.join(STATUS), status, owner) {
        tracing::error!("cannot write {STATUS}: {e}");
    }
}

/// Phase of a restore being applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Phase {
    /// The current data is being moved aside: what is not in the folder
    /// aside yet is still the original.
    Moving,
    /// The archive is being unpacked: what is in place is from the archive.
    Unpacking,
}

/// `<data>/restore-in-progress.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    /// The name of the `before-restore-…` folder.
    aside: String,
    phase: Phase,
    started_at: String,
}

/// Whether `pending` was already applied, its rename and removal having
/// both failed.
fn already_applied(data_dir: &Path, pending: &Path) -> bool {
    let Some(status) = read_restore_status(data_dir) else {
        return false;
    };
    status.ok && status.pending.is_some() && status.pending == pending_id(pending)
}

const INTERRUPTED: &str =
    "La restauration a été interrompue ; les données d'origine ont été remises en place.";

/// Applies `<data>/restore-pending.zip` when there is one (at startup,
/// before the base is opened); `Ok(false)` when there is none.
///
/// The current data moves to `<data>/before-restore-<horodatage>/`, the
/// archive is unpacked (base synced to disk), then the archive is renamed
/// `restore-applied-<horodatage>.zip`: the commit point. On failure the
/// data is put back as it was and the archive renamed
/// `restore-failed-<horodatage>.zip`. A marker `restore-in-progress.json`
/// lets the next start put the original data back after a crash in
/// between. The outcome goes to `restore-status.json`.
pub fn apply_pending_restore(data_dir: &Path) -> Result<bool, TransferError> {
    let owner = Owner::of(data_dir);
    let stamp = local_stamp();
    let pending = data_dir.join(PENDING);
    if data_dir.join(IN_PROGRESS).exists() {
        recover(data_dir, &pending, &stamp, owner)?;
    }
    if !pending.is_file() {
        return Ok(false);
    }
    if already_applied(data_dir, &pending) {
        tracing::warn!("{PENDING} already applied; not applying it again");
        let _ = std::fs::remove_file(&pending);
        return Ok(false);
    }
    match apply(data_dir, &pending, &stamp, owner) {
        Ok((aside, manifest)) => {
            let applied = format!("restore-applied-{stamp}.zip");
            let mut status = RestoreStatus {
                ok: true,
                at: crate::ids::now_iso(),
                archive: applied.clone(),
                error: None,
                backup_created_at: Some(manifest.created_at),
                pending: None,
            };
            // The commit point: the archive leaves `restore-pending.zip`.
            if std::fs::rename(&pending, data_dir.join(&applied)).is_err() {
                status.archive = PENDING.into();
                if let Err(e) = std::fs::remove_file(&pending) {
                    tracing::error!(
                        "cannot rename nor remove {PENDING} ({e}); it is marked as applied"
                    );
                    status.pending = pending_id(&pending);
                }
            }
            write_status(data_dir, &status, owner);
            let _ = std::fs::remove_file(data_dir.join(IN_PROGRESS));
            tracing::info!("site backup restored; previous data in {}", aside.display());
            purge_leftovers(data_dir);
            Ok(true)
        }
        Err(e) => {
            let archive = fail_pending(data_dir, &pending, &stamp);
            write_status(
                data_dir,
                &RestoreStatus {
                    ok: false,
                    at: crate::ids::now_iso(),
                    archive,
                    error: Some(e.to_string()),
                    backup_created_at: None,
                    pending: None,
                },
                owner,
            );
            tracing::error!("site restore failed, data kept: {e}");
            Err(e)
        }
    }
}

/// What earlier restores leave in the data directory and how many of each
/// are kept: `(prefix, suffix, keep, folder)`.
const LEFTOVERS: [(&str, &str, usize, bool); 3] = [
    ("before-restore-", "", 2, true),
    ("restore-applied-", ".zip", 1, false),
    ("restore-failed-", ".zip", 1, false),
];

/// `<prefix><stamp>[-<n>]<suffix>` → `(stamp, n)`, to sort oldest first.
fn leftover_order(name: &str, prefix: &str, suffix: &str) -> (String, u32) {
    let base = name
        .strip_prefix(prefix)
        .and_then(|n| n.strip_suffix(suffix))
        .unwrap_or(name);
    let (stamp, n) = match base.get(15..) {
        Some(rest) => (
            &base[..15],
            rest.strip_prefix('-').and_then(|n| n.parse().ok()),
        ),
        None => (base, None),
    };
    (stamp.to_string(), n.unwrap_or(0))
}

/// After a restore committed (never after a failure: the data aside may be
/// the only good copy), keeps the 2 latest `before-restore-*` folders, the
/// latest `restore-applied-*.zip` and the latest `restore-failed-*.zip`.
fn purge_leftovers(data_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(data_dir) else {
        return;
    };
    let entries: Vec<(String, bool)> = entries
        .flatten()
        .filter_map(|e| {
            let is_dir = e.file_type().ok()?.is_dir();
            Some((e.file_name().into_string().ok()?, is_dir))
        })
        .collect();
    for (prefix, suffix, keep, folder) in LEFTOVERS {
        let mut names: Vec<&String> = entries
            .iter()
            .filter(|(n, d)| *d == folder && n.starts_with(prefix) && n.ends_with(suffix))
            .map(|(n, _)| n)
            .collect();
        names.sort_by_key(|n| leftover_order(n, prefix, suffix));
        let excess = names.len().saturating_sub(keep);
        for name in &names[..excess] {
            let path = data_dir.join(name);
            let res = if folder {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_file(&path)
            };
            match res {
                Ok(()) => tracing::info!("removed {name} (older restore)"),
                Err(e) => tracing::warn!("cannot remove {name}: {e}"),
            }
        }
    }
}

/// How long the first move of a restore waits for a base still held.
const HELD_WAIT: Duration = Duration::from_secs(10);
const HELD_STEP: Duration = Duration::from_millis(250);

/// Windows: a file another process still holds (sharing violation, lock
/// violation, access denied). Never elsewhere.
fn held_by_another_process(e: &io::Error) -> bool {
    cfg!(windows)
        && (e.kind() == io::ErrorKind::PermissionDenied
            || matches!(e.raw_os_error(), Some(32 | 33)))
}

/// Runs `f` again every `step` while it fails with an error `retry`
/// accepts, for at most `total`.
fn retrying(
    mut f: impl FnMut() -> io::Result<()>,
    retry: impl Fn(&io::Error) -> bool,
    total: Duration,
    step: Duration,
) -> io::Result<()> {
    let start = Instant::now();
    loop {
        match f() {
            Err(e) if retry(&e) && start.elapsed() + step <= total => std::thread::sleep(step),
            res => return res,
        }
    }
}

/// Renames the staged archive `restore-failed-<stamp>.zip` (removed when it
/// cannot be); returns the name it is kept under.
fn fail_pending(data_dir: &Path, pending: &Path, stamp: &str) -> String {
    let failed = format!("restore-failed-{stamp}.zip");
    if std::fs::rename(pending, data_dir.join(&failed)).is_ok() {
        failed
    } else {
        let _ = std::fs::remove_file(pending);
        PENDING.into()
    }
}

/// After a crash while a restore was applied: committed (the archive left
/// `restore-pending.zip`, or is marked as applied) → nothing to undo;
/// otherwise the original data is put back from the folder aside, and the
/// archive set aside as failed (`Err`).
fn recover(
    data_dir: &Path,
    pending: &Path,
    stamp: &str,
    owner: Owner,
) -> Result<(), TransferError> {
    let marker = data_dir.join(IN_PROGRESS);
    let progress: Option<Progress> = std::fs::read(&marker)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok());
    let Some(progress) = progress else {
        tracing::error!("{IN_PROGRESS} unreadable; removed");
        let _ = std::fs::remove_file(&marker);
        return Ok(());
    };
    if !pending.is_file() || already_applied(data_dir, pending) {
        // Committed before the crash.
        let newer = read_restore_status(data_dir).is_some_and(|s| s.at >= progress.started_at);
        if !newer {
            write_status(
                data_dir,
                &RestoreStatus {
                    ok: true,
                    at: crate::ids::now_iso(),
                    archive: PENDING.into(),
                    error: None,
                    backup_created_at: None,
                    pending: None,
                },
                owner,
            );
        }
        let _ = std::fs::remove_file(&marker);
        return Ok(());
    }
    let plain = progress.aside.starts_with("before-restore-")
        && !progress.aside.contains(['/', '\\'])
        && !progress.aside.contains("..");
    let err = if plain {
        undo_restore(
            data_dir,
            &data_dir.join(&progress.aside),
            progress.phase,
            TransferError::Invalid(INTERRUPTED.into()),
        )
    } else {
        tracing::error!("{IN_PROGRESS}: invalid folder {}", progress.aside);
        TransferError::Invalid(INTERRUPTED.into())
    };
    let _ = std::fs::remove_file(&marker);
    let archive = fail_pending(data_dir, pending, stamp);
    write_status(
        data_dir,
        &RestoreStatus {
            ok: false,
            at: crate::ids::now_iso(),
            archive,
            error: Some(err.to_string()),
            backup_created_at: None,
            pending: None,
        },
        owner,
    );
    tracing::error!("{err}");
    Err(err)
}

/// A free `<data>/before-restore-<stamp>[-n]` folder.
fn aside_dir(data_dir: &Path, stamp: &str) -> PathBuf {
    let mut dir = data_dir.join(format!("before-restore-{stamp}"));
    let mut n = 1;
    while dir.exists() {
        dir = data_dir.join(format!("before-restore-{stamp}-{n}"));
        n += 1;
    }
    dir
}

/// Removes what is at `path` (a file, a symlink or a folder), if anything.
fn remove_any(path: &Path) -> io::Result<()> {
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => std::fs::remove_dir_all(path),
        Ok(_) => std::fs::remove_file(path),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Puts the original data back from `aside`: each item found there replaces
/// what is in place; while `Unpacking`, an item absent from `aside` (absent
/// before the restore) is removed. The emptied folder aside is removed.
/// Returns `false` when something could not be put back (or cleared).
fn put_back(data_dir: &Path, aside: &Path, phase: Phase) -> bool {
    let mut complete = true;
    for item in REPLACED {
        let (saved, target) = (aside.join(item), data_dir.join(item));
        let is_saved = std::fs::symlink_metadata(&saved).is_ok();
        if is_saved || phase == Phase::Unpacking {
            if let Err(e) = remove_any(&target) {
                tracing::error!("cannot clear {item} after a failed restore: {e}");
                complete = false;
            }
        }
        if is_saved {
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(e) = std::fs::rename(&saved, &target) {
                tracing::error!("cannot put {item} back from {}: {e}", aside.display());
                complete = false;
            }
        }
    }
    // Only empty folders are left (`backups/`).
    let _ = std::fs::remove_dir(aside.join("backups"));
    let _ = std::fs::remove_dir(aside);
    complete
}

/// [`put_back`], or [`TransferError::Stranded`] when the original data is
/// not all back in place (`failure` is only logged then).
fn undo_restore(
    data_dir: &Path,
    aside: &Path,
    phase: Phase,
    failure: TransferError,
) -> TransferError {
    if put_back(data_dir, aside, phase) {
        failure
    } else {
        tracing::error!("site restore failed ({failure}); the original data is not all back");
        TransferError::Stranded(aside.to_path_buf())
    }
}

fn apply(
    data_dir: &Path,
    pending: &Path,
    stamp: &str,
    owner: Owner,
) -> Result<(PathBuf, SiteManifest), TransferError> {
    let mut z = open(pending)?;
    let manifest = check(&mut z)?;
    let aside = aside_dir(data_dir, stamp);
    std::fs::create_dir(&aside).map_err(TransferError::Storage)?;
    owner.dirs(data_dir, &aside);
    let mut progress = Progress {
        aside: aside
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        phase: Phase::Moving,
        started_at: crate::ids::now_iso(),
    };
    let marker = data_dir.join(IN_PROGRESS);
    let undo = |phase: Phase, e: TransferError| {
        let e = undo_restore(data_dir, &aside, phase, e);
        let _ = std::fs::remove_file(&marker);
        e
    };
    if let Err(e) = write_json(&marker, &progress, owner) {
        let _ = std::fs::remove_dir(&aside);
        return Err(TransferError::Storage(e));
    }
    for item in REPLACED {
        let src = data_dir.join(item);
        if std::fs::symlink_metadata(&src).is_err() {
            continue;
        }
        let dest = aside.join(item);
        let res = match dest.parent() {
            Some(parent) => std::fs::create_dir_all(parent),
            None => Ok(()),
        }
        .and_then(|()| {
            if item == DB {
                // The first move: the base may still be held a moment by
                // the process that stopped (Windows).
                retrying(
                    || std::fs::rename(&src, &dest),
                    held_by_another_process,
                    HELD_WAIT,
                    HELD_STEP,
                )
            } else {
                std::fs::rename(&src, &dest)
            }
        });
        if let Err(e) = res {
            return Err(undo(Phase::Moving, TransferError::Storage(e)));
        }
    }
    progress.phase = Phase::Unpacking;
    if let Err(e) = write_json(&marker, &progress, owner) {
        return Err(undo(Phase::Moving, TransferError::Storage(e)));
    }
    if let Err(e) = unpack(&mut z, data_dir, owner) {
        return Err(undo(Phase::Unpacking, e));
    }
    Ok((aside, manifest))
}

/// Whether an entry of a site archive is restored (`manifest.json` and
/// unknown entries are not).
fn restored(name: &str) -> bool {
    name == DB
        || name == CONFIG
        || TREES
            .iter()
            .any(|t| name.strip_prefix(t).is_some_and(|r| r.starts_with('/')))
}

fn unpack(z: &mut ZipArchive<File>, data_dir: &Path, owner: Owner) -> Result<(), TransferError> {
    for i in 0..z.len() {
        let mut e = z.by_index(i).map_err(zip_err)?;
        let name = e.name().map_err(zip_err)?.to_string();
        if !restored(&name) {
            continue;
        }
        let rel = name.strip_suffix('/').unwrap_or(&name);
        if !safe_rel(rel) {
            return Err(bad());
        }
        let dest = data_dir.join(rel);
        if e.is_dir() {
            std::fs::create_dir_all(&dest).map_err(TransferError::Storage)?;
            owner.dirs(data_dir, &dest);
            continue;
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(TransferError::Storage)?;
            owner.dirs(data_dir, parent);
        }
        let size = e.size();
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest)
            .map_err(TransferError::Storage)?;
        owner.file(&file);
        let mut out = BufWriter::new(file);
        copy_entry(&mut e, size, &mut out)?;
        let file = out
            .into_inner()
            .map_err(|e| TransferError::Storage(e.into_error()))?;
        // On disk before the commit point.
        if name == DB || name == CONFIG {
            file.sync_all().map_err(TransferError::Storage)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_names_are_strict() {
        assert!(is_backup_name("Arkyo-site-20261108-030000.zip"));
        assert!(!is_backup_name("Arkyo-site-20261108-030000.zip.part"));
        assert!(!is_backup_name("Arkyo-site-2026110-030000.zip"));
        assert!(!is_backup_name("Arkyo-site-20261108_030000.zip"));
        assert!(!is_backup_name("../Arkyo-site-20261108-030000.zip"));
        assert!(!is_backup_name("Arkyo-site-2026110a-030000.zip"));
    }

    #[test]
    fn restored_entries() {
        assert!(restored("arkyo.db"));
        assert!(restored("config.json"));
        assert!(restored("uploads/a.png"));
        assert!(restored("backups/projects/p/x.arkyo"));
        assert!(!restored("manifest.json"));
        assert!(!restored("backups/site/x.zip"));
        assert!(!restored("uploadsx/a"));
        assert!(!restored("arkyo.db-wal"));
    }

    struct Full;

    impl Write for Full {
        fn write(&mut self, _: &[u8]) -> io::Result<usize> {
            Err(io::Error::other("disk full"))
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    struct Broken;

    impl Read for Broken {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::other("bad deflate"))
        }
    }

    #[test]
    fn copy_entry_tells_write_errors_from_read_errors() {
        let e = copy_entry(&mut &b"abc"[..], 3, &mut Full).unwrap_err();
        assert!(matches!(e, TransferError::Storage(_)), "{e:?}");
        let e = copy_entry(&mut Broken, 3, &mut Vec::new()).unwrap_err();
        assert!(
            matches!(&e, TransferError::Invalid(m) if m == "Archive invalide."),
            "{e:?}"
        );
        // Shorter or longer than declared.
        let e = copy_entry(&mut &b"ab"[..], 3, &mut Vec::new()).unwrap_err();
        assert!(matches!(e, TransferError::Invalid(_)), "{e:?}");
        let e = copy_entry(&mut &b"abcd"[..], 3, &mut Vec::new()).unwrap_err();
        assert!(matches!(e, TransferError::Invalid(_)), "{e:?}");
        let mut out = Vec::new();
        copy_entry(&mut &b"abc"[..], 3, &mut out).unwrap();
        assert_eq!(out, b"abc");
    }

    #[test]
    fn retrying_waits_only_for_the_errors_it_accepts() {
        let step = Duration::from_millis(1);
        let mut calls = 0;
        let res = retrying(
            || {
                calls += 1;
                if calls < 3 {
                    Err(io::Error::from(io::ErrorKind::PermissionDenied))
                } else {
                    Ok(())
                }
            },
            |e| e.kind() == io::ErrorKind::PermissionDenied,
            Duration::from_secs(1),
            step,
        );
        assert!(res.is_ok());
        assert_eq!(calls, 3);
        // Another error fails at once.
        let mut calls = 0;
        let res = retrying(
            || {
                calls += 1;
                Err(io::Error::from(io::ErrorKind::NotFound))
            },
            |e| e.kind() == io::ErrorKind::PermissionDenied,
            Duration::from_secs(1),
            step,
        );
        assert!(res.is_err());
        assert_eq!(calls, 1);
        // Up to the time allowed.
        let started = Instant::now();
        let res = retrying(
            || Err(io::Error::from(io::ErrorKind::PermissionDenied)),
            |_| true,
            Duration::from_millis(30),
            Duration::from_millis(5),
        );
        assert!(res.is_err());
        assert!(started.elapsed() < Duration::from_secs(1));
        // Only Windows waits for a held file.
        let held = io::Error::from(io::ErrorKind::PermissionDenied);
        assert_eq!(held_by_another_process(&held), cfg!(windows));
    }

    #[test]
    fn leftovers_sort_by_stamp_then_counter() {
        let p = "before-restore-";
        let mut v = [
            "before-restore-20261108-030000-10",
            "before-restore-20261108-030000-2",
            "before-restore-20261108-030000",
            "before-restore-20261107-230000",
        ];
        v.sort_by_key(|n| leftover_order(n, p, ""));
        assert_eq!(
            v,
            [
                "before-restore-20261107-230000",
                "before-restore-20261108-030000",
                "before-restore-20261108-030000-2",
                "before-restore-20261108-030000-10",
            ]
        );
    }

    #[test]
    fn settings_validation() {
        assert!(SiteSettings::default().is_valid());
        let bad_hour = SiteSettings {
            hour: 24,
            ..SiteSettings::default()
        };
        assert!(!bad_hour.is_valid());
        let relative = SiteSettings {
            dir: Some("backups".into()),
            ..SiteSettings::default()
        };
        assert!(!relative.is_valid());
        let blank = SiteSettings {
            dir: Some("  ".into()),
            ..SiteSettings::default()
        };
        assert_eq!(blank.normalized().dir, None);
    }
}
