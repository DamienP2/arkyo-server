//! Phase 4c, Task 1: rack zones, labels and cable bundles
//! (`/api/racks/:id/{zones,labels,bundles}` and `/…/:objectId`,
//! arkyo:app/api/racks/[id]/{zones,labels,bundles}/route.ts and their
//! `[zoneId]`, `[labelId]`, `[bundleId]` routes).
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

struct Ctx {
    e: Env,
    tok: String,
    rack: String,
    other: String,
}

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
    for t in ["RackZone", "RackLabel", "CableBundle", "AuditLog"] {
        out.push(int(pool, &format!(r#"SELECT COUNT(*) FROM "{t}""#)).await);
    }
    out.push(
        int(
            pool,
            r#"SELECT COUNT(*) FROM "RackConnection" WHERE "bundleId" IS NOT NULL"#,
        )
        .await,
    );
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

// ── zones ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn zone_crud_and_events() {
    let c = ctx().await;
    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    let r = c.send("GET", &c.url("zones"), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!([])));

    // Zod and Prisma defaults.
    let zone = c
        .create("zones", json!({"x": 10, "y": 20.5, "w": 300, "h": 200}))
        .await;
    let id = zone["id"].as_str().unwrap().to_string();
    assert!(id.len() >= 20, "cuid généré : {id}");
    assert_eq!(zone["rackId"], json!(c.rack));
    assert_eq!(zone["label"], json!("Zone"));
    assert_eq!(zone["labelPosition"], json!("top-left"));
    assert_eq!(zone["color"], json!("#6366f1"));
    assert_eq!(zone["x"].as_f64(), Some(10.0));
    assert_eq!(zone["y"].as_f64(), Some(20.5));
    assert_eq!(zone["w"].as_f64(), Some(300.0));
    assert_eq!(zone["h"].as_f64(), Some(200.0));
    assert_eq!(zone["borderRadius"], json!(8));
    assert_eq!(zone["borderWidth"], json!(2));
    assert_eq!(zone["borderStyle"], json!("solid"));
    assert_eq!(zone["opacity"].as_f64(), Some(0.12));
    assert_eq!(zone["labelFontSize"], json!(12));
    assert_eq!(zone["labelFontWeight"], json!("normal"));
    assert_eq!(zone["labelFontStyle"], json!("normal"));
    assert_eq!(zone["labelTextDecoration"], json!("none"));
    assert_eq!(zone["labelFontFamily"], Value::Null);
    assert!(zone["createdAt"].as_str().unwrap().ends_with('Z'));
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "zone_added", "zone": zone})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "rackZone", "created", &id)
    );
    assert_eq!(
        last_audit(&c.e.pool).await,
        ("rackZone.create".into(), "RackZone".into(), id.clone())
    );

    // A client-supplied id is the primary key (optimistic creation).
    let z2 = c
        .create(
            "zones",
            json!({"id": "zone-client-1", "label": "Régie", "x": 0, "y": 0, "w": 1, "h": 1,
                   "borderStyle": "dashed", "opacity": 0.5, "borderRadius": 24,
                   "labelFontFamily": null, "unknown": 1}),
        )
        .await;
    assert_eq!(z2["id"], json!("zone-client-1"));
    assert_eq!(z2["label"], json!("Régie"));
    assert_eq!(z2["borderStyle"], json!("dashed"));
    assert!(z2.get("unknown").is_none());
    // The same id twice: 409 instead of arkyo's P2002 (500).
    let r = c
        .send(
            "POST",
            &c.url("zones"),
            Some(json!({"id": "zone-client-1", "x": 0, "y": 0, "w": 1, "h": 1})),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (
            StatusCode::CONFLICT,
            json!({"error": "Identifiant déjà utilisé"})
        )
    );

    // Validation: Zod's messages in `flatten()`.
    invalid(
        &c,
        "POST",
        &c.url("zones"),
        json!({"id": "abc", "y": 0, "w": 1, "h": 1, "borderStyle": "wavy", "opacity": 2,
               "borderRadius": 30, "borderWidth": 1.5, "label": null}),
        json!({
            "id": ["Too small: expected string to have >=6 characters"],
            "x": ["Invalid input: expected number, received undefined"],
            "borderStyle": [r#"Invalid option: expected one of "solid"|"dashed"|"dotted""#],
            "opacity": ["Too big: expected number to be <=1"],
            "borderRadius": ["Too big: expected number to be <=24"],
            "borderWidth": ["Invalid input: expected int, received number"],
            "label": ["Invalid input: expected string, received null"],
        }),
    )
    .await;
    invalid(
        &c,
        "POST",
        &c.url("zones"),
        json!({"id": "x".repeat(65), "x": 0, "y": 0, "w": 1, "h": 1}),
        json!({"id": ["Too big: expected string to have <=64 characters"]}),
    )
    .await;
    let r = send_raw(&c, "POST", &c.url("zones"), "{nope").await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    // Unknown rack: 404 instead of arkyo's foreign key 500.
    let r = c
        .send(
            "POST",
            "/api/racks/nope/zones",
            Some(json!({"x": 0, "y": 0, "w": 1, "h": 1})),
        )
        .await;
    assert_eq!(
        (r.status, r.body),
        (StatusCode::NOT_FOUND, json!({"error": "Not found"}))
    );
    next_rack(&mut rack).await;
    while app.try_recv().is_ok() {}

    // GET: the rack's zones, oldest first.
    let r = c.send("GET", &c.url("zones"), None).await;
    let ids: Vec<&str> = r
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|z| z["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [id.as_str(), "zone-client-1"]);
    let r = c
        .send("GET", &format!("/api/racks/{}/zones", c.other), None)
        .await;
    assert_eq!(r.body, json!([]));

    // PATCH: only the sent fields change.
    let r = c
        .send(
            "PATCH",
            &c.item("zones", &id),
            Some(json!({"label": "Plateau", "x": 42, "labelFontFamily": "Inter", "w": null})),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST, "w non nullable");
    let r = c
        .send(
            "PATCH",
            &c.item("zones", &id),
            Some(json!({"label": "Plateau", "x": 42, "labelFontFamily": "Inter"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let updated = r.body;
    assert_eq!(updated["label"], json!("Plateau"));
    assert_eq!(updated["x"].as_f64(), Some(42.0));
    assert_eq!(updated["labelFontFamily"], json!("Inter"));
    assert_eq!(updated["color"], json!("#6366f1"));
    assert_eq!(updated["createdAt"], zone["createdAt"]);
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "zone_updated", "zone": updated})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "rackZone", "updated", &id)
    );
    assert_eq!(
        last_audit(&c.e.pool).await,
        ("rackZone.update".into(), "RackZone".into(), id.clone())
    );
    invalid(
        &c,
        "PATCH",
        &c.item("zones", &id),
        json!({"borderWidth": 7}),
        json!({"borderWidth": ["Too big: expected number to be <=6"]}),
    )
    .await;

    // Unknown zone, or a zone of another rack: 404 (arkyo: P2025, 500).
    let other = format!("/api/racks/{}/zones/{id}", c.other);
    for uri in [c.item("zones", "nope"), other.clone()] {
        let r = c.send("PATCH", &uri, Some(json!({"x": 1}))).await;
        assert_eq!(
            (r.status, r.body),
            (StatusCode::NOT_FOUND, json!({"error": "Zone introuvable"})),
            "{uri}"
        );
        let r = c.send("DELETE", &uri, None).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{uri}");
    }
    no_rack_event(&mut rack).await;
    assert!(matches!(app.try_recv(), Err(TryRecvError::Empty)));

    // DELETE.
    let r = c.send("DELETE", &c.item("zones", &id), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "zone_removed", "zoneId": id})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "rackZone", "deleted", &id)
    );
    assert_eq!(
        last_audit(&c.e.pool).await,
        ("rackZone.delete".into(), "RackZone".into(), id.clone())
    );
    let r = c.send("DELETE", &c.item("zones", &id), None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    let r = c.send("GET", &c.url("zones"), None).await;
    assert_eq!(r.body.as_array().unwrap().len(), 1);
}

// ── labels ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn label_crud_and_events() {
    let c = ctx().await;
    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    // Zod and Prisma defaults; `width` is not part of the create schema.
    let label = c
        .create("labels", json!({"x": 5, "y": 6, "width": 300}))
        .await;
    let id = label["id"].as_str().unwrap().to_string();
    assert_eq!(label["rackId"], json!(c.rack));
    assert_eq!(label["text"], json!("Libellé"));
    assert_eq!(label["x"].as_f64(), Some(5.0));
    assert_eq!(label["y"].as_f64(), Some(6.0));
    assert_eq!(label["fontSize"], json!(14));
    assert_eq!(label["width"], Value::Null);
    assert_eq!(label["color"], json!("#111827"));
    assert_eq!(label["fontWeight"], json!("normal"));
    assert_eq!(label["fontFamily"], Value::Null);
    assert_eq!(label["fontStyle"], json!("normal"));
    assert_eq!(label["textDecoration"], json!("none"));
    assert_eq!(label["pill"], json!(false));
    assert_eq!(label["pillBg"], Value::Null);
    assert_eq!(label["pillRadius"], json!(12));
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "label_added", "label": label})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "rackLabel", "created", &id)
    );
    assert_eq!(
        last_audit(&c.e.pool).await,
        ("rackLabel.create".into(), "RackLabel".into(), id.clone())
    );

    let l2 = c
        .create(
            "labels",
            json!({"id": "label-client-1", "text": "SORTIES", "x": 0, "y": 0, "pill": true,
                   "pillBg": "#fde68a", "pillRadius": 64, "fontStyle": "italic"}),
        )
        .await;
    assert_eq!(l2["id"], json!("label-client-1"));
    assert_eq!(l2["pill"], json!(true));
    assert_eq!(l2["pillRadius"], json!(64));
    assert_eq!(l2["fontStyle"], json!("italic"));
    next_rack(&mut rack).await;
    next_app(&mut app).await;

    invalid(
        &c,
        "POST",
        &c.url("labels"),
        json!({"x": "1", "fontStyle": "bold", "textDecoration": "line-through",
               "pillRadius": 65, "fontSize": 1.5, "pill": "yes"}),
        json!({
            "x": ["Invalid input: expected number, received string"],
            "y": ["Invalid input: expected number, received undefined"],
            "fontSize": ["Invalid input: expected int, received number"],
            "fontStyle": [r#"Invalid option: expected one of "normal"|"italic""#],
            "textDecoration": [r#"Invalid option: expected one of "none"|"underline""#],
            "pill": ["Invalid input: expected boolean, received string"],
            "pillRadius": ["Too big: expected number to be <=64"],
        }),
    )
    .await;

    let r = c.send("GET", &c.url("labels"), None).await;
    let ids: Vec<&str> = r
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|z| z["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [id.as_str(), "label-client-1"]);

    // PATCH: `width` is accepted here, nullable.
    let r = c
        .send(
            "PATCH",
            &c.item("labels", &id),
            Some(json!({"text": "ENTRÉES", "width": 120.5, "pill": true, "pillBg": null})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    let updated = r.body;
    assert_eq!(updated["text"], json!("ENTRÉES"));
    assert_eq!(updated["width"].as_f64(), Some(120.5));
    assert_eq!(updated["pill"], json!(true));
    assert_eq!(updated["fontSize"], json!(14));
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "label_updated", "label": updated})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "rackLabel", "updated", &id)
    );
    assert_eq!(
        last_audit(&c.e.pool).await,
        ("rackLabel.update".into(), "RackLabel".into(), id.clone())
    );
    let r = c
        .send(
            "PATCH",
            &c.item("labels", &id),
            Some(json!({"width": null})),
        )
        .await;
    assert_eq!(r.body["width"], Value::Null);
    next_rack(&mut rack).await;
    next_app(&mut app).await;

    let other = format!("/api/racks/{}/labels/{id}", c.other);
    for uri in [c.item("labels", "nope"), other] {
        let r = c.send("PATCH", &uri, Some(json!({"x": 1}))).await;
        assert_eq!(
            (r.status, r.body),
            (
                StatusCode::NOT_FOUND,
                json!({"error": "Libellé introuvable"})
            ),
            "{uri}"
        );
        let r = c.send("DELETE", &uri, None).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{uri}");
    }
    let r = send_raw(&c, "PATCH", &c.item("labels", &id), "[").await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    no_rack_event(&mut rack).await;

    let r = c.send("DELETE", &c.item("labels", &id), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "label_removed", "labelId": id})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "rackLabel", "deleted", &id)
    );
    assert_eq!(
        last_audit(&c.e.pool).await,
        ("rackLabel.delete".into(), "RackLabel".into(), id.clone())
    );
}

// ── bundles ────────────────────────────────────────────────────────────────

async fn bundle_of(pool: &SqlitePool, conn: &str) -> Option<String> {
    sqlx::query_scalar(r#"SELECT "bundleId" FROM "RackConnection" WHERE "id" = ?"#)
        .bind(conn)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn bundle_members_validated_and_cascade() {
    let c = ctx().await;
    let pool = &c.e.pool;
    // Rack A: a slot `s1`, cables `c1`..`c3` (`c2` leaves `s1`); rack B:
    // cable `cb`.
    exec(
        pool,
        &format!(
            r#"INSERT INTO "RackSlot" ("id","rackId","createdAt","updatedAt") VALUES ('s1','{}',?,?)"#,
            c.rack
        ),
    )
    .await;
    for (id, rack, from) in [
        ("c1", &c.rack, "NULL"),
        ("c2", &c.rack, "'s1'"),
        ("c3", &c.rack, "NULL"),
        ("cb", &c.other, "NULL"),
    ] {
        exec(
            pool,
            &format!(
                r#"INSERT INTO "RackConnection" ("id","rackId","fromSlotId","createdAt") VALUES ('{id}','{rack}',{from},?)"#
            ),
        )
        .await;
    }
    let mut app = c.e.events.subscribe();
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    // Validation (`flatten()`), nothing written.
    let before = snapshot(pool).await;
    let many: Vec<String> = (0..501).map(|i| format!("c{i}")).collect();
    invalid(
        &c,
        "POST",
        &c.url("bundles"),
        json!({"name": "", "color": "#0123456789abcdef0", "cableIds": many}),
        json!({
            "name": ["Too small: expected string to have >=1 characters"],
            "color": ["Too big: expected string to have <=16 characters"],
            "cableIds": ["Too big: expected array to have <=500 items"],
        }),
    )
    .await;
    invalid(
        &c,
        "POST",
        &c.url("bundles"),
        json!({"name": "x".repeat(121), "cableIds": ["c1", ""], "id": 12}),
        json!({
            "id": ["Invalid input: expected string, received number"],
            "name": ["Too big: expected string to have <=120 characters"],
            "cableIds": ["Too small: expected string to have >=1 characters"],
        }),
    )
    .await;
    assert_eq!(snapshot(pool).await, before);

    // POST: members are the given cables of this rack; others are ignored,
    // as in arkyo (`updateMany where {rackId, id in cableIds}`).
    let bundle = c
        .create(
            "bundles",
            json!({"id": "bundle-client-1", "name": "Faisceau 1",
                   "cableIds": ["c1", "c2", "c3", "cb", "nope"]}),
        )
        .await;
    let id = "bundle-client-1";
    assert_eq!(bundle["id"], json!(id));
    assert_eq!(bundle["rackId"], json!(c.rack));
    assert_eq!(bundle["name"], json!("Faisceau 1"));
    assert_eq!(bundle["color"], json!("#6366f1"));
    assert!(bundle.get("cableIds").is_none());
    for conn in ["c1", "c2", "c3"] {
        assert_eq!(bundle_of(pool, conn).await.as_deref(), Some(id), "{conn}");
    }
    assert_eq!(bundle_of(pool, "cb").await, None, "câble d'un autre rack");
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "bundle_added", "bundle": bundle})
    );
    no_rack_event(&mut rack).await;
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "cableBundle", "created", id)
    );
    assert!(matches!(app.try_recv(), Err(TryRecvError::Empty)));
    assert_eq!(
        last_audit(pool).await,
        ("cableBundle.create".into(), "CableBundle".into(), id.into())
    );

    // A second bundle, generated id and color.
    let b2 = c
        .create("bundles", json!({"name": "Faisceau 2", "color": "#ef4444"}))
        .await;
    let id2 = b2["id"].as_str().unwrap().to_string();
    assert_eq!(b2["color"], json!("#ef4444"));
    next_rack(&mut rack).await;
    next_app(&mut app).await;
    let r = c.send("GET", &c.url("bundles"), None).await;
    let ids: Vec<&str> = r
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [id, id2.as_str()]);

    // PATCH: members move; `removeCableIds` only detaches the bundle's own.
    let r = c
        .send(
            "PATCH",
            &c.item("bundles", &id2),
            Some(json!({"addCableIds": ["c3", "cb"]})),
        )
        .await;
    assert_eq!(
        (r.status, &r.body),
        (StatusCode::OK, &b2),
        "nom et couleur inchangés"
    );
    assert_eq!(bundle_of(pool, "c3").await.as_deref(), Some(id2.as_str()));
    assert_eq!(bundle_of(pool, "cb").await, None);
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "bundle_updated", "bundle": b2})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "cableBundle", "updated", &id2)
    );
    assert_eq!(
        last_audit(pool).await,
        (
            "cableBundle.update".into(),
            "CableBundle".into(),
            id2.clone()
        )
    );
    let r = c
        .send(
            "PATCH",
            &c.item("bundles", id),
            Some(json!({"name": "Faisceau A", "removeCableIds": ["c1", "c3"]})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["name"], json!("Faisceau A"));
    assert_eq!(bundle_of(pool, "c1").await, None);
    assert_eq!(
        bundle_of(pool, "c3").await.as_deref(),
        Some(id2.as_str()),
        "membre d'un autre bundle"
    );
    next_rack(&mut rack).await;
    next_app(&mut app).await;
    invalid(
        &c,
        "PATCH",
        &c.item("bundles", id),
        json!({"name": "", "addCableIds": "c1"}),
        json!({
            "name": ["Too small: expected string to have >=1 characters"],
            "addCableIds": ["Invalid input: expected array, received string"],
        }),
    )
    .await;

    // Unknown bundle, or a bundle of another rack: 404 (arkyo answered
    // `null` 200, or attached this rack's cables to another rack's bundle).
    let other = format!("/api/racks/{}/bundles/{id}", c.other);
    for uri in [c.item("bundles", "nope"), other] {
        let r = c
            .send("PATCH", &uri, Some(json!({"addCableIds": ["c1", "cb"]})))
            .await;
        assert_eq!(
            (r.status, r.body),
            (
                StatusCode::NOT_FOUND,
                json!({"error": "Bundle introuvable"})
            ),
            "{uri}"
        );
        let r = c.send("DELETE", &uri, None).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{uri}");
    }
    assert_eq!(bundle_of(pool, "c1").await, None);
    assert_eq!(bundle_of(pool, "cb").await, None);
    no_rack_event(&mut rack).await;

    // Cascades: a removed slot takes its cables, a removed cable leaves no
    // member behind, a removed bundle frees its cables (SET NULL).
    exec(pool, r#"DELETE FROM "RackSlot" WHERE "id" = 's1'"#).await;
    assert_eq!(
        int(
            pool,
            r#"SELECT COUNT(*) FROM "RackConnection" WHERE "id" = 'c2'"#
        )
        .await,
        0
    );
    let r = c.send("DELETE", &c.item("bundles", &id2), None).await;
    assert_eq!((r.status, r.body), (StatusCode::OK, json!({"ok": true})));
    assert_eq!(bundle_of(pool, "c3").await, None, "SET NULL");
    assert_eq!(
        next_rack(&mut rack).await,
        json!({"type": "bundle_removed", "bundleId": id2})
    );
    assert_eq!(
        next_app(&mut app).await,
        app_event(&c.rack, "cableBundle", "deleted", &id2)
    );
    assert_eq!(
        last_audit(pool).await,
        (
            "cableBundle.delete".into(),
            "CableBundle".into(),
            id2.clone()
        )
    );
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

    // A removed rack takes its zones, labels and bundles.
    c.create("zones", json!({"x": 0, "y": 0, "w": 1, "h": 1}))
        .await;
    c.create("labels", json!({"x": 0, "y": 0})).await;
    exec(
        pool,
        &format!(r#"DELETE FROM "Rack" WHERE "id" = '{}'"#, c.rack),
    )
    .await;
    for t in ["RackZone", "RackLabel", "CableBundle"] {
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
    let zone = c
        .create("zones", json!({"x": 0, "y": 0, "w": 1, "h": 1}))
        .await;
    let label = c.create("labels", json!({"x": 0, "y": 0})).await;
    let bundle = c.create("bundles", json!({"name": "F"})).await;
    add_user(&c.e.pool, "c@b.fr", "consultation", false).await;
    let ct = login(&c.e.app, "c@b.fr").await;
    let before = snapshot(&c.e.pool).await;
    let mut rack = c.e.events.subscribe_rack(&c.rack);

    let mut calls = Vec::new();
    for (kind, obj, create) in [
        ("zones", &zone, json!({"x": 0, "y": 0, "w": 1, "h": 1})),
        ("labels", &label, json!({"x": 0, "y": 0})),
        ("bundles", &bundle, json!({"name": "G"})),
    ] {
        let item = c.item(kind, obj["id"].as_str().unwrap());
        calls.push(("POST", c.url(kind), Some(create)));
        calls.push(("PATCH", item.clone(), Some(json!({"color": "#000000"}))));
        calls.push(("DELETE", item, None));

        // Reading only needs a session.
        let r = send_as(&c.e, Some(&ct), "GET", &c.url(kind), None).await;
        assert_eq!(r.status, StatusCode::OK, "GET {kind}");
        assert_eq!(r.body.as_array().unwrap().len(), 1, "GET {kind}");
        let r = send_as(&c.e, None, "GET", &c.url(kind), None).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "GET {kind}");
    }
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
    assert_eq!(snapshot(&c.e.pool).await, before);
    no_rack_event(&mut rack).await;

    // A project manager (design:write) can.
    add_user(&c.e.pool, "p@b.fr", "chef-projet", false).await;
    let pt = login(&c.e.app, "p@b.fr").await;
    let r = send_as(
        &c.e,
        Some(&pt),
        "PATCH",
        &c.item("zones", zone["id"].as_str().unwrap()),
        Some(json!({"color": "#000000"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
}
