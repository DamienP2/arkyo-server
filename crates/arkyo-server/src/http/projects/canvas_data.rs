//! `GET /api/tenant/projects/:id/racks/:rackId/canvas-data`
//! (arkyo:app/api/tenant/projects/[id]/racks/[rackId]/canvas-data/route.ts):
//! everything the Rack tab's `RackPlacementCanvas` needs for one rack.
//!
//! - `rack`: the `Rack` scalars, `rigs` (every `RigRack` of the rack with
//!   `rigConfig: {id, name, projectId}`) and the top-level `slots`
//!   (`parentSlotId` null, `startU` ascending, unplaced last as in Postgres),
//!   each `{...slot, equipment, components, panel, children}`; a child is
//!   `{...child, equipment, components, panel}`;
//! - `allEquipment` (palette, with `functions` and `brand`),
//!   `rackAccessories`, `allPanels`, `connectorTypes`, `signals`,
//!   `signalCategories: []`, `categories` (the functions), and the two
//!   AppConfig depths (`Number(value)`, defaults 5 and 150).
//!
//! Single local catalogue (decisions 3 of the 4b plan and 12 of the 4a
//! plan), each arkyo source read from its local table:
//! - `mainDb.catalogEquipment` (active) → active `TenantEquipment`: the
//!   palette, and the map that resolves a placed equipment. A placed id
//!   absent from it (an inactive item) falls back, as arkyo's tenant
//!   fallback, to the `select` of route.ts:294-315;
//! - `functions` (M:N join) → `functionIds` resolved in `TenantFunction`
//!   (unknown ids dropped), as `[{ function: {id, label, color, sortOrder} }]`;
//! - `CatalogFunction`, `CatalogConnectorType` (`functions` →
//!   `functionIds`), `CatalogSignalType`, `CatalogBrand` →
//!   `TenantFunction`, `TenantConnectorType`, `TenantSignalType`,
//!   `TenantBrand`;
//! - no snapshots: `loadProjectSnapshotMap` and `resolveEquipmentData`
//!   become a lookup by `catalogEquipmentId` (`snapshotId` is always null).
//!
//! The category of a placed equipment (`overrideCategoryWithFunction`) is
//! the label of its primary function (lowest `sortOrder`), else the name of
//! its `TenantEquipmentCategory` (arkyo's resolution for tenant items).
//!
//! arkyo-server:
//! - `TenantEquipment` n'a pas la colonne texte héritée `category` de
//!   `CatalogEquipment` : la palette et les accessoires la reçoivent, valant
//!   le nom de la catégorie réelle (`categoryId`), ou `null` ;
//! - `rackAccessories` filtrait `category = "Accessoire rack"` : le filtre
//!   porte sur ce même nom de catégorie réelle (inventaire §9.11) ;
//! - garde serveur `projects:read`, celle du layout de l'éditeur projet qui
//!   monte l'onglet Rack (arkyo : session seule).

use std::collections::HashMap;

use arkyo_core::permissions::{Domain, Level};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::super::parametres::{db_error, row_map, str_of, Obj, Table};
use super::super::{error, require, AppState, CurrentUser};
use super::{rack_in_project, PLAIN};
use crate::catalogue::enrich::{BRAND, CONNECTOR_TYPE, EQUIPMENT};
use crate::inventory::{distinct, json_ids, marks};
use crate::projects::enrich::{rack_row, RACK_SLOT, SLOT_COLS};

/// The category name `rackAccessories` selects (route.ts:166).
const RACK_ACCESSORY: &str = "Accessoire rack";

/// The tenant fallback `select` of a placed equipment absent from the
/// palette (route.ts:294-315).
const FALLBACK_COLS: &str = r#""id", "name", "reference", "heightU", "widthFraction", "depthMm",
    "rearCableDepthMm", "weight", "powerW", "isRackable", "connectors", "imageUrl",
    "rackSymbolUrl", "rackSymbolRearUrl", "rackPhotoFrontUrl", "rackPhotoRearUrl", "brandId",
    "categoryId", "functionIds", "componentSlotSpan""#;

const PANEL_SLOT: Table = Table {
    name: "PanelSlot",
    bools: &["mountD"],
    jsons: &[],
};

const SIGNAL: Table = Table {
    name: "TenantSignalType",
    bools: &["isIp"],
    jsons: &[],
};

pub async fn get(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((project_id, rack_id)): Path<(String, String)>,
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
    match canvas_data(&mut conn, &project_id, &rack_id).await {
        Ok(Some(v)) => Json(v).into_response(),
        Ok(None) => error(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => db_error(e),
    }
}

/// `sql` with `binds`, each row mapped with `t`; `sql` is a literal of this
/// module.
async fn fetch(
    conn: &mut SqliteConnection,
    sql: &str,
    binds: &[String],
    t: &Table,
) -> Result<Vec<Obj>, sqlx::Error> {
    let mut q = sqlx::query(sql);
    for b in binds {
        q = q.bind(b);
    }
    Ok(q.fetch_all(conn)
        .await?
        .iter()
        .map(|r| row_map(r, t))
        .collect())
}

/// `Number(s)` of JavaScript, `null` for `NaN` and the infinities (what
/// `JSON.stringify` writes); an integral value stays an integer.
fn js_number(s: &str) -> Value {
    let t = s.trim();
    let n = if t.is_empty() {
        Some(0.0)
    } else if let Some(h) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        u64::from_str_radix(h, 16).ok().map(|n| n as f64)
    } else if let Some(o) = t.strip_prefix("0o").or_else(|| t.strip_prefix("0O")) {
        u64::from_str_radix(o, 8).ok().map(|n| n as f64)
    } else if let Some(b) = t.strip_prefix("0b").or_else(|| t.strip_prefix("0B")) {
        u64::from_str_radix(b, 2).ok().map(|n| n as f64)
    } else if t.chars().all(|c| c.is_ascii_digit() || "+-.eE".contains(c))
        || matches!(t, "Infinity" | "+Infinity" | "-Infinity")
    {
        t.parse::<f64>().ok()
    } else {
        None
    };
    match n {
        Some(f) if f.is_finite() && f.fract() == 0.0 && f.abs() < 9_007_199_254_740_992.0 => {
            json!(f as i64)
        }
        Some(f) if f.is_finite() => json!(f),
        _ => Value::Null,
    }
}

/// What resolves a placed equipment: arkyo's `catalogEquipmentMap`,
/// `equipmentCategoryMap` and `brandMap`.
struct Catalogue {
    equipment: HashMap<String, Obj>,
    category: HashMap<String, String>,
    brands: HashMap<String, Value>,
}

impl Catalogue {
    /// `resolveEquipmentData` + `overrideCategoryWithFunction` + `brand`:
    /// `null` for no or an unknown `catalogEquipmentId`.
    fn resolve(&self, equipment_id: Option<&str>) -> Value {
        let Some(mut eq) = equipment_id.and_then(|id| self.equipment.get(id)).cloned() else {
            return Value::Null;
        };
        if let Some(name) = str_of(&eq, "id").and_then(|id| self.category.get(id)) {
            eq.insert("category".into(), Value::String(name.clone()));
        }
        let brand = str_of(&eq, "brandId")
            .and_then(|b| self.brands.get(b))
            .cloned()
            .unwrap_or(Value::Null);
        eq.insert("brand".into(), brand);
        Value::Object(eq)
    }

    fn brand_of(&self, eq: &Obj) -> Value {
        str_of(eq, "brandId")
            .and_then(|b| self.brands.get(b))
            .cloned()
            .unwrap_or(Value::Null)
    }
}

async fn canvas_data(
    conn: &mut SqliteConnection,
    project_id: &str,
    rack_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    if !rack_in_project(conn, rack_id, project_id).await? {
        return Ok(None);
    }
    let Some(mut rack) = rack_row(conn, rack_id).await? else {
        return Ok(None);
    };
    let rack_bind = [rack_id.to_string()];

    // rigs: include rigConfig {id, name, projectId}, no orderBy.
    let rigs: Vec<Value> = fetch(
        conn,
        r#"SELECT rr."id", rr."rigConfigId", rr."rackId", rr."position",
             g."name" AS "rigName", g."projectId" AS "rigProjectId"
           FROM "RigRack" rr JOIN "RigConfig" g ON g."id" = rr."rigConfigId"
           WHERE rr."rackId" = ? ORDER BY rr.rowid"#,
        &rack_bind,
        &PLAIN,
    )
    .await?
    .into_iter()
    .map(|mut link| {
        let name = link.remove("rigName").unwrap_or(Value::Null);
        let project = link.remove("rigProjectId").unwrap_or(Value::Null);
        let id = link.get("rigConfigId").cloned().unwrap_or(Value::Null);
        link.insert(
            "rigConfig".into(),
            json!({ "id": id, "name": name, "projectId": project }),
        );
        Value::Object(link)
    })
    .collect();

    // slots: parentSlotId null, orderBy startU asc (Postgres: nulls last).
    let top = fetch(
        conn,
        &format!(
            r#"SELECT {SLOT_COLS} FROM "RackSlot" WHERE "rackId" = ? AND "parentSlotId" IS NULL
               ORDER BY "startU" IS NULL, "startU", "createdAt", rowid"#
        ),
        &rack_bind,
        &RACK_SLOT,
    )
    .await?;
    // children: no orderBy (insertion order).
    let top_ids = distinct(top.iter().map(|s| str_of(s, "id")));
    let children = if top_ids.is_empty() {
        Vec::new()
    } else {
        fetch(
            conn,
            &format!(
                r#"SELECT {SLOT_COLS} FROM "RackSlot" WHERE "parentSlotId" IN ({})
                   ORDER BY "createdAt", rowid"#,
                marks(top_ids.len())
            ),
            &top_ids,
            &RACK_SLOT,
        )
        .await?
    };

    // Nested components of the host slots (route.ts:130-140, 229-241).
    let host_ids = distinct(
        top.iter()
            .chain(children.iter())
            .map(|s| str_of(s, "inventoryItemId")),
    );
    let components = if host_ids.is_empty() {
        Vec::new()
    } else {
        fetch(
            conn,
            &format!(
                r#"SELECT "id", "hostItemId", "hostSlotIndex", "catalogEquipmentId", "snapshotId"
                   FROM "RackInventoryItem" WHERE "hostItemId" IN ({})
                   ORDER BY "hostSlotIndex" IS NULL, "hostSlotIndex", rowid"#,
                marks(host_ids.len())
            ),
            &host_ids,
            &PLAIN,
        )
        .await?
    };

    // Functions (`categories`, palette `functions`, primary function).
    let functions = fetch(
        conn,
        r#"SELECT "id", "label", "color", "sortOrder" FROM "TenantFunction"
           ORDER BY "sortOrder", rowid"#,
        &[],
        &PLAIN,
    )
    .await?;
    let fn_by_id: HashMap<&str, &Obj> = functions
        .iter()
        .filter_map(|f| Some((str_of(f, "id")?, f)))
        .collect();
    let category_names: HashMap<String, String> = fetch(
        conn,
        r#"SELECT "id", "name" FROM "TenantEquipmentCategory""#,
        &[],
        &PLAIN,
    )
    .await?
    .into_iter()
    .filter_map(|c| Some((str_of(&c, "id")?.into(), str_of(&c, "name")?.into())))
    .collect();
    let category_of = |eq: &Obj| -> Value {
        str_of(eq, "categoryId")
            .and_then(|c| category_names.get(c))
            .map_or(Value::Null, |n| Value::String(n.clone()))
    };

    // Palette: active equipment by name, with `functions` and the legacy
    // `category` text.
    let mut palette = fetch(
        conn,
        r#"SELECT * FROM "TenantEquipment" WHERE "isActive" = 1 ORDER BY "name", "id""#,
        &[],
        &EQUIPMENT,
    )
    .await?;
    for e in &mut palette {
        let fns: Vec<Value> = json_ids_of(e)
            .iter()
            .filter_map(|id| fn_by_id.get(id.as_str()))
            .map(|f| json!({ "function": Value::Object((*f).clone()) }))
            .collect();
        let cat = category_of(e);
        e.insert("functions".into(), Value::Array(fns));
        e.insert("category".into(), cat);
    }
    let mut equipment: HashMap<String, Obj> = palette
        .iter()
        .filter_map(|e| Some((str_of(e, "id")?.to_string(), e.clone())))
        .collect();

    // Tenant fallback for the placed ids absent from the palette.
    let placed = distinct(
        top.iter()
            .chain(children.iter())
            .chain(components.iter())
            .map(|s| str_of(s, "catalogEquipmentId")),
    );
    let missing: Vec<String> = placed
        .into_iter()
        .filter(|id| !equipment.contains_key(id))
        .collect();
    let fallback = if missing.is_empty() {
        Vec::new()
    } else {
        fetch(
            conn,
            &format!(
                r#"SELECT {FALLBACK_COLS} FROM "TenantEquipment" WHERE "id" IN ({})"#,
                marks(missing.len())
            ),
            &missing,
            &EQUIPMENT,
        )
        .await?
    };

    // Brands of the palette and of the fallback items.
    let brand_ids = distinct(
        palette
            .iter()
            .chain(fallback.iter())
            .map(|e| str_of(e, "brandId")),
    );
    let brands: HashMap<String, Value> = if brand_ids.is_empty() {
        HashMap::new()
    } else {
        fetch(
            conn,
            &format!(
                r#"SELECT * FROM "TenantBrand" WHERE "id" IN ({})"#,
                marks(brand_ids.len())
            ),
            &brand_ids,
            BRAND,
        )
        .await?
        .into_iter()
        .filter_map(|b| Some((str_of(&b, "id")?.to_string(), Value::Object(b))))
        .collect()
    };

    for e in fallback {
        if let Some(id) = str_of(&e, "id").map(str::to_string) {
            equipment.insert(id, e);
        }
    }
    // equipmentCategoryMap: primary function, else the category.
    let category: HashMap<String, String> = equipment
        .iter()
        .filter_map(|(id, e)| {
            let mut fns: Vec<&Obj> = json_ids_of(e)
                .iter()
                .filter_map(|f| fn_by_id.get(f.as_str()).copied())
                .collect();
            fns.sort_by_key(|f| f.get("sortOrder").and_then(Value::as_i64).unwrap_or(0));
            let name = fns
                .first()
                .and_then(|f| str_of(f, "label"))
                .or_else(|| {
                    str_of(e, "categoryId")
                        .and_then(|c| category_names.get(c))
                        .map(String::as_str)
                })
                .map(|s| s.to_string())?;
            Some((id.clone(), name))
        })
        .collect();
    let cat = Catalogue {
        equipment,
        category,
        brands,
    };

    // Connector types: the select of route.ts:198-207, `functions` from
    // `functionIds`.
    let connector_types: Vec<Value> = fetch(
        conn,
        r#"SELECT * FROM "TenantConnectorType" ORDER BY rowid"#,
        &[],
        CONNECTOR_TYPE,
    )
    .await?
    .into_iter()
    .map(|c| {
        let fns: Vec<Value> = c
            .get("functionIds")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|v| v.is_string())
            .map(|id| json!({ "functionId": id }))
            .collect();
        json!({
            "id": c.get("id"), "name": c.get("name"), "versions": c.get("versions"),
            "iconId": c.get("iconId"), "color": c.get("color"), "functions": fns,
        })
    })
    .collect();
    let ct_by_id: HashMap<&str, &Value> = connector_types
        .iter()
        .filter_map(|c| Some((c["id"].as_str()?, c)))
        .collect();

    // Panels by name, their slots with `connectorTypeId` / `connectorType`.
    let panel_slots = fetch(
        conn,
        r#"SELECT "panelId", "id", "position", "sizeSlots", "label", "notes",
             "catalogConnectorTypeId", "mountD"
           FROM "PanelSlot" ORDER BY rowid"#,
        &[],
        &PANEL_SLOT,
    )
    .await?;
    let mut slots_by_panel: HashMap<String, Vec<Value>> = HashMap::new();
    for mut ps in panel_slots {
        let panel = ps
            .remove("panelId")
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default();
        let ct = ps
            .get("catalogConnectorTypeId")
            .cloned()
            .unwrap_or(Value::Null);
        let ct_obj = ct
            .as_str()
            .and_then(|id| ct_by_id.get(id))
            .map_or(Value::Null, |c| (*c).clone());
        ps.insert("connectorTypeId".into(), ct);
        ps.insert("connectorType".into(), ct_obj);
        slots_by_panel
            .entry(panel)
            .or_default()
            .push(Value::Object(ps));
    }
    let all_panels: Vec<Value> = fetch(
        conn,
        r#"SELECT "id", "name", "heightU", "slotsPerU", "rearCableDepthMm" FROM "Panel"
           ORDER BY "name", "id""#,
        &[],
        &PLAIN,
    )
    .await?
    .into_iter()
    .map(|mut p| {
        let slots = str_of(&p, "id")
            .and_then(|id| slots_by_panel.remove(id))
            .unwrap_or_default();
        p.insert("slots".into(), Value::Array(slots));
        Value::Object(p)
    })
    .collect();
    let panel_by_id: HashMap<&str, &Value> = all_panels
        .iter()
        .filter_map(|p| Some((p["id"].as_str()?, p)))
        .collect();

    // Components grouped by host, sorted by `hostSlotIndex ?? 0` (stable).
    let mut by_host: HashMap<String, Vec<&Obj>> = HashMap::new();
    for comp in &components {
        if let Some(host) = str_of(comp, "hostItemId") {
            by_host.entry(host.to_string()).or_default().push(comp);
        }
    }
    for list in by_host.values_mut() {
        list.sort_by_key(|c| c.get("hostSlotIndex").and_then(Value::as_i64).unwrap_or(0));
    }
    let components_of = |slot: &Obj| -> Value {
        let list = str_of(slot, "inventoryItemId")
            .and_then(|id| by_host.get(id))
            .map(Vec::as_slice)
            .unwrap_or_default();
        Value::Array(
            list.iter()
                .map(|comp| {
                    let eq = cat.resolve(str_of(comp, "catalogEquipmentId"));
                    let span = eq
                        .get("componentSlotSpan")
                        .filter(|v| v.is_number())
                        .cloned()
                        .unwrap_or(json!(1));
                    json!({
                        "itemId": comp.get("id"),
                        "slotIndex": comp.get("hostSlotIndex").filter(|v| !v.is_null())
                            .cloned().unwrap_or(json!(0)),
                        "slotSpan": span,
                        "equipment": eq,
                    })
                })
                .collect(),
        )
    };
    let panel_of = |slot: &Obj| -> Value {
        str_of(slot, "panelId")
            .and_then(|id| panel_by_id.get(id))
            .map_or(Value::Null, |p| (*p).clone())
    };
    // enrichSlot (route.ts:465-526).
    let enrich = |mut s: Obj| -> Obj {
        let equipment = cat.resolve(str_of(&s, "catalogEquipmentId"));
        let components = components_of(&s);
        let panel = panel_of(&s);
        s.insert("equipment".into(), equipment);
        s.insert("components".into(), components);
        s.insert("panel".into(), panel);
        s
    };
    let mut children_by_parent: HashMap<String, Vec<Value>> = HashMap::new();
    for c in children {
        let parent = str_of(&c, "parentSlotId").unwrap_or_default().to_string();
        children_by_parent
            .entry(parent)
            .or_default()
            .push(Value::Object(enrich(c)));
    }
    let slots: Vec<Value> = top
        .into_iter()
        .map(|s| {
            let kids = str_of(&s, "id")
                .and_then(|id| children_by_parent.remove(id))
                .unwrap_or_default();
            let mut s = enrich(s);
            s.insert("children".into(), Value::Array(kids));
            Value::Object(s)
        })
        .collect();
    rack.insert("rigs".into(), Value::Array(rigs));
    rack.insert("slots".into(), Value::Array(slots));

    // Palette and accessories with `brand`.
    let all_equipment: Vec<Value> = palette
        .iter()
        .map(|e| {
            let mut e = e.clone();
            e.insert("brand".into(), cat.brand_of(&e));
            Value::Object(e)
        })
        .collect();
    let rack_accessories: Vec<Value> = palette
        .iter()
        .filter(|e| str_of(e, "category") == Some(RACK_ACCESSORY))
        .map(|e| {
            let mut e = e.clone();
            // No `include: { functions }` on this query.
            e.remove("functions");
            e.insert("brand".into(), cat.brand_of(&e));
            Value::Object(e)
        })
        .collect();

    let signals = fetch(
        conn,
        r#"SELECT "id", "name", "color", "cablePrefix", "cableSuffix", "functionId", "isIp"
           FROM "TenantSignalType" ORDER BY rowid"#,
        &[],
        &SIGNAL,
    )
    .await?;
    let config: HashMap<String, String> = sqlx::query_as(
        r#"SELECT "key", "value" FROM "AppConfig"
           WHERE "key" IN ('patch_panel_depth_mm', 'cable_safety_depth_mm')"#,
    )
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .collect();
    let depth = |key: &str, default: i64| {
        config
            .get(key)
            .map_or(Value::from(default), |v| js_number(v))
    };

    Ok(Some(json!({
        "rack": rack,
        "allEquipment": all_equipment,
        "rackAccessories": rack_accessories,
        "allPanels": all_panels,
        "connectorTypes": connector_types.iter().map(|c| json!({
            "id": c["id"],
            "name": c["name"],
            "versions": c["versions"],
            // Compat canvas : premier functionId de la jonction (ou null)
            "functionId": c["functions"].get(0).map_or(Value::Null, |f| f["functionId"].clone()),
            "iconId": c["iconId"],
            "color": c["color"],
        })).collect::<Vec<_>>(),
        "signals": signals,
        // signalCategories : fusionnés dans les fonctions
        "signalCategories": [],
        "categories": functions.iter().map(|f| json!({
            "id": f.get("id"),
            "name": f.get("label"),
            "color": f.get("color").filter(|c| !c.is_null()).cloned()
                .unwrap_or_else(|| json!("#71717a")),
            "children": [],
        })).collect::<Vec<_>>(),
        "patchPanelDepthMm": depth("patch_panel_depth_mm", 5),
        "cableSafetyDepthMm": depth("cable_safety_depth_mm", 150),
    })))
}

/// The string ids of an equipment's `functionIds` (already parsed JSON).
fn json_ids_of(e: &Obj) -> Vec<String> {
    match e.get("functionIds") {
        Some(Value::String(raw)) => json_ids(raw),
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_like_javascript() {
        assert_eq!(js_number("12"), json!(12));
        assert_eq!(js_number(" 80.5 "), json!(80.5));
        assert_eq!(js_number(""), json!(0));
        assert_eq!(js_number("1e3"), json!(1000));
        assert_eq!(js_number("0x10"), json!(16));
        assert_eq!(js_number("abc"), Value::Null);
        assert_eq!(js_number("12px"), Value::Null);
        assert_eq!(js_number("Infinity"), Value::Null);
        assert_eq!(js_number("inf"), Value::Null);
        assert_eq!(js_number("-3"), json!(-3));
    }
}
