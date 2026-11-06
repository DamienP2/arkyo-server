//! arkyo:app/api/tenant/projects/[id]/locations/route.ts (`GET`, `POST`).
//!
//! Validation errors use arkyo's `{ error: "Validation invalide", issues }`.

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::super::parametres::{begin, db_error, row_map, validate_flat, Field, Kind, Obj};
use super::super::{error, require, server_error, AppState, CurrentUser};
use super::{invalid, link_rack, next_position, project_rig, project_row, zod_issues, PLAIN};
use crate::audit;
use crate::events::EventMeta;
use crate::ids::{new_id, now_iso};
use crate::projects::cable_code;

/// The scalar fields of the Prisma `Location` model, in the schema's order.
const LOCATION_COLS: &str = r#""id", "projectId", "name", "cableCode", "sortOrder", "canvasX",
    "canvasY", "canvasW", "canvasH", "createdAt", "updatedAt""#;

/// `postSchema` (route.ts:23-26).
static POST: [Field; 2] = [
    Field::new("name", Kind::NonEmpty).required(),
    Field::new("cableCode", Kind::MaxLen(5)),
];

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Not found")
}

async fn project_exists(conn: &mut SqliteConnection, id: &str) -> Result<bool, sqlx::Error> {
    let n: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "Project" WHERE "id" = ?"#)
        .bind(id)
        .fetch_one(conn)
        .await?;
    Ok(n > 0)
}

/// The location `id` (Prisma scalars).
async fn location_row(conn: &mut SqliteConnection, id: &str) -> Result<Option<Obj>, sqlx::Error> {
    let row = sqlx::query(&format!(
        r#"SELECT {LOCATION_COLS} FROM "Location" WHERE "id" = ?"#
    ))
    .bind(id)
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|r| row_map(&r, &PLAIN)))
}

// ── GET /api/tenant/projects/:id/locations ──────────────────────────────────

/// Session only. The project's locations by `sortOrder`, each with
/// `virtualRackId` (its virtual rack, or null) and `containerCount` (its
/// non-virtual racks).
pub async fn list(State(st): State<AppState>, _u: CurrentUser, Path(id): Path<String>) -> Response {
    let mut conn = match st.pool.acquire().await {
        Ok(c) => c,
        Err(e) => return db_error(e),
    };
    match project_exists(&mut conn, &id).await {
        Ok(true) => {}
        Ok(false) => return not_found(),
        Err(e) => return db_error(e),
    }
    let cols = LOCATION_COLS
        .split(',')
        .map(|c| format!("l.{}", c.trim()))
        .collect::<Vec<_>>()
        .join(", ");
    let rows = sqlx::query(&format!(
        r#"SELECT {cols},
               (SELECT r."id" FROM "Rack" r WHERE r."locationId" = l."id" AND r."isVirtual" = 1
                ORDER BY r."createdAt", r."id" LIMIT 1) AS "virtualRackId",
               (SELECT COUNT(*) FROM "Rack" r WHERE r."locationId" = l."id" AND r."isVirtual" = 0)
                AS "containerCount"
           FROM "Location" l WHERE l."projectId" = ?
           ORDER BY l."sortOrder", l."createdAt", l."id""#
    ))
    .bind(&id)
    .fetch_all(&mut *conn)
    .await;
    match rows {
        Ok(rows) => Json(Value::Array(
            rows.iter()
                .map(|r| Value::Object(row_map(r, &PLAIN)))
                .collect(),
        ))
        .into_response(),
        Err(e) => db_error(e),
    }
}

// ── POST /api/tenant/projects/:id/locations ─────────────────────────────────

/// Creates the location and its virtual rack (`isVirtual`, same name and
/// cable code), linked to the project's rig (created when missing) like any
/// container. `201 {...location, virtualRackId, containerCount: 0}`.
pub async fn create(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    create_inner(&st, &me, &id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn create_inner(
    st: &AppState,
    me: &crate::users::User,
    project_id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    // `req.json().catch(() => ({}))`: an unreadable body validates as `{}`.
    let body: Value = serde_json::from_slice(&body).unwrap_or_else(|_| json!({}));
    let vals = validate_flat(&body, &POST)
        .map_err(|flat| invalid(StatusCode::BAD_REQUEST, zod_issues(&POST, flat)))?;

    // arkyo-server: une seule transaction (arkyo n'y mettait que le lieu et
    // son rack virtuel ; la régie et les positions étaient lues avant).
    let mut tx = begin(&st.pool).await?;
    let project = project_row(&mut tx, project_id)
        .await
        .map_err(db_error)?
        .ok_or_else(not_found)?;

    let name = vals
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let code = vals
        .get("cableCode")
        .and_then(Value::as_str)
        .and_then(cable_code::derive)
        .or_else(|| cable_code::derive(&name));

    let rig_id = project_rig(&mut tx, &project, &me.id)
        .await
        .map_err(db_error)?;
    let position = next_position(&mut tx, &rig_id).await.map_err(db_error)?;
    let last_sort: Option<i64> =
        sqlx::query_scalar(r#"SELECT MAX("sortOrder") FROM "Location" WHERE "projectId" = ?"#)
            .bind(project_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_error)?;
    let sort_order = last_sort.map_or(0, |s| s + 1);

    let loc_id = new_id();
    let now = now_iso();
    sqlx::query(
        r#"INSERT INTO "Location" ("id","projectId","name","cableCode","sortOrder","createdAt","updatedAt")
           VALUES (?,?,?,?,?,?,?)"#,
    )
    .bind(&loc_id)
    .bind(project_id)
    .bind(&name)
    .bind(&code)
    .bind(sort_order)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    let rack_id = new_id();
    sqlx::query(
        r#"INSERT INTO "Rack" ("id","name","cableCode","isVirtual","locationId","createdAt","updatedAt")
           VALUES (?,?,?,1,?,?,?)"#,
    )
    .bind(&rack_id)
    .bind(&name)
    .bind(&code)
    .bind(&loc_id)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    link_rack(&mut tx, &rig_id, &rack_id, position)
        .await
        .map_err(db_error)?;

    let mut location = location_row(&mut tx, &loc_id)
        .await
        .map_err(db_error)?
        .ok_or_else(server_error)?;
    audit::log(
        &mut tx,
        &me.id,
        "create_location",
        "Location",
        &loc_id,
        Some(project_id),
        None,
        Some(json!({ "name": location["name"], "cableCode": location["cableCode"] })),
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    st.events.publish_meta(
        "location",
        "created",
        Some(&loc_id),
        EventMeta {
            project_id: Some(project_id.to_string()),
            ..EventMeta::default()
        },
    );

    location.insert("virtualRackId".into(), Value::String(rack_id));
    location.insert("containerCount".into(), Value::from(0));
    Ok((StatusCode::CREATED, Json(Value::Object(location))).into_response())
}
