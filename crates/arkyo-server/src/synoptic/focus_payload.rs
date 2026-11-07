//! arkyo:lib/services/synoptic-focus-payload.ts: the synoptic payload of a
//! rack, used by `GET /api/tenant/projects/:id/synoptic/location/:locationId`
//! (`crate::http::projects` `synoptic_location`). The focus route
//! (`…/synoptic/focus/:rackId`) has no caller and is not ported (4c,
//! decision 1).
//!
//! Loading (SQL) is split from computing (pure functions):
//! 1. [`load_rack_for_payload`]: `loadRackForPayload`, the rack and its
//!    relations as Prisma's `include` returns them;
//! 2. [`load_catalog_rows`] then [`build_catalog_lookups`] (pure):
//!    `buildCatalogLookups`;
//! 3. [`enrich_rack_payload`] (pure): `enrichRackPayload`;
//! 4. [`load_target_lookups`] then [`enrich_external_ports_target_label`]
//!    (pure): `enrichExternalPortsTargetLabel`;
//! 5. [`load_cable_app_config`], for `loadCableAppConfig`;
//! 6. [`visible_external_ports`] (pure): the intra-location resorption of
//!    the location route (route.ts:180-192).
//!
//! Single local catalogue (4a decision 12, 4b decision 3):
//! - no snapshots: `loadProjectSnapshotMap`, the brands read from the
//!   snapshots and `resolveEquipmentData` / `resolveAdapterData` become a
//!   lookup by `catalogEquipmentId` / `catalogAdapterId` (`snapshotId` is
//!   always null);
//! - `mainDb.catalogEquipment` and its tenant fallback → `TenantEquipment`
//!   (full row, inactive items included); `catalogAdapter` + fallback →
//!   `TenantAdapter` (full row); `catalogBrand` + fallback → `TenantBrand`;
//!   `catalogConnectorType` → `TenantConnectorType` (`functions` from
//!   `functionIds`); `catalogFunction` → `TenantFunction`;
//!   `catalogSignalType` → `TenantSignalType`; `catalogEquipmentCategory` →
//!   `TenantEquipmentCategory`;
//! - `enrichExternalPortsTargetLabel` read `mainDb.catalogEquipment` with no
//!   tenant fallback: here every equipment is resolved, so a personal item
//!   gets its name and port label too.
//!
//! Orders that arkyo leaves to Postgres are fixed: insertion order (`rowid`)
//! where arkyo has no `orderBy`, `createdAt` then insertion order where it
//! sorts on `createdAt`, top-level slots by `synopticY` (nulls last, as in
//! Postgres) then `createdAt`, functions and equipment categories by
//! `sortOrder` then insertion order.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Map, Value};
use sqlx::SqliteConnection;

use crate::catalogue::enrich::{ADAPTER as TENANT_ADAPTER, EQUIPMENT};
use crate::http::parametres::{str_of, Table};
use crate::http::projects::canvas_data::{
    connector_type_rows, connector_type_shape, fetch, signal_rows, PANEL_SLOT,
};
use crate::http::projects::PLAIN;
use crate::http::rack_connections::CONN;
use crate::http::rack_objects::{BUNDLE_TABLE, LABEL_TABLE, ZONE_TABLE};
use crate::http::rack_objects2::{ADAPTER, PANEL_ROW, PORT};
use crate::inventory::distinct;
use crate::projects::enrich::{rack_row, rows_in, RACK_SLOT, SLOT_COLS};

pub type Obj = Map<String, Value>;

/// `ProjectConnection` rows (Prisma scalars, `wired` boolean, JSON
/// `waypoints` and `tags`).
pub(crate) static PROJECT_CONNECTION: Table = Table {
    name: "ProjectConnection",
    bools: &["wired"],
    jsons: &["waypoints", "tags"],
};

/// `CABLE_APP_CONFIG_KEYS` (synoptic-focus-payload.ts:114-130).
pub const CABLE_APP_CONFIG_KEYS: [&str; 15] = [
    "cable_numbering_convention",
    "cable_pad",
    "cable_sep1",
    "cable_sep2",
    "cable_separator",
    "cable_suffix_separator",
    "cable_include_rack",
    "cable_template",
    "cable_template_enabled",
    "cable_numbering_pad",
    "cable_numbering_sep1",
    "cable_numbering_sep2",
    "cable_numbering_include_rack",
    "cable_numbering_template",
    "cable_numbering_template_enabled",
];

/// Prisma's default colour of a signal or connector type: not an override.
const PRISMA_DEFAULT_GRAY: &str = "#6b7280";
/// Colour of a signal or connector type without colour nor function colour.
const FALLBACK_COLOR: &str = "#a3a3a3";

static NULL: Value = Value::Null;

/// `o[key]`, `null` when absent (JavaScript reads `undefined`, which
/// compares and serialises like `null` here).
fn at<'a>(o: &'a Obj, key: &str) -> &'a Value {
    o.get(key).unwrap_or(&NULL)
}

/// A non-empty string (JavaScript truthiness of a string field).
fn truthy<'a>(o: &'a Obj, key: &str) -> Option<&'a str> {
    str_of(o, key).filter(|s| !s.is_empty())
}

/// The objects of the array `o[key]`.
fn objects<'a>(o: &'a Obj, key: &str) -> impl Iterator<Item = &'a Obj> {
    o.get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
}

// ── 1) loadRackForPayload ───────────────────────────────────────────────────

/// A rack as `loadRackForPayload` returns it (synoptic-focus-payload.ts:33-104).
pub struct RackForPayload {
    /// The `Rack` scalars (`rackMeta`).
    pub rack: Obj,
    /// Top-level slots (`parentSlotId` null), each with `panel` (`{id, name,
    /// heightU, slotsPerU, rearCableDepthMm, slots}` or null), `panelRows`,
    /// `attachedAdapters` and `children` (each child with `panel`,
    /// `panelRows` and `attachedAdapters`, no `children`).
    pub slots: Vec<Obj>,
    /// `RackConnection` rows with `bundle` (`{id, name, color}` or null).
    pub connections: Vec<Obj>,
    pub zones: Vec<Obj>,
    pub labels: Vec<Obj>,
    pub adapters: Vec<Obj>,
    pub bundles: Vec<Obj>,
    /// The rack's `ExternalPort` rows (by `rackId`: the port's slot may sit
    /// in another rack, `PATCH …/external-ports/:id` allows it).
    pub external_ports: Vec<Obj>,
}

/// `SELECT * FROM t WHERE "rackId" = ? ORDER BY "createdAt", rowid`.
async fn of_rack(
    conn: &mut SqliteConnection,
    t: &Table,
    rack_id: &str,
) -> Result<Vec<Obj>, sqlx::Error> {
    fetch(
        conn,
        &format!(
            r#"SELECT * FROM "{}" WHERE "rackId" = ? ORDER BY "createdAt", rowid"#,
            t.name
        ),
        &[rack_id.to_string()],
        t,
    )
    .await
}

/// Groups `rows` by the string `key`, keeping their order.
fn group(rows: Vec<Obj>, key: &str) -> HashMap<String, Vec<Value>> {
    let mut out: HashMap<String, Vec<Value>> = HashMap::new();
    for r in rows {
        if let Some(k) = str_of(&r, key).map(str::to_string) {
            out.entry(k).or_default().push(Value::Object(r));
        }
    }
    out
}

/// `loadRackForPayload(db, rackId)`: `None` when the rack does not exist.
pub async fn load_rack_for_payload(
    conn: &mut SqliteConnection,
    rack_id: &str,
) -> Result<Option<RackForPayload>, sqlx::Error> {
    let Some(rack) = rack_row(conn, rack_id).await? else {
        return Ok(None);
    };
    let top = fetch(
        conn,
        &format!(
            r#"SELECT {SLOT_COLS} FROM "RackSlot" WHERE "rackId" = ? AND "parentSlotId" IS NULL
               ORDER BY "synopticY" IS NULL, "synopticY", "createdAt", rowid"#
        ),
        &[rack_id.to_string()],
        &RACK_SLOT,
    )
    .await?;
    let top_ids = distinct(top.iter().map(|s| str_of(s, "id")));
    let children = rows_in(
        conn,
        &RACK_SLOT,
        "RackSlot",
        SLOT_COLS,
        "parentSlotId",
        &top_ids,
        "rowid",
    )
    .await?;
    let all = || top.iter().chain(children.iter());
    let slot_ids = distinct(all().map(|s| str_of(s, "id")));
    let panel_ids = distinct(all().map(|s| str_of(s, "panelId")));

    // panel: { select: { id, name, heightU, slotsPerU, rearCableDepthMm,
    // slots: { select: { id, position, sizeSlots, label, notes,
    // catalogConnectorTypeId, mountD } } } }
    let mut panel_slots = group(
        rows_in(
            conn,
            &PANEL_SLOT,
            "PanelSlot",
            r#""panelId", "id", "position", "sizeSlots", "label", "notes",
               "catalogConnectorTypeId", "mountD""#,
            "panelId",
            &panel_ids,
            "rowid",
        )
        .await?,
        "panelId",
    );
    for list in panel_slots.values_mut() {
        for ps in list.iter_mut() {
            if let Some(o) = ps.as_object_mut() {
                o.remove("panelId");
            }
        }
    }
    let panels: HashMap<String, Value> = rows_in(
        conn,
        &PLAIN,
        "Panel",
        r#""id", "name", "heightU", "slotsPerU", "rearCableDepthMm""#,
        "id",
        &panel_ids,
        "rowid",
    )
    .await?
    .into_iter()
    .filter_map(|mut p| {
        let id = str_of(&p, "id")?.to_string();
        let slots = panel_slots.remove(&id).unwrap_or_default();
        p.insert("slots".into(), Value::Array(slots));
        Some((id, Value::Object(p)))
    })
    .collect();
    let panel_rows = group(
        rows_in(
            conn,
            &PANEL_ROW,
            "RackSlotPanelRow",
            "*",
            "slotId",
            &slot_ids,
            "rowid",
        )
        .await?,
        "slotId",
    );
    let attached = group(
        rows_in(
            conn,
            &ADAPTER,
            "SynopticAdapter",
            "*",
            "attachedSlotId",
            &slot_ids,
            "rowid",
        )
        .await?,
        "attachedSlotId",
    );
    let decorate = |mut s: Obj| -> Obj {
        let id = str_of(&s, "id").unwrap_or_default().to_string();
        let panel = str_of(&s, "panelId")
            .and_then(|p| panels.get(p))
            .cloned()
            .unwrap_or(Value::Null);
        s.insert("panel".into(), panel);
        s.insert(
            "panelRows".into(),
            Value::Array(panel_rows.get(&id).cloned().unwrap_or_default()),
        );
        s.insert(
            "attachedAdapters".into(),
            Value::Array(attached.get(&id).cloned().unwrap_or_default()),
        );
        s
    };
    let mut children_of: HashMap<String, Vec<Value>> = HashMap::new();
    for c in children {
        let parent = str_of(&c, "parentSlotId").unwrap_or_default().to_string();
        children_of
            .entry(parent)
            .or_default()
            .push(Value::Object(decorate(c)));
    }
    let slots: Vec<Obj> = top
        .into_iter()
        .map(|s| {
            let kids = str_of(&s, "id")
                .and_then(|id| children_of.remove(id))
                .unwrap_or_default();
            let mut s = decorate(s);
            s.insert("children".into(), Value::Array(kids));
            s
        })
        .collect();

    // connections: include bundle { select: { id, name, color } }.
    let mut connections = of_rack(conn, &CONN, rack_id).await?;
    let bundle_ids = distinct(connections.iter().map(|c| str_of(c, "bundleId")));
    let bundle_of: HashMap<String, Value> = rows_in(
        conn,
        &PLAIN,
        "CableBundle",
        r#""id", "name", "color""#,
        "id",
        &bundle_ids,
        "rowid",
    )
    .await?
    .into_iter()
    .filter_map(|b| Some((str_of(&b, "id")?.to_string(), Value::Object(b))))
    .collect();
    for c in &mut connections {
        let bundle = str_of(c, "bundleId")
            .and_then(|b| bundle_of.get(b))
            .cloned()
            .unwrap_or(Value::Null);
        c.insert("bundle".into(), bundle);
    }

    Ok(Some(RackForPayload {
        rack,
        slots,
        connections,
        zones: of_rack(conn, ZONE_TABLE, rack_id).await?,
        labels: of_rack(conn, LABEL_TABLE, rack_id).await?,
        adapters: of_rack(conn, &ADAPTER, rack_id).await?,
        bundles: of_rack(conn, BUNDLE_TABLE, rack_id).await?,
        external_ports: of_rack(conn, &PORT, rack_id).await?,
    }))
}

// ── 5) loadCableAppConfig ───────────────────────────────────────────────────

/// `loadCableAppConfig(db)`: the numbering keys of `AppConfig`.
pub async fn load_cable_app_config(conn: &mut SqliteConnection) -> Result<Obj, sqlx::Error> {
    load_app_config(conn, &CABLE_APP_CONFIG_KEYS).await
}

/// The `AppConfig` rows of `keys` as `{ key: value }`, insertion order.
pub(crate) async fn load_app_config(
    conn: &mut SqliteConnection,
    keys: &[&str],
) -> Result<Obj, sqlx::Error> {
    let sql = format!(
        r#"SELECT "key", "value" FROM "AppConfig" WHERE "key" IN ({}) ORDER BY rowid"#,
        crate::inventory::marks(keys.len())
    );
    let mut q = sqlx::query_as::<_, (String, String)>(&sql);
    for k in keys {
        q = q.bind(k);
    }
    Ok(q.fetch_all(conn)
        .await?
        .into_iter()
        .map(|(k, v)| (k, Value::String(v)))
        .collect())
}

// ── 2) buildCatalogLookups ──────────────────────────────────────────────────

/// The catalogue rows `buildCatalogLookups` reads.
#[derive(Default)]
pub struct CatalogRows {
    /// `TenantFunction` `{id, key, label, cablePrefix, cableSuffix, color}`.
    pub functions: Vec<Obj>,
    /// `TenantConnectorType` rows (with `functionIds`).
    pub connector_types: Vec<Obj>,
    /// `TenantSignalType` `{id, name, color, cablePrefix, cableSuffix,
    /// functionId, isIp}`.
    pub signals: Vec<Obj>,
    /// `TenantEquipmentCategory` `{id, name, color, parentId}`.
    pub categories: Vec<Obj>,
    /// `TenantEquipment` full rows of the placed and nested items.
    pub equipment: Vec<Obj>,
    /// `TenantAdapter` full rows of the placed adapters.
    pub adapters: Vec<Obj>,
    /// `TenantBrand` `{id, name}` of the equipment.
    pub brands: Vec<Obj>,
    /// `RackInventoryItem` `{id, hostItemId, hostSlotIndex,
    /// catalogEquipmentId, snapshotId}` nested in the host slots.
    pub components: Vec<Obj>,
}

/// What `buildCatalogLookups` returns (`snapshotMap` excepted).
#[derive(Default)]
pub struct CatalogLookups {
    /// `catalogEqMap`.
    pub equipment: HashMap<String, Obj>,
    /// `catalogAdMap`.
    pub adapters: HashMap<String, Obj>,
    /// `connectorMap`: `{id, name, versions, iconId, color, functions,
    /// functionId}`, colour as stored.
    pub connectors: HashMap<String, Value>,
    /// `brandMap`: `{id, name}`.
    pub brands: HashMap<String, Value>,
    /// `componentsByHost`, sorted by `hostSlotIndex ?? 0`.
    pub components_by_host: HashMap<String, Vec<Obj>>,
    /// `enrichedConnectorTypesFull` (colour resolved).
    pub connector_types: Vec<Value>,
    /// `enrichedSignals`.
    pub signals: Vec<Value>,
    pub signal_categories: Vec<Value>,
    pub equipment_categories: Vec<Value>,
}

/// The catalogue rows the slots, children, components and adapters of
/// `racks` reference, and the referentials.
pub async fn load_catalog_rows(
    conn: &mut SqliteConnection,
    racks: &[RackForPayload],
) -> Result<CatalogRows, sqlx::Error> {
    let slots: Vec<&Obj> = racks
        .iter()
        .flat_map(|r| r.slots.iter())
        .flat_map(|s| std::iter::once(s).chain(objects(s, "children")))
        .collect();
    let host_ids = distinct(slots.iter().map(|s| str_of(s, "inventoryItemId")));
    // orderBy hostSlotIndex asc (Postgres: nulls last).
    let components = rows_in(
        conn,
        &PLAIN,
        "RackInventoryItem",
        r#""id", "hostItemId", "hostSlotIndex", "catalogEquipmentId", "snapshotId""#,
        "hostItemId",
        &host_ids,
        r#""hostSlotIndex" IS NULL, "hostSlotIndex", rowid"#,
    )
    .await?;
    let equipment_ids = distinct(
        slots
            .iter()
            .copied()
            .chain(components.iter())
            .map(|s| str_of(s, "catalogEquipmentId")),
    );
    let adapter_ids = distinct(
        slots
            .iter()
            .flat_map(|s| objects(s, "attachedAdapters"))
            .chain(racks.iter().flat_map(|r| r.adapters.iter()))
            .map(|a| str_of(a, "catalogAdapterId")),
    );
    let equipment = rows_in(
        conn,
        &EQUIPMENT,
        "TenantEquipment",
        "*",
        "id",
        &equipment_ids,
        "rowid",
    )
    .await?;
    let adapters = rows_in(
        conn,
        &TENANT_ADAPTER,
        "TenantAdapter",
        "*",
        "id",
        &adapter_ids,
        "rowid",
    )
    .await?;
    let brand_ids = distinct(equipment.iter().map(|e| str_of(e, "brandId")));
    let brands = rows_in(
        conn,
        &PLAIN,
        "TenantBrand",
        r#""id", "name""#,
        "id",
        &brand_ids,
        "rowid",
    )
    .await?;
    let functions = function_rows(conn).await?;
    let categories = fetch(
        conn,
        r#"SELECT "id", "name", "color", "parentId" FROM "TenantEquipmentCategory"
           ORDER BY "sortOrder", rowid"#,
        &[],
        &PLAIN,
    )
    .await?;
    Ok(CatalogRows {
        functions,
        connector_types: connector_type_rows(conn).await?,
        signals: signal_rows(conn).await?,
        categories,
        equipment,
        adapters,
        brands,
        components,
    })
}

/// Every `TenantFunction` `{id, key, label, cablePrefix, cableSuffix,
/// color}`, by `sortOrder` then insertion order.
pub(crate) async fn function_rows(conn: &mut SqliteConnection) -> Result<Vec<Obj>, sqlx::Error> {
    fetch(
        conn,
        r#"SELECT "id", "key", "label", "cablePrefix", "cableSuffix", "color"
           FROM "TenantFunction" ORDER BY "sortOrder", rowid"#,
        &[],
        &PLAIN,
    )
    .await
}

/// Rows keyed by their `id`.
fn by_id(rows: Vec<Obj>) -> HashMap<String, Obj> {
    rows.into_iter()
        .filter_map(|r| Some((str_of(&r, "id")?.to_string(), r)))
        .collect()
}

/// The colour of a signal or connector type (synoptic-focus-payload.ts:
/// 388-399): its own unless it is Prisma's default grey, else its
/// function's, else `#a3a3a3`.
fn resolve_color(own: &Value, function: Option<&Obj>) -> Value {
    if let Some(c) = own
        .as_str()
        .filter(|c| !c.is_empty() && c.to_lowercase() != PRISMA_DEFAULT_GRAY)
    {
        return Value::String(c.to_string());
    }
    match function.map(|f| at(f, "color")).filter(|c| !c.is_null()) {
        Some(c) => c.clone(),
        None => json!(FALLBACK_COLOR),
    }
}

/// The pure part of `buildCatalogLookups` (synoptic-focus-payload.ts:
/// 287-441).
pub fn build_catalog_lookups(rows: CatalogRows) -> CatalogLookups {
    let functions: HashMap<&str, &Obj> = rows
        .functions
        .iter()
        .filter_map(|f| Some((str_of(f, "id")?, f)))
        .collect();

    let equipment_categories = rows
        .categories
        .iter()
        .filter(|c| at(c, "parentId").is_null())
        .map(|parent| {
            let children: Vec<Value> = rows
                .categories
                .iter()
                .filter(|c| at(c, "parentId") == at(parent, "id"))
                .map(|c| json!({ "id": at(c, "id"), "name": at(c, "name"), "color": at(c, "color") }))
                .collect();
            json!({
                "id": at(parent, "id"), "name": at(parent, "name"),
                "color": at(parent, "color"), "children": children,
            })
        })
        .collect();

    // Connector types: `{...ct, functionId: functions[0]?.functionId ?? null}`.
    let shaped: Vec<Value> = rows
        .connector_types
        .iter()
        .map(|c| {
            let mut v = connector_type_shape(c);
            let first = v["functions"]
                .get(0)
                .map_or(Value::Null, |f| f["functionId"].clone());
            v["functionId"] = first;
            v
        })
        .collect();
    let connectors: HashMap<String, Value> = shaped
        .iter()
        .filter_map(|c| Some((c["id"].as_str()?.to_string(), c.clone())))
        .collect();
    let connector_types = shaped
        .into_iter()
        .map(|mut c| {
            let function = c["functionId"].as_str().and_then(|f| functions.get(f));
            c["color"] = resolve_color(&c["color"], function.copied());
            c
        })
        .collect();

    let signals = rows
        .signals
        .iter()
        .map(|s| {
            let function = truthy(s, "functionId").and_then(|f| functions.get(f).copied());
            json!({
                "id": at(s, "id"),
                "name": at(s, "name"),
                "color": resolve_color(at(s, "color"), function),
                "cablePrefix": at(s, "cablePrefix"),
                "cableSuffix": at(s, "cableSuffix"),
                "category": function.map_or(Value::Null, |f| at(f, "label").clone()),
                "categoryRef": function.map_or(Value::Null, |f| json!({
                    "name": at(f, "label"),
                    "cablePrefix": at(f, "cablePrefix"),
                    "cableSuffix": at(f, "cableSuffix"),
                })),
            })
        })
        .collect();
    let used: HashSet<&str> = rows
        .signals
        .iter()
        .filter_map(|s| truthy(s, "functionId"))
        .collect();
    let signal_categories = rows
        .functions
        .iter()
        .filter(|f| str_of(f, "id").is_some_and(|id| used.contains(id)))
        .map(|f| {
            json!({
                "name": at(f, "label"),
                "cablePrefix": at(f, "cablePrefix"),
                "cableSuffix": at(f, "cableSuffix"),
            })
        })
        .collect();

    let mut components_by_host: HashMap<String, Vec<Obj>> = HashMap::new();
    for comp in rows.components {
        if let Some(host) = truthy(&comp, "hostItemId").map(str::to_string) {
            components_by_host.entry(host).or_default().push(comp);
        }
    }
    for list in components_by_host.values_mut() {
        // Stable, as `Array.prototype.sort`.
        list.sort_by_key(|c| at(c, "hostSlotIndex").as_i64().unwrap_or(0));
    }

    CatalogLookups {
        equipment: by_id(rows.equipment),
        adapters: by_id(rows.adapters),
        connectors,
        brands: rows
            .brands
            .into_iter()
            .filter_map(|b| {
                let id = str_of(&b, "id")?.to_string();
                Some((id, json!({ "id": at(&b, "id"), "name": at(&b, "name") })))
            })
            .collect(),
        components_by_host,
        connector_types,
        signals,
        signal_categories,
        equipment_categories,
    }
}

// ── 3) enrichRackPayload (pure) ─────────────────────────────────────────────

/// What `enrichRackPayload` returns.
pub struct EnrichedRackPayload {
    pub rack_meta: Obj,
    pub slots: Vec<Value>,
    pub connections: Vec<Value>,
    pub zones: Vec<Value>,
    pub labels: Vec<Value>,
    pub adapters: Vec<Value>,
    pub bundles: Vec<Value>,
    pub external_ports: Vec<Obj>,
    /// `{id, slotId, rowIndex, synopticX, synopticY}`, flat.
    pub panel_rows: Vec<Value>,
}

impl CatalogLookups {
    /// `resolveEquipmentData` + `brand`: `{...data, brand}` or null.
    fn equipment_of(&self, id: Option<&str>) -> Value {
        let Some(eq) = id
            .filter(|i| !i.is_empty())
            .and_then(|i| self.equipment.get(i))
        else {
            return Value::Null;
        };
        let brand = truthy(eq, "brandId")
            .and_then(|b| self.brands.get(b))
            .cloned()
            .unwrap_or(Value::Null);
        let mut out = eq.clone();
        out.insert("brand".into(), brand);
        Value::Object(out)
    }

    /// `resolveComponents(inventoryItemId)`.
    fn components_of(&self, inventory_item_id: Option<&str>) -> Value {
        let list = inventory_item_id
            .filter(|i| !i.is_empty())
            .and_then(|i| self.components_by_host.get(i))
            .map(Vec::as_slice)
            .unwrap_or_default();
        Value::Array(
            list.iter()
                .map(|comp| {
                    let id = truthy(comp, "catalogEquipmentId");
                    let span = id
                        .and_then(|i| self.equipment.get(i))
                        .map(|e| at(e, "componentSlotSpan"))
                        .filter(|s| s.is_number())
                        .cloned()
                        .unwrap_or(json!(1));
                    let index = match at(comp, "hostSlotIndex") {
                        Value::Null => json!(0),
                        v => v.clone(),
                    };
                    json!({
                        "itemId": at(comp, "id"),
                        "slotIndex": index,
                        "slotSpan": span,
                        "equipment": self.equipment_of(id),
                    })
                })
                .collect(),
        )
    }

    /// `{...a, adapter: resolveAdapterData(a)}`.
    fn with_adapter(&self, a: &Obj) -> Value {
        let adapter = truthy(a, "catalogAdapterId")
            .and_then(|id| self.adapters.get(id))
            .map_or(Value::Null, |d| Value::Object(d.clone()));
        let mut out = a.clone();
        out.insert("adapter".into(), adapter);
        Value::Object(out)
    }

    /// The panel with each slot's `connectorTypeId` alias and
    /// `connectorType`.
    fn panel_of(&self, panel: &Value) -> Value {
        let Some(p) = panel.as_object() else {
            return Value::Null;
        };
        let mut p = p.clone();
        if let Some(slots) = p.get_mut("slots").and_then(Value::as_array_mut) {
            for ps in slots.iter_mut().filter_map(Value::as_object_mut) {
                let ct = at(ps, "catalogConnectorTypeId").clone();
                let resolved = ct
                    .as_str()
                    .filter(|c| !c.is_empty())
                    .and_then(|c| self.connectors.get(c))
                    .cloned()
                    .unwrap_or(Value::Null);
                ps.insert("connectorTypeId".into(), ct);
                ps.insert("connectorType".into(), resolved);
            }
        }
        Value::Object(p)
    }

    /// `enrichSlot`: a top-level slot and its `children` (a child has no
    /// `children` key and gets none).
    fn enrich_slot(&self, s: &Obj) -> Value {
        let mut out = s.clone();
        out.insert(
            "equipment".into(),
            self.equipment_of(str_of(s, "catalogEquipmentId")),
        );
        out.insert(
            "components".into(),
            self.components_of(str_of(s, "inventoryItemId")),
        );
        out.insert("panel".into(), self.panel_of(at(s, "panel")));
        out.insert(
            "attachedAdapters".into(),
            Value::Array(
                objects(s, "attachedAdapters")
                    .map(|a| self.with_adapter(a))
                    .collect(),
            ),
        );
        if s.get("children").is_some() {
            out.insert(
                "children".into(),
                Value::Array(
                    objects(s, "children")
                        .map(|c| self.enrich_slot(c))
                        .collect(),
                ),
            );
        }
        Value::Object(out)
    }
}

fn values(rows: &[Obj]) -> Vec<Value> {
    rows.iter().cloned().map(Value::Object).collect()
}

/// `enrichRackPayload(rack, lookups)` (synoptic-focus-payload.ts:450-592).
pub fn enrich_rack_payload(rack: &RackForPayload, l: &CatalogLookups) -> EnrichedRackPayload {
    let mut panel_rows = Vec::new();
    let flat = |row: &Obj| {
        json!({
            "id": at(row, "id"),
            "slotId": at(row, "slotId"),
            "rowIndex": at(row, "rowIndex"),
            "synopticX": at(row, "synopticX"),
            "synopticY": at(row, "synopticY"),
        })
    };
    for s in &rack.slots {
        panel_rows.extend(objects(s, "panelRows").map(flat));
        for child in objects(s, "children") {
            panel_rows.extend(objects(child, "panelRows").map(flat));
        }
    }
    EnrichedRackPayload {
        rack_meta: rack.rack.clone(),
        slots: rack.slots.iter().map(|s| l.enrich_slot(s)).collect(),
        connections: values(&rack.connections),
        zones: values(&rack.zones),
        labels: values(&rack.labels),
        adapters: rack.adapters.iter().map(|a| l.with_adapter(a)).collect(),
        bundles: values(&rack.bundles),
        external_ports: rack.external_ports.clone(),
        panel_rows,
    }
}

// ── 4) enrichExternalPortsTargetLabel ───────────────────────────────────────

/// What `enrichExternalPortsTargetLabel` reads about the other end of a
/// `ProjectConnection`.
#[derive(Default)]
pub struct TargetLookups {
    /// `Rack.name` by id.
    pub rack_names: HashMap<String, String>,
    /// `RackSlot` `{id, label, catalogEquipmentId}` by id.
    pub slots: HashMap<String, Obj>,
    /// `TenantEquipment` `{id, name, connectors}` by id.
    pub equipment: HashMap<String, Obj>,
    /// `TenantConnectorType.name` by id.
    pub connector_names: HashMap<String, String>,
}

/// The racks, slots and equipment at the ends of `conns` (`ProjectConnection`
/// `{id, fromRackId, fromSlotId, fromConnectorIndex, toRackId, toSlotId,
/// toConnectorIndex, label}`), and the connector names of `l`. Both ends are
/// loaded (arkyo: the end opposite to the rack), which gives the same
/// labels.
pub async fn load_target_lookups(
    conn: &mut SqliteConnection,
    conns: &[Obj],
    l: &CatalogLookups,
) -> Result<TargetLookups, sqlx::Error> {
    let connector_names = l
        .connectors
        .iter()
        .filter_map(|(id, c)| Some((id.clone(), c["name"].as_str()?.to_string())))
        .collect();
    if conns.is_empty() {
        return Ok(TargetLookups {
            connector_names,
            ..TargetLookups::default()
        });
    }
    let ends = |key: &str| -> Vec<String> {
        distinct(conns.iter().flat_map(|c| {
            [
                str_of(c, &format!("from{key}")),
                str_of(c, &format!("to{key}")),
            ]
        }))
    };
    let rack_ids = ends("RackId");
    let slot_ids = ends("SlotId");
    let rack_names = rows_in(
        conn,
        &PLAIN,
        "Rack",
        r#""id", "name""#,
        "id",
        &rack_ids,
        "rowid",
    )
    .await?
    .into_iter()
    .filter_map(|r| {
        Some((
            str_of(&r, "id")?.to_string(),
            str_of(&r, "name")?.to_string(),
        ))
    })
    .collect();
    let slots = by_id(
        rows_in(
            conn,
            &PLAIN,
            "RackSlot",
            r#""id", "label", "catalogEquipmentId""#,
            "id",
            &slot_ids,
            "rowid",
        )
        .await?,
    );
    let equipment_ids = distinct(slots.values().map(|s| str_of(s, "catalogEquipmentId")));
    let equipment = by_id(
        rows_in(
            conn,
            &EQUIPMENT,
            "TenantEquipment",
            r#""id", "name", "connectors""#,
            "id",
            &equipment_ids,
            "rowid",
        )
        .await?,
    );
    Ok(TargetLookups {
        rack_names,
        slots,
        equipment,
        connector_names,
    })
}

/// A number as JavaScript prints it in a template string.
fn js_num(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 9_007_199_254_740_992.0 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// A value as `${v}` prints it (strings, numbers, `null`).
fn js_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n
            .as_i64()
            .map_or_else(|| js_num(n.as_f64().unwrap_or(0.0)), |i| i.to_string()),
        Value::Null => "null".into(),
        other => other.to_string(),
    }
}

/// The label of port `index` of an equipment: the entry of `connectors`
/// covering it (each entry counts `quantity ?? 1` ports), named by its
/// `label`, else its `signalName`, else its connector type, suffixed with
/// the unit number when `quantity > 1` (synoptic-focus-payload.ts:725-751).
fn port_label(connectors: &Value, index: f64, names: &HashMap<String, String>) -> Option<String> {
    let mut flat = 0.0;
    for entry in connectors.as_array()?.iter() {
        let e = entry.as_object();
        let field = |k: &str| e.and_then(|o| str_of(o, k));
        // arkyo-server: une quantité non numérique compte pour 1.
        let qty = e
            .and_then(|o| o.get("quantity"))
            .and_then(Value::as_f64)
            .unwrap_or(1.0);
        if index < flat + qty {
            let unit = index - flat;
            let base = field("label")
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .or_else(|| field("signalName").map(str::trim).filter(|s| !s.is_empty()))
                .or_else(|| {
                    field("connectorTypeId")
                        .filter(|c| !c.is_empty())
                        .and_then(|c| names.get(c))
                        .map(String::as_str)
                })
                .filter(|s| !s.is_empty())?;
            return Some(if qty > 1.0 {
                format!("{base} {}", js_num(unit + 1.0))
            } else {
                base.to_string()
            });
        }
        flat += qty;
    }
    None
}

/// Whether `side` (`from` / `to`) of `c` is the port `p` of rack `rack_id`.
fn end_is(c: &Obj, side: &str, rack_id: &str, p: &Obj) -> bool {
    str_of(c, &format!("{side}RackId")) == Some(rack_id)
        && at(c, &format!("{side}SlotId")) == at(p, "slotId")
        && at(c, &format!("{side}ConnectorIndex")) == at(p, "portIndex")
}

/// `enrichExternalPortsTargetLabel(…, rackId, externalPorts,
/// projectConnections)` (synoptic-focus-payload.ts:616-762), pure: each
/// port gets `targetLabel` (`"RACK · Équipement · Port"`, or null) and,
/// only when a connection matches, `targetCableLabel`.
pub fn enrich_external_ports_target_label(
    rack_id: &str,
    ports: &[Obj],
    conns: &[Obj],
    t: &TargetLookups,
) -> Vec<Obj> {
    ports
        .iter()
        .map(|p| {
            let mut out = p.clone();
            out.insert("targetLabel".into(), Value::Null);
            let Some(m) = conns
                .iter()
                .find(|c| end_is(c, "from", rack_id, p) || end_is(c, "to", rack_id, p))
            else {
                return out;
            };
            let other = if end_is(m, "from", rack_id, p) {
                "to"
            } else {
                "from"
            };
            let other_rack = str_of(m, &format!("{other}RackId")).unwrap_or_default();
            let rack_name = t.rack_names.get(other_rack).map_or("Rack", String::as_str);
            let other_slot = truthy(m, &format!("{other}SlotId")).and_then(|s| t.slots.get(s));
            let equipment = other_slot
                .and_then(|s| truthy(s, "catalogEquipmentId"))
                .and_then(|e| t.equipment.get(e));
            let slot_label = other_slot
                .and_then(|s| str_of(s, "label"))
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let equipment_label = slot_label.or_else(|| equipment.and_then(|e| str_of(e, "name")));
            let port = match (equipment, at(m, &format!("{other}ConnectorIndex")).as_f64()) {
                (Some(e), Some(index)) => {
                    port_label(at(e, "connectors"), index, &t.connector_names)
                }
                _ => None,
            };
            let parts: Vec<&str> = [Some(rack_name), equipment_label, port.as_deref()]
                .into_iter()
                .flatten()
                .filter(|s| !s.is_empty())
                .collect();
            let target = if parts.is_empty() {
                Value::Null
            } else {
                Value::String(parts.join(" · "))
            };
            let cable = str_of(m, "label")
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map_or(Value::Null, |s| Value::String(s.to_string()));
            out.insert("targetLabel".into(), target);
            out.insert("targetCableLabel".into(), cable);
            out
        })
        .collect()
}

// ── 6) resorption (location route) ──────────────────────────────────────────

/// The external ports still shown in a location view (route.ts:180-192): a
/// non-`MONDE` port whose `rackId:slotId:portIndex` is an end of a
/// `ProjectConnection` internal to the location is hidden (display filter
/// only).
pub fn visible_external_ports(ports: Vec<Obj>, location_conns: &[Obj]) -> Vec<Obj> {
    let mut resorbed: HashSet<String> = HashSet::new();
    for c in location_conns {
        for side in ["from", "to"] {
            let slot = at(c, &format!("{side}SlotId"));
            let index = at(c, &format!("{side}ConnectorIndex"));
            if !slot.is_null() && !index.is_null() {
                resorbed.insert(format!(
                    "{}:{}:{}",
                    js_str(at(c, &format!("{side}RackId"))),
                    js_str(slot),
                    js_str(index)
                ));
            }
        }
    }
    ports
        .into_iter()
        .filter(|p| {
            str_of(p, "kind") == Some("MONDE")
                || !resorbed.contains(&format!(
                    "{}:{}:{}",
                    js_str(at(p, "rackId")),
                    js_str(at(p, "slotId")),
                    js_str(at(p, "portIndex"))
                ))
        })
        .collect()
}
