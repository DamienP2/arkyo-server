//! arkyo:app/api/tenant/projects/[id]/locations/[locationId]/route.ts
//! (`PATCH`, `DELETE`): one location of a project.
//!
//! - `PATCH` renames the location, changes its cable code, its canvas zone
//!   or its order; a new name or cable code is copied to its virtual rack.
//! - `DELETE` refuses a location that still has containers or free
//!   equipment (409), then deletes its virtual rack (and, by cascade,
//!   everything on it) and the location.
//!
//! Validation errors use `{ error: parsed.error.flatten() }`. Audit
//! `update_location` / `delete_location`, app event `location` with
//! `{ projectId }`.
//!
//! arkyo-server:
//! - garde serveur alignée sur l'UI (`projects:write`, décision 4) ;
//! - mode fantôme SaaS retiré (`assertNotGhost`, no-op dans arkyo) ;
//! - une transaction `BEGIN IMMEDIATE` par requête, contrôles et audit
//!   compris (arkyo lisait le lieu avant sa transaction) ;
//! - au `DELETE`, un rack virtuel qu'une autre régie partage (modèle ou
//!   autre projet) est détaché du projet au lieu d'être supprimé, comme au
//!   `DELETE` d'un projet (phase 3, focus de revue 1).

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::super::parametres::{
    begin, bind, db_error, failure, row_map, validate_flat, Field, Kind, Obj,
};
use super::super::{error, require, server_error, AppState, CurrentUser};
use super::{lenient_body, PLAIN};
use crate::audit;
use crate::events::EventMeta;
use crate::ids::now_iso;
use crate::users::User;

/// The scalar fields of the Prisma `Location` model, in the schema's order.
const LOCATION_COLS: &str = r#""id", "projectId", "name", "cableCode", "sortOrder", "canvasX",
    "canvasY", "canvasW", "canvasH", "createdAt", "updatedAt""#;

/// `patchSchema` (route.ts:29-37), every field optional.
static PATCH: [Field; 7] = [
    Field::new(
        "name",
        Kind::Bounded {
            min_msg: "Too small: expected string to have >=1 characters",
            max: 120,
            max_msg: "Too big: expected string to have <=120 characters",
            upper: false,
        },
    ),
    Field::new("cableCode", Kind::MaxLen(5)).nullable(),
    Field::new("sortOrder", Kind::IntMin(0)),
    Field::new("canvasX", Kind::Int).nullable(),
    Field::new("canvasY", Kind::Int).nullable(),
    Field::new("canvasW", Kind::IntPos).nullable(),
    Field::new("canvasH", Kind::IntPos).nullable(),
];

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Not found")
}

fn conflict(msg: &str) -> Response {
    error(StatusCode::CONFLICT, msg)
}

/// `assertLocationBelongsToProject` (route.ts:12-25): the location row, its
/// virtual rack (the first one) and its number of non-virtual racks.
struct Located {
    row: Obj,
    virtual_rack: Option<String>,
    containers: i64,
}

async fn owned_location(
    conn: &mut SqliteConnection,
    location_id: &str,
    project_id: &str,
) -> Result<Located, Response> {
    let row = sqlx::query(&format!(
        r#"SELECT {LOCATION_COLS} FROM "Location" WHERE "id" = ? AND "projectId" = ?"#
    ))
    .bind(location_id)
    .bind(project_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(db_error)?
    .ok_or_else(not_found)?;
    let virtual_rack: Option<String> = sqlx::query_scalar(
        r#"SELECT "id" FROM "Rack" WHERE "locationId" = ? AND "isVirtual" = 1
           ORDER BY "createdAt", "id" LIMIT 1"#,
    )
    .bind(location_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(db_error)?;
    let containers: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM "Rack" WHERE "locationId" = ? AND "isVirtual" = 0"#,
    )
    .bind(location_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(db_error)?;
    Ok(Located {
        row: row_map(&row, &PLAIN),
        virtual_rack,
        containers,
    })
}

fn publish(st: &AppState, action: &str, project_id: &str, location_id: &str) {
    st.events.publish_meta(
        "location",
        action,
        Some(location_id),
        EventMeta {
            project_id: Some(project_id.to_string()),
            ..EventMeta::default()
        },
    );
}

/// The cable code as arkyo normalises it (route.ts:70-73): a non-empty
/// string is upper-cased, stripped of everything but `A-Z0-9` and cut to 5
/// characters; `null` or `""` give `null`.
fn normalize_cable_code(v: &Value) -> Value {
    match v.as_str() {
        Some(s) if !s.is_empty() => Value::String(
            s.trim()
                .to_uppercase()
                .chars()
                .filter(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
                .take(5)
                .collect(),
        ),
        _ => Value::Null,
    }
}

// ── PATCH /api/tenant/projects/:id/locations/:locationId ────────────────────

pub async fn update(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((project_id, location_id)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    update_inner(&st, &me, &project_id, &location_id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn update_inner(
    st: &AppState,
    me: &User,
    project_id: &str,
    location_id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let mut tx = begin(&st.pool).await?;
    let located = owned_location(&mut tx, location_id, project_id).await?;
    let vals = validate_flat(&lenient_body(&body), &PATCH).map_err(failure)?;

    // `updateData` (route.ts:68-78).
    let mut sets = vec![r#""updatedAt" = ?"#.to_string()];
    let mut values = vec![json!(now_iso())];
    for f in &PATCH {
        let Some(v) = vals.get(f.name) else { continue };
        let v = match f.name {
            "name" => json!(v.as_str().unwrap_or_default().trim()),
            "cableCode" => normalize_cable_code(v),
            _ => v.clone(),
        };
        sets.push(format!(r#""{}" = ?"#, f.name));
        values.push(v);
    }
    let sql = format!(
        r#"UPDATE "Location" SET {} WHERE "id" = ?"#,
        sets.join(", ")
    );
    let mut q = sqlx::query(&sql);
    for v in &values {
        q = bind(q, v);
    }
    q.bind(location_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    let row = sqlx::query(&format!(
        r#"SELECT {LOCATION_COLS} FROM "Location" WHERE "id" = ?"#
    ))
    .bind(location_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?
    .ok_or_else(server_error)?;
    let mut location = row_map(&row, &PLAIN);

    // The virtual rack follows the location's name and cable code.
    let sync_name = vals.contains_key("name");
    let sync_code = vals.contains_key("cableCode");
    if let Some(rack_id) = located
        .virtual_rack
        .as_deref()
        .filter(|_| sync_name || sync_code)
    {
        let mut sets = vec![r#""updatedAt" = ?"#];
        let mut values = vec![json!(now_iso())];
        if sync_name {
            sets.push(r#""name" = ?"#);
            values.push(location["name"].clone());
        }
        if sync_code {
            sets.push(r#""cableCode" = ?"#);
            values.push(location["cableCode"].clone());
        }
        let sql = format!(r#"UPDATE "Rack" SET {} WHERE "id" = ?"#, sets.join(", "));
        let mut q = sqlx::query(&sql);
        for v in &values {
            q = bind(q, v);
        }
        q.bind(rack_id).execute(&mut *tx).await.map_err(db_error)?;
    }

    audit::log(
        &mut tx,
        &me.id,
        "update_location",
        "Location",
        location_id,
        Some(project_id),
        None,
        Some(Value::Object(vals)),
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    publish(st, "updated", project_id, location_id);

    location.insert(
        "virtualRackId".into(),
        located.virtual_rack.map_or(Value::Null, Value::String),
    );
    location.insert("containerCount".into(), Value::from(located.containers));
    Ok(Json(Value::Object(location)).into_response())
}

// ── DELETE /api/tenant/projects/:id/locations/:locationId ───────────────────

pub async fn remove(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((project_id, location_id)): Path<(String, String)>,
) -> Response {
    remove_inner(&st, &me, &project_id, &location_id)
        .await
        .unwrap_or_else(|r| r)
}

async fn remove_inner(
    st: &AppState,
    me: &User,
    project_id: &str,
    location_id: &str,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let mut tx = begin(&st.pool).await?;
    let located = owned_location(&mut tx, location_id, project_id).await?;
    if located.containers > 0 {
        return Err(conflict(
            "Ce lieu contient des contenants — déplacez-les avant suppression",
        ));
    }
    // arkyo-server: les items de tous les racks virtuels du lieu sont
    // comptés (arkyo ne regardait que le premier ; un lieu n'en a qu'un).
    let free: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM "RackInventoryItem" WHERE "rackId" IN
               (SELECT "id" FROM "Rack" WHERE "locationId" = ? AND "isVirtual" = 1)"#,
    )
    .bind(location_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_error)?;
    if free > 0 {
        return Err(conflict(
            "Ce lieu contient des équipements libres — retirez-les avant suppression",
        ));
    }

    // Its virtual rack goes; the SQL cascades take RigRack, RackSlot,
    // RackZone, RackLabel, RackConnection… (route.ts:166-173). A rack
    // another rig shares is only unlinked from this project's rigs; the
    // location's deletion then clears its `locationId` (SET NULL).
    // The `NOT EXISTS` is the predicate of `rack_shared_outside`
    // (`projects/mod.rs`), inlined to delete in one statement.
    sqlx::query(
        r#"DELETE FROM "Rack" WHERE "id" IN (
               SELECT r."id" FROM "Rack" r
               WHERE r."locationId" = ? AND r."isVirtual" = 1
                 AND NOT EXISTS (SELECT 1 FROM "RigRack" rr
                                 JOIN "RigConfig" g ON g."id" = rr."rigConfigId"
                                 WHERE rr."rackId" = r."id"
                                   AND (g."projectId" IS NULL OR g."projectId" <> ?)))"#,
    )
    .bind(location_id)
    .bind(project_id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    sqlx::query(
        r#"DELETE FROM "RigRack"
           WHERE "rackId" IN (SELECT "id" FROM "Rack" WHERE "locationId" = ?)
             AND "rigConfigId" IN (SELECT "id" FROM "RigConfig" WHERE "projectId" = ?)"#,
    )
    .bind(location_id)
    .bind(project_id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    sqlx::query(r#"DELETE FROM "Location" WHERE "id" = ?"#)
        .bind(location_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;

    audit::log(
        &mut tx,
        &me.id,
        "delete_location",
        "Location",
        location_id,
        Some(project_id),
        Some(json!({ "name": located.row.get("name").cloned().unwrap_or(Value::Null) })),
        None,
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    publish(st, "deleted", project_id, location_id);
    Ok(Json(json!({ "ok": true })).into_response())
}
