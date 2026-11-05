//! Catalogue API: `/api/tenant/catalogue/{equipment/**,lookup,connectors}`.
//!
//! Single catalogue (decision 2 of the phase): every item lives in the
//! `Tenant*` tables and is presented as `PERSONAL`; the `arkyo` lists are
//! always `[]`. Cables and adapters arrive with their own task.

#![allow(clippy::result_large_err)]

mod connectors;
mod equipment;
mod lookup;

use arkyo_core::permissions::{has_permission, Domain, Level};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;

use super::{role_permissions, AppState};
use crate::users::User;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/tenant/catalogue/equipment",
            get(equipment::list).post(equipment::create),
        )
        .route(
            "/tenant/catalogue/equipment/bulk-delete",
            post(equipment::bulk_delete),
        )
        .route(
            "/tenant/catalogue/equipment/check-duplicate",
            get(equipment::check_duplicate),
        )
        .route(
            "/tenant/catalogue/equipment/{id}",
            get(equipment::detail)
                .patch(equipment::update)
                .delete(equipment::delete),
        )
        .route(
            "/tenant/catalogue/equipment/{id}/duplicate",
            post(equipment::duplicate),
        )
        .route(
            "/tenant/catalogue/equipment/{id}/restore",
            post(equipment::restore),
        )
        .route(
            "/tenant/catalogue/lookup",
            get(lookup::get).post(lookup::post),
        )
        .route("/tenant/catalogue/connectors", get(connectors::list))
}

/// arkyo `assertCanWritePersonal`: `catalog:write` (owner passes), else
/// `403 {code, domain, minLevel}` (no `error` key, like arkyo).
pub(super) async fn assert_can_write(st: &AppState, user: &User) -> Result<(), Response> {
    let (_, perms) = role_permissions(&st.pool, &user.role_key).await;
    if has_permission(&perms, Domain::Catalog, Level::Write) {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "code": "INSUFFICIENT_PERMISSION", "domain": "catalog", "minLevel": "write"
            })),
        )
            .into_response())
    }
}
