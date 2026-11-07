//! Phase 4c, Task 3: rack connections (`/api/racks/:id/connections` and
//! `/…/:connId`, arkyo:app/api/racks/[id]/connections/route.ts and
//! `[connId]/route.ts`), and the usage guard of the cable models
//! (`catalogCableModelId` = `TenantCableModel.id`, 4c decision 2).
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
const MODELS: &str = "/api/tenant/parametres/cabling";
const CABLES: &str = "/api/tenant/catalogue/cables";
const NOW: &str = "2026-11-07T10:00:00.000Z";
const CLIENT: &str = "tab-1";
const SLOT_404: &str = "Slot introuvable";
const ADAPTER_404: &str = "Adaptateur introuvable";
const CONN_404: &str = "Connexion introuvable";

fn component_error(id: &str) -> Value {
    json!({"error": format!(
        "fromComponentItemId/toComponentItemId invalide ({id}) : item introuvable, hors rack, ou pas un composant"
    )})
}

struct Ctx {
    e: Env,
    tok: String,
    project: String,
    rack: String,
    other: String,
}

/// A project with racks A (`rack`) and B (`other`).
/// Rack A: inventory host `h1` with its component `c1`, a plain item `i1`;
/// slots `s1` (holds `h1`) and `s2`; synoptic adapter `a1`.
/// Rack B: host `hb` with component `cb`, slot `sb`, adapter `ab`.
async fn ctx() -> Ctx {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    let mut c = Ctx {
        e,
        tok,
        project: String::new(),
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
    c.project = r.body["id"].as_str().unwrap().to_string();
    let r = c
        .send(
            "POST",
            &format!("{LIST}/{}/locations", c.project),
            Some(json!({"name": "Plateau"})),
        )
        .await;
    let loc = r.body["id"].as_str().unwrap().to_string();
    let r = c
        .send(
            "POST",
            &format!("{LIST}/{}/racks", c.project),
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
    for (id, rack, host) in [
        ("h1", &c.rack, "NULL"),
        ("c1", &c.rack, "'h1'"),
        ("i1", &c.rack, "NULL"),
        ("hb", &c.other, "NULL"),
        ("cb", &c.other, "'hb'"),
    ] {
        exec(
            pool,
            &format!(
                r#"INSERT INTO "RackInventoryItem" ("id","rackId","hostItemId","createdAt","updatedAt") VALUES ('{id}','{rack}',{host},?,?)"#
            ),
        )
        .await;
    }
    for (id, rack, item) in [
        ("s1", &c.rack, "'h1'"),
        ("s2", &c.rack, "NULL"),
        ("sb", &c.other, "'hb'"),
    ] {
        exec(
            pool,
            &format!(
                r#"INSERT INTO "RackSlot" ("id","rackId","inventoryItemId","createdAt","updatedAt") VALUES ('{id}','{rack}',{item},?,?)"#
            ),
        )
        .await;
    }
    for (id, rack) in [("a1", &c.rack), ("ab", &c.other)] {
        exec(
            pool,
            &format!(
                r#"INSERT INTO "SynopticAdapter" ("id","rackId","x","y","createdAt","updatedAt") VALUES ('{id}','{rack}',0,0,?,?)"#
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

    fn url(&self) -> String {
        format!("/api/racks/{}/connections", self.rack)
    }

    fn item(&self, id: &str) -> String {
        format!("/api/racks/{}/connections/{id}", self.rack)
    }

    async fn ok(&self, method: &str, uri: &str, body: Value) -> Value {
        let r = self.send(method, uri, Some(body.clone())).await;
        assert_eq!(
            r.status,
            StatusCode::OK,
            "{method} {uri} {body} → {:?}",
            r.body
        );
        r.body
    }

    /// Asserts `status` and body, and that nothing was written nor announced.
    async fn refused(
        &self,
        rack: &mut RackSubscription,
        method: &str,
        uri: &str,
        body: Option<Value>,
        status: StatusCode,
        expected: Value,
    ) {
        let before = snapshot(&self.e.pool).await;
        let r = self.send(method, uri, body.clone()).await;
        assert_eq!(
            (r.status, r.body),
            (status, expected),
            "{method} {uri} {body:?}"
        );
        assert_eq!(
            snapshot(&self.e.pool).await,
            before,
            "{method} {uri} {body:?}"
        );
        no_rack_event(rack).await;
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
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        cookie: None,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
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

/// The app event `rackConnection action id` with `{rackId, itemId, clientId}`.
fn app_event(rack: &str, action: &str, id: &str) -> Value {
    json!({"type": "update", "entity": "rackConnection", "action": action, "id": id,
           "rackId": rack, "itemId": id, "clientId": CLIENT})
}

/// The batch app event: `id` = rackId, no `itemId`.
fn batch_event(rack: &str, action: &str) -> Value {
    json!({"type": "update", "entity": "rackConnection", "action": action, "id": rack,
           "rackId": rack, "clientId": CLIENT})
}

async fn last_audit(pool: &SqlitePool) -> (String, String, String, Option<String>) {
    sqlx::query_as(
        r#"SELECT "action", "entityType", "entityId", "after" FROM "AuditLog" ORDER BY rowid DESC LIMIT 1"#,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Rows written by these routes.
async fn snapshot(pool: &SqlitePool) -> Vec<i64> {
    let mut out = Vec::new();
    for t in ["RackConnection", "AuditLog"] {
        out.push(int(pool, &format!(r#"SELECT COUNT(*) FROM "{t}""#)).await);
    }
    out.push(
        int(
            pool,
            r#"SELECT COALESCE(SUM(length(COALESCE("label",'')) + length(COALESCE("fromSlotId",'')) + length(COALESCE("toSlotId",'')) + length(COALESCE("fromComponentItemId",'')) + length(COALESCE("toComponentItemId",'')) + length(COALESCE("toAdapterId",''))), 0) FROM "RackConnection""#,
        )
        .await,
    );
    out
}

fn field_errors(fields: Value) -> Value {
    json!({"error": {"formErrors": [], "fieldErrors": fields}})
}

fn ids(list: &Value) -> Vec<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|v| v["id"].as_str().unwrap().to_string())
        .collect()
}

// ── batch create and delete ────────────────────────────────────────────────

#[tokio::test]
async fn batch_create_and_delete() {
    let c = ctx().await;
    let pool = &c.e.pool;
    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    let r = c.send("GET", &c.url(), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!([])));

    // Single create: fields outside `createSchema` are dropped (notes,
    // catalogCableModelId, wired, bundleId), so are the extra keys of a
    // waypoint; no automatic label.
    let one = c
        .ok(
            "POST",
            &c.url(),
            json!({"fromSlotId": "s1", "fromConnectorIndex": 0, "toSlotId": "s2",
                   "toConnectorIndex": 1, "color": "#ff0000", "cableStyle": "curved",
                   "waypoints": [{"x": 1.5, "y": 2, "z": 9}], "notes": "ignorée",
                   "catalogCableModelId": "m", "wired": true, "bundleId": "b"}),
        )
        .await;
    let id1 = one["id"].as_str().unwrap().to_string();
    assert!(id1.len() >= 20, "cuid généré : {id1}");
    assert_eq!(
        one,
        json!({
            "id": id1, "rackId": c.rack,
            "fromSlotId": "s1", "fromConnectorIndex": 0, "fromAdapterId": null,
            "fromAdapterSide": null, "fromAdapterPortIndex": null, "fromComponentItemId": null,
            "toSlotId": "s2", "toConnectorIndex": 1, "toAdapterId": null,
            "toAdapterSide": null, "toAdapterPortIndex": null, "toComponentItemId": null,
            "label": null, "color": "#ff0000", "waypoints": [{"x": 1.5, "y": 2}],
            "cableStyle": "curved", "notes": null, "tags": null, "catalogCableModelId": null,
            "snapshotId": null, "wired": false, "wiredAt": null, "wiredNotes": null,
            "bundleId": null, "createdAt": one["createdAt"].clone()
        })
    );
    assert!(one["createdAt"].as_str().unwrap().ends_with('Z'));
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "connection_added", "connection": one})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "created", &id1)
    );
    assert_eq!(
        last_audit(pool).await,
        (
            "rackConnection.create".into(),
            "RackConnection".into(),
            id1.clone(),
            None
        )
    );

    // Batch create: client id kept, one rack event per cable, one app event.
    let batch = c
        .ok(
            "POST",
            &c.url(),
            json!({"connections": [
                {"id": "cx-0001", "fromSlotId": "s1", "fromConnectorIndex": 1,
                 "toAdapterId": "a1", "toAdapterSide": "left", "toAdapterPortIndex": 0,
                 "label": "C-001"},
                {"fromAdapterId": "a1", "fromAdapterSide": "right", "fromAdapterPortIndex": 0,
                 "toSlotId": "s2", "toConnectorIndex": 3, "waypoints": null}
            ]}),
        )
        .await;
    let created = ids(&batch);
    assert_eq!(created.len(), 2);
    assert_eq!(created[0], "cx-0001");
    assert_eq!(batch[0]["label"], json!("C-001"));
    assert_eq!(batch[0]["toAdapterSide"], json!("left"));
    assert_eq!(batch[1]["label"], Value::Null);
    assert_eq!(batch[1]["waypoints"], Value::Null);
    assert_eq!(batch[1]["fromAdapterId"], json!("a1"));
    for row in batch.as_array().unwrap() {
        assert_eq!(
            next_rack(&mut rack).await,
            json!({"type": "connection_added", "connection": row})
        );
    }
    assert_eq!(next_app(&mut app).await, batch_event(&c.rack, "created"));
    let (action, kind, entity, after) = last_audit(pool).await;
    assert_eq!(
        (action.as_str(), kind.as_str(), entity.as_str()),
        ("rackConnection.createMany", "Rack", c.rack.as_str())
    );
    assert_eq!(
        serde_json::from_str::<Value>(&after.unwrap()).unwrap(),
        json!({"ids": created, "count": 2})
    );

    let r = c.send("GET", &c.url(), None).await;
    assert_eq!(r.status, StatusCode::OK);
    let mut listed = ids(&r.body);
    listed.sort();
    let mut all = vec![id1.clone(), created[0].clone(), created[1].clone()];
    all.sort();
    assert_eq!(listed, all);

    // A client id already taken: 409, nothing of the batch written.
    c.refused(
        &mut rack,
        "POST",
        &c.url(),
        Some(json!({"connections": [
            {"id": "cx-0002", "fromSlotId": "s1"},
            {"id": "cx-0001", "fromSlotId": "s2"}
        ]})),
        StatusCode::CONFLICT,
        json!({"error": "Identifiant déjà utilisé"}),
    )
    .await;

    // PATCH: `null` leaves label, color, notes and the endpoints unchanged
    // (arkyo); `catalogCableModelId`, `waypoints` and `tags` are cleared by
    // `null`; extra keys of a tag are dropped.
    let p = c
        .ok(
            "PATCH",
            &c.item("cx-0001"),
            json!({"label": null, "color": "#00ff00", "notes": "à reprendre",
                   "fromSlotId": null, "catalogCableModelId": "modele-1",
                   "tags": [{"color": "#fff", "text": "Régie", "extra": 1}],
                   "waypoints": [{"x": 0, "y": 0}]}),
        )
        .await;
    assert_eq!(p["label"], json!("C-001"));
    assert_eq!(p["color"], json!("#00ff00"));
    assert_eq!(p["notes"], json!("à reprendre"));
    assert_eq!(p["fromSlotId"], json!("s1"));
    assert_eq!(p["catalogCableModelId"], json!("modele-1"));
    assert_eq!(p["tags"], json!([{"color": "#fff", "text": "Régie"}]));
    assert_eq!(p["waypoints"], json!([{"x": 0, "y": 0}]));
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "connection_updated", "connection": p})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "updated", "cx-0001")
    );
    assert_eq!(
        last_audit(pool).await,
        (
            "rackConnection.update".into(),
            "RackConnection".into(),
            "cx-0001".into(),
            None
        )
    );
    let p = c
        .ok(
            "PATCH",
            &c.item("cx-0001"),
            json!({"label": "C-009", "color": null, "notes": null,
                   "catalogCableModelId": null, "tags": null, "waypoints": null,
                   "toAdapterId": null, "toSlotId": "s2", "toConnectorIndex": -1}),
        )
        .await;
    assert_eq!(p["label"], json!("C-009"));
    assert_eq!(p["color"], json!("#00ff00"));
    assert_eq!(p["notes"], json!("à reprendre"));
    assert_eq!(p["catalogCableModelId"], Value::Null);
    assert_eq!(p["tags"], Value::Null);
    assert_eq!(p["waypoints"], Value::Null);
    // Re-attachment: no `min(0)` on PATCH indices; `toAdapterId: null`
    // leaves the adapter attached (arkyo).
    assert_eq!(p["toAdapterId"], json!("a1"));
    assert_eq!(p["toSlotId"], json!("s2"));
    assert_eq!(p["toConnectorIndex"], json!(-1));
    next_rack(&mut rack).await;
    next_app(&mut app).await;

    // From the other rack's URL: 404, nothing changed.
    let foreign = format!("/api/racks/{}/connections/cx-0001", c.other);
    c.refused(
        &mut rack,
        "PATCH",
        &foreign,
        Some(json!({"label": "X"})),
        StatusCode::NOT_FOUND,
        json!({"error": CONN_404}),
    )
    .await;
    c.refused(
        &mut rack,
        "DELETE",
        &foreign,
        None,
        StatusCode::NOT_FOUND,
        json!({"error": CONN_404}),
    )
    .await;
    let r = c
        .send(
            "DELETE",
            &format!("/api/racks/{}/connections", c.other),
            Some(json!({"ids": ["cx-0001"]})),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::OK, json!({"ok": true, "count": 0}))
    );
    assert_eq!(
        int(pool, r#"SELECT COUNT(*) FROM "RackConnection""#).await,
        3
    );
    while app.try_recv().is_ok() {}

    // Batch delete: one rack event per requested id (unknown ones too),
    // one app event, `{ok, count}`.
    let r = c
        .send(
            "DELETE",
            &c.url(),
            Some(json!({"ids": [created[0], created[1], "fantome"]})),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::OK, json!({"ok": true, "count": 2}))
    );
    for id in [&created[0], &created[1], &"fantome".to_string()] {
        assert_eq!(
            next_rack(&mut rack).await,
            json!({"type": "connection_removed", "connId": id})
        );
    }
    assert_eq!(next_app(&mut app).await, batch_event(&c.rack, "deleted"));
    let (action, kind, entity, after) = last_audit(pool).await;
    assert_eq!(
        (action.as_str(), kind.as_str(), entity.as_str()),
        (
            "rackConnection.deleteMany",
            "RackConnection",
            c.rack.as_str()
        )
    );
    assert_eq!(
        serde_json::from_str::<Value>(&after.unwrap()).unwrap(),
        json!({"ids": [created[0], created[1], "fantome"], "count": 2})
    );

    // Batch delete validation: flatten 400 (an unreadable body is `null`).
    c.refused(
        &mut rack,
        "DELETE",
        &c.url(),
        Some(json!({"ids": []})),
        StatusCode::BAD_REQUEST,
        field_errors(json!({"ids": ["Too small: expected array to have >=1 items"]})),
    )
    .await;
    let r = send_raw(&c, "DELETE", &c.url(), "{oops").await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::BAD_REQUEST,
            json!({"error": {"formErrors": ["Invalid input: expected object, received null"], "fieldErrors": {}}})
        )
    );

    // Single delete.
    let r = c.send("DELETE", &c.item(&id1), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "connection_removed", "connId": id1})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "deleted", &id1)
    );
    assert_eq!(
        last_audit(pool).await,
        (
            "rackConnection.delete".into(),
            "RackConnection".into(),
            id1.clone(),
            None
        )
    );
    c.refused(
        &mut rack,
        "DELETE",
        &c.item(&id1),
        None,
        StatusCode::NOT_FOUND,
        json!({"error": CONN_404}),
    )
    .await;
    assert!(matches!(app.try_recv(), Err(TryRecvError::Empty)));

    // Removing a slot removes its cables, and with them their bundle
    // membership (0004 cascades): no dangling connection.
    for id in ["cx-0003", "cx-0005"] {
        c.ok(
            "POST",
            &c.url(),
            json!({"id": id, "fromSlotId": "s1", "toSlotId": "s2"}),
        )
        .await;
    }
    let b = c
        .ok(
            "POST",
            &format!("/api/racks/{}/bundles", c.rack),
            json!({"name": "Faisceau", "cableIds": ["cx-0003", "cx-0005"]}),
        )
        .await;
    assert_eq!(
        int(
            pool,
            &format!(
                r#"SELECT COUNT(*) FROM "RackConnection" WHERE "bundleId" = '{}'"#,
                b["id"].as_str().unwrap()
            )
        )
        .await,
        2
    );
    exec(pool, r#"DELETE FROM "RackSlot" WHERE "id" = 's2'"#).await;
    assert_eq!(
        int(pool, r#"SELECT COUNT(*) FROM "RackConnection""#).await,
        0
    );

    // Consultation reads but cannot write; no session: 401.
    c.ok(
        "POST",
        &c.url(),
        json!({"id": "cx-0004", "fromSlotId": "s1"}),
    )
    .await;
    add_user(pool, "c@b.fr", "consultation", false).await;
    let ct = login(&c.e.app, "c@b.fr").await;
    let before = snapshot(pool).await;
    for (method, path, body) in [
        ("POST", c.url(), Some(json!({"fromSlotId": "s1"}))),
        ("DELETE", c.url(), Some(json!({"ids": ["cx-0004"]}))),
        ("PATCH", c.item("cx-0004"), Some(json!({"label": "X"}))),
        ("DELETE", c.item("cx-0004"), None),
    ] {
        let r = send_as(&c.e, Some(&ct), method, &path, body.clone()).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::FORBIDDEN, json!({"error": "Accès refusé"})),
            "{method} {path}"
        );
        let r = send_as(&c.e, None, method, &path, body).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{method} {path}");
    }
    let r = send_as(&c.e, Some(&ct), "GET", &c.url(), None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(ids(&r.body), ["cx-0004"]);
    let r = send_as(&c.e, None, "GET", &c.url(), None).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    assert_eq!(snapshot(pool).await, before);
}

// ── components (modular chassis) ───────────────────────────────────────────

#[tokio::test]
async fn component_port_validation() {
    let c = ctx().await;
    let pool = &c.e.pool;
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    // A component port: the host slot stays the anchor.
    let k = c
        .ok(
            "POST",
            &c.url(),
            json!({"fromSlotId": "s1", "fromComponentItemId": "c1", "fromConnectorIndex": 2,
                   "toSlotId": "s2", "toConnectorIndex": 0}),
        )
        .await;
    assert_eq!(k["fromComponentItemId"], json!("c1"));
    assert_eq!(k["fromSlotId"], json!("s1"));
    next_rack(&mut rack).await;
    let kid = k["id"].as_str().unwrap().to_string();

    // `.refine`: a component needs its host slot (truthy on POST).
    c.refused(
        &mut rack,
        "POST",
        &c.url(),
        Some(json!({"fromComponentItemId": "c1", "toComponentItemId": "c1", "toSlotId": ""})),
        StatusCode::BAD_REQUEST,
        field_errors(json!({
            "fromSlotId": ["fromComponentItemId requiert fromSlotId (slot hôte)"],
            "toSlotId": ["toComponentItemId requiert toSlotId (slot hôte)"]
        })),
    )
    .await;
    // The refine only runs on an otherwise valid body (Zod).
    c.refused(
        &mut rack,
        "POST",
        &c.url(),
        Some(json!({"fromComponentItemId": "c1", "fromConnectorIndex": -1})),
        StatusCode::BAD_REQUEST,
        field_errors(json!({"fromConnectorIndex": ["Too small: expected number to be >=0"]})),
    )
    .await;

    // Not a component, of another rack, unknown: arkyo's 400, first bad id.
    for (from, to, bad) in [
        ("i1", "c1", "i1"),
        ("c1", "cb", "cb"),
        ("c1", "nope", "nope"),
        ("h1", "nope", "h1"),
    ] {
        c.refused(
            &mut rack,
            "POST",
            &c.url(),
            Some(json!({"fromSlotId": "s1", "fromComponentItemId": from,
                        "toSlotId": "s1", "toComponentItemId": to})),
            StatusCode::BAD_REQUEST,
            component_error(bad),
        )
        .await;
    }
    // In a batch: the whole batch is refused.
    c.refused(
        &mut rack,
        "POST",
        &c.url(),
        Some(json!({"connections": [
            {"fromSlotId": "s1", "fromComponentItemId": "c1", "toSlotId": "s2"},
            {"fromSlotId": "s2", "toSlotId": "s1", "toComponentItemId": "i1"}
        ]})),
        StatusCode::BAD_REQUEST,
        component_error("i1"),
    )
    .await;
    c.refused(
        &mut rack,
        "POST",
        &c.url(),
        Some(json!({"connections": [
            {"fromSlotId": "s1", "fromComponentItemId": "c1"},
            {"toComponentItemId": "c1"}
        ]})),
        StatusCode::BAD_REQUEST,
        field_errors(json!({
            "connections": ["toComponentItemId requiert toSlotId (slot hôte)"]
        })),
    )
    .await;

    // PATCH: an explicit `null` host slot is refused; an absent one passes.
    c.refused(
        &mut rack,
        "PATCH",
        &c.item(&kid),
        Some(json!({"toComponentItemId": "c1", "toSlotId": null})),
        StatusCode::BAD_REQUEST,
        field_errors(json!({
            "toSlotId": ["toComponentItemId requiert toSlotId (slot hôte) non-null"]
        })),
    )
    .await;
    for bad in ["cb", "i1", "nope"] {
        c.refused(
            &mut rack,
            "PATCH",
            &c.item(&kid),
            Some(json!({"toComponentItemId": bad})),
            StatusCode::BAD_REQUEST,
            component_error(bad),
        )
        .await;
    }
    let p = c
        .ok("PATCH", &c.item(&kid), json!({"toComponentItemId": "c1"}))
        .await;
    assert_eq!(p["toComponentItemId"], json!("c1"));
    assert_eq!(p["toSlotId"], json!("s2"));
    next_rack(&mut rack).await;

    // Removing the component (or its host) removes its cables.
    exec(pool, r#"DELETE FROM "RackInventoryItem" WHERE "id" = 'h1'"#).await;
    assert_eq!(
        int(pool, r#"SELECT COUNT(*) FROM "RackConnection""#).await,
        0
    );
}

// ── invalid endpoints ──────────────────────────────────────────────────────

#[tokio::test]
async fn invalid_port_rejected_nothing_written() {
    let c = ctx().await;
    let mut rack = c.e.events.subscribe_rack(&c.rack);
    let side = r#"Invalid option: expected one of "left"|"right""#;

    // Zod: negative or fractional index, unknown side, malformed waypoints.
    let cases = [
        (
            json!({"fromSlotId": "s1", "fromConnectorIndex": -1}),
            json!({"fromConnectorIndex": ["Too small: expected number to be >=0"]}),
        ),
        (
            json!({"toAdapterId": "a1", "toAdapterPortIndex": 1.5}),
            json!({"toAdapterPortIndex": ["Invalid input: expected int, received number"]}),
        ),
        (
            json!({"fromAdapterId": "a1", "fromAdapterSide": "top"}),
            json!({"fromAdapterSide": [side]}),
        ),
        (
            json!({"fromSlotId": "s1", "waypoints": [{"x": "a"}, 3]}),
            json!({"waypoints": [
                "Invalid input: expected number, received string",
                "Invalid input: expected number, received undefined",
                "Invalid input: expected object, received number"
            ]}),
        ),
        (
            json!({"id": "abc", "fromSlotId": "s1"}),
            json!({"id": ["Too small: expected string to have >=6 characters"]}),
        ),
    ];
    for (body, fields) in cases {
        c.refused(
            &mut rack,
            "POST",
            &c.url(),
            Some(body),
            StatusCode::BAD_REQUEST,
            field_errors(fields),
        )
        .await;
    }

    // arkyo-server: an unknown slot or adapter is a 404 (arkyo: foreign
    // key 500).
    for (body, msg) in [
        (json!({"fromSlotId": "nope", "toSlotId": "s2"}), SLOT_404),
        (
            json!({"fromAdapterId": "nope", "toSlotId": "s2"}),
            ADAPTER_404,
        ),
        (
            json!({"fromSlotId": "s1", "toAdapterId": "nope"}),
            ADAPTER_404,
        ),
    ] {
        c.refused(
            &mut rack,
            "POST",
            &c.url(),
            Some(body),
            StatusCode::NOT_FOUND,
            json!({"error": msg}),
        )
        .await;
    }
    // In a batch: one bad endpoint and nothing of the batch is written.
    c.refused(
        &mut rack,
        "POST",
        &c.url(),
        Some(json!({"connections": [
            {"fromSlotId": "s1", "toSlotId": "s2"},
            {"fromSlotId": "s1", "toSlotId": "nope"}
        ]})),
        StatusCode::NOT_FOUND,
        json!({"error": SLOT_404}),
    )
    .await;
    // arkyo-server: an invalid batch is refused (arkyo fell back to the
    // single schema and created an empty connection).
    c.refused(
        &mut rack,
        "POST",
        &c.url(),
        Some(json!({"connections": [
            {"fromSlotId": "s1", "toSlotId": "s2"},
            {"fromSlotId": "s1", "fromConnectorIndex": -2}
        ]})),
        StatusCode::BAD_REQUEST,
        field_errors(json!({"connections": ["Too small: expected number to be >=0"]})),
    )
    .await;
    c.refused(
        &mut rack,
        "POST",
        &c.url(),
        Some(json!({"connections": []})),
        StatusCode::BAD_REQUEST,
        field_errors(json!({"connections": ["Too small: expected array to have >=1 items"]})),
    )
    .await;
    let r = send_raw(&c, "POST", &c.url(), "{oops").await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::BAD_REQUEST,
            json!({"error": "Corps de requête invalide"})
        )
    );
    // Unknown rack: 404 (arkyo: foreign key 500).
    c.refused(
        &mut rack,
        "POST",
        "/api/racks/nope/connections",
        Some(json!({"label": "X"})),
        StatusCode::NOT_FOUND,
        json!({"error": "Not found"}),
    )
    .await;

    // PATCH: re-attaching to an unknown slot or adapter is refused too.
    let k = c
        .ok(
            "POST",
            &c.url(),
            json!({"id": "cx-0001", "fromSlotId": "s1", "toAdapterId": "a1",
                   "toAdapterSide": "left", "toAdapterPortIndex": 0}),
        )
        .await;
    next_rack(&mut rack).await;
    for (body, status, expected) in [
        (
            json!({"toSlotId": "nope", "toConnectorIndex": 0}),
            StatusCode::NOT_FOUND,
            json!({"error": SLOT_404}),
        ),
        (
            json!({"fromAdapterId": "nope"}),
            StatusCode::NOT_FOUND,
            json!({"error": ADAPTER_404}),
        ),
        (
            json!({"toAdapterSide": "up"}),
            StatusCode::BAD_REQUEST,
            field_errors(json!({"toAdapterSide": [side]})),
        ),
        (
            json!({"notes": "x".repeat(2001)}),
            StatusCode::BAD_REQUEST,
            field_errors(json!({"notes": ["Too big: expected string to have <=2000 characters"]})),
        ),
        (
            json!({"tags": [{"color": "#12345678901234567", "text": 4}]}),
            StatusCode::BAD_REQUEST,
            field_errors(json!({"tags": [
                "Too big: expected string to have <=16 characters",
                "Invalid input: expected string, received number"
            ]})),
        ),
    ] {
        c.refused(
            &mut rack,
            "PATCH",
            &c.item("cx-0001"),
            Some(body),
            status,
            expected,
        )
        .await;
    }
    let r = c.send("GET", &c.url(), None).await;
    assert_eq!(r.body, json!([k]));

    // Another rack's slot or adapter is accepted, as in arkyo: the location
    // view drags an endpoint onto any port of the location and PATCHes the
    // cable's own rack; undo recreates it with the batch POST. The cable
    // stays in its rack.
    let p = c
        .ok(
            "PATCH",
            &c.item("cx-0001"),
            json!({"toSlotId": "sb", "toConnectorIndex": 0, "fromAdapterId": "ab"}),
        )
        .await;
    assert_eq!(
        (&p["rackId"], &p["toSlotId"], &p["fromAdapterId"]),
        (&json!(c.rack), &json!("sb"), &json!("ab"))
    );
    let k2 = c
        .ok(
            "POST",
            &c.url(),
            json!({"connections": [{"fromSlotId": "s1", "toSlotId": "sb"}]}),
        )
        .await;
    assert_eq!(k2[0]["rackId"], json!(c.rack));
}

// ── cable model usage guard (4c decision 2) ────────────────────────────────

#[tokio::test]
async fn cable_model_in_use_guard() {
    let c = ctx().await;
    let pool = &c.e.pool;
    let r = c
        .send("POST", MODELS, Some(json!({"name": "Coax HD-SDI"})))
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let model = r.body["id"].as_str().unwrap().to_string();
    let r = c
        .send("POST", CABLES, Some(json!({"name": "Cordon BNC"})))
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let cable = r.body["id"].as_str().unwrap().to_string();

    // The synoptic stores the cable model (synoptic-cable-model-picker).
    c.ok(
        "POST",
        &c.url(),
        json!({"id": "cx-0001", "fromSlotId": "s1", "toSlotId": "s2"}),
    )
    .await;
    let p = c
        .ok(
            "PATCH",
            &c.item("cx-0001"),
            json!({"catalogCableModelId": model}),
        )
        .await;
    assert_eq!(p["catalogCableModelId"], json!(model));
    exec(
        pool,
        &format!(
            r#"INSERT INTO "ProjectConnection" ("id","projectId","fromRackId","toRackId","catalogCableModelId","createdAt") VALUES ('pc1','{}','{}','{}','{model}',?)"#,
            c.project, c.rack, c.other
        ),
    )
    .await;

    // arkyo-server: the model in use is not deleted (arkyo deleted it and
    // counted TenantCable ids instead).
    let r = c.send("DELETE", &format!("{MODELS}/{model}"), None).await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::CONFLICT,
            json!({
                "error": "Ce modèle de câble est utilisé par 2 connexion(s) et ne peut pas être supprimé.",
                "count": 2,
                "breakdown": {"rackConnections": 1, "projectConnections": 1}
            })
        )
    );
    assert_eq!(
        int(
            pool,
            &format!(r#"SELECT COUNT(*) FROM "TenantCableModel" WHERE "id" = '{model}'"#)
        )
        .await,
        1
    );

    // A catalogue cable is not what connections reference: deleting it is
    // not guarded any more, even with its id in `catalogCableModelId`.
    c.ok(
        "PATCH",
        &c.item("cx-0001"),
        json!({"catalogCableModelId": cable}),
    )
    .await;
    let r = c.send("DELETE", &format!("{CABLES}/{cable}"), None).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::OK, json!({"success": true}))
    );

    // Still used by the project connection; once free, deleted.
    let r = c.send("DELETE", &format!("{MODELS}/{model}"), None).await;
    assert_eq!(r.status, StatusCode::CONFLICT);
    assert_eq!(r.body["count"], json!(1));
    exec(pool, r#"DELETE FROM "ProjectConnection""#).await;
    let r = c.send("DELETE", &format!("{MODELS}/{model}"), None).await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::OK, json!({"success": true}))
    );
}
