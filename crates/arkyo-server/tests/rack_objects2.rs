//! Phase 4c, Task 2: rack external ports, panel rows and synoptic adapters
//! (`/api/racks/:id/{external-ports,panel-rows,adapters}` and
//! `/…/:objectId`, arkyo:app/api/racks/[id]/{external-ports,panel-rows,
//! adapters}/route.ts and their `[externalId]`, `[adapterId]` routes).
mod common;
use std::net::SocketAddr;
use std::time::Duration;

use arkyo_server::events::RackSubscription;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tokio::sync::broadcast::error::TryRecvError;
use tokio::sync::broadcast::Receiver;
use tower::ServiceExt;

const LIST: &str = "/api/tenant/projects";
const NOW: &str = "2026-11-07T10:00:00.000Z";
const CLIENT: &str = "tab-1";
const SLOT_404: &str = "Slot introuvable dans ce rack";

struct Ctx {
    e: Env,
    tok: String,
    rack: String,
    other: String,
}

/// A project with racks A (`rack`) and B (`other`); rack A holds slots
/// `s1` (no panel) and `s2` (panel `pa1`, 2U), rack B holds `sb` (panel
/// `pa1`); catalogue adapter `ad1`.
async fn ctx() -> Ctx {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    let mut c = Ctx {
        e,
        tok,
        rack: String::new(),
        other: String::new(),
    };
    let r = c
        .send(
            "POST",
            LIST,
            Some(json!({"name": "Match", "interventionType": "PRESTATION"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let project = r.body["id"].as_str().unwrap().to_string();
    let r = c
        .send(
            "POST",
            &format!("{LIST}/{project}/locations"),
            Some(json!({"name": "Plateau"})),
        )
        .await;
    let loc = r.body["id"].as_str().unwrap().to_string();
    let r = c
        .send(
            "POST",
            &format!("{LIST}/{project}/racks"),
            Some(json!({"racks": [
                {"name": "Baie A", "locationId": loc},
                {"name": "Baie B", "locationId": loc}
            ]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    c.rack = r.body["racks"][0]["id"].as_str().unwrap().to_string();
    c.other = r.body["racks"][1]["id"].as_str().unwrap().to_string();

    let pool = &c.e.pool;
    exec(
        pool,
        r#"INSERT INTO "Panel" ("id","name","panelType","heightU","createdById","createdAt","updatedAt") VALUES ('pa1','Patch 24 XLR','PATCH',2,'u',?,?)"#,
    )
    .await;
    exec(
        pool,
        r#"INSERT INTO "TenantAdapter" ("id","name","reference","createdById","createdAt","updatedAt") VALUES ('ad1','XLR F → Jack','AD-1','u',?,?)"#,
    )
    .await;
    for (id, rack, panel) in [
        ("s1", &c.rack, "NULL"),
        ("s2", &c.rack, "'pa1'"),
        ("sb", &c.other, "'pa1'"),
    ] {
        exec(
            pool,
            &format!(
                r#"INSERT INTO "RackSlot" ("id","rackId","panelId","createdAt","updatedAt") VALUES ('{id}','{rack}',{panel},?,?)"#
            ),
        )
        .await;
    }
    c
}

impl Ctx {
    /// A request of the owner, with `X-Client-Id: tab-1`.
    async fn send(&self, method: &str, uri: &str, body: Option<Value>) -> Reply {
        send_as(&self.e, Some(&self.tok), method, uri, body).await
    }

    fn url(&self, kind: &str) -> String {
        format!("/api/racks/{}/{kind}", self.rack)
    }

    fn item(&self, kind: &str, id: &str) -> String {
        format!("/api/racks/{}/{kind}/{id}", self.rack)
    }

    async fn create(&self, kind: &str, body: Value) -> Value {
        let r = self.send("POST", &self.url(kind), Some(body.clone())).await;
        assert_eq!(r.status, StatusCode::OK, "{body} → {:?}", r.body);
        r.body
    }
}

async fn send_as(
    e: &Env,
    tok: Option<&str>,
    method: &str,
    uri: &str,
    body: Option<Value>,
) -> Reply {
    let mut b = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-client-id", CLIENT);
    if let Some(t) = tok {
        b = b.header(header::COOKIE, format!("arkyo_session={t}"));
    }
    let mut req = match body {
        Some(v) => b
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(v.to_string())),
        None => b.body(Body::empty()),
    }
    .unwrap();
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

/// A raw body (invalid JSON).
async fn send_raw(c: &Ctx, method: &str, uri: &str, raw: &str) -> Reply {
    let mut req = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::COOKIE, format!("arkyo_session={}", c.tok))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(raw.to_string()))
        .unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(LOCAL.parse::<SocketAddr>().unwrap()));
    let res = c.e.app.clone().oneshot(req).await.unwrap();
    Reply {
        status: res.status(),
        cookie: None,
        body: Value::Null,
    }
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

async fn next_app(rx: &mut Receiver<String>) -> Value {
    let s = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("évènement app attendu")
        .unwrap();
    serde_json::from_str(&s).unwrap()
}

async fn next_rack(rx: &mut RackSubscription) -> Value {
    let s = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("évènement rack attendu")
        .unwrap();
    serde_json::from_str(&s).unwrap()
}

async fn no_rack_event(rx: &mut RackSubscription) {
    assert!(
        tokio::time::timeout(Duration::from_millis(50), rx.recv())
            .await
            .is_err(),
        "aucun évènement rack attendu"
    );
}

/// The app event `entity action id` with arkyo's per-rack meta.
fn app_event(rack: &str, entity: &str, action: &str, id: &str) -> Value {
    json!({"type": "update", "entity": entity, "action": action, "id": id,
           "rackId": rack, "itemId": id, "clientId": CLIENT})
}

async fn last_audit(pool: &SqlitePool) -> (String, String, String) {
    sqlx::query_as(
        r#"SELECT "action", "entityType", "entityId" FROM "AuditLog" ORDER BY rowid DESC LIMIT 1"#,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Rows written by any of these routes.
async fn snapshot(pool: &SqlitePool) -> Vec<i64> {
    let mut out = Vec::new();
    for t in [
        "ExternalPort",
        "RackSlotPanelRow",
        "SynopticAdapter",
        "RackConnection",
        "AuditLog",
    ] {
        out.push(int(pool, &format!(r#"SELECT COUNT(*) FROM "{t}""#)).await);
    }
    out
}

fn field_errors(fields: Value) -> Value {
    json!({"error": {"formErrors": [], "fieldErrors": fields}})
}

/// Asserts a 400 with `flatten()`'s `fieldErrors`.
async fn invalid(c: &Ctx, method: &str, uri: &str, body: Value, fields: Value) {
    let r = c.send(method, uri, Some(body)).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::BAD_REQUEST, field_errors(fields)),
        "{method} {uri}"
    );
}

async fn not_found(c: &Ctx, method: &str, uri: &str, body: Option<Value>, msg: &str) {
    let r = c.send(method, uri, body).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({ "error": msg })),
        "{method} {uri}"
    );
}

fn ids(list: &Value) -> Vec<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|v| v["id"].as_str().unwrap().to_string())
        .collect()
}

// ── external ports ─────────────────────────────────────────────────────────

#[tokio::test]
async fn external_port_kinds() {
    let c = ctx().await;
    let pool = &c.e.pool;
    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack(&c.rack);
    const KIND_MSG: &str = r#"Invalid option: expected one of "INTER_LIEU"|"MONDE""#;

    let r = c.send("GET", &c.url("external-ports"), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!([])));

    // Default kind INTER_LIEU, null label and position.
    let p1 = c
        .create("external-ports", json!({"slotId": "s1", "portIndex": 0}))
        .await;
    let id1 = p1["id"].as_str().unwrap().to_string();
    assert!(id1.len() >= 20, "cuid généré : {id1}");
    assert_eq!(p1["rackId"], json!(c.rack));
    assert_eq!(p1["slotId"], json!("s1"));
    assert_eq!(p1["portIndex"], json!(0));
    assert_eq!(p1["kind"], json!("INTER_LIEU"));
    for k in ["labelX", "labelY", "label"] {
        assert_eq!(p1[k], Value::Null, "{k}");
    }
    assert!(p1["createdAt"].as_str().unwrap().ends_with('Z'));
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "external_port_added", "externalPort": p1})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "external_port", "created", &id1)
    );
    assert_eq!(
        last_audit(pool).await,
        (
            "externalPort.create".into(),
            "ExternalPort".into(),
            id1.clone()
        )
    );

    // MONDE, on a panel slot, with a label.
    let p2 = c
        .create(
            "external-ports",
            json!({"slotId": "s2", "portIndex": 3, "kind": "MONDE", "label": "Car régie",
                   "labelX": 12.5, "labelY": null, "id": "ignored-client-id"}),
        )
        .await;
    let id2 = p2["id"].as_str().unwrap().to_string();
    assert_ne!(id2, "ignored-client-id", "pas d'id client ici");
    assert_eq!(p2["kind"], json!("MONDE"));
    assert_eq!(p2["label"], json!("Car régie"));
    assert_eq!(p2["labelX"].as_f64(), Some(12.5));
    assert_eq!(p2["labelY"], Value::Null);
    next_rack(&mut rack).await;
    next_app(&mut app).await;

    // Validation, conflicts and foreign slots: nothing written.
    let before = snapshot(pool).await;
    invalid(
        &c,
        "POST",
        &c.url("external-ports"),
        json!({"slotId": "", "portIndex": -1, "kind": "SATELLITE", "label": 3}),
        json!({
            "slotId": ["Too small: expected string to have >=1 characters"],
            "portIndex": ["Too small: expected number to be >=0"],
            "label": ["Invalid input: expected string, received number"],
            "kind": [KIND_MSG],
        }),
    )
    .await;
    invalid(
        &c,
        "POST",
        &c.url("external-ports"),
        json!({"slotId": "s1", "portIndex": 1.5, "kind": "inter_lieu"}),
        json!({
            "portIndex": ["Invalid input: expected int, received number"],
            "kind": [KIND_MSG],
        }),
    )
    .await;
    invalid(
        &c,
        "POST",
        &c.url("external-ports"),
        json!({"slotId": "s1"}),
        json!({"portIndex": ["Invalid input: expected number, received undefined"]}),
    )
    .await;
    let r = send_raw(&c, "POST", &c.url("external-ports"), "{nope").await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = c
        .send(
            "POST",
            &c.url("external-ports"),
            Some(json!({"slotId": "s1", "portIndex": 0, "kind": "MONDE"})),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::CONFLICT,
            json!({"error": "Ce port est déjà marqué comme externe"})
        )
    );
    for (uri, slot) in [
        (c.url("external-ports"), "sb"),
        (c.url("external-ports"), "nope"),
        ("/api/racks/nope/external-ports".to_string(), "s1"),
    ] {
        not_found(
            &c,
            "POST",
            &uri,
            Some(json!({"slotId": slot, "portIndex": 9})),
            SLOT_404,
        )
        .await;
    }
    assert_eq!(snapshot(pool).await, before);
    no_rack_event(&mut rack).await;
    assert!(matches!(app.try_recv(), Err(TryRecvError::Empty)));

    // GET: the rack's ports, oldest first.
    let r = c.send("GET", &c.url("external-ports"), None).await;
    assert_eq!(ids(&r.body), [id1.clone(), id2.clone()]);
    let r = c
        .send(
            "GET",
            &format!("/api/racks/{}/external-ports", c.other),
            None,
        )
        .await;
    assert_eq!(r.body, json!([]));

    // PATCH: INTER_LIEU ↔ MONDE, only the sent fields.
    let r = c
        .send(
            "PATCH",
            &c.item("external-ports", &id1),
            Some(json!({"kind": "MONDE", "labelX": 4, "labelY": 8})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let updated = r.body;
    assert_eq!(updated["kind"], json!("MONDE"));
    assert_eq!(updated["labelX"].as_f64(), Some(4.0));
    assert_eq!(updated["slotId"], json!("s1"));
    assert_eq!(updated["createdAt"], p1["createdAt"]);
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "external_port_updated", "externalPort": updated})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "external_port", "updated", &id1)
    );
    assert_eq!(
        last_audit(pool).await,
        (
            "externalPort.update".into(),
            "ExternalPort".into(),
            id1.clone()
        )
    );
    let r = c
        .send(
            "PATCH",
            &c.item("external-ports", &id1),
            Some(json!({"kind": "INTER_LIEU", "label": null, "portIndex": 1})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["kind"], json!("INTER_LIEU"));
    assert_eq!(r.body["portIndex"], json!(1));
    next_rack(&mut rack).await;
    next_app(&mut app).await;

    let before = snapshot(pool).await;
    invalid(
        &c,
        "PATCH",
        &c.item("external-ports", &id1),
        json!({"kind": "BOTH", "slotId": "", "portIndex": -2, "labelX": "1"}),
        json!({
            "labelX": ["Invalid input: expected number, received string"],
            "slotId": ["Too small: expected string to have >=1 characters"],
            "portIndex": ["Too small: expected number to be >=0"],
            "kind": [KIND_MSG],
        }),
    )
    .await;
    // arkyo-server: an already marked port is a 409 here too (arkyo: P2002,
    // 500), and an unknown slot a 404 (arkyo: foreign key, 500).
    let r = c
        .send(
            "PATCH",
            &c.item("external-ports", &id1),
            Some(json!({"slotId": "s2", "portIndex": 3})),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::CONFLICT,
            json!({"error": "Ce port est déjà marqué comme externe"})
        )
    );
    not_found(
        &c,
        "PATCH",
        &c.item("external-ports", &id1),
        Some(json!({"slotId": "nope"})),
        "Slot introuvable",
    )
    .await;
    // Unknown port, or a port of another rack: 404 (arkyo: P2025, 500).
    let other = format!("/api/racks/{}/external-ports/{id1}", c.other);
    for uri in [c.item("external-ports", "nope"), other] {
        not_found(
            &c,
            "PATCH",
            &uri,
            Some(json!({"kind": "MONDE"})),
            "Port externe introuvable",
        )
        .await;
        not_found(&c, "DELETE", &uri, None, "Port externe introuvable").await;
    }
    assert_eq!(snapshot(pool).await, before);
    no_rack_event(&mut rack).await;

    // A slot of another rack of the location is accepted, as in arkyo (the
    // location view drags the bubble onto any free port); the port keeps its
    // `rackId`, so its rack's routes still reach it.
    let r = c
        .send(
            "PATCH",
            &c.item("external-ports", &id1),
            Some(json!({"slotId": "sb", "portIndex": 7})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let moved = r.body;
    assert_eq!(moved["slotId"], json!("sb"));
    assert_eq!(moved["portIndex"], json!(7));
    assert_eq!(moved["rackId"], json!(c.rack), "rackId inchangé");
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "external_port_updated", "externalPort": moved})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "external_port", "updated", &id1)
    );
    let r = c.send("GET", &c.url("external-ports"), None).await;
    assert_eq!(ids(&r.body), [id1.clone(), id2.clone()]);

    // DELETE.
    let r = c
        .send("DELETE", &c.item("external-ports", &id1), None)
        .await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "external_port_removed", "externalPortId": id1})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "external_port", "deleted", &id1)
    );
    assert_eq!(
        last_audit(pool).await,
        (
            "externalPort.delete".into(),
            "ExternalPort".into(),
            id1.clone()
        )
    );

    // A removed slot takes its external ports; the CHECK refuses any other
    // kind, even written directly.
    exec(pool, r#"DELETE FROM "RackSlot" WHERE "id" = 's2'"#).await;
    assert_eq!(int(pool, r#"SELECT COUNT(*) FROM "ExternalPort""#).await, 0);
    let bad = sqlx::query(
        r#"INSERT INTO "ExternalPort" ("id","rackId","slotId","portIndex","kind","createdAt","updatedAt") VALUES ('x',?,'s1',0,'AUTRE',?,?)"#,
    )
    .bind(&c.rack)
    .bind(NOW)
    .bind(NOW)
    .execute(pool)
    .await;
    assert!(bad.is_err(), "CHECK kind");
}

// ── panel rows ─────────────────────────────────────────────────────────────

async fn row_count(pool: &SqlitePool, slot: &str) -> i64 {
    int(
        pool,
        &format!(r#"SELECT COUNT(*) FROM "RackSlotPanelRow" WHERE "slotId" = '{slot}'"#),
    )
    .await
}

#[tokio::test]
async fn panel_rows_get_purges_like_arkyo() {
    let c = ctx().await;
    let pool = &c.e.pool;
    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    let r = c.send("GET", &c.url("panel-rows"), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!([])));

    // POST upserts on (slotId, rowIndex).
    let row0 = c
        .create(
            "panel-rows",
            json!({"slotId": "s2", "rowIndex": 0, "x": 10, "y": 20.5}),
        )
        .await;
    let id0 = row0["id"].as_str().unwrap().to_string();
    let mut keys: Vec<&str> = row0
        .as_object()
        .unwrap()
        .keys()
        .map(|k| k.as_str())
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "createdAt",
            "id",
            "rowIndex",
            "slotId",
            "synopticX",
            "synopticY",
            "updatedAt"
        ]
    );
    assert_eq!(row0["slotId"], json!("s2"));
    assert_eq!(row0["rowIndex"], json!(0));
    assert_eq!(row0["synopticX"].as_f64(), Some(10.0));
    assert_eq!(row0["synopticY"].as_f64(), Some(20.5));
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "panelrow_updated", "slotId": "s2", "rowIndex": 0, "x": 10, "y": 20.5})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "rackSlotPanelRow", "updated", &id0)
    );
    assert_eq!(
        last_audit(pool).await,
        (
            "rackSlotPanelRow.upsert".into(),
            "RackSlotPanelRow".into(),
            id0.clone()
        )
    );
    let again = c
        .create(
            "panel-rows",
            json!({"slotId": "s2", "rowIndex": 0, "x": 30, "y": 40}),
        )
        .await;
    assert_eq!(again["id"], json!(id0), "même ligne");
    assert_eq!(again["synopticX"].as_f64(), Some(30.0));
    assert_eq!(again["createdAt"], row0["createdAt"]);
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "panelrow_updated", "slotId": "s2", "rowIndex": 0, "x": 30, "y": 40})
    );
    next_app(&mut app).await;
    assert_eq!(row_count(pool, "s2").await, 1);

    // arkyo accepts rows past the panel height or on a slot without panel;
    // the next GET purges them.
    let row1 = c
        .create(
            "panel-rows",
            json!({"slotId": "s2", "rowIndex": 1, "x": 0, "y": 0}),
        )
        .await;
    c.create(
        "panel-rows",
        json!({"slotId": "s2", "rowIndex": 2, "x": 0, "y": 0}),
    )
    .await;
    c.create(
        "panel-rows",
        json!({"slotId": "s1", "rowIndex": 0, "x": 0, "y": 0}),
    )
    .await;
    for _ in 0..3 {
        next_rack(&mut rack).await;
        next_app(&mut app).await;
    }
    // A row of rack B stays out of rack A's purge.
    exec(
        pool,
        r#"INSERT INTO "RackSlotPanelRow" ("id","slotId","rowIndex","synopticX","synopticY","createdAt","updatedAt") VALUES ('rb','sb',5,0,0,?,?)"#,
    )
    .await;

    // Validation and foreign slots: nothing written.
    let before = snapshot(pool).await;
    invalid(
        &c,
        "POST",
        &c.url("panel-rows"),
        json!({"slotId": 1, "rowIndex": -1, "y": "0"}),
        json!({
            "slotId": ["Invalid input: expected string, received number"],
            "rowIndex": ["Too small: expected number to be >=0"],
            "x": ["Invalid input: expected number, received undefined"],
            "y": ["Invalid input: expected number, received string"],
        }),
    )
    .await;
    let r = send_raw(&c, "POST", &c.url("panel-rows"), "]").await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    for (uri, slot) in [
        (c.url("panel-rows"), "sb"),
        (c.url("panel-rows"), "nope"),
        ("/api/racks/nope/panel-rows".to_string(), "s2"),
    ] {
        not_found(
            &c,
            "POST",
            &uri,
            Some(json!({"slotId": slot, "rowIndex": 0, "x": 0, "y": 0})),
            "Slot not found",
        )
        .await;
    }
    assert_eq!(snapshot(pool).await, before);
    no_rack_event(&mut rack).await;

    // GET: rows within the panel height only; the others are deleted, with
    // no audit and no event.
    let audits = int(pool, r#"SELECT COUNT(*) FROM "AuditLog""#).await;
    let r = c.send("GET", &c.url("panel-rows"), None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(
        ids(&r.body),
        [id0.clone(), row1["id"].as_str().unwrap().into()]
    );
    assert_eq!(r.body[0]["synopticX"].as_f64(), Some(30.0));
    assert_eq!(row_count(pool, "s2").await, 2);
    assert_eq!(row_count(pool, "s1").await, 0, "slot sans panel");
    assert_eq!(row_count(pool, "sb").await, 1, "autre rack intact");
    assert_eq!(
        int(pool, r#"SELECT COUNT(*) FROM "AuditLog""#).await,
        audits
    );
    no_rack_event(&mut rack).await;
    assert!(matches!(app.try_recv(), Err(TryRecvError::Empty)));

    // A shorter panel, then a slot that loses its panel.
    exec(
        pool,
        r#"UPDATE "Panel" SET "heightU" = 1 WHERE "id" = 'pa1'"#,
    )
    .await;
    let r = c.send("GET", &c.url("panel-rows"), None).await;
    assert_eq!(ids(&r.body), [id0.as_str()]);
    assert_eq!(row_count(pool, "s2").await, 1);
    exec(
        pool,
        r#"UPDATE "RackSlot" SET "panelId" = NULL WHERE "id" = 's2'"#,
    )
    .await;
    let r = c.send("GET", &c.url("panel-rows"), None).await;
    assert_eq!(r.body, json!([]));
    assert_eq!(row_count(pool, "s2").await, 0);
    assert_eq!(row_count(pool, "sb").await, 1, "autre rack intact");

    // A removed slot takes its rows (ON DELETE CASCADE).
    exec(pool, r#"DELETE FROM "RackSlot" WHERE "id" = 'sb'"#).await;
    assert_eq!(
        int(pool, r#"SELECT COUNT(*) FROM "RackSlotPanelRow""#).await,
        0
    );

    let r = send_as(&c.e, None, "GET", &c.url("panel-rows"), None).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
}

// ── adapters ───────────────────────────────────────────────────────────────

fn ad1() -> Value {
    json!({"id": "ad1", "name": "XLR F → Jack", "reference": "AD-1", "imageUrl": null,
           "inputs": [], "outputs": [], "notes": null, "source": "PERSONAL"})
}

#[tokio::test]
async fn adapter_crud_enriched() {
    let c = ctx().await;
    let pool = &c.e.pool;
    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack(&c.rack);
    const SIDE_MSG: &str = r#"Invalid option: expected one of "left"|"right""#;

    let r = c.send("GET", &c.url("adapters"), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!([])));

    // POST: `adapterId` → `catalogAdapterId`, auto label, enriched answer.
    let a1 = c
        .create("adapters", json!({"adapterId": "ad1", "x": 10, "y": 20}))
        .await;
    let id1 = a1["id"].as_str().unwrap().to_string();
    assert!(id1.len() >= 20, "cuid généré : {id1}");
    assert_eq!(a1["rackId"], json!(c.rack));
    assert_eq!(a1["label"], json!("#ADP1"));
    assert_eq!(a1["catalogAdapterId"], json!("ad1"));
    assert_eq!(a1["adapterId"], json!("ad1"));
    assert_eq!(a1["adapter"], ad1());
    assert_eq!(a1["x"].as_f64(), Some(10.0));
    for k in [
        "snapshotId",
        "attachedSlotId",
        "attachedSide",
        "attachedPortIndex",
        "notes",
    ] {
        assert_eq!(a1[k], Value::Null, "{k}");
    }
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "adapter_added", "adapter": a1})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "synopticAdapter", "created", &id1)
    );
    assert_eq!(
        last_audit(pool).await,
        (
            "synopticAdapter.create".into(),
            "SynopticAdapter".into(),
            id1.clone()
        )
    );

    // A client id, an unknown catalogue adapter (no check, as in arkyo), a
    // slot attachment.
    let a2 = c
        .create(
            "adapters",
            json!({"id": "adp-client-1", "adapterId": "gone", "x": 0, "y": 0,
                   "attachedSlotId": "s1", "attachedSide": "left", "attachedPortIndex": 3,
                   "notes": "Côté jardin"}),
        )
        .await;
    assert_eq!(a2["id"], json!("adp-client-1"));
    assert_eq!(a2["label"], json!("#ADP2"));
    assert_eq!(a2["adapterId"], json!("gone"));
    assert_eq!(a2["adapter"], Value::Null);
    assert_eq!(a2["attachedSlotId"], json!("s1"));
    assert_eq!(a2["attachedSide"], json!("left"));
    assert_eq!(a2["attachedPortIndex"], json!(3));
    assert_eq!(a2["notes"], json!("Côté jardin"));
    next_rack(&mut rack).await;
    next_app(&mut app).await;

    // Validation, duplicate id, foreign slot, unknown rack: nothing written.
    let before = snapshot(pool).await;
    invalid(
        &c,
        "POST",
        &c.url("adapters"),
        json!({"id": "abc", "x": "1", "y": 0, "attachedSide": "top",
               "attachedPortIndex": 1.5, "notes": 3, "label": 5}),
        json!({
            "id": ["Too small: expected string to have >=6 characters"],
            "adapterId": ["Invalid input: expected string, received undefined"],
            "x": ["Invalid input: expected number, received string"],
            "attachedSide": [SIDE_MSG],
            "attachedPortIndex": ["Invalid input: expected int, received number"],
            "notes": ["Invalid input: expected string, received number"],
        }),
    )
    .await;
    let r = send_raw(&c, "POST", &c.url("adapters"), "{").await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = c
        .send(
            "POST",
            &c.url("adapters"),
            Some(json!({"id": "adp-client-1", "adapterId": "ad1", "x": 0, "y": 0})),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::CONFLICT,
            json!({"error": "Identifiant déjà utilisé"})
        )
    );
    not_found(
        &c,
        "POST",
        &c.url("adapters"),
        Some(json!({"adapterId": "ad1", "x": 0, "y": 0, "attachedSlotId": "sb"})),
        SLOT_404,
    )
    .await;
    not_found(
        &c,
        "POST",
        "/api/racks/nope/adapters",
        Some(json!({"adapterId": "ad1", "x": 0, "y": 0})),
        "Not found",
    )
    .await;
    assert_eq!(snapshot(pool).await, before);
    no_rack_event(&mut rack).await;
    assert!(matches!(app.try_recv(), Err(TryRecvError::Empty)));

    // GET: the rack's adapters, enriched.
    let r = c.send("GET", &c.url("adapters"), None).await;
    assert_eq!(r.body, json!([a1, a2]));
    let r = c
        .send("GET", &format!("/api/racks/{}/adapters", c.other), None)
        .await;
    assert_eq!(r.body, json!([]));

    // PATCH: the sent fields, enriched; no audit (as in arkyo).
    let audits = int(pool, r#"SELECT COUNT(*) FROM "AuditLog""#).await;
    let r = c
        .send(
            "PATCH",
            &c.item("adapters", &id1),
            Some(json!({"label": "AD-A", "x": 55.5, "attachedSlotId": "s2",
                        "attachedSide": "right", "notes": null, "adapterId": "gone"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let updated = r.body;
    assert_eq!(updated["label"], json!("AD-A"));
    assert_eq!(updated["x"].as_f64(), Some(55.5));
    assert_eq!(updated["y"].as_f64(), Some(20.0));
    assert_eq!(updated["attachedSlotId"], json!("s2"));
    assert_eq!(updated["attachedSide"], json!("right"));
    assert_eq!(
        updated["adapterId"],
        json!("ad1"),
        "adapterId non modifiable"
    );
    assert_eq!(updated["adapter"], ad1());
    assert_eq!(updated["createdAt"], a1["createdAt"]);
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "adapter_updated", "adapter": updated})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "synopticAdapter", "updated", &id1)
    );
    assert_eq!(
        int(pool, r#"SELECT COUNT(*) FROM "AuditLog""#).await,
        audits
    );
    let r = c
        .send(
            "PATCH",
            &c.item("adapters", &id1),
            Some(json!({"attachedSlotId": null, "attachedSide": null, "label": null})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["attachedSlotId"], Value::Null);
    assert_eq!(r.body["label"], Value::Null);
    next_rack(&mut rack).await;
    next_app(&mut app).await;

    let before = snapshot(pool).await;
    invalid(
        &c,
        "PATCH",
        &c.item("adapters", &id1),
        json!({"x": null, "attachedSide": "up", "attachedPortIndex": "2"}),
        json!({
            "x": ["Invalid input: expected number, received null"],
            "attachedSide": [SIDE_MSG],
            "attachedPortIndex": ["Invalid input: expected number, received string"],
        }),
    )
    .await;
    not_found(
        &c,
        "PATCH",
        &c.item("adapters", &id1),
        Some(json!({"attachedSlotId": "sb"})),
        SLOT_404,
    )
    .await;
    // Unknown adapter, or an adapter of another rack: 404 (arkyo: P2025,
    // or the other rack's adapter was changed).
    let other = format!("/api/racks/{}/adapters/{id1}", c.other);
    for uri in [c.item("adapters", "nope"), other] {
        not_found(
            &c,
            "PATCH",
            &uri,
            Some(json!({"x": 1})),
            "Adaptateur introuvable",
        )
        .await;
        not_found(&c, "DELETE", &uri, None, "Adaptateur introuvable").await;
    }
    assert_eq!(snapshot(pool).await, before);
    no_rack_event(&mut rack).await;

    // The catalogue adapter is in use while a synoptic adapter points at it.
    let cat = "/api/tenant/catalogue/adapters/ad1";
    let r = c.send("DELETE", cat, None).await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::CONFLICT,
            json!({"error": "Utilisé dans 1 synoptique(s) ou inventaire(s) — suppression impossible",
                   "usageCount": 1})
        )
    );
    while app.try_recv().is_ok() {}

    // DELETE; the auto label counts rows, so it can repeat (as in arkyo).
    let r = c.send("DELETE", &c.item("adapters", &id1), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "adapter_removed", "adapterId": id1})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "synopticAdapter", "deleted", &id1)
    );
    assert_eq!(
        last_audit(pool).await,
        (
            "synopticAdapter.delete".into(),
            "SynopticAdapter".into(),
            id1.clone()
        )
    );
    let a3 = c
        .create("adapters", json!({"adapterId": "gone", "x": 0, "y": 0}))
        .await;
    assert_eq!(a3["label"], json!("#ADP2"), "doublon possible, comme arkyo");
    let r = c.send("DELETE", cat, None).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
}

#[tokio::test]
async fn adapter_delete_cascades_connections() {
    let c = ctx().await;
    let pool = &c.e.pool;
    let adp = c
        .create(
            "adapters",
            json!({"id": "adp-1x", "adapterId": "ad1", "x": 0, "y": 0, "attachedSlotId": "s1"}),
        )
        .await;
    assert_eq!(adp["id"], json!("adp-1x"));
    // k1: s1 → adapter, k2: adapter → s2, k3: s1 → s2, k4: rack B.
    for (id, rack, cols, vals) in [
        (
            "k1",
            &c.rack,
            r#""fromSlotId","toAdapterId""#,
            "'s1','adp-1x'",
        ),
        (
            "k2",
            &c.rack,
            r#""fromAdapterId","toSlotId""#,
            "'adp-1x','s2'",
        ),
        ("k3", &c.rack, r#""fromSlotId","toSlotId""#, "'s1','s2'"),
        ("k4", &c.other, r#""fromSlotId","toSlotId""#, "'sb','sb'"),
    ] {
        exec(
            pool,
            &format!(
                r#"INSERT INTO "RackConnection" ("id","rackId",{cols},"createdAt") VALUES ('{id}','{rack}',{vals},?)"#
            ),
        )
        .await;
    }
    let bundle = c
        .create(
            "bundles",
            json!({"name": "Faisceau", "cableIds": ["k1", "k2", "k3"]}),
        )
        .await;
    let bid = bundle["id"].as_str().unwrap().to_string();
    let members = || async {
        int(
            pool,
            &format!(r#"SELECT COUNT(*) FROM "RackConnection" WHERE "bundleId" = '{bid}'"#),
        )
        .await
    };
    assert_eq!(members().await, 3);

    // From another rack's URL: 404, nothing removed.
    let r = c
        .send(
            "DELETE",
            &format!("/api/racks/{}/adapters/adp-1x", c.other),
            None,
        )
        .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(
        int(pool, r#"SELECT COUNT(*) FROM "RackConnection""#).await,
        4
    );

    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack(&c.rack);
    let r = c.send("DELETE", &c.item("adapters", "adp-1x"), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));

    // Both cables of the adapter are gone, with their bundle membership;
    // the bundle and the other cables stay.
    let left: Vec<String> =
        sqlx::query_scalar(r#"SELECT "id" FROM "RackConnection" ORDER BY "id""#)
            .fetch_all(pool)
            .await
            .unwrap();
    assert_eq!(left, ["k3", "k4"]);
    assert_eq!(members().await, 1);
    assert_eq!(
        int(
            pool,
            r#"SELECT COUNT(*) FROM "RackConnection" c WHERE c."bundleId" IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM "CableBundle" b WHERE b."id" = c."bundleId")"#
        )
        .await,
        0,
        "aucun membre orphelin"
    );
    assert_eq!(
        int(
            pool,
            r#"SELECT COUNT(*) FROM "RackConnection" WHERE "fromAdapterId" IS NOT NULL OR "toAdapterId" IS NOT NULL"#
        )
        .await,
        0,
        "aucune connexion pendante"
    );
    assert_eq!(int(pool, r#"SELECT COUNT(*) FROM "CableBundle""#).await, 1);
    assert_eq!(
        int(pool, r#"SELECT COUNT(*) FROM "SynopticAdapter""#).await,
        0
    );

    // One event per bus, no `connection_removed` (as in arkyo).
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "adapter_removed", "adapterId": "adp-1x"})
    );
    no_rack_event(&mut rack).await;
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "synopticAdapter", "deleted", "adp-1x")
    );
    assert!(matches!(app.try_recv(), Err(TryRecvError::Empty)));

    // A removed slot detaches its adapters (SET NULL); a removed rack takes
    // its adapters and external ports.
    c.create(
        "adapters",
        json!({"id": "adp-2x", "adapterId": "ad1", "x": 0, "y": 0, "attachedSlotId": "s2"}),
    )
    .await;
    c.create("external-ports", json!({"slotId": "s1", "portIndex": 0}))
        .await;
    exec(pool, r#"DELETE FROM "RackSlot" WHERE "id" = 's2'"#).await;
    assert_eq!(
        int(
            pool,
            r#"SELECT COUNT(*) FROM "SynopticAdapter" WHERE "attachedSlotId" IS NULL"#
        )
        .await,
        1
    );
    exec(
        pool,
        &format!(r#"DELETE FROM "Rack" WHERE "id" = '{}'"#, c.rack),
    )
    .await;
    for t in ["SynopticAdapter", "ExternalPort"] {
        assert_eq!(
            int(pool, &format!(r#"SELECT COUNT(*) FROM "{t}""#)).await,
            0,
            "{t}"
        );
    }
}

// ── permissions ────────────────────────────────────────────────────────────

#[tokio::test]
async fn consultation_cannot_write() {
    let c = ctx().await;
    let port = c
        .create("external-ports", json!({"slotId": "s1", "portIndex": 0}))
        .await;
    let adp = c
        .create("adapters", json!({"adapterId": "ad1", "x": 0, "y": 0}))
        .await;
    add_user(&c.e.pool, "c@b.fr", "consultation", false).await;
    let ct = login(&c.e.app, "c@b.fr").await;
    let before = snapshot(&c.e.pool).await;
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    let port_item = c.item("external-ports", port["id"].as_str().unwrap());
    let adp_item = c.item("adapters", adp["id"].as_str().unwrap());
    let calls = [
        (
            "POST",
            c.url("external-ports"),
            Some(json!({"slotId": "s1", "portIndex": 1})),
        ),
        ("PATCH", port_item.clone(), Some(json!({"kind": "MONDE"}))),
        ("DELETE", port_item, None),
        (
            "POST",
            c.url("panel-rows"),
            Some(json!({"slotId": "s2", "rowIndex": 0, "x": 0, "y": 0})),
        ),
        (
            "POST",
            c.url("adapters"),
            Some(json!({"adapterId": "ad1", "x": 0, "y": 0})),
        ),
        ("PATCH", adp_item.clone(), Some(json!({"x": 1}))),
        ("DELETE", adp_item, None),
    ];
    for (method, path, body) in &calls {
        let r = send_as(&c.e, Some(&ct), method, path, body.clone()).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::FORBIDDEN, json!({"error": "Accès refusé"})),
            "{method} {path}"
        );
        let r = send_as(&c.e, None, method, path, body.clone()).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{method} {path}");
    }
    // Reading only needs a session.
    for kind in ["external-ports", "panel-rows", "adapters"] {
        let r = send_as(&c.e, Some(&ct), "GET", &c.url(kind), None).await;
        assert_eq!(r.status, StatusCode::OK, "GET {kind}");
        let r = send_as(&c.e, None, "GET", &c.url(kind), None).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "GET {kind}");
    }
    assert_eq!(snapshot(&c.e.pool).await, before);
    no_rack_event(&mut rack).await;

    // A project manager (design:write) can.
    add_user(&c.e.pool, "p@b.fr", "chef-projet", false).await;
    let pt = login(&c.e.app, "p@b.fr").await;
    let r = send_as(
        &c.e,
        Some(&pt),
        "POST",
        &c.url("panel-rows"),
        Some(json!({"slotId": "s2", "rowIndex": 0, "x": 0, "y": 0})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
}
