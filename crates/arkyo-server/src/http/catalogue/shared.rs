//! Write flow shared by the cable and adapter routes
//! (arkyo:app/api/tenant/catalogue/{cables,adapters}/{route,[id]/route,
//! [id]/duplicate,[id]/restore,bulk-delete,check-duplicate}.ts, which are the
//! same code twice).
//!
//! Single catalogue: PATCH writes the row (no fork-on-edit), the shadowing
//! fork guards of DELETE and bulk-delete cannot trigger, and "restore" has no
//! Arkyo version to bring back. Audit actions (`CREATE`, `UPDATE`, `DELETE`,
//! `DUPLICATE`, `BULK_DELETE`) and event actions (`created`, `updated`,
//! `deleted`) are arkyo's.

use std::collections::HashMap;

use axum::body::Bytes;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::assert_can_write;
use crate::audit;
use crate::catalogue::duplicate::matches;
use crate::catalogue::in_use::{self, Counts};
use crate::http::parametres::{
    begin, bind, db_error, fold, get_row, list_rows, parse_body, str_of, validate, Field, Kind,
    Obj, Table,
};
use crate::http::{error, server_error, AppState};
use crate::ids::{new_id, now_iso};
use crate::users::User;

pub const EVENT: &str = "tenant_catalogue";

/// Which project tables hold references to the item (arkyo
/// `assertCableNotInUse` / `assertAdapterNotInUse`).
#[derive(Clone, Copy)]
pub enum Usage {
    Cable,
    Adapter,
}

/// One resource: its table, messages and schemas.
pub struct Spec {
    pub table: &'static Table,
    /// Audit `entityType`.
    pub audit_type: &'static str,
    /// 404 of PATCH, DELETE and bulk-delete.
    pub not_found: &'static str,
    /// 404 of GET and duplicate (arkyo then also looked in its Arkyo catalogue).
    pub missing: &'static str,
    /// `connexion(s)` or `synoptique(s)`, in the 409 message.
    pub usage_unit: &'static str,
    pub usage: Usage,
    pub create: &'static [Field],
    pub patch: &'static [Field],
    /// Columns copied by duplicate (arkyo's explicit list).
    pub copied: &'static [&'static str],
}

impl Spec {
    async fn usage(&self, conn: &mut SqliteConnection, id: &str) -> Result<Counts, sqlx::Error> {
        match self.usage {
            Usage::Cable => in_use::cable(conn, id).await,
            Usage::Adapter => in_use::adapter(conn, id).await,
        }
    }

    fn usage_message(&self, n: i64) -> String {
        format!(
            "Utilisé dans {n} {} — suppression impossible",
            self.usage_unit
        )
    }
}

/// `null` on a JSON-array column is stored as `[]` (arkyo's `toJson`).
fn null_arrays_to_empty(vals: &mut Obj, fields: &[Field]) {
    for f in fields {
        if matches!(f.kind, Kind::AnyArr | Kind::StrArr | Kind::NumArr)
            && vals.get(f.name) == Some(&Value::Null)
        {
            vals.insert(f.name.into(), Value::Array(vec![]));
        }
    }
}

async fn insert(
    tx: &mut SqliteConnection,
    table: &Table,
    id: &str,
    cols: Vec<(String, Value)>,
) -> Result<(), Response> {
    let now = now_iso();
    let mut names = vec![
        "\"id\"".to_string(),
        "\"createdAt\"".into(),
        "\"updatedAt\"".into(),
    ];
    let mut values = vec![
        Value::String(id.into()),
        Value::String(now.clone()),
        Value::String(now),
    ];
    for (k, v) in cols {
        names.push(format!("\"{k}\""));
        values.push(v);
    }
    let sql = format!(
        r#"INSERT INTO "{}" ({}) VALUES ({})"#,
        table.name,
        names.join(", "),
        vec!["?"; names.len()].join(", ")
    );
    let mut q = sqlx::query(&sql);
    for v in &values {
        q = bind(q, v);
    }
    q.execute(tx).await.map_err(db_error)?;
    Ok(())
}

async fn commit(tx: sqlx::Transaction<'static, sqlx::Sqlite>) -> Result<(), Response> {
    tx.commit().await.map_err(db_error)
}

fn not_found(msg: &str) -> Response {
    error(StatusCode::NOT_FOUND, msg)
}

// ── GET list (rows, before the per-resource enrichment) ─────────────────────

/// Own rows filtered like arkyo's `where`: `isActive` (default true) and the
/// `q` substring of the name (case-insensitive).
pub async fn list_personal(
    st: &AppState,
    spec: &Spec,
    q: &HashMap<String, String>,
    order: &str,
) -> Result<Vec<Obj>, sqlx::Error> {
    let filter = if q.get("isActive").map(String::as_str) != Some("false") {
        r#"WHERE "isActive" = 1"#
    } else {
        r#"WHERE "isActive" = 0"#
    };
    let mut rows = list_rows(&st.pool, spec.table, filter, order).await?;
    if let Some(needle) = q.get("q").filter(|s| !s.is_empty()) {
        let n = fold(needle);
        rows.retain(|r| fold(str_of(r, "name").unwrap_or("")).contains(&n));
    }
    Ok(rows)
}

// ── POST ────────────────────────────────────────────────────────────────────

pub async fn create(st: &AppState, user: &User, spec: &Spec, body: Bytes) -> Response {
    create_inner(st, user, spec, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn create_inner(
    st: &AppState,
    user: &User,
    spec: &Spec,
    body: Bytes,
) -> Result<Response, Response> {
    assert_can_write(st, user).await?;
    let mut vals = validate(&parse_body(&body)?, spec.create)?;
    null_arrays_to_empty(&mut vals, spec.create);
    let mut cols: Vec<(String, Value)> = spec
        .create
        .iter()
        .map(|f| {
            let v = vals
                .get(f.name)
                .cloned()
                .unwrap_or_else(|| f.default.value());
            (f.name.to_string(), v)
        })
        .collect();
    cols.push(("createdById".into(), Value::String(user.id.clone())));

    let mut tx = begin(&st.pool).await?;
    let id = new_id();
    insert(&mut tx, spec.table, &id, cols).await?;
    let row = get_row(&mut tx, spec.table, &id)
        .await
        .map_err(db_error)?
        .ok_or_else(server_error)?;
    audit::log(
        &mut tx,
        &user.id,
        "CREATE",
        spec.audit_type,
        &id,
        None,
        None,
        None,
    )
    .await
    .map_err(db_error)?;
    commit(tx).await?;
    st.events.publish(EVENT, "created", Some(&id));
    Ok((StatusCode::CREATED, Json(Value::Object(row))).into_response())
}

// ── PATCH ───────────────────────────────────────────────────────────────────

pub async fn update(st: &AppState, user: &User, spec: &Spec, id: &str, body: Bytes) -> Response {
    update_inner(st, user, spec, id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn update_inner(
    st: &AppState,
    user: &User,
    spec: &Spec,
    id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    assert_can_write(st, user).await?;
    let mut vals = validate(&parse_body(&body)?, spec.patch)?;
    null_arrays_to_empty(&mut vals, spec.patch);
    let mut tx = begin(&st.pool).await?;
    let existing = get_row(&mut tx, spec.table, id)
        .await
        .map_err(db_error)?
        .ok_or_else(|| not_found(spec.not_found))?;

    let mut sets: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    for f in spec.patch {
        if let Some(v) = vals.get(f.name) {
            sets.push(format!("\"{}\" = ?", f.name));
            values.push(v.clone());
        }
    }
    sets.push("\"updatedAt\" = ?".into());
    values.push(Value::String(now_iso()));
    let sql = format!(
        r#"UPDATE "{}" SET {} WHERE "id" = ?"#,
        spec.table.name,
        sets.join(", ")
    );
    let mut q = sqlx::query(&sql);
    for v in &values {
        q = bind(q, v);
    }
    q.bind(id).execute(&mut *tx).await.map_err(db_error)?;

    let row = get_row(&mut tx, spec.table, id)
        .await
        .map_err(db_error)?
        .ok_or_else(server_error)?;
    audit::log(
        &mut tx,
        &user.id,
        "UPDATE",
        spec.audit_type,
        id,
        None,
        Some(Value::Object(existing)),
        Some(Value::Object(row.clone())),
    )
    .await
    .map_err(db_error)?;
    commit(tx).await?;
    st.events.publish(EVENT, "updated", Some(id));
    Ok(Json(Value::Object(row)).into_response())
}

// ── DELETE ──────────────────────────────────────────────────────────────────

pub async fn delete(st: &AppState, user: &User, spec: &Spec, id: &str) -> Response {
    delete_inner(st, user, spec, id).await.unwrap_or_else(|r| r)
}

async fn delete_inner(
    st: &AppState,
    user: &User,
    spec: &Spec,
    id: &str,
) -> Result<Response, Response> {
    assert_can_write(st, user).await?;
    let mut tx = begin(&st.pool).await?;
    let existing = get_row(&mut tx, spec.table, id)
        .await
        .map_err(db_error)?
        .ok_or_else(|| not_found(spec.not_found))?;
    let n = in_use::total(&spec.usage(&mut tx, id).await.map_err(db_error)?);
    if n > 0 {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({ "error": spec.usage_message(n), "usageCount": n })),
        )
            .into_response());
    }
    sqlx::query(&format!(
        r#"DELETE FROM "{}" WHERE "id" = ?"#,
        spec.table.name
    ))
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    audit::log(
        &mut tx,
        &user.id,
        "DELETE",
        spec.audit_type,
        id,
        None,
        Some(Value::Object(existing)),
        None,
    )
    .await
    .map_err(db_error)?;
    commit(tx).await?;
    st.events.publish(EVENT, "deleted", Some(id));
    Ok(Json(json!({ "success": true })).into_response())
}

// ── POST duplicate ──────────────────────────────────────────────────────────

pub async fn duplicate(st: &AppState, user: &User, spec: &Spec, id: &str) -> Response {
    duplicate_inner(st, user, spec, id)
        .await
        .unwrap_or_else(|r| r)
}

async fn duplicate_inner(
    st: &AppState,
    user: &User,
    spec: &Spec,
    id: &str,
) -> Result<Response, Response> {
    assert_can_write(st, user).await?;
    let mut tx = begin(&st.pool).await?;
    let source = get_row(&mut tx, spec.table, id)
        .await
        .map_err(db_error)?
        .ok_or_else(|| not_found(spec.missing))?;
    let name = str_of(&source, "name").unwrap_or("");
    let mut cols: Vec<(String, Value)> = spec
        .copied
        .iter()
        .map(|k| {
            let v = if *k == "name" {
                Value::String(format!("{name} (copie)"))
            } else {
                source.get(*k).cloned().unwrap_or(Value::Null)
            };
            ((*k).to_string(), v)
        })
        .collect();
    // Always active; `sortOrder` (cables) keeps its column default, 0.
    cols.push(("isActive".into(), Value::Bool(true)));
    cols.push(("createdById".into(), Value::String(user.id.clone())));
    let new = new_id();
    insert(&mut tx, spec.table, &new, cols).await?;
    let row = get_row(&mut tx, spec.table, &new)
        .await
        .map_err(db_error)?
        .ok_or_else(server_error)?;
    audit::log(
        &mut tx,
        &user.id,
        "DUPLICATE",
        spec.audit_type,
        &new,
        None,
        None,
        Some(json!({ "clonedFromPersonalId": id, "personalName": name })),
    )
    .await
    .map_err(db_error)?;
    commit(tx).await?;
    st.events.publish(EVENT, "created", Some(&new));
    Ok((StatusCode::CREATED, Json(Value::Object(row))).into_response())
}

// ── POST restore ────────────────────────────────────────────────────────────

/// "Récupérer la version Arkyo": there is no Arkyo version in the single
/// catalogue (decision 2).
pub async fn restore(st: &AppState, user: &User) -> Response {
    if let Err(r) = assert_can_write(st, user).await {
        return r;
    }
    not_found("Aucune version Arkyo")
}

// ── POST bulk-delete ────────────────────────────────────────────────────────

static BULK: [Field; 1] = [Field::new("ids", Kind::IdArr { min: 1, max: 500 }).required()];

pub async fn bulk_delete(st: &AppState, user: &User, spec: &Spec, body: Bytes) -> Response {
    bulk_inner(st, user, spec, body).await.unwrap_or_else(|r| r)
}

async fn bulk_inner(
    st: &AppState,
    user: &User,
    spec: &Spec,
    body: Bytes,
) -> Result<Response, Response> {
    assert_can_write(st, user).await?;
    let vals = validate(&parse_body(&body)?, &BULK)?;
    let ids: Vec<String> = vals["ids"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let mut tx = begin(&st.pool).await?;
    let mut failed: Vec<Value> = Vec::new();
    let mut deleted = 0;
    for id in &ids {
        if get_row(&mut tx, spec.table, id)
            .await
            .map_err(db_error)?
            .is_none()
        {
            failed.push(json!({ "id": id, "reason": spec.not_found }));
            continue;
        }
        let n = in_use::total(&spec.usage(&mut tx, id).await.map_err(db_error)?);
        if n > 0 {
            failed.push(json!({ "id": id, "reason": spec.usage_message(n) }));
            continue;
        }
        sqlx::query(&format!(
            r#"DELETE FROM "{}" WHERE "id" = ?"#,
            spec.table.name
        ))
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        deleted += 1;
    }
    // One audit row and one event for the whole batch, like arkyo.
    audit::log(
        &mut tx,
        &user.id,
        "BULK_DELETE",
        spec.audit_type,
        "batch",
        None,
        None,
        Some(json!({ "requested": ids.len(), "deleted": deleted, "failed": failed.len() })),
    )
    .await
    .map_err(db_error)?;
    commit(tx).await?;
    st.events.publish(EVENT, "deleted", Some("batch"));
    Ok(Json(json!({ "deleted": deleted, "failed": failed })).into_response())
}

// ── GET check-duplicate ─────────────────────────────────────────────────────

pub async fn check_duplicate(st: &AppState, spec: &Spec, q: &HashMap<String, String>) -> Response {
    let get = |k: &str| q.get(k).map_or("", String::as_str).to_string();
    let run = async {
        let mut conn = st.pool.acquire().await?;
        matches(&mut conn, spec.table, &get("name"), &get("reference")).await
    };
    match run.await {
        Ok(m) => Json(json!({ "matches": m })).into_response(),
        Err(e) => db_error(e),
    }
}
