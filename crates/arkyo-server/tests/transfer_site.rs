//! Sauvegardes, Task 5: full backup of the site, restore at startup and CLI
//! (spec 2026-11-07-sauvegardes-design §6).
mod common;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use arkyo_server::transfer::archive::write_archive;
use arkyo_server::transfer::site::{
    apply_pending_restore, create_site_backup, is_due, list_site_backups, prune_site_backups,
    stage_restore, verify_site_archive, SiteManifest, PENDING,
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

    let manifest = verify_site_archive(&path).unwrap();
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
    let m = invalid(verify_site_archive(&export));
    assert_eq!(
        m,
        "Ce fichier n'est pas une sauvegarde du site Strata Arkyo."
    );

    // Not a zip.
    let garbage = d.path().join("g.zip");
    std::fs::write(&garbage, b"not a zip at all").unwrap();
    assert_eq!(invalid(verify_site_archive(&garbage)), "Archive invalide.");

    // A site manifest, but no base / a base that is not SQLite.
    let no_db = d.path().join("n.zip");
    zip_of(&no_db, &[("manifest.json", &site_manifest())]);
    assert_eq!(invalid(verify_site_archive(&no_db)), "Archive invalide.");
    let bad_db = d.path().join("b.zip");
    zip_of(
        &bad_db,
        &[
            ("manifest.json", &site_manifest()),
            ("arkyo.db", b"SQLite? no"),
        ],
    );
    assert_eq!(invalid(verify_site_archive(&bad_db)), "Archive invalide.");

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
    assert_eq!(invalid(verify_site_archive(&slip)), "Archive invalide.");

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
        invalid(verify_site_archive(&newer)),
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
    let (e, _) = populated().await;
    let d = e._dir.path().to_path_buf();
    let out = tempfile::tempdir().unwrap();
    let b = create_site_backup(&e.pool, &d, out.path()).await.unwrap();
    let db = entry(&out.path().join(&b.name), "arkyo.db");
    e.pool.close().await;
    let before_db = std::fs::read(d.join("arkyo.db")).unwrap();

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
    assert_eq!(std::fs::read(d.join("arkyo.db")).unwrap(), before_db);
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
    assert!(!apply_pending_restore(&d).unwrap());
    let pool = arkyo_server::db::open(&d).await.unwrap();
    pool.close().await;
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
    verify_site_archive(&path).unwrap();

    // `restore` checks the file and stages it.
    let o = std::process::Command::new(exe)
        .args(["restore"])
        .arg(&path)
        .arg("--data-dir")
        .arg(&d)
        .output()
        .unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    assert_eq!(
        String::from_utf8(o.stdout).unwrap().trim(),
        "Restauration prête : elle sera appliquée au prochain démarrage du service."
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
