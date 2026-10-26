//! System screen: version, access addresses and over-the-air updates.

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{error, require, server_error, AppState, CurrentUser};
use crate::update;

/// Maximum size of an uploaded update package.
pub const MAX_UPLOAD: usize = 512 * 1024 * 1024;

/// `http://<ip>:<port>` for every address the server can be reached on.
fn urls(bind: std::net::IpAddr, port: u16) -> Vec<String> {
    if !bind.is_unspecified() {
        return vec![format!("http://{}", std::net::SocketAddr::new(bind, port))];
    }
    let mut ips: Vec<(String, std::net::Ipv4Addr)> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.ip() {
            std::net::IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_link_local() => {
                Some((i.name, v4))
            }
            _ => None,
        })
        .collect();
    ips.sort();
    ips.into_iter()
        .map(|(_, ip)| format!("http://{ip}:{port}"))
        .collect()
}

pub async fn info(State(st): State<AppState>, CurrentUser(u): CurrentUser) -> Response {
    if let Err(r) = require(&u, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let (bind, port) = {
        let c = st.config.read().unwrap();
        (c.bind, c.port)
    };
    Json(json!({
        "version": update::current_version(),
        "dataDir": st.data_dir.display().to_string(),
        "urls": urls(bind, port),
    }))
    .into_response()
}

pub async fn update_info(State(st): State<AppState>, CurrentUser(u): CurrentUser) -> Response {
    if let Err(r) = require(&u, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let dir = st.data_dir.clone();
    match tokio::task::spawn_blocking(move || update::info(&dir)).await {
        Ok(i) => Json(i).into_response(),
        Err(_) => server_error(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsBody {
    repo: String,
    /// None = keep the stored token, "" = remove it.
    #[serde(default)]
    token: Option<String>,
    #[serde(default = "yes")]
    auto_check: bool,
}

fn yes() -> bool {
    true
}

pub async fn update_settings(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Json(b): Json<SettingsBody>,
) -> Response {
    if let Err(r) = require(&u, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let repo = b
        .repo
        .trim()
        .trim_start_matches("https://github.com/")
        .trim_end_matches('/')
        .to_string();
    if repo.split('/').count() != 2 || repo.split('/').any(|p| p.is_empty()) {
        return error(StatusCode::BAD_REQUEST, "Le dépôt s'écrit propriétaire/nom");
    }
    let mut cfg = update::Settings::load(&st.data_dir);
    cfg.repo = repo;
    cfg.auto_check = b.auto_check;
    if let Some(t) = b.token {
        cfg.token = t.trim().to_string();
    }
    match cfg.save(&st.data_dir) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => server_error(),
    }
}

pub async fn update_check(State(st): State<AppState>, CurrentUser(u): CurrentUser) -> Response {
    if let Err(r) = require(&u, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let dir = st.data_dir.clone();
    match tokio::task::spawn_blocking(move || update::check(&dir)).await {
        Ok(Ok(latest)) => Json(latest).into_response(),
        Ok(Err(e)) => error(StatusCode::BAD_GATEWAY, &format!("{e:#}")),
        Err(_) => server_error(),
    }
}

#[derive(Deserialize)]
pub struct InstallQuery {
    /// A release of the list (older ones included); the latest by default.
    #[serde(default)]
    version: Option<String>,
}

/// Downloads and installs a release in the background; progress is followed
/// with `GET /api/system/update`.
pub async fn update_install(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Query(q): Query<InstallQuery>,
) -> Response {
    if let Err(r) = require(&u, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    tracing::warn!(
        user = u.email,
        version = q.version.as_deref().unwrap_or("latest"),
        "installing a release"
    );
    let dir = st.data_dir.clone();
    tokio::task::spawn_blocking(move || {
        let _ = update::install_release(&dir, q.version.as_deref());
    });
    StatusCode::ACCEPTED.into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadQuery {
    /// Install even if it is not newer (downgrade / reinstall).
    #[serde(default)]
    allow_older: bool,
}

/// Installs a release archive uploaded by an admin (offline servers).
pub async fn update_upload(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Query(q): Query<UploadQuery>,
    body: Bytes,
) -> Response {
    if let Err(r) = require(&u, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    tracing::warn!(
        user = u.email,
        bytes = body.len(),
        "installing an uploaded package"
    );
    let dir = st.data_dir.clone();
    let res = tokio::task::spawn_blocking(move || {
        let r =
            update::extract_binary(&body).and_then(|b| update::install(&dir, &b, q.allow_older));
        if let Err(e) = &r {
            update::fail(e);
        }
        r
    })
    .await;
    match res {
        Err(_) => server_error(),
        Ok(Err(e)) => error(StatusCode::BAD_REQUEST, &format!("{e:#}")),
        Ok(Ok(version)) => {
            update::restart_soon();
            Json::<Value>(json!({ "version": version })).into_response()
        }
    }
}

pub async fn update_rollback(State(st): State<AppState>, CurrentUser(u): CurrentUser) -> Response {
    if let Err(r) = require(&u, &st.pool, Domain::Settings, Level::Admin).await {
        return r;
    }
    let dir = st.data_dir.clone();
    match tokio::task::spawn_blocking(move || update::rollback(&dir, "rolled back")).await {
        Err(_) => server_error(),
        Ok(Err(e)) => error(StatusCode::BAD_REQUEST, &format!("{e:#}")),
        Ok(Ok(version)) => {
            update::restart_soon();
            Json::<Value>(json!({ "version": version })).into_response()
        }
    }
}
