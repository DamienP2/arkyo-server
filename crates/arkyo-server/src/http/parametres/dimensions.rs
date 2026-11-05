//! arkyo:app/api/tenant/parametres/dimensions/{route,[id]/route,restore-arkyo/route}.ts

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use super::{db_error, list_rows, objs, require, Def, Field, Hooks, Kind, NoHooks, Res, Table};
use crate::audit;
use crate::http::{AppState, CurrentUser};
use crate::seeds::{self, SeedKind, SeedMode};

const CATEGORIES: [&str; 6] = [
    "RACK_U",
    "RACK_WIDTH",
    "RACK_DEPTH",
    "CABLE_SAFETY_DEPTH",
    "CABLE_LENGTH",
    "BEND_RADIUS",
];
const CATEGORY: Kind = Kind::Enum(
    &CATEGORIES,
    "Catégorie invalide. Valeurs acceptées : RACK_U, RACK_WIDTH, RACK_DEPTH, CABLE_SAFETY_DEPTH, CABLE_LENGTH, BEND_RADIUS",
);
const UNITS: [&str; 5] = ["U", "INCH", "MM", "M", "DEG"];
const UNIT: Kind = Kind::Enum(
    &UNITS,
    "Unité invalide. Valeurs acceptées : U, INCH, MM, M, DEG",
);
const VALUE: Kind = Kind::NumPosMsg("La valeur doit être positive");

static CREATE: [Field; 6] = [
    Field::new("category", CATEGORY).required(),
    Field::new("value", VALUE).required(),
    Field::new("unit", UNIT).required(),
    Field::new("isReel", Kind::Bool).or(Def::False),
    Field::new("sortOrder", Kind::Int).or(Def::Zero),
    Field::new("isActive", Kind::Bool).or(Def::True),
];

static PATCH: [Field; 6] = [
    Field::new("category", CATEGORY),
    Field::new("value", VALUE),
    Field::new("unit", UNIT),
    Field::new("isReel", Kind::Bool),
    Field::new("sortOrder", Kind::Int),
    Field::new("isActive", Kind::Bool),
];

static RES: Res = Res {
    table: Table {
        name: "TenantDimensionPreset",
        bools: &["isReel", "isActive"],
        jsons: &[],
    },
    entity: "tenant_parametres_dimensions",
    audit: "tenant_dimension_preset",
    audit_type: "TenantDimensionPreset",
    not_found: "Preset de dimension introuvable.",
    unique_msg: "Une dimension avec cette valeur existe déjà dans cette catégorie.",
    domain: Domain::Settings,
    create: &CREATE,
    patch: &PATCH,
};

struct H;
impl Hooks for H {}

/// Bare array, like arkyo.
pub async fn list(State(st): State<AppState>, _u: CurrentUser) -> Response {
    match list_rows(
        &st.pool,
        &RES.table,
        r#"WHERE "isActive" = 1"#,
        r#""category", "sortOrder", "value""#,
    )
    .await
    {
        Ok(rows) => Json(objs(rows)).into_response(),
        Err(e) => db_error(e),
    }
}

pub async fn create(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    super::create(&st, &u, &RES, &H, body).await
}

pub async fn update(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    super::patch_row(&st, &u, &RES, &H, &id, body).await
}

pub async fn delete(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    super::remove(&st, &u, &RES, &NoHooks, &id).await
}

/// `POST /dimensions/restore-arkyo`: puts back the seeded presets that are
/// missing (by id or by (category, value, unit)); existing ones are kept.
/// Audit row and event only when something was restored.
pub async fn restore(State(st): State<AppState>, CurrentUser(u): CurrentUser) -> Response {
    let run = async {
        require(&u, &st.pool, Domain::Settings, Level::Write).await?;
        let mut tx = super::begin(&st.pool).await?;
        let applied = seeds::apply_in(&mut tx, SeedMode::Restore(SeedKind::Dimensions))
            .await
            .map_err(|e| {
                tracing::error!("restore dimensions: {e:#}");
                crate::http::server_error()
            })?;
        let n = applied.get(SeedKind::Dimensions);
        if n > 0 {
            audit::log(
                &mut tx,
                &u.id,
                "tenant_dimension_preset.restore_arkyo",
                "TenantDimensionPreset",
                "bulk_restore",
                None,
                None,
                Some(json!({ "restored": n })),
            )
            .await
            .map_err(db_error)?;
        }
        tx.commit().await.map_err(db_error)?;
        if n > 0 {
            st.events.publish(RES.entity, "restore", Some("bulk"));
        }
        Ok::<Response, Response>(Json(json!({ "restored": n })).into_response())
    };
    run.await.unwrap_or_else(|r| r)
}
