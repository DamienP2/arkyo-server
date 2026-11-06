mod common;
use std::net::SocketAddr;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use serde_json::json;
use tower::ServiceExt;

fn events_request(cookie: Option<&str>) -> Request<Body> {
    let mut b = Request::builder().method("GET").uri("/api/events");
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, format!("arkyo_session={c}"));
    }
    let mut req = b.body(Body::empty()).unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(LOCAL.parse::<SocketAddr>().unwrap()));
    req
}

#[tokio::test]
async fn events_streams_connected_first() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;

    let res = e
        .app
        .clone()
        .oneshot(events_request(Some(&tok)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get(header::CONTENT_TYPE).unwrap(),
        "text/event-stream"
    );
    assert_eq!(
        res.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-cache, no-transform"
    );
    let mut body = res.into_body();
    let frame = body.frame().await.unwrap().unwrap();
    let chunk = frame.into_data().unwrap();
    assert_eq!(&chunk[..], b"data: {\"type\":\"connected\"}\n\n");
}

#[tokio::test]
async fn events_requires_auth() {
    let e = env().await;
    let res = e.app.clone().oneshot(events_request(None)).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn locale_without_session_sets_cookie_only() {
    // Comme arkyo:app/api/platform/locale/route.ts : le sélecteur de langue de
    // la page de connexion fonctionne sans session.
    let e = env().await;
    let r = call(
        &e.app,
        "POST",
        "/api/platform/locale",
        LOCAL,
        None,
        Some(json!({"locale": "en"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body, json!({"ok": true}));
    assert!(r.cookie.unwrap().starts_with("locale=en"));
}

#[tokio::test]
async fn publish_reaches_sse_subscriber() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    let res = e
        .app
        .clone()
        .oneshot(events_request(Some(&tok)))
        .await
        .unwrap();
    let mut body = res.into_body();
    let first = body.frame().await.unwrap().unwrap().into_data().unwrap();
    assert_eq!(&first[..], b"data: {\"type\":\"connected\"}\n\n");

    e.events.publish("tenant_catalogue", "update", Some("abc"));
    e.events.publish("tenant_catalogue", "create", None);
    let a = body.frame().await.unwrap().unwrap().into_data().unwrap();
    let a = String::from_utf8(a.to_vec()).unwrap();
    let json = a.strip_prefix("data: ").unwrap().trim_end();
    let v: serde_json::Value = serde_json::from_str(json).unwrap();
    assert_eq!(
        v,
        json!({"type":"update","entity":"tenant_catalogue","action":"update","id":"abc"})
    );
    let b = body.frame().await.unwrap().unwrap().into_data().unwrap();
    let b: serde_json::Value = serde_json::from_str(
        std::str::from_utf8(&b)
            .unwrap()
            .strip_prefix("data: ")
            .unwrap()
            .trim_end(),
    )
    .unwrap();
    assert_eq!(
        b,
        json!({"type":"update","entity":"tenant_catalogue","action":"create"})
    );
}

#[tokio::test]
async fn publish_without_subscriber_is_harmless() {
    let e = env().await;
    e.events.publish("x", "y", None);
}

#[tokio::test]
async fn audit_row_written() {
    let e = env().await;
    let mut tx = arkyo_server::db::begin_immediate(&e.pool).await.unwrap();
    arkyo_server::audit::log(
        &mut tx,
        "u1",
        "update",
        "TenantBrand",
        "b1",
        None,
        Some(json!({"name": "A"})),
        Some(json!({"name": "B"})),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let row: (String, String, String, Option<String>, Option<String>, Option<String>, String) =
        sqlx::query_as(
            r#"SELECT "userId","action","entityType","projectId","before","after","createdAt" FROM "AuditLog" WHERE "entityId"='b1'"#,
        )
        .fetch_one(&e.pool)
        .await
        .unwrap();
    assert_eq!(
        (row.0.as_str(), row.1.as_str(), row.2.as_str()),
        ("u1", "update", "TenantBrand")
    );
    assert_eq!(row.3, None);
    assert_eq!(row.4.as_deref(), Some(r#"{"name":"A"}"#));
    assert_eq!(row.5.as_deref(), Some(r#"{"name":"B"}"#));
    assert_eq!(row.6.len(), 24);
}

#[tokio::test]
async fn publish_meta_serializes_camel_case() {
    use arkyo_server::events::{EventBus, EventMeta};
    let bus = EventBus::new();
    let mut rx = bus.subscribe();
    bus.publish_meta(
        "rack",
        "updated",
        Some("r1"),
        EventMeta {
            project_id: Some("p".into()),
            client_id: Some("c".into()),
            ..Default::default()
        },
    );
    let v: serde_json::Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
    assert_eq!(
        v,
        json!({"type":"update","entity":"rack","action":"updated","id":"r1","projectId":"p","clientId":"c"})
    );
    bus.publish_meta(
        "project",
        "created",
        None,
        EventMeta {
            rack_id: Some("r".into()),
            item_id: Some("i".into()),
            data: Some(json!({"n": 1})),
            ..Default::default()
        },
    );
    let v: serde_json::Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
    assert_eq!(
        v,
        json!({"type":"update","entity":"project","action":"created","rackId":"r","itemId":"i","data":{"n":1}})
    );
    // Like arkyo's truthy checks: an empty id is omitted.
    bus.publish_meta(
        "x",
        "y",
        None,
        EventMeta {
            project_id: Some(String::new()),
            ..Default::default()
        },
    );
    let v: serde_json::Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
    assert_eq!(v, json!({"type":"update","entity":"x","action":"y"}));
}

#[test]
fn client_id_header_read_and_bounded() {
    use arkyo_server::http::client_id;
    use axum::http::{HeaderMap, HeaderValue};
    let mut h = HeaderMap::new();
    assert_eq!(client_id::read(&h), None);
    let uuid = "0b7e9c1a-3f5d-4c2e-9a8b-1d2e3f4a5b6c";
    h.insert("X-Client-Id", HeaderValue::from_static(uuid));
    assert_eq!(client_id::read(&h).as_deref(), Some(uuid));
    h.insert("x-client-id", HeaderValue::from_static(""));
    assert_eq!(client_id::read(&h), None);
    let long = "a".repeat(client_id::MAX_LEN + 1);
    h.insert("x-client-id", HeaderValue::from_str(&long).unwrap());
    assert_eq!(client_id::read(&h), None);
    let max = "a".repeat(client_id::MAX_LEN);
    h.insert("x-client-id", HeaderValue::from_str(&max).unwrap());
    assert_eq!(client_id::read(&h).as_deref(), Some(max.as_str()));
    h.insert("x-client-id", HeaderValue::from_bytes(b"\xff\xfe").unwrap());
    assert_eq!(client_id::read(&h), None);
}
