//! Phase 4a, Task 1: project editor schema (migration 0004).
mod common;

use std::path::Path;

use arkyo_server::db::open;
use axum::http::StatusCode;
use common::*;
use serde_json::json;
use sqlx::SqlitePool;

const NOW: &str = "2026-11-06T10:00:00.000Z";

/// The 15 tables of migration 0004.
const EDITOR_TABLES: [&str; 15] = [
    "ProjectEquipment",
    "RackZone",
    "RackLabel",
    "CableBundle",
    "RackSlotPanelRow",
    "SynopticAdapter",
    "ExternalPort",
    "RackConnection",
    "ProjectSynopticAdapter",
    "ProjectCableBundle",
    "ProjectConnection",
    "ProjectSynopticZone",
    "ProjectSynopticLabel",
    "SynopticGuide",
    "ProjectSynopticLayout",
];

/// Runs `sql`, binding `NOW` to every `?`.
async fn try_exec(pool: &SqlitePool, sql: &str) -> Result<(), sqlx::Error> {
    let mut q = sqlx::query(sql);
    for _ in 0..sql.matches('?').count() {
        q = q.bind(NOW);
    }
    q.execute(pool).await.map(|_| ())
}

async fn exec(pool: &SqlitePool, sql: &str) {
    try_exec(pool, sql)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
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

async fn real(pool: &SqlitePool, sql: &str) -> f64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

/// A project `p1` with a location `l1`, two racks `r1` (in `l1`) and `r2`,
/// two slots `s1` / `s2` in `r1`, a host item `host` and its component `comp`.
async fn project_fixture(pool: &SqlitePool) {
    for sql in [
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('p1','Match','u',?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","createdAt","updatedAt") VALUES ('l1','p1','Régie',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","locationId","createdAt","updatedAt") VALUES ('r1','Baie A','l1',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","locationId","createdAt","updatedAt") VALUES ('r2','Baie B','l1',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","createdAt","updatedAt") VALUES ('s1','r1',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","createdAt","updatedAt") VALUES ('s2','r1',?,?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","createdAt","updatedAt") VALUES ('host','r1',?,?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","hostItemId","hostSlotIndex","createdAt","updatedAt") VALUES ('comp','r1','host',0,?,?)"#,
    ] {
        exec(pool, sql).await;
    }
}

/// One row (at least) in each of the 15 editor tables, with only the
/// required columns, so that the defaults apply.
async fn editor_fixture(pool: &SqlitePool) {
    for sql in [
        r#"INSERT INTO "ProjectEquipment" ("id","projectId","catalogEquipmentId") VALUES ('pe1','p1','eq')"#,
        r#"INSERT INTO "RackZone" ("id","rackId","x","y","w","h","createdAt","updatedAt") VALUES ('z1','r1',0,0,100,50,?,?)"#,
        r#"INSERT INTO "RackLabel" ("id","rackId","x","y","createdAt","updatedAt") VALUES ('lb1','r1',10,20,?,?)"#,
        r#"INSERT INTO "CableBundle" ("id","rackId","name","createdAt","updatedAt") VALUES ('b1','r1','Faisceau',?,?)"#,
        r#"INSERT INTO "RackSlotPanelRow" ("id","slotId","rowIndex","synopticX","synopticY","createdAt","updatedAt") VALUES ('pr1','s1',0,1.5,2.5,?,?)"#,
        r#"INSERT INTO "SynopticAdapter" ("id","rackId","x","y","attachedSlotId","attachedSide","attachedPortIndex","createdAt","updatedAt") VALUES ('a1','r1',5,6,'s2','left',0,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('e1','r1','s1',0,?,?)"#,
        // slot -> adapter, in a bundle
        r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","fromConnectorIndex","toAdapterId","toAdapterSide","toAdapterPortIndex","bundleId","createdAt") VALUES ('c1','r1','s1',0,'a1','left',0,'b1',?)"#,
        // slot -> slot
        r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","fromConnectorIndex","toSlotId","toConnectorIndex","createdAt") VALUES ('c2','r1','s1',1,'s2',0,?)"#,
        // component port (host slot kept as anchor)
        r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","fromComponentItemId","fromConnectorIndex","createdAt") VALUES ('c3','r1','s1','comp',0,?)"#,
        r#"INSERT INTO "ProjectSynopticAdapter" ("id","projectId","x","y","createdAt","updatedAt") VALUES ('pa1','p1',1,2,?,?)"#,
        r#"INSERT INTO "ProjectCableBundle" ("id","projectId","name","createdAt","updatedAt") VALUES ('pb1','p1','Multi',?,?)"#,
        // inter-rack, r1 -> project adapter on r2
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","toAdapterId","toAdapterPortIndex","toAdapterSide","bundleId","createdAt") VALUES ('pc1','p1','r1','s1',2,'r2','pa1',0,'right','pb1',?)"#,
        // r2 -> r2, survives the deletion of r1
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","toRackId","createdAt") VALUES ('pc2','p1','r2','r2',?)"#,
        r#"INSERT INTO "ProjectSynopticZone" ("id","projectId","x","y","w","h","color","createdAt","updatedAt") VALUES ('pz1','p1',0,0,10,10,'#ff0000',?,?)"#,
        r#"INSERT INTO "ProjectSynopticLabel" ("id","projectId","x","y","text","createdAt","updatedAt") VALUES ('pl1','p1',3,4,'Plateau',?,?)"#,
        r#"INSERT INTO "SynopticGuide" ("id","rackId","axis","position","createdAt","updatedAt") VALUES ('gr1','r1','h',120,?,?)"#,
        r#"INSERT INTO "SynopticGuide" ("id","projectId","axis","position","createdAt","updatedAt") VALUES ('gp1','p1','v',80,?,?)"#,
        r#"INSERT INTO "ProjectSynopticLayout" ("id","projectId","rackId","x","y","createdAt","updatedAt") VALUES ('ly1','p1','r1',7,8,?,?)"#,
        r#"INSERT INTO "ProjectSynopticLayout" ("id","projectId","rackId","x","y","createdAt","updatedAt") VALUES ('ly2','p1','r2',9,9,?,?)"#,
    ] {
        exec(pool, sql).await;
    }
}

#[tokio::test]
async fn editor_tables_exist_with_defaults() {
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    for table in EDITOR_TABLES {
        assert_eq!(count(&pool, table).await, 0, "{table}");
    }
    project_fixture(&pool).await;
    editor_fixture(&pool).await;

    assert_eq!(
        int(
            &pool,
            r#"SELECT "quantity" FROM "ProjectEquipment" WHERE "id" = 'pe1'"#
        )
        .await,
        1
    );

    let z = r#"FROM "RackZone" WHERE "id" = 'z1'"#;
    for (col, want) in [
        ("label", "Zone"),
        ("labelPosition", "top-left"),
        ("color", "#6366f1"),
        ("borderStyle", "solid"),
        ("labelFontWeight", "normal"),
        ("labelFontStyle", "normal"),
        ("labelTextDecoration", "none"),
    ] {
        assert_eq!(
            text(&pool, &format!(r#"SELECT "{col}" {z}"#))
                .await
                .as_deref(),
            Some(want),
            "RackZone.{col}"
        );
    }
    for (col, want) in [
        ("borderRadius", 8),
        ("borderWidth", 2),
        ("labelFontSize", 12),
    ] {
        assert_eq!(
            int(&pool, &format!(r#"SELECT "{col}" {z}"#)).await,
            want,
            "RackZone.{col}"
        );
    }
    assert_eq!(real(&pool, &format!(r#"SELECT "opacity" {z}"#)).await, 0.12);
    assert_eq!(
        text(&pool, &format!(r#"SELECT "labelFontFamily" {z}"#)).await,
        None
    );

    let lb = r#"FROM "RackLabel" WHERE "id" = 'lb1'"#;
    for (col, want) in [
        ("text", "Libellé"),
        ("color", "#111827"),
        ("fontWeight", "normal"),
        ("fontStyle", "normal"),
        ("textDecoration", "none"),
    ] {
        assert_eq!(
            text(&pool, &format!(r#"SELECT "{col}" {lb}"#))
                .await
                .as_deref(),
            Some(want),
            "RackLabel.{col}"
        );
    }
    for (col, want) in [("fontSize", 14), ("pill", 0), ("pillRadius", 12)] {
        assert_eq!(
            int(&pool, &format!(r#"SELECT "{col}" {lb}"#)).await,
            want,
            "RackLabel.{col}"
        );
    }
    for col in ["width", "fontFamily", "pillBg"] {
        let v: Option<String> =
            sqlx::query_scalar(&format!(r#"SELECT CAST("{col}" AS TEXT) {lb}"#))
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(v, None, "RackLabel.{col}");
    }

    for (table, id) in [("CableBundle", "b1"), ("ProjectCableBundle", "pb1")] {
        assert_eq!(
            text(
                &pool,
                &format!(r#"SELECT "color" FROM "{table}" WHERE "id" = '{id}'"#)
            )
            .await
            .as_deref(),
            Some("#6366f1"),
            "{table}.color"
        );
    }
    assert_eq!(
        text(
            &pool,
            r#"SELECT "kind" FROM "ExternalPort" WHERE "id" = 'e1'"#
        )
        .await
        .as_deref(),
        Some("INTER_LIEU")
    );
    for (table, id) in [("RackConnection", "c1"), ("ProjectConnection", "pc1")] {
        let w = format!(r#"FROM "{table}" WHERE "id" = '{id}'"#);
        assert_eq!(int(&pool, &format!(r#"SELECT "wired" {w}"#)).await, 0);
        for col in [
            "catalogCableModelId",
            "wiredAt",
            "label",
            "waypoints",
            "tags",
        ] {
            assert_eq!(
                text(&pool, &format!(r#"SELECT "{col}" {w}"#)).await,
                None,
                "{table}.{col}"
            );
        }
    }
    // snapshotId: present, nullable, always NULL (SaaS snapshots).
    for (table, id) in [
        ("RackConnection", "c1"),
        ("SynopticAdapter", "a1"),
        ("ProjectSynopticAdapter", "pa1"),
    ] {
        assert_eq!(
            text(
                &pool,
                &format!(r#"SELECT "snapshotId" FROM "{table}" WHERE "id" = '{id}'"#)
            )
            .await,
            None,
            "{table}.snapshotId"
        );
    }
    assert_eq!(
        text(
            &pool,
            r#"SELECT "color" FROM "SynopticGuide" WHERE "id" = 'gr1'"#
        )
        .await
        .as_deref(),
        Some("#06b6d4")
    );
    assert_eq!(
        int(
            &pool,
            r#"SELECT "isExpanded" FROM "ProjectSynopticLayout" WHERE "id" = 'ly1'"#
        )
        .await,
        1
    );

    // ExternalPortKind is a TEXT CHECK.
    let set_kind = |v: &'static str| {
        sqlx::query(r#"UPDATE "ExternalPort" SET "kind" = ? WHERE "id" = 'e1'"#)
            .bind(v)
            .execute(&pool)
    };
    assert!(
        set_kind("X").await.is_err(),
        "ExternalPort.kind accepts 'X'"
    );
    set_kind("MONDE").await.unwrap();

    // Required columns without a default are required.
    for sql in [
        r#"INSERT INTO "ProjectSynopticZone" ("id","projectId","x","y","w","h","createdAt","updatedAt") VALUES ('nz','p1',0,0,1,1,?,?)"#,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","createdAt") VALUES ('nc','p1','r1',?)"#,
        r#"INSERT INTO "SynopticGuide" ("id","rackId","position","createdAt","updatedAt") VALUES ('ng','r1',1,?,?)"#,
        r#"INSERT INTO "RackZone" ("id","rackId","x","y","w","createdAt","updatedAt") VALUES ('nzz','r1',0,0,1,?,?)"#,
    ] {
        assert!(try_exec(&pool, sql).await.is_err(), "{sql}");
    }

    // Arkyo's indexes, plus the RackConnection ones of decision 10.
    for (name, unique) in [
        ("ProjectEquipment_projectId_catalogEquipmentId_key", 1),
        ("ProjectEquipment_projectId_idx", 0),
        ("ExternalPort_slotId_portIndex_key", 1),
        ("ExternalPort_rackId_idx", 0),
        ("RackConnection_snapshotId_idx", 0),
        ("RackConnection_rackId_idx", 0),
        ("RackConnection_fromSlotId_idx", 0),
        ("RackConnection_toSlotId_idx", 0),
        ("RackSlotPanelRow_slotId_rowIndex_key", 1),
        ("SynopticAdapter_snapshotId_idx", 0),
        ("ProjectConnection_projectId_idx", 0),
        ("ProjectConnection_fromSlotId_idx", 0),
        ("ProjectConnection_toSlotId_idx", 0),
        ("ProjectSynopticAdapter_projectId_idx", 0),
        ("ProjectSynopticAdapter_snapshotId_idx", 0),
        ("ProjectCableBundle_projectId_idx", 0),
        ("ProjectSynopticZone_projectId_idx", 0),
        ("ProjectSynopticLabel_projectId_idx", 0),
        ("SynopticGuide_rackId_idx", 0),
        ("SynopticGuide_projectId_idx", 0),
        ("ProjectSynopticLayout_projectId_rackId_key", 1),
        ("ProjectSynopticLayout_projectId_idx", 0),
    ] {
        let sql = format!(
            r#"SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = '{name}' AND (sql LIKE 'CREATE UNIQUE%') = {unique}"#
        );
        assert_eq!(int(&pool, &sql).await, 1, "index {name}");
    }
}

#[tokio::test]
async fn editor_unique_and_set_null_follow_arkyo() {
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    project_fixture(&pool).await;
    editor_fixture(&pool).await;

    // Unique constraints.
    for sql in [
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('e2','r1','s1',0,?,?)"#,
        r#"INSERT INTO "RackSlotPanelRow" ("id","slotId","rowIndex","synopticX","synopticY","createdAt","updatedAt") VALUES ('pr2','s1',0,0,0,?,?)"#,
        r#"INSERT INTO "ProjectSynopticLayout" ("id","projectId","rackId","x","y","createdAt","updatedAt") VALUES ('ly3','p1','r1',0,0,?,?)"#,
        r#"INSERT INTO "ProjectEquipment" ("id","projectId","catalogEquipmentId") VALUES ('pe2','p1','eq')"#,
    ] {
        assert!(try_exec(&pool, sql).await.is_err(), "{sql}");
    }
    // Unknown parents are refused; soft FKs stay plain text.
    for sql in [
        r#"INSERT INTO "RackZone" ("id","rackId","x","y","w","h","createdAt","updatedAt") VALUES ('zx','nope',0,0,1,1,?,?)"#,
        r#"INSERT INTO "RackConnection" ("id","rackId","bundleId","createdAt") VALUES ('cx','r1','nope',?)"#,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","toRackId","createdAt") VALUES ('pcx','p1','r1','nope',?)"#,
    ] {
        assert!(try_exec(&pool, sql).await.is_err(), "{sql}");
    }
    exec(
        &pool,
        r#"INSERT INTO "RackConnection" ("id","rackId","catalogCableModelId","snapshotId","createdAt") VALUES ('soft','r1','inconnu','x',?)"#,
    )
    .await;

    // Bundles deleted: their cables lose the bundle (SetNull).
    for sql in [
        r#"DELETE FROM "CableBundle" WHERE "id" = 'b1'"#,
        r#"DELETE FROM "ProjectCableBundle" WHERE "id" = 'pb1'"#,
    ] {
        exec(&pool, sql).await;
    }
    for (table, id) in [("RackConnection", "c1"), ("ProjectConnection", "pc1")] {
        assert_eq!(
            text(
                &pool,
                &format!(r#"SELECT "bundleId" FROM "{table}" WHERE "id" = '{id}'"#)
            )
            .await,
            None,
            "{table}.bundleId"
        );
    }
    // Component removed: its connections go.
    exec(
        &pool,
        r#"DELETE FROM "RackInventoryItem" WHERE "id" = 'comp'"#,
    )
    .await;
    assert_eq!(
        int(
            &pool,
            r#"SELECT COUNT(*) FROM "RackConnection" WHERE "id" = 'c3'"#
        )
        .await,
        0
    );
    // Slot s2 removed: the attached adapter is detached (SetNull), the
    // connection to s2 goes (Cascade).
    exec(&pool, r#"DELETE FROM "RackSlot" WHERE "id" = 's2'"#).await;
    assert_eq!(
        text(
            &pool,
            r#"SELECT "attachedSlotId" FROM "SynopticAdapter" WHERE "id" = 'a1'"#
        )
        .await,
        None
    );
    assert_eq!(
        int(
            &pool,
            r#"SELECT COUNT(*) FROM "RackConnection" WHERE "id" = 'c2'"#
        )
        .await,
        0
    );
    // Adapters removed: their connections go.
    exec(&pool, r#"DELETE FROM "SynopticAdapter" WHERE "id" = 'a1'"#).await;
    exec(
        &pool,
        r#"DELETE FROM "ProjectSynopticAdapter" WHERE "id" = 'pa1'"#,
    )
    .await;
    assert_eq!(
        int(
            &pool,
            r#"SELECT COUNT(*) FROM "RackConnection" WHERE "id" = 'c1'"#
        )
        .await,
        0
    );
    assert_eq!(
        int(
            &pool,
            r#"SELECT COUNT(*) FROM "ProjectConnection" WHERE "id" = 'pc1'"#
        )
        .await,
        0
    );
    // Slot s1 removed: its panel rows, external ports and connections go.
    exec(&pool, r#"DELETE FROM "RackSlot" WHERE "id" = 's1'"#).await;
    assert_eq!(count(&pool, "RackSlotPanelRow").await, 0);
    assert_eq!(count(&pool, "ExternalPort").await, 0);
}

#[tokio::test]
async fn rack_delete_cascades_editor_rows() {
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    project_fixture(&pool).await;
    editor_fixture(&pool).await;

    exec(&pool, r#"DELETE FROM "Rack" WHERE "id" = 'r1'"#).await;
    for table in [
        "RackZone",
        "RackLabel",
        "CableBundle",
        "RackConnection",
        "SynopticAdapter",
        "ExternalPort",
        "RackSlotPanelRow",
    ] {
        assert_eq!(count(&pool, table).await, 0, "{table} cascades");
    }
    // Rack-scoped rows of the project tables go with the rack.
    for (sql, want) in [
        (
            r#"SELECT COUNT(*) FROM "SynopticGuide" WHERE "rackId" IS NOT NULL"#,
            0,
        ),
        (
            r#"SELECT COUNT(*) FROM "SynopticGuide" WHERE "projectId" = 'p1'"#,
            1,
        ),
        (
            r#"SELECT COUNT(*) FROM "ProjectSynopticLayout" WHERE "rackId" = 'r1'"#,
            0,
        ),
        (
            r#"SELECT COUNT(*) FROM "ProjectSynopticLayout" WHERE "rackId" = 'r2'"#,
            1,
        ),
        (
            r#"SELECT COUNT(*) FROM "ProjectConnection" WHERE "id" = 'pc1'"#,
            0,
        ),
        (
            r#"SELECT COUNT(*) FROM "ProjectConnection" WHERE "id" = 'pc2'"#,
            1,
        ),
    ] {
        assert_eq!(int(&pool, sql).await, want, "{sql}");
    }
    // Project-scoped rows stay with the project.
    for table in [
        "ProjectEquipment",
        "ProjectSynopticAdapter",
        "ProjectCableBundle",
        "ProjectSynopticZone",
        "ProjectSynopticLabel",
    ] {
        assert_eq!(count(&pool, table).await, 1, "{table} survives the rack");
    }

    // Project deleted: every project-scoped editor row goes.
    exec(&pool, r#"DELETE FROM "Project" WHERE "id" = 'p1'"#).await;
    for table in EDITOR_TABLES {
        assert_eq!(count(&pool, table).await, 0, "{table} after project delete");
    }
    // The rack r2 lives on (Location SetNull, the route deletes it).
    assert_eq!(count(&pool, "Rack").await, 1);
}

#[tokio::test]
async fn cable_and_adapter_in_use_guards_active() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    project_fixture(&e.pool).await;
    let mut ids = Vec::new();
    for kind in ["cables", "adapters"] {
        let r = call(
            &e.app,
            "POST",
            &format!("/api/tenant/catalogue/{kind}"),
            LOCAL,
            Some(&tok),
            Some(json!({"name": "Utilisé"})),
        )
        .await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        ids.push(r.body["id"].as_str().unwrap().to_string());
    }
    let (cable, adapter) = (&ids[0], &ids[1]);

    for (sql, id) in [
        (
            r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","toSlotId","catalogCableModelId","createdAt") VALUES ('c1','r1','s1','s2',?,?)"#,
            cable,
        ),
        (
            r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","toRackId","catalogCableModelId","createdAt") VALUES ('pc1','p1','r1','r2',?,?)"#,
            cable,
        ),
        (
            r#"INSERT INTO "SynopticAdapter" ("id","rackId","x","y","catalogAdapterId","createdAt","updatedAt") VALUES ('a1','r1',0,0,?,?,?)"#,
            adapter,
        ),
        (
            r#"INSERT INTO "ProjectSynopticAdapter" ("id","projectId","x","y","catalogAdapterId","createdAt","updatedAt") VALUES ('pa1','p1',0,0,?,?,?)"#,
            adapter,
        ),
    ] {
        let mut q = sqlx::query(sql).bind(id);
        for _ in 1..sql.matches('?').count() {
            q = q.bind(NOW);
        }
        q.execute(&e.pool).await.unwrap();
    }

    for (kind, id, unit) in [
        ("cables", cable, "connexion(s)"),
        ("adapters", adapter, "synoptique(s)"),
    ] {
        let uri = format!("/api/tenant/catalogue/{kind}/{id}");
        let d = call(&e.app, "DELETE", &uri, LOCAL, Some(&tok), None).await;
        assert_eq!(d.status, StatusCode::CONFLICT, "{kind}: {:?}", d.body);
        assert_eq!(
            d.body,
            json!({"error": format!("Utilisé dans 2 {unit} — suppression impossible"), "usageCount": 2})
        );
    }

    // Once the editor rows are gone, the deletes go through.
    for table in [
        "RackConnection",
        "ProjectConnection",
        "SynopticAdapter",
        "ProjectSynopticAdapter",
    ] {
        exec(&e.pool, &format!(r#"DELETE FROM "{table}""#)).await;
    }
    for (kind, id) in [("cables", cable), ("adapters", adapter)] {
        let uri = format!("/api/tenant/catalogue/{kind}/{id}");
        let d = call(&e.app, "DELETE", &uri, LOCAL, Some(&tok), None).await;
        assert_eq!(d.status, StatusCode::OK, "{kind}: {:?}", d.body);
    }
}

/// The phase-3 migrator (0001 to 0003, missing migrations ignored like
/// `db::open`) run on a base migrated by this version.
async fn run_phase3_migrator(db: &Path) {
    let migrations = tempfile::tempdir().unwrap();
    for f in ["0001_socle.sql", "0002_catalogue.sql", "0003_projets.sql"] {
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
        .expect("the phase-3 migrator accepts a base migrated by 0004");
    // Phase-3 code paths still work on a base carrying editor rows: deleting
    // a slot and a rack cascades through the 0004 tables.
    for sql in [
        r#"DELETE FROM "RackSlot" WHERE "id" = 's2'"#,
        r#"DELETE FROM "Rack" WHERE "id" = 'r2'"#,
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('r3','Baie C',?,?)"#,
    ] {
        try_exec(&pool, sql)
            .await
            .unwrap_or_else(|e| panic!("phase 3: {sql}: {e}"));
    }
    pool.close().await;
}

#[tokio::test]
async fn older_binary_tolerates_0004() {
    // Rule of additive migrations, applied to 0004, both ways:
    // - a phase-3 binary (rollback) opens a base carrying 0004;
    // - this binary opens a base of a newer version (unknown migration,
    //   unknown table, new columns with a default on the 0004 tables).
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    project_fixture(&pool).await;
    editor_fixture(&pool).await;
    pool.close().await;
    run_phase3_migrator(&d.path().join("arkyo.db")).await;

    let pool = open(d.path()).await.unwrap();
    assert_eq!(count(&pool, "Rack").await, 2);
    assert_eq!(
        int(
            &pool,
            r#"SELECT COUNT(*) FROM "ProjectConnection" WHERE "id" = 'pc2'"#
        )
        .await,
        0,
        "r2 deleted by the phase-3 binary took its connections"
    );
    for sql in [
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
         VALUES (9999, 'future phase', 1, X'00', 0)",
        r#"CREATE TABLE "FutureTable" ("id" TEXT PRIMARY KEY, "connectionId" TEXT REFERENCES "RackConnection" ("id") ON DELETE CASCADE)"#,
        r#"ALTER TABLE "RackConnection" ADD COLUMN "futureColumn" TEXT NOT NULL DEFAULT ''"#,
        r#"ALTER TABLE "SynopticAdapter" ADD COLUMN "futureColumn" INTEGER NOT NULL DEFAULT 0"#,
        r#"ALTER TABLE "ProjectConnection" ADD COLUMN "futureColumn" TEXT"#,
        r#"INSERT INTO "FutureTable" ("id","connectionId") VALUES ('f1','c1')"#,
    ] {
        sqlx::query(sql).execute(&pool).await.unwrap();
    }
    pool.close().await;
    let pool = open(d.path())
        .await
        .expect("this binary opens a base of a newer version");
    assert_eq!(count(&pool, "FutureTable").await, 1);
    // Writes of this version ignore the unknown columns (they have defaults).
    for sql in [
        r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","createdAt") VALUES ('c9','r1','s1',?)"#,
        r#"INSERT INTO "SynopticAdapter" ("id","rackId","x","y","createdAt","updatedAt") VALUES ('a9','r1',0,0,?,?)"#,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","toRackId","createdAt") VALUES ('pc9','p1','r1','r1',?)"#,
    ] {
        exec(&pool, sql).await;
    }
    exec(&pool, r#"DELETE FROM "Rack" WHERE "id" = 'r1'"#).await;
    for table in [
        "FutureTable",
        "RackConnection",
        "SynopticAdapter",
        "ProjectConnection",
    ] {
        assert_eq!(count(&pool, table).await, 0, "{table}");
    }
}
