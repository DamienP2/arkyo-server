//! arkyo:app/api/tenant/projects/[id]/racks/[rackId]/route.ts (`PATCH`,
//! `DELETE`) and arkyo:app/api/tenant/projects/[id]/racks/reorder/route.ts
//! (`POST`): a project container's properties, its deletion, and the order
//! of the project's containers.
//!
//! Validation errors use `{ error: parsed.error.flatten() }`, as in arkyo.
//! Each write is audited (`update_rack`, `delete_rack`, `reorder_racks`)
//! and publishes the app event `rack` with arkyo's `meta`.
//!
//! arkyo-server:
//! - garde serveur alignée sur l'UI (`projects:write`, décision 4) ;
//! - mode fantôme SaaS retiré (`assertNotGhost`, no-op dans arkyo) ;
//! - une transaction `BEGIN IMMEDIATE` par requête, audit compris (arkyo
//!   l'écrivait après, sans bloquer).

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use std::collections::BTreeMap;

use super::super::parametres::{begin, bind, db_error, failure, validate_flat, Field, Kind};
use super::super::racks::{RACK_TYPES, RACK_TYPE_MSG};
use super::super::{error, require, server_error, AppState, CurrentUser};
use super::{lenient_body, rack_in_project, rack_shared_outside};
use crate::audit;
use crate::events::EventMeta;
use crate::ids::now_iso;
use crate::projects::enrich::rack_row;
use crate::projects::naming::ensure_unique_rack_name_excluding;
use crate::users::User;

/// `z.string().min(1).max(120)` (Zod's default messages).
const NAME_120: Kind = Kind::Bounded {
    min_msg: "Too small: expected string to have >=1 characters",
    max: 120,
    max_msg: "Too big: expected string to have <=120 characters",
    upper: false,
};

/// `patchSchema` (route.ts:34-55), every field optional.
static PATCH: [Field; 13] = [
    Field::new("canvasX", Kind::Int).nullable(),
    Field::new("canvasY", Kind::Int).nullable(),
    Field::new("locationId", Kind::NonEmpty),
    Field::new("name", NAME_120),
    Field::new("rackType", Kind::Enum(RACK_TYPES, RACK_TYPE_MSG)),
    Field::new("isRackable", Kind::Bool),
    Field::new("totalU", Kind::IntRange(1, 60)),
    Field::new("depthMm", Kind::IntRange(50, 2000)),
    Field::new("widthMm", Kind::IntRange(50, 3000)).nullable(),
    Field::new("heightMm", Kind::IntRange(50, 3000)).nullable(),
    Field::new("hasWheels", Kind::Bool),
    Field::new("emptyWeightKg", Kind::NumRange(0, 500)).nullable(),
    Field::new("rearInteriorGapMm", Kind::IntRange(0, 2000)).nullable(),
];

/// `bodySchema` of reorder (reorder/route.ts:10-12); `min(1)` is checked
/// after.
static REORDER: [Field; 1] = [Field::new("rackIds", Kind::StrArr).required()];

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Not found")
}

fn bad(msg: &str) -> Response {
    error(StatusCode::BAD_REQUEST, msg)
}

/// `publishAppUpdate("rack", action, rackId, { projectId, rackId })`.
fn publish(st: &AppState, action: &str, project_id: &str, rack_id: &str) {
    st.events.publish_meta(
        "rack",
        action,
        Some(rack_id),
        EventMeta {
            project_id: Some(project_id.to_string()),
            rack_id: Some(rack_id.to_string()),
            ..EventMeta::default()
        },
    );
}

/// `(name, isVirtual)` of a rack of the project (`assertRackBelongsToProject`).
async fn owned_rack(
    conn: &mut sqlx::SqliteConnection,
    rack_id: &str,
    project_id: &str,
) -> Result<(String, bool), Response> {
    if !rack_in_project(conn, rack_id, project_id)
        .await
        .map_err(db_error)?
    {
        return Err(not_found());
    }
    sqlx::query_as(r#"SELECT "name", "isVirtual" FROM "Rack" WHERE "id" = ?"#)
        .bind(rack_id)
        .fetch_one(conn)
        .await
        .map_err(db_error)
}

// ── PATCH /api/tenant/projects/:id/racks/:rackId ────────────────────────────

pub async fn update(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((project_id, rack_id)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    update_inner(&st, &me, &project_id, &rack_id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn update_inner(
    st: &AppState,
    me: &User,
    project_id: &str,
    rack_id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let mut tx = begin(&st.pool).await?;
    let (_, is_virtual) = owned_rack(&mut tx, rack_id, project_id).await?;
    let vals = validate_flat(&lenient_body(&body), &PATCH).map_err(failure)?;

    if let Some(location_id) = vals.get("locationId").and_then(Value::as_str) {
        if is_virtual {
            return Err(bad("Un contenant virtuel ne peut pas être réaffecté"));
        }
        let found: Option<i64> =
            sqlx::query_scalar(r#"SELECT 1 FROM "Location" WHERE "id" = ? AND "projectId" = ?"#)
                .bind(location_id)
                .bind(project_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db_error)?;
        if found.is_none() {
            return Err(bad("Emplacement introuvable"));
        }
    }

    // `updateData`: the nullable fields when their key is sent, the others
    // when defined; both are the keys of `vals`.
    let mut sets = vec![r#""updatedAt" = ?"#.to_string()];
    let mut values = vec![json!(now_iso())];
    for f in &PATCH {
        let Some(v) = vals.get(f.name) else { continue };
        let v = if f.name == "name" {
            // `ensureUniqueRackName`: suffix « 2 », « 3 »… against the
            // project's other racks (route.ts:105-115).
            let base = v.as_str().unwrap_or_default();
            json!(
                ensure_unique_rack_name_excluding(&mut tx, Some(project_id), base, Some(rack_id))
                    .await
                    .map_err(db_error)?
            )
        } else {
            v.clone()
        };
        sets.push(format!(r#""{}" = ?"#, f.name));
        values.push(v);
    }
    let sql = format!(r#"UPDATE "Rack" SET {} WHERE "id" = ?"#, sets.join(", "));
    let mut q = sqlx::query(&sql);
    for v in &values {
        q = bind(q, v);
    }
    q.bind(rack_id).execute(&mut *tx).await.map_err(db_error)?;
    let rack = rack_row(&mut tx, rack_id)
        .await
        .map_err(db_error)?
        .ok_or_else(server_error)?;

    audit::log(
        &mut tx,
        &me.id,
        "update_rack",
        "Rack",
        rack_id,
        Some(project_id),
        None,
        Some(Value::Object(vals)),
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    publish(st, "updated", project_id, rack_id);
    Ok(Json(Value::Object(rack)).into_response())
}

// ── DELETE /api/tenant/projects/:id/racks/:rackId ───────────────────────────

pub async fn remove(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((project_id, rack_id)): Path<(String, String)>,
) -> Response {
    remove_inner(&st, &me, &project_id, &rack_id)
        .await
        .unwrap_or_else(|r| r)
}

async fn remove_inner(
    st: &AppState,
    me: &User,
    project_id: &str,
    rack_id: &str,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let mut tx = begin(&st.pool).await?;
    let (name, is_virtual) = owned_rack(&mut tx, rack_id, project_id).await?;
    // The virtual rack of a location goes with its location (route.ts:172-181).
    if is_virtual {
        return Err(bad("Un contenant virtuel se supprime via son emplacement"));
    }

    if rack_shared_outside(&mut tx, rack_id, project_id)
        .await
        .map_err(db_error)?
    {
        // arkyo-server: correction (un contenant modèle partagé avec une autre
        // régie est détaché du projet, pas supprimé : arkyo supprimait la
        // ligne `Rack` et le modèle avec elle).
        sqlx::query(
            r#"DELETE FROM "RigRack" WHERE "rackId" = ? AND "rigConfigId" IN
                   (SELECT "id" FROM "RigConfig" WHERE "projectId" = ?)"#,
        )
        .bind(rack_id)
        .bind(project_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        sqlx::query(r#"UPDATE "Rack" SET "locationId" = NULL, "updatedAt" = ? WHERE "id" = ?"#)
            .bind(now_iso())
            .bind(rack_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    } else {
        // SQL cascades: RackSlot, RackInventoryItem, RackZone, RackLabel,
        // RackConnection, CableBundle, SynopticAdapter, ExternalPort,
        // RigRack… (route.ts:183-186).
        sqlx::query(r#"DELETE FROM "Rack" WHERE "id" = ?"#)
            .bind(rack_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }

    audit::log(
        &mut tx,
        &me.id,
        "delete_rack",
        "Rack",
        rack_id,
        Some(project_id),
        Some(json!({ "rackId": rack_id, "rackName": name })),
        None,
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    publish(st, "deleted", project_id, rack_id);
    Ok(Json(json!({ "ok": true })).into_response())
}

// ── POST /api/tenant/projects/:id/racks/reorder ─────────────────────────────

pub async fn reorder(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(project_id): Path<String>,
    body: Bytes,
) -> Response {
    reorder_inner(&st, &me, &project_id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn reorder_inner(
    st: &AppState,
    me: &User,
    project_id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let vals = validate_flat(&lenient_body(&body), &REORDER).map_err(failure)?;
    let rack_ids: Vec<String> = vals
        .get("rackIds")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    if rack_ids.is_empty() {
        let mut fields = BTreeMap::new();
        fields.insert(
            "rackIds".to_string(),
            vec!["Too small: expected array to have >=1 items".to_string()],
        );
        return Err(failure((vec![], fields)));
    }

    let mut tx = begin(&st.pool).await?;
    // Every rack must belong to the project; a duplicate fails the count
    // too (reorder/route.ts:43-56).
    let marks = vec!["?"; rack_ids.len()].join(", ");
    let sql = format!(
        r#"SELECT rr."id", rr."rackId" FROM "RigRack" rr
           JOIN "RigConfig" g ON g."id" = rr."rigConfigId"
           WHERE rr."rackId" IN ({marks}) AND g."projectId" = ?"#
    );
    let mut q = sqlx::query_as::<_, (String, String)>(&sql);
    for id in &rack_ids {
        q = q.bind(id);
    }
    let rig_racks = q
        .bind(project_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_error)?;
    if rig_racks.len() != rack_ids.len() {
        return Err(bad(
            "Un ou plusieurs contenants n'appartiennent pas au projet.",
        ));
    }
    let by_rack: std::collections::HashMap<&str, &str> = rig_racks
        .iter()
        .map(|(id, rack)| (rack.as_str(), id.as_str()))
        .collect();
    for (idx, rack_id) in rack_ids.iter().enumerate() {
        let Some(rig_rack) = by_rack.get(rack_id.as_str()) else {
            continue;
        };
        sqlx::query(r#"UPDATE "RigRack" SET "position" = ? WHERE "id" = ?"#)
            .bind(idx as i64)
            .bind(*rig_rack)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }

    audit::log(
        &mut tx,
        &me.id,
        "reorder_racks",
        "Project",
        project_id,
        Some(project_id),
        None,
        Some(json!({ "rackIds": rack_ids })),
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    // The published id is the project's (reorder/route.ts:83).
    st.events.publish_meta(
        "rack",
        "updated",
        Some(project_id),
        EventMeta {
            project_id: Some(project_id.to_string()),
            ..EventMeta::default()
        },
    );
    Ok(Json(json!({ "ok": true })).into_response())
}
