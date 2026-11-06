//! Construction checks and canvas position of a rack:
//! arkyo:app/api/racks/[id]/construction-checks/route.ts (`GET`, `PATCH`) and
//! arkyo:app/api/racks/[id]/canvas-position/route.ts (`PATCH`).
//!
//! Construction checks: `PATCH` takes a discriminated union on `action`
//! (`toggle` adds or removes one id, `set` replaces the list, `clear` empties
//! it). arkyo writes `Prisma.JsonNull` when the list becomes empty: the
//! column (`NOT NULL DEFAULT '[]'`) then holds the JSON text `null`, which
//! every read turns back into `[]` (phase-4 inventory §0.18, decision 2 of
//! the 4b plan). Audit `rack.constructionChecks.update` `{action, count}`;
//! rack bus `{type: "construction_checks_updated"}` only, no app event, no
//! `clientId`.
//!
//! Canvas position: `canvasX` / `canvasY` rounded like `Math.round`, `null`
//! clears, an absent key is kept. App bus `rack updated` with
//! `{rackId, itemId, clientId}`, no rack event, no audit.
//!
//! arkyo-server:
//! - mode fantôme SaaS retiré (`assertNotGhost`, 403 « Mode lecture seule ») ;
//! - garde serveur `design:write` sur les `PATCH` (arkyo : session seule) ;
//! - `PATCH` des contrôles en une transaction `BEGIN IMMEDIATE`, audit
//!   compris (arkyo : lecture puis écriture sans transaction, course
//!   possible sur `toggle`) ;
//! - corps illisible des contrôles : 400 au lieu du 500 de `req.json()` ;
//! - position hors de l'entier 32 bits de Prisma (`Int`) : 400 au lieu du
//!   500 de Prisma.

#![allow(clippy::result_large_err)]

use std::collections::BTreeMap;

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::parametres::{begin, db_error, failure, js_type, parse_body};
use super::projects::lenient_body;
use super::{client_id, error, require, AppState, CurrentUser};
use crate::audit;
use crate::events::EventMeta;
use crate::ids::now_iso;
use crate::users::User;

/// Zod's `flatten()`: form errors and errors by field.
type Flat = (Vec<String>, BTreeMap<String, Vec<String>>);

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/racks/{id}/construction-checks",
            get(get_checks).patch(patch_checks),
        )
        .route("/racks/{id}/canvas-position", patch(patch_position))
}

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Not found")
}

/// `Array.isArray(v) ? v : []` on the stored JSON: the `null` of an emptied
/// list (or unreadable text) reads as `[]`.
fn as_checks(raw: &str) -> Vec<Value> {
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Array(a)) => a,
        _ => Vec::new(),
    }
}

/// The stored `constructionChecks` of rack `id`, `None` when it does not
/// exist.
async fn stored_checks(
    conn: &mut SqliteConnection,
    id: &str,
) -> Result<Option<Vec<Value>>, Response> {
    let raw: Option<String> =
        sqlx::query_scalar(r#"SELECT "constructionChecks" FROM "Rack" WHERE "id" = ?"#)
            .bind(id)
            .fetch_optional(conn)
            .await
            .map_err(db_error)?;
    Ok(raw.as_deref().map(as_checks))
}

// ── GET /api/racks/:id/construction-checks ──────────────────────────────────

pub async fn get_checks(
    State(st): State<AppState>,
    _u: CurrentUser,
    Path(id): Path<String>,
) -> Response {
    let run = async {
        let mut conn = st.pool.acquire().await.map_err(db_error)?;
        let checks = stored_checks(&mut conn, &id).await?.ok_or_else(not_found)?;
        Ok(Json(json!({ "checks": checks })).into_response())
    };
    run.await.unwrap_or_else(|r: Response| r)
}

// ── PATCH /api/racks/:id/construction-checks ────────────────────────────────

/// `patchSchema` (route.ts:10-14), parsed.
#[derive(Debug, PartialEq)]
enum ChecksInput {
    Toggle(String),
    Set(Vec<Value>),
    Clear,
}

impl ChecksInput {
    fn action(&self) -> &'static str {
        match self {
            ChecksInput::Toggle(_) => "toggle",
            ChecksInput::Set(_) => "set",
            ChecksInput::Clear => "clear",
        }
    }
}

/// `z.string().min(1).max(256)` (JavaScript length: UTF-16 code units).
fn check_id(v: Option<&Value>, errs: &mut Vec<String>) {
    match v {
        Some(Value::String(s)) => {
            let n = s.encode_utf16().count();
            if n < 1 {
                errs.push("Too small: expected string to have >=1 characters".into());
            }
            if n > 256 {
                errs.push("Too big: expected string to have <=256 characters".into());
            }
        }
        other => errs.push(format!(
            "Invalid input: expected string, received {}",
            js_type(other)
        )),
    }
}

/// `patchSchema.safeParse(body)` with Zod 4's messages, as `flatten()`
/// reports them: a body that is not an object is a form error, an unknown
/// `action` is `invalid_union` on `action` (« Invalid input »), the errors
/// of an array item land on `ids`. Extra keys are stripped.
fn parse_checks(body: &Value) -> Result<ChecksInput, Flat> {
    let Value::Object(obj) = body else {
        return Err((
            vec![format!(
                "Invalid input: expected object, received {}",
                js_type(Some(body))
            )],
            BTreeMap::new(),
        ));
    };
    let field = |name: &str, errs: Vec<String>| -> Flat {
        (Vec::new(), BTreeMap::from([(name.to_string(), errs)]))
    };
    match obj.get("action").and_then(Value::as_str) {
        Some("toggle") => {
            let mut errs = Vec::new();
            check_id(obj.get("id"), &mut errs);
            if errs.is_empty() {
                let id = obj["id"].as_str().unwrap_or_default().to_string();
                Ok(ChecksInput::Toggle(id))
            } else {
                Err(field("id", errs))
            }
        }
        Some("set") => {
            let Some(Value::Array(ids)) = obj.get("ids") else {
                return Err(field(
                    "ids",
                    vec![format!(
                        "Invalid input: expected array, received {}",
                        js_type(obj.get("ids"))
                    )],
                ));
            };
            let mut errs = Vec::new();
            for it in ids {
                check_id(Some(it), &mut errs);
            }
            if ids.len() > 10_000 {
                errs.push("Too big: expected array to have <=10000 items".into());
            }
            if errs.is_empty() {
                Ok(ChecksInput::Set(ids.clone()))
            } else {
                Err(field("ids", errs))
            }
        }
        Some("clear") => Ok(ChecksInput::Clear),
        _ => Err(field("action", vec!["Invalid input".into()])),
    }
}

pub async fn patch_checks(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    patch_checks_inner(&st, &me, &id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn patch_checks_inner(
    st: &AppState,
    me: &User,
    id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let input = parse_checks(&parse_body(&body)?).map_err(failure)?;

    let mut tx = begin(&st.pool).await?;
    let current = stored_checks(&mut tx, id).await?.ok_or_else(not_found)?;
    let next: Vec<Value> = match &input {
        ChecksInput::Toggle(c) => {
            let c = Value::String(c.clone());
            if current.contains(&c) {
                current.into_iter().filter(|x| *x != c).collect()
            } else {
                current.into_iter().chain([c]).collect()
            }
        }
        ChecksInput::Set(ids) => ids.clone(),
        ChecksInput::Clear => Vec::new(),
    };
    // `next.length === 0 ? Prisma.JsonNull : next` (route.ts:78-79).
    let stored = if next.is_empty() {
        "null".to_string()
    } else {
        Value::Array(next.clone()).to_string()
    };
    sqlx::query(r#"UPDATE "Rack" SET "constructionChecks" = ?, "updatedAt" = ? WHERE "id" = ?"#)
        .bind(&stored)
        .bind(now_iso())
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    audit::log(
        &mut tx,
        &me.id,
        "rack.constructionChecks.update",
        "Rack",
        id,
        None,
        None,
        Some(json!({ "action": input.action(), "count": next.len() })),
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    st.events
        .publish_rack(id, json!({ "type": "construction_checks_updated" }));
    // The update's own `constructionChecks`, read back through
    // `Array.isArray` (route.ts:98-100): `[]` for the stored null.
    Ok(Json(json!({ "checks": as_checks(&stored) })).into_response())
}

// ── PATCH /api/racks/:id/canvas-position ────────────────────────────────────

/// `Math.round`: the nearest integer, halves towards +∞.
fn js_round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// `patchSchema` (route.ts:8-11): `canvasX` / `canvasY`
/// `z.number().nullable().optional()`, each `Some(None)` when sent as
/// `null`.
type Position = [(&'static str, Option<Option<i64>>); 2];

fn parse_position(body: &Value) -> Result<Position, Flat> {
    let Value::Object(obj) = body else {
        return Err((
            vec![format!(
                "Invalid input: expected object, received {}",
                js_type(Some(body))
            )],
            BTreeMap::new(),
        ));
    };
    let mut errs: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut out: Position = [("canvasX", None), ("canvasY", None)];
    for (name, slot) in out.iter_mut() {
        match obj.get(*name) {
            None => {}
            Some(Value::Null) => *slot = Some(None),
            Some(Value::Number(n)) => {
                let r = js_round(n.as_f64().unwrap_or(0.0));
                // arkyo-server: `Int` de Prisma (32 bits) ; arkyo répondait
                // 500 hors de ces bornes.
                if r > f64::from(i32::MAX) {
                    errs.entry((*name).into())
                        .or_default()
                        .push(format!("Too big: expected number to be <={}", i32::MAX));
                } else if r < f64::from(i32::MIN) {
                    errs.entry((*name).into())
                        .or_default()
                        .push(format!("Too small: expected number to be >={}", i32::MIN));
                } else {
                    *slot = Some(Some(r as i64));
                }
            }
            Some(other) => errs.entry((*name).into()).or_default().push(format!(
                "Invalid input: expected number, received {}",
                js_type(Some(other))
            )),
        }
    }
    if errs.is_empty() {
        Ok(out)
    } else {
        Err((Vec::new(), errs))
    }
}

pub async fn patch_position(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    patch_position_inner(&st, &me, &id, &headers, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn patch_position_inner(
    st: &AppState,
    me: &User,
    id: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    // `req.json().catch(() => ({}))` (route.ts:40).
    let pos = parse_position(&lenient_body(&body)).map_err(failure)?;

    let mut tx = begin(&st.pool).await?;
    let found: Option<i64> = sqlx::query_scalar(r#"SELECT 1 FROM "Rack" WHERE "id" = ?"#)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
    if found.is_none() {
        return Err(not_found());
    }
    let sent: Vec<(&str, Option<i64>)> = pos
        .iter()
        .filter_map(|(name, v)| v.map(|v| (*name, v)))
        .collect();
    if !sent.is_empty() {
        let sets: String = sent
            .iter()
            .map(|(c, _)| format!(r#", "{c}" = ?"#))
            .collect();
        let sql = format!(r#"UPDATE "Rack" SET "updatedAt" = ?{sets} WHERE "id" = ?"#);
        let mut q = sqlx::query(&sql).bind(now_iso());
        for (_, v) in &sent {
            q = q.bind(*v);
        }
        q.bind(id).execute(&mut *tx).await.map_err(db_error)?;
    }
    let (x, y): (Option<i64>, Option<i64>) =
        sqlx::query_as(r#"SELECT "canvasX", "canvasY" FROM "Rack" WHERE "id" = ?"#)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    st.events.publish_meta(
        "rack",
        "updated",
        Some(id),
        EventMeta {
            rack_id: Some(id.to_string()),
            item_id: Some(id.to_string()),
            client_id: client,
            ..EventMeta::default()
        },
    );
    Ok(Json(json!({ "id": id, "canvasX": x, "canvasY": y })).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_like_javascript() {
        for (x, r) in [
            (2.5, 3.0),
            (-2.5, -2.0),
            (-7.5, -7.0),
            (12.4, 12.0),
            (0.499_999_999_999_999_94, 0.0),
            (-0.4, -0.0),
        ] {
            assert_eq!(js_round(x), r, "{x}");
        }
    }

    #[test]
    fn stored_null_reads_as_empty() {
        assert_eq!(as_checks("null"), Vec::<Value>::new());
        assert_eq!(as_checks("{}"), Vec::<Value>::new());
        assert_eq!(as_checks(r#"["a"]"#), vec![json!("a")]);
    }
}
