//! arkyo:app/api/tenant/catalogue/cables/{route,[id]/route,lengths,
//! [id]/duplicate,[id]/restore,bulk-delete,check-duplicate}.ts, with the
//! editor payload of arkyo:app/(app)/admin/catalogue/cables/[id]/page.tsx.
//!
//! The write flow is in [`super::shared`]; this file has the cable schemas
//! and the reads (list, `?kind=model`, detail, lengths).

use std::collections::HashMap;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

use super::shared::{self, Spec, Usage};
use crate::catalogue::enrich::{
    by_id, lookup, personal_flags, BRAND, CABLE, CABLE_MODEL, CONNECTOR_TYPE, FUNCTION,
};
use crate::http::parametres::{db_error, fold, get_row, list_rows, str_of, Def, Field, Kind, Obj};
use crate::http::{error, AppState, CurrentUser};

const fn s(name: &'static str) -> Field {
    Field::new(name, Kind::Str).nullable()
}
const fn num(name: &'static str) -> Field {
    Field::new(name, Kind::Num).nullable()
}

/// `cableWriteSchema`. `cableModelId` is only in the create schema: arkyo's
/// PATCH schema has no such key, so Zod strips it.
static CREATE: [Field; 18] = [
    Field::new("name", Kind::NonEmpty).required(),
    s("reference"),
    s("leftConnectorId"),
    s("leftGender"),
    s("rightConnectorId"),
    s("rightGender"),
    s("functionId"),
    s("brandId"),
    s("model"),
    s("cableModelId"),
    Field::new("useCases", Kind::StrArr)
        .nullable()
        .or(Def::EmptyArr),
    Field::new("availableLengths", Kind::NumArr)
        .nullable()
        .or(Def::EmptyArr),
    num("customMinLength"),
    num("customMaxLength"),
    s("notes"),
    s("imageUrl"),
    Field::new("isActive", Kind::Bool).or(Def::True),
    Field::new("sortOrder", Kind::Int).or(Def::Zero),
];

/// `cablePatchSchema`: everything optional, no `cableModelId`.
static PATCH: [Field; 17] = [
    Field::new("name", Kind::NonEmpty),
    s("reference"),
    s("leftConnectorId"),
    s("leftGender"),
    s("rightConnectorId"),
    s("rightGender"),
    s("functionId"),
    s("brandId"),
    s("model"),
    Field::new("useCases", Kind::StrArr).nullable(),
    Field::new("availableLengths", Kind::NumArr).nullable(),
    num("customMinLength"),
    num("customMaxLength"),
    s("notes"),
    s("imageUrl"),
    Field::new("isActive", Kind::Bool),
    Field::new("sortOrder", Kind::Int),
];

static SPEC: Spec = Spec {
    table: &CABLE,
    audit_type: "TenantCable",
    not_found: "Cordon personnel introuvable",
    missing: "Cordon introuvable",
    usage_unit: "connexion(s)",
    // arkyo-server: garde déplacée vers le modèle de câble (4c, décision 2,
    // voir `catalogue::in_use::cable`) : plus aucun usage compté ici.
    usage: Usage::Cable,
    create: &CREATE,
    patch: &PATCH,
    // arkyo's duplicate list: no `cableModelId`.
    copied: &[
        "name",
        "reference",
        "leftConnectorId",
        "leftGender",
        "rightConnectorId",
        "rightGender",
        "functionId",
        "brandId",
        "model",
        "useCases",
        "availableLengths",
        "customMinLength",
        "customMaxLength",
        "notes",
        "imageUrl",
    ],
};

/// Adds `function`, `brand`, `leftConnector` and `rightConnector` (the whole
/// referential row, or null when the id is unknown).
async fn resolve(st: &AppState, rows: &mut [Obj]) -> Result<(), sqlx::Error> {
    let functions = by_id(&st.pool, FUNCTION).await?;
    let brands = by_id(&st.pool, BRAND).await?;
    let connectors = by_id(&st.pool, CONNECTOR_TYPE).await?;
    for r in rows {
        let (f, b) = (str_of(r, "functionId"), str_of(r, "brandId"));
        let (l, rt) = (str_of(r, "leftConnectorId"), str_of(r, "rightConnectorId"));
        let vals = [
            ("function", lookup(&functions, f)),
            ("brand", lookup(&brands, b)),
            ("leftConnector", lookup(&connectors, l)),
            ("rightConnector", lookup(&connectors, rt)),
        ];
        for (k, v) in vals {
            r.insert(k.into(), v);
        }
    }
    Ok(())
}

// ── GET /cables ─────────────────────────────────────────────────────────────

/// `{arkyo: [], personal}`, or with `?kind=model` the bare array of cable
/// models. `scope` has no effect: there is only one catalogue.
pub async fn list(
    State(st): State<AppState>,
    _u: CurrentUser,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let run = async {
        if q.get("kind").map(String::as_str) == Some("model") {
            return models(&st, &q).await.map(|m| Json(Value::Array(m)));
        }
        let mut rows =
            shared::list_personal(&st, &SPEC, &q, r#""sortOrder", "createdAt" DESC, "id""#).await?;
        resolve(&st, &mut rows).await?;
        rows.iter_mut().for_each(personal_flags);
        Ok::<_, sqlx::Error>(Json(json!({
            "arkyo": [],
            "personal": rows.into_iter().map(Value::Object).collect::<Vec<_>>(),
        })))
    };
    match run.await {
        Ok(j) => j.into_response(),
        Err(e) => db_error(e),
    }
}

/// Active cable models, `sortOrder` then name, with their `brand`.
async fn models(st: &AppState, q: &HashMap<String, String>) -> Result<Vec<Value>, sqlx::Error> {
    let mut rows = list_rows(
        &st.pool,
        CABLE_MODEL,
        r#"WHERE "isActive" = 1"#,
        r#""sortOrder", "name" COLLATE NOCASE, "id""#,
    )
    .await?;
    if let Some(needle) = q.get("q").filter(|s| !s.is_empty()) {
        let n = fold(needle);
        rows.retain(|r| fold(str_of(r, "name").unwrap_or("")).contains(&n));
    }
    let brands = by_id(&st.pool, BRAND).await?;
    Ok(rows
        .into_iter()
        .map(|mut r| {
            let b = lookup(&brands, str_of(&r, "brandId"));
            r.insert("brand".into(), b);
            Value::Object(r)
        })
        .collect())
}

// ── GET /cables/{id} ────────────────────────────────────────────────────────

/// `{source, isAccessible, item}` where `item` is what the editor page hands
/// to the editor: the row with `function`, `brand`, `leftConnector` and
/// `rightConnector`, plus the (always false) drift flags of the route.
pub async fn detail(
    State(st): State<AppState>,
    _u: CurrentUser,
    Path(id): Path<String>,
) -> Response {
    let run = async {
        let mut conn = st.pool.acquire().await?;
        let row = get_row(&mut conn, &CABLE, &id).await?;
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

// ── GET /cables/lengths ─────────────────────────────────────────────────────

/// Sorted union of the positive `availableLengths` of every cable (inactive
/// ones included, like arkyo).
pub async fn lengths(State(st): State<AppState>, _u: CurrentUser) -> Response {
    let run = async {
        let rows = list_rows(&st.pool, &CABLE, "", r#""id""#).await?;
        let mut all: Vec<f64> = rows
            .iter()
            .filter_map(|r| r.get("availableLengths")?.as_array())
            .flatten()
            .filter_map(Value::as_f64)
            .filter(|v| *v > 0.0)
            .collect();
        all.sort_by(f64::total_cmp);
        all.dedup();
        Ok::<_, sqlx::Error>(all)
    };
    match run.await {
        Ok(all) => Json(
            all.into_iter()
                .map(|v| {
                    // 5.0 is sent as 5, like JavaScript's JSON.stringify
                    if v.fract() == 0.0 && v < 1e15 {
                        Value::from(v as i64)
                    } else {
                        Value::from(v)
                    }
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
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
