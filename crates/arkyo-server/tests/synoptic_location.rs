//! Phase 4c, Task 5: synoptic focus payload and location view
//! (`GET /api/tenant/projects/:id/synoptic/location/:locationId`,
//! arkyo:app/api/tenant/projects/[id]/synoptic/location/[locationId]/route.ts
//! and arkyo:lib/services/synoptic-focus-payload.ts).
mod common;
use std::collections::HashMap;
use std::net::SocketAddr;

use arkyo_server::synoptic::focus_payload::{
    build_catalog_lookups, enrich_external_ports_target_label, enrich_rack_payload,
    visible_external_ports, CatalogLookups, CatalogRows, RackForPayload, TargetLookups,
};
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use serde_json::{json, Map, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

const NOW: &str = "2026-11-07T10:00:00.000Z";
const URL: &str = "/api/tenant/projects/p1/synoptic/location/loc1";

type Obj = Map<String, Value>;

async fn exec(pool: &SqlitePool, sql: &str) {
    let mut q = sqlx::query(sql);
    for _ in 0..sql.matches('?').count() {
        q = q.bind(NOW);
    }
    q.execute(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

async fn get(e: &Env, tok: Option<&str>, uri: &str) -> Reply {
    let mut b = Request::builder().method("GET").uri(uri);
    if let Some(t) = tok {
        b = b.header(header::COOKIE, format!("arkyo_session={t}"));
    }
    let mut req = b.body(Body::empty()).unwrap();
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

/// The data of the shape test, inserted by hand with fixed ids (the seeded
/// catalogue is emptied first). Location `loc1` « Plateau » holds the
/// virtual rack `rv` and rack `ra`; `loc2` holds `rz`; `loc3` is empty;
/// `locx` belongs to project `p2`.
/// - `ra`: slots `sa1` (eq1, host of items `itc`/`itd`), `sa2` (shelf, child
///   `sc1`), `sa3` (panel `pa1`); adapters `ada1` (on `sa1`), `adc` (on
///   `sc1`); zone, label, bundle `bu1`, cable `rc1` in `bu1`;
/// - `rv`: slot `sv1`, adapter `ada2` (unknown catalogue id), cable `rc2`
///   to `sa1`;
/// - external ports: `ep1` (linked to `rz` by `pc1`), `ep2` (resorbed by the
///   internal `pc2`), `ep3` (MONDE, internal `pc3`, kept), `ep4` (slot of
///   `rz`, port of `ra`), `epv` (resorbed by `pc6`), `ep5` (rack `rz`).
async fn seed(pool: &SqlitePool) {
    for sql in [
        r#"DELETE FROM "TenantSignalType""#,
        r#"DELETE FROM "TenantConnectorType""#,
        r#"DELETE FROM "TenantFunction""#,
        r#"DELETE FROM "TenantEquipmentCategory""#,
        r#"DELETE FROM "AppConfig" WHERE "key" LIKE 'cable_%'"#,
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('p1','Match','u',?,?)"#,
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('p2','Autre','u',?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","cableCode","createdAt","updatedAt") VALUES ('loc1','p1','Plateau','PLT',?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","createdAt","updatedAt") VALUES ('loc2','p1','Régie',?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","createdAt","updatedAt") VALUES ('loc3','p1','Vide',?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","createdAt","updatedAt") VALUES ('locx','p2','Ailleurs',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","cableCode","isVirtual","locationId","createdAt","updatedAt") VALUES ('rv','Plateau','PLT',1,'loc1',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","cableCode","cableId","totalU","numberingOverride","rackType","locationId","createdAt","updatedAt") VALUES ('ra','Baie A','BA',3,12,'{"pad":2}','FLIGHT_CASE_CLASSIC','loc1',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","locationId","createdAt","updatedAt") VALUES ('rz','Baie Z','loc2',?,?)"#,
        // Catalogue.
        r#"INSERT INTO "TenantFunction" ("id","key","label","color","cablePrefix","sortOrder","createdAt","updatedAt") VALUES ('f1','video','Vidéo','#2563eb','V',0,?,?)"#,
        r#"INSERT INTO "TenantFunction" ("id","key","label","cablePrefix","cableSuffix","sortOrder","createdAt","updatedAt") VALUES ('f2','audio','Audio','A','x',1,?,?)"#,
        r#"INSERT INTO "TenantFunction" ("id","key","label","color","sortOrder","createdAt","updatedAt") VALUES ('f3','data','Data','#111111',2,?,?)"#,
        r#"INSERT INTO "TenantConnectorType" ("id","name","versions","iconId","color","functionIds","createdAt","updatedAt") VALUES ('ct1','BNC','["75"]','bnc','#6B7280','["f1"]',?,?)"#,
        r#"INSERT INTO "TenantConnectorType" ("id","name","color","createdAt","updatedAt") VALUES ('ct2','XLR','#ff0000',?,?)"#,
        r#"INSERT INTO "TenantConnectorType" ("id","name","functionIds","createdAt","updatedAt") VALUES ('ct3','RJ45','["f2"]',?,?)"#,
        r#"INSERT INTO "TenantSignalType" ("id","name","functionId","cablePrefix","createdAt","updatedAt") VALUES ('sg1','SDI','f1','S',?,?)"#,
        r#"INSERT INTO "TenantSignalType" ("id","name","color","functionId","createdAt","updatedAt") VALUES ('sg2','AES','#6b7280','f2',?,?)"#,
        r#"INSERT INTO "TenantSignalType" ("id","name","color","createdAt","updatedAt") VALUES ('sg3','GPIO','#00ff00',?,?)"#,
        r#"INSERT INTO "TenantEquipmentCategory" ("id","name","color","createdAt","updatedAt") VALUES ('c1','Vidéo','#2563eb',?,?)"#,
        r#"INSERT INTO "TenantEquipmentCategory" ("id","name","parentId","createdAt","updatedAt") VALUES ('c2','Caméras','c1',?,?)"#,
        r#"INSERT INTO "TenantEquipmentCategory" ("id","name","color","sortOrder","createdAt","updatedAt") VALUES ('c3','Audio','#16a34a',1,?,?)"#,
        r#"INSERT INTO "TenantBrand" ("id","name","createdAt","updatedAt") VALUES ('b1','Marque test',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","brandId","isComponentHost","hostSlotCount","connectors","functionIds","createdById","createdAt","updatedAt") VALUES ('eq1','HDC-5500','b1',1,2,'[{"connectorTypeId":"ct1","label":"SDI OUT","quantity":2},{"connectorTypeId":"ct2","quantity":1}]','["f1"]','u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","brandId","isComponent","componentSlotSpan","createdById","createdAt","updatedAt") VALUES ('eq2','Carte SDI','bx',1,2,'u',?,?)"#,
        r#"INSERT INTO "TenantAdapter" ("id","name","reference","createdById","createdAt","updatedAt") VALUES ('ad1','BNC → XLR','AD-1','u',?,?)"#,
        r#"INSERT INTO "Panel" ("id","name","heightU","slotsPerU","createdById","createdAt","updatedAt") VALUES ('pa1','Patch BNC',1,2,'u',?,?)"#,
        r#"INSERT INTO "PanelSlot" ("id","panelId","position","label","catalogConnectorTypeId","familyLabel") VALUES ('ps1','pa1',0,'IN 1','ct1','BNC')"#,
        r#"INSERT INTO "PanelSlot" ("id","panelId","position","mountD") VALUES ('ps2','pa1',1,1)"#,
        // Inventory (components of it1: itc at index 1 first, itd at 0).
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('it1','ra','eq1',?,?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","hostItemId","hostSlotIndex","createdAt","updatedAt") VALUES ('itc','ra','eq2','it1',1,?,?)"#,
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","hostItemId","hostSlotIndex","createdAt","updatedAt") VALUES ('itd','ra','it1',0,?,?)"#,
        // Slots.
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","synopticX","synopticY","createdAt","updatedAt") VALUES ('sv1','rv','eq1',10,20,?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","inventoryItemId","startU","heightU","synopticX","synopticY","createdAt","updatedAt") VALUES ('sa1','ra','eq1','it1',1,2,100,100,?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","startU","heightU","label","notes","createdAt","updatedAt") VALUES ('sa2','ra',5,1,'Étagère','{"shelf":true}',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","panelId","startU","heightU","label","synopticY","createdAt","updatedAt") VALUES ('sa3','ra','pa1',3,1,'Patch',50,?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","parentSlotId","widthFraction","column","label","panelLabels","createdAt","updatedAt") VALUES ('sc1','ra','eq1','sa2','HALF',1,'Retour','["a"]',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","label","createdAt","updatedAt") VALUES ('sz1','rz','eq1','  ',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","label","createdAt","updatedAt") VALUES ('sz2','rz','eq1','Caméra 2',?,?)"#,
        r#"INSERT INTO "RackSlotPanelRow" ("id","slotId","rowIndex","synopticX","synopticY","createdAt","updatedAt") VALUES ('pr1','sa3',0,5,6,?,?)"#,
        r#"INSERT INTO "RackSlotPanelRow" ("id","slotId","rowIndex","synopticX","synopticY","createdAt","updatedAt") VALUES ('prc','sc1',0,7,8,?,?)"#,
        // Synoptic objects.
        r#"INSERT INTO "SynopticAdapter" ("id","rackId","catalogAdapterId","x","y","attachedSlotId","attachedSide","attachedPortIndex","createdAt","updatedAt") VALUES ('ada1','ra','ad1',1,2,'sa1','left',0,?,?)"#,
        r#"INSERT INTO "SynopticAdapter" ("id","rackId","catalogAdapterId","x","y","createdAt","updatedAt") VALUES ('ada2','rv','gone',3,4,?,?)"#,
        r#"INSERT INTO "SynopticAdapter" ("id","rackId","catalogAdapterId","x","y","attachedSlotId","attachedSide","attachedPortIndex","label","createdAt","updatedAt") VALUES ('adc','ra','ad1',5,6,'sc1','right',1,'ADP',?,?)"#,
        r#"INSERT INTO "RackZone" ("id","rackId","x","y","w","h","createdAt","updatedAt") VALUES ('z1','ra',0,0,100,50,?,?)"#,
        r#"INSERT INTO "RackLabel" ("id","rackId","text","x","y","pill","createdAt","updatedAt") VALUES ('l1','ra','Note',5,5,1,?,?)"#,
        r#"INSERT INTO "CableBundle" ("id","rackId","name","color","createdAt","updatedAt") VALUES ('bu1','ra','Faisceau','#ff00ff',?,?)"#,
        r##"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","fromConnectorIndex","toSlotId","toConnectorIndex","label","color","waypoints","tags","wired","bundleId","createdAt") VALUES ('rc1','ra','sa1',0,'sa3',0,'V-001','#ff0000','[{"x":1,"y":2}]','[{"color":"#000","text":"A"}]',1,'bu1',?)"##,
        r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","fromConnectorIndex","toSlotId","toConnectorIndex","createdAt") VALUES ('rc2','rv','sv1',0,'sa1',1,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","labelX","labelY","createdAt","updatedAt") VALUES ('ep1','ra','sa1',0,200,210,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('ep2','ra','sa1',2,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","label","kind","createdAt","updatedAt") VALUES ('ep3','ra','sa1',1,'Feed','MONDE',?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('ep4','ra','sz2',0,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('epv','rv','sv1',3,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('ep5','rz','sz1',0,?,?)"#,
        // Project connections.
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","toSlotId","toConnectorIndex","label","createdAt") VALUES ('pc1','p1','ra','sa1',0,'rz','sz1',1,' V-001 ',?)"#,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","toSlotId","toConnectorIndex","createdAt") VALUES ('pc2','p1','rv','sv1',0,'ra','sa1',2,?)"#,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","toSlotId","toConnectorIndex","label","waypoints","wired","createdAt") VALUES ('pc3','p1','ra','sa1',1,'rv','sv1',2,'','[{"x":3,"y":4}]',1,?)"#,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","toSlotId","toConnectorIndex","createdAt") VALUES ('pc4','p1','rz','sz1',0,'rz','sz2',0,?)"#,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","toRackId","toSlotId","toConnectorIndex","createdAt") VALUES ('pc6','p1','ra','rv','sv1',3,?)"#,
        // A link of another project between the same racks: ignored.
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","toSlotId","toConnectorIndex","createdAt") VALUES ('pcx','p2','ra','sa1',0,'rv','sv1',0,?)"#,
        // AppConfig: two numbering keys, one unrelated key.
        r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES ('cfg1','cable_pad','3',?)"#,
        r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES ('cfg2','cable_numbering_template_enabled','true',?)"#,
        r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES ('cfg3','patch_panel_depth_mm','5',?)"#,
    ] {
        exec(pool, sql).await;
    }
}

/// Replaces every `{"$ref": id, …}` by `defs[id]` completed with the other
/// keys.
fn resolve(v: &Value, defs: &Value) -> Value {
    match v {
        Value::Object(o) => {
            if let Some(id) = o.get("$ref").and_then(Value::as_str) {
                let mut base = defs[id].as_object().expect(id).clone();
                for (k, x) in o {
                    if k != "$ref" {
                        base.insert(k.clone(), resolve(x, defs));
                    }
                }
                Value::Object(base)
            } else {
                Value::Object(
                    o.iter()
                        .map(|(k, x)| (k.clone(), resolve(x, defs)))
                        .collect(),
                )
            }
        }
        Value::Array(a) => Value::Array(a.iter().map(|x| resolve(x, defs)).collect()),
        x => x.clone(),
    }
}

/// Fails on the first differing path (readable on a large payload).
fn assert_same(path: &str, got: &Value, want: &Value) {
    match (got, want) {
        (Value::Object(g), Value::Object(w)) => {
            let gk: Vec<&String> = g.keys().collect();
            let wk: Vec<&String> = w.keys().collect();
            assert_eq!(gk, wk, "clés de {path}");
            for (k, wv) in w {
                assert_same(&format!("{path}.{k}"), &g[k], wv);
            }
        }
        (Value::Array(g), Value::Array(w)) => {
            assert_eq!(g.len(), w.len(), "longueur de {path}: {got:#}");
            for (i, (gv, wv)) in g.iter().zip(w).enumerate() {
                assert_same(&format!("{path}[{i}]"), gv, wv);
            }
        }
        _ => assert_eq!(got, want, "{path}"),
    }
}

#[tokio::test]
async fn location_payload_shape_matches_arkyo() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    seed(&e.pool).await;
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/synoptic-location.json")).unwrap();
    let defs = &fixture["$defs"];

    let r = get(&e, Some(&tok), URL).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_same("$", &r.body, &resolve(&fixture["expected"], defs));

    // Location without any rack: the early return (appConfig `{}`).
    let r = get(
        &e,
        Some(&tok),
        "/api/tenant/projects/p1/synoptic/location/loc3",
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_same("$", &r.body, &fixture["empty"]);

    // 404 « Not found »: unknown project, unknown location, location of
    // another project.
    for uri in [
        "/api/tenant/projects/nope/synoptic/location/loc1",
        "/api/tenant/projects/p1/synoptic/location/nope",
        "/api/tenant/projects/p1/synoptic/location/locx",
    ] {
        let r = get(&e, Some(&tok), uri).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::NOT_FOUND, json!({"error": "Not found"})),
            "{uri}"
        );
    }

    // Session required; arkyo-server: `projects:read` like canvas-data.
    let r = get(&e, None, URL).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    exec(
        &e.pool,
        r#"INSERT INTO "Role" ("id","key","label","permissions","createdAt","updatedAt")
           VALUES ('r-none','sans-droits','Sans droits','{}',?,?)"#,
    )
    .await;
    add_user(&e.pool, "n@b.fr", "sans-droits", false).await;
    let none = login(&e.app, "n@b.fr").await;
    let r = get(&e, Some(&none), URL).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::FORBIDDEN, json!({"error": "Accès refusé"}))
    );
    add_user(&e.pool, "c@b.fr", "consultation", false).await;
    let ct = login(&e.app, "c@b.fr").await;
    let r = get(&e, Some(&ct), URL).await;
    assert_eq!(r.status, StatusCode::OK);
}

// ── pure functions ──────────────────────────────────────────────────────────

fn obj(v: Value) -> Obj {
    v.as_object().unwrap().clone()
}

fn objs(v: Value) -> Vec<Obj> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| obj(x.clone()))
        .collect()
}

fn slot(id: &str, extra: Value) -> Obj {
    let mut s = obj(json!({
        "id": id, "rackId": "r1", "catalogEquipmentId": null, "snapshotId": null,
        "panelId": null, "parentSlotId": null, "inventoryItemId": null,
        "panel": null, "panelRows": [], "attachedAdapters": [],
    }));
    s.extend(obj(extra));
    s
}

fn empty_rack() -> RackForPayload {
    RackForPayload {
        rack: obj(json!({"id": "r1", "name": "Baie", "totalU": 42})),
        slots: Vec::new(),
        connections: Vec::new(),
        zones: Vec::new(),
        labels: Vec::new(),
        adapters: Vec::new(),
        bundles: Vec::new(),
        external_ports: Vec::new(),
    }
}

/// Lookups as `buildCatalogLookups` would give them: equipment `e1` (brand
/// `b1`), `e2` (unknown brand), `e3` (no brand, `componentSlotSpan` not a
/// number); adapter `a1`; connector `c1`; components of host `h1`.
fn lookups() -> CatalogLookups {
    let mut l = CatalogLookups::default();
    for e in [
        json!({"id": "e1", "name": "Caméra", "brandId": "b1", "componentSlotSpan": 1}),
        json!({"id": "e2", "name": "Carte", "brandId": "b-gone", "componentSlotSpan": 3}),
        json!({"id": "e3", "name": "Vieux", "brandId": null, "componentSlotSpan": "2"}),
    ] {
        l.equipment.insert(e["id"].as_str().unwrap().into(), obj(e));
    }
    l.adapters
        .insert("a1".into(), obj(json!({"id": "a1", "name": "BNC → XLR"})));
    l.connectors.insert(
        "c1".into(),
        json!({"id": "c1", "name": "BNC", "functions": [], "functionId": null}),
    );
    l.brands
        .insert("b1".into(), json!({"id": "b1", "name": "Sony"}));
    l.components_by_host.insert(
        "h1".into(),
        objs(json!([
            {"id": "k0", "hostItemId": "h1", "hostSlotIndex": null, "catalogEquipmentId": "e3"},
            {"id": "k1", "hostItemId": "h1", "hostSlotIndex": 1, "catalogEquipmentId": "e2"},
            {"id": "k2", "hostItemId": "h1", "hostSlotIndex": 2, "catalogEquipmentId": "gone"},
        ])),
    );
    l
}

#[test]
fn enrich_rack_payload_pure_cases() {
    let l = lookups();

    // Empty rack: rackMeta = the scalars, every list empty.
    let out = enrich_rack_payload(&empty_rack(), &l);
    assert_eq!(
        Value::Object(out.rack_meta.clone()),
        json!({"id": "r1", "name": "Baie", "totalU": 42})
    );
    assert!(out.slots.is_empty() && out.connections.is_empty() && out.panel_rows.is_empty());
    assert!(out.zones.is_empty() && out.labels.is_empty() && out.adapters.is_empty());
    assert!(out.bundles.is_empty() && out.external_ports.is_empty());

    let mut rack = empty_rack();
    rack.slots = vec![
        // equipment + brand; components of h1 (k0 → index 0, k1, k2);
        // panel slots with the connectorTypeId alias; attached adapters.
        slot(
            "s1",
            json!({
                "catalogEquipmentId": "e1", "inventoryItemId": "h1",
                "panel": {"id": "p1", "name": "Patch", "slots": [
                    {"id": "ps1", "catalogConnectorTypeId": "c1"},
                    {"id": "ps2", "catalogConnectorTypeId": "c-gone"},
                    {"id": "ps3", "catalogConnectorTypeId": null},
                ]},
                "panelRows": [{"id": "pr1", "slotId": "s1", "rowIndex": 0, "synopticX": 1.5,
                    "synopticY": 2.0, "createdAt": NOW, "updatedAt": NOW}],
                "attachedAdapters": [
                    {"id": "x1", "catalogAdapterId": "a1", "snapshotId": null},
                    {"id": "x2", "catalogAdapterId": "gone", "snapshotId": null},
                    {"id": "x3", "catalogAdapterId": null, "snapshotId": null},
                ],
                "children": [],
            }),
        ),
        // Unknown brand → brand null; a child slot (no `children` key).
        slot(
            "s2",
            json!({
                "catalogEquipmentId": "e2",
                "children": [slot("k-child", json!({
                    "parentSlotId": "s2", "catalogEquipmentId": "e3",
                    "panelRows": [{"id": "pr2", "slotId": "k-child", "rowIndex": 1,
                        "synopticX": 3.0, "synopticY": 4.0, "createdAt": NOW, "updatedAt": NOW}],
                    "attachedAdapters": [{"id": "x4", "catalogAdapterId": "a1", "snapshotId": null}],
                }))],
            }),
        ),
        // Unknown equipment and no equipment → null.
        slot("s3", json!({"catalogEquipmentId": "gone", "children": []})),
        slot("s4", json!({"children": []})),
    ];
    rack.connections = objs(json!([{"id": "rc1", "bundle": null}]));
    rack.zones = objs(json!([{"id": "z1"}]));
    rack.labels = objs(json!([{"id": "l1"}]));
    rack.bundles = objs(json!([{"id": "bu1"}]));
    rack.external_ports = objs(json!([{"id": "ep1", "slotId": "s1", "portIndex": 0}]));
    rack.adapters = objs(json!([
        {"id": "ra1", "catalogAdapterId": "a1", "snapshotId": null},
        {"id": "ra2", "catalogAdapterId": null, "snapshotId": null},
    ]));

    let out = enrich_rack_payload(&rack, &l);
    let sony = json!({"id": "b1", "name": "Sony"});
    let a1 = json!({"id": "a1", "name": "BNC → XLR"});

    let s1 = &out.slots[0];
    assert_eq!(
        s1["equipment"],
        json!({"id": "e1", "name": "Caméra", "brandId": "b1", "componentSlotSpan": 1, "brand": sony})
    );
    // Components: sorted by `hostSlotIndex ?? 0`; `slotSpan` 1 when
    // `componentSlotSpan` is not a number; unknown equipment → null.
    assert_eq!(
        s1["components"],
        json!([
            {"itemId": "k0", "slotIndex": 0, "slotSpan": 1, "equipment":
                {"id": "e3", "name": "Vieux", "brandId": null, "componentSlotSpan": "2", "brand": null}},
            {"itemId": "k1", "slotIndex": 1, "slotSpan": 3, "equipment":
                {"id": "e2", "name": "Carte", "brandId": "b-gone", "componentSlotSpan": 3, "brand": null}},
            {"itemId": "k2", "slotIndex": 2, "slotSpan": 1, "equipment": null},
        ])
    );
    assert_eq!(
        s1["panel"],
        json!({"id": "p1", "name": "Patch", "slots": [
            {"id": "ps1", "catalogConnectorTypeId": "c1", "connectorTypeId": "c1",
             "connectorType": {"id": "c1", "name": "BNC", "functions": [], "functionId": null}},
            {"id": "ps2", "catalogConnectorTypeId": "c-gone", "connectorTypeId": "c-gone",
             "connectorType": null},
            {"id": "ps3", "catalogConnectorTypeId": null, "connectorTypeId": null,
             "connectorType": null},
        ]})
    );
    assert_eq!(
        s1["attachedAdapters"],
        json!([
            {"id": "x1", "catalogAdapterId": "a1", "snapshotId": null, "adapter": a1},
            {"id": "x2", "catalogAdapterId": "gone", "snapshotId": null, "adapter": null},
            {"id": "x3", "catalogAdapterId": null, "snapshotId": null, "adapter": null},
        ])
    );
    // The raw panel rows stay on the slot.
    assert_eq!(s1["panelRows"][0]["createdAt"], json!(NOW));

    let s2 = &out.slots[1];
    assert_eq!(s2["equipment"]["brand"], Value::Null);
    assert_eq!(s2["components"], json!([]));
    let child = &s2["children"][0];
    assert!(child.get("children").is_none(), "{child}");
    assert_eq!(child["equipment"]["id"], json!("e3"));
    assert_eq!(child["equipment"]["brand"], Value::Null);
    assert_eq!(child["components"], json!([]));
    assert_eq!(child["panel"], Value::Null);
    assert_eq!(child["attachedAdapters"][0]["adapter"], a1);

    assert_eq!(out.slots[2]["equipment"], Value::Null);
    assert_eq!(out.slots[3]["equipment"], Value::Null);
    assert_eq!(out.slots[3]["components"], json!([]));

    // Free adapters resolved the same way.
    assert_eq!(out.adapters[0]["adapter"], a1);
    assert_eq!(out.adapters[1]["adapter"], Value::Null);
    // Pass-through lists.
    assert_eq!(
        Value::Array(out.connections.clone()),
        json!([{"id": "rc1", "bundle": null}])
    );
    assert_eq!(Value::Array(out.zones.clone()), json!([{"id": "z1"}]));
    assert_eq!(Value::Array(out.labels.clone()), json!([{"id": "l1"}]));
    assert_eq!(Value::Array(out.bundles.clone()), json!([{"id": "bu1"}]));
    assert_eq!(out.external_ports, rack.external_ports);
    // panelRows: flat, five keys, top slot rows then its children's.
    assert_eq!(
        Value::Array(out.panel_rows.clone()),
        json!([
            {"id": "pr1", "slotId": "s1", "rowIndex": 0, "synopticX": 1.5, "synopticY": 2.0},
            {"id": "pr2", "slotId": "k-child", "rowIndex": 1, "synopticX": 3.0, "synopticY": 4.0},
        ])
    );
}

#[test]
fn catalog_lookups_pure_cases() {
    let rows = CatalogRows {
        functions: objs(json!([
            {"id": "f1", "key": "v", "label": "Vidéo", "cablePrefix": "V", "cableSuffix": null, "color": "#2563eb"},
            {"id": "f2", "key": "a", "label": "Audio", "cablePrefix": null, "cableSuffix": "x", "color": null},
            {"id": "f3", "key": "d", "label": "Data", "cablePrefix": null, "cableSuffix": null, "color": "#111"},
        ])),
        connector_types: objs(json!([
            {"id": "c1", "name": "BNC", "versions": [], "iconId": null, "color": "#6B7280", "functionIds": ["f1", "f2"]},
            {"id": "c2", "name": "XLR", "versions": [], "iconId": null, "color": null, "functionIds": ["f2"]},
            {"id": "c3", "name": "RJ45", "versions": [], "iconId": null, "color": null, "functionIds": ["f-gone"]},
            {"id": "c4", "name": "DIN", "versions": [], "iconId": null, "color": "#abc", "functionIds": []},
        ])),
        signals: objs(json!([
            {"id": "s1", "name": "SDI", "color": "#6b7280", "cablePrefix": null, "cableSuffix": null, "functionId": "f1", "isIp": false},
            {"id": "s2", "name": "AES", "color": "#ff0000", "cablePrefix": "A", "cableSuffix": null, "functionId": "f1", "isIp": false},
            {"id": "s3", "name": "LTC", "color": null, "cablePrefix": null, "cableSuffix": null, "functionId": null, "isIp": false},
        ])),
        categories: objs(json!([
            {"id": "k2", "name": "Caméras", "color": null, "parentId": "k1"},
            {"id": "k1", "name": "Vidéo", "color": "#00f", "parentId": null},
            {"id": "k3", "name": "Orphelin", "color": null, "parentId": "k-gone"},
        ])),
        components: objs(json!([
            {"id": "q1", "hostItemId": "h", "hostSlotIndex": 2, "catalogEquipmentId": null},
            {"id": "q2", "hostItemId": "h", "hostSlotIndex": null, "catalogEquipmentId": null},
            {"id": "q3", "hostItemId": "h", "hostSlotIndex": 0, "catalogEquipmentId": null},
            {"id": "q4", "hostItemId": null, "hostSlotIndex": 0, "catalogEquipmentId": null},
        ])),
        brands: objs(json!([{"id": "b1", "name": "Sony"}])),
        ..CatalogRows::default()
    };
    let l = build_catalog_lookups(rows);
    // Components grouped by host, stable sort on `hostSlotIndex ?? 0`.
    let order: Vec<&str> = l.components_by_host["h"]
        .iter()
        .map(|c| c["id"].as_str().unwrap())
        .collect();
    assert_eq!(order, ["q2", "q3", "q1"]);
    assert_eq!(l.components_by_host.len(), 1);
    assert_eq!(l.brands["b1"], json!({"id": "b1", "name": "Sony"}));
    // Own colour unless it is Prisma's default grey, else the colour of the
    // first function, else #a3a3a3.
    let colors: Vec<&Value> = l.connector_types.iter().map(|c| &c["color"]).collect();
    assert_eq!(
        colors,
        [
            &json!("#2563eb"),
            &json!("#a3a3a3"),
            &json!("#a3a3a3"),
            &json!("#abc")
        ]
    );
    assert_eq!(
        l.connector_types[0],
        json!({"id": "c1", "name": "BNC", "versions": [], "iconId": null, "color": "#2563eb",
               "functions": [{"functionId": "f1"}, {"functionId": "f2"}], "functionId": "f1"})
    );
    // connectorMap keeps the raw colour.
    assert_eq!(l.connectors["c1"]["color"], json!("#6B7280"));
    assert_eq!(
        Value::Array(l.signals.clone()),
        json!([
            {"id": "s1", "name": "SDI", "color": "#2563eb", "cablePrefix": null, "cableSuffix": null,
             "category": "Vidéo", "categoryRef": {"name": "Vidéo", "cablePrefix": "V", "cableSuffix": null}},
            {"id": "s2", "name": "AES", "color": "#ff0000", "cablePrefix": "A", "cableSuffix": null,
             "category": "Vidéo", "categoryRef": {"name": "Vidéo", "cablePrefix": "V", "cableSuffix": null}},
            {"id": "s3", "name": "LTC", "color": "#a3a3a3", "cablePrefix": null, "cableSuffix": null,
             "category": null, "categoryRef": null},
        ])
    );
    // Functions used by a signal, in the functions' order, deduplicated.
    assert_eq!(
        Value::Array(l.signal_categories.clone()),
        json!([{"name": "Vidéo", "cablePrefix": "V", "cableSuffix": null}])
    );
    // Top-level categories with their children; an orphan is dropped.
    assert_eq!(
        Value::Array(l.equipment_categories.clone()),
        json!([{"id": "k1", "name": "Vidéo", "color": "#00f",
                "children": [{"id": "k2", "name": "Caméras", "color": null}]}])
    );
}

#[test]
fn target_label_pure_cases() {
    let t = TargetLookups {
        rack_names: HashMap::from([("rb".to_string(), "Régie".to_string())]),
        slots: HashMap::from([
            (
                "sb1".to_string(),
                obj(json!({"id": "sb1", "label": " Cam 1 ", "catalogEquipmentId": "e1"})),
            ),
            (
                "sb2".to_string(),
                obj(json!({"id": "sb2", "label": null, "catalogEquipmentId": "e1"})),
            ),
            (
                "sb3".to_string(),
                obj(json!({"id": "sb3", "label": "", "catalogEquipmentId": null})),
            ),
        ]),
        equipment: HashMap::from([(
            "e1".to_string(),
            obj(json!({"id": "e1", "name": "HDC", "connectors": [
                {"connectorTypeId": "ct1", "label": "  ", "signalName": "SDI", "quantity": 2},
                {"connectorTypeId": "ct2", "label": "Tally"},
                {"connectorTypeId": "ct-gone", "quantity": 1},
                {"connectorTypeId": "ct1", "quantity": 0},
                {"connectorTypeId": "ct2", "quantity": 3},
            ]})),
        )]),
        connector_names: HashMap::from([
            ("ct1".to_string(), "BNC".to_string()),
            ("ct2".to_string(), "XLR".to_string()),
        ]),
    };
    let port = |id: &str, slot: &str, index: i64| {
        obj(
            json!({"id": id, "rackId": "ra", "slotId": slot, "portIndex": index, "kind": "INTER_LIEU"}),
        )
    };
    let conn = |id: &str,
                from: (&str, Option<&str>, Option<i64>),
                to: (&str, Option<&str>, Option<i64>),
                label: Value| {
        obj(
            json!({"id": id, "fromRackId": from.0, "fromSlotId": from.1, "fromConnectorIndex": from.2,
                   "toRackId": to.0, "toSlotId": to.1, "toConnectorIndex": to.2, "label": label}),
        )
    };
    let ports = vec![
        port("p0", "s1", 0),
        port("p1", "s1", 1),
        port("p2", "s1", 2),
        port("p3", "s1", 3),
        port("p4", "s1", 4),
        port("p5", "s1", 5),
        port("p6", "s1", 6),
    ];

    // No connection (or no port): `targetLabel: null`, no `targetCableLabel`.
    let out = enrich_external_ports_target_label("ra", &ports, &[], &t);
    assert!(out
        .iter()
        .all(|p| p["targetLabel"].is_null() && !p.contains_key("targetCableLabel")));
    assert!(enrich_external_ports_target_label("ra", &[], &[], &t).is_empty());

    let conns = vec![
        // p0 (from side): slot label wins over the equipment name; port 1
        // is the 2nd unit of the first entry, labelled by its signalName.
        conn(
            "c0",
            ("ra", Some("s1"), Some(0)),
            ("rb", Some("sb1"), Some(1)),
            json!(" W-1 "),
        ),
        // p1 (to side): no slot label → equipment name; port 2 = "Tally".
        conn(
            "c1",
            ("rb", Some("sb2"), Some(2)),
            ("ra", Some("s1"), Some(1)),
            json!(""),
        ),
        // p2: unknown connector type → no port label.
        conn(
            "c2",
            ("ra", Some("s1"), Some(2)),
            ("rb", Some("sb2"), Some(3)),
            Value::Null,
        ),
        // p3: quantity 0 skipped, port 5 = 2nd of the XLR ×3.
        conn(
            "c3",
            ("ra", Some("s1"), Some(3)),
            ("rb", Some("sb2"), Some(5)),
            Value::Null,
        ),
        // p4: unknown rack → "Rack"; slot without equipment and empty label.
        conn(
            "c4",
            ("ra", Some("s1"), Some(4)),
            ("r-gone", Some("sb3"), Some(0)),
            Value::Null,
        ),
        // p5: other end is an adapter (no slot) → rack name only.
        conn(
            "c5",
            ("ra", Some("s1"), Some(5)),
            ("rb", None, None),
            json!("K"),
        ),
        // Same slot and index but another rack: no match for p6.
        conn(
            "c6",
            ("rx", Some("s1"), Some(6)),
            ("rb", Some("sb1"), Some(0)),
            Value::Null,
        ),
    ];
    let out = enrich_external_ports_target_label("ra", &ports, &conns, &t);
    let got: Vec<(Value, Option<Value>)> = out
        .iter()
        .map(|p| (p["targetLabel"].clone(), p.get("targetCableLabel").cloned()))
        .collect();
    assert_eq!(
        got,
        vec![
            (json!("Régie · Cam 1 · SDI 2"), Some(json!("W-1"))),
            (json!("Régie · HDC · Tally"), Some(Value::Null)),
            (json!("Régie · HDC"), Some(Value::Null)),
            (json!("Régie · HDC · XLR 2"), Some(Value::Null)),
            (json!("Rack"), Some(Value::Null)),
            (json!("Régie"), Some(json!("K"))),
            (Value::Null, None),
        ]
    );
    // The port's own fields are kept.
    assert_eq!(out[0]["kind"], json!("INTER_LIEU"));
    assert_eq!(out[0]["slotId"], json!("s1"));
}

#[test]
fn resorption_pure_cases() {
    let ports = objs(json!([
        {"id": "a", "rackId": "r1", "slotId": "s1", "portIndex": 0, "kind": "INTER_LIEU"},
        {"id": "b", "rackId": "r1", "slotId": "s1", "portIndex": 1, "kind": "MONDE"},
        {"id": "c", "rackId": "r2", "slotId": "s2", "portIndex": 0, "kind": "INTER_LIEU"},
        {"id": "d", "rackId": "r2", "slotId": "s2", "portIndex": 1, "kind": "INTER_LIEU"},
        {"id": "e", "rackId": "r1", "slotId": "s2", "portIndex": 0, "kind": "INTER_LIEU"},
    ]));
    let conns = objs(json!([
        // Both ends keyed.
        {"fromRackId": "r1", "fromSlotId": "s1", "fromConnectorIndex": 0,
         "toRackId": "r2", "toSlotId": "s2", "toConnectorIndex": 0},
        // MONDE stays visible even when keyed; adapter end (no slot) not keyed.
        {"fromRackId": "r1", "fromSlotId": "s1", "fromConnectorIndex": 1,
         "toRackId": "r2", "toSlotId": null, "toConnectorIndex": 1},
        // Slot without index: not keyed.
        {"fromRackId": "r2", "fromSlotId": "s2", "fromConnectorIndex": null,
         "toRackId": "r1", "toSlotId": "s9", "toConnectorIndex": 0},
    ]));
    let ids: Vec<String> = visible_external_ports(ports, &conns)
        .iter()
        .map(|p| p["id"].as_str().unwrap().to_string())
        .collect();
    // `e` has slot s2 on rack r1: the key is `r1:s2:0`, not `r2:s2:0`.
    assert_eq!(ids, ["b", "d", "e"]);
}
