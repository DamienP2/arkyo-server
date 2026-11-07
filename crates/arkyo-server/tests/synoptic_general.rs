//! Phase 4c, Task 6: general view of the project synoptic
//! (`GET /api/tenant/projects/:id/synoptic/general`,
//! arkyo:app/api/tenant/projects/[id]/synoptic/general/route.ts).
mod common;
use std::net::SocketAddr;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

const NOW: &str = "2026-11-07T10:00:00.000Z";
const URL: &str = "/api/tenant/projects/p1/synoptic/general";

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

/// The data of the shape test, inserted by hand with fixed ids (the seeded
/// catalogue is emptied first).
/// - project `p1`: rigs `rg1`, `rg2`; locations `loc2` (sortOrder 0),
///   `loc1` (1), `loc3` (2, empty);
/// - racks of `p1` (through the rigs): `ra` (loc1, in both rigs), `rv`
///   (virtual, loc1), `rz` (loc2), `ru` and `ru2` (no location), `rvx`
///   (virtual, no location); `rx` belongs to `p2`, `rt` to a template rig
///   only;
/// - external ports covering every branch of `resolvePortInfo` and
///   `buildExternalConnectors` (panel, equipment, unknown equipment, bare
///   slot, slot of another rack, MONDE);
/// - project connections inter-location (`pc1`, `pc3`, `pc4`), intra-location
///   (`pc2`, `pc5`) and of another project (`pcx`).
async fn seed(pool: &SqlitePool) {
    for sql in [
        r#"DELETE FROM "TenantSignalType""#,
        r#"DELETE FROM "TenantConnectorType""#,
        r#"DELETE FROM "TenantFunction""#,
        r#"DELETE FROM "AppConfig" WHERE "key" LIKE 'cable_%'"#,
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('p1','Match','u',?,?)"#,
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('p2','Autre','u',?,?)"#,
        r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt") VALUES ('rg1','Régie 1','p1','u',?,?)"#,
        r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt") VALUES ('rg2','Régie 2','p1','u',?,?)"#,
        r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt") VALUES ('rgx','Autre','p2','u',?,?)"#,
        r#"INSERT INTO "RigConfig" ("id","name","isTemplate","createdById","createdAt","updatedAt") VALUES ('rgt','Modèle',1,'u',?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","cableCode","sortOrder","canvasX","canvasY","createdAt","updatedAt") VALUES ('loc1','p1','Plateau','PLT',1,10,20,?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","sortOrder","createdAt","updatedAt") VALUES ('loc2','p1','Régie',0,?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","sortOrder","createdAt","updatedAt") VALUES ('loc3','p1','Vide',2,?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","createdAt","updatedAt") VALUES ('locx','p2','Ailleurs',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","cableCode","totalU","rackType","emptyWeightKg","canvasX","canvasY","locationId","createdAt","updatedAt") VALUES ('ra','Baie A','BA',12,'FLIGHT_CASE_CLASSIC',20.25,5,6,'loc1',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","isVirtual","emptyWeightKg","locationId","createdAt","updatedAt") VALUES ('rv','Plateau',1,100,'loc1',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","locationId","createdAt","updatedAt") VALUES ('rz','Baie Z','loc2',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","totalU","rackType","emptyWeightKg","canvasX","canvasY","createdAt","updatedAt") VALUES ('ru','Valise',4,'PELICAN',3,300,400,?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('ru2','Sans port',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","isVirtual","emptyWeightKg","createdAt","updatedAt") VALUES ('rvx','Libres',1,7,?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","emptyWeightKg","locationId","createdAt","updatedAt") VALUES ('rx','Baie X',50,'locx',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","emptyWeightKg","createdAt","updatedAt") VALUES ('rt','Modèle',50,?,?)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr1','rg1','ra',0)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr2','rg2','ra',0)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr3','rg1','rv',1)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr4','rg2','rz',1)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr5','rg1','ru',2)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr6','rg1','ru2',3)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr7','rg1','rvx',4)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr8','rgx','rx',0)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr9','rgt','rt',0)"#,
        // Catalogue (same referentials as the location test).
        r#"INSERT INTO "TenantFunction" ("id","key","label","color","cablePrefix","sortOrder","createdAt","updatedAt") VALUES ('f1','video','Vidéo','#2563eb','V',0,?,?)"#,
        r#"INSERT INTO "TenantFunction" ("id","key","label","cablePrefix","cableSuffix","sortOrder","createdAt","updatedAt") VALUES ('f2','audio','Audio','A','x',1,?,?)"#,
        r#"INSERT INTO "TenantFunction" ("id","key","label","color","sortOrder","createdAt","updatedAt") VALUES ('f3','data','Data','#111111',2,?,?)"#,
        r#"INSERT INTO "TenantConnectorType" ("id","name","versions","iconId","color","functionIds","createdAt","updatedAt") VALUES ('ct1','BNC','["75"]','bnc','#6B7280','["f1"]',?,?)"#,
        r#"INSERT INTO "TenantConnectorType" ("id","name","color","createdAt","updatedAt") VALUES ('ct2','XLR','#ff0000',?,?)"#,
        r#"INSERT INTO "TenantConnectorType" ("id","name","functionIds","createdAt","updatedAt") VALUES ('ct3','RJ45','["f2"]',?,?)"#,
        r#"INSERT INTO "TenantSignalType" ("id","name","functionId","cablePrefix","createdAt","updatedAt") VALUES ('sg1','SDI','f1','S',?,?)"#,
        r#"INSERT INTO "TenantSignalType" ("id","name","color","functionId","createdAt","updatedAt") VALUES ('sg2','AES','#6b7280','f2',?,?)"#,
        r#"INSERT INTO "TenantSignalType" ("id","name","color","createdAt","updatedAt") VALUES ('sg3','GPIO','#00ff00',?,?)"#,
        // eq1 flat ports: 0-1 « SDI OUT » (OUT), 2 XLR (IN), 3 unknown
        // connector type, (quantity 0: none), 4 « GPI » (in).
        r#"INSERT INTO "TenantEquipment" ("id","name","weight","powerW","connectors","createdById","createdAt","updatedAt") VALUES ('eq1','HDC-5500',4.5,60,'[{"connectorTypeId":"ct1","label":" SDI OUT ","quantity":2,"direction":"out","signalName":"SDI"},{"connectorTypeId":"ct2","direction":"IN"},{"label":"","connectorTypeId":"ctgone","quantity":1},{"quantity":0,"label":"skip"},{"label":"GPI","direction":"in"}]','u',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","powerW","createdById","createdAt","updatedAt") VALUES ('eq2','Mixeur',150,'u',?,?)"#,
        // Panel: occupied positions 0 (ps2) and 2 (ps1); position 1 empty.
        r#"INSERT INTO "Panel" ("id","name","heightU","slotsPerU","createdById","createdAt","updatedAt") VALUES ('pa1','Patch BNC',1,4,'u',?,?)"#,
        r#"INSERT INTO "PanelSlot" ("id","panelId","position","label","catalogConnectorTypeId") VALUES ('ps1','pa1',2,'IN 3','ct1')"#,
        r#"INSERT INTO "PanelSlot" ("id","panelId","position","catalogConnectorTypeId") VALUES ('ps2','pa1',0,'ct2')"#,
        r#"INSERT INTO "PanelSlot" ("id","panelId","position","label") VALUES ('ps3','pa1',1,'vide')"#,
        // Slots.
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('sa1','ra','eq1',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","panelId","createdAt","updatedAt") VALUES ('sa2','ra','pa1',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","panelId","label","createdAt","updatedAt") VALUES ('sa3','ra','pa1','  Patch custom ',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","label","createdAt","updatedAt") VALUES ('sa4','ra','eq1','Caméra 2',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","label","createdAt","updatedAt") VALUES ('sa5','ra','Libre',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('sa6','ra','gone',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","parentSlotId","createdAt","updatedAt") VALUES ('sc1','ra','eq2','sa5',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('sv1','rv','eq2',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","label","createdAt","updatedAt") VALUES ('sz1','rz','eq1','  ',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('su1','ru','eq1',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('svx','rvx','eq2',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('sx1','rx','eq1',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('st1','rt','eq1',?,?)"#,
        // External ports.
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('e1','ra','sa1',0,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","label","createdAt","updatedAt") VALUES ('e2','ra','sa1',2,' Retour ',?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","label","createdAt","updatedAt") VALUES ('e3','ra','sa2',0,'  ',?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('e4','ra','sa3',3,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('e5','ra','sa3',5,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('e6','ra','sa5',1,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('e7','ra','sa6',0,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","label","kind","createdAt","updatedAt") VALUES ('e8','ra','sa1',1,'Monde','MONDE',?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('e9','ra','sz1',4,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('ev1','rv','sv1',0,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('ez1','rz','sz1',3,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('eu1','ru','su1',1,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('eu2','ru','su1',2,?,?)"#,
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('ex1','rx','sx1',0,?,?)"#,
        // Bundles and project connections.
        r#"INSERT INTO "ProjectCableBundle" ("id","projectId","name","color","createdAt","updatedAt") VALUES ('pb1','p1','Faisceau','#ff00ff',?,?)"#,
        r#"INSERT INTO "ProjectCableBundle" ("id","projectId","name","createdAt","updatedAt") VALUES ('pb2','p1','Secours','2026-11-01T08:00:00.000Z',?)"#,
        r#"INSERT INTO "ProjectCableBundle" ("id","projectId","name","createdAt","updatedAt") VALUES ('pbx','p2','Autre',?,?)"#,
        r##"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","toSlotId","toConnectorIndex","label","color","waypoints","cableStyle","tags","wired","bundleId","createdAt") VALUES ('pc1','p1','ra','sa1',0,'rz','sz1',3,'V-001','#ff0000','[{"x":1,"y":2}]','ortho','[{"color":"#000","text":"A"}]',1,'pb1',?)"##,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","toSlotId","toConnectorIndex","createdAt") VALUES ('pc2','p1','ra','sa1',2,'rv','sv1',0,?)"#,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","toSlotId","toConnectorIndex","createdAt") VALUES ('pc3','p1','ru','su1',2,'ra','sa1',2,'2026-11-01T08:00:00.000Z')"#,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","createdAt") VALUES ('pc4','p1','ru','su1',1,'ru2',?)"#,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","toSlotId","toConnectorIndex","createdAt") VALUES ('pc5','p1','rz','sz1',0,'rz','sz1',1,?)"#,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","toSlotId","toConnectorIndex","createdAt") VALUES ('pcx','p2','rx','sx1',0,'ra','sa1',0,?)"#,
        // AppConfig: two of the 8 keys, one numbering key outside them, one
        // unrelated key.
        r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES ('cfg1','cable_pad','3',?)"#,
        r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES ('cfg2','cable_numbering_pad','4',?)"#,
        r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES ('cfg3','cable_template_enabled','true',?)"#,
        r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES ('cfg4','patch_panel_depth_mm','5',?)"#,
    ] {
        exec(pool, sql).await;
    }
}

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/synoptic-general.json")).unwrap()
}

#[tokio::test]
async fn general_payload_shape_matches_arkyo() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    seed(&e.pool).await;

    let r = get(&e, Some(&tok), URL).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_same("$", &r.body, &fixture()["expected"]);

    // 404 « Not found » for an unknown project.
    let r = get(&e, Some(&tok), "/api/tenant/projects/nope/synoptic/general").await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
    );

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

/// A project without any rack answers arkyo's early return: `locations`
/// is empty even when the project has locations (route.ts:67-84), and the
/// catalogue lists and `appConfig` are empty.
#[tokio::test]
async fn empty_project_general() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    seed(&e.pool).await;
    for sql in [
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('p3','Vide','u',?,?)"#,
        r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt") VALUES ('rg3','Régie','p3','u',?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","createdAt","updatedAt") VALUES ('loc9','p3','Plateau',?,?)"#,
        // A rack placed in a location of p3 but linked to no rig of p3.
        r#"INSERT INTO "Rack" ("id","name","locationId","createdAt","updatedAt") VALUES ('r9','Orpheline','loc9',?,?)"#,
        r#"INSERT INTO "ProjectCableBundle" ("id","projectId","name","createdAt","updatedAt") VALUES ('pb9','p3','Faisceau',?,?)"#,
    ] {
        exec(&e.pool, sql).await;
    }

    let r = get(&e, Some(&tok), "/api/tenant/projects/p3/synoptic/general").await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_same("$", &r.body, &fixture()["empty"]);
}

/// 10 racks in 5 locations, 300 external ports and 300 project connections:
/// the server answers in under 2 s (review focus 5).
#[tokio::test]
async fn large_project_under_2s() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;

    let mut tx = e.pool.begin().await.unwrap();
    let mut stmts: Vec<String> = vec![
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('pl','Gros','u','T','T')"#.into(),
        r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt") VALUES ('rgl','Régie','pl','u','T','T')"#.into(),
        r#"INSERT INTO "TenantEquipment" ("id","name","weight","powerW","connectors","createdById","createdAt","updatedAt") VALUES ('eql','Caméra',3.5,45,'[{"connectorTypeId":"ct-bnc","label":"SDI","quantity":8,"direction":"OUT"},{"label":"REF","direction":"IN","quantity":4}]','u','T','T')"#.into(),
    ];
    for l in 0..5 {
        stmts.push(format!(
            r#"INSERT INTO "Location" ("id","projectId","name","sortOrder","createdAt","updatedAt") VALUES ('l{l}','pl','Lieu {l}',{l},'T','T')"#
        ));
    }
    for r in 0..10 {
        let l = r / 2;
        stmts.push(format!(
            r#"INSERT INTO "Rack" ("id","name","emptyWeightKg","locationId","createdAt","updatedAt") VALUES ('r{r}','Baie {r}',30,'l{l}','T','T')"#
        ));
        stmts.push(format!(
            r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr{r}','rgl','r{r}',{r})"#
        ));
        for s in 0..10 {
            stmts.push(format!(
                r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('s{r}-{s}','r{r}','eql','T','T')"#
            ));
        }
        for p in 0..30 {
            let (s, port) = (p % 10, p / 10);
            stmts.push(format!(
                r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","createdAt","updatedAt") VALUES ('x{r}-{p}','r{r}','s{r}-{s}',{port},'T','T')"#
            ));
        }
    }
    let mut inter = 0;
    for k in 0..300 {
        let (from, to) = (k % 10, (k * 7 + 3) % 10);
        if from / 2 != to / 2 {
            inter += 1;
        }
        let (fs, ts) = (k % 10, (k / 10) % 10);
        stmts.push(format!(
            r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","toSlotId","toConnectorIndex","label","createdAt") VALUES ('c{k}','pl','r{from}','s{from}-{fs}',{},'r{to}','s{to}-{ts}',{},'V-{k:03}','T')"#,
            k % 12,
            (k + 5) % 12
        ));
    }
    for sql in &stmts {
        sqlx::query(sql)
            .execute(&mut *tx)
            .await
            .unwrap_or_else(|err| panic!("{sql}: {err}"));
    }
    tx.commit().await.unwrap();

    let start = Instant::now();
    let r = get(&e, Some(&tok), "/api/tenant/projects/pl/synoptic/general").await;
    let elapsed = start.elapsed();
    eprintln!("large_project_under_2s: GET general en {elapsed:?}");
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert!(elapsed < Duration::from_secs(2), "{elapsed:?}");

    let locations = r.body["locations"].as_array().unwrap();
    assert_eq!(locations.len(), 5);
    let ports: usize = locations
        .iter()
        .map(|l| l["externalConnectors"].as_array().unwrap().len())
        .sum();
    assert_eq!(ports, 300);
    assert_eq!(r.body["racks"], json!([]));
    assert_eq!(r.body["connections"].as_array().unwrap().len(), inter);
    assert_eq!(
        r.body["stats"],
        json!({"rackCount": 10, "totalWeightKg": 650, "totalPowerW": 4500})
    );
}
