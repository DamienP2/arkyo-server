//! Phase 4b, Task 2: canvas data of a project rack
//! (`GET /api/tenant/projects/:id/racks/:rackId/canvas-data`,
//! arkyo:app/api/tenant/projects/[id]/racks/[rackId]/canvas-data/route.ts),
//! construction checks (`GET/PATCH /api/racks/:id/construction-checks`,
//! arkyo:app/api/racks/[id]/construction-checks/route.ts) and canvas position
//! (`PATCH /api/racks/:id/canvas-position`,
//! arkyo:app/api/racks/[id]/canvas-position/route.ts).
#![recursion_limit = "256"]
mod common;
use std::net::SocketAddr;
use std::time::Duration;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tokio::sync::broadcast::error::TryRecvError;
use tower::ServiceExt;

const NOW: &str = "2026-11-07T10:00:00.000Z";
const CLIENT: &str = "tab-1";

struct Ctx {
    e: Env,
    tok: String,
}

/// An owner session and the fixture of [`fixture`].
async fn ctx() -> Ctx {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    fixture(&e.pool).await;
    Ctx { e, tok }
}

impl Ctx {
    async fn send(&self, method: &str, uri: &str, body: Option<Value>) -> Reply {
        send_as(&self.e, Some(&self.tok), method, uri, body).await
    }
}

async fn send_raw(e: &Env, tok: Option<&str>, method: &str, uri: &str, body: Body) -> Reply {
    let mut b = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-client-id", CLIENT)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(t) = tok {
        b = b.header(header::COOKIE, format!("arkyo_session={t}"));
    }
    let mut req = b.body(body).unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(LOCAL.parse::<SocketAddr>().unwrap()));
    let res = e.app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        cookie: None,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    }
}

async fn send_as(
    e: &Env,
    tok: Option<&str>,
    method: &str,
    uri: &str,
    body: Option<Value>,
) -> Reply {
    let body = body.map_or_else(Body::empty, |v| Body::from(v.to_string()));
    send_raw(e, tok, method, uri, body).await
}

async fn exec(pool: &SqlitePool, sql: &str) {
    let mut q = sqlx::query(sql);
    for _ in 0..sql.matches('?').count() {
        q = q.bind(NOW);
    }
    q.execute(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

async fn int(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

async fn text(pool: &SqlitePool, sql: &str) -> String {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

/// A role without any permission (`{}`).
async fn no_rights_user(e: &Env) -> String {
    exec(
        &e.pool,
        r#"INSERT INTO "Role" ("id","key","label","permissions","createdAt","updatedAt")
           VALUES ('r-none','sans-droits','Sans droits','{}',?,?)"#,
    )
    .await;
    add_user(&e.pool, "n@b.fr", "sans-droits", false).await;
    login(&e.app, "n@b.fr").await
}

/// The data of the canvas test, inserted by hand with fixed ids (the seeded
/// catalogue is emptied first):
/// - functions `f-audio` (sortOrder 1, no colour) and `f-video` (2);
/// - categories `cat-acc` « Accessoire rack » and `cat-cam` « Caméras »;
/// - brand `b1`; connector types `ct1` (XLR, two functions) and `ct2`;
///   signals `sig1`, `sig2`;
/// - equipment `eq1` (two functions), `eq-acc` (rack accessory), `eq-host`
///   (modular host), `eq-mod` (component), `eq-old` (inactive);
/// - panels `pa0` (no slot) and `pa1` (two slots, one on an unknown
///   connector type);
/// - project `p1`, its rig `rig1` and a template rig `rig-tpl`, both linked
///   to rack `r1`; rack `r-out` outside the project;
/// - inventory `inv-eq1`, `inv-host` with components `inv-c1` (index 2) and
///   `inv-c0` (index 0, unknown equipment);
/// - slots `s-ghost` (unplaced), `s-host` (U10), `s-old` (U1), `s-panel`
///   (U5), the shelf `s-shelf` (U3) with children `s-child` and `s-child2`;
/// - AppConfig `patch_panel_depth_mm` = "12".
async fn fixture(pool: &SqlitePool) {
    for t in [
        "TenantFunction",
        "TenantEquipmentCategory",
        "TenantBrand",
        "TenantConnectorType",
        "TenantSignalType",
        "TenantEquipment",
    ] {
        exec(pool, &format!(r#"DELETE FROM "{t}""#)).await;
    }
    for sql in [
        r#"INSERT INTO "TenantFunction" ("id","key","label","color","sortOrder","createdAt","updatedAt")
           VALUES ('f-video','VIDEO','Vidéo','#3b82f6',2,?,?)"#,
        r#"INSERT INTO "TenantFunction" ("id","key","label","sortOrder","createdAt","updatedAt")
           VALUES ('f-audio','AUDIO','Audio',1,?,?)"#,
        r#"INSERT INTO "TenantEquipmentCategory" ("id","name","color","createdAt","updatedAt")
           VALUES ('cat-acc','Accessoire rack','#999999',?,?)"#,
        r#"INSERT INTO "TenantEquipmentCategory" ("id","name","color","createdAt","updatedAt")
           VALUES ('cat-cam','Caméras','#ff0000',?,?)"#,
        r#"INSERT INTO "TenantBrand" ("id","name","createdAt","updatedAt") VALUES ('b1','Blackmagic',?,?)"#,
        r#"INSERT INTO "TenantConnectorType" ("id","name","versions","iconId","color","functionIds","createdAt","updatedAt")
           VALUES ('ct1','XLR','["3 broches"]','xlr','#111111','["f-audio","f-video"]',?,?)"#,
        r#"INSERT INTO "TenantConnectorType" ("id","name","createdAt","updatedAt") VALUES ('ct2','BNC',?,?)"#,
        r#"INSERT INTO "TenantSignalType" ("id","name","color","functionId","cablePrefix","createdAt","updatedAt")
           VALUES ('sig1','SDI','#00ff00','f-video','V',?,?)"#,
        r#"INSERT INTO "TenantSignalType" ("id","name","isIp","createdAt","updatedAt") VALUES ('sig2','Dante',1,?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","reference","brandId","categoryId","heightU","widthFraction","functionIds","createdById","createdAt","updatedAt")
           VALUES ('eq1','ATEM','SW-ATEM','b1','cat-cam',2,'HALF','["f-video","f-audio"]','u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","categoryId","heightU","createdById","createdAt","updatedAt")
           VALUES ('eq-acc','Tiroir 1U','cat-acc',1,'u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","heightU","isComponentHost","hostSlotCount","createdById","createdAt","updatedAt")
           VALUES ('eq-host','Châssis',1,1,4,'u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","isRackable","isComponent","componentSlotSpan","functionIds","createdById","createdAt","updatedAt")
           VALUES ('eq-mod','Carte SDI',0,1,2,'["f-video"]','u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","brandId","categoryId","heightU","isActive","createdById","createdAt","updatedAt")
           VALUES ('eq-old','Ancien convertisseur','b1','cat-cam',1,0,'u',?,?)"#,
        r#"INSERT INTO "Panel" ("id","name","heightU","slotsPerU","createdById","createdAt","updatedAt")
           VALUES ('pa1','Patch XLR',1,24,'u',?,?)"#,
        r#"INSERT INTO "Panel" ("id","name","panelType","createdById","createdAt","updatedAt")
           VALUES ('pa0','Alpha plaque','ACCESSORY','u',?,?)"#,
        r#"INSERT INTO "PanelSlot" ("id","panelId","position","label","catalogConnectorTypeId","mountD","familyLabel")
           VALUES ('ps1','pa1',0,'IN 1','ct1',1,'Famille')"#,
        r#"INSERT INTO "PanelSlot" ("id","panelId","position","catalogConnectorTypeId") VALUES ('ps2','pa1',1,'ct-gone')"#,
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('p1','Match','u',?,?)"#,
        r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt")
           VALUES ('rig1','Match — Régie principale','p1','u',?,?)"#,
        r#"INSERT INTO "RigConfig" ("id","name","isTemplate","createdById","createdAt","updatedAt")
           VALUES ('rig-tpl','Modèle',1,'u',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","constructionChecks","canvasX","createdAt","updatedAt")
           VALUES ('r1','Baie A','null',100,?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('r-out','Ailleurs',?,?)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr1','rig1','r1',0)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr0','rig-tpl','r1',3)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","createdAt","updatedAt")
           VALUES ('inv-eq1','r1','eq1',?,?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","createdAt","updatedAt")
           VALUES ('inv-host','r1','eq-host',?,?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","hostItemId","hostSlotIndex","createdAt","updatedAt")
           VALUES ('inv-c1','r1','eq-mod','inv-host',2,?,?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","hostItemId","hostSlotIndex","createdAt","updatedAt")
           VALUES ('inv-c0','r1','eq-gone','inv-host',0,?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","inventoryItemId","label","createdAt","updatedAt")
           VALUES ('s-ghost','r1','eq1','inv-eq1','#AB12',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","inventoryItemId","startU","heightU","createdAt","updatedAt")
           VALUES ('s-host','r1','eq-host','inv-host',10,1,?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","startU","heightU","view","column","createdAt","updatedAt")
           VALUES ('s-old','r1','eq-old',1,1,'REAR',2,?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","panelId","startU","heightU","panelLabels","createdAt","updatedAt")
           VALUES ('s-panel','r1','pa1',5,1,'{"0":"CAM 1"}',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","startU","heightU","label","notes","createdAt","updatedAt")
           VALUES ('s-shelf','r1',3,1,'Étagère','{"accessoryType":"etagere"}',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","parentSlotId","heightU","synopticX","createdAt","updatedAt")
           VALUES ('s-child','r1','eq-acc','s-shelf',1,12.5,?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","panelId","parentSlotId","widthFraction","createdAt","updatedAt")
           VALUES ('s-child2','r1','pa1','s-shelf','HALF',?,?)"#,
        r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES ('cfg1','patch_panel_depth_mm','12',?)"#,
    ] {
        exec(pool, sql).await;
    }
}

// ── expected values, written from arkyo's route ────────────────────────────

/// Integral floats become integers, recursively: `REAL` columns come out as
/// `2.0` where Postgres gave `2`, the same JavaScript number.
fn norm(v: Value) -> Value {
    match v {
        Value::Number(n) => match n.as_f64() {
            Some(f) if n.is_f64() && f.fract() == 0.0 && f.abs() < 9e15 => json!(f as i64),
            _ => Value::Number(n),
        },
        Value::Array(a) => Value::Array(a.into_iter().map(norm).collect()),
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, norm(v))).collect()),
        other => other,
    }
}

/// `{...base, ...over}`.
fn with(mut base: Value, over: Value) -> Value {
    for (k, v) in over.as_object().unwrap() {
        base[k] = v.clone();
    }
    base
}

fn brand_b1() -> Value {
    json!({"id": "b1", "name": "Blackmagic", "website": null, "logoUrl": null,
           "isActive": true, "createdAt": NOW, "updatedAt": NOW})
}

fn fn_video() -> Value {
    json!({"id": "f-video", "label": "Vidéo", "color": "#3b82f6", "sortOrder": 2})
}

fn fn_audio() -> Value {
    json!({"id": "f-audio", "label": "Audio", "color": null, "sortOrder": 1})
}

/// Every scalar of the Prisma `TenantEquipment` model with its default.
fn equipment(over: Value) -> Value {
    with(
        json!({
            "id": null, "name": null, "reference": null, "brandId": null, "categoryId": null,
            "typeId": null, "clonedFromArkyoId": null, "shadowsArkyo": false,
            "clonedFromArkyoVersion": null, "isRackable": true, "heightU": null, "depthMm": null,
            "rearCableDepthMm": null, "widthFraction": "FULL", "dimLmm": null, "dimWmm": null,
            "dimHmm": null, "weight": null, "powerW": null, "heatBtuH": null, "hasDualPsu": false,
            "is2110": false, "ip2110Mode": null, "isLightingFixture": false,
            "dmxChannelsDefault": null, "dmxModes": [], "isComponentHost": false,
            "hostSlotCount": null, "isComponent": false, "componentSlotSpan": 1, "connectors": [],
            "signalCapacities": [], "customFields": [], "imageUrl": null, "iconUrl": null,
            "rackSymbolUrl": null, "rackSymbolRearUrl": null, "rackPhotoFrontUrl": null,
            "rackPhotoRearUrl": null, "schemaImageUrl": null, "frontImageUrl": null,
            "rearImageUrl": null, "documents": [], "notes": null, "tags": [], "isActive": true,
            "createdById": "u", "createdAt": NOW, "updatedAt": NOW, "functionIds": [],
            "phaseIds": []
        }),
        over,
    )
}

/// Palette items (`allCatalogEquipment` with `include: { functions }`): the
/// row, `functions: [{ function: {id, label, color, sortOrder} }]` and the
/// legacy `category` text (here the name of `categoryId`).
fn eq1_row() -> Value {
    equipment(json!({
        "id": "eq1", "name": "ATEM", "reference": "SW-ATEM", "brandId": "b1",
        "categoryId": "cat-cam", "heightU": 2, "widthFraction": "HALF",
        "functionIds": ["f-video", "f-audio"],
        "functions": [{"function": fn_video()}, {"function": fn_audio()}],
        "category": "Caméras"
    }))
}

fn eq_mod_row() -> Value {
    equipment(json!({
        "id": "eq-mod", "name": "Carte SDI", "isRackable": false, "isComponent": true,
        "componentSlotSpan": 2, "functionIds": ["f-video"],
        "functions": [{"function": fn_video()}], "category": null
    }))
}

fn eq_host_row() -> Value {
    equipment(json!({
        "id": "eq-host", "name": "Châssis", "heightU": 1, "isComponentHost": true,
        "hostSlotCount": 4, "functions": [], "category": null
    }))
}

fn eq_acc_row() -> Value {
    equipment(json!({
        "id": "eq-acc", "name": "Tiroir 1U", "categoryId": "cat-acc", "heightU": 1,
        "functions": [], "category": "Accessoire rack"
    }))
}

/// The tenant fallback of an equipment absent from the palette (inactive):
/// the `select` of route.ts:294-315 only.
fn eq_old_fallback() -> Value {
    json!({
        "id": "eq-old", "name": "Ancien convertisseur", "reference": null, "heightU": 1,
        "widthFraction": "FULL", "depthMm": null, "rearCableDepthMm": null, "weight": null,
        "powerW": null, "isRackable": true, "connectors": [], "imageUrl": null,
        "rackSymbolUrl": null, "rackSymbolRearUrl": null, "rackPhotoFrontUrl": null,
        "rackPhotoRearUrl": null, "brandId": "b1", "categoryId": "cat-cam", "functionIds": [],
        "componentSlotSpan": 1
    })
}

/// `connectorTypeMap` value: the `select` of route.ts:198-207.
fn ct1_full() -> Value {
    json!({"id": "ct1", "name": "XLR", "versions": ["3 broches"], "iconId": "xlr",
           "color": "#111111", "functions": [{"functionId": "f-audio"}, {"functionId": "f-video"}]})
}

fn pa1() -> Value {
    json!({
        "id": "pa1", "name": "Patch XLR", "heightU": 1, "slotsPerU": 24, "rearCableDepthMm": 80,
        "slots": [
            {"id": "ps1", "position": 0, "sizeSlots": 1, "label": "IN 1", "notes": null,
             "catalogConnectorTypeId": "ct1", "mountD": true,
             "connectorTypeId": "ct1", "connectorType": ct1_full()},
            {"id": "ps2", "position": 1, "sizeSlots": 1, "label": null, "notes": null,
             "catalogConnectorTypeId": "ct-gone", "mountD": false,
             "connectorTypeId": "ct-gone", "connectorType": null}
        ]
    })
}

/// Every scalar of the Prisma `RackSlot` model with its default.
fn slot(over: Value) -> Value {
    with(
        json!({
            "id": null, "rackId": "r1", "catalogEquipmentId": null, "snapshotId": null,
            "panelId": null, "parentSlotId": null, "inventoryItemId": null, "view": "FRONT",
            "startU": null, "heightU": null, "widthFraction": "FULL", "column": 0, "label": null,
            "notes": null, "patchNotes": null, "panelLabels": null, "synopticX": null,
            "synopticY": null, "createdAt": NOW, "updatedAt": NOW
        }),
        over,
    )
}

fn expected_canvas_data() -> Value {
    let rack = json!({
        "id": "r1", "name": "Baie A", "totalU": 42, "depthMm": 600, "maxWeightKg": null,
        "maxPowerW": null, "emptyWeightKg": null, "notes": null, "rearInteriorGapMm": null,
        "cableId": null, "cableNextNum": 1, "cableCode": null, "numberingOverride": null,
        "rackType": "STANDARD", "isRackable": true, "widthMm": null, "heightMm": null,
        "hasWheels": false,
        // Prisma.JsonNull stored by construction-checks: returned as is.
        "constructionChecks": null,
        "templateStatus": "BROUILLON", "prepStatus": "TO_PREPARE", "sourcing": "STOCK",
        "canvasX": 100, "canvasY": null, "locationId": null, "isVirtual": false,
        "createdAt": NOW, "updatedAt": NOW,
        // Every RigRack of the rack (no filter), with rigConfig {id, name, projectId}.
        "rigs": [
            {"id": "rr1", "rigConfigId": "rig1", "rackId": "r1", "position": 0,
             "rigConfig": {"id": "rig1", "name": "Match — Régie principale", "projectId": "p1"}},
            {"id": "rr0", "rigConfigId": "rig-tpl", "rackId": "r1", "position": 3,
             "rigConfig": {"id": "rig-tpl", "name": "Modèle", "projectId": null}}
        ],
        // parentSlotId null, orderBy startU asc (Postgres: nulls last).
        "slots": [
            with(slot(json!({"id": "s-old", "catalogEquipmentId": "eq-old", "startU": 1,
                              "heightU": 1, "view": "REAR", "column": 2})),
                 json!({
                     "panel": null, "children": [], "components": [],
                     // fallback select + category (fallback categoryId) + brand
                     "equipment": with(eq_old_fallback(),
                                       json!({"category": "Caméras", "brand": brand_b1()}))
                 })),
            with(slot(json!({"id": "s-shelf", "startU": 3, "heightU": 1, "label": "Étagère",
                              "notes": "{\"accessoryType\":\"etagere\"}"})),
                 json!({
                     "panel": null, "equipment": null, "components": [],
                     "children": [
                         with(slot(json!({"id": "s-child", "catalogEquipmentId": "eq-acc",
                                           "parentSlotId": "s-shelf", "heightU": 1,
                                           "synopticX": 12.5})),
                              json!({"panel": null, "components": [],
                                     "equipment": with(eq_acc_row(), json!({"brand": null}))})),
                         with(slot(json!({"id": "s-child2", "panelId": "pa1",
                                           "parentSlotId": "s-shelf", "widthFraction": "HALF"})),
                              json!({"panel": pa1(), "components": [], "equipment": null}))
                     ]
                 })),
            with(slot(json!({"id": "s-panel", "panelId": "pa1", "startU": 5, "heightU": 1,
                              "panelLabels": {"0": "CAM 1"}})),
                 json!({"panel": pa1(), "children": [], "components": [], "equipment": null})),
            with(slot(json!({"id": "s-host", "catalogEquipmentId": "eq-host",
                              "inventoryItemId": "inv-host", "startU": 10, "heightU": 1})),
                 json!({
                     "panel": null, "children": [],
                     "equipment": with(eq_host_row(), json!({"brand": null})),
                     // by hostSlotIndex; unknown equipment → null, span 1
                     "components": [
                         {"itemId": "inv-c0", "slotIndex": 0, "slotSpan": 1, "equipment": null},
                         {"itemId": "inv-c1", "slotIndex": 2, "slotSpan": 2,
                          "equipment": with(eq_mod_row(),
                                            json!({"category": "Vidéo", "brand": null}))}
                     ]
                 })),
            with(slot(json!({"id": "s-ghost", "catalogEquipmentId": "eq1",
                              "inventoryItemId": "inv-eq1", "label": "#AB12"})),
                 json!({
                     "panel": null, "children": [], "components": [],
                     // primary function = lowest sortOrder (Audio)
                     "equipment": with(eq1_row(), json!({"category": "Audio", "brand": brand_b1()}))
                 }))
        ]
    });
    json!({
        "rack": rack,
        // active equipment by name, + brand
        "allEquipment": [
            with(eq1_row(), json!({"brand": brand_b1()})),
            with(eq_mod_row(), json!({"brand": null})),
            with(eq_host_row(), json!({"brand": null})),
            with(eq_acc_row(), json!({"brand": null}))
        ],
        // category « Accessoire rack », active, by name; no functions include
        "rackAccessories": [
            equipment(json!({"id": "eq-acc", "name": "Tiroir 1U", "categoryId": "cat-acc",
                             "heightU": 1, "category": "Accessoire rack", "brand": null}))
        ],
        // every panel by name
        "allPanels": [
            {"id": "pa0", "name": "Alpha plaque", "heightU": 1, "slotsPerU": 8,
             "rearCableDepthMm": 80, "slots": []},
            pa1()
        ],
        "connectorTypes": [
            {"id": "ct1", "name": "XLR", "versions": ["3 broches"], "functionId": "f-audio",
             "iconId": "xlr", "color": "#111111"},
            {"id": "ct2", "name": "BNC", "versions": [], "functionId": null, "iconId": null,
             "color": null}
        ],
        "signals": [
            {"id": "sig1", "name": "SDI", "color": "#00ff00", "cablePrefix": "V",
             "cableSuffix": null, "functionId": "f-video", "isIp": false},
            {"id": "sig2", "name": "Dante", "color": null, "cablePrefix": null,
             "cableSuffix": null, "functionId": null, "isIp": true}
        ],
        "signalCategories": [],
        // functions by sortOrder, colour ?? #71717a
        "categories": [
            {"id": "f-audio", "name": "Audio", "color": "#71717a", "children": []},
            {"id": "f-video", "name": "Vidéo", "color": "#3b82f6", "children": []}
        ],
        "patchPanelDepthMm": 12,
        "cableSafetyDepthMm": 150
    })
}

/// The first differing path, for a readable failure.
fn diff(path: &str, a: &Value, b: &Value) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys().chain(y.keys()) {
                let p = format!("{path}.{k}");
                match (x.get(k), y.get(k)) {
                    (Some(u), Some(v)) => {
                        if let Some(d) = diff(&p, u, v) {
                            return Some(d);
                        }
                    }
                    (u, v) => return Some(format!("{p}: {u:?} ≠ {v:?}")),
                }
            }
            None
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => x
            .iter()
            .zip(y)
            .enumerate()
            .find_map(|(i, (u, v))| diff(&format!("{path}[{i}]"), u, v)),
        _ if a == b => None,
        _ => Some(format!("{path}: {a} ≠ {b}")),
    }
}

// ── canvas-data ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn canvas_data_shape_matches_arkyo() {
    let c = ctx().await;
    let url = "/api/tenant/projects/p1/racks/r1/canvas-data";
    let mut app = c.e.events.subscribe();
    let r = c.send("GET", url, None).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let got = norm(r.body);
    let want = norm(expected_canvas_data());
    if let Some(d) = diff("$", &got, &want) {
        panic!("canvas-data ≠ arkyo : {d}");
    }
    assert_eq!(
        app.try_recv(),
        Err(TryRecvError::Empty),
        "lecture sans évènement"
    );

    // Not found: rack outside the project, unknown rack, unknown project.
    for u in [
        "/api/tenant/projects/p1/racks/r-out/canvas-data",
        "/api/tenant/projects/p1/racks/nope/canvas-data",
        "/api/tenant/projects/p-x/racks/r1/canvas-data",
    ] {
        let r = c.send("GET", u, None).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::NOT_FOUND, json!({"error": "Not found"})),
            "{u}"
        );
    }

    // No AppConfig at all: arkyo's defaults (5 and 150).
    exec(
        &c.e.pool,
        r#"UPDATE "AppConfig" SET "value" = 'abc' WHERE "key" = 'patch_panel_depth_mm'"#,
    )
    .await;
    exec(
        &c.e.pool,
        r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES ('cfg2','cable_safety_depth_mm',' 80.5 ',?)"#,
    )
    .await;
    let r = c.send("GET", url, None).await;
    // Number("abc") is NaN, serialised as null; Number(" 80.5 ") = 80.5.
    assert_eq!(r.body["patchPanelDepthMm"], Value::Null);
    assert_eq!(r.body["cableSafetyDepthMm"], json!(80.5));
    exec(
        &c.e.pool,
        r#"DELETE FROM "AppConfig" WHERE "id" IN ('cfg1','cfg2')"#,
    )
    .await;
    let r = c.send("GET", url, None).await;
    assert_eq!(r.body["patchPanelDepthMm"], json!(5));
    assert_eq!(r.body["cableSafetyDepthMm"], json!(150));

    // Session required; arkyo-server: `projects:read` like the editor's layout.
    let r = send_as(&c.e, None, "GET", url, None).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    let none = no_rights_user(&c.e).await;
    let r = send_as(&c.e, Some(&none), "GET", url, None).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::FORBIDDEN, json!({"error": "Accès refusé"}))
    );
    add_user(&c.e.pool, "c@b.fr", "consultation", false).await;
    let ct = login(&c.e.app, "c@b.fr").await;
    let r = send_as(&c.e, Some(&ct), "GET", url, None).await;
    assert_eq!(r.status, StatusCode::OK);
}

// ── construction-checks ────────────────────────────────────────────────────

fn checks_url(rack: &str) -> String {
    format!("/api/racks/{rack}/construction-checks")
}

async fn stored_checks(pool: &SqlitePool) -> String {
    text(
        pool,
        r#"SELECT "constructionChecks" FROM "Rack" WHERE "id" = 'r1'"#,
    )
    .await
}

async fn audit_count(pool: &SqlitePool) -> i64 {
    int(pool, r#"SELECT COUNT(*) FROM "AuditLog""#).await
}

#[tokio::test]
async fn construction_checks_toggle_set_clear_null_trap() {
    let c = ctx().await;
    let url = checks_url("r1");
    let patch = |body: Value| {
        let c = &c;
        let url = url.clone();
        async move {
            let r = c.send("PATCH", &url, Some(body.clone())).await;
            assert_eq!(r.status, StatusCode::OK, "{body} → {:?}", r.body);
            r.body
        }
    };

    // The fixture stores JSON null: read as [].
    let r = c.send("GET", &url, None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"checks": []})));
    exec(
        &c.e.pool,
        r#"UPDATE "Rack" SET "constructionChecks" = '[]' WHERE "id" = 'r1'"#,
    )
    .await;
    assert_eq!(c.send("GET", &url, None).await.body, json!({"checks": []}));

    // toggle: adds, then removes.
    assert_eq!(
        patch(json!({"action": "toggle", "id": "s1:p0"})).await,
        json!({"checks": ["s1:p0"]})
    );
    assert_eq!(stored_checks(&c.e.pool).await, r#"["s1:p0"]"#);
    assert_eq!(
        patch(json!({"action": "toggle", "id": "s2"})).await,
        json!({"checks": ["s1:p0", "s2"]})
    );
    assert_eq!(
        patch(json!({"action": "toggle", "id": "s1:p0"})).await,
        json!({"checks": ["s2"]})
    );
    assert_eq!(
        c.send("GET", &url, None).await.body,
        json!({"checks": ["s2"]})
    );
    // The last one removed: Prisma.JsonNull, the text `null`, answered [].
    assert_eq!(
        patch(json!({"action": "toggle", "id": "s2"})).await,
        json!({"checks": []})
    );
    assert_eq!(stored_checks(&c.e.pool).await, "null");
    assert_eq!(c.send("GET", &url, None).await.body, json!({"checks": []}));
    // toggle on the null state starts from [].
    assert_eq!(
        patch(json!({"action": "toggle", "id": "q"})).await,
        json!({"checks": ["q"]})
    );

    // set: replaces as sent (no dedupe); an empty set is the null trap too.
    assert_eq!(
        patch(json!({"action": "set", "ids": ["x", "y", "x"]})).await,
        json!({"checks": ["x", "y", "x"]})
    );
    assert_eq!(stored_checks(&c.e.pool).await, r#"["x","y","x"]"#);
    assert_eq!(
        patch(json!({"action": "set", "ids": []})).await,
        json!({"checks": []})
    );
    assert_eq!(stored_checks(&c.e.pool).await, "null");

    // clear: null, extra keys ignored.
    patch(json!({"action": "set", "ids": ["z"]})).await;
    assert_eq!(
        patch(json!({"action": "clear", "ids": ["ignored"]})).await,
        json!({"checks": []})
    );
    assert_eq!(stored_checks(&c.e.pool).await, "null");

    // Audit of each PATCH: {action, count}.
    let audits: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
        r#"SELECT "action", "entityType", "entityId", "after" FROM "AuditLog" ORDER BY rowid"#,
    )
    .fetch_all(&c.e.pool)
    .await
    .unwrap();
    let afters: Vec<Value> = audits
        .iter()
        .map(|(a, t, id, after)| {
            assert_eq!(
                (a.as_str(), t.as_str(), id.as_str()),
                ("rack.constructionChecks.update", "Rack", "r1")
            );
            serde_json::from_str(after.as_deref().unwrap()).unwrap()
        })
        .collect();
    assert_eq!(
        afters,
        vec![
            json!({"action": "toggle", "count": 1}),
            json!({"action": "toggle", "count": 2}),
            json!({"action": "toggle", "count": 1}),
            json!({"action": "toggle", "count": 0}),
            json!({"action": "toggle", "count": 1}),
            json!({"action": "set", "count": 3}),
            json!({"action": "set", "count": 0}),
            json!({"action": "set", "count": 1}),
            json!({"action": "clear", "count": 0}),
        ]
    );

    // Validation (discriminated union, flatten()): 400, nothing written.
    patch(json!({"action": "set", "ids": ["keep"]})).await;
    let before = (stored_checks(&c.e.pool).await, audit_count(&c.e.pool).await);
    let long = "a".repeat(257);
    let too_many: Vec<String> = (0..10001).map(|i| i.to_string()).collect();
    let fe = |field: &str, msg: &str| json!({"formErrors": [], "fieldErrors": {field: [msg]}});
    let cases = [
        (json!({}), fe("action", "Invalid input")),
        (json!({"action": "nope"}), fe("action", "Invalid input")),
        (json!({"action": 3}), fe("action", "Invalid input")),
        (
            json!({"action": "toggle"}),
            fe("id", "Invalid input: expected string, received undefined"),
        ),
        (
            json!({"action": "toggle", "id": ""}),
            fe("id", "Too small: expected string to have >=1 characters"),
        ),
        (
            json!({"action": "toggle", "id": long}),
            fe("id", "Too big: expected string to have <=256 characters"),
        ),
        (
            json!({"action": "toggle", "id": 4}),
            fe("id", "Invalid input: expected string, received number"),
        ),
        (
            json!({"action": "set"}),
            fe("ids", "Invalid input: expected array, received undefined"),
        ),
        (
            json!({"action": "set", "ids": "a"}),
            fe("ids", "Invalid input: expected array, received string"),
        ),
        (
            json!({"action": "set", "ids": ["ok", ""]}),
            fe("ids", "Too small: expected string to have >=1 characters"),
        ),
        (
            json!({"action": "set", "ids": too_many}),
            fe("ids", "Too big: expected array to have <=10000 items"),
        ),
        (
            json!([]),
            json!({"formErrors": ["Invalid input: expected object, received array"], "fieldErrors": {}}),
        ),
    ];
    for (body, error) in cases {
        let r = c.send("PATCH", &url, Some(body.clone())).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::BAD_REQUEST, json!({"error": error})),
            "{body}"
        );
    }
    // arkyo-server: unreadable JSON is a 400 (arkyo: req.json() throws, 500).
    let r = send_raw(&c.e, Some(&c.tok), "PATCH", &url, Body::from("{")).await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::BAD_REQUEST,
            json!({"error": "Corps de requête invalide"})
        )
    );
    assert_eq!(
        (stored_checks(&c.e.pool).await, audit_count(&c.e.pool).await),
        before
    );

    // Unknown rack: 404 (validation first, as arkyo).
    let r = c.send("GET", &checks_url("nope"), None).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
    );
    let r = c
        .send(
            "PATCH",
            &checks_url("nope"),
            Some(json!({"action": "clear"})),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
    );

    // GET: a session; PATCH: arkyo-server design:write.
    add_user(&c.e.pool, "c@b.fr", "consultation", false).await;
    let ct = login(&c.e.app, "c@b.fr").await;
    let none = no_rights_user(&c.e).await;
    for tok in [&ct, &none] {
        let r = send_as(&c.e, Some(tok), "GET", &url, None).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::OK, json!({"checks": ["keep"]}))
        );
        let r = send_as(
            &c.e,
            Some(tok),
            "PATCH",
            &url,
            Some(json!({"action": "clear"})),
        )
        .await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::FORBIDDEN, json!({"error": "Accès refusé"}))
        );
    }
    for method in ["GET", "PATCH"] {
        let r = send_as(&c.e, None, method, &url, Some(json!({"action": "clear"}))).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{method}");
    }
    assert_eq!(
        (stored_checks(&c.e.pool).await, audit_count(&c.e.pool).await),
        before
    );
}

fn rack_events_request(rack_id: &str, tok: &str) -> Request<Body> {
    let mut req = Request::builder()
        .method("GET")
        .uri(format!("/api/racks/{rack_id}/events"))
        .header(header::COOKIE, format!("arkyo_session={tok}"))
        .body(Body::empty())
        .unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(LOCAL.parse::<SocketAddr>().unwrap()));
    req
}

async fn next_frame(body: &mut Body, wait: Duration) -> Option<String> {
    let frame = tokio::time::timeout(wait, body.frame()).await.ok()?;
    let frame = frame.expect("stream ended").unwrap();
    Some(String::from_utf8(frame.into_data().unwrap().to_vec()).unwrap())
}

#[tokio::test]
async fn construction_checks_event_on_rack_stream() {
    let c = ctx().await;
    let res =
        c.e.app
            .clone()
            .oneshot(rack_events_request("r1", &c.tok))
            .await
            .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let mut stream = res.into_body();
    let wait = Duration::from_secs(2);
    assert_eq!(
        next_frame(&mut stream, wait).await.as_deref(),
        Some(": connected\n\n")
    );
    let mut app = c.e.events.subscribe();

    // A read publishes nothing.
    c.send("GET", &checks_url("r1"), None).await;
    // Each PATCH: `{type: "construction_checks_updated"}` on the rack stream
    // only (route.ts:96), no app event.
    for body in [
        json!({"action": "toggle", "id": "a"}),
        json!({"action": "set", "ids": ["a", "b"]}),
        json!({"action": "clear"}),
    ] {
        let r = c.send("PATCH", &checks_url("r1"), Some(body)).await;
        assert_eq!(r.status, StatusCode::OK);
        assert_eq!(
            next_frame(&mut stream, wait).await.as_deref(),
            Some("data: {\"type\":\"construction_checks_updated\"}\n\n")
        );
    }
    // Refused or failed PATCH: no event.
    c.send("PATCH", &checks_url("r1"), Some(json!({"action": "x"})))
        .await;
    c.send(
        "PATCH",
        &checks_url("nope"),
        Some(json!({"action": "clear"})),
    )
    .await;
    assert_eq!(
        next_frame(&mut stream, Duration::from_millis(200)).await,
        None,
        "aucun autre évènement rack"
    );
    assert_eq!(
        app.try_recv(),
        Err(TryRecvError::Empty),
        "aucun évènement app"
    );
}

// ── canvas-position ─────────────────────────────────────────────────────────

async fn canvas_xy(pool: &SqlitePool, id: &str) -> (Option<i64>, Option<i64>, String) {
    sqlx::query_as(r#"SELECT "canvasX", "canvasY", "updatedAt" FROM "Rack" WHERE "id" = ?"#)
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn canvas_position_patch() {
    let c = ctx().await;
    let url = "/api/racks/r1/canvas-position";
    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack("r1");
    let audits = audit_count(&c.e.pool).await;
    let app_event = json!({"type": "update", "entity": "rack", "action": "updated", "id": "r1",
                           "rackId": "r1", "itemId": "r1", "clientId": CLIENT});

    // Math.round: halves go up (2.5 → 3, -7.5 → -7).
    let r = c
        .send(
            "PATCH",
            url,
            Some(json!({"canvasX": 12.4, "canvasY": -7.5})),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::OK,
            json!({"id": "r1", "canvasX": 12, "canvasY": -7})
        )
    );
    let (x, y, updated) = canvas_xy(&c.e.pool, "r1").await;
    assert_eq!((x, y), (Some(12), Some(-7)));
    assert_ne!(updated, NOW, "@updatedAt");
    let ev: Value = serde_json::from_str(&app.try_recv().unwrap()).unwrap();
    assert_eq!(ev, app_event);

    let r = c.send("PATCH", url, Some(json!({"canvasX": 2.5}))).await;
    assert_eq!(r.body, json!({"id": "r1", "canvasX": 3, "canvasY": -7}));
    let r = c.send("PATCH", url, Some(json!({"canvasY": -2.5}))).await;
    assert_eq!(r.body, json!({"id": "r1", "canvasX": 3, "canvasY": -2}));
    let r = c
        .send("PATCH", url, Some(json!({"canvasY": 0.49999999999999994})))
        .await;
    assert_eq!(r.body, json!({"id": "r1", "canvasX": 3, "canvasY": 0}));

    // null clears; an absent key is kept.
    let r = c.send("PATCH", url, Some(json!({"canvasX": null}))).await;
    assert_eq!(r.body, json!({"id": "r1", "canvasX": null, "canvasY": 0}));
    assert_eq!(canvas_xy(&c.e.pool, "r1").await.0, None);

    // Empty or unreadable body: `req.json().catch(() => ({}))`, nothing changes.
    let r = c.send("PATCH", url, Some(json!({}))).await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::OK,
            json!({"id": "r1", "canvasX": null, "canvasY": 0})
        )
    );
    let r = send_raw(&c.e, Some(&c.tok), "PATCH", url, Body::from("nope")).await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::OK,
            json!({"id": "r1", "canvasX": null, "canvasY": 0})
        )
    );
    // One app event per successful PATCH.
    for _ in 0..6 {
        let ev: Value = serde_json::from_str(&app.try_recv().unwrap()).unwrap();
        assert_eq!(ev, app_event);
    }

    // Validation: 400 flatten(), nothing written.
    let before = canvas_xy(&c.e.pool, "r1").await;
    for (body, field, msg) in [
        (
            json!({"canvasX": "1"}),
            "canvasX",
            "Invalid input: expected number, received string",
        ),
        (
            json!({"canvasY": true}),
            "canvasY",
            "Invalid input: expected number, received boolean",
        ),
        // arkyo-server: Prisma Int (32 bits) refused out of range (arkyo: 500).
        (
            json!({"canvasX": 3e9}),
            "canvasX",
            "Too big: expected number to be <=2147483647",
        ),
        (
            json!({"canvasY": -3e9}),
            "canvasY",
            "Too small: expected number to be >=-2147483648",
        ),
    ] {
        let r = c.send("PATCH", url, Some(body.clone())).await;
        assert_eq!(
            (r.status, r.body),
            (
                StatusCode::BAD_REQUEST,
                json!({"error": {"formErrors": [], "fieldErrors": {field: [msg]}}})
            ),
            "{body}"
        );
    }
    let r = c.send("PATCH", url, Some(json!([1]))).await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::BAD_REQUEST,
            json!({"error": {"formErrors": ["Invalid input: expected object, received array"], "fieldErrors": {}}})
        )
    );
    // Unknown rack: 404.
    let r = c
        .send(
            "PATCH",
            "/api/racks/nope/canvas-position",
            Some(json!({"canvasX": 1})),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
    );
    // arkyo-server: design:write; no session: 401.
    add_user(&c.e.pool, "c@b.fr", "consultation", false).await;
    let ct = login(&c.e.app, "c@b.fr").await;
    let r = send_as(&c.e, Some(&ct), "PATCH", url, Some(json!({"canvasX": 1}))).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::FORBIDDEN, json!({"error": "Accès refusé"}))
    );
    let r = send_as(&c.e, None, "PATCH", url, Some(json!({"canvasX": 1}))).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    assert_eq!(canvas_xy(&c.e.pool, "r1").await, before);
    assert_eq!(app.try_recv(), Err(TryRecvError::Empty));

    // Neither audit nor rack event (route.ts:64 only publishes on the app bus).
    assert_eq!(audit_count(&c.e.pool).await, audits);
    assert!(
        tokio::time::timeout(Duration::from_millis(50), rack.recv())
            .await
            .is_err(),
        "aucun évènement rack"
    );
}
