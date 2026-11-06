//! arkyo:app/api/tenant/catalogue/adapters/{route,[id]/route,[id]/duplicate,
//! [id]/restore,bulk-delete,check-duplicate}.ts, with the editor payload of
//! arkyo:app/(app)/admin/catalogue/adapters/[id]/page.tsx.
//!
//! The write flow is in [`super::shared`]; this file has the adapter schemas
//! and the reads (list, detail).

use std::collections::HashMap;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

use super::shared::{self, Spec, Usage};
use crate::catalogue::enrich::{by_id, lookup, personal_flags, ADAPTER, FUNCTION};
use crate::http::parametres::{db_error, get_row, str_of, Def, Field, Kind, Obj};
use crate::http::{error, AppState, CurrentUser};

const fn s(name: &'static str) -> Field {
    Field::new(name, Kind::Str).nullable()
}

/// `adapterWriteSchema`.
static CREATE: [Field; 8] = [
    Field::new("name", Kind::NonEmpty).required(),
    s("reference"),
    s("functionId"),
    Field::new("inputs", Kind::AnyArr)
        .nullable()
        .or(Def::EmptyArr),
    Field::new("outputs", Kind::AnyArr)
        .nullable()
        .or(Def::EmptyArr),
    s("notes"),
    s("imageUrl"),
    Field::new("isActive", Kind::Bool).or(Def::True),
];

/// `adapterPatchSchema`: everything optional.
static PATCH: [Field; 8] = [
    Field::new("name", Kind::NonEmpty),
    s("reference"),
    s("functionId"),
    Field::new("inputs", Kind::AnyArr).nullable(),
    Field::new("outputs", Kind::AnyArr).nullable(),
    s("notes"),
    s("imageUrl"),
    Field::new("isActive", Kind::Bool),
];

static SPEC: Spec = Spec {
    table: &ADAPTER,
    audit_type: "TenantAdapter",
    not_found: "Adaptateur personnel introuvable",
    missing: "Adaptateur introuvable",
    // arkyo-server: correction (les inventaires comptent aussi, voir `in_use::adapter`)
    usage_unit: "synoptique(s) ou inventaire(s)",
    usage: Usage::Adapter,
    create: &CREATE,
    patch: &PATCH,
    copied: &[
        "name",
        "reference",
        "functionId",
        "inputs",
        "outputs",
        "notes",
        "imageUrl",
    ],
};

/// Adds `function` (the whole row, or null when the id is unknown).
async fn resolve(st: &AppState, rows: &mut [Obj]) -> Result<(), sqlx::Error> {
    let functions = by_id(&st.pool, FUNCTION).await?;
    for r in rows {
        let f = lookup(&functions, str_of(r, "functionId"));
        r.insert("function".into(), f);
    }
    Ok(())
}

// ── GET /adapters ───────────────────────────────────────────────────────────

/// `{arkyo: [], personal}`. `scope` and `ids` only ever concerned arkyo's own
/// catalogue: the Arkyo side is always empty and `personal` is the same list.
pub async fn list(
    State(st): State<AppState>,
    _u: CurrentUser,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let run = async {
        let mut rows = shared::list_personal(&st, &SPEC, &q, r#""createdAt" DESC, "id""#).await?;
        resolve(&st, &mut rows).await?;
        rows.iter_mut().for_each(personal_flags);
        Ok::<_, sqlx::Error>(rows)
    };
    match run.await {
        Ok(rows) => Json(json!({
            "arkyo": [],
            "personal": rows.into_iter().map(Value::Object).collect::<Vec<_>>(),
        }))
        .into_response(),
        Err(e) => db_error(e),
    }
}

// ── GET /adapters/{id} ──────────────────────────────────────────────────────

/// `{source, isAccessible, item}` where `item` is the row with `function`
/// (what the editor page hands to the editor) plus the drift flags.
pub async fn detail(
    State(st): State<AppState>,
    _u: CurrentUser,
    Path(id): Path<String>,
) -> Response {
    let run = async {
        let mut conn = st.pool.acquire().await?;
        let row = get_row(&mut conn, &ADAPTER, &id).await?;
        drop(conn);
        let Some(row) = row else {
            return Ok(None);
        };
        let mut rows = [row];
        resolve(&st, &mut rows).await?;
        let [mut row] = rows;
        row.insert("arkyoDrift".into(), false.into());
        row.insert("arkyoSourceGone".into(), false.into());
        Ok::<_, sqlx::Error>(Some(row))
    };
    match run.await {
        Ok(Some(item)) => Json(json!({ "source": "PERSONAL", "isAccessible": true, "item": item }))
            .into_response(),
        Ok(None) => error(StatusCode::NOT_FOUND, SPEC.missing),
        Err(e) => db_error(e),
    }
}

// ── writes ──────────────────────────────────────────────────────────────────

pub async fn create(State(st): State<AppState>, CurrentUser(u): CurrentUser, b: Bytes) -> Response {
    shared::create(&st, &u, &SPEC, b).await
}

pub async fn update(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
    b: Bytes,
) -> Response {
    shared::update(&st, &u, &SPEC, &id, b).await
}

pub async fn delete(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    shared::delete(&st, &u, &SPEC, &id).await
}

pub async fn duplicate(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    shared::duplicate(&st, &u, &SPEC, &id).await
}

pub async fn restore(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(_id): Path<String>,
) -> Response {
    shared::restore(&st, &u).await
}

pub async fn bulk_delete(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    b: Bytes,
) -> Response {
    shared::bulk_delete(&st, &u, &SPEC, b).await
}

pub async fn check_duplicate(
    State(st): State<AppState>,
    _u: CurrentUser,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    shared::check_duplicate(&st, &SPEC, &q).await
}
