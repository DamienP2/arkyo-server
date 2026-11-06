//! arkyo:app/api/admin/{config,purge}/route.ts.

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use super::parametres::application::{patch_map, read_map};
use super::parametres::{bad, begin, db_error, parse_body};
use super::{require, server_error, AppState, CurrentUser};
use crate::audit;
use crate::seeds::{self, SeedKind, SeedMode};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/config", get(config_get).patch(config_patch))
        .route("/admin/purge", post(purge))
}

async fn config_get(State(st): State<AppState>, _u: CurrentUser) -> Response {
    read_map(&st.pool, None).await
}

/// settings:admin, as arkyo.
async fn config_patch(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    patch_map(&st, &u, Level::Admin, None, body).await
}

/// What a purge target empties: `(delete statements' tables, seeded
/// families reinstalled by `all`, real-time entities to refresh)`.
type Plan = (
    &'static [&'static str],
    &'static [SeedKind],
    &'static [&'static str],
);

const CATALOGUE: &str = "tenant_catalogue";

fn target(name: &str) -> Option<Plan> {
    Some(match name {
        "equipment" => (
            &["TenantEquipmentComponent", "TenantEquipment"],
            &[],
            &[CATALOGUE],
        ),
        "brands" => (
            &["TenantBrand"],
            &[SeedKind::Brands],
            &["tenant_parametres_brands"],
        ),
        "categories" => (
            &["TenantEquipmentCategory"],
            &[SeedKind::EquipmentCategories],
            &["tenant_parametres_categories"],
        ),
        "connectors" => (
            &["TenantConnectorType"],
            &[SeedKind::Connectors],
            &["tenant_parametres_connectors"],
        ),
        "signals" => (
            &["TenantSignalType"],
            &[SeedKind::Signals],
            &["tenant_parametres_signals"],
        ),
        // no table of signal categories in the single catalogue
        "signal-categories" => (&[], &[], &[]),
        "symbols" => (
            &["CatalogSymbol"],
            &[SeedKind::Symbols],
            &["tenant_parametres_symbols"],
        ),
        "adapters" => (&["TenantAdapter"], &[SeedKind::Adapters], &[CATALOGUE]),
        _ => return None,
    })
}

/// Families named by the front's "all" confirmation (equipment, signals,
/// connectors, brands, categories, adapters, symbols) plus the cords, which
/// reference connectors. Children first.
const ALL_TABLES: [&str; 8] = [
    "TenantEquipmentComponent",
    "TenantEquipment",
    "TenantCable",
    "TenantAdapter",
    "TenantBrand",
    "TenantEquipmentCategory",
    "TenantConnectorType",
    "TenantSignalType",
];
const ALL_SEEDS: [SeedKind; 7] = [
    SeedKind::Brands,
    SeedKind::EquipmentCategories,
    SeedKind::Symbols,
    SeedKind::Connectors,
    SeedKind::Signals,
    SeedKind::Adapters,
    SeedKind::Cables,
];
const ALL_EVENTS: [&str; 6] = [
    CATALOGUE,
    "tenant_parametres_brands",
    "tenant_parametres_categories",
    "tenant_parametres_connectors",
    "tenant_parametres_signals",
    "tenant_parametres_symbols",
];

/// `POST /api/admin/purge` `{ target }` (settings:admin).
///
/// arkyo's version deleted from removed models. A single target only
/// deletes its tables, like arkyo (`symbols`: custom symbols only). `all` empties the families the front
/// lists (see [`ALL_TABLES`]; custom symbols only, built-in ones stay), then
/// reinstalls their starting rows, in one transaction. Print settings,
/// functions/phases/types, dimensions, cable models, `ExportTemplate`,
/// `PrintSettings` and `AppConfig` are kept. Additions vs arkyo: the audit
/// row `admin.purge` and the real-time events of the emptied families.
async fn purge(State(st): State<AppState>, CurrentUser(u): CurrentUser, body: Bytes) -> Response {
    let run = async {
        require(&u, &st.pool, Domain::Settings, Level::Admin).await?;
        let body = parse_body(&body)?;
        let name = body.get("target").and_then(Value::as_str).unwrap_or("");
        let all = name == "all";
        let plan = if all {
            None
        } else {
            Some(target(name).ok_or_else(|| bad("Cible inconnue"))?)
        };
        let tables: &[&str] = plan.map_or(&ALL_TABLES, |p| p.0);
        let mut tx = begin(&st.pool).await?;
        for t in tables {
            // custom symbols only: the built-in ones have no restore
            let only = if *t == "CatalogSymbol" {
                r#" WHERE "isBuiltin" = 0"#
            } else {
                ""
            };
            sqlx::query(&format!(r#"DELETE FROM "{t}"{only}"#))
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
        }
        if all {
            sqlx::query(r#"DELETE FROM "CatalogSymbol" WHERE "isBuiltin" = 0"#)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
            for k in ALL_SEEDS {
                seeds::apply_in(&mut tx, SeedMode::Restore(k))
                    .await
                    .map_err(|e| {
                        tracing::error!("purge: {e:#}");
                        server_error()
                    })?;
            }
        }
        audit::log(
            &mut tx,
            &u.id,
            "admin.purge",
            "Purge",
            name,
            None,
            None,
            Some(json!({ "target": name })),
        )
        .await
        .map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        let events: &[&str] = plan.map_or(&ALL_EVENTS, |p| p.2);
        for e in events {
            st.events.publish(e, "purge", Some("bulk"));
        }
        st.events.publish("config", "updated", None);
        Ok::<Response, Response>(Json(json!({ "ok": true })).into_response())
    };
    run.await.unwrap_or_else(|r| r)
}
