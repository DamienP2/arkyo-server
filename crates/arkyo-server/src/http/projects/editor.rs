//! `GET /api/tenant/projects/:id/editor`.
//!
//! arkyo-server: données de la page serveur d'arkyo. arkyo built the
//! editor's data in its Server Component
//! (arkyo:app/(fullscreen)/project/[id]/page.tsx); here the client page
//! reads it from this route. The JSON is exactly `ProjectEditorData`
//! (`_components/project-editor.tsx:207-231`), built as `page.tsx` builds it
//! (phase-4 inventory §1.1):
//! - `header` and `fiche` (`ficheData`, :263-293);
//! - `inventaire.racks`: the racks of the project's first rig
//!   (`rigConfigs[0]`), `RigRack` deduplicated by rack (:295-305), each with
//!   `constructionChecks` reduced to a count, `hasConnectors`, its placed
//!   slots (without `startU`/`heightU` excluded) and its typed BOM (:306-493);
//! - `inventaire.locations` with `virtualRackId` (:509-518);
//! - `cartographie.maps = []`: the `Carto*` tables come with phase 5.
//!
//! Single local catalogue: `fetchCatalogEquipmentMap` is
//! [`enrich::equipment_map`], and the BOM is [`api::enrich_rows`] in project
//! mode, which already resolves arkyo's category colour (primary function by
//! `sortOrder`, else the equipment category, :120-261) from the `Tenant*`
//! tables. The BOM item is then cut to `page.tsx`'s shape: no `refId` for a
//! panel or an adapter, and an accessory's name and `depthMm` ignore
//! `accessoryDepthMm`, which `page.tsx` does not select ("Étagère 1U").
//! A row that references both an equipment that is gone and something else
//! fell through to the next branch in `page.tsx`; the inventory routes never
//! write such a row (`validateInventoryRef`), so it is dropped like any
//! orphan.
//!
//! The tenant name `page.tsx` read from the main DB (`tenantName` prop, not
//! part of `ProjectEditorData`) becomes the site name, which the client page
//! reads from `GET /api/site` (AppConfig `site.name`), as the panel editor.

use std::collections::HashMap;

use arkyo_core::permissions::{Domain, Level};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::{Row, SqliteConnection};

use super::super::parametres::{db_error, row_map, str_of, Obj};
use super::super::{error, require, AppState, CurrentUser};
use super::{project_row, tenant, PLAIN};
use crate::inventory::api::{self, format_accessory_name, BomItemDto, BomMode};
use crate::inventory::{distinct, marks};
use crate::projects::enrich;

pub async fn get(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    // arkyo-server: garde du layout d'arkyo (`projects:read`,
    // app/(fullscreen)/project/[id]/layout.tsx:22), la page n'exigeant
    // qu'une session.
    if let Err(r) = require(&me, &st.pool, Domain::Projects, Level::Read).await {
        return r;
    }
    let mut conn = match st.pool.acquire().await {
        Ok(c) => c,
        Err(e) => return db_error(e),
    };
    match editor_data(&mut conn, &id).await {
        Ok(Some(v)) => Json(v).into_response(),
        // `notFound()`.
        Ok(None) => error(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => db_error(e),
    }
}

/// `ProjectEditorData` of project `id`, `None` when it does not exist.
async fn editor_data(conn: &mut SqliteConnection, id: &str) -> Result<Option<Value>, sqlx::Error> {
    let Some(project) = project_row(conn, id).await? else {
        return Ok(None);
    };
    let p = |k: &str| project.get(k).cloned().unwrap_or(Value::Null);

    let documents: Vec<Value> = sqlx::query(
        r#"SELECT "id", "name", "url", "mimeType", "sizeBytes", "uploadedAt"
           FROM "ProjectDocument" WHERE "projectId" = ? ORDER BY "uploadedAt" DESC, "id""#,
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?
    .iter()
    .map(|r| Value::Object(row_map(r, &PLAIN)))
    .collect();
    let counts = tenant::counts(conn, id).await?;

    let header = json!({
        "id": p("id"), "name": p("name"), "status": p("status"),
        "interventionType": p("interventionType"), "rigType": p("rigType"),
        "clientName": p("clientName"), "shootingDate": p("shootingDate"),
        "location": p("location"), "prestationType": p("prestationType"),
    });
    let fiche = json!({
        "id": p("id"), "name": p("name"), "status": p("status"),
        "interventionType": p("interventionType"), "rigType": p("rigType"),
        "clientName": p("clientName"), "shootingDate": p("shootingDate"),
        "shootingEndDate": p("shootingEndDate"), "planningStart": p("planningStart"),
        "planningEnd": p("planningEnd"), "commissioningDate": p("commissioningDate"),
        "location": p("location"), "description": p("description"),
        "prestationType": p("prestationType"), "documents": documents,
        "counts": counts,
    });

    // `rigConfigs[0]`: the project's first rig, as `project_rig` picks it.
    let rig_id: Option<String> = sqlx::query_scalar(
        r#"SELECT "id" FROM "RigConfig" WHERE "projectId" = ? ORDER BY "createdAt", "id" LIMIT 1"#,
    )
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?;
    let racks = match &rig_id {
        Some(rig) => rig_racks(conn, rig).await?,
        None => Vec::new(),
    };

    let locations: Vec<Value> = sqlx::query(
        r#"SELECT "id", "name", "cableCode", "sortOrder" FROM "Location"
           WHERE "projectId" = ? ORDER BY "sortOrder", "createdAt", "id""#,
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?
    .iter()
    .map(|r| {
        let mut l = row_map(r, &PLAIN);
        let lid = str_of(&l, "id").unwrap_or_default().to_string();
        let virtual_rack = racks
            .iter()
            .find(|r| {
                r.get("isVirtual") == Some(&Value::Bool(true))
                    && str_of(r, "locationId") == Some(lid.as_str())
            })
            .and_then(|r| r.get("id").cloned())
            .unwrap_or(Value::Null);
        l.insert("virtualRackId".into(), virtual_rack);
        Value::Object(l)
    })
    .collect();

    Ok(Some(json!({
        "header": header,
        "fiche": fiche,
        "inventaire": {
            "rigConfigId": rig_id,
            "racks": racks,
            "locations": locations,
        },
        // arkyo-server: cartographie en phase 5 (tables `Carto*` absentes).
        "cartographie": { "maps": [] },
    })))
}

/// The `InventaireRack[]` of rig `rig` (page.tsx:295-493).
async fn rig_racks(conn: &mut SqliteConnection, rig: &str) -> Result<Vec<Obj>, sqlx::Error> {
    // `RigRack` by position, deduplicated by rack (first occurrence kept).
    let links: Vec<String> = sqlx::query_scalar(
        r#"SELECT "rackId" FROM "RigRack" WHERE "rigConfigId" = ? ORDER BY "position", "id""#,
    )
    .bind(rig)
    .fetch_all(&mut *conn)
    .await?;
    let rack_ids = distinct(links.iter().map(|s| Some(s.as_str())));
    if rack_ids.is_empty() {
        return Ok(Vec::new());
    }
    let binds: Vec<&str> = rack_ids.iter().map(String::as_str).collect();
    let filter = format!(r#"WHERE r."id" IN ({})"#, marks(binds.len()));
    let mut by_id: HashMap<String, Obj> = enrich::rack_rows(conn, &filter, &binds, r#"r."id""#)
        .await?
        .into_iter()
        .map(|r| (str_of(&r, "id").unwrap_or_default().to_string(), r))
        .collect();

    // Every slot (`_count.slots`), then the catalogue of the slots.
    let slot_sql = format!(
        r#"SELECT "rackId", "startU", "heightU", "widthFraction", "view", "catalogEquipmentId"
           FROM "RackSlot" WHERE "rackId" IN ({}) ORDER BY "createdAt", "id""#,
        marks(binds.len())
    );
    let slot_rows = binds
        .iter()
        .fold(sqlx::query(&slot_sql), |q, b| q.bind(*b))
        .fetch_all(&mut *conn)
        .await?;
    let slot_eq_ids = distinct(
        slot_rows
            .iter()
            .map(|r| r.get::<Option<&str>, _>("catalogEquipmentId")),
    );
    let equipment = enrich::equipment_map(conn, &slot_eq_ids).await?;
    let mut slots_by_rack: HashMap<String, Vec<&sqlx::sqlite::SqliteRow>> = HashMap::new();
    for s in &slot_rows {
        slots_by_rack.entry(s.get("rackId")).or_default().push(s);
    }

    // The BOM: the inventory of each rack (`createdAt` asc), enriched once.
    let mut rows_by_rack = Vec::with_capacity(rack_ids.len());
    for rack in &rack_ids {
        rows_by_rack.push(api::inventory_rows(conn, rack).await?);
    }
    let all_rows: Vec<_> = rows_by_rack.iter().flatten().cloned().collect();
    let dtos: HashMap<String, BomItemDto> = api::enrich_rows(conn, &all_rows, BomMode::Project)
        .await?
        .into_iter()
        .map(|d| (d.id.clone(), d))
        .collect();

    let mut out = Vec::with_capacity(rack_ids.len());
    for (rack_id, rows) in rack_ids.iter().zip(&rows_by_rack) {
        let Some(r) = by_id.remove(rack_id) else {
            continue;
        };
        let slots = slots_by_rack.remove(rack_id).unwrap_or_default();
        let eq_of = |s: &sqlx::sqlite::SqliteRow| {
            s.get::<Option<&str>, _>("catalogEquipmentId")
                .and_then(|e| equipment.get(e))
        };
        let has_connectors = slots.iter().any(|s| {
            eq_of(s)
                .and_then(|e| e.get("connectors"))
                .and_then(Value::as_array)
                .is_some_and(|c| !c.is_empty())
        });
        let placed: Vec<Value> = slots
            .iter()
            .filter_map(|s| {
                // Ghost slots (`startU = null`) are not placed yet.
                let start: i64 = s.get::<Option<i64>, _>("startU")?;
                let height: f64 = s.get::<Option<f64>, _>("heightU")?;
                let eq = eq_of(s);
                let f = |k: &str| eq.and_then(|e| e.get(k)).cloned().unwrap_or(Value::Null);
                Some(json!({
                    "startU": start,
                    "heightU": height,
                    "widthFraction": s.get::<String, _>("widthFraction"),
                    "view": s.get::<String, _>("view"),
                    "category": f("category"),
                    "categoryId": f("categoryId"),
                    "equipmentName": f("name"),
                    "equipmentReference": f("reference"),
                    "brandName": eq
                        .and_then(|e| e.get("brand"))
                        .and_then(|b| b.get("name"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    "weightKg": f("weight"),
                    "powerW": f("powerW"),
                }))
            })
            .collect();
        let bom: Vec<Value> = rows
            .iter()
            .filter_map(|row| dtos.get(&row.id))
            .map(bom_item)
            .collect();
        let checks = r
            .get("constructionChecks")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        let g = |k: &str| r.get(k).cloned().unwrap_or(Value::Null);
        let rack = json!({
            "id": g("id"),
            "rigConfigId": rig,
            "name": g("name"),
            "rackType": g("rackType"),
            "totalU": g("totalU"),
            "depthMm": g("depthMm"),
            "widthMm": g("widthMm"),
            "heightMm": g("heightMm"),
            "hasWheels": g("hasWheels"),
            "emptyWeightKg": g("emptyWeightKg"),
            "slotsCount": slots.len(),
            "constructionChecks": checks,
            "isRackable": g("isRackable"),
            "hasConnectors": has_connectors,
            "canvasX": g("canvasX"),
            "canvasY": g("canvasY"),
            "locationId": g("locationId"),
            "isVirtual": g("isVirtual"),
            "slots": placed,
            "bom": bom,
        });
        if let Value::Object(o) = rack {
            out.push(o);
        }
    }
    Ok(out)
}

/// A BOM line as `page.tsx` builds it (:354-491) from the inventory
/// route's `BomItemDto`.
fn bom_item(d: &BomItemDto) -> Value {
    let accessory = d.kind == "accessory";
    let name = match (accessory, &d.accessory_type, d.accessory_height_u) {
        // `accessoryDepthMm` is not selected: no « · 450mm ».
        (true, Some(t), Some(h)) => {
            format_accessory_name(t, h, d.accessory_variant.as_deref(), None)
        }
        _ => d.name.clone(),
    };
    let mut item = json!({
        "id": d.id,
        "kind": d.kind,
        "quantity": d.quantity,
        "name": name,
        "reference": d.reference,
        "brandName": d.brand_name,
        "category": d.category,
        "categoryColor": d.category_color.clone().flatten(),
        "isRackable": d.is_rackable,
        "heightU": d.height_u,
        "depthMm": if accessory { None } else { d.depth_mm },
        "weightKg": d.weight_kg,
        "powerW": d.power_w,
        "snapshotId": d.snapshot_id,
        "hostItemId": d.host_item_id,
        "hostSlotIndex": d.host_slot_index,
        "isComponentHost": d.is_component_host,
        "hostSlotCount": d.host_slot_count,
        "isComponent": d.is_component,
        "componentSlotSpan": d.component_slot_span,
    });
    // `refId` only on the equipment branch.
    if d.kind == "equipment" {
        item["refId"] = json!(d.ref_id);
    }
    item
}
