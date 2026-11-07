//! HTTP API: shared state, session middleware, extractors and routing.

mod admin;
mod auth;
mod catalogue;
pub mod client_id;
mod espace;
mod events;
mod me;
mod members;
mod notifications;
mod panels;
pub(crate) mod parametres;
mod presence;
mod profile;
pub(crate) mod projects;
pub(crate) mod rack_connections;
mod rack_construction;
mod rack_events;
pub(crate) mod rack_objects;
pub(crate) mod rack_objects2;
mod rack_renumber;
mod rack_slots;
mod racks;
mod rigs;
mod roles;
mod system;
mod tenant_racks;
mod upload;

use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use arkyo_core::permissions::{has_permission, owner_permissions, parse_permissions};
use arkyo_core::permissions::{Domain, Level, Permissions};
use axum::extract::DefaultBodyLimit;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::request::Parts;
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde_json::json;
use sqlx::SqlitePool;

use crate::config::Config;
use crate::sessions;
use crate::users::{self, User};

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub data_dir: PathBuf,
    pub events: crate::events::EventBus,
    pub config: Arc<RwLock<Config>>,
}

/// `{"error": ...}` with a status code.
pub fn error(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "error": msg }))).into_response()
}

pub fn server_error() -> Response {
    error(StatusCode::INTERNAL_SERVER_ERROR, "Erreur serveur")
}

/// The authenticated user of the current request.
#[derive(Debug, Clone)]
pub struct CurrentUser(pub User);

/// Session data resolved by the middleware (also exposed to `auth/session`).
#[derive(Debug, Clone)]
pub(crate) struct Resolved {
    pub user: User,
    pub token: String,
    pub expires_at: String,
}

impl<S: Send + Sync> FromRequestParts<S> for CurrentUser {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Response> {
        parts
            .extensions
            .get::<Resolved>()
            .map(|r| CurrentUser(r.user.clone()))
            .ok_or_else(|| error(StatusCode::UNAUTHORIZED, "Non authentifié"))
    }
}

/// Role flags and permissions for a role key (owner roles get every domain at admin).
pub async fn role_permissions(pool: &SqlitePool, role_key: &str) -> (bool, Permissions) {
    let row: Option<(bool, String)> =
        sqlx::query_as(r#"SELECT "isOwner", "permissions" FROM "Role" WHERE "key" = ?"#)
            .bind(role_key)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    match row {
        Some((true, _)) => (true, owner_permissions()),
        Some((false, p)) => (false, parse_permissions(&p)),
        None => (false, parse_permissions("{}")),
    }
}

#[allow(clippy::result_large_err)]
/// `403 {"error":"Accès refusé"}` unless the user's role grants `min` on `domain`.
pub async fn require(
    user: &User,
    pool: &SqlitePool,
    domain: Domain,
    min: Level,
) -> Result<(), Response> {
    let (_, perms) = role_permissions(pool, &user.role_key).await;
    if has_permission(&perms, domain, min) {
        Ok(())
    } else {
        Err(error(StatusCode::FORBIDDEN, "Accès refusé"))
    }
}

/// Resolves the session cookie to an active user and enforces the password-change gate
/// on everything but `/auth/*` and `/platform/locale` (the layer sees paths relative to the `/api` nest).
async fn session_layer(State(st): State<AppState>, mut req: Request, next: Next) -> Response {
    let token = req
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(sessions::token_from_cookie_header)
        .map(str::to_string);
    if let Some(token) = token {
        if let Some(live) = sessions::lookup(&st.pool, &token).await {
            if let Some(user) = users::get(&st.pool, &live.user_id)
                .await
                .filter(|u| u.is_active)
            {
                req.extensions_mut().insert(Resolved {
                    user,
                    token,
                    expires_at: live.expires_at,
                });
            }
        }
    }
    // The sign-in language selector and the password-change page both need these.
    let path = req.uri().path();
    let exempt = path.starts_with("/auth/") || path == "/platform/locale";
    if !exempt {
        if let Some(r) = req.extensions().get::<Resolved>() {
            if r.user.must_change_password {
                return (
                    StatusCode::FORBIDDEN,
                    Json(json!({
                        "error": "Changement de mot de passe requis",
                        "code": "PASSWORD_CHANGE_REQUIRED"
                    })),
                )
                    .into_response();
            }
        }
    }
    next.run(req).await
}

async fn api_not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Not found")
}

/// Ends the open `/api/events` and `/api/racks/:id/events` streams so
/// graceful shutdown can complete.
pub fn close_event_streams() {
    events::close_all();
}

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/auth/state", get(auth::state))
        .route("/auth/setup", post(auth::setup))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/session", get(auth::session))
        .route("/auth/password", post(auth::change_password))
        .route("/tenant/me/permissions", get(me::permissions))
        .route("/site", get(me::site))
        .route("/tenant/members", get(members::list).post(members::invite))
        .route(
            "/tenant/members/{id}",
            axum::routing::patch(members::update).delete(members::remove),
        )
        .route("/tenant/roles", get(roles::list).post(roles::create))
        .route(
            "/tenant/roles/{id}",
            axum::routing::patch(roles::update).delete(roles::remove),
        )
        .route("/tenant/profile", get(profile::get).patch(profile::patch))
        .route(
            "/tenant/espace/informations",
            get(espace::get).patch(espace::patch),
        )
        .route("/platform/locale", post(me::locale))
        .route(
            "/notifications",
            get(notifications::list).patch(notifications::patch_all),
        )
        .route("/notifications/count", get(notifications::count))
        .route(
            "/notifications/{id}",
            axum::routing::patch(notifications::mark_read).delete(notifications::remove),
        )
        .route("/presence", get(presence::get).post(presence::post))
        .route("/events", get(events::stream))
        .route("/racks/{id}/events", get(rack_events::stream))
        .route(
            "/upload",
            post(upload::upload).layer(DefaultBodyLimit::max(upload::MAX_BODY)),
        )
        .route("/upload/from-url", post(upload::from_url))
        .route("/system", get(system::info))
        .route("/system/update", get(system::update_info))
        .route("/system/update/settings", put(system::update_settings))
        .route("/system/update/check", post(system::update_check))
        .route("/system/update/install", post(system::update_install))
        .route(
            "/system/update/upload",
            post(system::update_upload).layer(DefaultBodyLimit::max(system::MAX_UPLOAD)),
        )
        .route("/system/update/rollback", post(system::update_rollback))
        .merge(parametres::router())
        .merge(admin::router())
        .merge(catalogue::router())
        .merge(projects::router())
        .merge(racks::router())
        .merge(rack_slots::router())
        .merge(rack_construction::router())
        .merge(rack_objects::router())
        .merge(rack_objects2::router())
        .merge(rack_connections::router())
        .merge(rack_renumber::router())
        .merge(rigs::router())
        .merge(panels::router())
        .merge(tenant_racks::router())
        .fallback(api_not_found)
        .layer(middleware::from_fn_with_state(state.clone(), session_layer));
    let web = crate::web::routes(&state.data_dir);
    Router::new().nest("/api", api).merge(web).with_state(state)
}
