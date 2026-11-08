//! Sauvegardes, Task 1: the table graph of a transferable object
//! (`transfer::collect`, spec 2026-11-07-sauvegardes-design §3.1–3.2) and
//! the classification of every table of the base.
mod common;
use std::collections::BTreeSet;

use arkyo_server::transfer::{
    classification, collect, owned_tables_in_insert_order, Bundle, Class, RootKind, TransferError,
};
use common::*;
use serde_json::Value;
use sqlx::SqlitePool;

const NOW: &str = "2026-11-07T10:00:00.000Z";

async fn exec(pool: &SqlitePool, sql: &str) {
    let mut q = sqlx::query(sql);
    for _ in 0..sql.matches('?').count() {
        q = q.bind(NOW);
    }
    q.execute(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

/// Project `p1`: location `loc1`, rig `rg1` holding rack `ra`, rack `rb`
/// attached to `loc1`. `ra`: slot `sa1` (equipment `eq1`, whose component is
/// `eq2`), slot `sa2` (panel `pn1`, two slots), inventory item `ii1`
/// (adapter `ad1`), a panel row, a zone, a label, a bundle, an external
/// port, a guide and a rack connection `rc1`. `rb`: a synoptic adapter.
/// Project-level rows: sheet, document (`/uploads/documents/a.pdf`), task,
/// message, equipment, adapter, bundle, connection `pc1`, zone, label,
/// guide, layout, and audit rows. Project `p2` (rig `rgx`, rack `rx`, slot
/// on `eq3`, panel `pn2`) and library rack `rl` must stay out of `p1`.
async fn seed(pool: &SqlitePool) {
    for sql in [
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('p1','Match','u',?,?)"#,
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('p2','Autre','u',?,?)"#,
        r#"INSERT INTO "TechnicalSheet" ("id","projectId","createdAt","updatedAt") VALUES ('ts1','p1',?,?)"#,
        r#"INSERT INTO "ProjectDocument" ("id","projectId","name","url","uploadedAt") VALUES ('doc1','p1','Plan','/uploads/documents/a.pdf',?)"#,
        r#"INSERT INTO "Task" ("id","projectId","title","createdAt","updatedAt") VALUES ('t1','p1','Câbler',?,?)"#,
        r#"INSERT INTO "Message" ("id","projectId","authorId","content","createdAt","updatedAt") VALUES ('m1','p1','u','Bonjour',?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","createdAt","updatedAt") VALUES ('loc1','p1','Plateau',?,?)"#,
        r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt") VALUES ('rg1','Régie 1','p1','u',?,?)"#,
        r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt") VALUES ('rgx','Autre','p2','u',?,?)"#,
        r#"INSERT INTO "RigConfig" ("id","name","isTemplate","createdById","createdAt","updatedAt") VALUES ('rgt','Modèle',1,'u',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('ra','Baie A',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","locationId","createdAt","updatedAt") VALUES ('rb','Baie B','loc1',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('rx','Baie X',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('rl','Valise',?,?)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr1','rg1','ra',0)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr2','rgx','rx',0)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr3','rgt','rl',0)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","createdById","createdAt","updatedAt") VALUES ('eq1','Caméra','u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","imageUrl","createdById","createdAt","updatedAt") VALUES ('eq2','Carte','/uploads/catalogue/carte.png','u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","createdById","createdAt","updatedAt") VALUES ('eq3','Écran','u',?,?)"#,
        r#"INSERT INTO "TenantEquipmentComponent" ("id","hostId","componentId","slotIndex","createdAt") VALUES ('ec1','eq1','eq2',0,?)"#,
        r#"INSERT INTO "TenantAdapter" ("id","name","createdById","createdAt","updatedAt") VALUES ('ad1','Coupleur','u',?,?)"#,
        r#"INSERT INTO "TenantAdapter" ("id","name","createdById","createdAt","updatedAt") VALUES ('ad2','Autre','u',?,?)"#,
        r#"INSERT INTO "Panel" ("id","name","createdById","createdAt","updatedAt") VALUES ('pn1','Patch 1','u',?,?)"#,
        r#"INSERT INTO "Panel" ("id","name","createdById","createdAt","updatedAt") VALUES ('pn2','Patch 2','u',?,?)"#,
        r#"INSERT INTO "PanelSlot" ("id","panelId","position") VALUES ('ps1','pn1',0)"#,
        r#"INSERT INTO "PanelSlot" ("id","panelId","position") VALUES ('ps2','pn1',1)"#,
        r#"INSERT INTO "PanelSlot" ("id","panelId","position") VALUES ('ps3','pn2',0)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogAdapterId","createdAt","updatedAt") VALUES ('ii1','ra','ad1',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('sa1','ra','eq1',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","panelId","createdAt","updatedAt") VALUES ('sa2','ra','pn1',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('sx1','rx','eq3',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","panelId","createdAt","updatedAt") VALUES ('sx2','rx','pn2',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","createdAt","updatedAt") VALUES ('sl1','rl',?,?)"#,
        r#"INSERT INTO "RackSlotPanelRow" ("id","slotId","rowIndex","synopticX","synopticY","createdAt","updatedAt") VALUES ('pr1','sa2',0,0,0,?,?)"#,
        r#"INSERT INTO "RackZone" ("id","rackId","x","y","w","h","createdAt","updatedAt") VALUES ('z1','ra',0,0,10,10,?,?)"#,
        r#"INSERT INTO "RackLabel" ("id","rackId","x","y","createdAt","updatedAt") VALUES ('l1','ra',0,0,?,?)"#,
        r#"INSERT INTO "CableBundle" ("id","rackId","name","createdAt","updatedAt") VALUES ('cb1','ra','Faisceau',?,?)"#,
        r#"INSERT INTO "SynopticAdapter" ("id","rackId","catalogAdapterId","x","y","createdAt","updatedAt") VALUES ('sad1','rb','ad1',0,0,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('ep1','ra','sa1',0,?,?)"#,
        r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","fromConnectorIndex","toSlotId","toConnectorIndex","bundleId","createdAt") VALUES ('rc1','ra','sa1',0,'sa2',0,'cb1',?)"#,
        r#"INSERT INTO "RackConnection" ("id","rackId","createdAt") VALUES ('rcx','rx',?)"#,
        r#"INSERT INTO "SynopticGuide" ("id","rackId","axis","position","createdAt","updatedAt") VALUES ('g1','ra','x',10,?,?)"#,
        r#"INSERT INTO "SynopticGuide" ("id","projectId","axis","position","createdAt","updatedAt") VALUES ('g2','p1','y',20,?,?)"#,
        r#"INSERT INTO "ProjectEquipment" ("id","projectId","catalogEquipmentId") VALUES ('pe1','p1','eq1')"#,
        r#"INSERT INTO "ProjectSynopticAdapter" ("id","projectId","catalogAdapterId","x","y","createdAt","updatedAt") VALUES ('psa1','p1','ad1',0,0,?,?)"#,
        r#"INSERT INTO "ProjectCableBundle" ("id","projectId","name","createdAt","updatedAt") VALUES ('pcb1','p1','Faisceau',?,?)"#,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","toRackId","bundleId","createdAt") VALUES ('pc1','p1','ra','sa1','rb','pcb1',?)"#,
        r#"INSERT INTO "ProjectSynopticZone" ("id","projectId","x","y","w","h","color","createdAt","updatedAt") VALUES ('pz1','p1',0,0,1,1,'#fff',?,?)"#,
        r#"INSERT INTO "ProjectSynopticLabel" ("id","projectId","x","y","text","createdAt","updatedAt") VALUES ('pl1','p1',0,0,'Note',?,?)"#,
        r#"INSERT INTO "ProjectSynopticLayout" ("id","projectId","rackId","x","y","createdAt","updatedAt") VALUES ('ly1','p1','ra',0,0,?,?)"#,
        r#"INSERT INTO "AuditLog" ("id","userId","action","entityType","entityId","projectId","createdAt") VALUES ('au1','u','UPDATE','Project','p1','p1',?)"#,
        r#"INSERT INTO "AuditLog" ("id","userId","action","entityType","entityId","createdAt") VALUES ('au2','u','UPDATE','Rack','ra',?)"#,
        r#"INSERT INTO "AuditLog" ("id","userId","action","entityType","entityId","createdAt") VALUES ('au3','u','UPDATE','Rack','rb',?)"#,
        r#"INSERT INTO "AuditLog" ("id","userId","action","entityType","entityId","createdAt") VALUES ('au4','u','CREATE','RackConnection','rc1',?)"#,
        r#"INSERT INTO "AuditLog" ("id","userId","action","entityType","entityId","after","createdAt") VALUES ('au5','u','CREATE','ProjectConnection','pc1','{"files":["/uploads/audit/x.png"]}',?)"#,
        r#"INSERT INTO "AuditLog" ("id","userId","action","entityType","entityId","projectId","createdAt") VALUES ('au6','u','UPDATE','Project','p2','p2',?)"#,
        r#"INSERT INTO "AuditLog" ("id","userId","action","entityType","entityId","createdAt") VALUES ('au7','u','UPDATE','Rack','rx',?)"#,
    ] {
        exec(pool, sql).await;
    }
}

async fn bundle(pool: &SqlitePool, roots: &[(RootKind, &str)]) -> Result<Bundle, TransferError> {
    let roots: Vec<(RootKind, String)> = roots.iter().map(|(k, id)| (*k, id.to_string())).collect();
    // The caller's read transaction (a consistent snapshot).
    let mut tx = pool.begin().await.unwrap();
    let out = collect(&mut tx, &roots).await;
    tx.rollback().await.unwrap();
    out
}

fn ids(b: &Bundle, table: &str) -> BTreeSet<String> {
    b.tables
        .get(table)
        .map(|rows| {
            rows.iter()
                .map(|r| r["id"].as_str().unwrap().to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn set(v: &[&str]) -> BTreeSet<String> {
    v.iter().map(|s| s.to_string()).collect()
}

fn class_of(table: &str) -> Option<Class> {
    classification()
        .iter()
        .find(|(t, _)| *t == table)
        .map(|(_, c)| *c)
}

const REFERENTIALS: [&str; 9] = [
    "TenantBrand",
    "TenantConnectorType",
    "TenantSignalType",
    "TenantEquipmentCategory",
    "TenantFunction",
    "TenantType",
    "TenantPhase",
    "TenantDimensionPreset",
    "TenantCableModel",
];

async fn assert_all_referentials(pool: &SqlitePool, b: &Bundle) {
    for t in REFERENTIALS {
        let n: i64 = sqlx::query_scalar(&format!(r#"SELECT COUNT(*) FROM "{t}""#))
            .fetch_one(pool)
            .await
            .unwrap();
        let got = b.tables.get(t).map_or(0, Vec::len);
        assert_eq!(got as i64, n, "{t}");
    }
}

#[tokio::test]
async fn every_table_is_classified() {
    let e = env().await;
    let tables: BTreeSet<String> = sqlx::query_scalar(
        r#"SELECT "name" FROM sqlite_master WHERE "type" = 'table'
           AND "name" NOT LIKE 'sqlite_%' AND "name" <> '_sqlx_migrations'"#,
    )
    .fetch_all(&e.pool)
    .await
    .unwrap()
    .into_iter()
    .collect();
    let classified: BTreeSet<String> = classification()
        .iter()
        .map(|(t, _)| t.to_string())
        .collect();
    assert_eq!(classification().len(), classified.len(), "doublon");
    let missing: Vec<_> = tables.difference(&classified).collect();
    assert!(missing.is_empty(), "tables non classées : {missing:?}");
    let unknown: Vec<_> = classified.difference(&tables).collect();
    assert!(
        unknown.is_empty(),
        "tables absentes de la base : {unknown:?}"
    );

    for t in [
        "User",
        "UserProfile",
        "Role",
        "AuthSession",
        "Notification",
        "AppConfig",
        "CatalogSymbol",
        "PrintSettings",
        "TenantPrintTemplate",
        "TenantCableLabelStock",
        "TenantPrintExportModel",
        "TenantPrintExportPage",
        "ExportTemplate",
    ] {
        assert_eq!(class_of(t), Some(Class::System), "{t}");
    }
    for t in REFERENTIALS.iter().chain(&[
        "TenantCable",
        "TenantAdapter",
        "TenantEquipment",
        "TenantEquipmentComponent",
    ]) {
        assert_eq!(class_of(t), Some(Class::Catalogue), "{t}");
    }
    assert_eq!(class_of("Panel"), Some(Class::Dependency));
    assert_eq!(class_of("PanelSlot"), Some(Class::Dependency));

    // The insert order lists exactly the owned tables, each once.
    let owned: BTreeSet<&str> = classification()
        .iter()
        .filter(|(_, c)| *c == Class::Owned)
        .map(|(t, _)| *t)
        .collect();
    let order = owned_tables_in_insert_order();
    assert_eq!(order.len(), owned.len());
    assert_eq!(order.iter().copied().collect::<BTreeSet<_>>(), owned);
    let pos = |t: &str| order.iter().position(|o| *o == t).unwrap();
    for (child, parent) in [
        ("TechnicalSheet", "Project"),
        ("RigRack", "RigConfig"),
        ("RigRack", "Rack"),
        ("Rack", "Location"),
        ("RackSlot", "RackInventoryItem"),
        ("RackSlotPanelRow", "RackSlot"),
        ("SynopticAdapter", "RackSlot"),
        ("RackConnection", "SynopticAdapter"),
        ("RackConnection", "CableBundle"),
        ("ProjectConnection", "ProjectSynopticAdapter"),
        ("ProjectConnection", "ProjectCableBundle"),
        ("ProjectConnection", "RackSlot"),
        ("ProjectSynopticLayout", "Rack"),
    ] {
        assert!(pos(parent) < pos(child), "{parent} avant {child}");
    }
}

#[tokio::test]
async fn project_bundle_holds_its_graph() {
    let e = env().await;
    seed(&e.pool).await;
    let b = bundle(&e.pool, &[(RootKind::Project, "p1")]).await.unwrap();

    assert_eq!(b.roots.len(), 1);
    assert_eq!(b.roots[0].kind, RootKind::Project);
    assert_eq!(b.roots[0].id, "p1");
    assert_eq!(b.roots[0].name, "Match");

    let expect: &[(&str, &[&str])] = &[
        ("Project", &["p1"]),
        ("TechnicalSheet", &["ts1"]),
        ("ProjectDocument", &["doc1"]),
        ("Task", &["t1"]),
        ("Message", &["m1"]),
        ("Location", &["loc1"]),
        ("RigConfig", &["rg1"]),
        ("RigRack", &["rr1"]),
        ("ProjectEquipment", &["pe1"]),
        ("ProjectSynopticAdapter", &["psa1"]),
        ("ProjectCableBundle", &["pcb1"]),
        ("ProjectConnection", &["pc1"]),
        ("ProjectSynopticZone", &["pz1"]),
        ("ProjectSynopticLabel", &["pl1"]),
        ("SynopticGuide", &["g1", "g2"]),
        ("ProjectSynopticLayout", &["ly1"]),
        ("AuditLog", &["au1", "au2", "au3", "au4", "au5"]),
        ("Rack", &["ra", "rb"]),
        ("RackSlot", &["sa1", "sa2"]),
        ("RackInventoryItem", &["ii1"]),
        ("RackSlotPanelRow", &["pr1"]),
        ("RackZone", &["z1"]),
        ("RackLabel", &["l1"]),
        ("CableBundle", &["cb1"]),
        ("SynopticAdapter", &["sad1"]),
        ("ExternalPort", &["ep1"]),
        ("RackConnection", &["rc1"]),
        // Dependencies.
        ("Panel", &["pn1"]),
        ("PanelSlot", &["ps1", "ps2"]),
        ("TenantEquipment", &["eq1", "eq2"]),
        ("TenantEquipmentComponent", &["ec1"]),
        ("TenantAdapter", &["ad1"]),
    ];
    for (table, want) in expect {
        assert_eq!(ids(&b, table), set(want), "{table}");
    }
    assert!(!b.tables.contains_key("TenantCable"));
    assert_all_referentials(&e.pool, &b).await;
    // Nothing but the expected tables and the referentials.
    for t in b.tables.keys() {
        assert!(
            expect.iter().any(|(x, _)| x == t) || REFERENTIALS.contains(&t.as_str()),
            "table inattendue {t}"
        );
    }

    // Raw values: TEXT → string, INTEGER → integer, REAL → number, NULL → null.
    let rack = &b.tables["Rack"][0];
    assert_eq!(rack["totalU"], Value::from(42));
    assert_eq!(rack["maxWeightKg"], Value::Null);
    assert_eq!(rack["constructionChecks"], Value::from("[]"));
    let guide = b.tables["SynopticGuide"]
        .iter()
        .find(|r| r["id"] == "g1")
        .unwrap();
    assert_eq!(guide["position"].as_f64(), Some(10.0));
    assert!(guide["position"].is_f64());

    // Uploads: plain values and inside JSON, in any exported row.
    assert_eq!(
        b.uploads,
        set(&["documents/a.pdf", "catalogue/carte.png", "audit/x.png",])
    );
}

#[tokio::test]
async fn rack_bundle_excludes_project_rows() {
    let e = env().await;
    seed(&e.pool).await;
    let b = bundle(&e.pool, &[(RootKind::Rack, "ra")]).await.unwrap();
    assert_eq!(b.roots[0].name, "Baie A");
    assert_eq!(ids(&b, "Rack"), set(&["ra"]));
    assert_eq!(ids(&b, "RackSlot"), set(&["sa1", "sa2"]));
    assert_eq!(ids(&b, "RackConnection"), set(&["rc1"]));
    assert_eq!(ids(&b, "SynopticGuide"), set(&["g1"]));
    assert_eq!(ids(&b, "AuditLog"), set(&["au2", "au4"]));
    assert_eq!(ids(&b, "Panel"), set(&["pn1"]));
    assert_eq!(ids(&b, "TenantEquipment"), set(&["eq1", "eq2"]));
    assert_eq!(ids(&b, "TenantAdapter"), set(&["ad1"]));
    for t in [
        "Project",
        "Location",
        "RigConfig",
        "RigRack",
        "ProjectConnection",
        "ProjectEquipment",
        "ProjectSynopticLayout",
        "SynopticAdapter",
    ] {
        assert!(!b.tables.contains_key(t), "{t}");
    }
    assert_eq!(b.uploads, set(&["catalogue/carte.png"]));
}

#[tokio::test]
async fn panel_bundle_is_panel_and_slots() {
    let e = env().await;
    seed(&e.pool).await;
    let b = bundle(&e.pool, &[(RootKind::Panel, "pn2")]).await.unwrap();
    assert_eq!(b.roots[0].name, "Patch 2");
    assert_eq!(ids(&b, "Panel"), set(&["pn2"]));
    assert_eq!(ids(&b, "PanelSlot"), set(&["ps3"]));
    for t in b.tables.keys() {
        assert!(
            t == "Panel" || t == "PanelSlot" || REFERENTIALS.contains(&t.as_str()),
            "table inattendue {t}"
        );
    }
    assert_all_referentials(&e.pool, &b).await;
    assert!(b.uploads.is_empty());
}

#[tokio::test]
async fn rig_bundle_includes_its_racks() {
    let e = env().await;
    seed(&e.pool).await;
    let b = bundle(&e.pool, &[(RootKind::Rig, "rgt")]).await.unwrap();
    assert_eq!(b.roots[0].name, "Modèle");
    assert_eq!(ids(&b, "RigConfig"), set(&["rgt"]));
    assert_eq!(ids(&b, "RigRack"), set(&["rr3"]));
    assert_eq!(ids(&b, "Rack"), set(&["rl"]));
    assert_eq!(ids(&b, "RackSlot"), set(&["sl1"]));
    assert!(!b.tables.contains_key("Project"));
    assert!(!b.tables.contains_key("TenantEquipment"));

    // Several roots in one bundle: rows are not duplicated.
    let b = bundle(
        &e.pool,
        &[
            (RootKind::Rig, "rgx"),
            (RootKind::Rack, "rx"),
            (RootKind::Panel, "pn2"),
        ],
    )
    .await
    .unwrap();
    assert_eq!(b.roots.len(), 3);
    assert_eq!(b.tables["Rack"].len(), 1);
    assert_eq!(b.tables["Panel"].len(), 1);
    assert_eq!(ids(&b, "RackSlot"), set(&["sx1", "sx2"]));
    assert_eq!(ids(&b, "AuditLog"), set(&["au7"]));
    assert_eq!(ids(&b, "TenantEquipment"), set(&["eq3"]));
}

#[tokio::test]
async fn unknown_root_is_not_found() {
    let e = env().await;
    seed(&e.pool).await;
    for kind in [
        RootKind::Project,
        RootKind::Rack,
        RootKind::Rig,
        RootKind::Panel,
    ] {
        match bundle(&e.pool, &[(kind, "nope")]).await {
            Err(TransferError::NotFound(k, id)) => {
                assert_eq!(k, kind);
                assert_eq!(id, "nope");
            }
            other => panic!("{kind:?}: {other:?}"),
        }
    }
}

#[tokio::test]
async fn columns_follow_table_info() {
    use arkyo_server::transfer::rows::{columns, select_rows};
    let e = env().await;
    let mut conn = e.pool.acquire().await.unwrap();
    let cols = columns(&mut conn, "Rack").await.unwrap();
    let id = cols.iter().find(|c| c.name == "id").unwrap();
    assert!(id.notnull);
    assert_eq!(id.pk, 1);
    let total = cols.iter().find(|c| c.name == "totalU").unwrap();
    assert_eq!(total.dflt_value.as_deref(), Some("42"));
    assert_eq!(total.pk, 0);
    assert!(columns(&mut conn, "Inconnue").await.unwrap().is_empty());
    assert!(matches!(
        columns(&mut conn, "Rack\"; DROP TABLE x").await,
        Err(TransferError::Invalid(_))
    ));
    assert!(matches!(
        select_rows(&mut conn, "a b", "1", &[]).await,
        Err(TransferError::Invalid(_))
    ));
}
