//! Sauvegardes, Task 3: export and import of `.arkyo` objects (insert,
//! replace, copy) and the transfer routes (spec 2026-11-07-sauvegardes-design
//! §4).
mod common;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use arkyo_server::config::Config;
use arkyo_server::http::AppState;
use arkyo_server::transfer::archive::{read_archive, write_archive};
use arkyo_server::transfer::import::{export_to_file, import, ImportOptions, Mode, Report};
use arkyo_server::transfer::{collect, Bundle, RootKind, Row, TransferError};
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

/// A cuid-shaped id for a short tag (`c` + 24 `[a-z0-9]`).
fn cid(tag: &str) -> String {
    format!("c{tag:0<24}")
}

/// Replaces every `<tag>` of `sql` by [`cid`]`(tag)` and `<u>` by `user`.
fn ids_in(sql: &str, user: &str) -> String {
    let mut out = String::new();
    let mut rest = sql;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..i]);
        let tail = &rest[i + 1..];
        let j = tail.find('>').unwrap();
        let tag = &tail[..j];
        if tag == "u" {
            out.push_str(user);
        } else {
            out.push_str(&cid(tag));
        }
        rest = &tail[j + 1..];
    }
    out.push_str(rest);
    out
}

async fn exec(pool: &SqlitePool, sql: &str, user: &str) {
    let sql = ids_in(sql, user);
    let mut q = sqlx::query(&sql);
    for _ in 0..sql.matches('?').count() {
        q = q.bind(NOW);
    }
    q.execute(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

/// Project `p1` (`Match`): location `loc1`, rig `rg1` holding rack `ra`
/// (cable id 1, ids in its JSON columns), rack `rb` attached to `loc1`
/// (cable id 2). `ra`: inventory items `ii1` (adapter `ad1`) and `ii2`
/// hosted by `ii1`, slots `sa1` (equipment `eq1`), `sa2` (panel `pn1`),
/// `sa3` child of `sa1` and parent of `sa2`, bundle `cb1`, connection `rc1` (ids in its JSON).
/// Project rows: sheet, document (an upload), task, message, connection
/// `pc1`, audit row. Authors are `user`.
async fn seed(pool: &SqlitePool, user: &str) {
    for sql in [
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('<p1>','Match','<u>',?,?)"#,
        r#"INSERT INTO "TechnicalSheet" ("id","projectId","blocks","createdAt","updatedAt") VALUES ('<ts1>','<p1>','[{"rackId":"<ra>"}]',?,?)"#,
        r#"INSERT INTO "ProjectDocument" ("id","projectId","name","url","uploadedById","uploadedAt") VALUES ('<doc1>','<p1>','Plan','/uploads/documents/a.pdf','<u>',?)"#,
        r#"INSERT INTO "Task" ("id","projectId","title","assignedToId","createdAt","updatedAt") VALUES ('<t1>','<p1>','Câbler','<u>',?,?)"#,
        r#"INSERT INTO "Message" ("id","projectId","authorId","content","createdAt","updatedAt") VALUES ('<m1>','<p1>','<u>','Bonjour',?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","createdAt","updatedAt") VALUES ('<loc1>','<p1>','Plateau',?,?)"#,
        r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt") VALUES ('<rg1>','Régie 1','<p1>','<u>',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","createdById","createdAt","updatedAt") VALUES ('<eq1>','Caméra','<u>',?,?)"#,
        r#"INSERT INTO "TenantAdapter" ("id","name","createdById","createdAt","updatedAt") VALUES ('<ad1>','Coupleur','<u>',?,?)"#,
        r#"INSERT INTO "Panel" ("id","name","createdById","createdAt","updatedAt") VALUES ('<pn1>','Patch 1','<u>',?,?)"#,
        r#"INSERT INTO "PanelSlot" ("id","panelId","position") VALUES ('<ps1>','<pn1>',0)"#,
        r#"INSERT INTO "Rack" ("id","name","cableId","constructionChecks","numberingOverride","createdAt","updatedAt") VALUES ('<ra>','Baie A',1,'[{"slotId":"<sa1>","ok":true}]','{"<sa1>":"A01"}',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","cableId","locationId","isVirtual","createdAt","updatedAt") VALUES ('<rb>','Baie B',2,'<loc1>',1,?,?)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('<rr1>','<rg1>','<ra>',0)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogAdapterId","createdAt","updatedAt") VALUES ('<ii1>','<ra>','<ad1>',?,?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","hostItemId","hostSlotIndex","createdAt","updatedAt") VALUES ('<ii2>','<ra>','<eq1>','<ii1>',0,?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","inventoryItemId","startU","createdAt","updatedAt") VALUES ('<sa1>','<ra>','<eq1>','<ii2>',1,?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","panelId","startU","createdAt","updatedAt") VALUES ('<sa2>','<ra>','<pn1>',2,?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","parentSlotId","createdAt","updatedAt") VALUES ('<sa3>','<ra>','<sa1>',?,?)"#,
        r#"INSERT INTO "CableBundle" ("id","rackId","name","createdAt","updatedAt") VALUES ('<cb1>','<ra>','Faisceau',?,?)"#,
        r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","fromConnectorIndex","toSlotId","toConnectorIndex","bundleId","waypoints","createdAt") VALUES ('<rc1>','<ra>','<sa1>',0,'<sa2>',0,'<cb1>','[{"x":1,"slotId":"<sa2>"}]',?)"#,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","toRackId","createdAt") VALUES ('<pc1>','<p1>','<ra>','<sa1>','<rb>',?)"#,
        r#"INSERT INTO "ProjectSynopticLayout" ("id","projectId","rackId","x","y","createdAt","updatedAt") VALUES ('<ly1>','<p1>','<ra>',0,0,?,?)"#,
        r#"INSERT INTO "AuditLog" ("id","userId","action","entityType","entityId","projectId","createdAt") VALUES ('<au1>','<u>','UPDATE','Project','<p1>','<p1>',?)"#,
        r#"INSERT INTO "AuditLog" ("id","userId","action","entityType","entityId","createdAt") VALUES ('<au2>','<u>','CREATE','RackConnection','<rc1>',?)"#,
        // A child before its parent in rowid order (`sa2` under `sa3`).
        r#"UPDATE "RackSlot" SET "parentSlotId" = '<sa3>' WHERE "id" = '<sa2>'"#,
    ] {
        exec(pool, sql, user).await;
    }
}

struct T {
    e: Env,
    st: AppState,
    owner: User,
}

impl T {
    fn dir(&self) -> &Path {
        self.e._dir.path()
    }
    fn file(&self, name: &str) -> PathBuf {
        self.dir().join(name)
    }
}

async fn setup() -> T {
    let e = env().await;
    let owner = add_user(&e.pool, "o@b.fr", "owner", false).await;
    let st = AppState {
        pool: e.pool.clone(),
        data_dir: e._dir.path().to_path_buf(),
        events: e.events.clone(),
        config: Arc::new(RwLock::new(Config::default())),
    };
    seed(&e.pool, &owner.id).await;
    let uploads = e._dir.path().join("uploads/documents");
    std::fs::create_dir_all(&uploads).unwrap();
    std::fs::write(uploads.join("a.pdf"), b"%PDF").unwrap();
    T { e, st, owner }
}

async fn snapshot(pool: &SqlitePool, kind: RootKind, id: &str) -> Bundle {
    let mut tx = pool.begin().await.unwrap();
    let b = collect(&mut tx, &[(kind, id.to_string())]).await.unwrap();
    tx.rollback().await.unwrap();
    b
}

async fn export(t: &T, roots: &[(RootKind, &str)], name: &str) -> PathBuf {
    let out = t.file(name);
    let roots: Vec<(RootKind, String)> = roots.iter().map(|(k, i)| (*k, i.to_string())).collect();
    export_to_file(&t.st, &t.owner, &roots, &out).await.unwrap();
    out
}

fn modes(m: &[(&str, Mode)]) -> ImportOptions {
    ImportOptions {
        modes: m.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
    }
}

async fn run(t: &T, file: &Path, opts: ImportOptions) -> Result<Report, TransferError> {
    import(&t.st, &t.owner, file, opts).await
}

async fn count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

async fn text(pool: &SqlitePool, sql: &str, id: &str) -> Option<String> {
    sqlx::query_scalar(sql)
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Deletes the project through the existing route.
async fn delete_project(t: &T, id: &str) {
    let token = login(&t.e.app, "o@b.fr").await;
    let r = call(
        &t.e.app,
        "DELETE",
        &format!("/api/tenant/projects/{id}"),
        LOCAL,
        Some(&token),
        None,
    )
    .await;
    assert!(r.status.is_success(), "{:?}", r.body);
    assert_eq!(
        count(&t.e.pool, r#"SELECT COUNT(*) FROM "Project""#).await,
        0
    );
}

/// Rewrites the archive with `edit` applied to its rows.
fn edit_archive(file: &Path, out: &Path, uploads: &Path, edit: impl FnOnce(&mut Bundle)) {
    let (m, mut b) = read_archive(file).unwrap();
    edit(&mut b);
    write_archive(&b, m.created_by, uploads, out).unwrap();
}

fn rows_mut<'a>(b: &'a mut Bundle, table: &str) -> &'a mut Vec<Row> {
    b.tables.get_mut(table).unwrap()
}

/// The bundle's tables as `table → id → row`, `AuditLog` apart.
fn by_id(b: &Bundle) -> BTreeMap<String, BTreeMap<String, Row>> {
    b.tables
        .iter()
        .filter(|(t, _)| t.as_str() != "AuditLog")
        .map(|(t, rows)| {
            (
                t.clone(),
                rows.iter()
                    .map(|r| (r["id"].as_str().unwrap().to_string(), r.clone()))
                    .collect(),
            )
        })
        .collect()
}

fn audit_ids(b: &Bundle) -> BTreeSet<String> {
    b.tables
        .get("AuditLog")
        .map(|rows| {
            rows.iter()
                .map(|r| r["id"].as_str().unwrap().to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn assert_same_rows(before: &Bundle, after: &Bundle) {
    assert_same_rows_but(before, after, &[]);
}

/// [`assert_same_rows`], the `AuditLog` columns of `audit_skip` apart.
fn assert_same_rows_but(before: &Bundle, after: &Bundle, audit_skip: &[&str]) {
    let (a, b) = (by_id(before), by_id(after));
    assert_eq!(
        a.keys().collect::<Vec<_>>(),
        b.keys().collect::<Vec<_>>(),
        "tables"
    );
    for (table, rows) in &a {
        assert_eq!(rows, &b[table], "{table}");
    }
    let old = audit_ids(before);
    let new = audit_ids(after);
    assert!(old.is_subset(&new), "{old:?} ⊄ {new:?}");
    let before_rows: BTreeMap<_, _> = before.tables["AuditLog"]
        .iter()
        .map(|r| (r["id"].as_str().unwrap().to_string(), r.clone()))
        .collect();
    for r in &after.tables["AuditLog"] {
        if let Some(old) = before_rows.get(r["id"].as_str().unwrap()) {
            let (mut old, mut r) = (old.clone(), r.clone());
            for c in audit_skip {
                old.remove(*c);
                r.remove(*c);
            }
            assert_eq!(old, r, "AuditLog");
        }
    }
}

#[tokio::test]
async fn export_delete_import_restores_identical_rows() {
    let t = setup().await;
    let p1 = cid("p1");
    let before = snapshot(&t.e.pool, RootKind::Project, &p1).await;
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    delete_project(&t, &p1).await;
    std::fs::remove_file(t.file("uploads/documents/a.pdf")).unwrap();

    let rep = run(&t, &file, modes(&[])).await.unwrap();
    assert_eq!(rep.roots.len(), 1);
    assert_eq!(rep.roots[0].id, p1);
    assert_eq!(rep.roots[0].name, "Match");
    assert_eq!(rep.roots[0].mode, Mode::Insert);
    assert_eq!(rep.roots[0].inserted["RackSlot"], 3);
    assert_eq!(rep.uploads_copied, 1);
    assert_eq!(
        std::fs::read(t.file("uploads/documents/a.pdf")).unwrap(),
        b"%PDF"
    );

    let after = snapshot(&t.e.pool, RootKind::Project, &p1).await;
    // The audit rows the deletion left (projectId set to NULL) are kept as
    // they are: an insertion never overwrites.
    assert_same_rows_but(&before, &after, &["projectId"]);
    assert!(
        rep.warnings.iter().any(|w| w
            == "2 ligne(s) de « AuditLog » existaient déjà ici et ont été gardées telles quelles."),
        "{:?}",
        rep.warnings
    );
    let n = count(
        &t.e.pool,
        &format!(
            r#"SELECT COUNT(*) FROM "AuditLog" WHERE "action" = 'IMPORT' AND "entityType" = 'Project' AND "entityId" = '{p1}' AND "projectId" = '{p1}'"#
        ),
    )
    .await;
    assert_eq!(n, 1);
    // The import file is not removed by the library call.
    assert!(file.exists());
}

/// Every string of the owned rows of `b`.
fn owned_texts(b: &Bundle) -> Vec<String> {
    let owned = arkyo_server::transfer::owned_tables_in_insert_order();
    let mut out = Vec::new();
    for (t, rows) in &b.tables {
        if !owned.contains(&t.as_str()) {
            continue;
        }
        for r in rows {
            for v in r.values() {
                if let Value::String(s) = v {
                    out.push(s.clone());
                }
            }
        }
    }
    out
}

fn owned_ids(b: &Bundle) -> BTreeSet<String> {
    let owned = arkyo_server::transfer::owned_tables_in_insert_order();
    b.tables
        .iter()
        .filter(|(t, _)| owned.contains(&t.as_str()))
        .flat_map(|(_, rows)| rows.iter().map(|r| r["id"].as_str().unwrap().to_string()))
        .collect()
}

#[tokio::test]
async fn copy_mode_renews_every_owned_id() {
    let t = setup().await;
    let p1 = cid("p1");
    let original = snapshot(&t.e.pool, RootKind::Project, &p1).await;
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;

    // Present here without a mode: refused.
    let err = run(&t, &file, modes(&[])).await.unwrap_err();
    assert!(
        matches!(&err, TransferError::Invalid(m) if m == "Choisissez Remplacer ou Copie pour « Match »."),
        "{err:?}"
    );

    let rep = run(&t, &file, modes(&[(&p1, Mode::Copy)])).await.unwrap();
    let root = &rep.roots[0];
    assert_eq!(root.mode, Mode::Copy);
    assert_ne!(root.id, p1);
    assert_eq!(root.name, "Match (copie)");
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "name" FROM "Project" WHERE "id" = ?"#,
            &root.id
        )
        .await,
        Some("Match (copie)".into())
    );
    assert_eq!(
        count(&t.e.pool, r#"SELECT COUNT(*) FROM "Project""#).await,
        2
    );

    let copy = snapshot(&t.e.pool, RootKind::Project, &root.id).await;
    let old_ids = owned_ids(&original);
    let new_ids = owned_ids(&copy);
    assert!(old_ids.is_disjoint(&new_ids), "ids communs");
    for table in [
        "Rack",
        "RackSlot",
        "RackConnection",
        "Location",
        "RigConfig",
    ] {
        assert_eq!(
            copy.tables[table].len(),
            original.tables[table].len(),
            "{table}"
        );
    }
    // No old owned id left anywhere in the copy's text (JSON included).
    for s in owned_texts(&copy) {
        for old in &old_ids {
            assert!(!s.contains(old.as_str()), "{old} dans {s}");
        }
    }
    // JSON columns point at the copy's own rows.
    let ra = copy.tables["Rack"]
        .iter()
        .find(|r| r["name"] == "Baie A")
        .unwrap();
    let slot_a1 = copy.tables["RackSlot"]
        .iter()
        .find(|r| r["startU"] == json!(1))
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(ra["constructionChecks"]
        .as_str()
        .unwrap()
        .contains(&slot_a1));
    assert!(ra["numberingOverride"].as_str().unwrap().contains(&slot_a1));
    let rc = &copy.tables["RackConnection"][0];
    assert_eq!(rc["fromSlotId"].as_str().unwrap(), slot_a1);
    assert!(!rc["waypoints"].as_str().unwrap().contains(&cid("sa2")));
    // Panels and catalogue are shared, not duplicated.
    assert_eq!(count(&t.e.pool, r#"SELECT COUNT(*) FROM "Panel""#).await, 1);
    assert_eq!(
        count(&t.e.pool, r#"SELECT COUNT(*) FROM "TenantEquipment""#).await,
        1
    );
    assert!(copy.tables["RackSlot"]
        .iter()
        .any(|r| r["panelId"] == json!(cid("pn1"))));
    // The copied racks got free cable ids.
    let cable_ids: Vec<i64> =
        sqlx::query_scalar(r#"SELECT "cableId" FROM "Rack" WHERE "cableId" IS NOT NULL"#)
            .fetch_all(&t.e.pool)
            .await
            .unwrap();
    let distinct: BTreeSet<i64> = cable_ids.iter().copied().collect();
    assert_eq!(distinct.len(), cable_ids.len(), "{cable_ids:?}");
    // The original is untouched.
    let again = snapshot(&t.e.pool, RootKind::Project, &p1).await;
    assert_eq!(by_id(&original), by_id(&again));
}

#[tokio::test]
async fn replace_mode_restores_and_keeps_a_point() {
    let t = setup().await;
    let p1 = cid("p1");
    let before = snapshot(&t.e.pool, RootKind::Project, &p1).await;
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;

    // Changes after the export.
    let u = t.owner.id.clone();
    exec(
        &t.e.pool,
        r#"UPDATE "Project" SET "name" = 'Renommé' WHERE "id" = '<p1>'"#,
        &u,
    )
    .await;
    exec(
        &t.e.pool,
        r#"DELETE FROM "RackConnection" WHERE "id" = '<rc1>'"#,
        &u,
    )
    .await;
    exec(
        &t.e.pool,
        r#"INSERT INTO "RackSlot" ("id","rackId","createdAt","updatedAt") VALUES ('<sa9>','<ra>',?,?)"#,
        &u,
    )
    .await;
    exec(
        &t.e.pool,
        r#"INSERT INTO "Location" ("id","projectId","name","createdAt","updatedAt") VALUES ('<loc9>','<p1>','Régie bis',?,?)"#,
        &u,
    )
    .await;

    let rep = run(&t, &file, modes(&[(&p1, Mode::Replace)]))
        .await
        .unwrap();
    assert_eq!(rep.roots[0].mode, Mode::Replace);
    assert_eq!(rep.roots[0].id, p1);
    assert_eq!(rep.roots[0].name, "Match");

    let after = snapshot(&t.e.pool, RootKind::Project, &p1).await;
    assert_same_rows(&before, &after);
    assert_eq!(
        count(&t.e.pool, r#"SELECT COUNT(*) FROM "Project""#).await,
        1
    );

    let dir = t.file(&format!("backups/projects/{p1}"));
    let points: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .filter(|n| n.ends_with(".arkyo"))
        .collect();
    assert_eq!(points.len(), 1, "{points:?}");
    assert!(
        points[0].ends_with("-avant-restauration.arkyo"),
        "{points:?}"
    );
    // The point holds the state before the restore.
    let (_, point) = read_archive(&dir.join(&points[0])).unwrap();
    assert_eq!(point.tables["Project"][0]["name"], "Renommé");
}

#[tokio::test]
async fn catalogue_rows_are_insert_only() {
    let t = setup().await;
    let p1 = cid("p1");
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    let u = t.owner.id.clone();
    exec(
        &t.e.pool,
        r#"UPDATE "TenantEquipment" SET "name" = 'Local' WHERE "id" = '<eq1>'"#,
        &u,
    )
    .await;
    exec(
        &t.e.pool,
        r#"DELETE FROM "TenantAdapter" WHERE "id" = '<ad1>'"#,
        &u,
    )
    .await;

    let rep = run(&t, &file, modes(&[(&p1, Mode::Copy)])).await.unwrap();
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "name" FROM "TenantEquipment" WHERE "id" = ?"#,
            &cid("eq1")
        )
        .await,
        Some("Local".into())
    );
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "name" FROM "TenantAdapter" WHERE "id" = ?"#,
            &cid("ad1")
        )
        .await,
        Some("Coupleur".into())
    );
    assert_eq!(rep.catalogue_added.get("TenantAdapter"), Some(&1));
    assert_eq!(rep.catalogue_added.get("TenantEquipment"), None);
}

#[tokio::test]
async fn unknown_column_and_table_are_ignored_with_warning() {
    let t = setup().await;
    let p1 = cid("p1");
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    let edited = t.file("edited.arkyo");
    edit_archive(&file, &edited, &t.file("uploads"), |b| {
        rows_mut(b, "Project")[0].insert("futur".into(), json!("x"));
        b.tables.insert(
            "TableFuture".into(),
            vec![json!({"id": "x1"}).as_object().unwrap().clone()],
        );
    });
    delete_project(&t, &p1).await;
    let rep = run(&t, &edited, modes(&[])).await.unwrap();
    assert!(
        rep.warnings
            .iter()
            .any(|w| w == "La colonne « futur » de « Project » est inconnue ici : ignorée."),
        "{:?}",
        rep.warnings
    );
    assert!(
        rep.warnings
            .iter()
            .any(|w| w == "La table « TableFuture » est inconnue ici : ignorée."),
        "{:?}",
        rep.warnings
    );
    assert_eq!(
        count(&t.e.pool, r#"SELECT COUNT(*) FROM "Project""#).await,
        1
    );
}

#[tokio::test]
async fn missing_not_null_column_rolls_back() {
    let t = setup().await;
    let p1 = cid("p1");
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    let edited = t.file("edited.arkyo");
    edit_archive(&file, &edited, &t.file("uploads"), |b| {
        for r in rows_mut(b, "Rack") {
            r.remove("name");
        }
    });
    delete_project(&t, &p1).await;
    let racks = count(&t.e.pool, r#"SELECT COUNT(*) FROM "Rack""#).await;
    let err = run(&t, &edited, modes(&[])).await.unwrap_err();
    assert!(
        matches!(&err, TransferError::Invalid(m) if m == "La colonne « name » de « Rack » manque dans le fichier."),
        "{err:?}"
    );
    assert_eq!(
        count(&t.e.pool, r#"SELECT COUNT(*) FROM "Project""#).await,
        0
    );
    assert_eq!(
        count(&t.e.pool, r#"SELECT COUNT(*) FROM "Rack""#).await,
        racks
    );
}

#[tokio::test]
async fn missing_column_takes_default() {
    let t = setup().await;
    let p1 = cid("p1");
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    let edited = t.file("edited.arkyo");
    edit_archive(&file, &edited, &t.file("uploads"), |b| {
        for r in rows_mut(b, "Rack") {
            r.remove("totalU");
        }
        rows_mut(b, "Project")[0].remove("status");
    });
    delete_project(&t, &p1).await;
    run(&t, &edited, modes(&[])).await.unwrap();
    let total: i64 = sqlx::query_scalar(r#"SELECT "totalU" FROM "Rack" WHERE "id" = ?"#)
        .bind(cid("ra"))
        .fetch_one(&t.e.pool)
        .await
        .unwrap();
    assert_eq!(total, 42);
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "status" FROM "Project" WHERE "id" = ?"#,
            &p1
        )
        .await,
        Some("EN_PREPARATION".into())
    );

    // Also when Replace overwrites an existing row.
    exec(
        &t.e.pool,
        r#"UPDATE "Rack" SET "totalU" = 10 WHERE "id" = '<ra>'"#,
        &t.owner.id,
    )
    .await;
    run(&t, &edited, modes(&[(&p1, Mode::Replace)]))
        .await
        .unwrap();
    let total: i64 = sqlx::query_scalar(r#"SELECT "totalU" FROM "Rack" WHERE "id" = ?"#)
        .bind(cid("ra"))
        .fetch_one(&t.e.pool)
        .await
        .unwrap();
    assert_eq!(total, 42);
}

#[tokio::test]
async fn unknown_author_becomes_importer() {
    let t = setup().await;
    let p1 = cid("p1");
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    let edited = t.file("edited.arkyo");
    edit_archive(&file, &edited, &t.file("uploads"), |b| {
        rows_mut(b, "Project")[0].insert("createdById".into(), json!("inconnu"));
        rows_mut(b, "Task")[0].insert("assignedToId".into(), json!("inconnu"));
        rows_mut(b, "Message")[0].insert("authorId".into(), json!("inconnu"));
    });
    delete_project(&t, &p1).await;
    let other = add_user(&t.e.pool, "i@b.fr", "owner", false).await;
    import(&t.st, &other, &edited, modes(&[])).await.unwrap();
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "createdById" FROM "Project" WHERE "id" = ?"#,
            &p1
        )
        .await,
        Some(other.id.clone())
    );
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "assignedToId" FROM "Task" WHERE "id" = ?"#,
            &cid("t1")
        )
        .await,
        Some(other.id.clone())
    );
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "authorId" FROM "Message" WHERE "id" = ?"#,
            &cid("m1")
        )
        .await,
        Some(other.id.clone())
    );
    // A known author is kept.
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "createdById" FROM "RigConfig" WHERE "id" = ?"#,
            &cid("rg1")
        )
        .await,
        Some(t.owner.id.clone())
    );
}

#[tokio::test]
async fn taken_cable_id_is_reassigned() {
    let t = setup().await;
    let p1 = cid("p1");
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    delete_project(&t, &p1).await;
    exec(
        &t.e.pool,
        r#"INSERT INTO "Rack" ("id","name","cableId","createdAt","updatedAt") VALUES ('<rl>','Valise',1,?,?)"#,
        &t.owner.id,
    )
    .await;
    run(&t, &file, modes(&[])).await.unwrap();
    let ra: Option<i64> = sqlx::query_scalar(r#"SELECT "cableId" FROM "Rack" WHERE "id" = ?"#)
        .bind(cid("ra"))
        .fetch_one(&t.e.pool)
        .await
        .unwrap();
    let rb: Option<i64> = sqlx::query_scalar(r#"SELECT "cableId" FROM "Rack" WHERE "id" = ?"#)
        .bind(cid("rb"))
        .fetch_one(&t.e.pool)
        .await
        .unwrap();
    assert_eq!(rb, Some(2), "libre : conservé");
    let ra = ra.expect("réattribué");
    assert!(ra != 1 && ra != 2, "{ra}");
}

#[tokio::test]
async fn import_is_atomic() {
    let t = setup().await;
    let p1 = cid("p1");
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    let edited = t.file("edited.arkyo");
    // A second RigRack for the same (rig, rack): the unique index fails
    // after the project, its catalogue and part of its rows are written.
    edit_archive(&file, &edited, &t.file("uploads"), |b| {
        let mut dup = rows_mut(b, "RigRack")[0].clone();
        dup.insert("id".into(), json!(cid("rr9")));
        rows_mut(b, "RigRack").push(dup);
    });
    delete_project(&t, &p1).await;
    exec(&t.e.pool, r#"DELETE FROM "TenantAdapter""#, &t.owner.id).await;
    let tables = [
        "Project",
        "Rack",
        "RackSlot",
        "AuditLog",
        "TenantAdapter",
        "Location",
    ];
    let mut counts = Vec::new();
    for tb in tables {
        counts.push(count(&t.e.pool, &format!(r#"SELECT COUNT(*) FROM "{tb}""#)).await);
    }
    let err = run(&t, &edited, modes(&[])).await;
    assert!(err.is_err());
    for (tb, n) in tables.iter().zip(counts) {
        assert_eq!(
            count(&t.e.pool, &format!(r#"SELECT COUNT(*) FROM "{tb}""#)).await,
            n,
            "{tb}"
        );
    }
}

#[tokio::test]
async fn parent_outside_the_file_becomes_null() {
    let t = setup().await;
    let file = export(
        &t,
        &[(RootKind::Rack, &cid("rb")), (RootKind::Rig, &cid("rg1"))],
        "x.arkyo",
    )
    .await;
    delete_project(&t, &cid("p1")).await;
    let rep = run(&t, &file, modes(&[])).await.unwrap();
    assert_eq!(rep.roots.len(), 2);
    assert!(rep.roots.iter().all(|r| r.mode == Mode::Insert));
    // `Rack.locationId` and `RigConfig.projectId` pointed into the deleted
    // project, outside the file.
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "locationId" FROM "Rack" WHERE "id" = ?"#,
            &cid("rb")
        )
        .await,
        None
    );
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "projectId" FROM "RigConfig" WHERE "id" = ?"#,
            &cid("rg1")
        )
        .await,
        None
    );
    // The rig came back with its rack and the rack's rows.
    assert_eq!(
        count(
            &t.e.pool,
            &format!(
                r#"SELECT COUNT(*) FROM "RackSlot" WHERE "rackId" = '{}'"#,
                cid("ra")
            )
        )
        .await,
        3
    );
}

#[tokio::test]
async fn panel_root_replace_keeps_its_users_and_copy_duplicates_it() {
    let t = setup().await;
    let pn1 = cid("pn1");
    let file = export(&t, &[(RootKind::Panel, &pn1)], "pn.arkyo").await;
    let u = t.owner.id.clone();
    exec(
        &t.e.pool,
        r#"UPDATE "PanelSlot" SET "label" = 'Modifié' WHERE "id" = '<ps1>'"#,
        &u,
    )
    .await;
    exec(
        &t.e.pool,
        r#"INSERT INTO "PanelSlot" ("id","panelId","position") VALUES ('<ps9>','<pn1>',1)"#,
        &u,
    )
    .await;

    let rep = run(&t, &file, modes(&[(&pn1, Mode::Replace)]))
        .await
        .unwrap();
    assert_eq!(rep.roots[0].mode, Mode::Replace);
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "label" FROM "PanelSlot" WHERE "id" = ?"#,
            &cid("ps1")
        )
        .await,
        None
    );
    assert_eq!(
        count(&t.e.pool, r#"SELECT COUNT(*) FROM "PanelSlot""#).await,
        1
    );
    // The rack slot using the panel still does (no delete, no SET NULL).
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "panelId" FROM "RackSlot" WHERE "id" = ?"#,
            &cid("sa2")
        )
        .await,
        Some(pn1.clone())
    );
    // No restore point for anything but a project (a safety copy instead).
    assert!(!t.file("backups/projects").exists());
    assert!(t.file("backups/objects").is_dir());

    let rep = run(&t, &file, modes(&[(&pn1, Mode::Copy)])).await.unwrap();
    assert_eq!(rep.roots[0].name, "Patch 1 (copie)");
    assert_eq!(rep.roots[0].inserted["PanelSlot"], 1);
    assert_eq!(count(&t.e.pool, r#"SELECT COUNT(*) FROM "Panel""#).await, 2);
    assert_eq!(
        count(
            &t.e.pool,
            &format!(
                r#"SELECT COUNT(*) FROM "PanelSlot" WHERE "panelId" = '{}'"#,
                rep.roots[0].id
            )
        )
        .await,
        1
    );
}

/// Links rack `ra` to the library rig `rgt` too (a rig outside the
/// project), then exports `root` and changes `ra` and its root afterwards.
async fn shared_rack_changed_after_export(t: &T, root: (RootKind, &str)) -> PathBuf {
    let u = t.owner.id.clone();
    for sql in [
        r#"INSERT INTO "RigConfig" ("id","name","isTemplate","createdById","createdAt","updatedAt") VALUES ('<rgt>','Modèle',1,'<u>',?,?)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('<rr9>','<rgt>','<ra>',0)"#,
    ] {
        exec(&t.e.pool, sql, &u).await;
    }
    let file = export(t, &[root], "shared.arkyo").await;
    for sql in [
        r#"UPDATE "RackSlot" SET "startU" = 5 WHERE "id" = '<sa1>'"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","startU","createdAt","updatedAt") VALUES ('<sa9>','<ra>',1,?,?)"#,
        r#"UPDATE "Rack" SET "name" = 'Baie A modifiée' WHERE "id" = '<ra>'"#,
        r#"UPDATE "Project" SET "name" = 'Renommé' WHERE "id" = '<p1>'"#,
        r#"UPDATE "RigConfig" SET "name" = 'Régie renommée' WHERE "id" = '<rg1>'"#,
    ] {
        exec(&t.e.pool, sql, &u).await;
    }
    file
}

const SHARED_WARNING: &str =
    "Le contenant « Baie A modifiée » est aussi utilisé par une autre régie : il garde son état actuel.";

#[tokio::test]
async fn replace_keeps_a_rack_shared_with_another_rig() {
    for kind in [RootKind::Project, RootKind::Rig] {
        let t = setup().await;
        let id = cid(if kind == RootKind::Project {
            "p1"
        } else {
            "rg1"
        });
        let file = shared_rack_changed_after_export(&t, (kind, &id)).await;
        let rack_before = snapshot(&t.e.pool, RootKind::Rack, &cid("ra")).await;

        let rep = run(&t, &file, modes(&[(&id, Mode::Replace)]))
            .await
            .unwrap();
        assert!(
            rep.warnings.iter().any(|w| w == SHARED_WARNING),
            "{kind:?} {:?}",
            rep.warnings
        );
        let rack_after = snapshot(&t.e.pool, RootKind::Rack, &cid("ra")).await;
        assert_eq!(by_id(&rack_before), by_id(&rack_after), "{kind:?}");
        assert_eq!(audit_ids(&rack_before), audit_ids(&rack_after), "{kind:?}");
        // The rest of the graph is restored, its link to the rack included.
        assert_eq!(
            text(
                &t.e.pool,
                r#"SELECT "name" FROM "RigConfig" WHERE "id" = ?"#,
                &cid("rg1")
            )
            .await,
            Some("Régie 1".into())
        );
        assert_eq!(
            count(
                &t.e.pool,
                &format!(
                    r#"SELECT COUNT(*) FROM "RigRack" WHERE "id" = '{}'"#,
                    cid("rr1")
                )
            )
            .await,
            1
        );
        if kind == RootKind::Project {
            assert_eq!(
                text(
                    &t.e.pool,
                    r#"SELECT "name" FROM "Project" WHERE "id" = ?"#,
                    &id
                )
                .await,
                Some("Match".into())
            );
        }
    }
}

#[tokio::test]
async fn insert_keeps_rows_already_here() {
    let t = setup().await;
    let p1 = cid("p1");
    let u = t.owner.id.clone();
    for sql in [
        r#"INSERT INTO "RigConfig" ("id","name","isTemplate","createdById","createdAt","updatedAt") VALUES ('<rgt>','Modèle',1,'<u>',?,?)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('<rr9>','<rgt>','<ra>',0)"#,
    ] {
        exec(&t.e.pool, sql, &u).await;
    }
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    // The deletion keeps `ra` (the library rig uses it), then it changes
    // through that rig.
    delete_project(&t, &p1).await;
    exec(
        &t.e.pool,
        r#"UPDATE "Rack" SET "name" = 'Valise modifiée' WHERE "id" = '<ra>'"#,
        &u,
    )
    .await;
    exec(
        &t.e.pool,
        r#"UPDATE "RackSlot" SET "startU" = 7 WHERE "id" = '<sa1>'"#,
        &u,
    )
    .await;
    let rack_before = snapshot(&t.e.pool, RootKind::Rack, &cid("ra")).await;

    let rep = run(&t, &file, modes(&[])).await.unwrap();
    assert_eq!(rep.roots[0].mode, Mode::Insert);
    let rack_after = snapshot(&t.e.pool, RootKind::Rack, &cid("ra")).await;
    assert_eq!(by_id(&rack_before), by_id(&rack_after));
    for w in [
        "1 ligne(s) de « Rack » existaient déjà ici et ont été gardées telles quelles.",
        "3 ligne(s) de « RackSlot » existaient déjà ici et ont été gardées telles quelles.",
    ] {
        assert!(
            rep.warnings.iter().any(|x| x == w),
            "{w} / {:?}",
            rep.warnings
        );
    }
    // No such warning for the catalogue and panels already here.
    assert!(
        !rep.warnings
            .iter()
            .any(|w| w.contains("« Panel »") || w.contains("« TenantEquipment »")),
        "{:?}",
        rep.warnings
    );
    assert_eq!(rep.roots[0].inserted.get("Rack"), Some(&1), "rb seulement");
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "name" FROM "Project" WHERE "id" = ?"#,
            &p1
        )
        .await,
        Some("Match".into())
    );
    assert_eq!(
        count(
            &t.e.pool,
            &format!(
                r#"SELECT COUNT(*) FROM "RigRack" WHERE "id" = '{}'"#,
                cid("rr1")
            )
        )
        .await,
        1
    );
}

#[tokio::test]
async fn catalogue_unique_clash_uses_the_local_row() {
    let t = setup().await;
    let p1 = cid("p1");
    let u = t.owner.id.clone();
    for sql in [
        r#"INSERT INTO "TenantEquipmentCategory" ("id","name","createdAt","updatedAt") VALUES ('<cat1>','Catégorie test',?,?)"#,
        r#"INSERT INTO "TenantEquipmentCategory" ("id","name","parentId","createdAt","updatedAt") VALUES ('<cat2>','Catégorie enfant','<cat1>',?,?)"#,
        r#"UPDATE "TenantEquipment" SET "categoryId" = '<cat1>' WHERE "id" = '<eq1>'"#,
    ] {
        exec(&t.e.pool, sql, &u).await;
    }
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    // Here, the same category under another id; the child and the
    // equipment are gone.
    for sql in [
        r#"DELETE FROM "TenantEquipmentCategory" WHERE "id" IN ('<cat2>','<cat1>')"#,
        r#"DELETE FROM "TenantEquipment" WHERE "id" = '<eq1>'"#,
        r#"INSERT INTO "TenantEquipmentCategory" ("id","name","createdAt","updatedAt") VALUES ('<catx>','Catégorie test',?,?)"#,
    ] {
        exec(&t.e.pool, sql, &u).await;
    }
    let rep = run(&t, &file, modes(&[(&p1, Mode::Copy)])).await.unwrap();
    assert!(
        rep.warnings.iter().any(|w| w.contains("Catégorie test")),
        "{:?}",
        rep.warnings
    );
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "parentId" FROM "TenantEquipmentCategory" WHERE "id" = ?"#,
            &cid("cat2")
        )
        .await,
        Some(cid("catx"))
    );
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "categoryId" FROM "TenantEquipment" WHERE "id" = ?"#,
            &cid("eq1")
        )
        .await,
        Some(cid("catx"))
    );
    assert_eq!(
        count(
            &t.e.pool,
            r#"SELECT COUNT(*) FROM "TenantEquipmentCategory" WHERE "name" = 'Catégorie test'"#
        )
        .await,
        1
    );
}

#[tokio::test]
async fn replace_nulls_a_reference_into_the_kept_rack() {
    let t = setup().await;
    let p1 = cid("p1");
    let u = t.owner.id.clone();
    for sql in [
        r#"INSERT INTO "RigConfig" ("id","name","isTemplate","createdById","createdAt","updatedAt") VALUES ('<rgt>','Modèle',1,'<u>',?,?)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('<rr9>','<rgt>','<ra>',0)"#,
    ] {
        exec(&t.e.pool, sql, &u).await;
    }
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    // The slot `pc1` starts from is removed from the shared rack (its
    // children and `pc1` go with it, by cascade).
    exec(
        &t.e.pool,
        r#"DELETE FROM "RackSlot" WHERE "id" = '<sa1>'"#,
        &u,
    )
    .await;

    let rep = run(&t, &file, modes(&[(&p1, Mode::Replace)]))
        .await
        .unwrap();
    let from: (Option<String>, String) = sqlx::query_as(
        r#"SELECT "fromSlotId", "fromRackId" FROM "ProjectConnection" WHERE "id" = ?"#,
    )
    .bind(cid("pc1"))
    .fetch_one(&t.e.pool)
    .await
    .unwrap();
    assert_eq!(from, (None, cid("ra")));
    assert!(
        rep.warnings.iter().any(|w| w
            == "1 référence(s) de « ProjectConnection » visaient un élément qui n'existe pas ici : vidées."),
        "{:?}",
        rep.warnings
    );
    // The kept rack did not get its slot back.
    assert_eq!(
        count(
            &t.e.pool,
            &format!(
                r#"SELECT COUNT(*) FROM "RackSlot" WHERE "id" = '{}'"#,
                cid("sa1")
            )
        )
        .await,
        0
    );
}

#[tokio::test]
async fn rows_whose_required_parent_is_gone_are_skipped() {
    let t = setup().await;
    let p1 = cid("p1");
    exec(
        &t.e.pool,
        r#"INSERT INTO "RackSlotPanelRow" ("id","slotId","rowIndex","synopticX","synopticY","createdAt","updatedAt") VALUES ('<pr1>','<sa2>',0,0,0,?,?)"#,
        &t.owner.id,
    )
    .await;
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    let edited = t.file("edited.arkyo");
    // The file lost the row of rack `ra` (NOT NULL parent of its slots,
    // of `rr1`, `pc1`, `ly1`); the panel row hangs on a skipped slot.
    let ra = cid("ra");
    edit_archive(&file, &edited, &t.file("uploads"), |b| {
        rows_mut(b, "Rack").retain(|r| r["id"] != json!(ra));
    });
    delete_project(&t, &p1).await;

    let rep = run(&t, &edited, modes(&[])).await.unwrap();
    for (table, n) in [
        ("RackSlot", 3),
        ("RackSlotPanelRow", 1),
        ("RigRack", 1),
        ("RackInventoryItem", 2),
        ("RackConnection", 1),
        ("ProjectConnection", 1),
        ("ProjectSynopticLayout", 1),
    ] {
        let w = format!(
            "{n} ligne(s) de « {table} » ont été ignorées : elles visaient un élément qui n'existe plus."
        );
        assert!(rep.warnings.contains(&w), "{w} / {:?}", rep.warnings);
        assert!(
            !rep.warnings
                .iter()
                .any(|x| x.contains(&format!("de « {table} » existaient"))),
            "{table} / {:?}",
            rep.warnings
        );
        assert_eq!(rep.roots[0].inserted.get(table), None, "{table}");
    }
    assert_eq!(
        count(&t.e.pool, r#"SELECT COUNT(*) FROM "Project""#).await,
        1
    );
    assert_eq!(
        count(&t.e.pool, r#"SELECT COUNT(*) FROM "RackSlotPanelRow""#).await,
        0
    );
    assert_eq!(rep.roots[0].inserted.get("Location"), Some(&1));
}

#[tokio::test]
async fn type_clash_on_an_expression_index_is_not_added() {
    let t = setup().await;
    let p1 = cid("p1");
    let u = t.owner.id.clone();
    exec(
        &t.e.pool,
        r#"INSERT INTO "TenantType" ("id","name","createdAt","updatedAt") VALUES ('<tt1>','Type test',?,?)"#,
        &u,
    )
    .await;
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    // Here, the same (name, no parent) under another id: the unique key is
    // an expression (`COALESCE("parentId", '')`), no local row is found.
    exec(
        &t.e.pool,
        r#"DELETE FROM "TenantType" WHERE "id" = '<tt1>'"#,
        &u,
    )
    .await;
    exec(
        &t.e.pool,
        r#"INSERT INTO "TenantType" ("id","name","createdAt","updatedAt") VALUES ('<ttx>','Type test',?,?)"#,
        &u,
    )
    .await;
    let rep = run(&t, &file, modes(&[(&p1, Mode::Copy)])).await.unwrap();
    assert!(
        rep.warnings.iter().any(|w| {
            w
            == "« Type test » (TenantType) existe déjà ici sous un autre identifiant : non ajouté."
        }),
        "{:?}",
        rep.warnings
    );
    assert_eq!(
        count(
            &t.e.pool,
            r#"SELECT COUNT(*) FROM "TenantType" WHERE "name" = 'Type test'"#
        )
        .await,
        1
    );
    assert_eq!(rep.catalogue_added.get("TenantType"), None);
}

/// A row whose required (NOT NULL) parent is missing is skipped and its id
/// leaves the planned set, so its own dependants are skipped in turn: this
/// holds only if every required parent table is written before its
/// children (catalogue and panels in classification order, then the owned
/// tables), and no required reference points at its own table.
#[tokio::test]
async fn required_parents_come_first_in_insert_order() {
    use arkyo_server::transfer::{classification, owned_tables_in_insert_order, Class};
    let e = env().await;
    let mut order: Vec<&str> = classification()
        .iter()
        .filter(|(_, c)| matches!(c, Class::Catalogue | Class::Dependency))
        .map(|(t, _)| *t)
        .collect();
    order.extend(owned_tables_in_insert_order());
    let pos = |t: &str| order.iter().position(|x| *x == t);
    for (i, table) in order.iter().enumerate() {
        let fks: Vec<(String, String)> = sqlx::query_as(&format!(
            r#"SELECT f."from", f."table" FROM pragma_foreign_key_list('{table}') f
               JOIN pragma_table_info('{table}') c ON c."name" = f."from" WHERE c."notnull" = 1"#
        ))
        .fetch_all(&e.pool)
        .await
        .unwrap();
        for (col, parent) in fks {
            let p = pos(&parent).unwrap_or_else(|| panic!("{table}.{col} → {parent} hors import"));
            assert!(p < i, "{table}.{col} → {parent} écrit après");
        }
    }
}

/// Raw request with a body (and a session cookie).
async fn raw(
    app: &axum::Router,
    method: &str,
    uri: &str,
    cookie: &str,
    body: Vec<u8>,
    json: bool,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let mut b = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::COOKIE, format!("arkyo_session={cookie}"));
    if json {
        b = b.header(header::CONTENT_TYPE, "application/json");
    }
    let mut req = b.body(Body::from(body)).unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(LOCAL.parse::<std::net::SocketAddr>().unwrap()));
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    let bytes = res.into_body().collect().await.unwrap().to_bytes().to_vec();
    (status, headers, bytes)
}

#[tokio::test]
async fn routes_require_settings_admin() {
    let t = setup().await;
    add_user(&t.e.pool, "t@b.fr", "technicien", false).await;
    let token = login(&t.e.app, "t@b.fr").await;
    for (method, uri, body) in [
        (
            "POST",
            "/api/system/transfer/export",
            json!({"roots":[{"kind":"project","id":cid("p1")}]}),
        ),
        ("GET", "/api/system/transfer/objects", Value::Null),
        ("POST", "/api/system/transfer/inspect", json!("x")),
        (
            "POST",
            "/api/system/transfer/import",
            json!({"token":"x","modes":{}}),
        ),
    ] {
        let body = if body.is_null() { None } else { Some(body) };
        let r = call(&t.e.app, method, uri, LOCAL, Some(&token), body).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{uri}");
        assert_eq!(r.body, json!({"error": "Accès refusé"}), "{uri}");
    }
}

#[tokio::test]
async fn inspect_rejects_garbage_with_400() {
    let t = setup().await;
    let token = login(&t.e.app, "o@b.fr").await;
    let (status, _, body) = raw(
        &t.e.app,
        "POST",
        "/api/system/transfer/inspect",
        &token,
        b"pas une archive".to_vec(),
        false,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let v: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v, json!({"error": "Archive invalide."}));
    // Nothing left behind in the temporary folder.
    let tmp = t.file("tmp");
    let left = std::fs::read_dir(&tmp).map(|d| d.count()).unwrap_or(0);
    assert_eq!(left, 0);
}

#[tokio::test]
async fn routes_export_inspect_and_import() {
    let t = setup().await;
    let token = login(&t.e.app, "o@b.fr").await;
    let p1 = cid("p1");

    let r = call(
        &t.e.app,
        "GET",
        "/api/system/transfer/objects",
        LOCAL,
        Some(&token),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["projects"][0]["id"], json!(p1));
    assert_eq!(r.body["projects"][0]["name"], json!("Match"));
    assert!(r.body["projects"][0]["updatedAt"].is_string());
    // `ra` belongs to a project rig, `rb` is no rig's: library racks are
    // those no project rig uses.
    let racks: Vec<&str> = r.body["racks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["id"].as_str().unwrap())
        .collect();
    assert_eq!(racks, vec![cid("rb").as_str()]);
    assert_eq!(r.body["rigs"], json!([]));
    assert_eq!(r.body["panels"][0]["id"], json!(cid("pn1")));

    let (status, headers, bytes) = raw(
        &t.e.app,
        "POST",
        "/api/system/transfer/export",
        &token,
        json!({"roots":[{"kind":"project","id":p1}]})
            .to_string()
            .into_bytes(),
        true,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    assert_eq!(headers[header::CONTENT_TYPE], "application/zip");
    let cd = headers[header::CONTENT_DISPOSITION].to_str().unwrap();
    assert!(cd.starts_with("attachment; filename=\"Match-"), "{cd}");
    assert!(cd.ends_with(".arkyo\""), "{cd}");
    assert_eq!(bytes[..2], *b"PK");
    // The temporary export is removed once served.
    let tmp_left = std::fs::read_dir(t.file("tmp"))
        .map(|d| d.count())
        .unwrap_or(0);
    assert_eq!(tmp_left, 0);

    let (status, _, body) = raw(
        &t.e.app,
        "POST",
        "/api/system/transfer/inspect",
        &token,
        bytes,
        false,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let v: Value = serde_json::from_slice(&body).unwrap();
    let tok = v["token"].as_str().unwrap().to_string();
    let root = &v["preview"]["roots"][0];
    assert_eq!(root["kind"], "project");
    assert_eq!(root["id"], json!(p1));
    assert_eq!(root["name"], "Match");
    assert_eq!(root["exists"], true);
    assert_eq!(root["counts"]["RackSlot"], 3);
    assert_eq!(v["preview"]["manifest"]["format"], "arkyo-server-transfer");
    assert!(t.file(&format!("tmp/{tok}.arkyo")).exists());

    // Present: a mode is required.
    let r = call(
        &t.e.app,
        "POST",
        "/api/system/transfer/import",
        LOCAL,
        Some(&token),
        Some(json!({"token": tok, "modes": {}})),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body,
        json!({"error": "Choisissez Remplacer ou Copie pour « Match »."})
    );

    let r = call(
        &t.e.app,
        "POST",
        "/api/system/transfer/import",
        LOCAL,
        Some(&token),
        Some(json!({"token": tok, "modes": {p1.clone(): "copy"}})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["roots"][0]["mode"], "copy");
    assert_eq!(r.body["roots"][0]["name"], "Match (copie)");
    assert!(r.body["roots"][0]["inserted"]["Rack"].is_number());
    assert!(r.body["catalogueAdded"].is_object());
    assert!(r.body["uploadsCopied"].is_number());
    assert!(r.body["warnings"].is_array());
    assert!(!t.file(&format!("tmp/{tok}.arkyo")).exists());
    assert_eq!(
        count(&t.e.pool, r#"SELECT COUNT(*) FROM "Project""#).await,
        2
    );

    // The token is gone after the import; a forged one is refused.
    for tok in [tok.as_str(), "../arkyo"] {
        let r = call(
            &t.e.app,
            "POST",
            "/api/system/transfer/import",
            LOCAL,
            Some(&token),
            Some(json!({"token": tok, "modes": {}})),
        )
        .await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{tok}");
        assert!(r.body["error"].is_string());
    }
}

#[tokio::test]
async fn same_token_imports_once() {
    let t = setup().await;
    let token = login(&t.e.app, "o@b.fr").await;
    let p1 = cid("p1");
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    let (status, _, body) = raw(
        &t.e.app,
        "POST",
        "/api/system/transfer/inspect",
        &token,
        std::fs::read(&file).unwrap(),
        false,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let tok = serde_json::from_slice::<Value>(&body).unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    let body = json!({"token": tok, "modes": {p1.clone(): "copy"}});
    let (a, b) = tokio::join!(
        call(
            &t.e.app,
            "POST",
            "/api/system/transfer/import",
            LOCAL,
            Some(&token),
            Some(body.clone())
        ),
        call(
            &t.e.app,
            "POST",
            "/api/system/transfer/import",
            LOCAL,
            Some(&token),
            Some(body)
        ),
    );
    let mut statuses = [a.status, b.status];
    statuses.sort();
    assert_eq!(
        statuses,
        [StatusCode::OK, StatusCode::BAD_REQUEST],
        "{:?} {:?}",
        a.body,
        b.body
    );
    let refused = if a.status == StatusCode::OK { &b } else { &a };
    assert_eq!(
        refused.body,
        json!({"error": "Fichier introuvable : choisissez-le à nouveau."})
    );
    assert_eq!(
        count(&t.e.pool, r#"SELECT COUNT(*) FROM "Project""#).await,
        2
    );
    let left = std::fs::read_dir(t.file("tmp")).unwrap().count();
    assert_eq!(left, 0);
}

#[tokio::test]
async fn failed_import_keeps_the_token() {
    let t = setup().await;
    let token = login(&t.e.app, "o@b.fr").await;
    let p1 = cid("p1");
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    let (_, _, body) = raw(
        &t.e.app,
        "POST",
        "/api/system/transfer/inspect",
        &token,
        std::fs::read(&file).unwrap(),
        false,
    )
    .await;
    let tok = serde_json::from_slice::<Value>(&body).unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    // No mode: refused, the file stays for another try.
    let r = call(
        &t.e.app,
        "POST",
        "/api/system/transfer/import",
        LOCAL,
        Some(&token),
        Some(json!({"token": tok, "modes": {}})),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(t.file(&format!("tmp/{tok}.arkyo")).exists());
    let r = call(
        &t.e.app,
        "POST",
        "/api/system/transfer/import",
        LOCAL,
        Some(&token),
        Some(json!({"token": tok, "modes": {p1.clone(): "copy"}})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
}

#[tokio::test]
async fn large_project_exports_quickly() {
    let t = setup().await;
    let p1 = cid("p1");
    sqlx::query(&format!(
        r#"WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000)
           INSERT INTO "RackConnection" ("id","rackId","fromSlotId","fromConnectorIndex","toSlotId","toConnectorIndex","label","createdAt")
           SELECT 'cx' || printf('%023d', i), '{ra}', '{sa1}', i, '{sa2}', i, 'C' || i, '{NOW}' FROM n"#,
        ra = cid("ra"),
        sa1 = cid("sa1"),
        sa2 = cid("sa2"),
    ))
    .execute(&t.e.pool)
    .await
    .unwrap();
    let limit = if cfg!(debug_assertions) { 20.0 } else { 5.0 };
    let started = std::time::Instant::now();
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    let rep = run(&t, &file, modes(&[(&p1, Mode::Copy)])).await.unwrap();
    let secs = started.elapsed().as_secs_f64();
    assert_eq!(rep.roots[0].inserted["RackConnection"], 5001);
    assert!(secs < limit, "{secs:.2} s");
}

/// The `.arkyo` files of a folder, sorted.
fn arkyo_files(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .map(|d| {
            d.flatten()
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| n.ends_with(".arkyo"))
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

#[tokio::test]
async fn replace_snapshot_is_taken_before_the_write_lock() {
    let t = setup().await;
    let p1 = cid("p1");
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    // Another writer holds the write lock meanwhile.
    let mut other = arkyo_server::db::begin_immediate(&t.e.pool).await.unwrap();
    sqlx::query(r#"UPDATE "Project" SET "name" = 'Autre' WHERE "id" = ?"#)
        .bind(&p1)
        .execute(&mut *other)
        .await
        .unwrap();
    let (st, owner, f) = (t.st.clone(), t.owner.clone(), file.clone());
    let opts = modes(&[(&p1, Mode::Replace)]);
    let job = tokio::spawn(async move { import(&st, &owner, &f, opts).await });
    // The point « avant restauration » is written while the lock is held:
    // the import does not hold the write lock while it writes it.
    let dir = t.dir().join("backups/projects").join(&p1);
    let mut found = false;
    for _ in 0..60 {
        if arkyo_files(&dir)
            .iter()
            .any(|n| n.ends_with("-avant-restauration.arkyo"))
        {
            found = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    other.commit().await.unwrap();
    assert!(found, "no point written while another writer held the lock");
    let report = job.await.unwrap().unwrap();
    assert_eq!(report.roots[0].mode, Mode::Replace);
}

#[tokio::test]
async fn import_publishes_root_and_rack_events() {
    let t = setup().await;
    let p1 = cid("p1");
    let file = export(&t, &[(RootKind::Project, &p1)], "p.arkyo").await;
    let mut rx = t.e.events.subscribe();
    run(&t, &file, modes(&[(&p1, Mode::Replace)]))
        .await
        .unwrap();
    let mut events = Vec::new();
    while let Ok(m) = rx.try_recv() {
        events.push(serde_json::from_str::<Value>(&m).unwrap());
    }
    assert!(
        events.contains(&json!({
            "type": "update", "entity": "project", "action": "updated",
            "id": p1, "projectId": p1,
        })),
        "{events:?}"
    );
    for rack in [cid("ra"), cid("rb")] {
        assert!(
            events.contains(&json!({
                "type": "update", "entity": "rack", "action": "updated",
                "id": rack, "projectId": p1, "rackId": rack,
            })),
            "{rack}: {events:?}"
        );
    }
}

#[tokio::test]
async fn replace_of_a_panel_keeps_a_safety_copy() {
    let t = setup().await;
    let pn1 = cid("pn1");
    let file = export(&t, &[(RootKind::Panel, &pn1)], "panel.arkyo").await;
    sqlx::query(r#"UPDATE "Panel" SET "name" = 'Patch modifié' WHERE "id" = ?"#)
        .bind(&pn1)
        .execute(&t.e.pool)
        .await
        .unwrap();
    let report = run(&t, &file, modes(&[(&pn1, Mode::Replace)]))
        .await
        .unwrap();
    let dir = t.dir().join("backups/objects").join(format!("panel-{pn1}"));
    let files = arkyo_files(&dir);
    assert_eq!(files.len(), 1, "{files:?}");
    assert!(files[0].ends_with("-avant-import.arkyo"), "{files:?}");
    assert_eq!(
        report.safety_copies,
        [dir.join(&files[0]).to_string_lossy().into_owned()]
    );
    // The copy holds the state before the import.
    let (m, b) = read_archive(&dir.join(&files[0])).unwrap();
    assert_eq!(m.roots[0].name, "Patch modifié");
    assert_eq!(b.tables["Panel"][0]["name"], "Patch modifié");
    assert_eq!(
        text(
            &t.e.pool,
            r#"SELECT "name" FROM "Panel" WHERE "id" = ?"#,
            &pn1
        )
        .await
        .as_deref(),
        Some("Patch 1")
    );
    // Copy and insert take none; the last 10 copies are kept.
    let r = run(&t, &file, modes(&[(&pn1, Mode::Copy)])).await.unwrap();
    assert!(r.safety_copies.is_empty());
    for _ in 0..11 {
        run(&t, &file, modes(&[(&pn1, Mode::Replace)]))
            .await
            .unwrap();
    }
    assert_eq!(arkyo_files(&dir).len(), 10);
}

#[tokio::test]
async fn a_refused_import_takes_no_point_nor_safety_copy() {
    let t = setup().await;
    let (p1, pn1) = (cid("p1"), cid("pn1"));
    let file = export(
        &t,
        &[(RootKind::Project, &p1), (RootKind::Panel, &pn1)],
        "both.arkyo",
    )
    .await;
    // Replace chosen for one root, no mode for the other (present here).
    for opts in [
        modes(&[(&p1, Mode::Replace)]),
        modes(&[(&pn1, Mode::Replace)]),
    ] {
        match run(&t, &file, opts).await {
            Err(TransferError::Invalid(m)) => assert!(m.starts_with("Choisissez"), "{m}"),
            other => panic!("{other:?}"),
        }
    }
    assert!(!t.file("backups/projects").exists());
    assert!(!t.file("backups/objects").exists());
}
