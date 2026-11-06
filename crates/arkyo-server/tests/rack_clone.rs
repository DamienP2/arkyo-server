//! Phase 4a, Task 6: cloning of containers (arkyo:lib/services/rack-clone.ts
//! `cloneRackInto`, `POST /api/tenant/projects/:id/racks/:rackId/save-as-template`
//! and `POST /api/tenant/projects/:id/racks/clone-from-template`).
mod common;
use std::collections::HashMap;

use arkyo_server::db::begin_immediate;
use arkyo_server::inventory::clone::{clone_rack_into, CloneScope, CloneTarget};
use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tokio::sync::broadcast::Receiver;

const LIST: &str = "/api/tenant/projects";
const NOW: &str = "2026-11-06T10:00:00.000Z";

struct Ctx {
    e: Env,
    tok: String,
    owner: String,
}

async fn ctx() -> Ctx {
    let e = env().await;
    let o = add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    catalogue_fixture(&e.pool).await;
    Ctx {
        e,
        tok,
        owner: o.id,
    }
}

impl Ctx {
    async fn req(&self, method: &str, path: &str, body: Option<Value>) -> Reply {
        call(&self.e.app, method, path, LOCAL, Some(&self.tok), body).await
    }

    async fn project(&self, name: &str) -> String {
        let r = self
            .req(
                "POST",
                LIST,
                Some(json!({"name": name, "interventionType": "PRESTATION"})),
            )
            .await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        r.body["id"].as_str().unwrap().to_string()
    }

    async fn location(&self, project: &str, name: &str) -> String {
        let r = self
            .req(
                "POST",
                &format!("{LIST}/{project}/locations"),
                Some(json!({ "name": name })),
            )
            .await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        r.body["id"].as_str().unwrap().to_string()
    }

    async fn rack(&self, project: &str, location: &str, name: &str) -> String {
        let r = self
            .req(
                "POST",
                &format!("{LIST}/{project}/racks"),
                Some(json!({"racks": [{"name": name, "locationId": location}]})),
            )
            .await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        r.body["racks"][0]["id"].as_str().unwrap().to_string()
    }
}

async fn exec(pool: &SqlitePool, sql: &str) {
    let mut q = sqlx::query(sql);
    for _ in 0..sql.matches("?").count() {
        q = q.bind(NOW);
    }
    q.execute(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

async fn int(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

async fn next_event(rx: &mut Receiver<String>) -> Value {
    serde_json::from_str(&rx.recv().await.unwrap()).unwrap()
}

/// `eq1` (with connectors), a modular host `host-eq` and its component
/// `comp-eq`, an adapter `ad1` and a panel `pa1`.
async fn catalogue_fixture(pool: &SqlitePool) {
    for sql in [
        r#"INSERT INTO "TenantBrand" ("id","name","createdAt","updatedAt") VALUES ('b1','Blackmagic',?,?)"#,
        r#"INSERT INTO "TenantEquipmentCategory" ("id","name","color","createdAt","updatedAt") VALUES ('cat1','Régie','#112233',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","reference","brandId","categoryId","heightU","depthMm","weight","powerW","connectors","createdById","createdAt","updatedAt")
           VALUES ('eq1','ATEM 2 M/E','SWATEMPSW2ME','b1','cat1',2,400,4.5,150,'[{"id":"c1"}]','u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","isComponentHost","hostSlotCount","createdById","createdAt","updatedAt") VALUES ('host-eq','Châssis',1,4,'u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","isComponent","componentSlotSpan","isRackable","createdById","createdAt","updatedAt") VALUES ('comp-eq','Carte',1,2,0,'u',?,?)"#,
        r#"INSERT INTO "TenantAdapter" ("id","name","reference","createdById","createdAt","updatedAt") VALUES ('ad1','XLR F → Jack','AD-1','u',?,?)"#,
        r#"INSERT INTO "Panel" ("id","name","panelType","heightU","createdById","createdAt","updatedAt") VALUES ('pa1','Patch 24 XLR','PATCH',1,'u',?,?)"#,
    ] {
        exec(pool, sql).await;
    }
}

/// Fills the rack `r` with every relation `cloneRackInto` copies. Ids are
/// prefixed with `p` so two fixtures can share a database. A component is
/// created before its host, and a slot before its parent shelf (both bound
/// afterwards), so the clone cannot rely on insertion order.
async fn populate(pool: &SqlitePool, r: &str, p: &str) {
    let sql = format!(
        r#"UPDATE "Rack" SET "totalU" = 16, "depthMm" = 500, "maxWeightKg" = 80.5, "maxPowerW" = 1200,
               "emptyWeightKg" = 12, "notes" = 'note', "rearInteriorGapMm" = 30,
               "rackType" = 'FLIGHT_CASE_SKB', "isRackable" = 0, "widthMm" = 480, "heightMm" = 700,
               "hasWheels" = 1, "cableCode" = 'BM', "cableNextNum" = 7,
               "numberingOverride" = '{{"prefix":"X"}}', "canvasX" = 10, "canvasY" = 20
           WHERE "id" = '{r}'"#
    );
    exec(pool, &sql).await;
    let rows = [
        // inventory: the component first, unbound
        format!(
            r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","quantity","notes","hostSlotIndex","createdAt","updatedAt")
               VALUES ('{p}i-comp','{r}','comp-eq',1,'inv-comp',1,?,?)"#
        ),
        format!(
            r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","quantity","notes","createdAt","updatedAt")
               VALUES ('{p}i-eq','{r}','eq1',2,'inv-eq',?,?)"#
        ),
        format!(
            r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","quantity","notes","createdAt","updatedAt")
               VALUES ('{p}i-host','{r}','host-eq',1,'inv-host',?,?)"#
        ),
        format!(
            r#"INSERT INTO "RackInventoryItem" ("id","rackId","accessoryType","accessoryHeightU","accessoryVariant","accessoryDepthMm","quantity","notes","createdAt","updatedAt")
               VALUES ('{p}i-acc','{r}','etagere',1,'fixe',300,1,'inv-acc',?,?)"#
        ),
        format!(
            r#"INSERT INTO "RackInventoryItem" ("id","rackId","panelId","quantity","notes","createdAt","updatedAt")
               VALUES ('{p}i-panel','{r}','pa1',1,'inv-panel',?,?)"#
        ),
        format!(
            r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogAdapterId","quantity","notes","createdAt","updatedAt")
               VALUES ('{p}i-ad','{r}','ad1',3,'inv-ad',?,?)"#
        ),
        format!(
            r#"UPDATE "RackInventoryItem" SET "hostItemId" = '{p}i-host' WHERE "id" = '{p}i-comp'"#
        ),
        // slots: the chassis on the shelf first, unbound
        format!(
            r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","inventoryItemId","startU","heightU","label","createdAt","updatedAt")
               VALUES ('{p}s-host','{r}','host-eq','{p}i-host',NULL,1,'Châssis',?,?)"#
        ),
        format!(
            r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","inventoryItemId","view","startU","heightU","widthFraction","column","label","notes","patchNotes","panelLabels","synopticX","synopticY","createdAt","updatedAt")
               VALUES ('{p}s-eq','{r}','eq1','{p}i-eq','FRONT',1,2,'HALF',1,'Mixeur','n1','pn','["A","B"]',100.5,200.25,?,?)"#
        ),
        format!(
            r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","inventoryItemId","startU","heightU","label","createdAt","updatedAt")
               VALUES ('{p}s-eq2','{r}','eq1','{p}i-eq',3,2,'Mixeur 2',?,?)"#
        ),
        format!(
            r#"INSERT INTO "RackSlot" ("id","rackId","inventoryItemId","startU","heightU","label","createdAt","updatedAt")
               VALUES ('{p}s-shelf','{r}','{p}i-acc',5,1,'Étagère',?,?)"#
        ),
        format!(
            r#"INSERT INTO "RackSlot" ("id","rackId","panelId","inventoryItemId","view","startU","heightU","label","createdAt","updatedAt")
               VALUES ('{p}s-panel','{r}','pa1','{p}i-panel','REAR',8,1,'Patch',?,?)"#
        ),
        format!(
            r#"INSERT INTO "RackSlot" ("id","rackId","startU","label","createdAt","updatedAt")
               VALUES ('{p}s-free','{r}',10,'Libre',?,?)"#
        ),
        format!(r#"UPDATE "RackSlot" SET "parentSlotId" = '{p}s-shelf' WHERE "id" = '{p}s-host'"#),
        // synoptic
        format!(
            r#"INSERT INTO "SynopticAdapter" ("id","rackId","catalogAdapterId","x","y","attachedSlotId","attachedSide","attachedPortIndex","label","notes","createdAt","updatedAt")
               VALUES ('{p}a1','{r}','ad1',11.5,12.5,'{p}s-eq','right',2,'Adapt 1','na',?,?)"#
        ),
        format!(
            r#"INSERT INTO "SynopticAdapter" ("id","rackId","catalogAdapterId","x","y","label","createdAt","updatedAt")
               VALUES ('{p}a2','{r}','ad1',30,40,'Adapt 2',?,?)"#
        ),
        format!(
            r##"INSERT INTO "CableBundle" ("id","rackId","name","color","createdAt","updatedAt") VALUES ('{p}b1','{r}','Faisceau 1','#ff0000',?,?)"##
        ),
        format!(
            r#"INSERT INTO "CableBundle" ("id","rackId","name","createdAt","updatedAt") VALUES ('{p}b2','{r}','Faisceau 2',?,?)"#
        ),
        format!(
            r##"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","fromConnectorIndex","toAdapterId","toAdapterSide","toAdapterPortIndex","label","color","waypoints","cableStyle","notes","tags","catalogCableModelId","bundleId","createdAt")
               VALUES ('{p}c1','{r}','{p}s-eq',0,'{p}a1','A',0,'c1','#00ff00','[{{"x":1,"y":2}}]','orthogonal','nc','["t1"]','cm1','{p}b1',?)"##
        ),
        format!(
            r#"INSERT INTO "RackConnection" ("id","rackId","fromAdapterId","fromAdapterSide","fromAdapterPortIndex","toSlotId","toConnectorIndex","toComponentItemId","label","createdAt")
               VALUES ('{p}c2','{r}','{p}a1','B',0,'{p}s-host',1,'{p}i-comp','c2',?)"#
        ),
        format!(
            r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","fromConnectorIndex","fromComponentItemId","toSlotId","toConnectorIndex","label","createdAt")
               VALUES ('{p}c3','{r}','{p}s-host',0,'{p}i-comp','{p}s-panel',3,'c3',?)"#
        ),
        format!(
            r#"INSERT INTO "RackSlotPanelRow" ("id","slotId","rowIndex","synopticX","synopticY","createdAt","updatedAt") VALUES ('{p}pr0','{p}s-panel',0,1.5,2.5,?,?)"#
        ),
        format!(
            r#"INSERT INTO "RackSlotPanelRow" ("id","slotId","rowIndex","synopticX","synopticY","createdAt","updatedAt") VALUES ('{p}pr1','{p}s-panel',1,3.5,4.5,?,?)"#
        ),
        format!(
            r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","labelX","labelY","label","createdAt","updatedAt")
               VALUES ('{p}e1','{r}','{p}s-eq',4,50,60,'Vers régie',?,?)"#
        ),
        format!(
            r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","label","kind","createdAt","updatedAt")
               VALUES ('{p}e2','{r}','{p}s-panel',0,'Antenne','MONDE',?,?)"#
        ),
        format!(
            r##"INSERT INTO "RackZone" ("id","rackId","label","labelPosition","color","x","y","w","h","borderRadius","borderWidth","borderStyle","opacity","labelFontSize","labelFontWeight","labelFontStyle","labelTextDecoration","labelFontFamily","createdAt","updatedAt")
               VALUES ('{p}z1','{r}','Vidéo','bottom-right','#ff00ff',1,2,300,400,4,3,'dashed',0.3,14,'bold','italic','underline','Inter',?,?)"##
        ),
        format!(
            r#"INSERT INTO "RackZone" ("id","rackId","x","y","w","h","createdAt","updatedAt") VALUES ('{p}z2','{r}',5,6,7,8,?,?)"#
        ),
        format!(
            r##"INSERT INTO "RackLabel" ("id","rackId","text","x","y","fontSize","width","color","fontWeight","fontFamily","fontStyle","textDecoration","pill","pillBg","pillRadius","createdAt","updatedAt")
               VALUES ('{p}l1','{r}','Entrées',9,10,18,120,'#222222','bold','Inter','italic','underline',1,'#eeeeee',6,?,?)"##
        ),
        format!(
            r##"INSERT INTO "SynopticGuide" ("id","rackId","axis","position","color","label","createdAt","updatedAt") VALUES ('{p}g1','{r}','H',120.5,'#123456','Axe',?,?)"##
        ),
        format!(
            r#"INSERT INTO "SynopticGuide" ("id","rackId","axis","position","createdAt","updatedAt") VALUES ('{p}g2','{r}','V',40,?,?)"#
        ),
    ];
    for sql in &rows {
        exec(pool, sql).await;
    }
}

/// The tables of a rack's content, and how their rows are selected (`?1` =
/// the rack id). `ExternalPort` is read through the rack's slots, as
/// `cloneRackInto` does (`slots.externalPorts`).
const CONTENT: [(&str, &str); 11] = [
    ("RackInventoryItem", r#""rackId" = ?1"#),
    ("RackSlot", r#""rackId" = ?1"#),
    ("SynopticAdapter", r#""rackId" = ?1"#),
    ("CableBundle", r#""rackId" = ?1"#),
    ("RackConnection", r#""rackId" = ?1"#),
    (
        "RackSlotPanelRow",
        r#""slotId" IN (SELECT "id" FROM "RackSlot" WHERE "rackId" = ?1)"#,
    ),
    (
        "ExternalPort",
        r#""slotId" IN (SELECT "id" FROM "RackSlot" WHERE "rackId" = ?1)"#,
    ),
    ("RackZone", r#""rackId" = ?1"#),
    ("RackLabel", r#""rackId" = ?1"#),
    ("SynopticGuide", r#""rackId" = ?1"#),
    ("Rack", r#""id" = ?1"#),
];

/// The referenced tables and the column naming each row in the fixture.
const NAMED: [(&str, &str); 4] = [
    ("RackInventoryItem", "notes"),
    ("RackSlot", "label"),
    ("SynopticAdapter", "label"),
    ("CableBundle", "name"),
];

/// Columns left out of the comparison: the row's own identity and
/// timestamps; for the rack, its name (suffixed in its scope) and location
/// (the target's).
fn skipped(table: &str, col: &str) -> bool {
    matches!(col, "id" | "createdAt" | "updatedAt")
        || (table == "Rack" && matches!(col, "name" | "locationId"))
}

/// Normalized content of rack `rack`: every row of [`CONTENT`] as JSON
/// (all columns but [`skipped`]), each id of the rack's own rows replaced
/// by a stable name (`RACK`, `RackSlot:Mixeur`…), rows sorted. Two racks
/// with the same content and the same internal references give the same
/// value, whatever their ids.
async fn dump(pool: &SqlitePool, rack: &str) -> Value {
    let mut names: HashMap<String, String> = HashMap::new();
    names.insert(rack.to_string(), "RACK".into());
    for (table, col) in NAMED {
        let rows: Vec<(String, Option<String>)> = sqlx::query_as(&format!(
            r#"SELECT "id", "{col}" FROM "{table}" WHERE "rackId" = ?"#
        ))
        .bind(rack)
        .fetch_all(pool)
        .await
        .unwrap();
        for (id, name) in rows {
            names.insert(id, format!("{table}:{}", name.unwrap_or_default()));
        }
    }
    let mut out = serde_json::Map::new();
    for (table, filter) in CONTENT {
        let cols: Vec<String> = sqlx::query_scalar(&format!(
            r#"SELECT "name" FROM pragma_table_info('{table}')"#
        ))
        .fetch_all(pool)
        .await
        .unwrap();
        let pairs: Vec<String> = cols
            .iter()
            .filter(|c| !skipped(table, c))
            .map(|c| format!(r#"'{c}', "{c}""#))
            .collect();
        let raw: Vec<String> = sqlx::query_scalar(&format!(
            r#"SELECT json_object({}) FROM "{table}" WHERE {filter}"#,
            pairs.join(", ")
        ))
        .bind(rack)
        .fetch_all(pool)
        .await
        .unwrap();
        let mut rows: Vec<Value> = raw
            .iter()
            .map(|s| {
                let mut v: Value = serde_json::from_str(s).unwrap();
                for (_, cell) in v.as_object_mut().unwrap().iter_mut() {
                    if let Some(name) = cell.as_str().and_then(|s| names.get(s)) {
                        *cell = Value::String(name.clone());
                    }
                }
                v
            })
            .collect();
        rows.sort_by_key(|r| r.to_string());
        out.insert(table.to_string(), Value::Array(rows));
    }
    Value::Object(out)
}

/// Every reference column `cloneRackInto` remaps, with the table it points
/// to.
const REFS: [(&str, &str, &str); 14] = [
    ("RackInventoryItem", "hostItemId", "RackInventoryItem"),
    ("RackSlot", "inventoryItemId", "RackInventoryItem"),
    ("RackSlot", "parentSlotId", "RackSlot"),
    ("SynopticAdapter", "attachedSlotId", "RackSlot"),
    ("RackConnection", "fromSlotId", "RackSlot"),
    ("RackConnection", "toSlotId", "RackSlot"),
    ("RackConnection", "fromAdapterId", "SynopticAdapter"),
    ("RackConnection", "toAdapterId", "SynopticAdapter"),
    ("RackConnection", "fromComponentItemId", "RackInventoryItem"),
    ("RackConnection", "toComponentItemId", "RackInventoryItem"),
    ("RackConnection", "bundleId", "CableBundle"),
    ("RackSlotPanelRow", "slotId", "RackSlot"),
    ("ExternalPort", "slotId", "RackSlot"),
    ("SynopticGuide", "rackId", "Rack"),
];

/// Rows of `table` belonging to `rack` (see [`CONTENT`]).
fn scope(table: &str) -> &'static str {
    CONTENT.iter().find(|(t, _)| *t == table).unwrap().1
}

#[tokio::test]
async fn save_as_template_then_clone_roundtrip_identical() {
    let c = ctx().await;
    let p = c.project("Match").await;
    let plateau = c.location(&p, "Plateau").await;
    let regie = c.location(&p, "Régie").await;
    let src = c.rack(&p, &plateau, "Baie").await;
    populate(&c.e.pool, &src, "x").await;
    // A project-wide guide is not the rack's: never copied.
    exec(
        &c.e.pool,
        &format!(
            r#"INSERT INTO "SynopticGuide" ("id","projectId","axis","position","label","createdAt","updatedAt") VALUES ('pg','{p}','H',1,'Projet',?,?)"#
        ),
    )
    .await;
    let expected = dump(&c.e.pool, &src).await;
    let mut rx = c.e.events.subscribe();

    // ── save-as-template ──
    let r = c
        .req(
            "POST",
            &format!("{LIST}/{p}/racks/{src}/save-as-template"),
            None,
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let tpl = r.body["rack"]["id"].as_str().unwrap().to_string();
    let tpl_rig = r.body["rigConfig"]["id"].as_str().unwrap().to_string();
    assert_ne!(tpl, src);
    assert_eq!(
        r.body,
        json!({
            "rack": {"id": tpl, "name": "Baie"},
            "rigConfig": {"id": tpl_rig, "name": "Baie (modèle)"},
        })
    );
    let rig: (String, Option<String>, i64, String) = sqlx::query_as(
        r#"SELECT "type", "projectId", "isTemplate", "createdById" FROM "RigConfig" WHERE "id" = ?"#,
    )
    .bind(&tpl_rig)
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(rig, ("FLIGHT_CASE".into(), None, 1, c.owner.clone()));
    let link: (String, i64) =
        sqlx::query_as(r#"SELECT "rigConfigId", "position" FROM "RigRack" WHERE "rackId" = ?"#)
            .bind(&tpl)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    assert_eq!(link, (tpl_rig.clone(), 0));
    let tpl_loc: Option<String> =
        sqlx::query_scalar(r#"SELECT "locationId" FROM "Rack" WHERE "id" = ?"#)
            .bind(&tpl)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    assert_eq!(tpl_loc, None);
    assert_eq!(dump(&c.e.pool, &tpl).await, expected);
    // the source is untouched
    assert_eq!(dump(&c.e.pool, &src).await, expected);
    let ev = next_event(&mut rx).await;
    assert_eq!(
        (&ev["entity"], &ev["action"], &ev["id"]),
        (&json!("rig"), &json!("created"), &json!(tpl_rig))
    );
    assert!(ev.get("projectId").is_none(), "{ev}");
    let audit: (String, String, String, Option<String>, String) = sqlx::query_as(
        r#"SELECT "userId", "entityType", "entityId", "projectId", "after" FROM "AuditLog" WHERE "action" = 'save_rack_as_template'"#,
    )
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(
        (&audit.0, audit.1.as_str(), &audit.2, audit.3.as_deref()),
        (&c.owner, "Rack", &tpl, Some(p.as_str()))
    );
    assert_eq!(
        serde_json::from_str::<Value>(&audit.4).unwrap(),
        json!({"sourceRackId": src, "templateRigConfigId": tpl_rig, "templateRackId": tpl})
    );

    // A second save is suffixed among the templates.
    let r = c
        .req(
            "POST",
            &format!("{LIST}/{p}/racks/{src}/save-as-template"),
            None,
        )
        .await;
    assert_eq!(r.body["rack"]["name"], "Baie 2", "{:?}", r.body);
    let _ = next_event(&mut rx).await;

    // ── clone-from-template ──
    let r = c
        .req(
            "POST",
            &format!("{LIST}/{p}/racks/clone-from-template"),
            Some(json!({"rackTemplateId": tpl, "locationId": regie})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let back = r.body["rack"]["id"].as_str().unwrap().to_string();
    assert!(back != src && back != tpl);
    assert_eq!(dump(&c.e.pool, &back).await, expected);
    // the template is untouched
    assert_eq!(dump(&c.e.pool, &tpl).await, expected);

    let project_rig: String =
        sqlx::query_scalar(r#"SELECT "id" FROM "RigConfig" WHERE "projectId" = ?"#)
            .bind(&p)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    let (name, loc): (String, Option<String>) =
        sqlx::query_as(r#"SELECT "name", "locationId" FROM "Rack" WHERE "id" = ?"#)
            .bind(&back)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    assert_eq!(
        (name.as_str(), loc.as_deref()),
        ("Baie 2", Some(regie.as_str()))
    );
    // linked after the project's racks (2 virtual racks + "Baie")
    let pos: i64 = sqlx::query_scalar(
        r#"SELECT "position" FROM "RigRack" WHERE "rackId" = ? AND "rigConfigId" = ?"#,
    )
    .bind(&back)
    .bind(&project_rig)
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(pos, 3);

    // Response: arkyo's card payload (clone-from-template/route.ts:244-268).
    let rack = &r.body["rack"];
    let mut head = rack.clone();
    for k in ["slots", "bom"] {
        head.as_object_mut().unwrap().remove(k);
    }
    assert_eq!(
        head,
        json!({
            "id": back, "rigConfigId": project_rig, "name": "Baie 2",
            "rackType": "FLIGHT_CASE_SKB", "totalU": 16, "depthMm": 500, "widthMm": 480,
            "heightMm": 700, "hasWheels": true, "emptyWeightKg": 12.0, "isRackable": false,
            "canvasX": null, "canvasY": null, "slotsCount": 5, "constructionChecks": 0,
            "hasConnectors": true,
        })
    );
    // top-level slots only (not the chassis on the shelf), by startU
    let slots = rack["slots"].as_array().unwrap();
    let starts: Vec<&Value> = slots.iter().map(|s| &s["startU"]).collect();
    assert_eq!(
        starts,
        [&json!(1), &json!(3), &json!(5), &json!(8), &json!(10)]
    );
    assert_eq!(
        slots[0],
        json!({
            "startU": 1, "heightU": 2.0, "widthFraction": "HALF", "view": "FRONT",
            "category": null, "categoryId": "cat1", "equipmentName": "ATEM 2 M/E",
            "equipmentReference": "SWATEMPSW2ME", "brandName": "Blackmagic",
            "weightKg": 4.5, "powerW": 150,
        })
    );
    assert_eq!(slots[4]["equipmentName"], Value::Null);
    let bom = rack["bom"].as_array().unwrap();
    assert_eq!(bom.len(), 6);
    let eq = bom.iter().find(|b| b["name"] == "ATEM 2 M/E").unwrap();
    let mut keys: Vec<&str> = eq.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "brandName",
            "category",
            "categoryColor",
            "componentSlotSpan",
            "depthMm",
            "heightU",
            "hostItemId",
            "hostSlotCount",
            "hostSlotIndex",
            "id",
            "isComponent",
            "isComponentHost",
            "isRackable",
            "kind",
            "name",
            "powerW",
            "quantity",
            "reference",
            "snapshotId",
            "weightKg",
        ]
    );
    assert_eq!(
        (
            &eq["kind"],
            &eq["quantity"],
            &eq["category"],
            &eq["categoryColor"]
        ),
        (
            &json!("equipment"),
            &json!(2),
            &json!("Régie"),
            &Value::Null
        )
    );
    let comp = bom.iter().find(|b| b["name"] == "Carte").unwrap();
    let host = bom.iter().find(|b| b["name"] == "Châssis").unwrap();
    assert_eq!(comp["hostItemId"], host["id"]);
    assert_eq!(host["isComponentHost"], true);

    let ev = next_event(&mut rx).await;
    assert_eq!(
        (&ev["entity"], &ev["action"], &ev["id"], &ev["projectId"]),
        (
            &json!("rig"),
            &json!("updated"),
            &json!(project_rig),
            &json!(p)
        )
    );
    let after: String = sqlx::query_scalar(
        r#"SELECT "after" FROM "AuditLog" WHERE "action" = 'clone_rack_from_template' AND "entityId" = ? AND "projectId" = ?"#,
    )
    .bind(&back)
    .bind(&p)
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&after).unwrap(),
        json!({
            "sourceRackId": tpl, "clonedRackId": back, "slotsCount": 6, "inventoryCount": 6,
            "connectionsCount": 3, "adaptersCount": 2, "bundlesCount": 2,
        })
    );
}

#[tokio::test]
async fn clone_remaps_every_reference() {
    let c = ctx().await;
    let p = c.project("Match").await;
    let plateau = c.location(&p, "Plateau").await;
    let src = c.rack(&p, &plateau, "Baie").await;
    let other = c.rack(&p, &plateau, "Autre").await;
    populate(&c.e.pool, &src, "x").await;
    populate(&c.e.pool, &other, "o").await;
    // What the copy leaves out or resets: the cable id, the build checks,
    // the template status, the wiring state, the snapshots (SaaS).
    exec(
        &c.e.pool,
        &format!(
            r#"UPDATE "Rack" SET "cableId" = 3, "constructionChecks" = '["c1"]', "templateStatus" = 'ACTIF' WHERE "id" = '{src}'"#
        ),
    )
    .await;
    exec(
        &c.e.pool,
        &format!(
            r#"UPDATE "RackConnection" SET "wired" = 1, "wiredAt" = ?, "wiredNotes" = 'ok', "snapshotId" = 'snap' WHERE "rackId" = '{src}'"#
        ),
    )
    .await;
    for t in ["RackInventoryItem", "RackSlot", "SynopticAdapter"] {
        exec(
            &c.e.pool,
            &format!(r#"UPDATE "{t}" SET "snapshotId" = 'snap' WHERE "rackId" = '{src}'"#),
        )
        .await;
    }
    // An adapter attached to another rack's slot: not the rack's, so no
    // counterpart (`slotIdMap.get(…) ?? null`).
    exec(
        &c.e.pool,
        &format!(
            r#"INSERT INTO "SynopticAdapter" ("id","rackId","catalogAdapterId","x","y","attachedSlotId","label","createdAt","updatedAt")
               VALUES ('xa3','{src}','ad1',1,1,'os-eq','Adapt X',?,?)"#
        ),
    )
    .await;

    let mut tx = begin_immediate(&c.e.pool).await.unwrap();
    let new = clone_rack_into(
        &mut tx,
        &src,
        CloneTarget {
            name: "Copie",
            location_id: None,
            scope: CloneScope::Full,
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(
        (new.name.as_str(), new.rack_type.as_str()),
        ("Copie", "FLIGHT_CASE_SKB")
    );
    assert_eq!(
        (
            new.counts.slots,
            new.counts.inventory,
            new.counts.connections,
            new.counts.adapters,
            new.counts.bundles
        ),
        (6, 6, 3, 3, 2)
    );
    let n = &new.id;

    // Every reference of the copy points to a row of the copy, never to the
    // source's nor to another rack's.
    for (table, col, target) in REFS {
        let filter = scope(table);
        let target_scope = if target == "Rack" {
            r#""id" = ?1"#
        } else {
            scope(target)
        };
        let src_set: i64 = sqlx::query_scalar(&format!(
            r#"SELECT COUNT(*) FROM "{table}" WHERE {filter} AND "{col}" IS NOT NULL"#
        ))
        .bind(&src)
        .fetch_one(&c.e.pool)
        .await
        .unwrap();
        let (set, inside): (i64, i64) = sqlx::query_as(&format!(
            r#"SELECT COUNT("{col}"),
                      COUNT(CASE WHEN "{col}" IN (SELECT "id" FROM "{target}" WHERE {target_scope}) THEN 1 END)
               FROM "{table}" WHERE {filter}"#
        ))
        .bind(n)
        .fetch_one(&c.e.pool)
        .await
        .unwrap();
        let dangling = i64::from(table == "SynopticAdapter");
        assert!(set > 0, "{table}.{col}: aucune référence à vérifier");
        assert_eq!(set, src_set - dangling, "{table}.{col}");
        assert_eq!(inside, set, "{table}.{col} hors de la copie");
    }
    let x: Option<String> =
        sqlx::query_scalar(r#"SELECT "attachedSlotId" FROM "SynopticAdapter" WHERE "rackId" = ? AND "label" = 'Adapt X'"#)
            .bind(n)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    assert_eq!(x, None);

    // Same content, same internal references (by name), except what the
    // copy resets.
    let mut expected = dump(&c.e.pool, &src).await;
    let rack = &mut expected["Rack"][0];
    rack["cableId"] = Value::Null;
    rack["constructionChecks"] = json!("[]");
    rack["templateStatus"] = json!("BROUILLON");
    for t in [
        "RackInventoryItem",
        "RackSlot",
        "SynopticAdapter",
        "RackConnection",
    ] {
        for row in expected[t].as_array_mut().unwrap() {
            row["snapshotId"] = Value::Null;
            if t == "RackConnection" {
                row["wired"] = json!(0);
                row["wiredAt"] = Value::Null;
                row["wiredNotes"] = Value::Null;
            }
            if row["label"] == "Adapt X" {
                row["attachedSlotId"] = Value::Null;
            }
        }
    }
    for t in [
        "RackInventoryItem",
        "RackSlot",
        "SynopticAdapter",
        "RackConnection",
    ] {
        expected[t]
            .as_array_mut()
            .unwrap()
            .sort_by_key(|r| r.to_string());
    }
    assert_eq!(dump(&c.e.pool, n).await, expected);

    // arkyo-server: `ExternalPort.kind` is copied (arkyo lost it, a MONDE
    // bubble came back INTER_LIEU).
    let kind: String = sqlx::query_scalar(
        r#"SELECT "kind" FROM "ExternalPort" WHERE "rackId" = ? AND "label" = 'Antenne'"#,
    )
    .bind(n)
    .fetch_one(&c.e.pool)
    .await
    .unwrap();
    assert_eq!(kind, "MONDE");

    // The source and the other rack are untouched; nothing is linked.
    assert_eq!(
        int(
            &c.e.pool,
            &format!(r#"SELECT COUNT(*) FROM "RigRack" WHERE "rackId" = '{n}'"#)
        )
        .await,
        0
    );
    assert_eq!(
        int(
            &c.e.pool,
            &format!(
                r#"SELECT COUNT(*) FROM "RackConnection" WHERE "rackId" = '{src}' AND "wired" = 1"#
            )
        )
        .await,
        3
    );

    // An unknown source is an error, nothing written.
    let racks = int(&c.e.pool, r#"SELECT COUNT(*) FROM "Rack""#).await;
    let mut tx = begin_immediate(&c.e.pool).await.unwrap();
    let err = clone_rack_into(
        &mut tx,
        "nope",
        CloneTarget {
            name: "X",
            location_id: None,
            scope: CloneScope::Full,
        },
    )
    .await;
    assert!(matches!(err, Err(sqlx::Error::RowNotFound)), "{err:?}");
    drop(tx);
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "Rack""#).await,
        racks
    );
}

#[tokio::test]
async fn clone_routes_refuse_like_arkyo() {
    let c = ctx().await;
    let p = c.project("Match").await;
    let plateau = c.location(&p, "Plateau").await;
    let src = c.rack(&p, &plateau, "Baie").await;
    let q = c.project("Autre").await;
    let ailleurs = c.location(&q, "Ailleurs").await;
    let foreign = c.rack(&q, &ailleurs, "Baie Q").await;
    let racks = int(&c.e.pool, r#"SELECT COUNT(*) FROM "Rack""#).await;
    let rigs = int(&c.e.pool, r#"SELECT COUNT(*) FROM "RigConfig""#).await;

    // save-as-template
    let save = |rack: &str| format!("{LIST}/{p}/racks/{rack}/save-as-template");
    for (rack, msg) in [
        ("nope", "Contenant introuvable"),
        (
            foreign.as_str(),
            "Ce contenant n'appartient pas à ce projet",
        ),
    ] {
        let r = c.req("POST", &save(rack), None).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{rack}");
        assert_eq!(r.body, json!({ "error": msg }));
    }

    // clone-from-template
    let clone = format!("{LIST}/{p}/racks/clone-from-template");
    let r = call(&c.e.app, "POST", &clone, LOCAL, Some(&c.tok), None).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.body, json!({"error": "Corps de requête invalide"}));
    let r = c
        .req("POST", &clone, Some(json!({"rackTemplateId": ""})))
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        r.body,
        json!({"error": "Validation invalide", "issues": [
            {"path": ["rackTemplateId"], "message": "Too small: expected string to have >=1 characters"},
            {"path": ["locationId"], "message": "Invalid input: expected string, received undefined"},
        ]})
    );
    // a template to clone
    let r = c.req("POST", &save(&src), None).await;
    assert_eq!(r.status, StatusCode::CREATED);
    let tpl = r.body["rack"]["id"].as_str().unwrap().to_string();
    let racks = racks + 1;
    let rigs = rigs + 1;
    for (path, body, status, msg) in [
        (
            format!("{LIST}/nope/racks/clone-from-template"),
            json!({"rackTemplateId": tpl, "locationId": plateau}),
            StatusCode::NOT_FOUND,
            "Projet introuvable",
        ),
        (
            clone.clone(),
            json!({"rackTemplateId": tpl, "locationId": ailleurs}),
            StatusCode::BAD_REQUEST,
            "Emplacement introuvable",
        ),
        (
            clone.clone(),
            json!({"rackTemplateId": "nope", "locationId": plateau}),
            StatusCode::NOT_FOUND,
            "Rack template introuvable",
        ),
        (
            clone.clone(),
            json!({"rackTemplateId": foreign, "locationId": plateau}),
            StatusCode::BAD_REQUEST,
            "Ce rack n'est pas un template (il est déjà associé à un projet)",
        ),
    ] {
        let r = c.req("POST", &path, Some(body.clone())).await;
        assert_eq!(r.status, status, "{body}");
        assert_eq!(r.body, json!({ "error": msg }), "{body}");
    }
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "Rack""#).await,
        racks
    );
    assert_eq!(
        int(&c.e.pool, r#"SELECT COUNT(*) FROM "RigConfig""#).await,
        rigs
    );

    // A rack linked to no rig passes arkyo's template test (`every` on an
    // empty list).
    exec(
        &c.e.pool,
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('loose','Orphelin',?,?)"#,
    )
    .await;
    let r = c
        .req(
            "POST",
            &clone,
            Some(json!({"rackTemplateId": "loose", "locationId": plateau})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    assert_eq!(r.body["rack"]["name"], "Orphelin");

    // projects:write
    add_user(&c.e.pool, "c@b.fr", "consultation", false).await;
    let ro = login(&c.e.app, "c@b.fr").await;
    for (path, body) in [
        (save(&src), None),
        (
            clone.clone(),
            Some(json!({"rackTemplateId": tpl, "locationId": plateau})),
        ),
    ] {
        let r = call(&c.e.app, "POST", &path, LOCAL, Some(&ro), body).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{path}");
        assert_eq!(r.body, json!({"error": "Accès refusé"}));
    }
}
