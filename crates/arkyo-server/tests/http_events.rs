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
