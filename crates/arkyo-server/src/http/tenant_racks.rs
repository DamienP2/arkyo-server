//! The tenant-level reads of the container editors:
//! - arkyo:app/api/tenant/racks/route.ts (`GET /api/tenant/racks`, the
//!   container library of the « Ajouter un contenant » wizard);
//! - arkyo:app/api/tenant/inventaire/catalog/route.ts and
//!   arkyo:app/api/tenant/projects/[id]/inventaire/catalog/route.ts (the
//!   inventory catalogue panel, same payload, the second one checks the
//!   project).
//!
//! Session only, no write.
//!
//! `/api/tenant/racks?templates=true` is not phase 3's
//! `/api/racks?templates=true` (the templates page): it keeps the `ACTIF`
//! templates only, by creation date.
//!
//! arkyo-server: catalogue lu en local (`TenantEquipment`, `TenantAdapter`,
//! `Panel`) ; la fusion catalogue central / perso est SaaS, `source` vaut
//! toujours `PERSONAL` (voir `crate::inventory::catalog`).

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::parametres::{db_error, row_map, Table};
use super::{error, AppState, CurrentUser};
use crate::inventory::catalog::{fetch_inventaire_adapters, fetch_inventaire_equipments};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tenant/racks", get(racks))
        .route("/tenant/inventaire/catalog", get(catalog))
        .route(
            "/tenant/projects/{id}/inventaire/catalog",
            get(project_catalog),
        )
}

const RACK_LITE: Table = Table {
    name: "Rack",
    bools: &["hasWheels"],
    jsons: &[],
};

// ── GET /api/tenant/racks[?templates=true] ──────────────────────────────────

/// `[{id, name, rackType, totalU, depthMm, hasWheels, slotsCount}]` by
/// `createdAt desc`. With `templates=true` (exactly), the `ACTIF` racks of
/// no project rig (route.ts:25-63); otherwise every rack, project ones
/// included. `slotsCount` counts every slot (ghosts and shelf children).
pub async fn racks(
    State(st): State<AppState>,
    _u: CurrentUser,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let filter = if q.get("templates").map(String::as_str) == Some("true") {
        r#"WHERE r."templateStatus" = 'ACTIF'
             AND NOT EXISTS (SELECT 1 FROM "RigRack" rr JOIN "RigConfig" g ON g."id" = rr."rigConfigId"
                             WHERE rr."rackId" = r."id" AND g."projectId" IS NOT NULL)"#
    } else {
        ""
    };
    let sql = format!(
        r#"SELECT r."id", r."name", r."rackType", r."totalU", r."depthMm", r."hasWheels",
                  (SELECT COUNT(*) FROM "RackSlot" s WHERE s."rackId" = r."id") AS "slotsCount"
           FROM "Rack" r {filter}
           ORDER BY r."createdAt" DESC, r."id" DESC"#
    );
    match sqlx::query(&sql).fetch_all(&st.pool).await {
        Ok(rows) => Json(Value::Array(
            rows.iter()
                .map(|r| Value::Object(row_map(r, &RACK_LITE)))
                .collect(),
        ))
        .into_response(),
        Err(e) => db_error(e),
    }
}

// ── GET /api/tenant/inventaire/catalog ──────────────────────────────────────

/// `{ equipments, panels, adapters }`: the active equipments and adapters
/// (`fetchMergedInventaire*`) and every panel by name.
async fn catalog_payload(conn: &mut SqliteConnection) -> Result<Value, sqlx::Error> {
    let equipments = fetch_inventaire_equipments(conn).await?;
    let panels: Vec<(String, String, String, i64)> = sqlx::query_as(
        r#"SELECT "id", "name", "panelType", "heightU" FROM "Panel" ORDER BY "name", "id""#,
    )
    .fetch_all(&mut *conn)
    .await?;
    let adapters = fetch_inventaire_adapters(conn).await?;
    let panels: Vec<Value> = panels
        .into_iter()
        .map(|(id, name, panel_type, height_u)| {
            json!({ "id": id, "name": name, "reference": null, "type": panel_type, "heightU": height_u })
        })
        .collect();
    Ok(json!({ "equipments": equipments, "panels": panels, "adapters": adapters }))
}

pub async fn catalog(State(st): State<AppState>, _u: CurrentUser) -> Response {
    let run = async {
        let mut conn = st.pool.acquire().await?;
        catalog_payload(&mut conn).await
    };
    match run.await {
        Ok(v) => Json(v).into_response(),
        Err(e) => db_error(e),
    }
}

// ── GET /api/tenant/projects/:id/inventaire/catalog ─────────────────────────

pub async fn project_catalog(
    State(st): State<AppState>,
    _u: CurrentUser,
    Path(project_id): Path<String>,
) -> Response {
    let run = async {
        let mut conn = st.pool.acquire().await?;
        let found: Option<i64> = sqlx::query_scalar(r#"SELECT 1 FROM "Project" WHERE "id" = ?"#)
            .bind(&project_id)
            .fetch_optional(&mut *conn)
            .await?;
        if found.is_none() {
            return Ok(None);
        }
        catalog_payload(&mut conn).await.map(Some)
    };
    match run.await {
        Ok(Some(v)) => Json(v).into_response(),
        Ok(None) => error(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => db_error(e),
    }
}
