//! Sauvegardes, Task 4: restore points of a project, automatic and manual
//! (spec 2026-11-07-sauvegardes-design §5).
mod common;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use arkyo_server::config::Config;
use arkyo_server::http::AppState;
use arkyo_server::transfer::archive::{read_archive, Author};
use arkyo_server::transfer::points::{
    create_point, list_points, list_projects, load_settings, run_auto_pass, save_settings, Point,
    PointKind, ProjectSettings,
};
use arkyo_server::users::User;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

const NOW: &str = "2026-11-07T10:00:00.000Z";
const P1: &str = "cp1000000000000000000000000";
const P2: &str = "cp2000000000000000000000000";

struct T {
    e: Env,
    st: AppState,
    owner: User,
    token: String,
}

impl T {
    fn dir(&self, project: &str) -> PathBuf {
        self.e._dir.path().join("backups/projects").join(project)
    }

    /// The `.arkyo` files of a project, sorted.
    fn files(&self, project: &str) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(self.dir(project))
            .map(|d| {
                d.map(|e| e.unwrap().file_name().into_string().unwrap())
                    .filter(|n| n.ends_with(".arkyo"))
                    .collect()
            })
            .unwrap_or_default();
        v.sort();
        v
    }

    fn points(&self, project: &str) -> Vec<Point> {
        list_points(self.e._dir.path(), project)
    }

    async fn call(&self, method: &str, uri: &str, body: Option<Value>) -> Reply {
        call(&self.e.app, method, uri, LOCAL, Some(&self.token), body).await
    }
}

async fn exec(pool: &SqlitePool, sql: &str, user: &str) {
    let sql = sql.replace("<u>", user);
    let mut q = sqlx::query(&sql);
    for _ in 0..sql.matches('?').count() {
        q = q.bind(NOW);
    }
    q.execute(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

/// Projects `P1` (`Match`, a task and a location) and `P2` (`Concert`).
async fn setup() -> T {
    let e = env().await;
    let owner = add_user(&e.pool, "o@b.fr", "owner", false).await;
    for sql in [
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('cp1000000000000000000000000','Match','<u>',?,?)"#,
        r#"INSERT INTO "Task" ("id","projectId","title","assignedToId","createdAt","updatedAt") VALUES ('ct1000000000000000000000000','cp1000000000000000000000000','Câbler','<u>',?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","createdAt","updatedAt") VALUES ('cl1000000000000000000000000','cp1000000000000000000000000','Plateau',?,?)"#,
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('cp2000000000000000000000000','Concert','<u>',?,?)"#,
    ] {
        exec(&e.pool, sql, &owner.id).await;
    }
    let st = AppState {
        pool: e.pool.clone(),
        data_dir: e._dir.path().to_path_buf(),
        events: e.events.clone(),
        config: Arc::new(RwLock::new(Config::default())),
    };
    let token = login(&e.app, "o@b.fr").await;
    T {
        e,
        st,
        owner,
        token,
    }
}

async fn rename(pool: &SqlitePool, id: &str, name: &str) {
    sqlx::query(r#"UPDATE "Project" SET "name" = ? WHERE "id" = ?"#)
        .bind(name)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

async fn name_of(pool: &SqlitePool, id: &str) -> Option<String> {
    sqlx::query_scalar(r#"SELECT "name" FROM "Project" WHERE "id" = ?"#)
        .bind(id)
        .fetch_optional(pool)
        .await
        .unwrap()
}

/// `GET …/points/{point}/download` → the bytes (checks the headers).
async fn download(t: &T, project: &str, point: &str) -> Vec<u8> {
    let mut req = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/system/backups/projects/{project}/points/{point}/download"
        ))
        .header(header::COOKIE, format!("arkyo_session={}", t.token))
        .body(Body::empty())
        .unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(LOCAL.parse::<std::net::SocketAddr>().unwrap()));
    let res = t.e.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers()[header::CONTENT_TYPE], "application/zip");
    let disposition = res.headers()[header::CONTENT_DISPOSITION]
        .to_str()
        .unwrap()
        .to_string();
    assert!(disposition.contains(".arkyo"), "{disposition}");
    res.into_body().collect().await.unwrap().to_bytes().to_vec()
}

/// The entry names of a zip file.
fn entries(path: &std::path::Path) -> Vec<String> {
    let z = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    z.file_names().map(|n| n.unwrap().into_owned()).collect()
}

fn author(u: &User) -> Option<Author> {
    Some(Author {
        id: u.id.clone(),
        name: u.name.clone(),
        email: Some(u.email.clone()),
    })
}

#[tokio::test]
async fn auto_point_skips_unchanged_project() {
    let t = setup().await;
    assert_eq!(run_auto_pass(&t.st).await, 2);
    assert_eq!(run_auto_pass(&t.st).await, 0);
    let points = t.points(P1);
    assert_eq!(points.len(), 1);
    assert_eq!(points[0].kind, PointKind::Auto);
    assert_eq!(points[0].project_id, P1);
    assert_eq!(points[0].project_name, "Match");
    assert!(points[0].author.is_none());
    assert_eq!(points[0].digest.len(), 64);
    assert!(points[0].size > 0);
    assert_eq!(t.files(P1), [format!("{}.arkyo", points[0].id)]);
    assert!(points[0].id.ends_with("-auto"), "{}", points[0].id);

    // A manual point of the same state is written; the next automatic one
    // is not (same digest as the last point).
    let manual = create_point(&t.st, P1, PointKind::Manual, None, author(&t.owner))
        .await
        .unwrap()
        .unwrap();
    assert!(manual.id.ends_with("-manuel"), "{}", manual.id);
    assert_eq!(manual.digest, points[0].digest);
    assert_eq!(run_auto_pass(&t.st).await, 0);
    assert_eq!(t.points(P1).len(), 2);
}

#[tokio::test]
async fn auto_point_after_change() {
    let t = setup().await;
    assert_eq!(run_auto_pass(&t.st).await, 2);
    rename(&t.e.pool, P1, "Finale").await;
    assert_eq!(run_auto_pass(&t.st).await, 1);
    let points = t.points(P1);
    assert_eq!(points.len(), 2);
    // Newest first.
    assert_eq!(points[0].project_name, "Finale");
    assert_eq!(points[1].project_name, "Match");
    assert_ne!(points[0].digest, points[1].digest);
    assert_eq!(t.points(P2).len(), 1);
}

#[tokio::test]
async fn retention_keeps_last_n_auto_and_all_manual() {
    let t = setup().await;
    save_settings(
        &t.e.pool,
        &ProjectSettings {
            enabled: true,
            interval_hours: 1,
            keep: 2,
        },
    )
    .await
    .unwrap();
    let mut manual = Vec::new();
    for i in 0..5 {
        rename(&t.e.pool, P1, &format!("Match {i}")).await;
        assert_eq!(run_auto_pass(&t.st).await, if i == 0 { 2 } else { 1 });
        if i == 1 || i == 3 {
            let label = format!("Étape {i}");
            let p = create_point(&t.st, P1, PointKind::Manual, Some(label), author(&t.owner))
                .await
                .unwrap()
                .unwrap();
            manual.push(p.id);
        }
    }
    let points = t.points(P1);
    let autos: Vec<&str> = points
        .iter()
        .filter(|p| p.kind == PointKind::Auto)
        .map(|p| p.project_name.as_str())
        .collect();
    assert_eq!(autos, ["Match 4", "Match 3"]);
    let mut kept: Vec<String> = points
        .iter()
        .filter(|p| p.kind == PointKind::Manual)
        .map(|p| p.id.clone())
        .collect();
    kept.sort();
    manual.sort();
    assert_eq!(kept, manual);
    // The files follow the index.
    let mut ids: Vec<String> = points.iter().map(|p| format!("{}.arkyo", p.id)).collect();
    ids.sort();
    assert_eq!(t.files(P1), ids);
}

#[tokio::test]
async fn restore_point_of_deleted_project_recreates_it() {
    let t = setup().await;
    let r = t
        .call(
            "POST",
            &format!("/api/system/backups/projects/{P1}/points"),
            Some(json!({ "label": "  Avant le match  " })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["kind"], "manual");
    assert_eq!(r.body["label"], "Avant le match");
    assert_eq!(r.body["projectName"], "Match");
    assert_eq!(r.body["author"]["id"], t.owner.id);
    let point = r.body["id"].as_str().unwrap().to_string();

    let r = t
        .call("DELETE", &format!("/api/tenant/projects/{P1}"), None)
        .await;
    assert!(r.status.is_success(), "{:?}", r.body);
    assert_eq!(name_of(&t.e.pool, P1).await, None);

    // The deleted project stays listed with its points; the other one is
    // listed without any.
    let r = t.call("GET", "/api/system/backups/projects", None).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let list = r.body.as_array().unwrap();
    assert_eq!(list.len(), 2, "{list:?}");
    let p1 = list.iter().find(|p| p["id"] == P1).unwrap();
    assert_eq!(p1["name"], "Match");
    assert_eq!(p1["deleted"], true);
    assert_eq!(p1["count"], 1);
    assert_eq!(p1["lastPoint"]["id"], point.as_str());
    let p2 = list.iter().find(|p| p["id"] == P2).unwrap();
    assert_eq!(p2["deleted"], false);
    assert_eq!(p2["count"], 0);
    assert_eq!(p2["lastPoint"], Value::Null);

    let r = t
        .call(
            "POST",
            &format!("/api/system/backups/projects/{P1}/points/{point}/restore"),
            None,
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["roots"][0]["mode"], "insert");
    assert_eq!(name_of(&t.e.pool, P1).await.as_deref(), Some("Match"));
    let tasks: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "Task" WHERE "projectId" = ?"#)
        .bind(P1)
        .fetch_one(&t.e.pool)
        .await
        .unwrap();
    assert_eq!(tasks, 1);
    // Nothing to keep before an insertion: no new point.
    assert_eq!(t.points(P1).len(), 1);
    assert_eq!(t.files(P1).len(), 1);
}

#[tokio::test]
async fn restore_point_creates_before_restore_point() {
    let t = setup().await;
    let r = t
        .call(
            "POST",
            &format!("/api/system/backups/projects/{P1}/points"),
            Some(json!({})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["label"], Value::Null);
    let point = r.body["id"].as_str().unwrap().to_string();
    rename(&t.e.pool, P1, "Renommé").await;

    let r = t
        .call(
            "POST",
            &format!("/api/system/backups/projects/{P1}/points/{point}/restore"),
            None,
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["roots"][0]["mode"], "replace");
    assert_eq!(name_of(&t.e.pool, P1).await.as_deref(), Some("Match"));

    // Exactly one point of the state before the restore, indexed.
    let r = t
        .call(
            "GET",
            &format!("/api/system/backups/projects/{P1}/points"),
            None,
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let list = r.body.as_array().unwrap();
    assert_eq!(list.len(), 2, "{list:?}");
    assert_eq!(list[0]["kind"], "beforeRestore");
    assert_eq!(list[0]["projectName"], "Renommé");
    assert_eq!(list[0]["author"]["id"], t.owner.id);
    assert!(list[0]["id"]
        .as_str()
        .unwrap()
        .ends_with("-avant-restauration"));
    assert_eq!(list[1]["id"], point.as_str());
    assert_eq!(t.files(P1).len(), 2);

    // Download: the point's rows.
    let bytes = download(&t, P1, &point).await;
    let file = t.e._dir.path().join("downloaded.arkyo");
    std::fs::write(&file, &bytes).unwrap();
    let (m, b) = read_archive(&file).unwrap();
    let (m0, b0) = read_archive(&t.dir(P1).join(format!("{point}.arkyo"))).unwrap();
    assert_eq!(m, m0);
    assert_eq!(b.tables, b0.tables);

    // Delete: the file and its index entry go.
    let r = t
        .call(
            "DELETE",
            &format!("/api/system/backups/projects/{P1}/points/{point}"),
            None,
        )
        .await;
    assert!(r.status.is_success(), "{:?}", r.body);
    assert_eq!(t.points(P1).len(), 1);
    assert_eq!(t.files(P1).len(), 1);
}

#[tokio::test]
async fn index_is_rebuilt_from_files() {
    let t = setup().await;
    create_point(
        &t.st,
        P1,
        PointKind::Manual,
        Some("Avant le match".into()),
        author(&t.owner),
    )
    .await
    .unwrap();
    rename(&t.e.pool, P1, "Finale").await;
    assert_eq!(run_auto_pass(&t.st).await, 2);
    let before = t.points(P1);
    assert_eq!(before.len(), 2);
    assert_eq!(before[1].label.as_deref(), Some("Avant le match"));

    let index = t.dir(P1).join("points.json");
    assert!(index.is_file());
    std::fs::remove_file(&index).unwrap();
    assert_eq!(t.points(P1), before);
    std::fs::write(&index, b"{ abime").unwrap();
    assert_eq!(t.points(P1), before);

    // A file removed by hand leaves the list; an unreadable one is ignored.
    std::fs::remove_file(t.dir(P1).join(format!("{}.arkyo", before[0].id))).unwrap();
    std::fs::write(t.dir(P1).join("20261107-100000-auto.arkyo"), b"pas un zip").unwrap();
    assert_eq!(t.points(P1), before[1..]);

    // Deleted projects are found from their folders.
    let projects = list_projects(t.e._dir.path());
    let ids: Vec<&str> = projects.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&P1) && ids.contains(&P2));
}

#[tokio::test]
async fn settings_roundtrip_and_validation() {
    let t = setup().await;
    assert_eq!(load_settings(&t.e.pool).await, ProjectSettings::default());
    let r = t
        .call("GET", "/api/system/backups/settings/projects", None)
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(
        r.body,
        json!({ "enabled": true, "intervalHours": 1, "keep": 48 })
    );

    let new = json!({ "enabled": false, "intervalHours": 6, "keep": 10 });
    let r = t
        .call(
            "PUT",
            "/api/system/backups/settings/projects",
            Some(new.clone()),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body, new);
    let r = t
        .call("GET", "/api/system/backups/settings/projects", None)
        .await;
    assert_eq!(r.body, new);
    assert_eq!(
        load_settings(&t.e.pool).await,
        ProjectSettings {
            enabled: false,
            interval_hours: 6,
            keep: 10
        }
    );

    for bad in [
        json!({ "enabled": true, "intervalHours": 2, "keep": 48 }),
        json!({ "enabled": true, "intervalHours": 1, "keep": 0 }),
        json!({ "enabled": true, "intervalHours": 1 }),
        json!("oui"),
    ] {
        let r = t
            .call(
                "PUT",
                "/api/system/backups/settings/projects",
                Some(bad.clone()),
            )
            .await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{bad}");
        assert_eq!(r.body, json!({ "error": "Paramètres invalides" }), "{bad}");
    }
    assert_eq!(load_settings(&t.e.pool).await.interval_hours, 6);

    // Administrators only.
    add_user(&t.e.pool, "t@b.fr", "technicien", false).await;
    let tech = login(&t.e.app, "t@b.fr").await;
    for (method, uri) in [
        ("GET", "/api/system/backups/settings/projects".to_string()),
        ("GET", "/api/system/backups/projects".to_string()),
        ("GET", format!("/api/system/backups/projects/{P1}/points")),
        ("POST", format!("/api/system/backups/projects/{P1}/points")),
    ] {
        let r = call(&t.e.app, method, &uri, LOCAL, Some(&tech), Some(json!({}))).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{uri}");
    }
}

#[tokio::test]
async fn point_id_traversal_is_404() {
    let t = setup().await;
    let p = create_point(&t.st, P1, PointKind::Manual, None, author(&t.owner))
        .await
        .unwrap()
        .unwrap();
    std::fs::write(t.e._dir.path().join("backups/secret.arkyo"), b"x").unwrap();
    let missing = json!({ "error": "Point de restauration introuvable" });
    for point in [
        "..%2F..%2Farkyo.db",
        "..",
        "..%2Fsecret",
        "20990101-000000-auto",
        "points",
        &format!("{}.arkyo", p.id),
    ] {
        for (method, suffix) in [("GET", "/download"), ("POST", "/restore"), ("DELETE", "")] {
            let uri = format!("/api/system/backups/projects/{P1}/points/{point}{suffix}");
            let r = t.call(method, &uri, None).await;
            assert_eq!(r.status, StatusCode::NOT_FOUND, "{method} {uri}");
            assert_eq!(r.body, missing, "{method} {uri}");
        }
    }
    // A point of another project, or a project id that is not one.
    for project in [P2, "..", "..%2F.."] {
        let uri = format!(
            "/api/system/backups/projects/{project}/points/{}/download",
            p.id
        );
        let r = t.call("GET", &uri, None).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{uri}");
    }
    let r = t
        .call(
            "POST",
            "/api/system/backups/projects/..%2F../points",
            Some(json!({})),
        )
        .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    let r = t
        .call(
            "POST",
            "/api/system/backups/projects/cabsent00000000000000000000/points",
            Some(json!({})),
        )
        .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({ "error": "Projet introuvable" }));
    assert_eq!(t.points(P1), [p]);
    assert!(t.e._dir.path().join("backups/secret.arkyo").exists());
}

#[tokio::test]
async fn points_keep_rows_only_and_downloads_add_the_files() {
    let t = setup().await;
    exec(
        &t.e.pool,
        r#"INSERT INTO "ProjectDocument" ("id","projectId","name","url","uploadedById","uploadedAt") VALUES ('cd1000000000000000000000000','cp1000000000000000000000000','Plan','/uploads/documents/a.pdf','<u>',?)"#,
        &t.owner.id,
    )
    .await;
    let uploads = t.e._dir.path().join("uploads/documents");
    std::fs::create_dir_all(&uploads).unwrap();
    std::fs::write(uploads.join("a.pdf"), b"%PDF-plan").unwrap();

    let p = create_point(&t.st, P1, PointKind::Manual, None, author(&t.owner))
        .await
        .unwrap()
        .unwrap();
    let file = t.dir(P1).join(format!("{}.arkyo", p.id));
    // No file in the point; the manifest still lists the referenced path.
    assert!(
        entries(&file).iter().all(|n| !n.starts_with("uploads/")),
        "{:?}",
        entries(&file)
    );
    let (m, _) = read_archive(&file).unwrap();
    assert!(m.uploads.contains("documents/a.pdf"), "{:?}", m.uploads);

    // The download is self-contained: rows and the current file.
    let bytes = download(&t, P1, &p.id).await;
    let out = t.e._dir.path().join("dl.arkyo");
    std::fs::write(&out, &bytes).unwrap();
    let mut z = zip::ZipArchive::new(std::fs::File::open(&out).unwrap()).unwrap();
    let mut pdf = Vec::new();
    std::io::Read::read_to_end(&mut z.by_name("uploads/documents/a.pdf").unwrap(), &mut pdf)
        .unwrap();
    assert_eq!(pdf, b"%PDF-plan");
    // The temporary file of the download is gone.
    let left: Vec<_> = std::fs::read_dir(t.e._dir.path().join("tmp"))
        .map(|d| d.flatten().map(|e| e.file_name()).collect())
        .unwrap_or_default();
    assert!(left.is_empty(), "{left:?}");

    // A restore copies no file, and the « avant restauration » point holds
    // rows only too.
    rename(&t.e.pool, P1, "Renommé").await;
    let r = t
        .call(
            "POST",
            &format!("/api/system/backups/projects/{P1}/points/{}/restore", p.id),
            None,
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["uploadsCopied"], 0);
    let before = t
        .points(P1)
        .into_iter()
        .find(|p| p.kind == PointKind::BeforeRestore)
        .unwrap();
    let file = t.dir(P1).join(format!("{}.arkyo", before.id));
    assert!(entries(&file).iter().all(|n| !n.starts_with("uploads/")));
}

#[tokio::test]
async fn catalogue_edit_creates_no_automatic_point() {
    let t = setup().await;
    assert_eq!(run_auto_pass(&t.st).await, 2);
    exec(
        &t.e.pool,
        r#"INSERT INTO "TenantBrand" ("id","name","createdAt","updatedAt") VALUES ('cb1000000000000000000000000','Marque d''essai',?,?)"#,
        &t.owner.id,
    )
    .await;
    assert_eq!(run_auto_pass(&t.st).await, 0);
    // A change of the project itself still does.
    rename(&t.e.pool, P1, "Renommé").await;
    assert_eq!(run_auto_pass(&t.st).await, 1);
}
