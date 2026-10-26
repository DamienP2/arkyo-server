#![allow(dead_code)]
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};

use arkyo_server::config::Config;
use arkyo_server::http::{router, AppState};
use arkyo_server::users::{self, NewUser, User};
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use serde_json::Value;
use sqlx::SqlitePool;
use tower::ServiceExt;

pub const LOCAL: &str = "127.0.0.1:50000";
pub const REMOTE: &str = "192.168.1.20:50000";

pub struct Env {
    pub _dir: tempfile::TempDir,
    pub pool: SqlitePool,
    pub app: Router,
}

pub async fn env() -> Env {
    let dir = tempfile::tempdir().unwrap();
    let pool = arkyo_server::db::open(dir.path()).await.unwrap();
    let app = router(AppState {
        pool: pool.clone(),
        data_dir: dir.path().to_path_buf(),
        config: Arc::new(RwLock::new(Config::default())),
    });
    Env {
        _dir: dir,
        pool,
        app,
    }
}

pub async fn add_user(pool: &SqlitePool, email: &str, role: &str, temporary: bool) -> User {
    users::create(
        pool,
        NewUser {
            email: email.into(),
            name: Some("Test".into()),
            username: None,
            role_key: role.into(),
            password: "secret123".into(),
            must_change_password: temporary,
        },
    )
    .await
    .unwrap()
}

pub struct Reply {
    pub status: StatusCode,
    pub cookie: Option<String>,
    pub body: Value,
}

pub async fn call(
    app: &Router,
    method: &str,
    uri: &str,
    peer: &str,
    cookie: Option<&str>,
    body: Option<Value>,
) -> Reply {
    let mut b = Request::builder().method(method).uri(uri);
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, format!("arkyo_session={c}"));
    }
    let req = if let Some(v) = body {
        b.header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(v.to_string()))
    } else {
        b.body(Body::empty())
    };
    let mut req = req.unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(peer.parse::<SocketAddr>().unwrap()));
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let cookie = res
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().to_string());
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Reply {
        status,
        cookie,
        body,
    }
}

/// Logs in and returns the raw session token.
pub async fn login(app: &Router, ident: &str) -> String {
    let r = call(
        app,
        "POST",
        "/api/auth/login",
        LOCAL,
        None,
        Some(serde_json::json!({"identifier": ident, "password": "secret123"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    token_of(r.cookie.as_deref().unwrap())
}

pub fn token_of(set_cookie: &str) -> String {
    set_cookie
        .strip_prefix("arkyo_session=")
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string()
}
