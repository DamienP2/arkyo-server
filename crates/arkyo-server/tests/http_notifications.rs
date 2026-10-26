mod common;
use axum::http::StatusCode;
use common::*;
use serde_json::json;
use sqlx::SqlitePool;

async fn notify(pool: &SqlitePool, user: &str, title: &str, created: &str) -> String {
    let id = arkyo_server::ids::new_id();
    sqlx::query(
        r#"INSERT INTO "Notification" ("id","recipientId","type","title","message","data","createdAt")
           VALUES (?,?,?,?,NULL,'{"a":1}',?)"#,
    )
    .bind(&id)
    .bind(user)
    .bind("info")
    .bind(title)
    .bind(created)
    .execute(pool)
    .await
    .unwrap();
    id
}

#[tokio::test]
async fn notifications_list_count_read_delete() {
    let e = env().await;
    let o = add_user(&e.pool, "o@b.fr", "owner", false).await;
    let t = add_user(&e.pool, "t@b.fr", "technicien", false).await;
    let n1 = notify(&e.pool, &o.id, "un", "2026-01-01T00:00:00.000Z").await;
    notify(&e.pool, &o.id, "deux", "2026-01-02T00:00:00.000Z").await;
    notify(&e.pool, &o.id, "trois", "2026-01-03T00:00:00.000Z").await;
    let tok = login(&e.app, "o@b.fr").await;

    let c = call(
        &e.app,
        "GET",
        "/api/notifications/count",
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(c.body, json!({"count": 3}));
    let l = call(&e.app, "GET", "/api/notifications", LOCAL, Some(&tok), None).await;
    assert_eq!(l.body["total"], 3);
    assert_eq!(l.body["count"], 3);
    assert_eq!(l.body["page"], 1);
    assert_eq!(l.body["pages"], 1);
    assert_eq!(l.body["items"][0]["title"], "trois");
    assert_eq!(l.body["items"][0]["data"], json!({"a": 1}));
    assert!(l.body["items"][0]["readAt"].is_null());
    assert_eq!(l.body["items"][0]["recipientId"], o.id);

    let p = call(
        &e.app,
        "PATCH",
        &format!("/api/notifications/{n1}"),
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(p.body, json!({"ok": true}));
    let c = call(
        &e.app,
        "GET",
        "/api/notifications/count",
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(c.body, json!({"count": 2}));
    // read ones sort last
    let l = call(&e.app, "GET", "/api/notifications", LOCAL, Some(&tok), None).await;
    assert_eq!(l.body["items"][2]["title"], "un");
    let u = call(
        &e.app,
        "GET",
        "/api/notifications?unread=true&limit=1&page=2",
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(u.body["items"].as_array().unwrap().len(), 1);
    assert_eq!(u.body["total"], 3);
    assert_eq!(u.body["page"], 2);
    assert_eq!(u.body["pages"], 3);

    let d = call(
        &e.app,
        "DELETE",
        &format!("/api/notifications/{n1}"),
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(d.body, json!({"ok": true}));
    let l = call(&e.app, "GET", "/api/notifications", LOCAL, Some(&tok), None).await;
    assert_eq!(l.body["total"], 2);

    // read-all
    let bad = call(
        &e.app,
        "PATCH",
        "/api/notifications",
        LOCAL,
        Some(&tok),
        Some(json!({"action":"x"})),
    )
    .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert_eq!(bad.body["error"], "Action inconnue");
    let ra = call(
        &e.app,
        "PATCH",
        "/api/notifications",
        LOCAL,
        Some(&tok),
        Some(json!({"action":"read-all"})),
    )
    .await;
    assert_eq!(ra.body, json!({"ok": true}));
    let c = call(
        &e.app,
        "GET",
        "/api/notifications/count",
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(c.body, json!({"count": 0}));

    // another user sees nothing and cannot touch them
    let ttok = login(&e.app, "t@b.fr").await;
    let l = call(
        &e.app,
        "GET",
        "/api/notifications",
        LOCAL,
        Some(&ttok),
        None,
    )
    .await;
    assert_eq!(l.body["total"], 0);
    let other = notify(&e.pool, &o.id, "quatre", "2026-01-04T00:00:00.000Z").await;
    call(
        &e.app,
        "DELETE",
        &format!("/api/notifications/{other}"),
        LOCAL,
        Some(&ttok),
        None,
    )
    .await;
    let c = call(
        &e.app,
        "GET",
        "/api/notifications/count",
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(c.body, json!({"count": 1}));
    let _ = t;
}

#[tokio::test]
async fn count_without_session_is_zero_and_list_is_401() {
    let e = env().await;
    let c = call(&e.app, "GET", "/api/notifications/count", LOCAL, None, None).await;
    assert_eq!(c.status, StatusCode::OK);
    assert_eq!(c.body, json!({"count": 0}));
    let l = call(&e.app, "GET", "/api/notifications", LOCAL, None, None).await;
    assert_eq!(l.status, StatusCode::UNAUTHORIZED);
}
