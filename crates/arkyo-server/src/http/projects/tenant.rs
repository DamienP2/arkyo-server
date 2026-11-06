//! arkyo:app/api/tenant/projects/route.ts (`GET`, `POST`) and
//! arkyo:app/api/tenant/projects/[id]/route.ts (`GET`, `PATCH`, `DELETE`).
//!
//! Validation errors use arkyo's `{ error: "Validation invalide", issues }`.

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::{Row, SqliteConnection};

use super::super::parametres::{
    begin, bind, db_error, get_row, parse_body, row_map, validate_flat, Field, Kind, Obj,
};
use super::super::{error, require, server_error, AppState, CurrentUser};
use super::{
    convert_dates, invalid, issue, name_key, project_row, zod_issues, PLAIN, PROJECT, RACK,
    RIG_CONFIG,
};
use crate::audit;
use crate::events::EventMeta;
use crate::ids::{new_id, now_iso};

const INTERVENTION_MSG: &str = r#"Invalid option: expected one of "PRESTATION"|"INTEGRATION""#;
const RIG_TYPES: &[&str] = &["FLIGHT_CASE", "CAR", "FIXED_INSTALL", "MIXED"];
const RIG_TYPE_MSG: &str =
    r#"Invalid option: expected one of "FLIGHT_CASE"|"CAR"|"FIXED_INSTALL"|"MIXED""#;
const STATUSES: &[&str] = &["EN_PREPARATION", "PRET", "EN_COURS", "TERMINE", "ANNULE"];
const STATUS_MSG: &str =
    r#"Invalid option: expected one of "EN_PREPARATION"|"PRET"|"EN_COURS"|"TERMINE"|"ANNULE""#;

const DUPLICATE_MSG: &str = "Un projet porte déjà ce nom dans cet espace.";

/// `createSchema` (route.ts:43-55).
static CREATE: [Field; 11] = [
    Field::new("name", Kind::NonEmpty).required(),
    Field::new(
        "interventionType",
        Kind::Enum(&["PRESTATION", "INTEGRATION"], INTERVENTION_MSG),
    )
    .required(),
    Field::new("rigType", Kind::Enum(RIG_TYPES, RIG_TYPE_MSG)),
    Field::new("clientName", Kind::Str),
    Field::new("shootingDate", Kind::Str),
    Field::new("shootingEndDate", Kind::Str),
    Field::new("planningStart", Kind::Str),
    Field::new("planningEnd", Kind::Str),
    Field::new("commissioningDate", Kind::Str),
    Field::new("location", Kind::Str),
    Field::new("description", Kind::Str),
];

/// `patchSchema` ([id]/route.ts:43-56).
static PATCH: [Field; 12] = [
    Field::new("name", Kind::NonEmpty),
    Field::new("clientName", Kind::Str).nullable(),
    Field::new("shootingDate", Kind::Str).nullable(),
    Field::new("shootingEndDate", Kind::Str).nullable(),
    Field::new("planningStart", Kind::Str).nullable(),
    Field::new("planningEnd", Kind::Str).nullable(),
    Field::new("commissioningDate", Kind::Str).nullable(),
    Field::new("location", Kind::Str).nullable(),
    Field::new("prestationType", Kind::Str).nullable(),
    Field::new("description", Kind::Str).nullable(),
    Field::new("status", Kind::Enum(STATUSES, STATUS_MSG)),
    Field::new("rigType", Kind::Enum(RIG_TYPES, RIG_TYPE_MSG)).nullable(),
];

/// Validates `body` against `fields`, then converts the dates.
fn parse(body: &Bytes, fields: &[Field]) -> Result<Obj, Response> {
    let body = parse_body(body)?;
    let mut vals = validate_flat(&body, fields)
        .map_err(|flat| invalid(StatusCode::BAD_REQUEST, zod_issues(fields, flat)))?;
    convert_dates(&mut vals).map_err(|issues| invalid(StatusCode::BAD_REQUEST, issues))?;
    Ok(vals)
}

/// Inserts a project with the sent fields (the others take the column
/// defaults: status `EN_PREPARATION`, interventionType `PRESTATION`) and its
/// empty `TechnicalSheet` (`technicalSheet: { create: {} }`). `vals` only
/// holds field names of the routes' schemas.
pub(super) async fn insert_project(
    conn: &mut SqliteConnection,
    created_by: &str,
    vals: &Obj,
) -> Result<String, sqlx::Error> {
    let id = new_id();
    let now = now_iso();
    let mut cols = vec![
        r#""id""#.to_string(),
        r#""createdAt""#.into(),
        r#""updatedAt""#.into(),
        r#""createdById""#.into(),
    ];
    let mut values = vec![
        Value::String(id.clone()),
        Value::String(now.clone()),
        Value::String(now.clone()),
        Value::String(created_by.to_string()),
    ];
    for (k, v) in vals {
        cols.push(format!("\"{k}\""));
        values.push(v.clone());
    }
    let sql = format!(
        r#"INSERT INTO "Project" ({}) VALUES ({})"#,
        cols.join(", "),
        vec!["?"; cols.len()].join(", ")
    );
    let mut q = sqlx::query(&sql);
    for v in &values {
        q = bind(q, v);
    }
    q.execute(&mut *conn).await?;
    sqlx::query(
        r#"INSERT INTO "TechnicalSheet" ("id","projectId","createdAt","updatedAt") VALUES (?,?,?,?)"#,
    )
    .bind(new_id())
    .bind(&id)
    .bind(&now)
    .bind(&now)
    .execute(&mut *conn)
    .await?;
    Ok(id)
}

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Not found")
}

fn project_meta(id: &str) -> EventMeta {
    EventMeta {
        project_id: Some(id.to_string()),
        ..EventMeta::default()
    }
}

// ── GET /api/tenant/projects ────────────────────────────────────────────────

/// Session only. arkyo's `select`, plus the fields its `/projects` page
/// read on the server.
pub async fn list(State(st): State<AppState>, _u: CurrentUser) -> Response {
    // arkyo-server: données de la page serveur d'arkyo (description,
    // documentsCount, rigConfigsCount : app/(app)/projects/page.tsx:15-58).
    let rows = sqlx::query(
        r#"SELECT p."id", p."name", p."status", p."interventionType", p."rigType",
               p."clientName", p."shootingDate", p."shootingEndDate", p."planningStart",
               p."planningEnd", p."commissioningDate", p."location", p."prestationType",
               p."description", p."updatedAt", p."createdAt",
               (SELECT COUNT(*) FROM "ProjectDocument" d WHERE d."projectId" = p."id") AS "documentsCount",
               (SELECT COUNT(*) FROM "RigConfig" g WHERE g."projectId" = p."id") AS "rigConfigsCount"
           FROM "Project" p ORDER BY p."updatedAt" DESC"#,
    )
    .fetch_all(&st.pool)
    .await;
    match rows {
        Ok(rows) => {
            let projects: Vec<Value> = rows
                .iter()
                .map(|r| Value::Object(row_map(r, &PROJECT)))
                .collect();
            Json(json!({ "projects": projects })).into_response()
        }
        Err(e) => db_error(e),
    }
}

// ── POST /api/tenant/projects ───────────────────────────────────────────────

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
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let mut vals = parse(&body, &CREATE)?;

    // Name unique, ignoring case and the edge spaces (route.ts:83-112).
    let trimmed = vals
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if trimmed.is_empty() {
        return Err(invalid(
            StatusCode::BAD_REQUEST,
            vec![issue("name", "Nom requis")],
        ));
    }
    let mut tx = begin(&st.pool).await?;
    let names: Vec<String> = sqlx::query_scalar(r#"SELECT "name" FROM "Project""#)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_error)?;
    let key = name_key(&trimmed);
    if names.iter().any(|n| name_key(n) == key) {
        return Err(invalid(
            StatusCode::CONFLICT,
            vec![issue("name", DUPLICATE_MSG)],
        ));
    }
    vals.insert("name".into(), Value::String(trimmed));
    vals.insert("status".into(), Value::String("EN_PREPARATION".into()));

    let id = insert_project(&mut tx, &me.id, &vals)
        .await
        .map_err(db_error)?;
    let project = project_row(&mut tx, &id)
        .await
        .map_err(db_error)?
        .ok_or_else(server_error)?;
    audit::log(
        &mut tx,
        &me.id,
        "create",
        "Project",
        &id,
        Some(&id),
        None,
        None,
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    st.events
        .publish_meta("project", "created", Some(&id), project_meta(&id));
    Ok((StatusCode::CREATED, Json(Value::Object(project))).into_response())
}

// ── GET /api/tenant/projects/:id ────────────────────────────────────────────

/// Session only. The project with `documents` (uploadedAt desc),
/// `rigConfigs.rigRacks` (position asc) and their `rack`, and
/// `_count { tasks, messages, documents }`.
pub async fn get(State(st): State<AppState>, _u: CurrentUser, Path(id): Path<String>) -> Response {
    let mut conn = match st.pool.acquire().await {
        Ok(c) => c,
        Err(e) => return db_error(e),
    };
    match detail(&mut conn, &id).await {
        Ok(Some(v)) => Json(v).into_response(),
        Ok(None) => not_found(),
        Err(e) => db_error(e),
    }
}

async fn detail(conn: &mut SqliteConnection, id: &str) -> Result<Option<Value>, sqlx::Error> {
    let Some(mut project) = project_row(conn, id).await? else {
        return Ok(None);
    };
    let documents: Vec<Value> = sqlx::query(
        r#"SELECT * FROM "ProjectDocument" WHERE "projectId" = ? ORDER BY "uploadedAt" DESC"#,
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?
    .iter()
    .map(|r| Value::Object(row_map(r, &PLAIN)))
    .collect();

    let rigs = sqlx::query(
        r#"SELECT * FROM "RigConfig" WHERE "projectId" = ? ORDER BY "createdAt", "id""#,
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    let mut rig_configs = Vec::with_capacity(rigs.len());
    for rig in &rigs {
        let mut rig_obj = row_map(rig, &RIG_CONFIG);
        let rig_id: String = rig.get("id");
        let links = sqlx::query(
            r#"SELECT * FROM "RigRack" WHERE "rigConfigId" = ? ORDER BY "position", "id""#,
        )
        .bind(&rig_id)
        .fetch_all(&mut *conn)
        .await?;
        let mut rig_racks = Vec::with_capacity(links.len());
        for link in &links {
            let mut link_obj = row_map(link, &PLAIN);
            let rack_id: String = link.get("rackId");
            let rack = get_row(conn, &RACK, &rack_id).await?;
            link_obj.insert("rack".into(), rack.map_or(Value::Null, Value::Object));
            rig_racks.push(Value::Object(link_obj));
        }
        rig_obj.insert("rigRacks".into(), Value::Array(rig_racks));
        rig_configs.push(Value::Object(rig_obj));
    }

    let (tasks, messages, docs): (i64, i64, i64) = sqlx::query_as(
        r#"SELECT (SELECT COUNT(*) FROM "Task" WHERE "projectId" = ?1),
                  (SELECT COUNT(*) FROM "Message" WHERE "projectId" = ?1),
                  (SELECT COUNT(*) FROM "ProjectDocument" WHERE "projectId" = ?1)"#,
    )
    .bind(id)
    .fetch_one(&mut *conn)
    .await?;

    project.insert("documents".into(), Value::Array(documents));
    project.insert("rigConfigs".into(), Value::Array(rig_configs));
    project.insert(
        "_count".into(),
        json!({ "tasks": tasks, "messages": messages, "documents": docs }),
    );
    Ok(Some(Value::Object(project)))
}

// ── PATCH /api/tenant/projects/:id ──────────────────────────────────────────

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
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let vals = parse(&body, &PATCH)?;
    let mut tx = begin(&st.pool).await?;
    let existing = project_row(&mut tx, id)
        .await
        .map_err(db_error)?
        .ok_or_else(not_found)?;

    let mut sets: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    for f in &PATCH {
        if let Some(v) = vals.get(f.name) {
            sets.push(format!("\"{}\" = ?", f.name));
            values.push(v.clone());
        }
    }
    sets.push(r#""updatedAt" = ?"#.into());
    values.push(Value::String(now_iso()));
    let sql = format!(r#"UPDATE "Project" SET {} WHERE "id" = ?"#, sets.join(", "));
    let mut q = sqlx::query(&sql);
    for v in &values {
        q = bind(q, v);
    }
    q.bind(id).execute(&mut *tx).await.map_err(db_error)?;

    let project = project_row(&mut tx, id)
        .await
        .map_err(db_error)?
        .ok_or_else(server_error)?;
    audit::log(
        &mut tx,
        &me.id,
        "update",
        "Project",
        id,
        Some(id),
        Some(Value::Object(existing)),
        Some(Value::Object(project.clone())),
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    st.events
        .publish_meta("project", "updated", Some(id), project_meta(id));
    Ok(Json(Value::Object(project)).into_response())
}

// ── DELETE /api/tenant/projects/:id ─────────────────────────────────────────

pub async fn remove(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    remove_inner(&st, &me, &id).await.unwrap_or_else(|r| r)
}

async fn remove_inner(
    st: &AppState,
    me: &crate::users::User,
    id: &str,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:admin,
    // projects-client.tsx:752).
    require(me, &st.pool, Domain::Projects, Level::Admin).await?;
    let mut tx = begin(&st.pool).await?;
    let existing = project_row(&mut tx, id)
        .await
        .map_err(db_error)?
        .ok_or_else(not_found)?;

    // arkyo-server: arkyo laissait les régies du projet (RigConfig.projectId
    // en SetNull) et leurs contenants, racks virtuels des lieux compris,
    // réapparaître dans /templates (inventaire §0.10, décision 7). On
    // supprime les racks rattachés à une régie du projet ou à un de ses
    // lieux, sauf ceux qu'une autre régie (modèle ou autre projet) utilise
    // encore, puis les régies du projet. Les cascades SQL emportent RigRack,
    // RackSlot et RackInventoryItem.
    sqlx::query(
        r#"DELETE FROM "Rack" WHERE "id" IN (
               SELECT r."id" FROM "Rack" r
               WHERE (r."id" IN (SELECT rr."rackId" FROM "RigRack" rr
                                 JOIN "RigConfig" g ON g."id" = rr."rigConfigId"
                                 WHERE g."projectId" = ?)
                      OR r."locationId" IN (SELECT l."id" FROM "Location" l WHERE l."projectId" = ?))
                 AND NOT EXISTS (SELECT 1 FROM "RigRack" rr
                                 JOIN "RigConfig" g ON g."id" = rr."rigConfigId"
                                 WHERE rr."rackId" = r."id"
                                   AND (g."projectId" IS NULL OR g."projectId" <> ?)))"#,
    )
    .bind(id)
    .bind(id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    sqlx::query(r#"DELETE FROM "RigConfig" WHERE "projectId" = ?"#)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    // arkyo-server: AuditLog.projectId n'a pas de clé étrangère (0003) ;
    // on applique ici le SetNull de la relation d'arkyo.
    sqlx::query(r#"UPDATE "AuditLog" SET "projectId" = NULL WHERE "projectId" = ?"#)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    // TechnicalSheet, Location, Task, Message, ProjectDocument: ON DELETE CASCADE.
    sqlx::query(r#"DELETE FROM "Project" WHERE "id" = ?"#)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;

    audit::log(
        &mut tx,
        &me.id,
        "delete",
        "Project",
        id,
        None,
        Some(Value::Object(existing)),
        None,
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    st.events
        .publish_meta("project", "deleted", Some(id), project_meta(id));
    Ok(Json(json!({ "ok": true })).into_response())
}
