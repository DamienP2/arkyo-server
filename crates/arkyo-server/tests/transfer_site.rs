//! Sauvegardes, Task 5: full backup of the site, restore at startup and CLI
//! (spec 2026-11-07-sauvegardes-design §6).
mod common;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use arkyo_server::transfer::archive::write_archive;
use arkyo_server::transfer::site::{
    apply_pending_restore, create_site_backup, is_due, list_site_backups, prune_site_backups,
    read_restore_status, run_recorded, save_settings, stage_restore, verify_site_archive,
    SiteManifest, SiteSettings, PENDING,
};
use arkyo_server::transfer::{Bundle, TransferError};
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;
use zip::write::SimpleFileOptions;

const NOW: &str = "2026-11-07T10:00:00.000Z";

fn is_backup_name(name: &str) -> bool {
    let Some(rest) = name
        .strip_prefix("Arkyo-site-")
        .and_then(|r| r.strip_suffix(".zip"))
    else {
        return false;
    };
    let b = rest.as_bytes();
    b.len() == 15
        && b[8] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 8 || c.is_ascii_digit())
}

async fn add_project(pool: &SqlitePool, id: &str, name: &str, user: &str) {
    sqlx::query(
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES (?,?,?,?,?)"#,
    )
    .bind(id)
    .bind(name)
    .bind(user)
    .bind(NOW)
    .bind(NOW)
    .execute(pool)
    .await
    .unwrap();
}

fn write(path: &Path, bytes: &[u8]) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

fn entries(zip: &Path) -> Vec<String> {
    let z = zip::ZipArchive::new(std::fs::File::open(zip).unwrap()).unwrap();
    let mut v: Vec<String> = z.file_names().map(|n| n.unwrap().into_owned()).collect();
    v.sort();
    v
}

fn entry(zip: &Path, name: &str) -> Vec<u8> {
    let mut z = zip::ZipArchive::new(std::fs::File::open(zip).unwrap()).unwrap();
    let mut out = Vec::new();
    z.by_name(name).unwrap().read_to_end(&mut out).unwrap();
    out
}

/// Opens a SQLite file read-only (a copy extracted from an archive).
async fn open_ro(path: &Path) -> SqlitePool {
    let opts = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(path)
        .read_only(true);
    sqlx::SqlitePool::connect_with(opts).await.unwrap()
}

/// A data directory with a base, uploads, `config.json` and a point.
async fn populated() -> (Env, String) {
    let e = env().await;
    let owner = add_user(&e.pool, "o@b.fr", "owner", false).await;
    add_project(&e.pool, "cp1000000000000000000000000", "Match", &owner.id).await;
    let d = e._dir.path();
    write(&d.join("uploads/projects/plan.png"), b"PNG");
    write(&d.join("config.json"), br#"{"port":9100,"bind":"0.0.0.0"}"#);
    write(
        &d.join("backups/projects/cp1000000000000000000000000/20261107-100000-auto.arkyo"),
        b"POINT",
    );
    (e, owner.id)
}

#[tokio::test]
async fn site_backup_contains_db_uploads_config_points() {
    let (e, _) = populated().await;
    let out = tempfile::tempdir().unwrap();
    let b = create_site_backup(&e.pool, e._dir.path(), out.path())
        .await
        .unwrap();
    assert!(is_backup_name(&b.name), "{}", b.name);
    let path = out.path().join(&b.name);
    assert_eq!(b.size, std::fs::metadata(&path).unwrap().len());
    assert!(b.created_at.ends_with('Z'), "{}", b.created_at);
    // Only the archive: the `.part` was renamed.
    assert_eq!(std::fs::read_dir(out.path()).unwrap().count(), 1);
    assert_eq!(
        entries(&path),
        [
            "arkyo.db",
            "backups/projects/cp1000000000000000000000000/20261107-100000-auto.arkyo",
            "config.json",
            "manifest.json",
            "uploads/projects/plan.png",
        ]
    );
    let m: Value = serde_json::from_slice(&entry(&path, "manifest.json")).unwrap();
    assert_eq!(m["format"], "arkyo-server-site");
    assert_eq!(m["version"], 1);
    assert_eq!(m["appVersion"], env!("CARGO_PKG_VERSION"));
    assert_eq!(m["migration"], arkyo_server::db::latest_migration());
    assert!(m["createdAt"].as_str().unwrap().ends_with('Z'));
    assert_eq!(entry(&path, "uploads/projects/plan.png"), b"PNG");
    assert_eq!(
        entry(&path, "config.json"),
        br#"{"port":9100,"bind":"0.0.0.0"}"#
    );

    // The base is a real copy.
    let x = tempfile::tempdir().unwrap();
    let db = x.path().join("arkyo.db");
    std::fs::write(&db, entry(&path, "arkyo.db")).unwrap();
    let pool = open_ro(&db).await;
    let name: String = sqlx::query_scalar(r#"SELECT "name" FROM "Project""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(name, "Match");

    let manifest = verify(&path).unwrap();
    assert_eq!(manifest.format, "arkyo-server-site");
    assert_eq!(manifest.migration, arkyo_server::db::latest_migration());
}

#[tokio::test]
async fn site_backup_db_is_consistent_while_writing() {
    let (e, owner) = populated().await;
    let pool = e.pool.clone();
    let writer = tokio::spawn(async move {
        for i in 0..300 {
            add_project(&pool, &format!("cw{i:025}"), &format!("P{i}"), &owner).await;
        }
    });
    let out = tempfile::tempdir().unwrap();
    let b = create_site_backup(&e.pool, e._dir.path(), out.path())
        .await
        .unwrap();
    writer.await.unwrap();
    let x = tempfile::tempdir().unwrap();
    let db = x.path().join("arkyo.db");
    std::fs::write(&db, entry(&out.path().join(&b.name), "arkyo.db")).unwrap();
    let pool = open_ro(&db).await;
    let check: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(check, "ok");
    let n: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "Project""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!((1..=301).contains(&n), "{n}");
}

/// A zip made of `(name, bytes)` entries.
fn zip_of(path: &Path, files: &[(&str, &[u8])]) {
    let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    for (name, bytes) in files {
        z.start_file(*name, SimpleFileOptions::default()).unwrap();
        z.write_all(bytes).unwrap();
    }
    z.finish().unwrap();
}

fn site_manifest() -> Vec<u8> {
    json!({
        "format": "arkyo-server-site",
        "version": 1,
        "appVersion": "0.1.0",
        "createdAt": NOW,
        "migration": 1
    })
    .to_string()
    .into_bytes()
}

/// Checks an archive with a work folder of its own.
fn verify(path: &Path) -> Result<SiteManifest, TransferError> {
    let work = tempfile::tempdir().unwrap();
    verify_site_archive(path, work.path())
}

fn invalid(r: Result<SiteManifest, TransferError>) -> String {
    match r {
        Err(TransferError::Invalid(m)) => m,
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn verify_rejects_project_archive_and_garbage() {
    let (e, _) = populated().await;
    let d = tempfile::tempdir().unwrap();

    // A `.arkyo` export.
    let export = d.path().join("p.arkyo");
    write_archive(&Bundle::default(), None, d.path(), &export).unwrap();
    let m = invalid(verify(&export));
    assert_eq!(
        m,
        "Ce fichier n'est pas une sauvegarde du site Strata Arkyo."
    );

    // Not a zip.
    let garbage = d.path().join("g.zip");
    std::fs::write(&garbage, b"not a zip at all").unwrap();
    assert_eq!(invalid(verify(&garbage)), "Archive invalide.");

    // A site manifest, but no base / a base that is not SQLite.
    let no_db = d.path().join("n.zip");
    zip_of(&no_db, &[("manifest.json", &site_manifest())]);
    assert_eq!(invalid(verify(&no_db)), "Archive invalide.");
    let bad_db = d.path().join("b.zip");
    zip_of(
        &bad_db,
        &[
            ("manifest.json", &site_manifest()),
            ("arkyo.db", b"SQLite? no"),
        ],
    );
    assert_eq!(invalid(verify(&bad_db)), "Archive invalide.");

    // An unsafe path.
    let out = tempfile::tempdir().unwrap();
    let good = create_site_backup(&e.pool, e._dir.path(), out.path())
        .await
        .unwrap();
    let good_db = entry(&out.path().join(&good.name), "arkyo.db");
    let slip = d.path().join("s.zip");
    zip_of(
        &slip,
        &[
            ("manifest.json", &site_manifest()),
            ("arkyo.db", &good_db),
            ("uploads/../../evil", b"x"),
        ],
    );
    assert_eq!(invalid(verify(&slip)), "Archive invalide.");

    // A newer format.
    let newer = d.path().join("v.zip");
    let mut m: Value = serde_json::from_slice(&site_manifest()).unwrap();
    m["version"] = json!(2);
    zip_of(
        &newer,
        &[
            ("manifest.json", m.to_string().as_bytes()),
            ("arkyo.db", &good_db),
        ],
    );
    assert_eq!(
        invalid(verify(&newer)),
        "Cette sauvegarde vient d'une version plus récente de Strata Arkyo."
    );

    // Staging refuses it too, and leaves nothing.
    assert!(stage_restore(e._dir.path(), &garbage).is_err());
    assert!(!e._dir.path().join(PENDING).exists());
}

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    v.sort();
    v
}

fn aside(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    names(dir)
        .into_iter()
        .filter(|n| n.starts_with(prefix))
        .map(|n| dir.join(n))
        .collect()
}

#[tokio::test]
async fn apply_pending_restore_swaps_data_and_keeps_old() {
    let (e, owner) = populated().await;
    let d = e._dir.path().to_path_buf();
    let out = tempfile::tempdir().unwrap();
    let b = create_site_backup(&e.pool, &d, out.path()).await.unwrap();

    // Changes after the backup.
    add_project(&e.pool, "cp2000000000000000000000000", "Après", &owner).await;
    write(&d.join("uploads/projects/after.png"), b"NEW");
    write(&d.join("config.json"), br#"{"port":9200}"#);
    std::fs::remove_dir_all(d.join("backups/projects")).unwrap();
    write(&d.join("backups/site/keep.txt"), b"kept");

    let m = stage_restore(&d, &out.path().join(&b.name)).unwrap();
    assert_eq!(m.format, "arkyo-server-site");
    assert!(d.join(PENDING).is_file());
    // The archive given is copied, not moved.
    assert!(out.path().join(&b.name).is_file());

    e.pool.close().await;
    assert!(apply_pending_restore(&d).unwrap());
    assert!(!d.join(PENDING).exists());
    // The commit point: the archive is kept as `restore-applied-…`, the
    // marker is gone and the outcome recorded.
    let applied = aside(&d, "restore-applied-");
    assert_eq!(applied.len(), 1, "{:?}", names(&d));
    assert!(!d.join("restore-in-progress.json").exists());
    let status = read_restore_status(&d).unwrap();
    assert!(status.ok);
    assert_eq!(
        status.archive,
        applied[0].file_name().unwrap().to_str().unwrap()
    );
    assert_eq!(
        status.backup_created_at.as_deref(),
        Some(m.created_at.as_str())
    );
    assert_eq!(status.error, None);
    // Nothing left in the work folder by the check.
    assert_eq!(std::fs::read_dir(d.join("tmp")).unwrap().count(), 0);

    // The restored data.
    assert_eq!(
        std::fs::read(d.join("uploads/projects/plan.png")).unwrap(),
        b"PNG"
    );
    assert!(!d.join("uploads/projects/after.png").exists());
    assert_eq!(
        std::fs::read(d.join("config.json")).unwrap(),
        br#"{"port":9100,"bind":"0.0.0.0"}"#
    );
    assert!(d
        .join("backups/projects/cp1000000000000000000000000/20261107-100000-auto.arkyo")
        .is_file());
    // Not part of the restore: the site backups stay.
    assert_eq!(
        std::fs::read(d.join("backups/site/keep.txt")).unwrap(),
        b"kept"
    );
    assert!(!d.join("arkyo.db-wal").exists());

    // The previous data, set aside.
    let old = aside(&d, "before-restore-");
    assert_eq!(old.len(), 1, "{:?}", names(&d));
    let old = &old[0];
    assert!(old.join("arkyo.db").is_file());
    assert_eq!(
        std::fs::read(old.join("uploads/projects/after.png")).unwrap(),
        b"NEW"
    );
    assert_eq!(
        std::fs::read(old.join("config.json")).unwrap(),
        br#"{"port":9200}"#
    );
    assert!(!old.join("backups/site").exists());

    // The base opens (migrations) and holds the state of the backup.
    let pool = arkyo_server::db::open(&d).await.unwrap();
    let projects: Vec<String> = sqlx::query_scalar(r#"SELECT "name" FROM "Project""#)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(projects, ["Match"]);
    pool.close().await;

    // Nothing pending any more.
    assert!(!apply_pending_restore(&d).unwrap());
}

#[tokio::test]
async fn apply_pending_restore_failure_rolls_back() {
    let (e, owner) = populated().await;
    let d = e._dir.path().to_path_buf();
    let out = tempfile::tempdir().unwrap();
    let b = create_site_backup(&e.pool, &d, out.path()).await.unwrap();
    let db = entry(&out.path().join(&b.name), "arkyo.db");
    add_project(&e.pool, "cp2000000000000000000000000", "Après", &owner).await;
    e.pool.close().await;

    // `uploads/a` is a file, then `uploads/a/b` needs it as a folder.
    zip_of(
        &d.join(PENDING),
        &[
            ("manifest.json", &site_manifest()),
            ("arkyo.db", &db),
            ("config.json", br#"{"port":9300}"#),
            ("uploads/a", b"file"),
            ("uploads/a/b", b"under a file"),
        ],
    );
    assert!(apply_pending_restore(&d).is_err());

    // Everything is back.
    assert_eq!(projects(&d).await, ["Après", "Match"]);
    assert_eq!(
        std::fs::read(d.join("config.json")).unwrap(),
        br#"{"port":9100,"bind":"0.0.0.0"}"#
    );
    assert_eq!(
        std::fs::read(d.join("uploads/projects/plan.png")).unwrap(),
        b"PNG"
    );
    assert!(!d.join("uploads/a").exists());
    assert!(d
        .join("backups/projects/cp1000000000000000000000000/20261107-100000-auto.arkyo")
        .is_file());
    assert!(aside(&d, "before-restore-").is_empty(), "{:?}", names(&d));
    // The archive is kept aside under another name, not retried.
    assert!(!d.join(PENDING).exists());
    let failed = aside(&d, "restore-failed-");
    assert_eq!(failed.len(), 1, "{:?}", names(&d));
    assert!(failed[0].to_string_lossy().ends_with(".zip"));
    assert!(!d.join("restore-in-progress.json").exists());
    let status = read_restore_status(&d).unwrap();
    assert!(!status.ok);
    assert_eq!(
        status.archive,
        failed[0].file_name().unwrap().to_str().unwrap()
    );
    assert_eq!(
        status.error.as_deref(),
        Some("Espace disque insuffisant ou dossier non inscriptible.")
    );
    assert!(!apply_pending_restore(&d).unwrap());
}

#[test]
fn retention_keeps_last_n() {
    let d = tempfile::tempdir().unwrap();
    for day in 1..=9 {
        write(
            &d.path()
                .join(format!("Arkyo-site-202611{day:02}-030000.zip")),
            b"zip",
        );
    }
    write(&d.path().join("notes.txt"), b"other");
    write(
        &d.path().join("Arkyo-site-20261110-030000.zip.part"),
        b"part",
    );
    assert_eq!(prune_site_backups(d.path(), 7), 2);
    let left = list_site_backups(d.path());
    let left: Vec<&str> = left.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(
        left,
        [
            "Arkyo-site-20261109-030000.zip",
            "Arkyo-site-20261108-030000.zip",
            "Arkyo-site-20261107-030000.zip",
            "Arkyo-site-20261106-030000.zip",
            "Arkyo-site-20261105-030000.zip",
            "Arkyo-site-20261104-030000.zip",
            "Arkyo-site-20261103-030000.zip",
        ]
    );
    assert!(d.path().join("notes.txt").exists());
    assert!(d
        .path()
        .join("Arkyo-site-20261110-030000.zip.part")
        .exists());
    assert_eq!(prune_site_backups(d.path(), 7), 0);
}

#[test]
fn daily_backup_is_due_once_the_hour_has_passed() {
    let at = |s: &str| s.parse::<jiff::civil::DateTime>().unwrap();
    let none: Vec<String> = Vec::new();
    let yesterday = vec!["Arkyo-site-20261107-030000.zip".to_string()];
    let today = vec!["Arkyo-site-20261108-010000.zip".to_string()];
    assert!(!is_due(at("2026-11-08T02:59:00"), 3, &none));
    assert!(is_due(at("2026-11-08T03:00:00"), 3, &none));
    assert!(is_due(at("2026-11-08T22:00:00"), 3, &yesterday));
    assert!(!is_due(at("2026-11-08T03:01:00"), 3, &today));
    assert!(is_due(at("2026-11-08T00:00:00"), 0, &yesterday));
}

// ── Routes ──────────────────────────────────────────────────────────────────

async fn raw(
    app: &axum::Router,
    method: &str,
    uri: &str,
    cookie: &str,
    body: Vec<u8>,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let mut req = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::COOKIE, format!("arkyo_session={cookie}"))
        .body(Body::from(body))
        .unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(LOCAL.parse::<std::net::SocketAddr>().unwrap()));
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    let bytes = res.into_body().collect().await.unwrap().to_bytes().to_vec();
    (status, headers, bytes)
}

#[tokio::test]
async fn settings_dir_must_exist() {
    let (e, _) = populated().await;
    let token = login(&e.app, "o@b.fr").await;
    let put = |body: Value| {
        call(
            &e.app,
            "PUT",
            "/api/system/backups/settings/site",
            LOCAL,
            Some(&token),
            Some(body),
        )
    };

    let r = call(
        &e.app,
        "GET",
        "/api/system/backups/site",
        LOCAL,
        Some(&token),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(
        r.body["settings"],
        json!({"enabled": true, "hour": 3, "dir": null, "keep": 7})
    );
    let default_dir = e._dir.path().join("backups").join("site");
    assert_eq!(r.body["dir"], default_dir.to_string_lossy().as_ref());
    assert_eq!(r.body["backups"], json!([]));

    let file = e._dir.path().join("config.json");
    for dir in [
        "relatif/dossier".to_string(),
        e._dir.path().join("absent").to_string_lossy().into_owned(),
        file.to_string_lossy().into_owned(),
    ] {
        let r = put(json!({"enabled": true, "hour": 3, "dir": dir, "keep": 7})).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{dir}");
        assert_eq!(r.body["error"], "Dossier inaccessible", "{dir}");
    }
    let r = put(json!({"enabled": true, "hour": 24, "dir": null, "keep": 7})).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = put(json!({"enabled": true, "hour": 3, "dir": null, "keep": 0})).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    let target = tempfile::tempdir().unwrap();
    let dir = target.path().to_string_lossy().into_owned();
    let r = put(json!({"enabled": false, "hour": 22, "dir": dir, "keep": 3})).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(
        r.body,
        json!({"enabled": false, "hour": 22, "dir": dir, "keep": 3})
    );
    // The probe file is gone.
    assert_eq!(std::fs::read_dir(target.path()).unwrap().count(), 0);
    let r = call(
        &e.app,
        "GET",
        "/api/system/backups/site",
        LOCAL,
        Some(&token),
        None,
    )
    .await;
    assert_eq!(r.body["settings"]["dir"], dir.as_str());
    assert_eq!(r.body["dir"], dir.as_str());

    // An empty folder name means the default.
    let r = put(json!({"enabled": true, "hour": 3, "dir": "  ", "keep": 7})).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["dir"], Value::Null);
}

#[tokio::test]
async fn routes_create_list_download_delete_and_restore() {
    let (e, _) = populated().await;
    let token = login(&e.app, "o@b.fr").await;
    add_user(&e.pool, "t@b.fr", "technicien", false).await;
    let tech = login(&e.app, "t@b.fr").await;
    for (method, uri) in [
        ("GET", "/api/system/backups/site"),
        ("POST", "/api/system/backups/site"),
        (
            "GET",
            "/api/system/backups/site/Arkyo-site-20261107-030000.zip/download",
        ),
        (
            "DELETE",
            "/api/system/backups/site/Arkyo-site-20261107-030000.zip",
        ),
        ("PUT", "/api/system/backups/settings/site"),
        ("POST", "/api/system/backups/site/restore"),
    ] {
        let r = call(&e.app, method, uri, LOCAL, Some(&tech), Some(json!({}))).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{method} {uri}");
    }

    let r = call(
        &e.app,
        "POST",
        "/api/system/backups/site",
        LOCAL,
        Some(&token),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let name = r.body["name"].as_str().unwrap().to_string();
    assert!(is_backup_name(&name), "{name}");
    assert!(r.body["size"].as_u64().unwrap() > 0);
    let site = e._dir.path().join("backups/site");
    assert!(site.join(&name).is_file());

    let r = call(
        &e.app,
        "GET",
        "/api/system/backups/site",
        LOCAL,
        Some(&token),
        None,
    )
    .await;
    assert_eq!(r.body["backups"].as_array().unwrap().len(), 1);
    assert_eq!(r.body["backups"][0]["name"], name.as_str());
    assert!(r.body["backups"][0]["createdAt"]
        .as_str()
        .unwrap()
        .ends_with('Z'));

    let (status, headers, bytes) = raw(
        &e.app,
        "GET",
        &format!("/api/system/backups/site/{name}/download"),
        &token,
        Vec::new(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[header::CONTENT_TYPE], "application/zip");
    assert_eq!(
        headers[header::CONTENT_DISPOSITION],
        format!("attachment; filename=\"{name}\"").as_str()
    );
    assert_eq!(bytes, std::fs::read(site.join(&name)).unwrap());

    for bad in [
        "Arkyo-site-x.zip",
        "..%2Fconfig.json",
        "Arkyo-site-20261107-030000.zip",
    ] {
        let r = call(
            &e.app,
            "GET",
            &format!("/api/system/backups/site/{bad}/download"),
            LOCAL,
            Some(&token),
            None,
        )
        .await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{bad}");
        assert_eq!(r.body["error"], "Sauvegarde introuvable");
        let r = call(
            &e.app,
            "DELETE",
            &format!("/api/system/backups/site/{bad}"),
            LOCAL,
            Some(&token),
            None,
        )
        .await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{bad}");
    }

    // Restore: the file is checked, then staged; the restart is suppressed
    // in this process.
    arkyo_server::update::disable_restart();
    let (status, _, body) = raw(
        &e.app,
        "POST",
        "/api/system/backups/site/restore",
        &token,
        b"garbage".to_vec(),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap()["error"],
        "Archive invalide."
    );
    assert!(!e._dir.path().join(PENDING).exists());
    let archive = std::fs::read(site.join(&name)).unwrap();
    let (status, _, body) = raw(
        &e.app,
        "POST",
        "/api/system/backups/site/restore",
        &token,
        archive.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap(),
        json!({"restarting": true})
    );
    assert_eq!(std::fs::read(e._dir.path().join(PENDING)).unwrap(), archive);
    // No temporary file left.
    assert_eq!(
        std::fs::read_dir(e._dir.path().join("tmp"))
            .map(|d| d.count())
            .unwrap_or(0),
        0
    );

    let r = call(
        &e.app,
        "DELETE",
        &format!("/api/system/backups/site/{name}"),
        LOCAL,
        Some(&token),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    assert!(!site.join(&name).exists());
}

// ── CLI ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn cli_backup_writes_archive() {
    let (e, _) = populated().await;
    let d = e._dir.path().to_path_buf();
    let out = tempfile::tempdir().unwrap();
    let exe = env!("CARGO_BIN_EXE_arkyo-server");
    let o = std::process::Command::new(exe)
        .args(["backup", "--data-dir"])
        .arg(&d)
        .arg("--out")
        .arg(out.path())
        .output()
        .unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    let printed = String::from_utf8(o.stdout).unwrap();
    let path = PathBuf::from(printed.trim());
    assert_eq!(path.parent().unwrap(), out.path());
    assert!(
        is_backup_name(path.file_name().unwrap().to_str().unwrap()),
        "{printed}"
    );
    verify(&path).unwrap();

    // `restore` checks the file and stages it.
    let o = std::process::Command::new(exe)
        .args(["restore"])
        .arg(&path)
        .arg("--data-dir")
        .arg(&d)
        .output()
        .unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    let said = String::from_utf8(o.stdout).unwrap();
    assert!(
        said.starts_with(
            "Restauration prête : elle sera appliquée au prochain démarrage du serveur.\n"
        ),
        "{said}"
    );
    // The service keeps running: how to restart it, how to cancel.
    assert!(said.contains("Le service continue de tourner"), "{said}");
    assert!(
        said.contains("`arkyo-server service stop` puis `arkyo-server service start`"),
        "{said}"
    );
    assert!(
        said.contains(&d.join(PENDING).display().to_string()),
        "{said}"
    );
    assert_eq!(
        std::fs::read(d.join(PENDING)).unwrap(),
        std::fs::read(&path).unwrap()
    );

    // A file that is not a site backup is refused.
    let bad = out.path().join("bad.zip");
    std::fs::write(&bad, b"nope").unwrap();
    let o = std::process::Command::new(exe)
        .args(["restore"])
        .arg(&bad)
        .arg("--data-dir")
        .arg(&d)
        .output()
        .unwrap();
    assert!(!o.status.success());
    assert!(String::from_utf8_lossy(&o.stderr).contains("Archive invalide."));
}

// ── Fix round 1 ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_write_failure_is_not_an_invalid_archive() {
    let (e, _) = populated().await;
    let out = tempfile::tempdir().unwrap();
    let b = create_site_backup(&e.pool, e._dir.path(), out.path())
        .await
        .unwrap();
    // The work folder cannot be created: a file is in the way.
    let blocker = out.path().join("blocker");
    std::fs::write(&blocker, b"x").unwrap();
    match verify_site_archive(&out.path().join(&b.name), &blocker.join("tmp")) {
        Err(e @ TransferError::Storage(_)) => assert_eq!(
            e.to_string(),
            "Espace disque insuffisant ou dossier non inscriptible."
        ),
        other => panic!("{other:?}"),
    }
}

/// Moves `item` of the data directory into `aside` (as a restore does).
fn move_aside(d: &Path, aside: &Path, item: &str) {
    let dest = aside.join(item);
    std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
    // Windows may hold the base a moment after `pool.close()` (error 32,
    // sharing violation): retry for a few seconds, as the restore does.
    let mut tries = 0;
    loop {
        match std::fs::rename(d.join(item), &dest) {
            Ok(()) => return,
            Err(e) if tries < 50 && e.kind() != std::io::ErrorKind::NotFound => {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => panic!("move_aside {item}: {e}"),
        }
    }
}

fn marker(d: &Path, aside: &str, phase: &str) {
    std::fs::write(
        d.join("restore-in-progress.json"),
        json!({"aside": aside, "phase": phase, "startedAt": NOW}).to_string(),
    )
    .unwrap();
}

#[tokio::test]
async fn a_crash_while_unpacking_puts_the_original_data_back() {
    let (e, owner) = populated().await;
    let d = e._dir.path().to_path_buf();
    let out = tempfile::tempdir().unwrap();
    let b = create_site_backup(&e.pool, &d, out.path()).await.unwrap();
    stage_restore(&d, &out.path().join(&b.name)).unwrap();
    add_project(&e.pool, "cp2000000000000000000000000", "Après", &owner).await;
    e.pool.close().await;

    // State left by a crash: all moved aside, the archive half unpacked.
    let aside_dir = d.join("before-restore-20261108-030000");
    for item in [
        "arkyo.db",
        "arkyo.db-wal",
        "arkyo.db-shm",
        "config.json",
        "uploads",
        "backups/projects",
    ] {
        if d.join(item).exists() {
            move_aside(&d, &aside_dir, item);
        }
    }
    write(&d.join("arkyo.db"), b"half");
    write(&d.join("uploads/half.png"), b"half");
    marker(&d, "before-restore-20261108-030000", "unpacking");

    let err = apply_pending_restore(&d).unwrap_err();
    assert_eq!(
        err.to_string(),
        "La restauration a été interrompue ; les données d'origine ont été remises en place."
    );
    assert_eq!(projects(&d).await, ["Après", "Match"]);
    assert_eq!(
        std::fs::read(d.join("config.json")).unwrap(),
        br#"{"port":9100,"bind":"0.0.0.0"}"#
    );
    assert_eq!(
        std::fs::read(d.join("uploads/projects/plan.png")).unwrap(),
        b"PNG"
    );
    assert!(!d.join("uploads/half.png").exists());
    assert!(d
        .join("backups/projects/cp1000000000000000000000000/20261107-100000-auto.arkyo")
        .is_file());
    assert!(!aside_dir.exists());
    assert!(!d.join("restore-in-progress.json").exists());
    assert!(!d.join(PENDING).exists());
    assert_eq!(aside(&d, "restore-failed-").len(), 1, "{:?}", names(&d));
    let status = read_restore_status(&d).unwrap();
    assert!(!status.ok);
    assert_eq!(status.error.as_deref(), Some(err.to_string().as_str()));
    // Nothing left to do.
    assert!(!apply_pending_restore(&d).unwrap());
}

#[tokio::test]
async fn a_crash_while_moving_keeps_what_was_not_moved() {
    let (e, owner) = populated().await;
    let d = e._dir.path().to_path_buf();
    let out = tempfile::tempdir().unwrap();
    let b = create_site_backup(&e.pool, &d, out.path()).await.unwrap();
    stage_restore(&d, &out.path().join(&b.name)).unwrap();
    add_project(&e.pool, "cp2000000000000000000000000", "Après", &owner).await;
    e.pool.close().await;

    // Only the base had been moved.
    let aside_dir = d.join("before-restore-20261108-030000");
    move_aside(&d, &aside_dir, "arkyo.db");
    marker(&d, "before-restore-20261108-030000", "moving");

    assert!(apply_pending_restore(&d).is_err());
    assert_eq!(projects(&d).await, ["Après", "Match"]);
    assert_eq!(
        std::fs::read(d.join("config.json")).unwrap(),
        br#"{"port":9100,"bind":"0.0.0.0"}"#
    );
    assert_eq!(
        std::fs::read(d.join("uploads/projects/plan.png")).unwrap(),
        b"PNG"
    );
    assert!(!aside_dir.exists());
}

#[tokio::test]
async fn a_crash_after_the_commit_point_keeps_the_restored_data() {
    let (e, _) = populated().await;
    let d = e._dir.path().to_path_buf();
    e.pool.close().await;
    std::fs::create_dir(d.join("before-restore-20261108-030000")).unwrap();
    marker(&d, "before-restore-20261108-030000", "unpacking");
    // No `restore-pending.zip`: it had been renamed.
    assert!(!apply_pending_restore(&d).unwrap());
    assert_eq!(projects(&d).await, ["Match"]);
    assert_eq!(
        std::fs::read(d.join("uploads/projects/plan.png")).unwrap(),
        b"PNG"
    );
    assert!(!d.join("restore-in-progress.json").exists());
    assert!(d.join("before-restore-20261108-030000").is_dir());
    assert!(read_restore_status(&d).unwrap().ok);
}

#[tokio::test]
async fn an_archive_marked_applied_is_not_applied_again() {
    let (e, owner) = populated().await;
    let d = e._dir.path().to_path_buf();
    let out = tempfile::tempdir().unwrap();
    let b = create_site_backup(&e.pool, &d, out.path()).await.unwrap();
    add_project(&e.pool, "cp2000000000000000000000000", "Après", &owner).await;
    stage_restore(&d, &out.path().join(&b.name)).unwrap();
    e.pool.close().await;

    // A previous start applied it but could neither rename nor remove it.
    let m = std::fs::metadata(d.join(PENDING)).unwrap();
    let ns = m
        .modified()
        .unwrap()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64;
    std::fs::write(
        d.join("restore-status.json"),
        json!({"ok": true, "at": NOW, "archive": PENDING,
               "pending": {"size": m.len(), "modifiedNs": ns}})
        .to_string(),
    )
    .unwrap();
    assert!(!apply_pending_restore(&d).unwrap());
    assert!(!d.join(PENDING).exists());
    assert!(aside(&d, "before-restore-").is_empty());
    assert_eq!(projects(&d).await, ["Après", "Match"]);
}

/// The project names of the base of `d` (opened, then closed). The base is
/// compared by content: its bytes may change when the pool closes.
async fn projects(d: &Path) -> Vec<String> {
    let pool = arkyo_server::db::open(d).await.unwrap();
    let names = sqlx::query_scalar(r#"SELECT "name" FROM "Project" ORDER BY "name""#)
        .fetch_all(&pool)
        .await
        .unwrap();
    pool.close().await;
    names
}

fn make_stale(path: &Path) {
    write(path, b"old");
    let f = std::fs::File::options().write(true).open(path).unwrap();
    f.set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(2 * 3600))
        .unwrap();
}

#[tokio::test]
async fn restore_route_warns_sweeps_and_reports_the_last_restore() {
    let (e, _) = populated().await;
    let d = e._dir.path().to_path_buf();
    let token = login(&e.app, "o@b.fr").await;
    let r = call(
        &e.app,
        "GET",
        "/api/system/backups/site",
        LOCAL,
        Some(&token),
        None,
    )
    .await;
    assert_eq!(r.body["lastRestore"], Value::Null);

    // Stale temporaries, and a fresh one that stays.
    make_stale(&d.join("tmp/site-old.db"));
    make_stale(&d.join("tmp/verify-old.db"));
    make_stale(&d.join("backups/site/Arkyo-site-20261101-030000.zip.part"));
    make_stale(&d.join("restore-pending.zip.part"));
    write(
        &d.join("backups/site/Arkyo-site-20261102-030000.zip.part"),
        b"busy",
    );

    // A base newer than this binary: restorable, with a warning.
    let out = tempfile::tempdir().unwrap();
    let b = create_site_backup(&e.pool, &d, out.path()).await.unwrap();
    let db = entry(&out.path().join(&b.name), "arkyo.db");
    let mut m: Value = serde_json::from_slice(&site_manifest()).unwrap();
    m["migration"] = json!(arkyo_server::db::latest_migration() + 1);
    let newer = out.path().join("newer.zip");
    zip_of(
        &newer,
        &[
            ("manifest.json", m.to_string().as_bytes()),
            ("arkyo.db", &db),
        ],
    );
    arkyo_server::update::disable_restart();
    let (status, _, body) = raw(
        &e.app,
        "POST",
        "/api/system/backups/site/restore",
        &token,
        std::fs::read(&newer).unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap(),
        json!({"restarting": true,
               "warning": "Cette sauvegarde vient d'une version plus récente de Strata Arkyo."})
    );
    assert!(!d.join("tmp/site-old.db").exists());
    assert!(!d.join("tmp/verify-old.db").exists());
    assert!(!d
        .join("backups/site/Arkyo-site-20261101-030000.zip.part")
        .exists());
    assert!(!d.join("restore-pending.zip.part").exists());
    assert!(d
        .join("backups/site/Arkyo-site-20261102-030000.zip.part")
        .exists());

    std::fs::write(
        d.join("restore-status.json"),
        json!({"ok": true, "at": NOW, "archive": "restore-applied-20261108-030000.zip"})
            .to_string(),
    )
    .unwrap();
    let r = call(
        &e.app,
        "GET",
        "/api/system/backups/site",
        LOCAL,
        Some(&token),
        None,
    )
    .await;
    assert_eq!(
        r.body["lastRestore"],
        json!({"ok": true, "at": NOW, "archive": "restore-applied-20261108-030000.zip"})
    );
}

#[tokio::test]
async fn settings_dir_must_be_outside_the_saved_data() {
    let (e, _) = populated().await;
    let token = login(&e.app, "o@b.fr").await;
    let d = e._dir.path();
    std::fs::create_dir_all(d.join("uploads/sub")).unwrap();
    for dir in [
        d.join("uploads"),
        d.join("uploads/sub"),
        d.join("backups/projects"),
    ] {
        let r = call(
            &e.app,
            "PUT",
            "/api/system/backups/settings/site",
            LOCAL,
            Some(&token),
            Some(json!({"enabled": true, "hour": 3, "dir": dir, "keep": 7})),
        )
        .await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{}", dir.display());
        assert_eq!(
            r.body["error"],
            "Ce dossier fait partie des données sauvegardées."
        );
    }
    // The default folder's parent is fine.
    std::fs::create_dir_all(d.join("backups/site")).unwrap();
    let r = call(
        &e.app,
        "PUT",
        "/api/system/backups/settings/site",
        LOCAL,
        Some(&token),
        Some(json!({"enabled": true, "hour": 3, "dir": d.join("backups/site"), "keep": 7})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
}

#[tokio::test]
async fn cli_backup_refuses_a_missing_configured_folder() {
    let (e, _) = populated().await;
    let d = e._dir.path().to_path_buf();
    let missing = d.join("nas-absent");
    arkyo_server::transfer::site::save_settings(
        &e.pool,
        &arkyo_server::transfer::site::SiteSettings {
            enabled: true,
            hour: 3,
            dir: Some(missing.to_string_lossy().into_owned()),
            keep: 7,
        },
    )
    .await
    .unwrap();
    let o = std::process::Command::new(env!("CARGO_BIN_EXE_arkyo-server"))
        .args(["backup", "--data-dir"])
        .arg(&d)
        .output()
        .unwrap();
    assert!(!o.status.success());
    let err = String::from_utf8_lossy(&o.stderr);
    assert!(err.contains("inaccessible"), "{err}");
    assert!(err.contains("--out"), "{err}");
    assert!(!missing.exists());
}

/// The `AppState` of an [`Env`].
fn state_of(e: &Env) -> arkyo_server::http::AppState {
    arkyo_server::http::AppState {
        pool: e.pool.clone(),
        data_dir: e._dir.path().to_path_buf(),
        events: e.events.clone(),
        config: std::sync::Arc::new(std::sync::RwLock::new(
            arkyo_server::config::Config::default(),
        )),
    }
}

async fn get_site(e: &Env, token: &str) -> Value {
    let r = call(
        &e.app,
        "GET",
        "/api/system/backups/site",
        LOCAL,
        Some(token),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    r.body
}

#[tokio::test]
async fn a_failed_automatic_backup_is_shown_until_the_next_success() {
    let (e, _) = populated().await;
    let token = login(&e.app, "o@b.fr").await;
    let st = state_of(&e);
    assert_eq!(get_site(&e, &token).await["lastError"], Value::Null);

    // The folder set is gone (an unmounted share).
    let gone = SiteSettings {
        dir: Some(e._dir.path().join("absent").to_string_lossy().into_owned()),
        ..SiteSettings::default()
    };
    save_settings(&e.pool, &gone).await.unwrap();
    assert!(run_recorded(&st, &gone).await.is_err());
    let err = &get_site(&e, &token).await["lastError"];
    assert_eq!(err["message"], "Dossier inaccessible", "{err}");
    assert!(err["at"].as_str().unwrap().ends_with('Z'), "{err}");

    let ok = SiteSettings::default();
    save_settings(&e.pool, &ok).await.unwrap();
    run_recorded(&st, &ok).await.unwrap();
    assert_eq!(get_site(&e, &token).await["lastError"], Value::Null);
}

#[tokio::test]
async fn a_staged_restore_is_listed_and_can_be_cancelled() {
    let (e, _) = populated().await;
    let d = e._dir.path().to_path_buf();
    let token = login(&e.app, "o@b.fr").await;
    assert_eq!(get_site(&e, &token).await["pending"], Value::Null);
    let out = tempfile::tempdir().unwrap();
    let b = create_site_backup(&e.pool, &d, out.path()).await.unwrap();
    let m = stage_restore(&d, &out.path().join(&b.name)).unwrap();

    let pending = get_site(&e, &token).await["pending"].clone();
    assert_eq!(
        pending["backupCreatedAt"],
        m.created_at.as_str(),
        "{pending}"
    );
    assert_eq!(
        pending["size"],
        std::fs::metadata(d.join(PENDING)).unwrap().len()
    );
    assert!(
        pending["createdAt"].as_str().unwrap().ends_with('Z'),
        "{pending}"
    );

    let r = call(
        &e.app,
        "DELETE",
        "/api/system/backups/site/pending",
        LOCAL,
        Some(&token),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::NO_CONTENT, "{:?}", r.body);
    assert!(!d.join(PENDING).exists());
    assert_eq!(get_site(&e, &token).await["pending"], Value::Null);
    let r = call(
        &e.app,
        "DELETE",
        "/api/system/backups/site/pending",
        LOCAL,
        Some(&token),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Aucune restauration en attente"}));

    // Admin only.
    add_user(&e.pool, "m@b.fr", "technicien", false).await;
    let member = login(&e.app, "m@b.fr").await;
    let r = call(
        &e.app,
        "DELETE",
        "/api/system/backups/site/pending",
        LOCAL,
        Some(&member),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn names_differing_only_by_case_are_an_invalid_archive() {
    let (e, _) = populated().await;
    let out = tempfile::tempdir().unwrap();
    let b = create_site_backup(&e.pool, e._dir.path(), out.path())
        .await
        .unwrap();
    let db = entry(&out.path().join(&b.name), "arkyo.db");
    let p = out.path().join("case.zip");
    zip_of(
        &p,
        &[
            ("manifest.json", &site_manifest()),
            ("arkyo.db", &db),
            ("uploads/Plan.png", b"A"),
            ("uploads/plan.png", b"B"),
        ],
    );
    assert_eq!(invalid(verify(&p)), "Archive invalide.");
}

/// Earlier leftovers of restores in `d`.
fn old_leftovers(d: &Path) {
    for n in ["20200101-000000", "20200102-000000", "20200103-000000"] {
        std::fs::create_dir_all(d.join(format!("before-restore-{n}/uploads"))).unwrap();
    }
    for n in ["20200101-000000", "20200102-000000"] {
        write(&d.join(format!("restore-applied-{n}.zip")), b"old");
        write(&d.join(format!("restore-failed-{n}.zip")), b"old");
    }
}

#[tokio::test]
async fn a_committed_restore_purges_older_leftovers() {
    let (e, _) = populated().await;
    let d = e._dir.path().to_path_buf();
    let out = tempfile::tempdir().unwrap();
    let b = create_site_backup(&e.pool, &d, out.path()).await.unwrap();
    stage_restore(&d, &out.path().join(&b.name)).unwrap();
    e.pool.close().await;
    old_leftovers(&d);
    assert!(apply_pending_restore(&d).unwrap());

    let before = aside(&d, "before-restore-");
    assert_eq!(before.len(), 2, "{:?}", names(&d));
    assert!(
        before[0].ends_with("before-restore-20200103-000000"),
        "{before:?}"
    );
    // The one of this restore holds the data it replaced.
    assert!(before[1].join("arkyo.db").is_file());
    let applied = aside(&d, "restore-applied-");
    assert_eq!(applied.len(), 1, "{:?}", names(&d));
    assert_eq!(
        applied[0].file_name().unwrap().to_str().unwrap(),
        read_restore_status(&d).unwrap().archive
    );
    let failed = aside(&d, "restore-failed-");
    assert_eq!(failed.len(), 1, "{:?}", names(&d));
    assert!(failed[0].ends_with("restore-failed-20200102-000000.zip"));
}

#[tokio::test]
async fn a_failed_restore_purges_nothing() {
    let (e, _) = populated().await;
    let d = e._dir.path().to_path_buf();
    e.pool.close().await;
    // `uploads/a` is a file, then `uploads/a/b` needs it as a folder.
    zip_of(
        &d.join(PENDING),
        &[
            ("manifest.json", &site_manifest()),
            ("arkyo.db", b"base"),
            ("uploads/a", b"file"),
            ("uploads/a/b", b"under a file"),
        ],
    );
    old_leftovers(&d);
    assert!(apply_pending_restore(&d).is_err());
    assert_eq!(aside(&d, "before-restore-").len(), 3, "{:?}", names(&d));
    assert_eq!(aside(&d, "restore-applied-").len(), 2);
    assert_eq!(aside(&d, "restore-failed-").len(), 3);
}

/// The marker a restore leaves when the original data could not all be
/// put back.
fn strand(d: &Path, folder: &str) {
    std::fs::create_dir_all(d.join(folder)).unwrap();
    std::fs::write(
        d.join("restore-stranded.json"),
        json!({"at": NOW, "beforeRestore": folder, "error": "disque plein"}).to_string(),
    )
    .unwrap();
}

#[tokio::test]
async fn a_stranded_marker_stops_every_restore_and_the_cli() {
    let (e, _) = populated().await;
    let d = e._dir.path().to_path_buf();
    let out = tempfile::tempdir().unwrap();
    let b = create_site_backup(&e.pool, &d, out.path()).await.unwrap();
    stage_restore(&d, &out.path().join(&b.name)).unwrap();
    e.pool.close().await;
    strand(&d, "before-restore-20261108-030000");

    // Refused each time, nothing touched (the archive stays pending).
    for _ in 0..2 {
        match apply_pending_restore(&d) {
            Err(TransferError::Stranded(dir)) => {
                assert!(dir.ends_with("before-restore-20261108-030000"), "{dir:?}")
            }
            other => panic!("{other:?}"),
        }
        assert!(d.join(PENDING).is_file());
        assert!(d.join("restore-stranded.json").is_file());
    }

    // The CLI does not open the base either.
    let exe = env!("CARGO_BIN_EXE_arkyo-server");
    let o = std::process::Command::new(exe)
        .args(["backup", "--out"])
        .arg(out.path())
        .arg("--data-dir")
        .arg(&d)
        .output()
        .unwrap();
    assert!(!o.status.success());
    let err = String::from_utf8_lossy(&o.stderr);
    assert!(err.contains("before-restore-20261108-030000"), "{err}");
    assert!(err.contains("restore-stranded.json"), "{err}");

    // The admin put the data back and removed the marker: it goes on.
    std::fs::remove_file(d.join("restore-stranded.json")).unwrap();
    assert!(apply_pending_restore(&d).unwrap());
}
