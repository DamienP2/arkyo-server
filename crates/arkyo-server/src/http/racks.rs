//! Containers: arkyo:app/api/racks/route.ts (`GET`, `POST`) and
//! arkyo:app/api/racks/[id]/route.ts (`PATCH`, `DELETE`).
//!
//! Validation errors use Zod's `{ error: flatten() }`, as arkyo.

#![allow(clippy::result_large_err)]

use std::collections::{BTreeMap, HashMap};

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::parametres::{
    begin, bind, db_error, failure, js_type, parse_body, validate_flat, Def, Field, Kind, Obj,
};
use super::{client_id, error, require, AppState, CurrentUser};
use crate::audit;
use crate::events::EventMeta;
use crate::ids::{new_id, now_iso};
use crate::projects::enrich;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/racks", get(list).post(create))
        .route("/racks/{id}", patch(update).delete(remove))
}

pub(crate) const RACK_TYPES: &[&str] = &[
    "STANDARD",
    "FLIGHT_CASE_CLASSIC",
    "FLIGHT_CASE_SKB",
    "PELICAN",
    "CAP",
];
pub(crate) const RACK_TYPE_MSG: &str = r#"Invalid option: expected one of "STANDARD"|"FLIGHT_CASE_CLASSIC"|"FLIGHT_CASE_SKB"|"PELICAN"|"CAP""#;
const TEMPLATE_STATUSES: &[&str] = &["BROUILLON", "INACTIF", "ACTIF"];
const TEMPLATE_STATUS_MSG: &str =
    r#"Invalid option: expected one of "BROUILLON"|"INACTIF"|"ACTIF""#;

/// `createSchema` (route.ts:11-27).
static CREATE: [Field; 13] = [
    Field::new("name", Kind::NonEmpty).required(),
    Field::new("totalU", Kind::IntRange(1, 56)).or(Def::Int(42)),
    Field::new("depthMm", Kind::IntPos).or(Def::Int(600)),
    Field::new("rearInteriorGapMm", Kind::IntMin(0)).nullable(),
    Field::new("maxWeightKg", Kind::NumPos),
    Field::new("maxPowerW", Kind::NumPos),
    Field::new("emptyWeightKg", Kind::NumPos),
    Field::new("notes", Kind::Str),
    Field::new("rackType", Kind::Enum(RACK_TYPES, RACK_TYPE_MSG)),
    Field::new("hasWheels", Kind::Bool),
    Field::new("isRackable", Kind::Bool),
    Field::new("widthMm", Kind::IntPos),
    Field::new("heightMm", Kind::IntPos),
];

/// `updateSchema` ([id]/route.ts:28-44); `numberingOverride` is checked by
/// [`NUMBERING`].
static UPDATE: [Field; 13] = [
    Field::new("name", Kind::NonEmpty),
    Field::new("totalU", Kind::IntRange(1, 56)),
    Field::new("depthMm", Kind::IntPos),
    Field::new("maxWeightKg", Kind::Num).nullable(),
    Field::new("maxPowerW", Kind::Num).nullable(),
    Field::new("emptyWeightKg", Kind::Num).nullable(),
    Field::new("notes", Kind::Str),
    Field::new("rearInteriorGapMm", Kind::IntMin(0)).nullable(),
    Field::new("rackType", Kind::Enum(RACK_TYPES, RACK_TYPE_MSG)),
    Field::new("hasWheels", Kind::Bool),
    Field::new("cableCode", Kind::MaxLen(5)).nullable(),
    Field::new("numberingOverride", Kind::Any).nullable(),
    Field::new(
        "templateStatus",
        Kind::Enum(TEMPLATE_STATUSES, TEMPLATE_STATUS_MSG),
    ),
];

/// `numberingOverrideSchema` ([id]/route.ts:13-26), every key optional.
static NUMBERING: [Field; 9] = [
    Field::new("includeRack", Kind::Bool),
    Field::new("pad", Kind::IntRange(3, 10)),
    Field::new("sep1", Kind::MaxLen(5)),
    Field::new("sep2", Kind::MaxLen(5)),
    Field::new("template", Kind::MaxLen(500)),
    Field::new("templateEnabled", Kind::Bool),
    // Compat legacy
    Field::new("includeZone", Kind::Bool),
    Field::new("separator", Kind::Str),
    Field::new("suffixSeparator", Kind::Str),
];

/// `parsed.error.flatten()`: form errors and errors by field.
type Flat = (Vec<String>, BTreeMap<String, Vec<String>>);

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Not found")
}

/// The rack `id` as the routes return it (enriched slots and rigs).
async fn enriched(conn: &mut SqliteConnection, id: &str) -> Result<Option<Obj>, sqlx::Error> {
    Ok(
        enrich::racks(conn, r#"WHERE r."id" = ?"#, &[id], r#"r."id""#)
            .await?
            .into_iter()
            .next(),
    )
}

// ── GET /api/racks ──────────────────────────────────────────────────────────

/// Session only. Every rack (createdAt desc), or with `?unassigned=true`
/// the racks of no rig (of no rig `rigConfigId` when given).
///
/// `?templates=true` answers the container library instead.
pub async fn list(
    State(st): State<AppState>,
    _u: CurrentUser,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let flag = |k: &str| q.get(k).map(String::as_str) == Some("true");
    let rig = q.get("rigConfigId").map(String::as_str);
    let (filter, binds, order): (&str, Vec<&str>, &str) = if flag("templates") {
        // arkyo-server: données de la page serveur d'arkyo
        // (app/(app)/templates/page.tsx:27-37) : les racks qu'aucune régie de
        // projet n'utilise, par date de modification.
        (
            r#"WHERE NOT EXISTS (SELECT 1 FROM "RigRack" rr JOIN "RigConfig" g ON g."id" = rr."rigConfigId"
                                 WHERE rr."rackId" = r."id" AND g."projectId" IS NOT NULL)"#,
            vec![],
            r#"r."updatedAt" DESC, r."id" DESC"#,
        )
    } else if flag("unassigned") {
        match rig {
            Some(rig) => (
                r#"WHERE NOT EXISTS (SELECT 1 FROM "RigRack" rr WHERE rr."rackId" = r."id" AND rr."rigConfigId" = ?)"#,
                vec![rig],
                r#"r."createdAt" DESC, r."id" DESC"#,
            ),
            None => (
                r#"WHERE NOT EXISTS (SELECT 1 FROM "RigRack" rr WHERE rr."rackId" = r."id")"#,
                vec![],
                r#"r."createdAt" DESC, r."id" DESC"#,
            ),
        }
    } else {
        ("", vec![], r#"r."createdAt" DESC, r."id" DESC"#)
    };
    let mut conn = match st.pool.acquire().await {
        Ok(c) => c,
        Err(e) => return db_error(e),
    };
    match enrich::racks(&mut conn, filter, &binds, order).await {
        Ok(racks) => {
            Json(Value::Array(racks.into_iter().map(Value::Object).collect())).into_response()
        }
        Err(e) => db_error(e),
    }
}

// ── POST /api/racks ─────────────────────────────────────────────────────────

pub async fn create(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    body: Bytes,
) -> Response {
    create_inner(&st, &me, body).await.unwrap_or_else(|r| r)
}

async fn create_inner(
    st: &AppState,
    me: &crate::users::User,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let mut vals = validate_flat(&parse_body(&body)?, &CREATE).map_err(failure)?;
    for f in &CREATE {
        if !vals.contains_key(f.name) && !matches!(f.default, Def::Null) {
            vals.insert(f.name.into(), f.default.value());
        }
    }

    let mut tx = begin(&st.pool).await?;
    // First free number of [1..9, 0], else 0 (route.ts:146-149).
    let used: Vec<i64> =
        sqlx::query_scalar(r#"SELECT "cableId" FROM "Rack" WHERE "cableId" IS NOT NULL"#)
            .fetch_all(&mut *tx)
            .await
            .map_err(db_error)?;
    let cable_id = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
        .into_iter()
        .find(|n| !used.contains(n))
        .unwrap_or(0);

    let id = new_id();
    let now = now_iso();
    let cols: Vec<&str> = CREATE
        .iter()
        .map(|f| f.name)
        .filter(|n| vals.contains_key(*n))
        .collect();
    let sql = format!(
        r#"INSERT INTO "Rack" ("id", "cableId", "createdAt", "updatedAt", {}) VALUES (?, ?, ?, ?, {})"#,
        cols.iter()
            .map(|c| format!(r#""{c}""#))
            .collect::<Vec<_>>()
            .join(", "),
        vec!["?"; cols.len()].join(", ")
    );
    let mut q = sqlx::query(&sql)
        .bind(&id)
        .bind(cable_id)
        .bind(&now)
        .bind(&now);
    for c in &cols {
        q = bind(q, &vals[*c]);
    }
    q.execute(&mut *tx).await.map_err(db_error)?;

    audit::log(
        &mut tx,
        &me.id,
        "rack.create",
        "Rack",
        &id,
        None,
        None,
        None,
    )
    .await
    .map_err(db_error)?;
    let rack = enriched(&mut tx, &id)
        .await
        .map_err(db_error)?
        .ok_or_else(not_found)?;
    tx.commit().await.map_err(db_error)?;
    st.events.publish("rack", "created", Some(&id));
    Ok((StatusCode::CREATED, Json(Value::Object(rack))).into_response())
}

// ── PATCH /api/racks/:id ────────────────────────────────────────────────────

/// `updateSchema.safeParse(body)`: the sent fields, `numberingOverride`
/// stripped to its schema's keys; its nested errors are listed under its
/// own key, as `flatten()` does.
fn parse_update(body: &Value) -> Result<Obj, Flat> {
    let (mut form, mut by_field): Flat = (Vec::new(), BTreeMap::new());
    let mut vals = match validate_flat(body, &UPDATE) {
        Ok(v) => v,
        Err((f, b)) => {
            form = f;
            by_field = b;
            Obj::new()
        }
    };
    if let Some(nested) = body.get("numberingOverride").filter(|v| !v.is_null()) {
        match nested {
            Value::Object(_) => match validate_flat(nested, &NUMBERING) {
                Ok(clean) => {
                    vals.insert("numberingOverride".into(), Value::Object(clean));
                }
                Err((_, errs)) => {
                    let msgs = NUMBERING
                        .iter()
                        .flat_map(|f| errs.get(f.name).cloned().unwrap_or_default());
                    by_field
                        .entry("numberingOverride".into())
                        .or_default()
                        .extend(msgs);
                }
            },
            other => by_field
                .entry("numberingOverride".into())
                .or_default()
                .push(format!(
                    "Invalid input: expected object, received {}",
                    js_type(Some(other))
                )),
        }
    }
    if form.is_empty() && by_field.is_empty() {
        Ok(vals)
    } else {
        Err((form, by_field))
    }
}

/// `cableCode` as arkyo stores it: upper case, `A-Z0-9` only, 5 characters
/// at most, `null` when nothing is left ([id]/route.ts:67-76).
fn normalize_cable_code(code: &str) -> Option<String> {
    let s: String = code
        .to_uppercase()
        .chars()
        .filter(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        .take(5)
        .collect();
    (!s.is_empty()).then_some(s)
}

pub async fn update(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    update_inner(&st, &me, &id, &headers, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn update_inner(
    st: &AppState,
    me: &crate::users::User,
    id: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    let mut vals = parse_update(&parse_body(&body)?).map_err(failure)?;
    if let Some(code) = vals.get("cableCode").and_then(Value::as_str) {
        let code = normalize_cable_code(code).map_or(Value::Null, Value::String);
        vals.insert("cableCode".into(), code);
    }

    let mut tx = begin(&st.pool).await?;
    // arkyo-server: un rack inconnu donne 404 « Not found » ; Prisma levait
    // une erreur (500) dans arkyo.
    if enrich::rack_row(&mut tx, id)
        .await
        .map_err(db_error)?
        .is_none()
    {
        return Err(not_found());
    }
    let cols: Vec<&str> = UPDATE
        .iter()
        .map(|f| f.name)
        .filter(|n| vals.contains_key(*n))
        .collect();
    let sets: String = cols.iter().map(|c| format!(r#", "{c}" = ?"#)).collect();
    let sql = format!(r#"UPDATE "Rack" SET "updatedAt" = ?{sets} WHERE "id" = ?"#);
    let mut q = sqlx::query(&sql).bind(now_iso());
    for c in &cols {
        q = bind(q, &vals[*c]);
    }
    q.bind(id).execute(&mut *tx).await.map_err(db_error)?;

    audit::log(&mut tx, &me.id, "rack.update", "Rack", id, None, None, None)
        .await
        .map_err(db_error)?;
    let rack = enriched(&mut tx, id)
        .await
        .map_err(db_error)?
        .ok_or_else(not_found)?;
    tx.commit().await.map_err(db_error)?;
    st.events.publish_meta(
        "rack",
        "updated",
        Some(id),
        EventMeta {
            rack_id: Some(id.to_string()),
            client_id: client,
            ..EventMeta::default()
        },
    );
    Ok(Json(Value::Object(rack)).into_response())
}

// ── DELETE /api/racks/:id ───────────────────────────────────────────────────

pub async fn remove(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    remove_inner(&st, &me, &id, &headers)
        .await
        .unwrap_or_else(|r| r)
}

async fn remove_inner(
    st: &AppState,
    me: &crate::users::User,
    id: &str,
    headers: &HeaderMap,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:admin).
    require(me, &st.pool, Domain::Design, Level::Admin).await?;
    let client = client_id::read(headers);
    let mut tx = begin(&st.pool).await?;
    let gone = sqlx::query(r#"DELETE FROM "Rack" WHERE "id" = ?"#)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?
        .rows_affected();
    // arkyo-server: un rack inconnu donne 404 « Not found » ; Prisma levait
    // une erreur (500) dans arkyo.
    if gone == 0 {
        return Err(not_found());
    }
    audit::log(&mut tx, &me.id, "rack.delete", "Rack", id, None, None, None)
        .await
        .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    st.events.publish_meta(
        "rack",
        "deleted",
        Some(id),
        EventMeta {
            rack_id: Some(id.to_string()),
            client_id: client,
            ..EventMeta::default()
        },
    );
    Ok(Json(json!({ "ok": true })).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cable_code_like_arkyo() {
        assert_eq!(normalize_cable_code("a-b 1").as_deref(), Some("AB1"));
        assert_eq!(normalize_cable_code("abcdefg").as_deref(), Some("ABCDE"));
        assert_eq!(normalize_cable_code("ß1").as_deref(), Some("SS1"));
        assert_eq!(normalize_cable_code("é-_"), None);
        assert_eq!(normalize_cable_code(""), None);
    }
}
