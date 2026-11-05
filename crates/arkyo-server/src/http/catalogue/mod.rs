//! Catalogue API: `/api/tenant/catalogue/{equipment,cables,adapters}/**`,
//! `lookup` and `connectors`.
//!
//! Single catalogue (decision 2 of the phase): every item lives in the
//! `Tenant*` tables and is presented as `PERSONAL`; the `arkyo` lists are
//! always `[]`. Cables and adapters share their write flow (`shared`).

#![allow(clippy::result_large_err)]

mod adapters;
mod cables;
mod connectors;
mod equipment;
mod lookup;
mod shared;

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
            "/tenant/catalogue/cables",
            get(cables::list).post(cables::create),
        )
        .route(
            "/tenant/catalogue/cables/bulk-delete",
            post(cables::bulk_delete),
        )
        .route(
            "/tenant/catalogue/cables/check-duplicate",
            get(cables::check_duplicate),
        )
        .route("/tenant/catalogue/cables/lengths", get(cables::lengths))
        .route(
            "/tenant/catalogue/cables/{id}",
            get(cables::detail)
                .patch(cables::update)
                .delete(cables::delete),
        )
        .route(
            "/tenant/catalogue/cables/{id}/duplicate",
            post(cables::duplicate),
        )
        .route(
            "/tenant/catalogue/cables/{id}/restore",
            post(cables::restore),
        )
        .route(
            "/tenant/catalogue/adapters",
            get(adapters::list).post(adapters::create),
        )
        .route(
            "/tenant/catalogue/adapters/bulk-delete",
            post(adapters::bulk_delete),
        )
        .route(
            "/tenant/catalogue/adapters/check-duplicate",
            get(adapters::check_duplicate),
        )
        .route(
            "/tenant/catalogue/adapters/{id}",
            get(adapters::detail)
                .patch(adapters::update)
                .delete(adapters::delete),
        )
        .route(
            "/tenant/catalogue/adapters/{id}/duplicate",
            post(adapters::duplicate),
        )
        .route(
            "/tenant/catalogue/adapters/{id}/restore",
            post(adapters::restore),
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
