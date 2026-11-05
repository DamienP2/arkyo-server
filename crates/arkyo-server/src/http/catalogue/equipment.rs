//! arkyo:app/api/tenant/catalogue/equipment/{route,[id]/route,
//! [id]/duplicate,[id]/restore,bulk-delete,check-duplicate}.ts
//!
//! Writes go straight to the row (arkyo's fork-on-edit does not exist in the
//! single catalogue). Audit actions (`CREATE`, `UPDATE`, `DELETE`,
//! `DUPLICATE`, `BULK_DELETE`) and the `tenant_catalogue` event actions
//! (`created`, `updated`, `deleted`) are arkyo's.

use std::collections::HashMap;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::assert_can_write;
use crate::audit;
use crate::catalogue::duplicate::{copy_values, matches};
use crate::catalogue::enrich::{enrich_equipment, Refs, CATEGORY, EQUIPMENT};
use crate::catalogue::in_use;
use crate::http::parametres::{
    bad, begin, bind, db_error, fold, get_row, list_rows, parse_body, str_of, validate, Def, Field,
    Kind, Obj,
};
use crate::http::{error, server_error, AppState, CurrentUser};
use crate::ids::{new_id, now_iso};
use crate::users::User;

const EVENT: &str = "tenant_catalogue";
const AUDIT_TYPE: &str = "TenantEquipment";
const NOT_FOUND: &str = "Équipement personnel introuvable";
const HOST_AND_COMPONENT: &str = "Un équipement ne peut pas être à la fois modulaire et composant.";

const fn s(name: &'static str) -> Field {
    Field::new(name, Kind::Str).nullable()
}
const fn int(name: &'static str) -> Field {
    Field::new(name, Kind::Int).nullable()
}
const fn num(name: &'static str) -> Field {
    Field::new(name, Kind::Num).nullable()
}
const fn flag(name: &'static str, d: Def) -> Field {
    Field::new(name, Kind::Bool).or(d)
}
const fn arr(name: &'static str) -> Field {
    Field::new(name, Kind::AnyArr).nullable().or(Def::EmptyArr)
}

/// `equipmentWriteSchema` (create and patch share it; only `name` is
/// required on create). `category` (a name) is accepted for the shared
/// editor and resolved to `categoryId`; it is not a column.
static FIELDS: &[Field] = &[
    Field::new("name", Kind::NonEmpty),
    s("reference"),
    s("brandId"),
    s("categoryId"),
    s("category"),
    s("typeId"),
    flag("isRackable", Def::True),
    int("heightU"),
    int("depthMm"),
    int("rearCableDepthMm"),
    Field::new("widthFraction", Kind::Str).or(Def::Str("FULL")),
    int("dimLmm"),
    int("dimWmm"),
    int("dimHmm"),
    num("weight"),
    int("powerW"),
    num("heatBtuH"),
    flag("hasDualPsu", Def::False),
    flag("is2110", Def::False),
    s("ip2110Mode"),
    flag("isLightingFixture", Def::False),
    int("dmxChannelsDefault"),
    arr("dmxModes"),
    flag("isComponentHost", Def::False),
    Field::new("hostSlotCount", Kind::IntMin(1)).nullable(),
    flag("isComponent", Def::False),
    Field::new("componentSlotSpan", Kind::IntMin(1)).or(Def::Int(1)),
    arr("connectors"),
    arr("signalCapacities"),
    arr("customFields"),
    s("imageUrl"),
    s("iconUrl"),
    s("rackSymbolUrl"),
    s("rackSymbolRearUrl"),
    s("rackPhotoFrontUrl"),
    s("rackPhotoRearUrl"),
    s("schemaImageUrl"),
    s("frontImageUrl"),
    s("rearImageUrl"),
    s("notes"),
    arr("tags"),
    arr("documents"),
    flag("isActive", Def::True),
    Field::new("functionIds", Kind::StrArr).or(Def::EmptyArr),
    Field::new("phaseIds", Kind::StrArr).or(Def::EmptyArr),
];

fn schema(create: bool) -> Vec<Field> {
    FIELDS
        .iter()
        .map(|f| {
            let mut f = Field { ..*f };
            if create && f.name == "name" {
                f = f.required();
            }
            f
        })
        .collect()
}

fn truthy(v: Option<&Value>) -> bool {
    v == Some(&Value::Bool(true))
}

/// `null` on a JSON-array column is stored as `[]` (arkyo's `toJson`).
fn null_arrays_to_empty(vals: &mut Obj, fields: &[Field]) {
    for f in fields {
        if matches!(f.kind, Kind::AnyArr) && vals.get(f.name) == Some(&Value::Null) {
            vals.insert(f.name.into(), Value::Array(vec![]));
        }
    }
}

/// `category` (a name) → the id of the category with that name.
async fn category_id_by_name(
    conn: &mut SqliteConnection,
    name: &str,
) -> Result<Option<String>, Response> {
    sqlx::query_scalar(&format!(
        r#"SELECT "id" FROM "{}" WHERE "name" = ? LIMIT 1"#,
        CATEGORY.name
    ))
    .bind(name)
    .fetch_optional(conn)
    .await
    .map_err(db_error)
}

async fn insert(
    tx: &mut SqliteConnection,
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
        EQUIPMENT.name,
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

// ── GET /equipment ──────────────────────────────────────────────────────────

pub async fn list(
    State(st): State<AppState>,
    _u: CurrentUser,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let run = async {
        let active = q.get("isActive").map(String::as_str) != Some("false");
        let filter = if active {
            r#"WHERE "isActive" = 1"#
        } else {
            r#"WHERE "isActive" = 0"#
        };
        let mut rows = list_rows(&st.pool, &EQUIPMENT, filter, r#""createdAt" DESC, "id""#).await?;
        if let Some(needle) = q.get("q").filter(|s| !s.is_empty()) {
            let n = fold(needle);
            rows.retain(|r| {
                ["name", "reference"]
                    .iter()
                    .any(|k| fold(str_of(r, k).unwrap_or("")).contains(&n))
            });
        }
        let refs = Refs::load(&st.pool).await?;
        for r in &mut rows {
            enrich_equipment(r, &refs, false);
        }
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

// ── GET /equipment/{id} ─────────────────────────────────────────────────────

pub async fn detail(
    State(st): State<AppState>,
    _u: CurrentUser,
    Path(id): Path<String>,
) -> Response {
    let run = async {
        let mut conn = st.pool.acquire().await?;
        let row = get_row(&mut conn, &EQUIPMENT, &id).await?;
        drop(conn);
        let Some(mut row) = row else {
            return Ok(None);
        };
        let refs = Refs::load(&st.pool).await?;
        enrich_equipment(&mut row, &refs, true);
        Ok::<_, sqlx::Error>(Some(row))
    };
    match run.await {
        Ok(Some(item)) => Json(json!({ "source": "PERSONAL", "isAccessible": true, "item": item }))
            .into_response(),
        Ok(None) => error(StatusCode::NOT_FOUND, "Équipement introuvable"),
        Err(e) => db_error(e),
    }
}

// ── POST /equipment ─────────────────────────────────────────────────────────

pub async fn create(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    create_inner(&st, &u, body).await.unwrap_or_else(|r| r)
}

async fn create_inner(st: &AppState, user: &User, body: Bytes) -> Result<Response, Response> {
    assert_can_write(st, user).await?;
    let fields = schema(true);
    let mut vals = validate(&parse_body(&body)?, &fields)?;
    if truthy(vals.get("isComponentHost")) && truthy(vals.get("isComponent")) {
        return Err(bad(HOST_AND_COMPONENT));
    }
    null_arrays_to_empty(&mut vals, &fields);
    let mut tx = begin(&st.pool).await?;

    // `category` (name) only fills in a missing `categoryId`.
    let has_cat_id = vals.get("categoryId").is_some_and(|v| !v.is_null());
    if !has_cat_id {
        if let Some(name) = str_of(&vals, "category") {
            if let Some(id) = category_id_by_name(&mut tx, name).await? {
                vals.insert("categoryId".into(), Value::String(id));
            }
        }
    }

    let id = new_id();
    let mut cols: Vec<(String, Value)> = fields
        .iter()
        .filter(|f| f.name != "category")
        .map(|f| {
            let v = vals
                .get(f.name)
                .cloned()
                .unwrap_or_else(|| f.default.value());
            (f.name.to_string(), v)
        })
        .collect();
    cols.push(("createdById".into(), Value::String(user.id.clone())));
    insert(&mut tx, &id, cols).await?;

    let row = get_row(&mut tx, &EQUIPMENT, &id)
        .await
        .map_err(db_error)?
        .ok_or_else(server_error)?;
    audit::log(
        &mut tx, &user.id, "CREATE", AUDIT_TYPE, &id, None, None, None,
    )
    .await
    .map_err(db_error)?;
    commit(tx).await?;
    st.events.publish(EVENT, "created", Some(&id));
    Ok((StatusCode::CREATED, Json(Value::Object(row))).into_response())
}

// ── PATCH /equipment/{id} ───────────────────────────────────────────────────

pub async fn update(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    update_inner(&st, &u, &id, body).await.unwrap_or_else(|r| r)
}

async fn update_inner(
    st: &AppState,
    user: &User,
    id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    assert_can_write(st, user).await?;
    let fields = schema(false);
    let mut vals = validate(&parse_body(&body)?, &fields)?;
    null_arrays_to_empty(&mut vals, &fields);
    let mut tx = begin(&st.pool).await?;
    let existing = get_row(&mut tx, &EQUIPMENT, id)
        .await
        .map_err(db_error)?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, NOT_FOUND))?;

    // Exclusivity is checked on the resulting state.
    let next = |k: &str| vals.get(k).or_else(|| existing.get(k));
    if truthy(next("isComponentHost")) && truthy(next("isComponent")) {
        return Err(bad(HOST_AND_COMPONENT));
    }

    // `category` (name) resolves only when `categoryId` was not sent; an
    // unknown name clears the category, like arkyo.
    if !vals.contains_key("categoryId") {
        match vals.get("category") {
            Some(Value::Null) => {
                vals.insert("categoryId".into(), Value::Null);
            }
            Some(Value::String(name)) => {
                let found = category_id_by_name(&mut tx, &name.clone()).await?;
                vals.insert(
                    "categoryId".into(),
                    found.map_or(Value::Null, Value::String),
                );
            }
            _ => {}
        }
    }

    let mut sets: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    for f in fields.iter().filter(|f| f.name != "category") {
        if let Some(v) = vals.get(f.name) {
            sets.push(format!("\"{}\" = ?", f.name));
            values.push(v.clone());
        }
    }
    sets.push("\"updatedAt\" = ?".into());
    values.push(Value::String(now_iso()));
    let sql = format!(
        r#"UPDATE "{}" SET {} WHERE "id" = ?"#,
        EQUIPMENT.name,
        sets.join(", ")
    );
    let mut q = sqlx::query(&sql);
    for v in &values {
        q = bind(q, v);
    }
    q.bind(id).execute(&mut *tx).await.map_err(db_error)?;

    let row = get_row(&mut tx, &EQUIPMENT, id)
        .await
        .map_err(db_error)?
        .ok_or_else(server_error)?;
    audit::log(
        &mut tx,
        &user.id,
        "UPDATE",
        AUDIT_TYPE,
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

// ── DELETE /equipment/{id} ──────────────────────────────────────────────────

fn usage_message(n: i64, what: &str) -> String {
    format!("Utilisé dans {n} projet(s) — {what} impossible")
}

pub async fn delete(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    delete_inner(&st, &u, &id).await.unwrap_or_else(|r| r)
}

async fn delete_inner(st: &AppState, user: &User, id: &str) -> Result<Response, Response> {
    assert_can_write(st, user).await?;
    let mut tx = begin(&st.pool).await?;
    let existing = get_row(&mut tx, &EQUIPMENT, id)
        .await
        .map_err(db_error)?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, NOT_FOUND))?;
    let n = in_use::total(&in_use::equipment(&mut tx, id).await.map_err(db_error)?);
    if n > 0 {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({ "error": usage_message(n, "suppression"), "usageCount": n })),
        )
            .into_response());
    }
    sqlx::query(r#"DELETE FROM "TenantEquipment" WHERE "id" = ?"#)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    audit::log(
        &mut tx,
        &user.id,
        "DELETE",
        AUDIT_TYPE,
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

// ── POST /equipment/{id}/duplicate ──────────────────────────────────────────

pub async fn duplicate(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    duplicate_inner(&st, &u, &id).await.unwrap_or_else(|r| r)
}

async fn duplicate_inner(st: &AppState, user: &User, id: &str) -> Result<Response, Response> {
    assert_can_write(st, user).await?;
    let mut tx = begin(&st.pool).await?;
    let source = get_row(&mut tx, &EQUIPMENT, id)
        .await
        .map_err(db_error)?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Équipement introuvable"))?;
    let new = new_id();
    let mut cols = copy_values(&source);
    cols.push(("createdById".into(), Value::String(user.id.clone())));
    insert(&mut tx, &new, cols).await?;
    let row = get_row(&mut tx, &EQUIPMENT, &new)
        .await
        .map_err(db_error)?
        .ok_or_else(server_error)?;
    audit::log(
        &mut tx,
        &user.id,
        "DUPLICATE",
        AUDIT_TYPE,
        &new,
        None,
        None,
        Some(json!({
            "clonedFromPersonalId": id,
            "personalName": str_of(&source, "name"),
        })),
    )
    .await
    .map_err(db_error)?;
    commit(tx).await?;
    st.events.publish(EVENT, "created", Some(&new));
    Ok((StatusCode::CREATED, Json(Value::Object(row))).into_response())
}

// ── POST /equipment/{id}/restore ────────────────────────────────────────────

/// "Récupérer la version Arkyo": there is no Arkyo version in the single
/// catalogue (decision 2).
pub async fn restore(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(_id): Path<String>,
) -> Response {
    if let Err(r) = assert_can_write(&st, &u).await {
        return r;
    }
    error(StatusCode::NOT_FOUND, "Aucune version Arkyo")
}

// ── POST /equipment/bulk-delete ─────────────────────────────────────────────

static BULK: [Field; 1] = [Field::new("ids", Kind::IdArr { min: 1, max: 500 }).required()];

pub async fn bulk_delete(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    bulk_inner(&st, &u, body).await.unwrap_or_else(|r| r)
}

async fn bulk_inner(st: &AppState, user: &User, body: Bytes) -> Result<Response, Response> {
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
        if get_row(&mut tx, &EQUIPMENT, id)
            .await
            .map_err(db_error)?
            .is_none()
        {
            failed.push(json!({ "id": id, "reason": NOT_FOUND }));
            continue;
        }
        let n = in_use::total(&in_use::equipment(&mut tx, id).await.map_err(db_error)?);
        if n > 0 {
            failed.push(json!({ "id": id, "reason": usage_message(n, "suppression") }));
            continue;
        }
        sqlx::query(r#"DELETE FROM "TenantEquipment" WHERE "id" = ?"#)
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
        AUDIT_TYPE,
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

// ── GET /equipment/check-duplicate ──────────────────────────────────────────

pub async fn check_duplicate(
    State(st): State<AppState>,
    _u: CurrentUser,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let get = |k: &str| q.get(k).map_or("", String::as_str).to_string();
    let run = async {
        let mut conn = st.pool.acquire().await?;
        matches(&mut conn, &get("name"), &get("reference")).await
    };
    match run.await {
        Ok(m) => Json(json!({ "matches": m })).into_response(),
        Err(e) => db_error(e),
    }
}
