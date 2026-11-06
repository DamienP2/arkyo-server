//! Rigs: arkyo:app/api/rigs/route.ts (`GET`, `POST`),
//! arkyo:app/api/rigs/[id]/route.ts (`GET`, `PATCH`, `DELETE`),
//! arkyo:app/api/rigs/[id]/racks/route.ts (`POST`, link or create) and
//! arkyo:app/api/rigs/[id]/racks/[rackId]/route.ts (`DELETE`, unlink).
//!
//! Validation errors use Zod's `{ error: flatten() }`, as arkyo. arkyo
//! writes no audit row on these routes.

#![allow(clippy::result_large_err)]

use std::collections::HashMap;

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::parametres::{
    bad, begin, bind, db_error, failure, parse_body, row_map, str_of, validate_flat, Def, Field,
    Kind, Obj,
};
use super::projects::{link_rack, next_position, PLAIN, RIG_CONFIG};
use super::{error, require, AppState, CurrentUser};
use crate::ids::{new_id, now_iso};
use crate::projects::enrich::{self, SlotOrder};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/rigs", get(list).post(create))
        .route("/rigs/{id}", get(detail).patch(update).delete(remove))
        .route("/rigs/{id}/racks", post(add_rack))
        .route("/rigs/{id}/racks/{rack_id}", delete(unlink))
}

/// The scalars of the Prisma `RigConfig` model, in the schema's order.
const RIG_COLS: &str = r#""id", "name", "type", "prestationType", "isTemplate", "notes",
    "projectId", "createdById", "createdAt", "updatedAt""#;

const RIG_TYPES: &[&str] = &["FLIGHT_CASE", "CAR", "MIXED"];
const RIG_TYPE_MSG: &str = r#"Invalid option: expected one of "FLIGHT_CASE"|"CAR"|"MIXED""#;

const TEMPLATE_MSG: &str = "Un objet lié à un projet ne peut pas devenir un template. Utilisez « Sauver comme template » pour cloner.";

/// `createSchema` (route.ts:11-18).
static CREATE: [Field; 6] = [
    Field::new("name", Kind::NonEmpty).required(),
    Field::new("type", Kind::Enum(RIG_TYPES, RIG_TYPE_MSG)).or(Def::Str("FLIGHT_CASE")),
    Field::new("prestationType", Kind::Str),
    Field::new("isTemplate", Kind::Bool).or(Def::False),
    Field::new("notes", Kind::Str),
    Field::new("projectId", Kind::Str),
];

/// `updateSchema` ([id]/route.ts:8-15).
static UPDATE: [Field; 6] = [
    Field::new("name", Kind::NonEmpty),
    Field::new("type", Kind::Enum(RIG_TYPES, RIG_TYPE_MSG)),
    Field::new("prestationType", Kind::Str),
    Field::new("isTemplate", Kind::Bool),
    Field::new("notes", Kind::Str),
    Field::new("projectId", Kind::Str).nullable(),
];

/// `createSchema` of [id]/racks/route.ts:54-61 (a new rack, then linked).
static CREATE_RACK: [Field; 6] = [
    Field::new("name", Kind::NonEmpty).required(),
    Field::new("totalU", Kind::IntRange(1, 56)).or(Def::Int(42)),
    Field::new("depthMm", Kind::IntPos).or(Def::Int(600)),
    Field::new("maxWeightKg", Kind::NumPos),
    Field::new("maxPowerW", Kind::NumPos),
    Field::new("notes", Kind::Str),
];

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Not found")
}

/// The sent fields of `fields` plus their defaults (Zod `.default()`).
fn with_defaults(mut vals: Obj, fields: &[Field]) -> Obj {
    for f in fields {
        if !vals.contains_key(f.name) && !matches!(f.default, Def::Null) {
            vals.insert(f.name.into(), f.default.value());
        }
    }
    vals
}

/// The columns of `fields` present in `vals` (literals of the schemas).
fn sent<'a>(fields: &'a [Field], vals: &Obj) -> Vec<&'a str> {
    fields
        .iter()
        .map(|f| f.name)
        .filter(|n| vals.contains_key(*n))
        .collect()
}

/// A missing project behind `projectId` is a bad reference.
/// arkyo-server: Prisma levait une erreur (500) dans arkyo.
fn write_error(e: sqlx::Error) -> Response {
    if let sqlx::Error::Database(d) = &e {
        if d.is_foreign_key_violation() {
            return bad("Référence introuvable.");
        }
    }
    db_error(e)
}

async fn rig_rows(
    conn: &mut SqliteConnection,
    filter: &str,
    binds: &[&str],
) -> Result<Vec<Obj>, sqlx::Error> {
    let sql = format!(
        r#"SELECT {RIG_COLS} FROM "RigConfig" {filter} ORDER BY "updatedAt" DESC, "id" DESC"#
    );
    let mut q = sqlx::query(&sql);
    for b in binds {
        q = q.bind(*b);
    }
    Ok(q.fetch_all(conn)
        .await?
        .iter()
        .map(|r| row_map(r, &RIG_CONFIG))
        .collect())
}

async fn rig_row(conn: &mut SqliteConnection, id: &str) -> Result<Option<Obj>, sqlx::Error> {
    Ok(rig_rows(conn, r#"WHERE "id" = ?"#, &[id])
        .await?
        .into_iter()
        .next())
}

/// Racks with their slots: enriched like `/api/racks` (`full`), or with
/// `equipment` only and sorted by `startU` (the rig detail).
async fn racks_with_slots(
    conn: &mut SqliteConnection,
    ids: &[String],
    full: bool,
) -> Result<HashMap<String, Value>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let filter = format!(r#"WHERE r."id" IN ({})"#, vec!["?"; ids.len()].join(", "));
    let binds: Vec<&str> = ids.iter().map(String::as_str).collect();
    let mut racks = enrich::rack_rows(conn, &filter, &binds, r#"r."id""#).await?;
    if full {
        enrich::attach_slots(conn, &mut racks, SlotOrder::Created).await?;
        enrich::slots(conn, &mut racks).await?;
    } else {
        enrich::attach_slots(conn, &mut racks, SlotOrder::StartU).await?;
        enrich::slot_equipment(conn, &mut racks).await?;
    }
    Ok(racks
        .into_iter()
        .map(|r| {
            (
                str_of(&r, "id").unwrap_or_default().to_string(),
                Value::Object(r),
            )
        })
        .collect())
}

/// Adds `rigRacks` (by `position`, each with its `rack`) to every rig.
async fn attach_rig_racks(
    conn: &mut SqliteConnection,
    rigs: &mut [Obj],
    full: bool,
) -> Result<(), sqlx::Error> {
    let rig_ids: Vec<String> = rigs
        .iter()
        .filter_map(|r| str_of(r, "id").map(str::to_string))
        .collect();
    if rig_ids.is_empty() {
        return Ok(());
    }
    let sql = format!(
        r#"SELECT "id", "rigConfigId", "rackId", "position" FROM "RigRack"
           WHERE "rigConfigId" IN ({}) ORDER BY "position", "id""#,
        vec!["?"; rig_ids.len()].join(", ")
    );
    let mut q = sqlx::query(&sql);
    for id in &rig_ids {
        q = q.bind(id);
    }
    let links: Vec<Obj> = q
        .fetch_all(&mut *conn)
        .await?
        .iter()
        .map(|r| row_map(r, &PLAIN))
        .collect();
    let mut rack_ids: Vec<String> = links
        .iter()
        .filter_map(|l| str_of(l, "rackId").map(str::to_string))
        .collect();
    rack_ids.sort_unstable();
    rack_ids.dedup();
    let racks = racks_with_slots(conn, &rack_ids, full).await?;
    let mut by_rig: HashMap<String, Vec<Value>> = HashMap::new();
    for mut l in links {
        let rack = str_of(&l, "rackId")
            .and_then(|id| racks.get(id))
            .cloned()
            .unwrap_or(Value::Null);
        l.insert("rack".into(), rack);
        let rig = str_of(&l, "rigConfigId").unwrap_or_default().to_string();
        by_rig.entry(rig).or_default().push(Value::Object(l));
    }
    for r in rigs.iter_mut() {
        let list = str_of(r, "id")
            .and_then(|id| by_rig.remove(id))
            .unwrap_or_default();
        r.insert("rigRacks".into(), Value::Array(list));
    }
    Ok(())
}

// ── GET /api/rigs ───────────────────────────────────────────────────────────

/// Session only. Rigs (updatedAt desc), `?projectId=` those of a project,
/// `?templates=true` the templates outside any project (it wins, as the
/// later spread of arkyo's `where`).
pub async fn list(
    State(st): State<AppState>,
    _u: CurrentUser,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let project = q
        .get("projectId")
        .map(String::as_str)
        .filter(|p| !p.is_empty());
    let (filter, binds): (&str, Vec<&str>) =
        if q.get("templates").map(String::as_str) == Some("true") {
            (r#"WHERE "isTemplate" = 1 AND "projectId" IS NULL"#, vec![])
        } else if let Some(p) = project {
            (r#"WHERE "projectId" = ?"#, vec![p])
        } else {
            ("", vec![])
        };
    let mut conn = match st.pool.acquire().await {
        Ok(c) => c,
        Err(e) => return db_error(e),
    };
    let res = async {
        let mut rigs = rig_rows(&mut conn, filter, &binds).await?;
        attach_rig_racks(&mut conn, &mut rigs, true).await?;
        Ok::<_, sqlx::Error>(rigs)
    }
    .await;
    match res {
        Ok(rigs) => {
            Json(Value::Array(rigs.into_iter().map(Value::Object).collect())).into_response()
        }
        Err(e) => db_error(e),
    }
}

// ── POST /api/rigs ──────────────────────────────────────────────────────────

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
    let vals = validate_flat(&parse_body(&body)?, &CREATE).map_err(failure)?;
    let vals = with_defaults(vals, &CREATE);

    let id = new_id();
    let now = now_iso();
    let cols = sent(&CREATE, &vals);
    let sql = format!(
        r#"INSERT INTO "RigConfig" ("id", "createdById", "createdAt", "updatedAt", {}) VALUES (?, ?, ?, ?, {})"#,
        cols.iter()
            .map(|c| format!(r#""{c}""#))
            .collect::<Vec<_>>()
            .join(", "),
        vec!["?"; cols.len()].join(", ")
    );
    let mut tx = begin(&st.pool).await?;
    let mut q = sqlx::query(&sql)
        .bind(&id)
        .bind(&me.id)
        .bind(&now)
        .bind(&now);
    for c in &cols {
        q = bind(q, &vals[*c]);
    }
    q.execute(&mut *tx).await.map_err(write_error)?;
    let mut rig = rig_row(&mut tx, &id)
        .await
        .map_err(db_error)?
        .ok_or_else(not_found)?;
    tx.commit().await.map_err(db_error)?;
    // `include: { rigRacks: true }` of a new rig.
    rig.insert("rigRacks".into(), json!([]));
    st.events.publish("rig", "created", Some(&id));
    Ok((StatusCode::CREATED, Json(Value::Object(rig))).into_response())
}

// ── GET /api/rigs/:id ───────────────────────────────────────────────────────

/// Session only. The rig, its `rigRacks` (by position) with each `rack` and
/// its slots (by `startU`, with `equipment`), and `project { id, name }`.
pub async fn detail(
    State(st): State<AppState>,
    _u: CurrentUser,
    Path(id): Path<String>,
) -> Response {
    let mut conn = match st.pool.acquire().await {
        Ok(c) => c,
        Err(e) => return db_error(e),
    };
    let res = async {
        let Some(rig) = rig_row(&mut conn, &id).await? else {
            return Ok(None);
        };
        let mut rigs = [rig];
        attach_rig_racks(&mut conn, &mut rigs, false).await?;
        let [mut rig] = rigs;
        let project: Option<(String, String)> =
            sqlx::query_as(r#"SELECT "id", "name" FROM "Project" WHERE "id" = ?"#)
                .bind(str_of(&rig, "projectId").unwrap_or_default())
                .fetch_optional(&mut *conn)
                .await?;
        rig.insert(
            "project".into(),
            project.map_or(Value::Null, |(id, name)| json!({ "id": id, "name": name })),
        );
        Ok::<_, sqlx::Error>(Some(rig))
    }
    .await;
    match res {
        Ok(Some(rig)) => Json(Value::Object(rig)).into_response(),
        Ok(None) => not_found(),
        Err(e) => db_error(e),
    }
}

// ── PATCH /api/rigs/:id ─────────────────────────────────────────────────────

pub async fn update(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    update_inner(&st, &me, &id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn update_inner(
    st: &AppState,
    me: &crate::users::User,
    id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let vals = validate_flat(&parse_body(&body)?, &UPDATE).map_err(failure)?;

    let mut tx = begin(&st.pool).await?;
    // arkyo-server: une régie inconnue donne 404 « Not found » ; Prisma
    // levait une erreur (500) dans arkyo.
    let current = rig_row(&mut tx, id)
        .await
        .map_err(db_error)?
        .ok_or_else(not_found)?;
    // Invariant métier : un RigConfig lié à un projet ne devient jamais un
    // template ; il faut passer par « Sauver comme template », qui clone.
    if vals.get("isTemplate") == Some(&Value::Bool(true))
        && str_of(&current, "projectId").is_some_and(|p| !p.is_empty())
    {
        return Err(bad(TEMPLATE_MSG));
    }
    let cols = sent(&UPDATE, &vals);
    let sets: String = cols.iter().map(|c| format!(r#", "{c}" = ?"#)).collect();
    let sql = format!(r#"UPDATE "RigConfig" SET "updatedAt" = ?{sets} WHERE "id" = ?"#);
    let mut q = sqlx::query(&sql).bind(now_iso());
    for c in &cols {
        q = bind(q, &vals[*c]);
    }
    q.bind(id).execute(&mut *tx).await.map_err(write_error)?;
    let rig = rig_row(&mut tx, id)
        .await
        .map_err(db_error)?
        .ok_or_else(not_found)?;
    tx.commit().await.map_err(db_error)?;
    st.events.publish("rig", "updated", Some(id));
    Ok(Json(Value::Object(rig)).into_response())
}

// ── DELETE /api/rigs/:id ────────────────────────────────────────────────────

pub async fn remove(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    // arkyo-server: garde serveur alignée sur l'UI (design:admin).
    if let Err(r) = require(&me, &st.pool, Domain::Design, Level::Admin).await {
        return r;
    }
    // Its links go with it (RigRack ON DELETE CASCADE), not its racks.
    let res = sqlx::query(r#"DELETE FROM "RigConfig" WHERE "id" = ?"#)
        .bind(&id)
        .execute(&st.pool)
        .await;
    match res {
        // arkyo-server: une régie inconnue donne 404 « Not found » ; Prisma
        // levait une erreur (500) dans arkyo.
        Ok(r) if r.rows_affected() == 0 => not_found(),
        Ok(_) => {
            st.events.publish("rig", "deleted", Some(&id));
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => db_error(e),
    }
}

// ── POST /api/rigs/:id/racks ────────────────────────────────────────────────

/// `{ rackId }` links an existing rack; any other body creates a rack
/// (`createSchema`) and links it. The link goes at the end of the rig.
pub async fn add_rack(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    add_rack_inner(&st, &me, &id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn add_rack_inner(
    st: &AppState,
    me: &crate::users::User,
    rig_id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let body = parse_body(&body)?;

    let mut tx = begin(&st.pool).await?;
    let rig: Option<String> = sqlx::query_scalar(r#"SELECT "id" FROM "RigConfig" WHERE "id" = ?"#)
        .bind(rig_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
    if rig.is_none() {
        return Err(error(StatusCode::NOT_FOUND, "Rig not found"));
    }
    let position = next_position(&mut tx, rig_id).await.map_err(db_error)?;

    // Case 1: `linkSchema` ({ rackId: string }).
    let (rack_id, action) = if let Some(rack_id) = body.get("rackId").and_then(Value::as_str) {
        let rack: Option<String> = sqlx::query_scalar(r#"SELECT "id" FROM "Rack" WHERE "id" = ?"#)
            .bind(rack_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?;
        if rack.is_none() {
            return Err(error(StatusCode::NOT_FOUND, "Rack not found"));
        }
        let linked: Option<String> = sqlx::query_scalar(
            r#"SELECT "id" FROM "RigRack" WHERE "rigConfigId" = ? AND "rackId" = ?"#,
        )
        .bind(rig_id)
        .bind(rack_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
        if linked.is_some() {
            return Err(error(
                StatusCode::CONFLICT,
                "Rack already linked to this rig",
            ));
        }
        (rack_id.to_string(), "linked")
    } else {
        // Case 2: create a rack, then link it.
        let vals = validate_flat(&body, &CREATE_RACK).map_err(failure)?;
        let vals = with_defaults(vals, &CREATE_RACK);
        let id = new_id();
        let now = now_iso();
        let cols = sent(&CREATE_RACK, &vals);
        let sql = format!(
            r#"INSERT INTO "Rack" ("id", "createdAt", "updatedAt", {}) VALUES (?, ?, ?, {})"#,
            cols.iter()
                .map(|c| format!(r#""{c}""#))
                .collect::<Vec<_>>()
                .join(", "),
            vec!["?"; cols.len()].join(", ")
        );
        let mut q = sqlx::query(&sql).bind(&id).bind(&now).bind(&now);
        for c in &cols {
            q = bind(q, &vals[*c]);
        }
        q.execute(&mut *tx).await.map_err(db_error)?;
        (id, "created")
    };
    link_rack(&mut tx, rig_id, &rack_id, position)
        .await
        .map_err(db_error)?;

    let mut link: Obj = sqlx::query(
        r#"SELECT "id", "rigConfigId", "rackId", "position" FROM "RigRack"
           WHERE "rigConfigId" = ? AND "rackId" = ?"#,
    )
    .bind(rig_id)
    .bind(&rack_id)
    .fetch_one(&mut *tx)
    .await
    .map(|r| row_map(&r, &PLAIN))
    .map_err(db_error)?;
    let rack = racks_with_slots(&mut tx, std::slice::from_ref(&rack_id), true)
        .await
        .map_err(db_error)?
        .remove(&rack_id)
        .unwrap_or(Value::Null);
    link.insert("rack".into(), rack);
    tx.commit().await.map_err(db_error)?;
    st.events.publish("rack", action, Some(&rack_id));
    Ok((StatusCode::CREATED, Json(Value::Object(link))).into_response())
}

// ── DELETE /api/rigs/:id/racks/:rackId ──────────────────────────────────────

/// Removes the link, not the rack.
pub async fn unlink(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((rig_id, rack_id)): Path<(String, String)>,
) -> Response {
    // arkyo-server: garde serveur alignée sur l'UI (design:write : retirer un
    // contenant modifie la régie, il ne supprime rien).
    if let Err(r) = require(&me, &st.pool, Domain::Design, Level::Write).await {
        return r;
    }
    let res = sqlx::query(r#"DELETE FROM "RigRack" WHERE "rigConfigId" = ? AND "rackId" = ?"#)
        .bind(&rig_id)
        .bind(&rack_id)
        .execute(&st.pool)
        .await;
    match res {
        Ok(r) if r.rows_affected() == 0 => error(StatusCode::NOT_FOUND, "Link not found"),
        Ok(_) => {
            st.events.publish("rack", "unlinked", Some(&rack_id));
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => db_error(e),
    }
}
