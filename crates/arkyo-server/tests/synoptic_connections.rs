//! Phase 4c, Task 7: project connections
//! (`POST /api/tenant/projects/:id/synoptic/connections`, `PATCH`/`DELETE
//! …/:connectionId`, `POST …/connections/renumber`) and the audit reads
//! (`GET /api/tenant/projects/:id/audit`, `GET /api/racks/:id/audit`),
//! arkyo:app/api/tenant/projects/[id]/synoptic/connections/**,
//! arkyo:app/api/tenant/projects/[id]/audit/route.ts and
//! arkyo:app/api/racks/[id]/audit/route.ts (inventory, annexes B §14 and
//! C §7-9; 4c decision 6).
mod common;
use std::net::SocketAddr;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tokio::sync::broadcast::Receiver;
use tower::ServiceExt;

const NOW: &str = "2026-11-07T10:00:00.000Z";
const CONNS: &str = "/api/tenant/projects/p1/synoptic/connections";
const RENUMBER: &str = "/api/tenant/projects/p1/synoptic/connections/renumber";
const CLIENT: &str = "tab-1";
const NOT_IN_PROJECT: &str = "Un rack n'appartient pas à ce projet";

async fn exec(pool: &SqlitePool, sql: &str) {
    let mut q = sqlx::query(sql);
    for _ in 0..sql.matches('?').count() {
        q = q.bind(NOW);
    }
    q.execute(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

async fn send(e: &Env, tok: &str, method: &str, uri: &str, body: Option<Value>) -> Reply {
    let mut b = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::COOKIE, format!("arkyo_session={tok}"))
        .header("x-client-id", CLIENT);
    let body = match body {
        Some(v) => {
            b = b.header(header::CONTENT_TYPE, "application/json");
            Body::from(v.to_string())
        }
        None => Body::empty(),
    };
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

fn drain(rx: &mut Receiver<String>) -> Vec<Value> {
    let mut out = Vec::new();
    while let Ok(s) = rx.try_recv() {
        out.push(serde_json::from_str(&s).unwrap());
    }
    out
}

/// Project `p1` (rig `rg1`): racks `ra` (« Baie A », code `BA`, location
/// `loc1`), `rc` (`loc1` too), `rb` (« Baie B », `loc2`, override
/// `sep1 = "_"`), `rn` (« Valise », no location). Project `p2`: rack `rx`.
/// Equipment `eq1`: 2 × SDI out, AES in, GPIO bidir. Slots `sa1` (ra),
/// `sb1` (rb), `sn1` (rn), `sx1` (rx). Bundles `pb1` (p1), `pbx` (p2);
/// project adapters `pad1` (p1), `padx` (p2).
async fn seed(pool: &SqlitePool) {
    for sql in [
        r#"DELETE FROM "TenantSignalType""#,
        r#"DELETE FROM "TenantConnectorType""#,
        r#"DELETE FROM "TenantFunction""#,
        r#"DELETE FROM "AppConfig" WHERE "key" LIKE 'cable_%'"#,
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('p1','Match','u',?,?)"#,
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('p2','Autre','u',?,?)"#,
        r#"INSERT INTO "Project" ("id","name","createdById","createdAt","updatedAt") VALUES ('p3','Vide','u',?,?)"#,
        r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt") VALUES ('rg1','Régie 1','p1','u',?,?)"#,
        r#"INSERT INTO "RigConfig" ("id","name","projectId","createdById","createdAt","updatedAt") VALUES ('rgx','Autre','p2','u',?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","createdAt","updatedAt") VALUES ('loc1','p1','Plateau',?,?)"#,
        r#"INSERT INTO "Location" ("id","projectId","name","createdAt","updatedAt") VALUES ('loc2','p1','Régie',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","cableCode","locationId","createdAt","updatedAt") VALUES ('ra','Baie A','BA','loc1',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","locationId","createdAt","updatedAt") VALUES ('rc','Baie C','loc1',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","numberingOverride","locationId","createdAt","updatedAt") VALUES ('rb','Baie B','{"sep1":"_"}','loc2',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('rn','Valise',?,?)"#,
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('rx','Baie X',?,?)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr1','rg1','ra',0)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr2','rg1','rc',1)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr3','rg1','rb',2)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr4','rg1','rn',3)"#,
        r#"INSERT INTO "RigRack" ("id","rigConfigId","rackId","position") VALUES ('rr5','rgx','rx',0)"#,
        r#"INSERT INTO "TenantFunction" ("id","key","label","cablePrefix","sortOrder","createdAt","updatedAt") VALUES ('f1','video','Vidéo','V',0,?,?)"#,
        r#"INSERT INTO "TenantFunction" ("id","key","label","cablePrefix","cableSuffix","sortOrder","createdAt","updatedAt") VALUES ('f2','audio','Audio','A','x',1,?,?)"#,
        r#"INSERT INTO "TenantSignalType" ("id","name","functionId","cablePrefix","createdAt","updatedAt") VALUES ('sg1','SDI','f1',' S ',?,?)"#,
        r#"INSERT INTO "TenantSignalType" ("id","name","functionId","createdAt","updatedAt") VALUES ('sg2','AES','f2',?,?)"#,
        r#"INSERT INTO "TenantEquipment" ("id","name","connectors","createdById","createdAt","updatedAt") VALUES ('eq1','Caméra','[{"signalName":"SDI","direction":"out","quantity":2},{"signalName":"AES","direction":"in"},{"signalName":"GPIO","direction":"bidir"}]','u',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('sa1','ra','eq1',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('sb1','rb','eq1',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('sn1','rn','eq1',?,?)"#,
        r#"INSERT INTO "RackSlot" ("id","rackId","catalogEquipmentId","createdAt","updatedAt") VALUES ('sx1','rx','eq1',?,?)"#,
        r#"INSERT INTO "ProjectCableBundle" ("id","projectId","name","createdAt","updatedAt") VALUES ('pb1','p1','Faisceau',?,?)"#,
        r#"INSERT INTO "ProjectCableBundle" ("id","projectId","name","createdAt","updatedAt") VALUES ('pbx','p2','Ailleurs',?,?)"#,
        r#"INSERT INTO "ProjectSynopticAdapter" ("id","projectId","catalogAdapterId","x","y","createdAt","updatedAt") VALUES ('pad1','p1','ad1',0,0,?,?)"#,
        r#"INSERT INTO "ProjectSynopticAdapter" ("id","projectId","catalogAdapterId","x","y","createdAt","updatedAt") VALUES ('padx','p2','ad1',0,0,?,?)"#,
    ] {
        exec(pool, sql).await;
    }
}

async fn setup() -> (Env, String) {
    let e = env().await;
    seed(&e.pool).await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    (e, tok)
}

async fn count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

async fn audits(
    pool: &SqlitePool,
) -> Vec<(String, String, String, Option<String>, Option<String>)> {
    sqlx::query_as(
        r#"SELECT "action", "entityType", "entityId", "projectId", "after" FROM "AuditLog"
           ORDER BY rowid"#,
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

fn after(raw: &Option<String>) -> Value {
    raw.as_deref()
        .map_or(Value::Null, |s| serde_json::from_str(s).unwrap())
}

#[tokio::test]
async fn inter_rack_connection_crud() {
    let (e, tok) = setup().await;
    let mut rx = e.events.subscribe();

    // ── POST ────────────────────────────────────────────────────────────────
    let r = send(
        &e,
        &tok,
        "POST",
        CONNS,
        Some(json!({
            "from": {"rackId": "ra", "slotId": "sa1", "connectorIndex": 0, "extra": 1},
            "to": {"rackId": "rb", "slotId": "sb1", "connectorIndex": 1},
            "label": "L-1",
            "color": "#ff0000",
            "waypoints": [{"x": 1, "y": 2, "k": "kept"}],
            "cableStyle": "rounded",
            "notes": "n",
            "tags": [{"color": "#000", "text": "A"}],
            "bundleId": "pb1",
            "catalogCableModelId": "ignored",
            "wired": true
        })),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let id = r.body["id"].as_str().unwrap().to_string();
    let mut expected = json!({
        "id": id, "projectId": "p1",
        "fromRackId": "ra", "fromSlotId": "sa1", "fromConnectorIndex": 0,
        "fromAdapterId": null, "fromAdapterPortIndex": null, "fromAdapterSide": null,
        "toRackId": "rb", "toSlotId": "sb1", "toConnectorIndex": 1,
        "toAdapterId": null, "toAdapterPortIndex": null, "toAdapterSide": null,
        "label": "L-1", "color": "#ff0000",
        "waypoints": [{"x": 1, "y": 2, "k": "kept"}],
        "cableStyle": "rounded", "notes": "n",
        "tags": [{"color": "#000", "text": "A"}],
        "catalogCableModelId": null, "wired": false, "wiredAt": null, "wiredNotes": null,
        "bundleId": "pb1",
        "createdAt": r.body["createdAt"].clone(),
    });
    assert_eq!(r.body, expected);
    assert_eq!(
        drain(&mut rx),
        vec![
            json!({"type": "update", "entity": "project_synoptic_connection",
            "action": "created", "id": id, "projectId": "p1", "rackId": "ra",
            "itemId": id, "clientId": CLIENT})
        ]
    );

    // An adapter endpoint (project adapter), a rack without location.
    let r = send(
        &e,
        &tok,
        "POST",
        CONNS,
        Some(json!({
            "from": {"rackId": "rn", "adapterId": "pad1", "adapterPortIndex": 2, "adapterSide": "left"},
            "to": {"rackId": "rc"}
        })),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    assert_eq!(
        (
            &r.body["fromAdapterId"],
            &r.body["fromAdapterSide"],
            &r.body["waypoints"],
            &r.body["label"]
        ),
        (&json!("pad1"), &json!("left"), &Value::Null, &Value::Null)
    );
    let id2 = r.body["id"].as_str().unwrap().to_string();
    drain(&mut rx);

    // ── POST errors (nothing written) ───────────────────────────────────────
    let before = count(&e.pool, r#"SELECT COUNT(*) FROM "ProjectConnection""#).await;
    let cases = [
        (
            json!({"to": {"rackId": "rb"}}),
            StatusCode::BAD_REQUEST,
            json!({"error": "Validation invalide", "issues": [
                {"path": ["from"], "message": "Invalid input: expected object, received undefined"}
            ]}),
        ),
        (
            json!({"from": {"rackId": "", "connectorIndex": 1.5}, "to": {"rackId": "rb", "slotId": "sb1", "adapterId": "pad1"}, "cableStyle": "zigzag"}),
            StatusCode::BAD_REQUEST,
            json!({"error": "Validation invalide", "issues": [
                {"path": ["from", "rackId"], "message": "Too small: expected string to have >=1 characters"},
                {"path": ["from", "connectorIndex"], "message": "Invalid input: expected int, received number"},
                {"path": ["to"], "message": "Endpoint ne peut pas avoir à la fois slotId et adapterId"},
                {"path": ["cableStyle"], "message": "Invalid option: expected one of \"ortho\"|\"rounded\"|\"arrow\""}
            ]}),
        ),
        (
            json!([]),
            StatusCode::BAD_REQUEST,
            json!({"error": "Validation invalide", "issues": [
                {"path": ["root"], "message": "Invalid input: expected object, received array"}
            ]}),
        ),
        // Same location (ra and rc are both in loc1).
        (
            json!({"from": {"rackId": "ra"}, "to": {"rackId": "rc"}}),
            StatusCode::BAD_REQUEST,
            json!({"error": "Les deux extrémités sont dans le même emplacement — tirez un câble direct dans la vue de l'emplacement."}),
        ),
        // A rack of another project: spanning two projects is refused.
        (
            json!({"from": {"rackId": "ra"}, "to": {"rackId": "rx", "slotId": "sx1"}}),
            StatusCode::NOT_FOUND,
            json!({"error": NOT_IN_PROJECT}),
        ),
        (
            json!({"from": {"rackId": "ghost"}, "to": {"rackId": "rb"}}),
            StatusCode::NOT_FOUND,
            json!({"error": NOT_IN_PROJECT}),
        ),
        // arkyo-server: unknown or foreign references give 404, not 500.
        (
            json!({"from": {"rackId": "ra", "slotId": "nope"}, "to": {"rackId": "rb"}}),
            StatusCode::NOT_FOUND,
            json!({"error": "Slot introuvable"}),
        ),
        (
            json!({"from": {"rackId": "ra", "slotId": "sb1"}, "to": {"rackId": "rb"}}),
            StatusCode::NOT_FOUND,
            json!({"error": "Slot introuvable"}),
        ),
        (
            json!({"from": {"rackId": "ra"}, "to": {"rackId": "rb", "adapterId": "padx"}}),
            StatusCode::NOT_FOUND,
            json!({"error": "Adaptateur introuvable"}),
        ),
        (
            json!({"from": {"rackId": "ra"}, "to": {"rackId": "rb"}, "bundleId": "pbx"}),
            StatusCode::NOT_FOUND,
            json!({"error": "Bundle introuvable"}),
        ),
    ];
    for (body, status, err) in cases {
        let r = send(&e, &tok, "POST", CONNS, Some(body.clone())).await;
        assert_eq!((r.status, &r.body), (status, &err), "{body}");
    }
    let r = send(
        &e,
        &tok,
        "POST",
        "/api/tenant/projects/ghost/synoptic/connections",
        Some(json!({"from": {"rackId": "ra"}, "to": {"rackId": "rb"}})),
    )
    .await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
    );
    assert_eq!(
        count(&e.pool, r#"SELECT COUNT(*) FROM "ProjectConnection""#).await,
        before
    );
    assert!(drain(&mut rx).is_empty());

    // ── PATCH ───────────────────────────────────────────────────────────────
    exec(
        &e.pool,
        r#"INSERT INTO "TenantCableModel" ("id","name","createdAt","updatedAt") VALUES ('cm1','Coax',?,?)"#,
    )
    .await;
    let url = format!("{CONNS}/{id}");
    let patch = json!({
        "label": null, "color": "#00ff00", "waypoints": null, "cableStyle": "arrow",
        "tags": null, "bundleId": null, "catalogCableModelId": "cm1", "unknown": 1
    });
    let r = send(&e, &tok, "PATCH", &url, Some(patch)).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    for (k, v) in [
        ("label", Value::Null),
        ("color", json!("#00ff00")),
        ("waypoints", Value::Null),
        ("cableStyle", json!("arrow")),
        ("tags", Value::Null),
        ("bundleId", Value::Null),
        ("catalogCableModelId", json!("cm1")),
    ] {
        expected[k] = v;
    }
    assert_eq!(r.body, expected);
    assert_eq!(
        drain(&mut rx),
        vec![
            json!({"type": "update", "entity": "project_synoptic_connection",
            "action": "updated", "id": id, "projectId": "p1", "itemId": id,
            "clientId": CLIENT})
        ]
    );
    // The cable model is now in use (decision 2 guard).
    let r = send(
        &e,
        &tok,
        "DELETE",
        "/api/tenant/parametres/cabling/cm1",
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{:?}", r.body);
    assert_eq!(r.body["breakdown"]["projectConnections"], json!(1));

    // An empty PATCH is a no-op that still answers the row.
    let r = send(&e, &tok, "PATCH", &url, Some(json!({}))).await;
    assert_eq!((r.status, &r.body), (StatusCode::OK, &expected));
    drain(&mut rx);

    // PATCH errors.
    let r = send(
        &e,
        &tok,
        "PATCH",
        &url,
        Some(json!({"cableStyle": "zigzag", "notes": 3})),
    )
    .await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::BAD_REQUEST,
            json!({"error": "Validation invalide", "issues": [
                {"path": ["cableStyle"], "message": "Invalid option: expected one of \"ortho\"|\"rounded\"|\"arrow\""},
                {"path": ["notes"], "message": "Invalid input: expected string, received number"}
            ]})
        )
    );
    let r = send(&e, &tok, "PATCH", &url, Some(json!({"bundleId": "pbx"}))).await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::NOT_FOUND,
            json!({"error": "Bundle introuvable"})
        )
    );
    exec(
        &e.pool,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","toRackId","createdAt") VALUES ('pcx','p2','rx','rx',?)"#,
    )
    .await;
    for u in [format!("{CONNS}/ghost"), format!("{CONNS}/pcx")] {
        let r = send(&e, &tok, "PATCH", &u, Some(json!({"label": "x"}))).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
        );
        let r = send(&e, &tok, "DELETE", &u, None).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
        );
    }
    assert!(drain(&mut rx).is_empty());

    // ── DELETE ──────────────────────────────────────────────────────────────
    let r = send(&e, &tok, "DELETE", &url, None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    assert_eq!(
        drain(&mut rx),
        vec![
            json!({"type": "update", "entity": "project_synoptic_connection",
            "action": "deleted", "id": id, "projectId": "p1", "itemId": id,
            "clientId": CLIENT})
        ]
    );
    let r = send(&e, &tok, "DELETE", &url, None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);

    // ── audit ───────────────────────────────────────────────────────────────
    let log = audits(&e.pool).await;
    let summary: Vec<(String, String, String, Option<String>, Value)> = log
        .iter()
        .map(|(a, t, i, p, af)| (a.clone(), t.clone(), i.clone(), p.clone(), after(af)))
        .collect();
    let p1 = Some("p1".to_string());
    assert_eq!(
        summary,
        vec![
            (
                "create_project_connection".into(),
                "ProjectConnection".into(),
                id.clone(),
                p1.clone(),
                json!({"fromRackId": "ra", "toRackId": "rb"})
            ),
            (
                "create_project_connection".into(),
                "ProjectConnection".into(),
                id2.clone(),
                p1.clone(),
                json!({"fromRackId": "rn", "toRackId": "rc"})
            ),
            (
                "update_project_connection".into(),
                "ProjectConnection".into(),
                id.clone(),
                p1.clone(),
                json!({"label": null, "color": "#00ff00", "waypoints": null,
                    "cableStyle": "arrow", "tags": null, "bundleId": null,
                    "catalogCableModelId": "cm1"})
            ),
            (
                "update_project_connection".into(),
                "ProjectConnection".into(),
                id.clone(),
                p1.clone(),
                json!({})
            ),
            (
                "delete_project_connection".into(),
                "ProjectConnection".into(),
                id.clone(),
                p1.clone(),
                Value::Null
            ),
        ]
    );

    // ── guards: projects:write ──────────────────────────────────────────────
    add_user(&e.pool, "c@b.fr", "consultation", false).await;
    let ct = login(&e.app, "c@b.fr").await;
    let url2 = format!("{CONNS}/{id2}");
    for (m, u, b) in [
        (
            "POST",
            CONNS.to_string(),
            Some(json!({"from": {"rackId": "ra"}, "to": {"rackId": "rb"}})),
        ),
        ("PATCH", url2.clone(), Some(json!({"label": "x"}))),
        ("DELETE", url2.clone(), None),
        ("POST", RENUMBER.to_string(), Some(json!({}))),
    ] {
        let r = send(&e, &ct, m, &u, b).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{m} {u}");
    }
}

#[tokio::test]
async fn intra_rack_is_404_like_arkyo() {
    let (e, tok) = setup().await;
    let mut rx = e.events.subscribe();
    for body in [
        json!({"from": {"rackId": "ra", "slotId": "sa1", "connectorIndex": 0},
               "to": {"rackId": "ra", "slotId": "sa1", "connectorIndex": 1}}),
        json!({"from": {"rackId": "rn"}, "to": {"rackId": "rn"}}),
    ] {
        let r = send(&e, &tok, "POST", CONNS, Some(body)).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::NOT_FOUND, json!({"error": NOT_IN_PROJECT}))
        );
    }
    assert_eq!(
        count(&e.pool, r#"SELECT COUNT(*) FROM "ProjectConnection""#).await,
        0
    );
    assert_eq!(
        count(&e.pool, r#"SELECT COUNT(*) FROM "AuditLog""#).await,
        0
    );
    assert!(drain(&mut rx).is_empty());
}

async fn labels(pool: &SqlitePool) -> Vec<(String, Option<String>)> {
    sqlx::query_as(r#"SELECT "id", "label" FROM "ProjectConnection" ORDER BY "id""#)
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn project_renumber_stable() {
    let (e, tok) = setup().await;

    // An empty project: `{ok, count: 0}`, neither audit nor event.
    let mut rx = e.events.subscribe();
    let r = send(&e, &tok, "POST", RENUMBER, Some(json!({}))).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::OK, json!({"ok": true, "count": 0}))
    );
    let r = send(
        &e,
        &tok,
        "POST",
        "/api/tenant/projects/ghost/synoptic/connections/renumber",
        Some(json!({})),
    )
    .await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
    );
    assert!(drain(&mut rx).is_empty());
    assert_eq!(
        count(&e.pool, r#"SELECT COUNT(*) FROM "AuditLog""#).await,
        0
    );

    for sql in [
        // k1: SDI out from ra → « BA-S20001 » (old label overwritten).
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","toSlotId","toConnectorIndex","label","createdAt") VALUES ('k1','p1','ra','sa1',0,'rb','sb1',0,'OLD','2026-11-07T10:00:01.000Z')"#,
        // k2: GPIO bidir from rb (override sep1 "_", code from the name).
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","toSlotId","toConnectorIndex","createdAt") VALUES ('k2','p1','rb','sb1',3,'ra','sa1',1,'2026-11-07T10:00:02.000Z')"#,
        // k3: AES in from rn: prefix and suffix of the function.
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","toSlotId","toConnectorIndex","createdAt") VALUES ('k3','p1','rn','sn1',2,'ra','sa1',0,'2026-11-07T10:00:03.000Z')"#,
        // k4: SDI out from ra, no `to` slot.
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","createdAt") VALUES ('k4','p1','ra','sa1',1,'rn','2026-11-07T10:00:04.000Z')"#,
        // k5: no `from` slot: the signal of `to`, direction OUT by default.
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","toRackId","toSlotId","toConnectorIndex","createdAt") VALUES ('k5','p1','ra','rb','sb1',2,'2026-11-07T10:00:05.000Z')"#,
        // Another project's connection: untouched.
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","fromSlotId","fromConnectorIndex","toRackId","label","createdAt") VALUES ('kx','p2','rx','sx1',0,'rx','KEEP','2026-11-07T10:00:00.000Z')"#,
    ] {
        exec(&e.pool, sql).await;
    }
    let expected = vec![
        ("k1".to_string(), Some("BA-S20001".to_string())),
        ("k2".to_string(), Some("BAIE_30001".to_string())),
        ("k3".to_string(), Some("VALI-A10001x".to_string())),
        ("k4".to_string(), Some("BA-S20002".to_string())),
        // `to` port 2 is AES (direction IN), but only `from` decides: OUT.
        ("k5".to_string(), Some("BA-A20001x".to_string())),
        ("kx".to_string(), Some("KEEP".to_string())),
    ];
    for _ in 0..2 {
        let r = send(&e, &tok, "POST", RENUMBER, None).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::OK, json!({"ok": true, "count": 5}))
        );
        assert_eq!(labels(&e.pool).await, expected);
    }
    assert_eq!(
        drain(&mut rx),
        vec![
            json!({"type": "update", "entity": "project_synoptic_connection",
                "action": "renumbered", "id": "p1", "projectId": "p1", "clientId": CLIENT});
            2
        ]
    );
    let log = audits(&e.pool).await;
    assert_eq!(log.len(), 2);
    for (a, t, i, p, af) in log {
        assert_eq!(
            (a.as_str(), t.as_str(), i.as_str(), p.as_deref(), af),
            (
                "project_connection.renumber",
                "Project",
                "p1",
                Some("p1"),
                None
            )
        );
    }

    // Admin configuration: no rack segment, pad 3.
    for sql in [
        r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES ('c1','cable_include_rack','false',?)"#,
        r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES ('c2','cable_pad','3',?)"#,
    ] {
        exec(&e.pool, sql).await;
    }
    let r = send(&e, &tok, "POST", RENUMBER, Some(json!({}))).await;
    assert_eq!(r.status, StatusCode::OK);
    let got: Vec<Option<String>> = labels(&e.pool).await.into_iter().map(|(_, l)| l).collect();
    assert_eq!(
        got,
        ["S201", "301", "A101x", "S202", "A201x", "KEEP"].map(|s| Some(s.to_string()))
    );
}

/// Inserts an `AuditLog` row created at second `n`.
async fn log_at(pool: &SqlitePool, n: u32, entity_type: &str, entity_id: &str) {
    sqlx::query(
        r#"INSERT INTO "AuditLog" ("id","userId","action","entityType","entityId","projectId","before","after","createdAt")
           VALUES (?,?,?,?,?,?,?,?,?)"#,
    )
    .bind(format!("log{n:04}"))
    .bind("u")
    .bind(format!("act.{n}"))
    .bind(entity_type)
    .bind(entity_id)
    .bind(None::<String>)
    .bind(None::<String>)
    .bind(Some(r#"{"n":1}"#))
    .bind(format!(
        "2026-11-07T{:02}:{:02}:{:02}.000Z",
        n / 3600,
        (n / 60) % 60,
        n % 60
    ))
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn audit_union_and_limit() {
    let (e, tok) = setup().await;
    for sql in [
        r#"INSERT INTO "RackConnection" ("id","rackId","createdAt") VALUES ('rc1','ra',?)"#,
        r#"INSERT INTO "RackConnection" ("id","rackId","createdAt") VALUES ('rcb','rb',?)"#,
        r#"INSERT INTO "RackConnection" ("id","rackId","createdAt") VALUES ('rcx','rx',?)"#,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","toRackId","createdAt") VALUES ('pc1','p1','ra','rb',?)"#,
        r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","toRackId","createdAt") VALUES ('pcx','p2','rx','rx',?)"#,
    ] {
        exec(&e.pool, sql).await;
    }
    let rows = [
        (1, "Project", "p1"),             // in (project)
        (2, "Project", "p2"),             // out
        (3, "Rack", "ra"),                // in (project, rack ra)
        (4, "Rack", "rx"),                // out
        (5, "RackConnection", "rc1"),     // in (project, rack ra)
        (6, "RackConnection", "rcb"),     // in (project)
        (7, "RackConnection", "rcx"),     // out
        (8, "RackConnection", "gone"),    // out: no such connection
        (9, "ProjectConnection", "pc1"),  // in (project)
        (10, "ProjectConnection", "pcx"), // out
        (11, "RackSlot", "sa1"),          // out: not in the union
        (12, "Rack", "rb"),               // in (project)
    ];
    for (n, t, id) in rows {
        log_at(&e.pool, n, t, id).await;
    }
    let ids = |v: &Value| -> Vec<String> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|r| r["id"].as_str().unwrap().to_string())
            .collect()
    };
    let r = send(&e, &tok, "GET", "/api/tenant/projects/p1/audit", None).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(
        ids(&r.body),
        ["log0012", "log0009", "log0006", "log0005", "log0003", "log0001"]
    );
    assert_eq!(
        r.body[0],
        json!({"id": "log0012", "userId": "u", "action": "act.12", "entityType": "Rack",
            "entityId": "rb", "projectId": null, "before": null, "after": {"n": 1},
            "createdAt": "2026-11-07T00:00:12.000Z"})
    );
    let r = send(&e, &tok, "GET", "/api/racks/ra/audit", None).await;
    assert_eq!(ids(&r.body), ["log0005", "log0003"]);
    // A rack without logs (or unknown): an empty list, as arkyo.
    let r = send(&e, &tok, "GET", "/api/racks/ghost/audit", None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!([])));

    // limit: Number() semantics, clamped to 1..500.
    for (q, n) in [
        ("2", 2),
        (" 3 ", 3),
        ("0", 1),
        ("-4", 1),
        ("", 1),
        ("1e1", 6),
    ] {
        let r = send(
            &e,
            &tok,
            "GET",
            &format!(
                "/api/tenant/projects/p1/audit?limit={}",
                q.replace(' ', "%20")
            ),
            None,
        )
        .await;
        assert_eq!(
            (r.status, r.body.as_array().map(Vec::len)),
            (StatusCode::OK, Some(n)),
            "limit={q:?}"
        );
    }
    let r = send(&e, &tok, "GET", "/api/racks/ra/audit?limit=1", None).await;
    assert_eq!(ids(&r.body), ["log0005"]);
    // arkyo-server: a non-numeric (or fractional) limit is a 400, not a 500.
    for u in [
        "/api/tenant/projects/p1/audit?limit=abc",
        "/api/tenant/projects/p1/audit?limit=2.5",
        "/api/racks/ra/audit?limit=abc",
    ] {
        let r = send(&e, &tok, "GET", u, None).await;
        assert_eq!(
            (r.status, r.body),
            (
                StatusCode::BAD_REQUEST,
                json!({"error": "Paramètres invalides"})
            ),
            "{u}"
        );
    }
    let r = send(&e, &tok, "GET", "/api/tenant/projects/ghost/audit", None).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({"error": "Project not found"}))
    );

    // Default limits (150 and 100) and the 500 cap.
    let mut tx = e.pool.begin().await.unwrap();
    for n in 100..700u32 {
        let (t, id) = if n % 2 == 0 {
            ("Project", "p1")
        } else {
            ("Rack", "ra")
        };
        sqlx::query(
            r#"INSERT INTO "AuditLog" ("id","userId","action","entityType","entityId","createdAt")
               VALUES (?,?,?,?,?,?)"#,
        )
        .bind(format!("log{n:04}"))
        .bind("u")
        .bind("a")
        .bind(t)
        .bind(id)
        .bind(format!("2026-11-08T00:{:02}:{:02}.000Z", n / 60, n % 60))
        .execute(&mut *tx)
        .await
        .unwrap();
    }
    tx.commit().await.unwrap();
    for (u, n) in [
        ("/api/tenant/projects/p1/audit", 150),
        ("/api/tenant/projects/p1/audit?limit=100000", 500),
        ("/api/racks/ra/audit", 100),
        ("/api/racks/ra/audit?limit=Infinity", 302),
    ] {
        let r = send(&e, &tok, "GET", u, None).await;
        assert_eq!(r.body.as_array().map(Vec::len), Some(n), "{u}");
    }

    // Guards: projects:read.
    exec(
        &e.pool,
        r#"INSERT INTO "Role" ("id","key","label","permissions","createdAt","updatedAt")
           VALUES ('r-none','sans-droits','Sans droits','{}',?,?)"#,
    )
    .await;
    add_user(&e.pool, "n@b.fr", "sans-droits", false).await;
    let none = login(&e.app, "n@b.fr").await;
    add_user(&e.pool, "c@b.fr", "consultation", false).await;
    let ct = login(&e.app, "c@b.fr").await;
    for u in ["/api/tenant/projects/p1/audit", "/api/racks/ra/audit"] {
        let r = send(&e, &none, "GET", u, None).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::FORBIDDEN, json!({"error": "Accès refusé"}))
        );
        let r = send(&e, &ct, "GET", u, None).await;
        assert_eq!(r.status, StatusCode::OK, "{u}");
    }
}
