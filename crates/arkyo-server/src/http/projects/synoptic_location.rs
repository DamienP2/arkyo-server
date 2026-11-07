//! `GET /api/tenant/projects/:id/synoptic/location/:locationId`
//! (arkyo:app/api/tenant/projects/[id]/synoptic/location/[locationId]/route.ts):
//! the synoptic payload of every rack of a location (its virtual rack
//! included), built with [`crate::synoptic::focus_payload`]. Every slot,
//! zone, label, adapter, external port, panel row and bundle carries its
//! `rackId`.
//!
//! - 404 `{ error: "Not found" }` for an unknown project, a location absent
//!   or of another project, and when none of the location's racks loads;
//! - a location without any rack answers the empty payload (`appConfig:
//!   {}`, catalogue lists empty) as arkyo's early return;
//! - `projectConnections`: the raw `ProjectConnection` rows of the project
//!   whose two ends are racks of the location;
//! - `externalPorts`: gathered by the port's `rackId` (its slot may sit in
//!   another rack), each with `targetLabel` (and `targetCableLabel` when a
//!   `ProjectConnection` of the project touching the rack matches), minus
//!   the non-`MONDE` ports resorbed by an internal connection.
//!
//! The racks of the location are taken in `createdAt` then insertion order
//! (arkyo: no `orderBy`).
//!
//! arkyo-server:
//! - SaaS retiré : ni `mainDb` ni snapshots (voir `focus_payload`) ;
//! - garde serveur `projects:read`, comme canvas-data (arkyo : session
//!   seule) ;
//! - `targetLabel` : extrémités chargées une fois pour tout le lieu (arkyo :
//!   par rack), même résultat.

use arkyo_core::permissions::{Domain, Level};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::super::parametres::{db_error, row_map, str_of, Obj};
use super::super::{error, require, AppState, CurrentUser};
use crate::inventory::marks;
use crate::synoptic::focus_payload::{
    build_catalog_lookups, enrich_external_ports_target_label, enrich_rack_payload,
    load_cable_app_config, load_catalog_rows, load_rack_for_payload, load_target_lookups,
    visible_external_ports, PROJECT_CONNECTION,
};

pub async fn get(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((project_id, location_id)): Path<(String, String)>,
) -> Response {
    // arkyo-server: garde serveur alignée sur l'UI (`projects:read`, layout
    // de l'éditeur projet ; arkyo : session seule).
    if let Err(r) = require(&me, &st.pool, Domain::Projects, Level::Read).await {
        return r;
    }
    let mut conn = match st.pool.acquire().await {
        Ok(c) => c,
        Err(e) => return db_error(e),
    };
    let out = location_payload(&mut conn, &project_id, &location_id).await;
    match out {
        Ok(Some(v)) => Json(v).into_response(),
        Ok(None) => error(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => db_error(e),
    }
}

/// The `cols` of the project's `ProjectConnection` rows with one end
/// (`both_ends`: both ends) in `racks`, oldest first.
async fn project_connections(
    conn: &mut SqliteConnection,
    cols: &str,
    project_id: &str,
    racks: &[String],
    both_ends: bool,
) -> Result<Vec<Obj>, sqlx::Error> {
    let m = marks(racks.len());
    let join = if both_ends { "AND" } else { "OR" };
    let sql = format!(
        r#"SELECT {cols} FROM "ProjectConnection"
           WHERE "projectId" = ? AND ("fromRackId" IN ({m}) {join} "toRackId" IN ({m}))
           ORDER BY "createdAt", rowid"#
    );
    let mut q = sqlx::query(&sql).bind(project_id);
    for _ in 0..2 {
        for r in racks {
            q = q.bind(r);
        }
    }
    Ok(q.fetch_all(conn)
        .await?
        .iter()
        .map(|r| row_map(r, &PROJECT_CONNECTION))
        .collect())
}

async fn location_payload(
    conn: &mut SqliteConnection,
    project_id: &str,
    location_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let project: Option<(String, String)> =
        sqlx::query_as(r#"SELECT "id", "name" FROM "Project" WHERE "id" = ?"#)
            .bind(project_id)
            .fetch_optional(&mut *conn)
            .await?;
    let Some((pid, pname)) = project else {
        return Ok(None);
    };
    let location: Option<(String, String, Option<String>)> = sqlx::query_as(
        r#"SELECT "id", "name", "cableCode" FROM "Location" WHERE "id" = ? AND "projectId" = ?"#,
    )
    .bind(location_id)
    .bind(project_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((lid, lname, lcode)) = location else {
        return Ok(None);
    };
    let racks: Vec<(String, bool)> = sqlx::query_as(
        r#"SELECT "id", "isVirtual" FROM "Rack" WHERE "locationId" = ?
           ORDER BY "createdAt", rowid"#,
    )
    .bind(location_id)
    .fetch_all(&mut *conn)
    .await?;
    let rack_ids: Vec<String> = racks.iter().map(|(id, _)| id.clone()).collect();
    let virtual_rack = racks
        .iter()
        .find(|(_, v)| *v)
        .map_or(Value::Null, |(id, _)| json!(id));
    let location = json!({
        "id": lid, "name": lname, "cableCode": lcode, "virtualRackId": virtual_rack,
    });
    let project = json!({ "id": pid, "name": pname });

    if rack_ids.is_empty() {
        return Ok(Some(json!({
            "location": location,
            "racks": [], "slots": [], "connections": [], "projectConnections": [],
            "zones": [], "labels": [], "adapters": [], "externalPorts": [],
            "panelRows": [], "bundles": [], "connectorTypes": [], "signals": [],
            "signalCategories": [], "equipmentCategories": [],
            "appConfig": {},
            "project": project,
        })));
    }

    let mut loaded = Vec::new();
    for id in &rack_ids {
        if let Some(r) = load_rack_for_payload(conn, id).await? {
            loaded.push(r);
        }
    }
    let app_config = load_cable_app_config(conn).await?;
    // Every ProjectConnection touching at least one rack of the location
    // (targetLabel of the external ports, other end anywhere).
    let touching = project_connections(
        conn,
        r#""id", "fromRackId", "fromSlotId", "fromConnectorIndex", "toRackId", "toSlotId",
           "toConnectorIndex", "label""#,
        project_id,
        &rack_ids,
        false,
    )
    .await?;
    // ProjectConnection with both ends in the location (raw rows).
    let internal = project_connections(conn, "*", project_id, &rack_ids, true).await?;
    if loaded.is_empty() {
        return Ok(None);
    }

    let lookups = build_catalog_lookups(load_catalog_rows(conn, &loaded).await?);
    let targets = load_target_lookups(conn, &touching, &lookups).await?;

    let mut summaries = Vec::new();
    let mut slots = Vec::new();
    let mut connections = Vec::new();
    let mut zones = Vec::new();
    let mut labels = Vec::new();
    let mut adapters = Vec::new();
    let mut bundles = Vec::new();
    let mut panel_rows = Vec::new();
    let mut ports = Vec::new();
    for rack in &loaded {
        let e = enrich_rack_payload(rack, &lookups);
        let m = &e.rack_meta;
        let g = |k: &str| m.get(k).cloned().unwrap_or(Value::Null);
        summaries.push(json!({
            "id": g("id"), "name": g("name"), "cableCode": g("cableCode"),
            "cableId": g("cableId"), "numberingOverride": g("numberingOverride"),
            "isVirtual": g("isVirtual"), "totalU": g("totalU"), "rackType": g("rackType"),
        }));
        let rack_id = str_of(m, "id").unwrap_or_default().to_string();
        slots.extend(e.slots);
        connections.extend(e.connections);
        zones.extend(e.zones);
        labels.extend(e.labels);
        adapters.extend(e.adapters);
        bundles.extend(e.bundles);
        for mut row in e.panel_rows {
            row["rackId"] = json!(rack_id);
            panel_rows.push(row);
        }
        let rack_touching: Vec<_> = touching
            .iter()
            .filter(|c| {
                str_of(c, "fromRackId") == Some(&rack_id) || str_of(c, "toRackId") == Some(&rack_id)
            })
            .cloned()
            .collect();
        ports.extend(enrich_external_ports_target_label(
            &rack_id,
            &e.external_ports,
            &rack_touching,
            &targets,
        ));
    }
    let ports: Vec<Value> = visible_external_ports(ports, &internal)
        .into_iter()
        .map(Value::Object)
        .collect();

    Ok(Some(json!({
        "location": location,
        "racks": summaries,
        "slots": slots,
        "connections": connections,
        "projectConnections": internal.into_iter().map(Value::Object).collect::<Vec<_>>(),
        "zones": zones,
        "labels": labels,
        "adapters": adapters,
        "externalPorts": ports,
        "panelRows": panel_rows,
        "bundles": bundles,
        "connectorTypes": lookups.connector_types,
        "signals": lookups.signals,
        "signalCategories": lookups.signal_categories,
        "equipmentCategories": lookups.equipment_categories,
        "appConfig": app_config,
        "project": project,
    })))
}
