//! arkyo:app/api/tenant/projects/[id]/racks/[rackId]/save-as-template/route.ts
//! and arkyo:app/api/tenant/projects/[id]/racks/clone-from-template/route.ts
//! (`POST`): a project container saved as a new template (its own template
//! rig), and a template copied into the project. Both copy the rack with
//! [`clone_rack_into`] ([`CloneScope::Full`], arkyo's `cloneRackInto`).
//!
//! - `save-as-template`: `201 { rack: {id, name}, rigConfig: {id, name} }`,
//!   audit `save_rack_as_template`, event `rig created` without `meta`.
//! - `clone-from-template`: `201 { rack }` (the inventory card: top-level
//!   slots and BOM), audit `clone_rack_from_template`, event `rig updated`
//!   with `{ projectId }`. Validation errors use
//!   `{ error: "Validation invalide", issues }`.
//!
//! arkyo-server:
//! - garde serveur alignée sur l'UI (`projects:write`, décision 4) ;
//! - mode fantôme SaaS retiré (`assertNotGhost`, no-op dans arkyo) ;
//! - une transaction `BEGIN IMMEDIATE` par requête, audit compris (arkyo
//!   écrivait sans transaction et l'audit après, sans bloquer) : une erreur
//!   ne laisse ni régie modèle vide ni copie partielle ;
//! - un corps JSON illisible donne 400 à `clone-from-template` (arkyo :
//!   500 implicite, décision 5) ;
//! - catalogue lu en direct (`fetchCatalogEquipmentMap`,
//!   `enrichRowsForTemplate` : tables locales, sans snapshot ni `mainDb`).

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::super::parametres::{
    begin, db_error, parse_body, str_of, validate_flat, Field, Kind, Obj,
};
use super::super::{error, require, AppState, CurrentUser};
use super::{invalid, link_rack, next_position, project_rig, project_row, zod_issues};
use crate::audit;
use crate::events::EventMeta;
use crate::ids::{new_id, now_iso};
use crate::inventory::api::{enrich_rows, inventory_rows, BomMode};
use crate::inventory::clone::{clone_rack_into, CloneScope, CloneTarget, NewRack};
use crate::projects::enrich::{equipment_map, rack_row};
use crate::projects::naming::ensure_unique_rack_name;
use crate::users::User;

/// `bodySchema` of clone-from-template (route.ts:21-26).
static CLONE: [Field; 2] = [
    Field::new("rackTemplateId", Kind::NonEmpty).required(),
    Field::new("locationId", Kind::NonEmpty).required(),
];

// ── POST /api/tenant/projects/:id/racks/:rackId/save-as-template ────────────

pub async fn save_as_template(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((project_id, rack_id)): Path<(String, String)>,
) -> Response {
    save_inner(&st, &me, &project_id, &rack_id)
        .await
        .unwrap_or_else(|r| r)
}

async fn save_inner(
    st: &AppState,
    me: &User,
    project_id: &str,
    rack_id: &str,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let mut tx = begin(&st.pool).await?;

    // 1. The source rack and the rig linking it to the project (:39-60).
    let name: String = sqlx::query_scalar(r#"SELECT "name" FROM "Rack" WHERE "id" = ?"#)
        .bind(rack_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Contenant introuvable"))?;
    let rig_type: String = sqlx::query_scalar(
        r#"SELECT rc."type" FROM "RigRack" rr JOIN "RigConfig" rc ON rc."id" = rr."rigConfigId"
           WHERE rr."rackId" = ? AND rc."projectId" = ? ORDER BY rr."position", rr."id" LIMIT 1"#,
    )
    .bind(rack_id)
    .bind(project_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?
    .ok_or_else(|| {
        error(
            StatusCode::NOT_FOUND,
            "Ce contenant n'appartient pas à ce projet",
        )
    })?;

    // 2. The template rig, of the source rig's type (:64-72).
    let rig_id = new_id();
    let rig_name = format!("{name} (modèle)");
    let now = now_iso();
    sqlx::query(
        r#"INSERT INTO "RigConfig" ("id","name","type","projectId","isTemplate","createdById","createdAt","updatedAt")
           VALUES (?,?,?,NULL,1,?,?,?)"#,
    )
    .bind(&rig_id)
    .bind(&rig_name)
    .bind(&rig_type)
    .bind(&me.id)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;

    // 3. A name unique among the templates, 4. the copy, 5. its link (:77-87).
    let unique = ensure_unique_rack_name(&mut tx, None, &name)
        .await
        .map_err(db_error)?;
    let rack = clone_rack_into(
        &mut tx,
        rack_id,
        CloneTarget {
            name: &unique,
            location_id: None,
            scope: CloneScope::Full,
        },
    )
    .await
    .map_err(db_error)?;
    link_rack(&mut tx, &rig_id, &rack.id, 0)
        .await
        .map_err(db_error)?;

    // 6. Audit, on the source project (:91-106).
    audit::log(
        &mut tx,
        &me.id,
        "save_rack_as_template",
        "Rack",
        &rack.id,
        Some(project_id),
        None,
        Some(json!({
            "sourceRackId": rack_id,
            "templateRigConfigId": rig_id,
            "templateRackId": rack.id,
        })),
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    st.events.publish("rig", "created", Some(&rig_id));
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "rack": { "id": rack.id, "name": rack.name },
            "rigConfig": { "id": rig_id, "name": rig_name },
        })),
    )
        .into_response())
}

// ── POST /api/tenant/projects/:id/racks/clone-from-template ─────────────────

pub async fn clone_from_template(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(project_id): Path<String>,
    body: Bytes,
) -> Response {
    clone_inner(&st, &me, &project_id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn clone_inner(
    st: &AppState,
    me: &User,
    project_id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let vals = validate_flat(&parse_body(&body)?, &CLONE)
        .map_err(|flat| invalid(StatusCode::BAD_REQUEST, zod_issues(&CLONE, flat)))?;
    let template_id = str_of(&vals, "rackTemplateId").unwrap_or_default();
    let location_id = str_of(&vals, "locationId").unwrap_or_default();

    let mut tx = begin(&st.pool).await?;
    // 1. The project, 1b. the location (:55-68).
    let project = project_row(&mut tx, project_id)
        .await
        .map_err(db_error)?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Projet introuvable"))?;
    let location: Option<i64> =
        sqlx::query_scalar(r#"SELECT 1 FROM "Location" WHERE "id" = ? AND "projectId" = ?"#)
            .bind(location_id)
            .bind(project_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?;
    if location.is_none() {
        return Err(error(StatusCode::BAD_REQUEST, "Emplacement introuvable"));
    }

    // 2. The source rack, a template: none of its rigs belongs to a project
    // (a rack linked to no rig passes, `every` on an empty list) (:71-95).
    let name: String = sqlx::query_scalar(r#"SELECT "name" FROM "Rack" WHERE "id" = ?"#)
        .bind(template_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Rack template introuvable"))?;
    let in_project: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM "RigRack" rr JOIN "RigConfig" rc ON rc."id" = rr."rigConfigId"
           WHERE rr."rackId" = ? AND rc."projectId" IS NOT NULL"#,
    )
    .bind(template_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_error)?;
    if in_project > 0 {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "Ce rack n'est pas un template (il est déjà associé à un projet)",
        ));
    }

    // 3. The project's rig, 4. the copy under a unique name, in the
    // location, 16. linked last (:98-141).
    let rig_id = project_rig(&mut tx, &project, &me.id)
        .await
        .map_err(db_error)?;
    let unique = ensure_unique_rack_name(&mut tx, Some(project_id), &name)
        .await
        .map_err(db_error)?;
    let rack = clone_rack_into(
        &mut tx,
        template_id,
        CloneTarget {
            name: &unique,
            location_id: Some(location_id),
            scope: CloneScope::Full,
        },
    )
    .await
    .map_err(db_error)?;
    let position = next_position(&mut tx, &rig_id).await.map_err(db_error)?;
    link_rack(&mut tx, &rig_id, &rack.id, position)
        .await
        .map_err(db_error)?;

    // 17. Audit (:144-163).
    let c = rack.counts;
    audit::log(
        &mut tx,
        &me.id,
        "clone_rack_from_template",
        "Rack",
        &rack.id,
        Some(project_id),
        None,
        Some(json!({
            "sourceRackId": template_id,
            "clonedRackId": rack.id,
            "slotsCount": c.slots,
            "inventoryCount": c.inventory,
            "connectionsCount": c.connections,
            "adaptersCount": c.adapters,
            "bundlesCount": c.bundles,
        })),
    )
    .await
    .map_err(db_error)?;

    // 18. The card of the new container.
    let card = card(&mut tx, &rack, &rig_id).await.map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    st.events.publish_meta(
        "rig",
        "updated",
        Some(&rig_id),
        EventMeta {
            project_id: Some(project_id.to_string()),
            ..EventMeta::default()
        },
    );
    Ok((StatusCode::CREATED, Json(json!({ "rack": card }))).into_response())
}

/// `{ rack }` of clone-from-template (route.ts:168-268): the copy's
/// fields, its top-level slots by `startU` with their catalogue equipment
/// (`fetchCatalogEquipmentMap`), and its BOM (`enrichRowsForTemplate`,
/// `InventaireBomItem` keys, `categoryColor: null`).
async fn card(
    conn: &mut SqliteConnection,
    rack: &NewRack,
    rig_id: &str,
) -> Result<Value, sqlx::Error> {
    type Slot = (Option<String>, Option<i64>, Option<f64>, String, String);
    // `orderBy: { startU: "asc" }`, unplaced slots last as in Postgres.
    let slots: Vec<Slot> = sqlx::query_as(
        r#"SELECT "catalogEquipmentId", "startU", "heightU", "widthFraction", "view"
           FROM "RackSlot" WHERE "rackId" = ? AND "parentSlotId" IS NULL
           ORDER BY "startU" IS NULL, "startU", rowid"#,
    )
    .bind(&rack.id)
    .fetch_all(&mut *conn)
    .await?;
    let mut eq_ids: Vec<String> = Vec::new();
    for id in slots.iter().filter_map(|s| s.0.clone()) {
        if !eq_ids.contains(&id) {
            eq_ids.push(id);
        }
    }
    let equipment = equipment_map(conn, &eq_ids).await?;
    let has_connectors = equipment.values().any(|e| match e.get("connectors") {
        Some(Value::Array(a)) => !a.is_empty(),
        // arkyo-server: défensif, une colonne JSON relue en chaîne (TEXT)
        // compte comme le tableau qu'elle contient ; `equipment_map` rend
        // normalement un tableau.
        Some(Value::String(s)) => serde_json::from_str::<Vec<Value>>(s)
            .map(|a| !a.is_empty())
            .unwrap_or(false),
        _ => false,
    });
    let slots_json: Vec<Value> = slots
        .iter()
        .map(|(eq_id, start_u, height_u, width, view)| {
            let eq = eq_id.as_ref().and_then(|id| equipment.get(id));
            let field = |k: &str| eq.and_then(|e| e.get(k)).cloned().unwrap_or(Value::Null);
            json!({
                "startU": start_u,
                "heightU": height_u,
                "widthFraction": width,
                "view": view,
                "category": field("category"),
                "categoryId": field("categoryId"),
                "equipmentName": field("name"),
                "equipmentReference": field("reference"),
                "brandName": eq
                    .and_then(|e| e.get("brand"))
                    .and_then(|b| b.get("name"))
                    .cloned()
                    .unwrap_or(Value::Null),
                "weightKg": field("weight"),
                "powerW": field("powerW"),
            })
        })
        .collect();

    let rows = inventory_rows(conn, &rack.id).await?;
    let bom: Vec<Value> = enrich_rows(conn, &rows, BomMode::Template)
        .await?
        .into_iter()
        .map(|dto| {
            let v = serde_json::to_value(dto).unwrap_or(Value::Null);
            let mut item = Obj::new();
            for k in BOM_KEYS {
                item.insert(k.into(), v.get(k).cloned().unwrap_or(Value::Null));
            }
            item.insert("categoryColor".into(), Value::Null);
            Value::Object(item)
        })
        .collect();

    let r = rack_row(conn, &rack.id).await?.unwrap_or_default();
    let get = |k: &str| r.get(k).cloned().unwrap_or(Value::Null);
    Ok(json!({
        "id": rack.id,
        "rigConfigId": rig_id,
        "name": get("name"),
        "rackType": get("rackType"),
        "totalU": get("totalU"),
        "depthMm": get("depthMm"),
        "widthMm": get("widthMm"),
        "heightMm": get("heightMm"),
        "hasWheels": get("hasWheels"),
        "emptyWeightKg": get("emptyWeightKg"),
        "isRackable": get("isRackable"),
        "canvasX": null,
        "canvasY": null,
        "slotsCount": slots_json.len(),
        "constructionChecks": 0,
        "hasConnectors": has_connectors,
        "slots": slots_json,
        "bom": bom,
    }))
}

/// The `InventaireBomItem` keys taken from the DTO (route.ts:221-242),
/// `categoryColor` aside.
const BOM_KEYS: [&str; 19] = [
    "id",
    "kind",
    "quantity",
    "name",
    "reference",
    "brandName",
    "category",
    "isRackable",
    "heightU",
    "depthMm",
    "weightKg",
    "powerW",
    "snapshotId",
    "hostItemId",
    "hostSlotIndex",
    "isComponentHost",
    "hostSlotCount",
    "isComponent",
    "componentSlotSpan",
];
