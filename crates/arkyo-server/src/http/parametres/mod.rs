//! Settings referentials: `/api/tenant/parametres/{brands,connectors,signals,
//! cabling,categories/**,dimensions/**,symbols,cable-models}`.
//!
//! Single catalogue (decision 2 of the phase): every row lives in the
//! `Tenant*` tables and is presented as the tenant's own, so the `arkyo`
//! lists are always `[]`. Each resource is described by a [`Res`] (table,
//! Zod-like schemas, audit and event names) plus [`Hooks`] for the checks
//! specific to arkyo's route (duplicates, hierarchy, usage before delete);
//! [`create`], [`patch`] and [`remove`] run the shared flow: permission,
//! validation, one transaction (checks, write, audit row), commit, event.

#![allow(clippy::result_large_err)]

mod brands;
mod cabling;
mod categories;
mod connectors;
mod dimensions;
mod signals;
mod symbols;
mod valid;

use std::future::Future;
use std::pin::Pin;

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde_json::{json, Map, Value};
use sqlx::sqlite::SqliteRow;
use sqlx::{Column, Row, SqliteConnection, SqlitePool};

pub use valid::{validate, Def, Field, Kind, KEY, LABEL, NAME};

use super::{error, require, server_error, AppState};
use crate::audit;
use crate::catalogue::in_use::{self, Counts};
use crate::ids::{new_id, now_iso};
use crate::users::User;

pub type Fut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
pub type Obj = Map<String, Value>;

/// A table and the columns that are not plain text/number in the JSON.
pub struct Table {
    pub name: &'static str,
    pub bools: &'static [&'static str],
    pub jsons: &'static [&'static str],
}

/// One referential: how its routes read, validate, audit and publish.
pub struct Res {
    pub table: Table,
    /// Real-time entity (`tenant_parametres_brands`).
    pub entity: &'static str,
    /// Audit action prefix (`tenant_brand` gives `tenant_brand.create`).
    pub audit: &'static str,
    /// Audit `entityType` (`TenantBrand`).
    pub audit_type: &'static str,
    pub not_found: &'static str,
    /// 409 when a unique index rejects the write.
    pub unique_msg: &'static str,
    pub domain: Domain,
    pub create: &'static [Field],
    pub patch: &'static [Field],
}

/// Route-specific steps of the shared flow. All default to "nothing to do".
pub trait Hooks: Sync {
    /// Duplicate checks and guards, inside the write transaction. `body`
    /// holds the validated fields (only those sent) and may be adjusted;
    /// `existing` is the current row on update.
    fn check<'a>(
        &'a self,
        _conn: &'a mut SqliteConnection,
        _body: &'a mut Obj,
        _existing: Option<&'a Obj>,
    ) -> Fut<'a, Result<(), Response>> {
        Box::pin(async { Ok(()) })
    }

    /// `Err(409 response)` when the entry is still referenced.
    fn in_use<'a>(
        &'a self,
        _conn: &'a mut SqliteConnection,
        _id: &'a str,
    ) -> Fut<'a, Result<(), Response>> {
        Box::pin(async { Ok(()) })
    }

    /// Adds derived fields to the row returned to the client (not audited).
    fn present<'a>(&'a self, _conn: &'a mut SqliteConnection, _row: &'a mut Obj) -> Fut<'a, ()> {
        Box::pin(async {})
    }
}

pub struct NoHooks;
impl Hooks for NoHooks {}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/tenant/parametres/brands",
            get(brands::list).post(brands::create),
        )
        .route(
            "/tenant/parametres/brands/{id}",
            patch(brands::update).delete(brands::delete),
        )
        .route(
            "/tenant/parametres/connectors",
            get(connectors::list).post(connectors::create),
        )
        .route(
            "/tenant/parametres/connectors/{id}",
            patch(connectors::update).delete(connectors::delete),
        )
        .route(
            "/tenant/parametres/signals",
            get(signals::list).post(signals::create),
        )
        .route(
            "/tenant/parametres/signals/{id}",
            patch(signals::update).delete(signals::delete),
        )
        .route(
            "/tenant/parametres/cabling",
            get(cabling::list).post(cabling::create),
        )
        .route(
            "/tenant/parametres/cabling/{id}",
            patch(cabling::update).delete(cabling::delete),
        )
        .route(
            "/tenant/parametres/cable-models",
            get(cabling::cable_models),
        )
        .route("/tenant/parametres/symbols", get(symbols::list))
        .route("/tenant/parametres/categories", get(categories::list))
        .route(
            "/tenant/parametres/categories/category",
            post(categories::category_create),
        )
        .route(
            "/tenant/parametres/categories/category/{id}",
            patch(categories::category_update).delete(categories::category_delete),
        )
        .route(
            "/tenant/parametres/categories/function",
            post(categories::function_create),
        )
        .route(
            "/tenant/parametres/categories/function/{id}",
            patch(categories::function_update).delete(categories::function_delete),
        )
        .route(
            "/tenant/parametres/categories/phase",
            post(categories::phase_create),
        )
        .route(
            "/tenant/parametres/categories/phase/{id}",
            patch(categories::phase_update).delete(categories::phase_delete),
        )
        .route(
            "/tenant/parametres/categories/type",
            post(categories::type_create),
        )
        .route(
            "/tenant/parametres/categories/type/{id}",
            patch(categories::type_update).delete(categories::type_delete),
        )
        .route(
            "/tenant/parametres/dimensions",
            get(dimensions::list).post(dimensions::create),
        )
        .route(
            "/tenant/parametres/dimensions/restore-arkyo",
            post(dimensions::restore),
        )
        .route(
            "/tenant/parametres/dimensions/{id}",
            patch(dimensions::update).delete(dimensions::delete),
        )
}

// ── rows ────────────────────────────────────────────────────────────────────

fn row_map(row: &SqliteRow, t: &Table) -> Obj {
    let mut m = Obj::new();
    for (i, col) in row.columns().iter().enumerate() {
        let name = col.name();
        let v = if let Ok(x) = row.try_get::<Option<i64>, _>(i) {
            match x {
                None => Value::Null,
                Some(n) if t.bools.contains(&name) => Value::Bool(n != 0),
                Some(n) => Value::from(n),
            }
        } else if let Ok(x) = row.try_get::<Option<f64>, _>(i) {
            x.map_or(Value::Null, Value::from)
        } else {
            match row.try_get::<Option<String>, _>(i).ok().flatten() {
                None => Value::Null,
                Some(s) if t.jsons.contains(&name) => {
                    serde_json::from_str(&s).unwrap_or(Value::Null)
                }
                Some(s) => Value::String(s),
            }
        };
        m.insert(name.to_string(), v);
    }
    m
}

pub async fn get_row(
    conn: &mut SqliteConnection,
    t: &Table,
    id: &str,
) -> Result<Option<Obj>, sqlx::Error> {
    let row = sqlx::query(&format!(r#"SELECT * FROM "{}" WHERE "id" = ?"#, t.name))
        .bind(id)
        .fetch_optional(conn)
        .await?;
    Ok(row.map(|r| row_map(&r, t)))
}

/// `SELECT * FROM t [WHERE ..] ORDER BY ..`; `filter` and `order` are
/// literals of the routes, never request data.
pub async fn list_rows(
    pool: &SqlitePool,
    t: &Table,
    filter: &str,
    order: &str,
) -> Result<Vec<Obj>, sqlx::Error> {
    let rows = sqlx::query(&format!(
        r#"SELECT * FROM "{}" {filter} ORDER BY {order}"#,
        t.name
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(|r| row_map(r, t)).collect())
}

pub fn objs(rows: Vec<Obj>) -> Value {
    Value::Array(rows.into_iter().map(Value::Object).collect())
}

/// `{ arkyo: [], personal: [...] }`.
pub fn arkyo_personal(rows: Vec<Obj>) -> Value {
    json!({ "arkyo": [], "personal": objs(rows) })
}

fn bind<'q>(
    q: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    v: &Value,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    match v {
        Value::Null => q.bind(None::<String>),
        Value::Bool(b) => q.bind(i64::from(*b)),
        Value::Number(n) => match n.as_i64() {
            Some(i) => q.bind(i),
            None => q.bind(n.as_f64()),
        },
        Value::String(s) => q.bind(s.clone()),
        Value::Array(_) | Value::Object(_) => q.bind(v.to_string()),
    }
}

pub fn db_error(e: sqlx::Error) -> Response {
    tracing::error!("parametres: {e}");
    server_error()
}

/// `409 {"error": msg}`.
pub fn conflict(msg: &str) -> Response {
    error(StatusCode::CONFLICT, msg)
}

/// `400 {"error": msg}`.
pub fn bad(msg: &str) -> Response {
    error(StatusCode::BAD_REQUEST, msg)
}

/// The 409 of a delete refused because the entry is referenced, with
/// arkyo's `breakdown` (and `count` where arkyo sends one).
pub fn in_use_conflict(msg: String, count: Option<i64>, breakdown: &Counts) -> Response {
    let mut m = Obj::new();
    m.insert("error".into(), Value::String(msg));
    if let Some(n) = count {
        m.insert("count".into(), Value::from(n));
    }
    let b: Obj = breakdown
        .iter()
        .map(|(k, n)| ((*k).to_string(), Value::from(*n)))
        .collect();
    m.insert("breakdown".into(), Value::Object(b));
    (StatusCode::CONFLICT, Json(Value::Object(m))).into_response()
}

fn write_error(res: &Res, e: sqlx::Error) -> Response {
    if let sqlx::Error::Database(d) = &e {
        if d.is_unique_violation() {
            return conflict(res.unique_msg);
        }
        if d.is_foreign_key_violation() {
            return bad("Référence introuvable.");
        }
    }
    db_error(e)
}

fn parse_body(body: &Bytes) -> Result<Value, Response> {
    serde_json::from_slice(body).map_err(|_| bad("Corps de requête invalide"))
}

async fn begin(pool: &SqlitePool) -> Result<sqlx::Transaction<'static, sqlx::Sqlite>, Response> {
    // IMMEDIATE: the write lock is taken before the checks read.
    pool.begin_with("BEGIN IMMEDIATE").await.map_err(db_error)
}

// ── shared flow ─────────────────────────────────────────────────────────────

pub async fn create(
    st: &AppState,
    user: &User,
    res: &Res,
    hooks: &dyn Hooks,
    body: Bytes,
) -> Response {
    create_inner(st, user, res, hooks, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn create_inner(
    st: &AppState,
    user: &User,
    res: &Res,
    hooks: &dyn Hooks,
    body: Bytes,
) -> Result<Response, Response> {
    require(user, &st.pool, res.domain, Level::Write).await?;
    let mut vals = validate(&parse_body(&body)?, res.create)?;
    let mut tx = begin(&st.pool).await?;
    hooks.check(&mut tx, &mut vals, None).await?;

    let id = new_id();
    let now = now_iso();
    let mut cols = vec![
        "\"id\"".to_string(),
        "\"createdAt\"".into(),
        "\"updatedAt\"".into(),
    ];
    let mut values = vec![
        Value::String(id.clone()),
        Value::String(now.clone()),
        Value::String(now),
    ];
    for f in res.create {
        cols.push(format!("\"{}\"", f.name));
        values.push(
            vals.get(f.name)
                .cloned()
                .unwrap_or_else(|| f.default.value()),
        );
    }
    let sql = format!(
        r#"INSERT INTO "{}" ({}) VALUES ({})"#,
        res.table.name,
        cols.join(", "),
        vec!["?"; cols.len()].join(", ")
    );
    let mut q = sqlx::query(&sql);
    for v in &values {
        q = bind(q, v);
    }
    q.execute(&mut *tx).await.map_err(|e| write_error(res, e))?;

    let mut row = get_row(&mut tx, &res.table, &id)
        .await
        .map_err(db_error)?
        .ok_or_else(server_error)?;
    audit::log(
        &mut tx,
        &user.id,
        &format!("{}.create", res.audit),
        res.audit_type,
        &id,
        None,
        None,
        None,
    )
    .await
    .map_err(db_error)?;
    hooks.present(&mut tx, &mut row).await;
    tx.commit().await.map_err(db_error)?;
    st.events.publish(res.entity, "create", Some(&id));
    Ok((StatusCode::CREATED, Json(Value::Object(row))).into_response())
}

pub async fn patch_row(
    st: &AppState,
    user: &User,
    res: &Res,
    hooks: &dyn Hooks,
    id: &str,
    body: Bytes,
) -> Response {
    patch_inner(st, user, res, hooks, id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn patch_inner(
    st: &AppState,
    user: &User,
    res: &Res,
    hooks: &dyn Hooks,
    id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    require(user, &st.pool, res.domain, Level::Write).await?;
    let mut tx = begin(&st.pool).await?;
    let existing = get_row(&mut tx, &res.table, id)
        .await
        .map_err(db_error)?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, res.not_found))?;
    let mut vals = validate(&parse_body(&body)?, res.patch)?;
    hooks.check(&mut tx, &mut vals, Some(&existing)).await?;

    let mut sets: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    for f in res.patch {
        if let Some(v) = vals.get(f.name) {
            sets.push(format!("\"{}\" = ?", f.name));
            values.push(v.clone());
        }
    }
    sets.push("\"updatedAt\" = ?".into());
    values.push(Value::String(now_iso()));
    let sql = format!(
        r#"UPDATE "{}" SET {} WHERE "id" = ?"#,
        res.table.name,
        sets.join(", ")
    );
    let mut q = sqlx::query(&sql);
    for v in &values {
        q = bind(q, v);
    }
    q.bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| write_error(res, e))?;

    let mut row = get_row(&mut tx, &res.table, id)
        .await
        .map_err(db_error)?
        .ok_or_else(server_error)?;
    audit::log(
        &mut tx,
        &user.id,
        &format!("{}.update", res.audit),
        res.audit_type,
        id,
        None,
        Some(Value::Object(existing)),
        Some(Value::Object(row.clone())),
    )
    .await
    .map_err(db_error)?;
    hooks.present(&mut tx, &mut row).await;
    tx.commit().await.map_err(db_error)?;
    st.events.publish(res.entity, "update", Some(id));
    Ok(Json(Value::Object(row)).into_response())
}

pub async fn remove(
    st: &AppState,
    user: &User,
    res: &Res,
    hooks: &dyn Hooks,
    id: &str,
) -> Response {
    remove_inner(st, user, res, hooks, id)
        .await
        .unwrap_or_else(|r| r)
}

async fn remove_inner(
    st: &AppState,
    user: &User,
    res: &Res,
    hooks: &dyn Hooks,
    id: &str,
) -> Result<Response, Response> {
    require(user, &st.pool, res.domain, Level::Write).await?;
    let mut tx = begin(&st.pool).await?;
    let existing = get_row(&mut tx, &res.table, id)
        .await
        .map_err(db_error)?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, res.not_found))?;
    hooks.in_use(&mut tx, id).await?;
    sqlx::query(&format!(
        r#"DELETE FROM "{}" WHERE "id" = ?"#,
        res.table.name
    ))
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| write_error(res, e))?;
    audit::log(
        &mut tx,
        &user.id,
        &format!("{}.delete", res.audit),
        res.audit_type,
        id,
        None,
        Some(Value::Object(existing)),
        None,
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    st.events.publish(res.entity, "delete", Some(id));
    Ok(Json(json!({ "success": true })).into_response())
}

/// 409 with arkyo's usage message when `counts` is not empty.
pub fn refuse_if_used(
    counts: Result<Counts, sqlx::Error>,
    message: impl FnOnce(i64, &Counts) -> String,
    with_count: bool,
) -> Result<(), Response> {
    let counts = counts.map_err(db_error)?;
    let n = in_use::total(&counts);
    if n > 0 {
        return Err(in_use_conflict(
            message(n, &counts),
            with_count.then_some(n),
            &counts,
        ));
    }
    Ok(())
}

/// Unicode-aware comparison key: NFC then Unicode lower case ("Éclairage"
/// and "éclairage" fold alike; SQLite `lower()` is ASCII-only).
pub fn fold(s: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    s.nfc().collect::<String>().to_lowercase()
}

/// Duplicate name check against the single catalogue: another row (not
/// `exclude`) whose value folds alike ([`fold`]). An exact match is left to
/// the unique index (the "dans votre espace" message of arkyo); a match that
/// only differs by case gets arkyo's "catalogue Arkyo" message, which
/// arkyo's own catalogue check returned for it. Compared in Rust over the
/// table's values (referentials are small).
pub async fn case_only_duplicate(
    conn: &mut SqliteConnection,
    table: &str,
    col: &str,
    value: &str,
    exclude: Option<&str>,
    msg: &str,
) -> Result<(), Response> {
    let rows: Vec<(String, String)> =
        sqlx::query_as(&format!(r#"SELECT "id", "{col}" FROM "{table}""#))
            .fetch_all(conn)
            .await
            .map_err(db_error)?;
    let f = fold(value);
    if rows
        .iter()
        .any(|(id, v)| Some(id.as_str()) != exclude && v != value && fold(v) == f)
    {
        return Err(conflict(msg));
    }
    Ok(())
}

pub fn str_of<'a>(o: &'a Obj, key: &str) -> Option<&'a str> {
    o.get(key).and_then(Value::as_str)
}
