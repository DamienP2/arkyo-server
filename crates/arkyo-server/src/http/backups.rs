//! System › Sauvegardes: export and import of `.arkyo` objects (spec
//! 2026-11-07-sauvegardes-design §4). Code proper to arkyo-server.
//!
//! - `POST /api/system/transfer/export` `{ roots: [{ kind, id }] }` → the
//!   archive, served from a temporary file removed once sent;
//! - `GET /api/system/transfer/objects` → what can be exported;
//! - `POST /api/system/transfer/inspect` (raw body = the file, streamed to
//!   `<data>/tmp/<token>.arkyo`) → `{ token, preview }`;
//! - `POST /api/system/transfer/import` `{ token, modes }` → the report.
//!
//! An inspected file is removed after its import or after an hour.
//!
//! Restore points of a project (§5), under `/api/system/backups/`:
//! `projects`, `projects/{id}/points` (list, create),
//! `projects/{id}/points/{pointId}` (delete, `restore`, `download`) and
//! `settings/projects`.
//!
//! Backups of the site (§6), under `/api/system/backups/`: `site` (list,
//! create), `site/{name}` (delete), `site/{name}/download`, `site/restore`
//! (raw body = the archive, checked, staged, then the server restarts),
//! `site/pending` (delete: cancels a staged restore) and `settings/site`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use arkyo_core::permissions::{Domain, Level};
use axum::body::{Body, Bytes};
use axum::extract::{Path as AxumPath, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::{error, require, server_error, AppState, CurrentUser};
use crate::ids::new_id;
use crate::transfer::archive::read_archive;
use crate::transfer::import::{export_to_file, import as run_import, preview, ImportOptions, Mode};
use crate::transfer::points::{self, Point, PointKind, ProjectSettings};
use crate::transfer::site::{self, SiteSettings};
use crate::transfer::{load_last_error, record_last_error, RemoveOnDrop, RootKind, TransferError};

/// Maximum size of an inspected file (2 Gio).
pub const MAX_INSPECT: usize = 2 * 1024 * 1024 * 1024;
/// Maximum size of a site backup sent for a restore (8 Gio).
pub const MAX_SITE_RESTORE: usize = 8 * 1024 * 1024 * 1024;
/// Lifetime of an inspected file not imported.
const TMP_TTL: Duration = Duration::from_secs(3600);
/// Age past which a file left `.importing` (a crash) is removed.
const STALE_IMPORT: Duration = Duration::from_secs(24 * 3600);
const EXPIRED: &str = "Fichier introuvable : choisissez-le à nouveau.";

fn tmp_dir(st: &AppState) -> PathBuf {
    st.data_dir.join("tmp")
}

/// What a database error means to the user, when it means something.
#[derive(Debug, PartialEq, Eq)]
enum DbFailure {
    /// Another writer holds the base (SQLITE_BUSY, SQLITE_LOCKED) or no
    /// connection is free.
    Busy,
    /// SQLITE_FULL.
    Full,
    /// A constraint the file breaks (SQLITE_CONSTRAINT).
    Constraint,
}

fn db_failure(e: &sqlx::Error) -> Option<DbFailure> {
    match e {
        sqlx::Error::PoolTimedOut => Some(DbFailure::Busy),
        sqlx::Error::Database(db) => {
            // Extended result codes keep the primary code in the low byte.
            let primary = db.code()?.parse::<i64>().ok()? & 0xff;
            match primary {
                5 | 6 => Some(DbFailure::Busy),
                13 => Some(DbFailure::Full),
                19 => Some(DbFailure::Constraint),
                _ => None,
            }
        }
        _ => None,
    }
}

fn transfer_error(e: TransferError) -> Response {
    let db = match &e {
        TransferError::Db(d) => db_failure(d),
        _ => None,
    };
    match (&e, db) {
        (TransferError::NotFound(..), _) => error(StatusCode::NOT_FOUND, &e.to_string()),
        (TransferError::Invalid(m), _) => error(StatusCode::BAD_REQUEST, m),
        (_, Some(DbFailure::Busy)) => {
            tracing::warn!("transfer: {e}");
            error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Serveur occupé, réessayez dans un instant.",
            )
        }
        (_, Some(DbFailure::Full)) => {
            tracing::error!("transfer: {e}");
            error(
                StatusCode::INSUFFICIENT_STORAGE,
                "Espace disque insuffisant.",
            )
        }
        // A constraint of the base the file breaks.
        (_, Some(DbFailure::Constraint)) => {
            tracing::warn!("transfer: {e}");
            error(
                StatusCode::BAD_REQUEST,
                "Le fichier ne peut pas être importé : ses données sont incohérentes.",
            )
        }
        (TransferError::Storage(io), _) => {
            tracing::error!("transfer: {e} ({io})");
            error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
        }
        _ => {
            tracing::error!("transfer: {e}");
            server_error()
        }
    }
}

/// `name` in ASCII for a file name: accents dropped, other characters
/// turned into `-`.
fn ascii_name(name: &str) -> String {
    use unicode_normalization::char::is_combining_mark;
    use unicode_normalization::UnicodeNormalization;
    let mut out = String::new();
    for c in name.nfd() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !is_combining_mark(c) && !out.ends_with('-') {
            out.push('-');
        }
    }
    let out: String = out.trim_matches('-').chars().take(80).collect();
    out.trim_end_matches('-').to_string()
}

// ── POST /api/system/transfer/export ───────────────────────────────────────

#[derive(Deserialize)]
struct RootRef {
    kind: RootKind,
    id: String,
}

#[derive(Deserialize)]
struct ExportBody {
    roots: Vec<RootRef>,
}

pub async fn export(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    body: Bytes,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let roots: Vec<(RootKind, String)> = match serde_json::from_slice::<ExportBody>(&body) {
        Ok(b) if !b.roots.is_empty() => b.roots.into_iter().map(|r| (r.kind, r.id)).collect(),
        _ => return error(StatusCode::BAD_REQUEST, "Choisissez au moins un objet."),
    };
    let dir = tmp_dir(&st);
    if tokio::fs::create_dir_all(&dir).await.is_err() {
        return server_error();
    }
    let path = dir.join(format!("{}.export", new_id()));
    let guard = RemoveOnDrop(path.clone());
    let manifest = match export_to_file(&st, &me, &roots, &path).await {
        Ok(m) => m,
        Err(e) => return transfer_error(e),
    };
    let base = match manifest.roots.as_slice() {
        [one] => ascii_name(&one.name),
        _ => String::new(),
    };
    let base = if base.is_empty() {
        "Arkyo-export".to_string()
    } else {
        base
    };
    let stamp = jiff::Zoned::now().strftime("%Y%m%d-%H%M").to_string();
    file_response(&path, &format!("{base}-{stamp}.arkyo"), Some(guard)).await
}

/// The file at `path` as a zip attachment named `name`, read in chunks;
/// `guard` (a temporary file) is dropped once the stream ends.
async fn file_response(path: &Path, name: &str, guard: Option<RemoveOnDrop>) -> Response {
    let file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(_) => return server_error(),
    };
    let len = file.metadata().await.map(|m| m.len()).ok();
    let stream = futures_util::stream::unfold((Some(file), guard), |(file, guard)| async move {
        let mut file = file?;
        let mut buf = vec![0u8; 64 * 1024];
        match file.read(&mut buf).await {
            Ok(0) => {
                drop(file);
                drop(guard);
                None
            }
            Ok(n) => {
                buf.truncate(n);
                Some((
                    Ok::<_, std::io::Error>(Bytes::from(buf)),
                    (Some(file), guard),
                ))
            }
            Err(e) => Some((Err(e), (None, guard))),
        }
    });
    let mut res = Response::new(Body::from_stream(stream));
    let headers = res.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/zip"),
    );
    if let Ok(v) = header::HeaderValue::from_str(&format!("attachment; filename=\"{name}\"")) {
        headers.insert(header::CONTENT_DISPOSITION, v);
    }
    if let Some(len) = len {
        headers.insert(header::CONTENT_LENGTH, header::HeaderValue::from(len));
    }
    res
}

// ── GET /api/system/transfer/objects ───────────────────────────────────────

async fn list(pool: &sqlx::SqlitePool, sql: &str) -> Result<Value, sqlx::Error> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(sql).fetch_all(pool).await?;
    Ok(Value::Array(
        rows.into_iter()
            .map(
                |(id, name, updated_at)| json!({ "id": id, "name": name, "updatedAt": updated_at }),
            )
            .collect(),
    ))
}

pub async fn objects(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let order = r#"ORDER BY "updatedAt" DESC, "id" DESC"#;
    let queries = [
        format!(r#"SELECT "id", "name", "updatedAt" FROM "Project" {order}"#),
        // The container library: the racks no project rig uses (the filter
        // of `GET /api/racks?templates=true`, http/racks.rs).
        r#"SELECT r."id", r."name", r."updatedAt" FROM "Rack" r
               WHERE NOT EXISTS (SELECT 1 FROM "RigRack" rr JOIN "RigConfig" g ON g."id" = rr."rigConfigId"
                                 WHERE rr."rackId" = r."id" AND g."projectId" IS NOT NULL)
               ORDER BY r."updatedAt" DESC, r."id" DESC"#
            .to_string(),
        format!(
            r#"SELECT "id", "name", "updatedAt" FROM "RigConfig"
               WHERE "isTemplate" = 1 AND "projectId" IS NULL {order}"#
        ),
        format!(r#"SELECT "id", "name", "updatedAt" FROM "Panel" {order}"#),
    ];
    let mut out = serde_json::Map::new();
    for (key, sql) in ["projects", "racks", "rigs", "panels"].iter().zip(queries) {
        match list(&st.pool, &sql).await {
            Ok(v) => {
                out.insert((*key).to_string(), v);
            }
            Err(e) => {
                tracing::error!("transfer objects: {e}");
                return server_error();
            }
        }
    }
    Json(Value::Object(out)).into_response()
}

// ── POST /api/system/transfer/inspect ──────────────────────────────────────

/// Removes the temporary files older than [`TMP_TTL`] (left by a restart):
/// inspected files (`.arkyo`), exports (`.export`) and the bases copied by
/// a site backup or a check (`site-*.db`, `verify-*.db`; the age counts
/// from the last write). A file being
/// imported (`.importing`) or a site backup being received (`.site`) is
/// only removed after [`STALE_IMPORT`], far beyond any import or upload
/// (left by a crash).
fn sweep(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok());
        let name = entry.file_name().to_string_lossy().into_owned();
        let ttl = match path.extension().and_then(|e| e.to_str()) {
            Some("arkyo" | "export") => TMP_TTL,
            Some("db") if name.starts_with("site-") || name.starts_with("verify-") => TMP_TTL,
            Some("importing" | "site") => STALE_IMPORT,
            _ => continue,
        };
        if old.is_some_and(|age| age > ttl) {
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// Streams the body to `path`; `Err(response)` (the file removed) when it
/// breaks or exceeds `max` bytes.
#[allow(clippy::result_large_err)]
async fn receive(body: Body, path: &Path, max: usize) -> Result<(), Response> {
    let fail = |r: Response| {
        let _ = std::fs::remove_file(path);
        r
    };
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|_| server_error())?;
    let mut stream = body.into_data_stream();
    let mut total: usize = 0;
    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else {
            return Err(fail(error(StatusCode::BAD_REQUEST, "Envoi interrompu.")));
        };
        total = total.saturating_add(chunk.len());
        if total > max {
            return Err(fail(error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Fichier trop volumineux.",
            )));
        }
        if file.write_all(&chunk).await.is_err() {
            return Err(fail(server_error()));
        }
    }
    if file.flush().await.is_err() {
        return Err(fail(server_error()));
    }
    Ok(())
}

pub async fn inspect(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    body: Body,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let dir = tmp_dir(&st);
    if tokio::fs::create_dir_all(&dir).await.is_err() {
        return server_error();
    }
    sweep(&dir);
    let token = new_id();
    let path = dir.join(format!("{token}.arkyo"));
    if let Err(r) = receive(body, &path, MAX_INSPECT).await {
        return r;
    }
    let read = {
        let path = path.clone();
        tokio::task::spawn_blocking(move || read_archive(&path)).await
    };
    let (manifest, bundle) = match read {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => {
            let _ = std::fs::remove_file(&path);
            return transfer_error(e);
        }
        Err(_) => {
            let _ = std::fs::remove_file(&path);
            return server_error();
        }
    };
    let preview = match preview(&st.pool, &bundle, &manifest).await {
        Ok(p) => p,
        Err(e) => {
            let _ = std::fs::remove_file(&path);
            return transfer_error(e);
        }
    };
    let later = path.clone();
    tokio::spawn(async move {
        tokio::time::sleep(TMP_TTL).await;
        let _ = std::fs::remove_file(later);
    });
    Json(json!({ "token": token, "preview": preview })).into_response()
}

// ── POST /api/system/transfer/import ───────────────────────────────────────

#[derive(Deserialize)]
struct ImportBody {
    token: String,
    #[serde(default)]
    modes: HashMap<String, Mode>,
}

pub async fn import(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    body: Bytes,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let Ok(b) = serde_json::from_slice::<ImportBody>(&body) else {
        return error(StatusCode::BAD_REQUEST, "Requête invalide.");
    };
    let plain = !b.token.is_empty()
        && b.token.len() <= 64
        && b.token.chars().all(|c| c.is_ascii_alphanumeric());
    if !plain {
        return error(StatusCode::BAD_REQUEST, EXPIRED);
    }
    // The token is consumed atomically: a concurrent import of the same
    // file finds nothing, and the sweep leaves an `.importing` file alone.
    let ready = tmp_dir(&st).join(format!("{}.arkyo", b.token));
    let busy = ready.with_extension("importing");
    if tokio::fs::rename(&ready, &busy).await.is_err() {
        return error(StatusCode::BAD_REQUEST, EXPIRED);
    }
    match run_import(&st, &me, &busy, ImportOptions { modes: b.modes }).await {
        Ok(report) => {
            let _ = tokio::fs::remove_file(&busy).await;
            Json(report).into_response()
        }
        Err(e) => {
            // Kept for another try (other modes), until its hour is up.
            let _ = tokio::fs::rename(&busy, &ready).await;
            transfer_error(e)
        }
    }
}

// ── Restore points (§5) ─────────────────────────────────────────────────────

const NO_POINT: &str = "Point de restauration introuvable";
const BAD_SETTINGS: &str = "Paramètres invalides";

fn no_point() -> Response {
    error(StatusCode::NOT_FOUND, NO_POINT)
}

async fn find(st: &AppState, project_id: &str, point_id: &str) -> Option<(Point, PathBuf)> {
    let (dir, project_id, point_id) = (
        st.data_dir.clone(),
        project_id.to_string(),
        point_id.to_string(),
    );
    tokio::task::spawn_blocking(move || points::find_point(&dir, &project_id, &point_id))
        .await
        .ok()
        .flatten()
}

/// `GET /api/system/backups/projects`: the existing projects and the
/// deleted ones that have points, `{ id, name, deleted, lastPoint, count }`.
pub async fn point_projects(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let existing: Vec<(String, String)> =
        match sqlx::query_as(r#"SELECT "id", "name" FROM "Project""#)
            .fetch_all(&st.pool)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                tracing::error!("restore points: {e}");
                return server_error();
            }
        };
    let dir = st.data_dir.clone();
    let Ok(with_points) = tokio::task::spawn_blocking(move || points::list_projects(&dir)).await
    else {
        return server_error();
    };
    let mut by_id: HashMap<String, points::ProjectPoints> =
        with_points.into_iter().map(|p| (p.id.clone(), p)).collect();
    let mut out: Vec<(String, Value)> = Vec::new();
    for (id, name) in existing {
        let p = by_id.remove(&id);
        let entry = json!({
            "id": id,
            "name": name,
            "deleted": false,
            "lastPoint": p.as_ref().and_then(|p| p.last_point.clone()),
            "count": p.as_ref().map_or(0, |p| p.count),
        });
        out.push((name.to_lowercase(), entry));
    }
    for p in by_id.into_values() {
        let entry = json!({
            "id": p.id,
            "name": p.name,
            "deleted": true,
            "lastPoint": p.last_point,
            "count": p.count,
        });
        out.push((p.name.to_lowercase(), entry));
    }
    out.sort_by(|a, b| (&a.0, a.1["id"].as_str()).cmp(&(&b.0, b.1["id"].as_str())));
    Json(Value::Array(out.into_iter().map(|(_, v)| v).collect())).into_response()
}

/// `GET /api/system/backups/projects/{id}/points`: newest first.
pub async fn point_list(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    AxumPath(id): AxumPath<String>,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let dir = st.data_dir.clone();
    match tokio::task::spawn_blocking(move || points::list_points(&dir, &id)).await {
        Ok(list) => Json(list).into_response(),
        Err(_) => server_error(),
    }
}

#[derive(Deserialize, Default)]
struct PointBody {
    #[serde(default)]
    label: Option<String>,
}

/// `POST /api/system/backups/projects/{id}/points` `{ label? }`: a manual
/// point.
pub async fn point_create(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    AxumPath(id): AxumPath<String>,
    body: Bytes,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let b = if body.iter().all(u8::is_ascii_whitespace) {
        PointBody::default()
    } else {
        match serde_json::from_slice::<PointBody>(&body) {
            Ok(b) => b,
            Err(_) => return error(StatusCode::BAD_REQUEST, "Requête invalide."),
        }
    };
    let label = b
        .label
        .map(|l| l.trim().chars().take(points::MAX_LABEL).collect::<String>())
        .filter(|l| !l.is_empty());
    if points::project_dir(&st, &id).is_err() {
        return error(StatusCode::NOT_FOUND, "Projet introuvable");
    }
    let author = Some(points::author_of(&me));
    match points::create_point(&st, &id, PointKind::Manual, label, author).await {
        Ok(Some(p)) => Json(p).into_response(),
        Ok(None) => server_error(),
        Err(e) => transfer_error(e),
    }
}

/// `POST …/points/{pointId}/restore`: the project is replaced by the point
/// (after a point « avant restauration », taken by the import), or
/// recreated when it was deleted.
pub async fn point_restore(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    AxumPath((id, point_id)): AxumPath<(String, String)>,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let Some((_, path)) = find(&st, &id, &point_id).await else {
        return no_point();
    };
    // Imported from a link of its own: a retention pass may remove the
    // point meanwhile.
    let dir = tmp_dir(&st);
    if tokio::fs::create_dir_all(&dir).await.is_err() {
        return server_error();
    }
    let busy = dir.join(format!("{}.importing", new_id()));
    let _guard = RemoveOnDrop(busy.clone());
    if std::fs::hard_link(&path, &busy).is_err() && std::fs::copy(&path, &busy).is_err() {
        return no_point();
    }
    let opts = ImportOptions {
        modes: HashMap::from([(id, Mode::Replace)]),
    };
    match run_import(&st, &me, &busy, opts).await {
        Ok(report) => Json(report).into_response(),
        Err(e) => transfer_error(e),
    }
}

/// `GET …/points/{pointId}/download`: the point as a self-contained
/// `.arkyo` file, its rows with the files they reference taken from
/// `<data>/uploads` (a point keeps rows only), written to a temporary file
/// removed once sent.
pub async fn point_download(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    AxumPath((id, point_id)): AxumPath<(String, String)>,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let Some((point, path)) = find(&st, &id, &point_id).await else {
        return no_point();
    };
    let dir = tmp_dir(&st);
    if tokio::fs::create_dir_all(&dir).await.is_err() {
        return server_error();
    }
    let out = dir.join(format!("{}.export", new_id()));
    let guard = RemoveOnDrop(out.clone());
    let (uploads, packed) = (st.data_dir.join("uploads"), out.clone());
    let repacked = tokio::task::spawn_blocking(move || {
        crate::transfer::archive::repack_with_uploads(&path, &uploads, &packed)
    })
    .await;
    match repacked {
        Ok(Ok(_)) => {}
        // Removed meanwhile (retention).
        Ok(Err(TransferError::Io(e))) if e.kind() == std::io::ErrorKind::NotFound => {
            return no_point()
        }
        Ok(Err(e)) => return transfer_error(e),
        Err(_) => return server_error(),
    }
    let base = ascii_name(&point.project_name);
    let base = if base.is_empty() {
        "Arkyo-projet".into()
    } else {
        base
    };
    file_response(&out, &format!("{base}-{}.arkyo", point.id), Some(guard)).await
}

/// `DELETE …/points/{pointId}`.
pub async fn point_delete(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    AxumPath((id, point_id)): AxumPath<(String, String)>,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    match points::delete_point(&st, &id, &point_id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => no_point(),
        Err(e) => transfer_error(e),
    }
}

/// `GET /api/system/backups/settings/projects`: the settings and
/// `lastError`, the last failure of the automatic points (or `null`).
pub async fn point_settings(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let settings = points::load_settings(&st.pool).await;
    let mut v = serde_json::to_value(settings).unwrap_or_default();
    v["lastError"] = json!(load_last_error(&st.pool, points::SETTINGS_KEY).await);
    Json(v).into_response()
}

/// `PUT /api/system/backups/settings/projects` `{ enabled, intervalHours,
/// keep }` → the settings.
pub async fn set_point_settings(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    body: Bytes,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let s = match serde_json::from_slice::<ProjectSettings>(&body) {
        Ok(s) if s.is_valid() => s,
        _ => return error(StatusCode::BAD_REQUEST, BAD_SETTINGS),
    };
    match points::save_settings(&st.pool, &s).await {
        Ok(()) => Json(s).into_response(),
        Err(e) => {
            tracing::error!("restore points settings: {e}");
            server_error()
        }
    }
}

// ── Backups of the site (§6) ─────────────────────────────────────────────────

const NO_BACKUP: &str = "Sauvegarde introuvable";
const BAD_DIR: &str = "Dossier inaccessible";

/// `GET /api/system/backups/site`: `{ settings, backups, dir, lastRestore,
/// lastError, pending }`, the backups newest first, `lastRestore` the
/// outcome of the last restore applied at startup, `lastError` the last
/// failure of the automatic backups, `pending` a restore staged for the
/// next start (each `null` when none).
pub async fn site_list(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let settings = site::load_settings(&st.pool).await;
    let last_error = load_last_error(&st.pool, site::SETTINGS_KEY).await;
    let dir = site::backup_dir(&st.data_dir, &settings);
    let (listed, data_dir) = (dir.clone(), st.data_dir.clone());
    let Ok((backups, last, pending)) = tokio::task::spawn_blocking(move || {
        (
            site::list_site_backups(&listed),
            site::read_restore_status(&data_dir),
            site::pending_restore(&data_dir),
        )
    })
    .await
    else {
        return server_error();
    };
    Json(json!({
        "settings": settings,
        "backups": backups,
        "dir": dir.to_string_lossy(),
        "lastRestore": last,
        "lastError": last_error,
        "pending": pending,
    }))
    .into_response()
}

/// `DELETE /api/system/backups/site/pending`: cancels the staged restore.
pub async fn site_cancel_pending(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let data_dir = st.data_dir.clone();
    match tokio::task::spawn_blocking(move || site::cancel_pending_restore(&data_dir)).await {
        Ok(Ok(true)) => {
            tracing::info!("staged site restore cancelled");
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(Ok(false)) => error(StatusCode::NOT_FOUND, "Aucune restauration en attente"),
        Ok(Err(e)) => {
            tracing::error!("cannot cancel the staged restore: {e}");
            server_error()
        }
        Err(_) => server_error(),
    }
}

/// `POST /api/system/backups/site`: a backup now, in the folder of the
/// settings (retention applied) → the backup.
pub async fn site_create(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let settings = site::load_settings(&st.pool).await;
    sweep_all(&st, &settings).await;
    match site::run_backup(&st, &settings).await {
        Ok(b) => {
            // The folder works again: the last automatic failure is over.
            record_last_error(&st.pool, site::SETTINGS_KEY, None).await;
            Json(b).into_response()
        }
        Err(e) => transfer_error(e),
    }
}

/// Removes the stale temporaries of `<data>/tmp`, of the backup folder and
/// a stale `restore-pending.zip.part`.
async fn sweep_all(st: &AppState, settings: &SiteSettings) {
    let (tmp, data_dir) = (tmp_dir(st), st.data_dir.clone());
    let backups = site::backup_dir(&st.data_dir, settings);
    let _ = tokio::task::spawn_blocking(move || {
        sweep(&tmp);
        site::sweep_stale(&data_dir, &backups);
    })
    .await;
}

/// The file of the backup `name` in the folder of the settings.
async fn site_file(st: &AppState, name: &str) -> Option<PathBuf> {
    if !site::is_backup_name(name) {
        return None;
    }
    let settings = site::load_settings(&st.pool).await;
    let path = site::backup_dir(&st.data_dir, &settings).join(name);
    let is_file = tokio::fs::metadata(&path).await.is_ok_and(|m| m.is_file());
    is_file.then_some(path)
}

/// `GET /api/system/backups/site/{name}/download`.
pub async fn site_download(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    AxumPath(name): AxumPath<String>,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    match site_file(&st, &name).await {
        Some(path) => file_response(&path, &name, None).await,
        None => error(StatusCode::NOT_FOUND, NO_BACKUP),
    }
}

/// `DELETE /api/system/backups/site/{name}`.
pub async fn site_delete(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    AxumPath(name): AxumPath<String>,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let Some(path) = site_file(&st, &name).await else {
        return error(StatusCode::NOT_FOUND, NO_BACKUP);
    };
    match tokio::fs::remove_file(&path).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            error(StatusCode::NOT_FOUND, NO_BACKUP)
        }
        Err(e) => {
            tracing::error!("site backup delete: {e}");
            server_error()
        }
    }
}

/// `PUT /api/system/backups/settings/site` `{ enabled, hour, dir, keep }`
/// → the settings. A folder set must be an absolute path to an existing
/// folder the server can write in (« Dossier inaccessible »), outside the
/// saved data; blank means the default.
pub async fn set_site_settings(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    body: Bytes,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let Ok(s) = serde_json::from_slice::<SiteSettings>(&body).map(SiteSettings::normalized) else {
        return error(StatusCode::BAD_REQUEST, BAD_SETTINGS);
    };
    if s.hour >= 24 || !(1..=1000).contains(&s.keep) {
        return error(StatusCode::BAD_REQUEST, BAD_SETTINGS);
    }
    if let Some(dir) = s.dir.clone() {
        let data_dir = st.data_dir.clone();
        let checked = tokio::task::spawn_blocking(move || site::check_dir(&data_dir, &dir))
            .await
            .unwrap_or(Err(BAD_DIR));
        if let Err(msg) = checked {
            return error(StatusCode::BAD_REQUEST, msg);
        }
    }
    if !s.is_valid() {
        return error(StatusCode::BAD_REQUEST, BAD_SETTINGS);
    }
    match site::save_settings(&st.pool, &s).await {
        Ok(()) => Json(s).into_response(),
        Err(e) => {
            tracing::error!("site backup settings: {e}");
            server_error()
        }
    }
}

/// `POST /api/system/backups/site/restore` (raw body = the archive, at
/// most 8 Gio): checked, staged as `<data>/restore-pending.zip`, then the
/// server restarts to apply it (as after an update) → `{ restarting: true }`,
/// with a `warning` when the base comes from a newer version (opened under
/// the additive rule).
pub async fn site_restore(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    body: Body,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let dir = tmp_dir(&st);
    if tokio::fs::create_dir_all(&dir).await.is_err() {
        return server_error();
    }
    sweep_all(&st, &site::load_settings(&st.pool).await).await;
    let path = dir.join(format!("{}.site", new_id()));
    let _guard = RemoveOnDrop(path.clone());
    if let Err(r) = receive(body, &path, MAX_SITE_RESTORE).await {
        return r;
    }
    let data_dir = st.data_dir.clone();
    let staged =
        tokio::task::spawn_blocking(move || site::stage_restore_moving(&data_dir, &path)).await;
    match staged {
        Ok(Ok(m)) => {
            let mut res = json!({ "restarting": true });
            if m.migration > crate::db::latest_migration() {
                tracing::warn!(
                    app_version = m.app_version,
                    "the site backup comes from a newer version; restored under the additive rule"
                );
                res["warning"] = json!(site::NEWER);
            }
            tracing::info!("site restore staged; restarting");
            crate::update::restart_soon();
            Json(res).into_response()
        }
        Ok(Err(e)) => transfer_error(e),
        Err(_) => server_error(),
    }
}

#[cfg(test)]
mod tests {
    use super::{ascii_name, db_failure, sweep, DbFailure};
    use std::time::{Duration, SystemTime};

    /// The errors SQLite really returns, classified.
    #[tokio::test]
    async fn database_errors_are_told_apart() {
        use sqlx::sqlite::SqliteConnectOptions;
        use sqlx::{ConnectOptions, Connection};
        let d = tempfile::tempdir().unwrap();
        let opts = SqliteConnectOptions::new()
            .filename(d.path().join("t.db"))
            .create_if_missing(true)
            .busy_timeout(Duration::ZERO);
        let mut a = opts.connect().await.unwrap();
        let mut b = opts.connect().await.unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, v BLOB)")
            .execute(&mut a)
            .await
            .unwrap();
        sqlx::query("INSERT INTO t (id) VALUES (1)")
            .execute(&mut a)
            .await
            .unwrap();
        // A primary key taken.
        let e = sqlx::query("INSERT INTO t (id) VALUES (1)")
            .execute(&mut a)
            .await
            .unwrap_err();
        assert_eq!(db_failure(&e), Some(DbFailure::Constraint), "{e}");
        // Another writer holds the base.
        sqlx::query("BEGIN IMMEDIATE")
            .execute(&mut a)
            .await
            .unwrap();
        let e = sqlx::query("BEGIN IMMEDIATE")
            .execute(&mut b)
            .await
            .unwrap_err();
        assert_eq!(db_failure(&e), Some(DbFailure::Busy), "{e}");
        sqlx::query("ROLLBACK").execute(&mut a).await.unwrap();
        // The base may not grow.
        sqlx::query("PRAGMA max_page_count = 3")
            .execute(&mut a)
            .await
            .unwrap();
        let e = sqlx::query("INSERT INTO t (id, v) VALUES (2, zeroblob(1000000))")
            .execute(&mut a)
            .await
            .unwrap_err();
        assert_eq!(db_failure(&e), Some(DbFailure::Full), "{e}");
        assert_eq!(
            db_failure(&sqlx::Error::PoolTimedOut),
            Some(DbFailure::Busy)
        );
        assert_eq!(db_failure(&sqlx::Error::RowNotFound), None);
        let _ = a.close().await;
        let _ = b.close().await;
    }

    #[test]
    fn sweep_removes_stale_temporaries_but_not_an_import_in_progress() {
        let dir = tempfile::tempdir().unwrap();
        let old = SystemTime::now() - Duration::from_secs(2 * 3600);
        for (name, stale) in [
            ("a.arkyo", true),
            ("b.export", true),
            ("c.importing", true),
            ("d.arkyo", false),
        ] {
            let path = dir.path().join(name);
            let f = std::fs::File::create(&path).unwrap();
            if stale {
                f.set_modified(old).unwrap();
            }
        }
        sweep(dir.path());
        let mut left: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(left, ["c.importing", "d.arkyo"]);
    }

    #[test]
    fn file_names_are_plain_ascii() {
        assert_eq!(ascii_name("Régie 1"), "Regie-1");
        assert_eq!(ascii_name("  Match / Finale  "), "Match-Finale");
        assert_eq!(ascii_name("Ça été « bien »"), "Ca-ete-bien");
        assert_eq!(ascii_name("日本"), "");
    }
}
