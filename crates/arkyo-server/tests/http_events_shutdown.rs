//! Separate test binary: closing the event streams is process-wide.
mod common;
use std::net::SocketAddr;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use tower::ServiceExt;

#[tokio::test]
async fn event_streams_end_on_shutdown() {
    // Graceful shutdown waits for open connections: an endless SSE stream
    // would keep the server (and a service stop) hanging.
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    let mut req = Request::builder()
        .uri("/api/events")
        .header(header::COOKIE, format!("arkyo_session={tok}"))
        .body(Body::empty())
        .unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(LOCAL.parse::<SocketAddr>().unwrap()));
    let res = e.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let mut body = res.into_body();
    let first = body.frame().await.unwrap().unwrap().into_data().unwrap();
    assert_eq!(&first[..], b"data: {\"type\":\"connected\"}\n\n");

    arkyo_server::http::close_event_streams();
    let end = tokio::time::timeout(std::time::Duration::from_secs(2), body.frame())
        .await
        .expect("stream still open after shutdown");
    assert!(end.is_none());
}
