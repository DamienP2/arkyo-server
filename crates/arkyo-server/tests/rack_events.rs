//! `GET /api/racks/:id/events` (arkyo:app/api/racks/[id]/events/route.ts) and
//! the per-rack bus (arkyo:lib/rack-events.ts). The shutdown test lives in
//! `rack_events_shutdown.rs`: closing the streams is process-wide.
mod common;
use std::net::SocketAddr;
use std::time::Duration;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

fn rack_events_request(rack_id: &str, cookie: Option<&str>) -> Request<Body> {
    let mut b = Request::builder()
        .method("GET")
        .uri(format!("/api/racks/{rack_id}/events"));
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, format!("arkyo_session={c}"));
    }
    let mut req = b.body(Body::empty()).unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(LOCAL.parse::<SocketAddr>().unwrap()));
    req
}

async fn add_rack(pool: &SqlitePool, id: &str) {
    let now = arkyo_server::ids::now_iso();
    sqlx::query(
        r#"INSERT INTO "Rack" ("id","name","createdAt","updatedAt") VALUES (?, 'Baie', ?, ?)"#,
    )
    .bind(id)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
}

async fn next_frame(body: &mut Body) -> String {
    let frame = tokio::time::timeout(Duration::from_secs(2), body.frame())
        .await
        .expect("no frame within 2 s")
        .expect("stream ended")
        .unwrap();
    String::from_utf8(frame.into_data().unwrap().to_vec()).unwrap()
}

fn data_of(frame: &str) -> Value {
    let json = frame
        .strip_prefix("data: ")
        .and_then(|s| s.strip_suffix("\n\n"))
        .unwrap_or_else(|| panic!("not a data frame: {frame:?}"));
    serde_json::from_str(json).unwrap()
}

#[tokio::test]
async fn rack_stream_receives_only_its_rack() {
    let e = env().await;
    // arkyo only requires a session: no permission (route.ts:11-18).
    sqlx::query(
        r#"INSERT INTO "Role" ("id","key","label","permissions","createdAt","updatedAt")
           VALUES ('r1','sans-droits','Sans droits','{}', '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .execute(&e.pool)
    .await
    .unwrap();
    add_user(&e.pool, "v@b.fr", "sans-droits", false).await;
    let tok = login(&e.app, "v@b.fr").await;
    add_rack(&e.pool, "rack-a").await;
    add_rack(&e.pool, "rack-b").await;

    let res = e
        .app
        .clone()
        .oneshot(rack_events_request("rack-a", Some(&tok)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let h = res.headers();
    assert_eq!(h.get(header::CONTENT_TYPE).unwrap(), "text/event-stream");
    assert_eq!(h.get(header::CACHE_CONTROL).unwrap(), "no-cache");
    assert_eq!(h.get(header::CONNECTION).unwrap(), "keep-alive");
    assert!(h.get("x-accel-buffering").is_none());
    let mut body = res.into_body();
    // An SSE comment, not a `data:` event (route.ts:38).
    assert_eq!(next_frame(&mut body).await, ": connected\n\n");

    // Neither the other rack's events nor the app bus reach this stream.
    e.events
        .publish_rack("rack-b", json!({"type": "zone_removed", "zoneId": "z-b"}));
    e.events.publish("rack", "updated", Some("rack-a"));
    // No envelope and no clientId filter: the payload goes out as published.
    e.events.publish_rack(
        "rack-a",
        json!({"type": "slot_removed", "slotId": "s1", "removedAdapterIds": ["a1"]}),
    );
    e.events
        .publish_rack("rack-a", json!({"type": "construction_checks_updated"}));

    let first = next_frame(&mut body).await;
    assert_eq!(
        data_of(&first),
        json!({"type": "slot_removed", "slotId": "s1", "removedAdapterIds": ["a1"]})
    );
    assert_eq!(
        next_frame(&mut body).await,
        "data: {\"type\":\"construction_checks_updated\"}\n\n"
    );

    // No heartbeat: nothing else arrives.
    let idle = tokio::time::timeout(Duration::from_millis(300), body.frame()).await;
    assert!(idle.is_err(), "unexpected frame: {idle:?}");
}

#[tokio::test]
async fn rack_stream_two_subscribers_and_no_subscriber() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    add_rack(&e.pool, "rack-a").await;

    // Publishing with nobody listening is harmless.
    e.events
        .publish_rack("rack-a", json!({"type": "rack_cleared"}));

    let mut bodies = Vec::new();
    for _ in 0..2 {
        let res = e
            .app
            .clone()
            .oneshot(rack_events_request("rack-a", Some(&tok)))
            .await
            .unwrap();
        let mut body = res.into_body();
        assert_eq!(next_frame(&mut body).await, ": connected\n\n");
        bodies.push(body);
    }
    e.events.publish_rack(
        "rack-a",
        json!({"type": "panelrow_updated", "slotId": "s", "rowIndex": 0, "x": 1, "y": 2}),
    );
    for body in &mut bodies {
        assert_eq!(
            data_of(&next_frame(body).await),
            json!({"type": "panelrow_updated", "slotId": "s", "rowIndex": 0, "x": 1, "y": 2})
        );
    }

    // A closed stream unsubscribes; the remaining one still receives.
    drop(bodies.pop());
    e.events
        .publish_rack("rack-a", json!({"type": "label_removed", "labelId": "l"}));
    assert_eq!(
        data_of(&next_frame(&mut bodies[0]).await),
        json!({"type": "label_removed", "labelId": "l"})
    );
}

#[tokio::test]
async fn rack_stream_401_404_plain_text() {
    let e = env().await;
    add_rack(&e.pool, "rack-a").await;

    // No session (route.ts:11-16).
    let res = e
        .app
        .clone()
        .oneshot(rack_events_request("rack-a", None))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    assert!(res
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("text/plain"));
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&bytes[..], b"Unauthorized");

    // Unknown session token: same answer.
    let res = e
        .app
        .clone()
        .oneshot(rack_events_request("rack-a", Some("inconnu")))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&bytes[..], b"Unauthorized");

    // Unknown rack (route.ts:17-18).
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    let res = e
        .app
        .clone()
        .oneshot(rack_events_request("absent", Some(&tok)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert!(res
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("text/plain"));
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&bytes[..], b"Not found");
}
