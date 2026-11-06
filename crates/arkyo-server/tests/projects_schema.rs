//! Phase 3, Task 1: projects, racks and panels schema (migration 0003).
mod common;

use std::path::Path;

use arkyo_server::db::open;
use axum::http::StatusCode;
use common::*;
use serde_json::json;
use sqlx::SqlitePool;

const NOW: &str = "2026-11-06T10:00:00.000Z";

async fn exec(pool: &SqlitePool, sql: &str) {
    sqlx::query(sql)
        .bind(NOW)
        .bind(NOW)
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

async fn try_exec(pool: &SqlitePool, sql: &str) -> Result<(), sqlx::Error> {
    sqlx::query(sql)
        .bind(NOW)
        .bind(NOW)
        .execute(pool)
        .await
        .map(|_| ())
}

async fn count(pool: &SqlitePool, table: &str) -> i64 {
    sqlx::query_scalar(&format!(r#"SELECT COUNT(*) FROM "{table}""#))
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn text(pool: &SqlitePool, sql: &str) -> Option<String> {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

async fn int(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

/// A project `p1` with its sheet, a location `l1`, a rig `g1` linked to it
/// and a rack `r1` placed in the location and in the rig.
async fn project_fixture(pool: &SqlitePool) {
    for sql in [
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('p1','Match','u',?,?)"#,
        r#"INSERT INTO "TechnicalSheet" ("id","projectId","createdAt","updatedAt") VALUES ('ts1','p1',?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","createdAt","updatedAt") VALUES ('l1','p1','Régie',?,?)"#,
        r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt") VALUES ('g1','Régie','p1','u',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","locationId","createdAt","updatedAt") VALUES ('r1','Baie A','l1',?,?)"#,
    ] {
        exec(pool, sql).await;
    }
    sqlx::query(r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId") VALUES ('rr1','g1','r1')"#)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn phase3_tables_exist_with_defaults() {
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    for table in [
        "Project",
        "TechnicalSheet",
        "Location",
        "RigConfig",
        "RigRack",
        "Rack",
        "RackSlot",
        "RackInventoryItem",
        "Panel",
        "PanelSlot",
        "Task",
        "Message",
        "ProjectDocument",
    ] {
        assert_eq!(count(&pool, table).await, 0, "{table}");
    }
    project_fixture(&pool).await;
    let p = r#"FROM "Project" WHERE "id" = 'p1'"#;
    assert_eq!(
        text(&pool, &format!(r#"SELECT "status" {p}"#))
            .await
            .as_deref(),
        Some("EN_PREPARATION")
    );
    assert_eq!(
        text(&pool, &format!(r#"SELECT "interventionType" {p}"#))
            .await
            .as_deref(),
        Some("PRESTATION")
    );
    assert_eq!(text(&pool, &format!(r#"SELECT "rigType" {p}"#)).await, None);
    assert_eq!(
        text(&pool, &format!(r#"SELECT "ipMapPositions" {p}"#)).await,
        None
    );
    let ts = r#"FROM "TechnicalSheet" WHERE "id" = 'ts1'"#;
    assert_eq!(
        text(&pool, &format!(r#"SELECT "blocks" {ts}"#))
            .await
            .as_deref(),
        Some("[]")
    );
    let pct: f64 = sqlx::query_scalar(&format!(r#"SELECT "completionPercent" {ts}"#))
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(pct, 0.0);
    assert_eq!(
        int(
            &pool,
            r#"SELECT "sortOrder" FROM "Location" WHERE "id" = 'l1'"#
        )
        .await,
        0
    );
    let g = r#"FROM "RigConfig" WHERE "id" = 'g1'"#;
    assert_eq!(
        text(&pool, &format!(r#"SELECT "type" {g}"#))
            .await
            .as_deref(),
        Some("FLIGHT_CASE")
    );
    assert_eq!(int(&pool, &format!(r#"SELECT "isTemplate" {g}"#)).await, 0);
    assert_eq!(
        int(
            &pool,
            r#"SELECT "position" FROM "RigRack" WHERE "id" = 'rr1'"#
        )
        .await,
        0
    );

    let r = r#"FROM "Rack" WHERE "id" = 'r1'"#;
    for (col, want) in [
        ("totalU", 42),
        ("depthMm", 600),
        ("cableNextNum", 1),
        ("isRackable", 1),
        ("hasWheels", 0),
        ("isVirtual", 0),
    ] {
        assert_eq!(
            int(&pool, &format!(r#"SELECT "{col}" {r}"#)).await,
            want,
            "Rack.{col}"
        );
    }
    for (col, want) in [
        ("rackType", "STANDARD"),
        ("templateStatus", "BROUILLON"),
        ("prepStatus", "TO_PREPARE"),
        ("sourcing", "STOCK"),
        ("constructionChecks", "[]"),
    ] {
        assert_eq!(
            text(&pool, &format!(r#"SELECT "{col}" {r}"#))
                .await
                .as_deref(),
            Some(want),
            "Rack.{col}"
        );
    }

    exec(
        &pool,
        r#"INSERT INTO "Panel" ("id","name","createdById","createdAt","updatedAt") VALUES ('pn1','Patch','u',?,?)"#,
    )
    .await;
    let pn = r#"FROM "Panel" WHERE "id" = 'pn1'"#;
    assert_eq!(
        text(&pool, &format!(r#"SELECT "panelType" {pn}"#))
            .await
            .as_deref(),
        Some("PATCH")
    );
    for (col, want) in [
        ("heightU", 1),
        ("slotsPerU", 8),
        ("rearCableDepthMm", 80),
        ("private", 0),
    ] {
        assert_eq!(
            int(&pool, &format!(r#"SELECT "{col}" {pn}"#)).await,
            want,
            "Panel.{col}"
        );
    }
    sqlx::query(r#"INSERT INTO "PanelSlot" ("id","panelId","position") VALUES ('ps1','pn1',1)"#)
        .execute(&pool)
        .await
        .unwrap();
    let ps = r#"FROM "PanelSlot" WHERE "id" = 'ps1'"#;
    assert_eq!(int(&pool, &format!(r#"SELECT "sizeSlots" {ps}"#)).await, 1);
    assert_eq!(int(&pool, &format!(r#"SELECT "mountD" {ps}"#)).await, 0);

    exec(
        &pool,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","createdAt","updatedAt") VALUES ('i1','r1',?,?)"#,
    )
    .await;
    assert_eq!(
        int(
            &pool,
            r#"SELECT "quantity" FROM "RackInventoryItem" WHERE "id" = 'i1'"#
        )
        .await,
        1
    );
    exec(
        &pool,
        r#"INSERT INTO "RackSlot" ("id","rackId","createdAt","updatedAt") VALUES ('s1','r1',?,?)"#,
    )
    .await;
    let s = r#"FROM "RackSlot" WHERE "id" = 's1'"#;
    assert_eq!(
        text(&pool, &format!(r#"SELECT "view" {s}"#))
            .await
            .as_deref(),
        Some("FRONT")
    );
    assert_eq!(
        text(&pool, &format!(r#"SELECT "widthFraction" {s}"#))
            .await
            .as_deref(),
        Some("FULL")
    );
    assert_eq!(int(&pool, &format!(r#"SELECT "column" {s}"#)).await, 0);
    assert_eq!(
        text(&pool, &format!(r#"SELECT "snapshotId" {s}"#)).await,
        None
    );

    exec(
        &pool,
        r#"INSERT INTO "Task" ("id","projectId","title","createdAt","updatedAt") VALUES ('t1','p1','Câbler',?,?)"#,
    )
    .await;
    let t = r#"FROM "Task" WHERE "id" = 't1'"#;
    assert_eq!(
        text(&pool, &format!(r#"SELECT "status" {t}"#))
            .await
            .as_deref(),
        Some("A_FAIRE")
    );
    assert_eq!(
        text(&pool, &format!(r#"SELECT "priority" {t}"#))
            .await
            .as_deref(),
        Some("NORMALE")
    );
    assert_eq!(int(&pool, &format!(r#"SELECT "order" {t}"#)).await, 0);
    assert_eq!(
        int(&pool, &format!(r#"SELECT "fromTemplate" {t}"#)).await,
        0
    );
    exec(
        &pool,
        r#"INSERT INTO "Message" ("id","projectId","authorId","content","createdAt","updatedAt") VALUES ('m1','p1','u','Bonjour',?,?)"#,
    )
    .await;
    assert_eq!(
        text(&pool, r#"SELECT "status" FROM "Message" WHERE "id" = 'm1'"#)
            .await
            .as_deref(),
        Some("OUVERTE")
    );
    exec(
        &pool,
        r#"INSERT INTO "ProjectDocument" ("id","projectId","name","url","uploadedAt","uploadedById") VALUES ('d1','p1','Plan','/u/p.pdf',?,?)"#,
    )
    .await;
    assert_eq!(count(&pool, "ProjectDocument").await, 1);
}

#[tokio::test]
async fn project_delete_cascades_like_arkyo() {
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    project_fixture(&pool).await;
    for sql in [
        r#"INSERT INTO "Task" ("id","projectId","title","createdAt","updatedAt") VALUES ('t1','p1','x',?,?)"#,
        r#"INSERT INTO "Message" ("id","projectId","authorId","content","createdAt","updatedAt") VALUES ('m1','p1','u','x',?,?)"#,
        r#"INSERT INTO "ProjectDocument" ("id","projectId","name","url","uploadedAt","uploadedById") VALUES ('d1','p1','x','/x',?,?)"#,
    ] {
        exec(&pool, sql).await;
    }
    sqlx::query(r#"DELETE FROM "Project" WHERE "id" = 'p1'"#)
        .execute(&pool)
        .await
        .unwrap();
    for table in [
        "TechnicalSheet",
        "Location",
        "Task",
        "Message",
        "ProjectDocument",
    ] {
        assert_eq!(count(&pool, table).await, 0, "{table} cascades");
    }
    // SetNull: the rig and the rack survive (the route deletes them, Task 2).
    assert_eq!(
        text(
            &pool,
            r#"SELECT "projectId" FROM "RigConfig" WHERE "id" = 'g1'"#
        )
        .await,
        None
    );
    assert_eq!(
        text(
            &pool,
            r#"SELECT "locationId" FROM "Rack" WHERE "id" = 'r1'"#
        )
        .await,
        None
    );
    assert_eq!(count(&pool, "RigRack").await, 1);
}

#[tokio::test]
async fn rack_and_panel_relations_follow_arkyo() {
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    project_fixture(&pool).await;
    for sql in [
        r#"INSERT INTO "Panel" ("id","name","createdById","createdAt","updatedAt") VALUES ('pn1','Patch','u',?,?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","panelId","createdAt","updatedAt") VALUES ('host','r1','pn1',?,?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","hostItemId","hostSlotIndex","createdAt","updatedAt") VALUES ('comp','r1','host',0,?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","panelId","inventoryItemId","createdAt","updatedAt") VALUES ('shelf','r1','pn1','host',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","parentSlotId","createdAt","updatedAt") VALUES ('child','r1','shelf',?,?)"#,
    ] {
        exec(&pool, sql).await;
    }
    sqlx::query(r#"INSERT INTO "PanelSlot" ("id","panelId","position") VALUES ('ps1','pn1',1)"#)
        .execute(&pool)
        .await
        .unwrap();
    // Unknown parents are refused (real foreign keys).
    assert!(try_exec(
        &pool,
        r#"INSERT INTO "RackSlot" ("id","rackId","createdAt","updatedAt") VALUES ('bad','nope',?,?)"#,
    )
    .await
    .is_err());
    assert!(sqlx::query(
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId") VALUES ('rr2','g1','r1')"#
    )
    .execute(&pool)
    .await
    .is_err());
    // Soft FKs stay plain text.
    exec(
        &pool,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","snapshotId","createdAt","updatedAt") VALUES ('soft','r1','inconnu','x',?,?)"#,
    )
    .await;

    // Panel deleted: slots cascade, rack references set to NULL.
    sqlx::query(r#"DELETE FROM "Panel" WHERE "id" = 'pn1'"#)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(count(&pool, "PanelSlot").await, 0);
    assert_eq!(
        text(
            &pool,
            r#"SELECT "panelId" FROM "RackSlot" WHERE "id" = 'shelf'"#
        )
        .await,
        None
    );
    assert_eq!(
        text(
            &pool,
            r#"SELECT "panelId" FROM "RackInventoryItem" WHERE "id" = 'host'"#
        )
        .await,
        None
    );
    // Host item deleted: components cascade, the slot keeps living.
    sqlx::query(r#"DELETE FROM "RackInventoryItem" WHERE "id" = 'host'"#)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(count(&pool, "RackInventoryItem").await, 0);
    assert_eq!(
        text(
            &pool,
            r#"SELECT "inventoryItemId" FROM "RackSlot" WHERE "id" = 'shelf'"#
        )
        .await,
        None
    );
    // Shelf deleted: its children cascade.
    sqlx::query(r#"DELETE FROM "RackSlot" WHERE "id" = 'shelf'"#)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(count(&pool, "RackSlot").await, 1);
    // Rig deleted: RigRack cascades, the rack stays; rack deleted: its rows go.
    sqlx::query(r#"DELETE FROM "RigConfig" WHERE "id" = 'g1'"#)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(count(&pool, "RigRack").await, 0);
    assert_eq!(count(&pool, "Rack").await, 1);
    sqlx::query(r#"DELETE FROM "Rack" WHERE "id" = 'r1'"#)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(count(&pool, "RackSlot").await, 0);
}

#[tokio::test]
async fn enum_check_rejects_unknown_status() {
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    project_fixture(&pool).await;
    exec(
        &pool,
        r#"INSERT INTO "RackSlot" ("id","rackId","createdAt","updatedAt") VALUES ('s1','r1',?,?)"#,
    )
    .await;
    exec(
        &pool,
        r#"INSERT INTO "Task" ("id","projectId","title","createdAt","updatedAt") VALUES ('t1','p1','x',?,?)"#,
    )
    .await;
    exec(
        &pool,
        r#"INSERT INTO "Message" ("id","projectId","authorId","content","createdAt","updatedAt") VALUES ('m1','p1','u','x',?,?)"#,
    )
    .await;
    for (table, col, id, ok) in [
        ("Project", "status", "p1", "ANNULE"),
        ("Project", "interventionType", "p1", "INTEGRATION"),
        ("Project", "rigType", "p1", "MIXED"),
        ("RigConfig", "type", "g1", "FIXED_INSTALL"),
        ("Rack", "rackType", "r1", "CAP"),
        ("Rack", "templateStatus", "r1", "ACTIF"),
        ("Rack", "prepStatus", "r1", "READY"),
        ("Rack", "sourcing", "r1", "RENTAL"),
        ("RackSlot", "view", "s1", "REAR_INTERIOR"),
        ("RackSlot", "widthFraction", "s1", "QUARTER"),
        ("Task", "status", "t1", "VALIDE"),
        ("Task", "priority", "t1", "URGENTE"),
        ("Message", "status", "m1", "CLOTUREE"),
    ] {
        let sql = format!(r#"UPDATE "{table}" SET "{col}" = ? WHERE "id" = ?"#);
        let set = |v: &'static str| sqlx::query(&sql).bind(v).bind(id).execute(&pool);
        assert!(set("X").await.is_err(), "{table}.{col} accepts 'X'");
        set(ok)
            .await
            .unwrap_or_else(|e| panic!("{table}.{col} = {ok}: {e}"));
    }
    // An optional enum accepts NULL.
    sqlx::query(r#"UPDATE "Project" SET "rigType" = NULL WHERE "id" = 'p1'"#)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn equipment_in_rack_slot_cannot_be_deleted() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    let r = call(
        &e.app,
        "POST",
        "/api/tenant/catalogue/equipment",
        LOCAL,
        Some(&tok),
        Some(json!({"name": "Mélangeur"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let id = r.body["id"].as_str().unwrap().to_string();
    project_fixture(&e.pool).await;
    let in_use =
        json!({"error": "Utilisé dans 1 projet(s) — suppression impossible", "usageCount": 1});
    let uri = format!("/api/tenant/catalogue/equipment/{id}");

    sqlx::query(r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('s1','r1',?,?,?)"#)
        .bind(&id)
        .bind(NOW)
        .bind(NOW)
        .execute(&e.pool)
        .await
        .unwrap();
    let d = call(&e.app, "DELETE", &uri, LOCAL, Some(&tok), None).await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(d.body, in_use);

    sqlx::query(r#"DELETE FROM "RackSlot""#)
        .execute(&e.pool)
        .await
        .unwrap();
    sqlx::query(r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('i1','r1',?,?,?)"#)
        .bind(&id)
        .bind(NOW)
        .bind(NOW)
        .execute(&e.pool)
        .await
        .unwrap();
    let d = call(&e.app, "DELETE", &uri, LOCAL, Some(&tok), None).await;
    assert_eq!(d.status, StatusCode::CONFLICT);
    assert_eq!(d.body, in_use);

    sqlx::query(r#"DELETE FROM "RackInventoryItem""#)
        .execute(&e.pool)
        .await
        .unwrap();
    let d = call(&e.app, "DELETE", &uri, LOCAL, Some(&tok), None).await;
    assert_eq!(d.status, StatusCode::OK, "{:?}", d.body);
}

/// The phase-2 migrator (0001 + 0002, missing migrations ignored like
/// `db::open`) run on a base migrated by this version.
async fn run_phase2_migrator(db: &Path) {
    let migrations = tempfile::tempdir().unwrap();
    for f in ["0001_socle.sql", "0002_catalogue.sql"] {
        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("migrations")
                .join(f),
            migrations.path().join(f),
        )
        .unwrap();
    }
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(db)
        .foreign_keys(true);
    let pool = SqlitePool::connect_with(options).await.unwrap();
    let mut migrator = sqlx::migrate::Migrator::new(migrations.path())
        .await
        .unwrap();
    migrator.set_ignore_missing(true);
    migrator
        .run(&pool)
        .await
        .expect("the phase-2 migrator accepts a base migrated by 0003");
    // Phase-2 code paths still work on the phase-3 tables.
    sqlx::query(r#"DELETE FROM "TenantBrand""#)
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
}

#[tokio::test]
async fn older_binary_tolerates_0003() {
    // Rule of additive migrations, applied to 0003, both ways:
    // - a phase-2 binary (rollback) opens a base carrying 0003;
    // - this binary opens a base of a newer version (unknown migration,
    //   unknown table, new columns with a default on the phase-3 tables).
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    project_fixture(&pool).await;
    pool.close().await;
    run_phase2_migrator(&d.path().join("arkyo.db")).await;

    let pool = open(d.path()).await.unwrap();
    for sql in [
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
         VALUES (9999, 'future phase', 1, X'00', 0)",
        r#"CREATE TABLE "FutureTable" ("id" TEXT PRIMARY KEY, "rackId" TEXT REFERENCES "Rack" ("id") ON DELETE CASCADE)"#,
        r#"ALTER TABLE "Project" ADD COLUMN "futureColumn" TEXT NOT NULL DEFAULT ''"#,
        r#"ALTER TABLE "Rack" ADD COLUMN "futureColumn" INTEGER NOT NULL DEFAULT 0"#,
        r#"ALTER TABLE "RackSlot" ADD COLUMN "futureColumn" TEXT"#,
        r#"INSERT INTO "FutureTable" ("id","rackId") VALUES ('f1','r1')"#,
    ] {
        sqlx::query(sql).execute(&pool).await.unwrap();
    }
    pool.close().await;
    let pool = open(d.path())
        .await
        .expect("this binary opens a base of a newer version");
    assert_eq!(count(&pool, "Project").await, 1);
    assert_eq!(count(&pool, "FutureTable").await, 1);
    // Writes of this version ignore the unknown columns (they have defaults).
    exec(
        &pool,
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('p2','Autre','u',?,?)"#,
    )
    .await;
    exec(
        &pool,
        r#"INSERT INTO "RackSlot" ("id","rackId","createdAt","updatedAt") VALUES ('s1','r1',?,?)"#,
    )
    .await;
    sqlx::query(r#"DELETE FROM "Project" WHERE "id" = 'p1'"#)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(r#"DELETE FROM "Rack" WHERE "id" = 'r1'"#)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(count(&pool, "FutureTable").await, 0);
    assert_eq!(count(&pool, "RackSlot").await, 0);
}
