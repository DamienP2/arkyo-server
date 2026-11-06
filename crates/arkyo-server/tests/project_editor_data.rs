//! Phase 4a, Task 7: data of the project editor
//! (`GET /api/tenant/projects/:id/editor`), what arkyo's Server Component
//! `app/(fullscreen)/project/[id]/page.tsx` hands to `<ProjectEditor>`
//! (`ProjectEditorData`, `_components/project-editor.tsx:207-231`).
//!
//! The expected JSON of `editor_data_shape_matches_arkyo` is written by
//! hand from `page.tsx` (`ficheData` :263-293, `racks` :295-493, `data`
//! :504-623), not copied from the route's output.
mod common;
use std::time::Instant;

use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};
use sqlx::SqlitePool;

const LIST: &str = "/api/tenant/projects";

struct Ctx {
    e: Env,
    tok: String,
}

async fn ctx() -> Ctx {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    Ctx { e, tok }
}

impl Ctx {
    async fn get(&self, path: &str) -> Reply {
        call(&self.e.app, "GET", path, LOCAL, Some(&self.tok), None).await
    }
}

async fn exec(pool: &SqlitePool, sql: &str) {
    sqlx::query(sql)
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

/// `2026-11-06T10:00:<s>.000Z`.
fn t(s: u32) -> String {
    format!("2026-11-06T10:{:02}:{:02}.000Z", s / 60, s % 60)
}

/// The local catalogue of the shape test.
async fn catalogue(pool: &SqlitePool) {
    let now = t(0);
    for sql in [
        r#"INSERT INTO "TenantBrand" ("id","name","createdAt","updatedAt") VALUES ('b1','Blackmagic',?,?)"#,
        r#"INSERT INTO "TenantEquipmentCategory" ("id","name","color","createdAt","updatedAt") VALUES ('cat1','Régie vidéo','#112233',?,?)"#,
        r#"INSERT INTO "TenantFunction" ("id","key","label","color","sortOrder","createdAt","updatedAt") VALUES ('f-audio','t_audio','Audio','#00aa00',2,?,?)"#,
        r#"INSERT INTO "TenantFunction" ("id","key","label","color","sortOrder","createdAt","updatedAt") VALUES ('f-video','t_video','Vidéo','#0000aa',1,?,?)"#,
        r#"INSERT INTO "TenantFunction" ("id","key","label","color","sortOrder","createdAt","updatedAt") VALUES ('f-misc','t_misc','Divers',NULL,0,?,?)"#,
        // Primary function = lowest sortOrder (Vidéo), connectors.
        r#"INSERT INTO "TenantEquipment" ("id","name","reference","brandId","categoryId","heightU","depthMm","widthFraction","weight","powerW","functionIds","connectors","createdById","createdAt","updatedAt")
           VALUES ('eq1','ATEM 2 M/E','SWATEMPSW2ME','b1','cat1',2,400,'HALF',4.5,150,'["f-audio","f-video"]','[{"id":"k1","type":"BNC"}]','u',?,?)"#,
        // No function: the category.
        r#"INSERT INTO "TenantEquipment" ("id","name","categoryId","heightU","powerW","createdById","createdAt","updatedAt")
           VALUES ('eq2','Moniteur 17','cat1',1,40,'u',?,?)"#,
        // Neither function nor category.
        r#"INSERT INTO "TenantEquipment" ("id","name","isRackable","createdById","createdAt","updatedAt")
           VALUES ('eq3','Bloc secteur',0,'u',?,?)"#,
        // Primary function without colour: its label, the category colour.
        r#"INSERT INTO "TenantEquipment" ("id","name","categoryId","heightU","functionIds","createdById","createdAt","updatedAt")
           VALUES ('eq4','Convertisseur','cat1',1,'["f-misc"]','u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","heightU","isComponentHost","hostSlotCount","functionIds","createdById","createdAt","updatedAt")
           VALUES ('host-eq','Châssis openGear',2,1,4,'["f-video"]','u',?,?)"#,
        // An unknown function id is skipped.
        r#"INSERT INTO "TenantEquipment" ("id","name","isRackable","isComponent","componentSlotSpan","functionIds","createdById","createdAt","updatedAt")
           VALUES ('comp-eq','Carte SDI',0,1,2,'["fn-gone","f-audio"]','u',?,?)"#,
        r#"INSERT INTO "TenantAdapter" ("id","name","reference","functionId","createdById","createdAt","updatedAt") VALUES ('ad1','XLR F → Jack','AD-1','f-audio','u',?,?)"#,
        r#"INSERT INTO "TenantAdapter" ("id","name","createdById","createdAt","updatedAt") VALUES ('ad2','BNC → HDMI','u',?,?)"#,
        r#"INSERT INTO "Panel" ("id","name","panelType","heightU","createdById","createdAt","updatedAt") VALUES ('pa1','Patch 24 XLR','PATCH',1,'u',?,?)"#,
        r#"INSERT INTO "Panel" ("id","name","panelType","heightU","createdById","createdAt","updatedAt") VALUES ('pa2','Passe-câbles brossé','ACCESSORY',2,'u',?,?)"#,
    ] {
        sqlx::query(sql)
            .bind(&now)
            .bind(&now)
            .execute(pool)
            .await
            .unwrap_or_else(|e| panic!("{sql}: {e}"));
    }
}

async fn rack(pool: &SqlitePool, id: &str, cols: &str, vals: &str) {
    let now = t(0);
    exec(
        pool,
        &format!(
            r#"INSERT INTO "Rack" ("id","createdAt","updatedAt",{cols}) VALUES ('{id}','{now}','{now}',{vals})"#
        ),
    )
    .await;
}

async fn rig_rack(pool: &SqlitePool, id: &str, rig: &str, rack: &str, position: i64) {
    exec(
        pool,
        &format!(
            r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('{id}','{rig}','{rack}',{position})"#
        ),
    )
    .await;
}

/// A placed (or not) slot.
async fn slot(pool: &SqlitePool, id: &str, rack: &str, cols: &str, vals: &str, at: u32) {
    let ts = t(at);
    exec(
        pool,
        &format!(
            r#"INSERT INTO "RackSlot" ("id","rackId","createdAt","updatedAt",{cols}) VALUES ('{id}','{rack}','{ts}','{ts}',{vals})"#
        ),
    )
    .await;
}

async fn item(pool: &SqlitePool, id: &str, rack: &str, cols: &str, vals: &str, at: u32) {
    let ts = t(at);
    exec(
        pool,
        &format!(
            r#"INSERT INTO "RackInventoryItem" ("id","rackId","createdAt","updatedAt",{cols}) VALUES ('{id}','{rack}','{ts}','{ts}',{vals})"#
        ),
    )
    .await;
}

/// The project `p1`: 2 locations, 3 containers plus the virtual rack of a
/// location, equipments, panels, adapters and accessories.
async fn full_project(pool: &SqlitePool) {
    catalogue(pool).await;
    let now = t(0);
    for sql in [
        format!(
            r#"INSERT INTO "Project" ("id","name","clientName","shootingDate","shootingEndDate","planningStart","planningEnd","commissioningDate","location","description","status","prestationType","interventionType","rigType","createdAt","updatedAt","createdById","ipMapPositions")
               VALUES ('p1','Finale','TF1','2026-11-10T18:00:00.000Z','2026-11-11T02:00:00.000Z','2026-11-01T00:00:00.000Z',NULL,NULL,'Stade de France','Captation multicam','PRET','Captation','PRESTATION','CAR','{now}','{now}','u','{{}}')"#
        ),
        r#"INSERT INTO "ProjectDocument" ("id","projectId","name","url","mimeType","sizeBytes","uploadedAt","uploadedById")
           VALUES ('d1','p1','plan.pdf','/uploads/plan.pdf','application/pdf',1234,'2026-11-02T08:00:00.000Z','u')"#.to_string(),
        r#"INSERT INTO "ProjectDocument" ("id","projectId","name","url","mimeType","sizeBytes","uploadedAt","uploadedById")
           VALUES ('d2','p1','photo.jpg','/uploads/photo.jpg',NULL,NULL,'2026-11-03T08:00:00.000Z',NULL)"#.to_string(),
        format!(r#"INSERT INTO "Task" ("id","projectId","title","createdAt","updatedAt") VALUES ('tk1','p1','Repérage','{now}','{now}')"#),
        format!(r#"INSERT INTO "Message" ("id","projectId","authorId","content","createdAt","updatedAt") VALUES ('m1','p1','u','Bonjour','{now}','{now}')"#),
        format!(r#"INSERT INTO "Message" ("id","projectId","authorId","content","createdAt","updatedAt") VALUES ('m2','p1','u','Re','{now}','{now}')"#),
        // Inserted out of order: `orderBy: { sortOrder: "asc" }`.
        format!(r#"INSERT INTO "Location" ("id","projectId","name","cableCode","sortOrder","createdAt","updatedAt") VALUES ('l-plateau','p1','Plateau',NULL,1,'{now}','{now}')"#),
        format!(r#"INSERT INTO "Location" ("id","projectId","name","cableCode","sortOrder","createdAt","updatedAt") VALUES ('l-regie','p1','Régie','REG',0,'{now}','{now}')"#),
        // `rigConfigs[0]` is the first rig; the second one is ignored.
        format!(r#"INSERT INTO "RigConfig" ("id","name","type","projectId","createdById","createdAt","updatedAt") VALUES ('rc1','Finale — Régie principale','CAR','p1','u','{}','{}')"#, t(1), t(1)),
        format!(r#"INSERT INTO "RigConfig" ("id","name","type","projectId","createdById","createdAt","updatedAt") VALUES ('rc2','Seconde régie','CAR','p1','u','{}','{}')"#, t(2), t(2)),
    ] {
        exec(pool, &sql).await;
    }

    rack(
        pool,
        "rA",
        r#""name","rackType","totalU","depthMm","emptyWeightKg","constructionChecks","isRackable","locationId""#,
        r#"'Baie A','STANDARD',42,800,35.5,'[{"id":"c1","done":true},{"id":"c2","done":false}]',1,'l-regie'"#,
    )
    .await;
    rack(
        pool,
        "rV",
        r#""name","isRackable","isVirtual","locationId""#,
        r#"'Plateau',0,1,'l-plateau'"#,
    )
    .await;
    // `constructionChecks` emptied by the construction-checks route: JSON `null`.
    rack(
        pool,
        "rB",
        r#""name","rackType","totalU","depthMm","widthMm","heightMm","hasWheels","constructionChecks","canvasX","canvasY","locationId""#,
        r#"'Flight B','FLIGHT_CASE_CLASSIC',12,600,560,700,1,'null',120,40,'l-plateau'"#,
    )
    .await;
    rack(
        pool,
        "rC",
        r#""name","rackType","totalU","depthMm","isRackable""#,
        r#"'Pelicase C','PELICAN',4,400,0"#,
    )
    .await;
    rack(pool, "r9", r#""name""#, r#"'Hors régie'"#).await;

    // A duplicated link (old duplication bug): dropped by `page.tsx`.
    exec(pool, r#"DROP INDEX "RigRack_rigConfigId_rackId_key""#).await;
    rig_rack(pool, "rr-a", "rc1", "rA", 0).await;
    rig_rack(pool, "rr-v", "rc1", "rV", 1).await;
    rig_rack(pool, "rr-c", "rc1", "rC", 3).await;
    rig_rack(pool, "rr-b", "rc1", "rB", 2).await;
    rig_rack(pool, "rr-a2", "rc1", "rA", 4).await;
    rig_rack(pool, "rr-9", "rc2", "r9", 0).await;

    // rA: a placed slot, a ghost slot, a panel slot.
    slot(
        pool,
        "sA1",
        "rA",
        r#""catalogEquipmentId","view","startU","heightU","widthFraction""#,
        "'eq1','FRONT',10,2,'HALF'",
        1,
    )
    .await;
    slot(
        pool,
        "sA2",
        "rA",
        r#""catalogEquipmentId","view","startU","heightU""#,
        "'eq1','FRONT',NULL,NULL",
        2,
    )
    .await;
    slot(
        pool,
        "sA3",
        "rA",
        r#""panelId","view","startU","heightU","widthFraction""#,
        "'pa1','REAR',5,1,'FULL'",
        3,
    )
    .await;
    // rB: a placed slot, a slot whose equipment is gone, a slot without height.
    slot(
        pool,
        "sB2",
        "rB",
        r#""catalogEquipmentId","view","startU","heightU","widthFraction""#,
        "'gone','SIDE',3,1,'QUARTER'",
        2,
    )
    .await;
    slot(
        pool,
        "sB1",
        "rB",
        r#""catalogEquipmentId","view","startU","heightU","widthFraction""#,
        "'eq2','FRONT',1,1,'FULL'",
        1,
    )
    .await;
    slot(
        pool,
        "sB3",
        "rB",
        r#""catalogEquipmentId","view","startU","heightU""#,
        "'eq4','FRONT',4,NULL",
        3,
    )
    .await;
    slot(
        pool,
        "s9",
        "r9",
        r#""catalogEquipmentId","startU","heightU""#,
        "'eq1',1,2",
        1,
    )
    .await;

    // rA inventory, inserted backwards: `orderBy: { createdAt: "asc" }`.
    item(pool, "iA12", "rA", r#""catalogEquipmentId""#, "'gone'", 12).await;
    item(
        pool,
        "iA10",
        "rA",
        r#""catalogEquipmentId""#,
        "'host-eq'",
        10,
    )
    .await;
    item(
        pool,
        "iA11",
        "rA",
        r#""catalogEquipmentId","hostItemId","hostSlotIndex""#,
        "'comp-eq','iA10',0",
        11,
    )
    .await;
    item(
        pool,
        "iA9",
        "rA",
        r#""accessoryType","accessoryHeightU""#,
        "'plaque',4",
        9,
    )
    .await;
    item(
        pool,
        "iA8",
        "rA",
        r#""accessoryType","accessoryHeightU","accessoryVariant""#,
        "'plaque',1,'aere'",
        8,
    )
    .await;
    item(
        pool,
        "iA7",
        "rA",
        r#""accessoryType","accessoryHeightU","accessoryVariant""#,
        "'plaque',1,'pass-cable'",
        7,
    )
    .await;
    item(
        pool,
        "iA6",
        "rA",
        r#""accessoryType","accessoryHeightU""#,
        "'tiroir',3",
        6,
    )
    .await;
    item(
        pool,
        "iA5",
        "rA",
        r#""accessoryType","accessoryHeightU","accessoryDepthMm""#,
        "'etagere',1,450",
        5,
    )
    .await;
    item(
        pool,
        "iA4",
        "rA",
        r#""accessoryType","accessoryHeightU","accessoryVariant""#,
        "'plaque',2,'plein'",
        4,
    )
    .await;
    item(
        pool,
        "iA3",
        "rA",
        r#""catalogAdapterId","quantity""#,
        "'ad1',4",
        3,
    )
    .await;
    item(pool, "iA2", "rA", r#""panelId""#, "'pa1'", 2).await;
    item(
        pool,
        "iA1",
        "rA",
        r#""catalogEquipmentId","quantity""#,
        "'eq1',2",
        1,
    )
    .await;
    // rB inventory.
    item(
        pool,
        "iB1",
        "rB",
        r#""catalogEquipmentId","quantity""#,
        "'eq2',2",
        1,
    )
    .await;
    item(pool, "iB2", "rB", r#""catalogEquipmentId""#, "'eq4'", 2).await;
    item(pool, "iB3", "rB", r#""catalogEquipmentId""#, "'eq3'", 3).await;
    item(pool, "iB4", "rB", r#""panelId""#, "'pa2'", 4).await;
    item(
        pool,
        "iB5",
        "rB",
        r#""catalogAdapterId","quantity""#,
        "'ad2',3",
        5,
    )
    .await;
    // The free equipment of the Plateau.
    item(pool, "iV1", "rV", r#""catalogEquipmentId""#, "'eq1'", 1).await;
    item(pool, "i9", "r9", r#""catalogEquipmentId""#, "'eq1'", 1).await;
}

/// A BOM line of kind `equipment` (page.tsx:361-388).
#[allow(clippy::too_many_arguments)]
fn bom_equipment(
    id: &str,
    ref_id: &str,
    quantity: i64,
    name: &str,
    reference: Value,
    brand: Value,
    category: Value,
    color: Value,
    rackable: bool,
    height: Value,
    depth: Value,
    weight: Value,
    power: Value,
    host: (Value, Value),
    component: (bool, Value, bool, i64),
) -> Value {
    json!({
        "id": id, "kind": "equipment", "refId": ref_id, "quantity": quantity,
        "name": name, "reference": reference, "brandName": brand,
        "category": category, "categoryColor": color, "isRackable": rackable,
        "heightU": height, "depthMm": depth, "weightKg": weight, "powerW": power,
        "snapshotId": null, "hostItemId": host.0, "hostSlotIndex": host.1,
        "isComponentHost": component.0, "hostSlotCount": component.1,
        "isComponent": component.2, "componentSlotSpan": component.3,
    })
}

/// A BOM line of kind `panel` (page.tsx:390-412): no `refId`.
fn bom_panel(id: &str, name: &str, category: &str, height: i64) -> Value {
    json!({
        "id": id, "kind": "panel", "quantity": 1, "name": name, "reference": null,
        "brandName": null, "category": category, "categoryColor": null,
        "isRackable": true, "heightU": height, "depthMm": null, "weightKg": null,
        "powerW": null, "snapshotId": null, "hostItemId": null, "hostSlotIndex": null,
        "isComponentHost": false, "hostSlotCount": null, "isComponent": false,
        "componentSlotSpan": 1,
    })
}

/// A BOM line of kind `adapter` (page.tsx:413-438): no `refId`.
fn bom_adapter(
    id: &str,
    quantity: i64,
    name: &str,
    reference: Value,
    category: Value,
    color: Value,
) -> Value {
    json!({
        "id": id, "kind": "adapter", "quantity": quantity, "name": name,
        "reference": reference, "brandName": null, "category": category,
        "categoryColor": color, "isRackable": false, "heightU": null, "depthMm": null,
        "weightKg": null, "powerW": null, "snapshotId": null, "hostItemId": null,
        "hostSlotIndex": null, "isComponentHost": false, "hostSlotCount": null,
        "isComponent": false, "componentSlotSpan": 1,
    })
}

/// A BOM line of kind `accessory` (page.tsx:440-487): the name has no
/// depth (`accessoryDepthMm` is not selected), `depthMm` is `null`.
fn bom_accessory(id: &str, name: &str, height: i64) -> Value {
    json!({
        "id": id, "kind": "accessory", "quantity": 1, "name": name, "reference": null,
        "brandName": null, "category": "Accessoire rack", "categoryColor": null,
        "isRackable": true, "heightU": height, "depthMm": null, "weightKg": null,
        "powerW": null, "snapshotId": null, "hostItemId": null, "hostSlotIndex": null,
        "isComponentHost": false, "hostSlotCount": null, "isComponent": false,
        "componentSlotSpan": 1,
    })
}

fn expected_full() -> Value {
    let n = Value::Null;
    let atem = |id: &str, qty: i64| {
        bom_equipment(
            id,
            "eq1",
            qty,
            "ATEM 2 M/E",
            json!("SWATEMPSW2ME"),
            json!("Blackmagic"),
            json!("Vidéo"),
            json!("#0000aa"),
            true,
            json!(2),
            json!(400),
            json!(4.5),
            json!(150),
            (Value::Null, Value::Null),
            (false, Value::Null, false, 1),
        )
    };
    let rack_a = json!({
        "id": "rA", "rigConfigId": "rc1", "name": "Baie A", "rackType": "STANDARD",
        "totalU": 42, "depthMm": 800, "widthMm": null, "heightMm": null,
        "hasWheels": false, "emptyWeightKg": 35.5, "slotsCount": 3,
        "constructionChecks": 2, "isRackable": true, "hasConnectors": true,
        "canvasX": null, "canvasY": null, "locationId": "l-regie", "isVirtual": false,
        "slots": [
            {
                "startU": 10, "heightU": 2.0, "widthFraction": "HALF", "view": "FRONT",
                "category": null, "categoryId": "cat1", "equipmentName": "ATEM 2 M/E",
                "equipmentReference": "SWATEMPSW2ME", "brandName": "Blackmagic",
                "weightKg": 4.5, "powerW": 150,
            },
            {
                "startU": 5, "heightU": 1.0, "widthFraction": "FULL", "view": "REAR",
                "category": null, "categoryId": null, "equipmentName": null,
                "equipmentReference": null, "brandName": null, "weightKg": null,
                "powerW": null,
            },
        ],
        "bom": [
            atem("iA1", 2),
            bom_panel("iA2", "Patch 24 XLR", "Panels de patch", 1),
            bom_adapter("iA3", 4, "XLR F → Jack", json!("AD-1"), json!("Audio"), json!("#00aa00")),
            bom_accessory("iA4", "Plaque pleine 2U", 2),
            bom_accessory("iA5", "Étagère 1U", 1),
            bom_accessory("iA6", "Tiroir 3U", 3),
            bom_accessory("iA7", "Plaque pass-câble 1U", 1),
            bom_accessory("iA8", "Plaque aérée 1U", 1),
            bom_accessory("iA9", "Plaque 4U", 4),
            bom_equipment(
                "iA10", "host-eq", 1, "Châssis openGear", n.clone(), n.clone(),
                json!("Vidéo"), json!("#0000aa"), true, json!(2), n.clone(), n.clone(),
                n.clone(), (n.clone(), n.clone()), (true, json!(4), false, 1),
            ),
            bom_equipment(
                "iA11", "comp-eq", 1, "Carte SDI", n.clone(), n.clone(), json!("Audio"),
                json!("#00aa00"), false, n.clone(), n.clone(), n.clone(), n.clone(),
                (json!("iA10"), json!(0)), (false, n.clone(), true, 2),
            ),
        ],
    });
    let rack_v = json!({
        "id": "rV", "rigConfigId": "rc1", "name": "Plateau", "rackType": "STANDARD",
        "totalU": 42, "depthMm": 600, "widthMm": null, "heightMm": null,
        "hasWheels": false, "emptyWeightKg": null, "slotsCount": 0,
        "constructionChecks": 0, "isRackable": false, "hasConnectors": false,
        "canvasX": null, "canvasY": null, "locationId": "l-plateau", "isVirtual": true,
        "slots": [], "bom": [atem("iV1", 1)],
    });
    let rack_b = json!({
        "id": "rB", "rigConfigId": "rc1", "name": "Flight B",
        "rackType": "FLIGHT_CASE_CLASSIC", "totalU": 12, "depthMm": 600,
        "widthMm": 560, "heightMm": 700, "hasWheels": true, "emptyWeightKg": null,
        "slotsCount": 3, "constructionChecks": 0, "isRackable": true,
        "hasConnectors": false, "canvasX": 120, "canvasY": 40,
        "locationId": "l-plateau", "isVirtual": false,
        "slots": [
            {
                "startU": 1, "heightU": 1.0, "widthFraction": "FULL", "view": "FRONT",
                "category": null, "categoryId": "cat1", "equipmentName": "Moniteur 17",
                "equipmentReference": null, "brandName": null, "weightKg": null,
                "powerW": 40,
            },
            {
                "startU": 3, "heightU": 1.0, "widthFraction": "QUARTER", "view": "SIDE",
                "category": null, "categoryId": null, "equipmentName": null,
                "equipmentReference": null, "brandName": null, "weightKg": null,
                "powerW": null,
            },
        ],
        "bom": [
            bom_equipment(
                "iB1", "eq2", 2, "Moniteur 17", n.clone(), n.clone(), json!("Régie vidéo"),
                json!("#112233"), true, json!(1), n.clone(), n.clone(), json!(40),
                (n.clone(), n.clone()), (false, n.clone(), false, 1),
            ),
            bom_equipment(
                "iB2", "eq4", 1, "Convertisseur", n.clone(), n.clone(), json!("Divers"),
                json!("#112233"), true, json!(1), n.clone(), n.clone(), n.clone(),
                (n.clone(), n.clone()), (false, n.clone(), false, 1),
            ),
            bom_equipment(
                "iB3", "eq3", 1, "Bloc secteur", n.clone(), n.clone(), n.clone(), n.clone(),
                false, n.clone(), n.clone(), n.clone(), n.clone(), (n.clone(), n.clone()),
                (false, n.clone(), false, 1),
            ),
            bom_panel("iB4", "Passe-câbles brossé", "Accessoire rack", 2),
            bom_adapter("iB5", 3, "BNC → HDMI", n.clone(), n.clone(), n.clone()),
        ],
    });
    let rack_c = json!({
        "id": "rC", "rigConfigId": "rc1", "name": "Pelicase C", "rackType": "PELICAN",
        "totalU": 4, "depthMm": 400, "widthMm": null, "heightMm": null,
        "hasWheels": false, "emptyWeightKg": null, "slotsCount": 0,
        "constructionChecks": 0, "isRackable": false, "hasConnectors": false,
        "canvasX": null, "canvasY": null, "locationId": null, "isVirtual": false,
        "slots": [], "bom": [],
    });
    json!({
        "header": {
            "id": "p1", "name": "Finale", "status": "PRET",
            "interventionType": "PRESTATION", "rigType": "CAR", "clientName": "TF1",
            "shootingDate": "2026-11-10T18:00:00.000Z", "location": "Stade de France",
            "prestationType": "Captation",
        },
        "fiche": {
            "id": "p1", "name": "Finale", "status": "PRET",
            "interventionType": "PRESTATION", "rigType": "CAR", "clientName": "TF1",
            "shootingDate": "2026-11-10T18:00:00.000Z",
            "shootingEndDate": "2026-11-11T02:00:00.000Z",
            "planningStart": "2026-11-01T00:00:00.000Z", "planningEnd": null,
            "commissioningDate": null, "location": "Stade de France",
            "description": "Captation multicam", "prestationType": "Captation",
            "documents": [
                {
                    "id": "d2", "name": "photo.jpg", "url": "/uploads/photo.jpg",
                    "mimeType": null, "sizeBytes": null,
                    "uploadedAt": "2026-11-03T08:00:00.000Z",
                },
                {
                    "id": "d1", "name": "plan.pdf", "url": "/uploads/plan.pdf",
                    "mimeType": "application/pdf", "sizeBytes": 1234,
                    "uploadedAt": "2026-11-02T08:00:00.000Z",
                },
            ],
            "counts": { "tasks": 1, "messages": 2, "documents": 2 },
        },
        "inventaire": {
            "rigConfigId": "rc1",
            "racks": [rack_a, rack_v, rack_b, rack_c],
            "locations": [
                { "id": "l-regie", "name": "Régie", "cableCode": "REG", "sortOrder": 0, "virtualRackId": null },
                { "id": "l-plateau", "name": "Plateau", "cableCode": null, "sortOrder": 1, "virtualRackId": "rV" },
            ],
        },
        "cartographie": { "maps": [] },
    })
}

/// Field-by-field diff, for a readable failure.
fn diff(path: &str, got: &Value, want: &Value, out: &mut Vec<String>) {
    match (got, want) {
        (Value::Object(g), Value::Object(w)) => {
            for k in w.keys().chain(g.keys().filter(|k| !w.contains_key(*k))) {
                let p = format!("{path}.{k}");
                match (g.get(k), w.get(k)) {
                    (Some(a), Some(b)) => diff(&p, a, b, out),
                    (None, Some(b)) => out.push(format!("{p}: absent, attendu {b}")),
                    (Some(a), None) => out.push(format!("{p}: {a} en trop")),
                    (None, None) => {}
                }
            }
        }
        (Value::Array(g), Value::Array(w)) if g.len() == w.len() => {
            for (i, (a, b)) in g.iter().zip(w).enumerate() {
                diff(&format!("{path}[{i}]"), a, b, out);
            }
        }
        _ if got != want => out.push(format!("{path}: {got} au lieu de {want}")),
        _ => {}
    }
}

#[tokio::test]
async fn editor_data_shape_matches_arkyo() {
    let c = ctx().await;
    full_project(&c.e.pool).await;
    let r = c.get(&format!("{LIST}/p1/editor")).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let mut errs = Vec::new();
    diff("$", &r.body, &expected_full(), &mut errs);
    assert!(errs.is_empty(), "écarts :\n{}", errs.join("\n"));
    assert_eq!(r.body, expected_full());
}

/// `hasConnectors` looks at every slot, ghosts included (`page.tsx:310`):
/// a rack whose only equipment with connectors is a ghost slot has some.
#[tokio::test]
async fn has_connectors_from_a_single_ghost_slot() {
    let c = ctx().await;
    full_project(&c.e.pool).await;
    // rA keeps the ghost slot of eq1 (connectors) and the panel slot.
    exec(&c.e.pool, r#"DELETE FROM "RackSlot" WHERE "id" = 'sA1'"#).await;
    let r = c.get(&format!("{LIST}/p1/editor")).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let ra = r.body["inventaire"]["racks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == "rA")
        .unwrap();
    // Only the panel slot is placed.
    assert_eq!(ra["slots"].as_array().unwrap().len(), 1, "{ra}");
    assert_eq!(ra["slotsCount"], 2);
    assert_eq!(ra["hasConnectors"], true);
}

#[tokio::test]
async fn empty_project_opens() {
    let c = ctx().await;
    // A project created by the API: no location, no rig, no rack.
    let r = call(
        &c.e.app,
        "POST",
        LIST,
        LOCAL,
        Some(&c.tok),
        Some(json!({"name": "Vide", "interventionType": "INTEGRATION"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let id = r.body["id"].as_str().unwrap().to_string();
    let created_at = r.body["createdAt"].clone();
    assert!(created_at.is_string());

    let r = c.get(&format!("{LIST}/{id}/editor")).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(
        r.body,
        json!({
            "header": {
                "id": id, "name": "Vide", "status": "EN_PREPARATION",
                "interventionType": "INTEGRATION", "rigType": null, "clientName": null,
                "shootingDate": null, "location": null, "prestationType": null,
            },
            "fiche": {
                "id": id, "name": "Vide", "status": "EN_PREPARATION",
                "interventionType": "INTEGRATION", "rigType": null, "clientName": null,
                "shootingDate": null, "shootingEndDate": null, "planningStart": null,
                "planningEnd": null, "commissioningDate": null, "location": null,
                "description": null, "prestationType": null, "documents": [],
                "counts": { "tasks": 0, "messages": 0, "documents": 0 },
            },
            "inventaire": { "rigConfigId": null, "racks": [], "locations": [] },
            "cartographie": { "maps": [] },
        })
    );

    // A location without container: its rig and virtual rack exist, the
    // location opens with its (empty) virtual rack.
    let r = call(
        &c.e.app,
        "POST",
        &format!("{LIST}/{id}/locations"),
        LOCAL,
        Some(&c.tok),
        Some(json!({"name": "Plateau"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let loc = r.body["id"].as_str().unwrap().to_string();
    let r = c.get(&format!("{LIST}/{id}/editor")).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let inv = &r.body["inventaire"];
    assert!(inv["rigConfigId"].is_string(), "{inv}");
    let racks = inv["racks"].as_array().unwrap();
    assert!(racks.iter().all(|r| r["isVirtual"] == true), "{inv}");
    assert_eq!(inv["locations"][0]["id"], json!(loc));
    let virtual_id = inv["locations"][0]["virtualRackId"].clone();
    assert!(
        racks
            .iter()
            .any(|r| r["id"] == virtual_id && r["bom"] == json!([])),
        "{inv}"
    );
}

#[tokio::test]
async fn unknown_project_is_404() {
    let c = ctx().await;
    let r = c.get(&format!("{LIST}/absent/editor")).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Not found"}));
}

#[tokio::test]
async fn editor_requires_session_and_projects_read() {
    let c = ctx().await;
    full_project(&c.e.pool).await;
    let r = call(
        &c.e.app,
        "GET",
        &format!("{LIST}/p1/editor"),
        LOCAL,
        None,
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);

    exec(
        &c.e.pool,
        r#"INSERT INTO "Role" ("id","key","label","permissions","createdAt","updatedAt")
           VALUES ('r-cat','catalogue','Catalogue','{"catalog":"write"}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .await;
    add_user(&c.e.pool, "cat@b.fr", "catalogue", false).await;
    let tok = login(&c.e.app, "cat@b.fr").await;
    let r = call(
        &c.e.app,
        "GET",
        &format!("{LIST}/p1/editor"),
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(r.body, json!({"error": "Accès refusé"}));

    exec(
        &c.e.pool,
        r#"INSERT INTO "Role" ("id","key","label","permissions","createdAt","updatedAt")
           VALUES ('r-read','lecteur','Lecteur','{"projects":"read"}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .await;
    add_user(&c.e.pool, "lec@b.fr", "lecteur", false).await;
    let tok = login(&c.e.app, "lec@b.fr").await;
    let r = call(
        &c.e.app,
        "GET",
        &format!("{LIST}/p1/editor"),
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
}

/// 500 inventory items in 10 containers (and as many placed slots): the
/// route answers in less than 2 s (review focus 4).
#[tokio::test]
async fn large_project_under_2s() {
    let c = ctx().await;
    catalogue(&c.e.pool).await;
    let now = t(0);
    exec(
        &c.e.pool,
        &format!(
            r#"INSERT INTO "Project" ("id","name","status","interventionType","createdAt","updatedAt","createdById")
               VALUES ('big','Gros projet','EN_COURS','PRESTATION','{now}','{now}','u')"#
        ),
    )
    .await;
    exec(
        &c.e.pool,
        &format!(
            r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt")
               VALUES ('rig','Régie','big','u','{now}','{now}')"#
        ),
    )
    .await;
    let mut tx = c.e.pool.begin().await.unwrap();
    for l in 0..5 {
        sqlx::query(
            r#"INSERT INTO "Location" ("id","projectId","name","sortOrder","createdAt","updatedAt") VALUES (?,'big',?,?,?,?)"#,
        )
        .bind(format!("loc{l}"))
        .bind(format!("Lieu {l}"))
        .bind(l)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .unwrap();
    }
    let refs = [
        ("catalogEquipmentId", "eq1"),
        ("catalogEquipmentId", "eq2"),
        ("panelId", "pa1"),
        ("catalogAdapterId", "ad1"),
        ("accessoryType", "plaque"),
    ];
    for r in 0..10 {
        let rack = format!("rack{r}");
        sqlx::query(
            r#"INSERT INTO "Rack" ("id","name","locationId","constructionChecks","createdAt","updatedAt") VALUES (?,?,?,'[{"id":"x"}]',?,?)"#,
        )
        .bind(&rack)
        .bind(format!("Baie {r}"))
        .bind(format!("loc{}", r % 5))
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query(r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES (?,'rig',?,?)"#)
            .bind(format!("rr{r}"))
            .bind(&rack)
            .bind(r)
            .execute(&mut *tx)
            .await
            .unwrap();
        for i in 0..50 {
            let id = format!("it{r}-{i}");
            let ts = t(i);
            let (col, val) = refs[i as usize % refs.len()];
            let sql = if col == "accessoryType" {
                r#"INSERT INTO "RackInventoryItem" ("id","rackId","accessoryType","accessoryHeightU","createdAt","updatedAt") VALUES (?,?,?,1,?,?)"#.to_string()
            } else {
                format!(
                    r#"INSERT INTO "RackInventoryItem" ("id","rackId","{col}","createdAt","updatedAt") VALUES (?,?,?,?,?)"#
                )
            };
            sqlx::query(&sql)
                .bind(&id)
                .bind(&rack)
                .bind(val)
                .bind(&ts)
                .bind(&ts)
                .execute(&mut *tx)
                .await
                .unwrap();
            sqlx::query(
                r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","inventoryItemId","startU","heightU","createdAt","updatedAt") VALUES (?,?,'eq1',?,?,1,?,?)"#,
            )
            .bind(format!("sl{r}-{i}"))
            .bind(&rack)
            .bind(&id)
            .bind(i + 1)
            .bind(&ts)
            .bind(&ts)
            .execute(&mut *tx)
            .await
            .unwrap();
        }
    }
    tx.commit().await.unwrap();

    let started = Instant::now();
    let r = c.get(&format!("{LIST}/big/editor")).await;
    let elapsed = started.elapsed();
    eprintln!("large_project_under_2s: {elapsed:?}");
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let racks = r.body["inventaire"]["racks"].as_array().unwrap();
    assert_eq!(racks.len(), 10);
    let items: usize = racks
        .iter()
        .map(|r| r["bom"].as_array().unwrap().len())
        .sum();
    assert_eq!(items, 500);
    let slots: usize = racks
        .iter()
        .map(|r| r["slots"].as_array().unwrap().len())
        .sum();
    assert_eq!(slots, 500);
    assert!(racks
        .iter()
        .all(|r| r["hasConnectors"] == true && r["constructionChecks"] == 1));
    assert!(
        elapsed.as_millis() < 2000,
        "route editor : {elapsed:?} pour 500 items"
    );
}
