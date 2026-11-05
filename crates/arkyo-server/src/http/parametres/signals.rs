//! arkyo:app/api/tenant/parametres/signals/{route,[id]/route}.ts
//!
//! arkyo guards these routes with `design:write` (not `settings:write`) and
//! deletes without any usage check; both are kept.

use arkyo_core::permissions::Domain;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::Value;
use sqlx::SqliteConnection;

use super::{
    arkyo_personal, case_only_duplicate, db_error, list_rows, str_of, Def, Field, Fut, Hooks, Kind,
    Obj, Res, Table, NAME,
};
use crate::http::{AppState, CurrentUser};

static CREATE: [Field; 14] = [
    Field::new("name", NAME).required(),
    Field::new("color", Kind::Str).nullable(),
    Field::new("functionId", Kind::Str).nullable(),
    Field::new("cablePrefix", Kind::Str).nullable(),
    Field::new("cableSuffix", Kind::Str).nullable(),
    Field::new("bandwidth", Kind::Str).nullable(),
    Field::new("requiredImpedance", Kind::NumNonNeg).nullable(),
    Field::new("minBandwidthMHz", Kind::NumNonNeg).nullable(),
    Field::new("connectorIds", Kind::StrArr).or(Def::EmptyArr),
    Field::new("isIp", Kind::Bool).or(Def::False),
    Field::new("supportsRedundancy", Kind::Bool).or(Def::False),
    Field::new("redundancyStyle", Kind::Str).nullable(),
    Field::new("usesMulticast", Kind::Bool).or(Def::False),
    Field::new("isActive", Kind::Bool).or(Def::True),
];

static PATCH: [Field; 14] = [
    Field::new("name", NAME),
    Field::new("color", Kind::Str).nullable(),
    Field::new("functionId", Kind::Str).nullable(),
    Field::new("cablePrefix", Kind::Str).nullable(),
    Field::new("cableSuffix", Kind::Str).nullable(),
    Field::new("bandwidth", Kind::Str).nullable(),
    Field::new("requiredImpedance", Kind::NumNonNeg).nullable(),
    Field::new("minBandwidthMHz", Kind::NumNonNeg).nullable(),
    Field::new("connectorIds", Kind::StrArr),
    Field::new("isIp", Kind::Bool),
    Field::new("supportsRedundancy", Kind::Bool),
    Field::new("redundancyStyle", Kind::Str).nullable(),
    Field::new("usesMulticast", Kind::Bool),
    Field::new("isActive", Kind::Bool),
];

pub static RES: Res = Res {
    table: Table {
        name: "TenantSignalType",
        bools: &[
            "isIp",
            "supportsRedundancy",
            "usesMulticast",
            "isDefault",
            "isActive",
        ],
        jsons: &["connectorIds"],
    },
    entity: "tenant_parametres_signals",
    audit: "tenant_signal_type",
    audit_type: "TenantSignalType",
    not_found: "Type de signal introuvable.",
    unique_msg: "Un type de signal avec ce nom existe déjà dans votre espace.",
    domain: Domain::Design,
    create: &CREATE,
    patch: &PATCH,
};

struct H;

impl Hooks for H {
    fn check<'a>(
        &'a self,
        conn: &'a mut SqliteConnection,
        body: &'a mut Obj,
        existing: Option<&'a Obj>,
    ) -> Fut<'a, Result<(), Response>> {
        Box::pin(async move {
            if let Some(name) = str_of(body, "name") {
                let own = existing.and_then(|e| str_of(e, "id"));
                case_only_duplicate(
                    conn,
                    "TenantSignalType",
                    "name",
                    name.trim(),
                    own,
                    "Un signal portant ce nom existe déjà dans le catalogue Arkyo.",
                )
                .await?;
            }
            Ok(())
        })
    }
}

pub async fn list(State(st): State<AppState>, _u: CurrentUser) -> Response {
    match list_rows(
        &st.pool,
        &RES.table,
        r#"WHERE "isActive" = 1"#,
        r#""name" COLLATE NOCASE"#,
    )
    .await
    {
        Ok(rows) => Json::<Value>(arkyo_personal(rows)).into_response(),
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
    super::remove(&st, &u, &RES, &super::NoHooks, &id).await
}
