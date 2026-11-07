//! `GET /api/tenant/projects/:id/synoptic/general`
//! (arkyo:app/api/tenant/projects/[id]/synoptic/general/route.ts): the
//! general view of the project synoptic.
//!
//! - `locations`: every location of the project (`sortOrder`), each with
//!   the external connectors of all its racks (virtual rack included), each
//!   connector carrying `rackId` and `rackName`;
//! - `racks`: the non-virtual racks without location (« À affecter »),
//!   emitted even without external connector;
//! - `connections`: the raw `ProjectConnection` rows of the project, minus
//!   those whose two ends are racks of the same location;
//! - `bundles`: the raw `ProjectCableBundle` rows of the project;
//! - `connectorTypes`, `signals`, `signalCategories`: as the focus payload
//!   ([`crate::synoptic::focus_payload::build_catalog_lookups`]);
//! - `appConfig`: the 8 numbering keys of route.ts:215-230;
//! - `stats`: non-virtual racks, total weight (empty racks + equipment of
//!   every slot, rounded to 0.1) and power (rounded).
//!
//! A project without any rack answers arkyo's early return, `locations: []`
//! included even when the project has locations (route.ts:67-84). The
//! racks of the project are those of its rigs (`rigs.some.rigConfig`), in
//! `createdAt` then insertion order (arkyo: no `orderBy`). Every table is
//! read once, then grouped in memory (no query per rack or per port).
//!
//! arkyo-server:
//! - SaaS retiré : ni snapshots ni `mainDb` ; les équipements (marques
//!   externes et statistiques) sont lus dans `TenantEquipment`, ce qui
//!   compte aussi le poids et la puissance des équipements perso (arkyo :
//!   catalogue central seul, inventaire §11) ; la requête morte
//!   `panelConnectorTypes` n'est pas portée ;
//! - garde serveur `projects:read`, comme canvas-data (arkyo : session
//!   seule) ;
//! - `sortExternalConnectors` compare les ids avec `localeCompare` : ici,
//!   ordre des octets, identique pour des cuid (minuscules et chiffres).

use std::collections::HashMap;

use arkyo_core::permissions::{Domain, Level};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::super::parametres::{db_error, str_of, Obj};
use super::super::{error, require, AppState, CurrentUser};
use super::canvas_data::{connector_type_rows, fetch, signal_rows};
use super::{PLAIN, RACK};
use crate::catalogue::enrich::EQUIPMENT;
use crate::inventory::distinct;
use crate::projects::enrich::rows_in;
use crate::synoptic::focus_payload::{
    build_catalog_lookups, function_rows, load_app_config, CatalogRows, PROJECT_CONNECTION,
};

/// The `AppConfig` keys of the general view (route.ts:217-226).
const GENERAL_APP_CONFIG_KEYS: [&str; 8] = [
    "cable_pad",
    "cable_sep1",
    "cable_sep2",
    "cable_separator",
    "cable_suffix_separator",
    "cable_include_rack",
    "cable_template",
    "cable_template_enabled",
];

/// The scalar fields of the Prisma `ProjectConnection` model, in the
/// schema's order.
pub(crate) const PROJECT_CONNECTION_COLS: &str = r#""id", "projectId", "fromRackId", "fromSlotId",
    "fromConnectorIndex", "fromAdapterId", "fromAdapterPortIndex", "fromAdapterSide", "toRackId",
    "toSlotId", "toConnectorIndex", "toAdapterId", "toAdapterPortIndex", "toAdapterSide", "label",
    "color", "waypoints", "cableStyle", "notes", "tags", "catalogCableModelId", "wired", "wiredAt",
    "wiredNotes", "bundleId", "createdAt""#;

static NULL: Value = Value::Null;

pub async fn get(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(project_id): Path<String>,
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
    match general_payload(&mut conn, &project_id).await {
        Ok(Some(v)) => Json(v).into_response(),
        Ok(None) => error(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => db_error(e),
    }
}

/// `o[key]`, `null` when absent.
fn at<'a>(o: &'a Obj, key: &str) -> &'a Value {
    o.get(key).unwrap_or(&NULL)
}

/// A non-empty string (JavaScript truthiness of a string field).
fn truthy<'a>(o: &'a Obj, key: &str) -> Option<&'a str> {
    str_of(o, key).filter(|s| !s.is_empty())
}

/// `s?.trim() || …`: the trimmed string when it is not empty.
fn trimmed<'a>(o: &'a Obj, key: &str) -> Option<&'a str> {
    str_of(o, key).map(str::trim).filter(|s| !s.is_empty())
}

/// A number as `JSON.stringify` writes it (an integral value without `.0`).
fn js_number(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() < 9_007_199_254_740_992.0 {
        json!(n as i64)
    } else {
        json!(n)
    }
}

/// `Math.round(n)` (halves rounded up).
fn js_round(n: f64) -> f64 {
    (n + 0.5).floor()
}

// ── loading ─────────────────────────────────────────────────────────────────

async fn general_payload(
    conn: &mut SqliteConnection,
    project_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let project: Option<(String, String)> =
        sqlx::query_as(r#"SELECT "id", "name" FROM "Project" WHERE "id" = ?"#)
            .bind(project_id)
            .fetch_optional(&mut *conn)
            .await?;
    let Some((pid, pname)) = project else {
        return Ok(None);
    };
    let project = json!({ "id": pid, "name": pname });
    let pid = [project_id.to_string()];

    let locations = fetch(
        conn,
        r#"SELECT "id", "name", "cableCode", "canvasX", "canvasY" FROM "Location"
           WHERE "projectId" = ? ORDER BY "sortOrder", "createdAt", "id""#,
        &pid,
        &PLAIN,
    )
    .await?;
    let racks = fetch(
        conn,
        r#"SELECT "id", "name", "rackType", "totalU", "canvasX", "canvasY", "emptyWeightKg",
                  "isVirtual", "locationId"
           FROM "Rack" WHERE "id" IN (
               SELECT rr."rackId" FROM "RigRack" rr
               JOIN "RigConfig" rc ON rc."id" = rr."rigConfigId" WHERE rc."projectId" = ?)
           ORDER BY "createdAt", rowid"#,
        &pid,
        &RACK,
    )
    .await?;
    let rack_ids = distinct(racks.iter().map(|r| str_of(r, "id")));

    if rack_ids.is_empty() {
        return Ok(Some(json!({
            "locations": [], "racks": [], "connections": [], "bundles": [],
            "connectorTypes": [], "signals": [], "signalCategories": [],
            "appConfig": {},
            "project": project,
            "stats": { "rackCount": 0, "totalWeightKg": 0, "totalPowerW": 0 },
        })));
    }

    let ports = rows_in(
        conn,
        &PLAIN,
        "ExternalPort",
        r#""id", "rackId", "slotId", "portIndex", "label", "kind""#,
        "rackId",
        &rack_ids,
        r#""createdAt", rowid"#,
    )
    .await?;
    let slot_ids = distinct(ports.iter().map(|p| str_of(p, "slotId")));
    let slots = rows_in(
        conn,
        &PLAIN,
        "RackSlot",
        r#""id", "rackId", "catalogEquipmentId", "label", "panelId""#,
        "id",
        &slot_ids,
        "rowid",
    )
    .await?;
    let panel_ids = distinct(slots.iter().map(|s| str_of(s, "panelId")));
    let panels = rows_in(
        conn,
        &PLAIN,
        "Panel",
        r#""id", "name""#,
        "id",
        &panel_ids,
        "rowid",
    )
    .await?;
    let panel_slots = rows_in(
        conn,
        &PLAIN,
        "PanelSlot",
        r#""id", "panelId", "position", "label", "catalogConnectorTypeId""#,
        "panelId",
        &panel_ids,
        "rowid",
    )
    .await?;
    // Every slot of every rack (stats), sub-slots and virtual racks included.
    let all_slots = rows_in(
        conn,
        &PLAIN,
        "RackSlot",
        r#""catalogEquipmentId""#,
        "rackId",
        &rack_ids,
        "rowid",
    )
    .await?;
    let equipment_ids = distinct(
        slots
            .iter()
            .chain(all_slots.iter())
            .map(|s| str_of(s, "catalogEquipmentId")),
    );
    let equipment = rows_in(
        conn,
        &EQUIPMENT,
        "TenantEquipment",
        r#""id", "name", "reference", "connectors", "weight", "powerW""#,
        "id",
        &equipment_ids,
        "rowid",
    )
    .await?;
    let catalog = CatalogRows {
        functions: function_rows(conn).await?,
        connector_types: connector_type_rows(conn).await?,
        signals: signal_rows(conn).await?,
        ..CatalogRows::default()
    };
    let connections = fetch(
        conn,
        &format!(
            r#"SELECT {PROJECT_CONNECTION_COLS} FROM "ProjectConnection"
               WHERE "projectId" = ? ORDER BY "createdAt", rowid"#
        ),
        &pid,
        &PROJECT_CONNECTION,
    )
    .await?;
    let bundles = fetch(
        conn,
        r#"SELECT "id", "projectId", "name", "color", "createdAt", "updatedAt"
           FROM "ProjectCableBundle" WHERE "projectId" = ? ORDER BY "createdAt", rowid"#,
        &pid,
        &PLAIN,
    )
    .await?;
    let app_config = load_app_config(conn, &GENERAL_APP_CONFIG_KEYS).await?;

    Ok(Some(build_general(GeneralRows {
        project,
        locations,
        racks,
        ports,
        slots,
        panels,
        panel_slots,
        all_slots,
        equipment,
        catalog,
        connections,
        bundles,
        app_config,
    })))
}

// ── computing (pure) ────────────────────────────────────────────────────────

/// What the general view reads, each table loaded once.
struct GeneralRows {
    project: Value,
    /// `Location` `{id, name, cableCode, canvasX, canvasY}`, by `sortOrder`.
    locations: Vec<Obj>,
    /// The racks of the project's rigs (virtual ones included).
    racks: Vec<Obj>,
    /// `ExternalPort` `{id, rackId, slotId, portIndex, label, kind}` of the
    /// racks, by `createdAt`.
    ports: Vec<Obj>,
    /// `RackSlot` `{id, rackId, catalogEquipmentId, label, panelId}` the
    /// ports target (any rack).
    slots: Vec<Obj>,
    /// `Panel` `{id, name}` of those slots.
    panels: Vec<Obj>,
    /// `PanelSlot` `{id, panelId, position, label, catalogConnectorTypeId}`.
    panel_slots: Vec<Obj>,
    /// `RackSlot` `{catalogEquipmentId}` of every slot of the racks.
    all_slots: Vec<Obj>,
    /// `TenantEquipment` `{id, name, reference, connectors, weight, powerW}`.
    equipment: Vec<Obj>,
    catalog: CatalogRows,
    connections: Vec<Obj>,
    bundles: Vec<Obj>,
    app_config: Obj,
}

/// A panel: its name and its occupied positions (`catalogConnectorTypeId`
/// not null), by `position` (stable).
struct PanelPorts<'a> {
    name: &'a Value,
    occupied: Vec<&'a Obj>,
}

/// What `resolvePortInfo` returns.
struct PortInfo {
    label: String,
    direction: Value,
    signal_name: Value,
    connector_type_id: Value,
    side: &'static str,
}

struct Ctx<'a> {
    slots: HashMap<&'a str, &'a Obj>,
    panels: HashMap<&'a str, PanelPorts<'a>>,
    equipment: HashMap<&'a str, &'a Obj>,
    /// `enrichedConnectorTypesFull` names by id.
    connector_names: HashMap<String, Value>,
}

impl Ctx<'_> {
    fn panel_of(&self, slot: &Obj) -> Option<&PanelPorts<'_>> {
        truthy(slot, "panelId").and_then(|p| self.panels.get(p))
    }

    /// `resolvePortInfo(slotId, portIndex)` (route.ts:335-400).
    fn port_info(&self, slot_id: &str, port_index: i64) -> Option<PortInfo> {
        let slot = self.slots.get(slot_id)?;
        if port_index < 0 {
            return None;
        }

        // Panel: 2 ports per occupied position, even = right, odd = left.
        if let Some(panel) = self.panel_of(slot) {
            let col = port_index / 2;
            let ps = panel.occupied.get(usize::try_from(col).ok()?)?;
            let label = match at(ps, "label") {
                Value::Null => (col + 1).to_string(),
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            return Some(PortInfo {
                label,
                direction: json!("BIDIR"),
                signal_name: Value::Null,
                connector_type_id: at(ps, "catalogConnectorTypeId").clone(),
                side: if port_index % 2 == 0 { "right" } else { "left" },
            });
        }

        // Equipment: flat index over `quantity ?? 1` ports per entry.
        let eq = self.equipment.get(truthy(slot, "catalogEquipmentId")?)?;
        let entries = at(eq, "connectors").as_array()?;
        let empty = Obj::new();
        let mut flat: i64 = 0;
        for entry in entries {
            let e = entry.as_object().unwrap_or(&empty);
            // arkyo-server: une quantité non numérique compte pour 1.
            let qty = e.get("quantity").and_then(Value::as_f64).unwrap_or(1.0);
            let count = if qty > 0.0 { qty.ceil() as i64 } else { 0 };
            if port_index < flat + count {
                let unit = port_index - flat;
                let direction = str_of(e, "direction").map(str::to_uppercase);
                let side = if direction.as_deref() == Some("IN") {
                    "left"
                } else {
                    "right"
                };
                let base = match trimmed(e, "label") {
                    Some(l) => l.to_string(),
                    None => truthy(e, "connectorTypeId")
                        .and_then(|c| self.connector_names.get(c))
                        .and_then(Value::as_str)
                        .unwrap_or("—")
                        .to_string(),
                };
                let label = if qty > 1.0 {
                    format!("{base} {}", unit + 1)
                } else {
                    base
                };
                return Some(PortInfo {
                    label,
                    direction: direction.map_or(Value::Null, Value::String),
                    signal_name: at(e, "signalName").clone(),
                    connector_type_id: at(e, "connectorTypeId").clone(),
                    side,
                });
            }
            flat += count;
        }
        None
    }

    /// `buildExternalConnectors(ports)` (route.ts:428-471).
    fn external_connectors(&self, ports: &[&Obj]) -> Vec<Obj> {
        ports
            .iter()
            .map(|ep| {
                let slot_id = str_of(ep, "slotId").unwrap_or_default();
                let port_index = at(ep, "portIndex").as_i64().unwrap_or(0);
                let info = self.port_info(slot_id, port_index);
                let slot = self.slots.get(slot_id).copied();
                let label = trimmed(ep, "label")
                    .map(str::to_string)
                    .or_else(|| {
                        info.as_ref()
                            .map(|i| i.label.clone())
                            .filter(|l| !l.is_empty())
                    })
                    .or_else(|| slot.and_then(|s| truthy(s, "label")).map(str::to_string))
                    .unwrap_or_else(|| format!("Port {}", port_index + 1));
                let (mut equipment_id, mut equipment_name) = (Value::Null, Value::Null);
                if let Some(s) = slot {
                    let custom = trimmed(s, "label").map(|l| json!(l));
                    if let Some(panel) = self.panel_of(s) {
                        equipment_name = custom.unwrap_or_else(|| panel.name.clone());
                    } else if let Some(eq_id) = truthy(s, "catalogEquipmentId") {
                        equipment_id = json!(eq_id);
                        let eq_name = self
                            .equipment
                            .get(eq_id)
                            .and_then(|e| str_of(e, "name"))
                            .map_or(Value::Null, |n| json!(n));
                        equipment_name = custom.unwrap_or(eq_name);
                    } else {
                        equipment_name = custom.unwrap_or(Value::Null);
                    }
                }
                let (direction, signal_name, connector_type_id, side) = match info {
                    Some(i) => (i.direction, i.signal_name, i.connector_type_id, i.side),
                    None => (Value::Null, Value::Null, Value::Null, "right"),
                };
                let v = json!({
                    "externalId": at(ep, "id"),
                    "slotId": at(ep, "slotId"),
                    "portIndex": at(ep, "portIndex"),
                    "label": label,
                    "direction": direction,
                    "signalName": signal_name,
                    "connectorTypeId": connector_type_id,
                    "side": side,
                    "equipmentId": equipment_id,
                    "equipmentName": equipment_name,
                });
                match v {
                    Value::Object(o) => o,
                    _ => unreachable!(),
                }
            })
            .collect()
    }
}

/// `sortExternalConnectors` (route.ts:476-486): left side first, then by
/// `equipmentId ?? slotId`, `slotId`, `portIndex` (stable).
fn sort_external_connectors(list: &mut [Obj]) {
    fn key(c: &Obj) -> &str {
        str_of(c, "equipmentId")
            .or_else(|| str_of(c, "slotId"))
            .unwrap_or_default()
    }
    list.sort_by(|a, b| {
        let left = |c: &Obj| str_of(c, "side") == Some("left");
        left(b)
            .cmp(&left(a))
            .then_with(|| key(a).cmp(key(b)))
            .then_with(|| {
                str_of(a, "slotId")
                    .unwrap_or_default()
                    .cmp(str_of(b, "slotId").unwrap_or_default())
            })
            .then_with(|| {
                let p = |c: &Obj| at(c, "portIndex").as_i64().unwrap_or(0);
                p(a).cmp(&p(b))
            })
    });
}

fn is_virtual(r: &Obj) -> bool {
    at(r, "isVirtual").as_bool().unwrap_or(false)
}

fn build_general(rows: GeneralRows) -> Value {
    let lookups = build_catalog_lookups(rows.catalog);
    let connector_names = lookups
        .connector_types
        .iter()
        .filter_map(|c| Some((c["id"].as_str()?.to_string(), c["name"].clone())))
        .collect();

    let mut panels: HashMap<&str, PanelPorts> = rows
        .panels
        .iter()
        .filter_map(|p| {
            let id = str_of(p, "id")?;
            Some((
                id,
                PanelPorts {
                    name: at(p, "name"),
                    occupied: Vec::new(),
                },
            ))
        })
        .collect();
    for ps in &rows.panel_slots {
        if at(ps, "catalogConnectorTypeId").is_null() {
            continue;
        }
        if let Some(p) = str_of(ps, "panelId").and_then(|id| panels.get_mut(id)) {
            p.occupied.push(ps);
        }
    }
    for p in panels.values_mut() {
        p.occupied
            .sort_by_key(|ps| at(ps, "position").as_i64().unwrap_or(0));
    }
    let ctx = Ctx {
        slots: rows
            .slots
            .iter()
            .filter_map(|s| Some((str_of(s, "id")?, s)))
            .collect(),
        panels,
        equipment: rows
            .equipment
            .iter()
            .filter_map(|e| Some((str_of(e, "id")?, e)))
            .collect(),
        connector_names,
    };

    // Ports by rack, MONDE excluded (nothing to wire in the general view).
    let mut ports_by_rack: HashMap<&str, Vec<&Obj>> = HashMap::new();
    for ep in &rows.ports {
        if str_of(ep, "kind") == Some("MONDE") {
            continue;
        }
        if let Some(r) = str_of(ep, "rackId") {
            ports_by_rack.entry(r).or_default().push(ep);
        }
    }
    let ports_of = |rack: &Obj| -> Vec<Obj> {
        let ports = str_of(rack, "id")
            .and_then(|id| ports_by_rack.get(id))
            .map_or(&[][..], Vec::as_slice);
        ctx.external_connectors(ports)
    };

    // « À affecter »: non-virtual racks without location.
    let rack_nodes: Vec<Value> = rows
        .racks
        .iter()
        .filter(|r| !is_virtual(r) && at(r, "locationId").is_null())
        .map(|r| {
            let mut connectors = ports_of(r);
            sort_external_connectors(&mut connectors);
            json!({
                "id": at(r, "id"), "name": at(r, "name"), "rackType": at(r, "rackType"),
                "totalU": at(r, "totalU"), "canvasX": at(r, "canvasX"),
                "canvasY": at(r, "canvasY"), "externalConnectors": connectors,
            })
        })
        .collect();

    // Locations: the ports of all their racks, with rackId and rackName.
    let mut racks_by_location: HashMap<&str, Vec<&Obj>> = HashMap::new();
    for r in &rows.racks {
        if let Some(l) = truthy(r, "locationId") {
            racks_by_location.entry(l).or_default().push(r);
        }
    }
    let location_nodes: Vec<Value> = rows
        .locations
        .iter()
        .map(|loc| {
            let mut connectors = Vec::new();
            let loc_racks = str_of(loc, "id").and_then(|id| racks_by_location.get(id));
            for rack in loc_racks.into_iter().flatten() {
                for mut c in ports_of(rack) {
                    c.insert("rackId".into(), at(rack, "id").clone());
                    c.insert("rackName".into(), at(rack, "name").clone());
                    connectors.push(c);
                }
            }
            sort_external_connectors(&mut connectors);
            json!({
                "id": at(loc, "id"), "name": at(loc, "name"), "cableCode": at(loc, "cableCode"),
                "canvasX": at(loc, "canvasX"), "canvasY": at(loc, "canvasY"),
                "externalConnectors": connectors,
            })
        })
        .collect();

    // Inter-location connections: both ends in the same location excluded.
    let location_of: HashMap<&str, &Value> = rows
        .racks
        .iter()
        .filter_map(|r| Some((str_of(r, "id")?, at(r, "locationId"))))
        .collect();
    let loc = |c: &Obj, key: &str| -> Option<&str> {
        str_of(c, key)
            .and_then(|r| location_of.get(r))
            .and_then(|l| l.as_str())
    };
    let connections: Vec<Value> = rows
        .connections
        .into_iter()
        .filter(|c| match (loc(c, "fromRackId"), loc(c, "toRackId")) {
            (Some(f), Some(t)) => f != t,
            _ => true,
        })
        .map(Value::Object)
        .collect();

    // Stats: non-virtual racks; weight = their empty weight + the equipment
    // of every slot; power = the equipment of every slot.
    let mut weight = 0.0;
    let mut power = 0.0;
    let mut rack_count = 0;
    for r in rows.racks.iter().filter(|r| !is_virtual(r)) {
        rack_count += 1;
        weight += at(r, "emptyWeightKg").as_f64().unwrap_or(0.0);
    }
    for s in &rows.all_slots {
        let Some(eq) = truthy(s, "catalogEquipmentId").and_then(|id| ctx.equipment.get(id)) else {
            continue;
        };
        weight += at(eq, "weight").as_f64().unwrap_or(0.0);
        power += at(eq, "powerW").as_f64().unwrap_or(0.0);
    }

    json!({
        "locations": location_nodes,
        "racks": rack_nodes,
        "connections": connections,
        "bundles": rows.bundles.into_iter().map(Value::Object).collect::<Vec<_>>(),
        "connectorTypes": lookups.connector_types,
        "signals": lookups.signals,
        "signalCategories": lookups.signal_categories,
        "appConfig": rows.app_config,
        "project": rows.project,
        "stats": {
            "rackCount": rack_count,
            "totalWeightKg": js_number(js_round(weight * 10.0) / 10.0),
            "totalPowerW": js_number(js_round(power)),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounding_like_javascript() {
        assert_eq!(js_number(js_round(412.5) / 10.0), json!(41.3));
        assert_eq!(js_number(js_round(-0.5)), json!(0));
        assert_eq!(js_number(js_round(4500.0)), json!(4500));
        assert_eq!(js_number(js_round(6500.0) / 10.0), json!(650));
    }

    #[test]
    fn sort_left_first_then_group_then_port() {
        let c = |side: &str, eq: Option<&str>, slot: &str, port: i64| -> Obj {
            json!({"side": side, "equipmentId": eq, "slotId": slot, "portIndex": port})
                .as_object()
                .unwrap()
                .clone()
        };
        let mut list = vec![
            c("right", Some("e1"), "s1", 3),
            c("right", None, "a0", 0),
            c("left", Some("e2"), "s2", 1),
            c("right", Some("e1"), "s1", 1),
            c("left", None, "s9", 0),
        ];
        sort_external_connectors(&mut list);
        let got: Vec<(String, i64)> = list
            .iter()
            .map(|o| {
                (
                    o["slotId"].as_str().unwrap().into(),
                    o["portIndex"].as_i64().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            got,
            [("s2", 1), ("s9", 0), ("a0", 0), ("s1", 1), ("s1", 3)]
                .map(|(s, p)| (s.to_string(), p))
        );
    }
}
