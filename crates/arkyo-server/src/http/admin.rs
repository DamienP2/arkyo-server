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

/// What a purge target empties and which seeded families it reinstalls.
/// `all` is handled separately.
fn target(name: &str) -> Option<(&'static [&'static str], &'static [SeedKind])> {
    Some(match name {
        "equipment" => (&["TenantEquipmentComponent", "TenantEquipment"], &[]),
        "brands" => (&["TenantBrand"], &[SeedKind::Brands]),
        "categories" => (
            &["TenantEquipmentCategory"],
            &[SeedKind::EquipmentCategories],
        ),
        "connectors" => (&["TenantConnectorType"], &[SeedKind::Connectors]),
        "signals" => (&["TenantSignalType"], &[SeedKind::Signals]),
        // no table of signal categories in the single catalogue
        "signal-categories" => (&[], &[]),
        "symbols" => (&["CatalogSymbol"], &[SeedKind::Symbols]),
        "adapters" => (&["TenantAdapter"], &[SeedKind::Adapters]),
        _ => return None,
    })
}

/// Every catalogue and referential table, children before parents.
const ALL_TABLES: [&str; 18] = [
    "TenantEquipmentComponent",
    "TenantEquipment",
    "TenantCable",
    "TenantAdapter",
    "TenantCableModel",
    "TenantBrand",
    "TenantEquipmentCategory",
    "TenantFunction",
    "TenantPhase",
    "TenantType",
    "TenantConnectorType",
    "TenantSignalType",
    "TenantDimensionPreset",
    "CatalogSymbol",
    "TenantPrintTemplate",
    "TenantCableLabelStock",
    "TenantPrintExportPage",
    "TenantPrintExportModel",
];

/// `POST /api/admin/purge` `{ target }` (settings:admin).
///
/// arkyo's version deleted from removed models; here `all` empties every
/// catalogue and referential table, then reinstalls the starting referentials
/// ([`SeedMode::Purge`]), in one transaction. A single target empties its
/// tables and reinstalls its own seeded family. Projects, `ExportTemplate`,
/// `PrintSettings` and the `AppConfig` keys (numbering…) are kept.
async fn purge(State(st): State<AppState>, CurrentUser(u): CurrentUser, body: Bytes) -> Response {
    let run = async {
        require(&u, &st.pool, Domain::Settings, Level::Admin).await?;
        let body = parse_body(&body)?;
        let name = body.get("target").and_then(Value::as_str).unwrap_or("");
        let plan = if name == "all" {
            None
        } else {
            Some(target(name).ok_or_else(|| bad("Cible inconnue"))?)
        };
        let mut tx = begin(&st.pool).await?;
        let tables: &[&str] = plan.map_or(&ALL_TABLES, |p| p.0);
        for t in tables {
            sqlx::query(&format!(r#"DELETE FROM "{t}""#))
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
        }
        let seed_err = |e: anyhow::Error| {
            tracing::error!("purge: {e:#}");
            server_error()
        };
        match plan {
            None => {
                seeds::apply_in(&mut tx, SeedMode::Purge)
                    .await
                    .map_err(seed_err)?;
            }
            Some((_, kinds)) => {
                for k in kinds {
                    seeds::apply_in(&mut tx, SeedMode::Restore(*k))
                        .await
                        .map_err(seed_err)?;
                }
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
        st.events.publish("config", "updated", None);
        Ok::<Response, Response>(Json(json!({ "ok": true })).into_response())
    };
    run.await.unwrap_or_else(|r| r)
}
