//! Separate test binary: closing the event streams is process-wide.
mod common;
use std::net::SocketAddr;
use std::time::Duration;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use tower::ServiceExt;

#[tokio::test]
async fn rack_stream_closes_on_shutdown() {
    // Like `/api/events`: graceful shutdown waits for open connections, and an
    // endless per-rack stream would keep the server hanging.
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    let now = arkyo_server::ids::now_iso();
    sqlx::query(
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES ('rack-a', 'Baie', ?, ?)"#,
    )
    .bind(&now)
    .bind(&now)
    .execute(&e.pool)
    .await
    .unwrap();

    let mut req = Request::builder()
        .uri("/api/racks/rack-a/events")
        .header(header::COOKIE, format!("arkyo_session={tok}"))
        .body(Body::empty())
        .unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(LOCAL.parse::<SocketAddr>().unwrap()));
    let res = e.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let mut body = res.into_body();
    let first = body.frame().await.unwrap().unwrap().into_data().unwrap();
    assert_eq!(&first[..], b": connected\n\n");

    arkyo_server::http::close_event_streams();
    let end = tokio::time::timeout(Duration::from_secs(2), body.frame())
        .await
        .expect("rack stream still open after shutdown");
    assert!(end.is_none());
}
