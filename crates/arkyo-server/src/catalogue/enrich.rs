//! Presentation of catalogue items as arkyo's `PERSONAL` items
//! (arkyo:lib/services/tenant-catalogue.ts `enrichWithSource`/`computeForkFlags`
//! and the `brand`/`equipmentCategory`/`functions` resolution of
//! `app/api/tenant/catalogue/equipment/route.ts`).
//!
//! Single catalogue (decision 2): every item is the tenant's own, so the
//! fork metadata is fixed. Deliberate fix of arkyo: the equipment `type` is
//! resolved for every item (arkyo only did it for its own items, which left
//! the Type column empty on export).

use std::collections::HashMap;

use serde_json::Value;
use sqlx::SqlitePool;

use crate::http::parametres::{list_rows, str_of, Obj, Table};

pub static BRAND: Table = Table {
    name: "TenantBrand",
    bools: &["isActive"],
    jsons: &[],
};
pub static CATEGORY: Table = Table {
    name: "TenantEquipmentCategory",
    bools: &["isActive"],
    jsons: &[],
};
pub static FUNCTION: Table = Table {
    name: "TenantFunction",
    bools: &["isActive"],
    jsons: &[],
};
pub static PHASE: Table = Table {
    name: "TenantPhase",
    bools: &["isActive"],
    jsons: &[],
};
pub static TYPE: Table = Table {
    name: "TenantType",
    bools: &["isActive"],
    jsons: &[],
};
pub static CONNECTOR_TYPE: Table = Table {
    name: "TenantConnectorType",
    bools: &["isActive"],
    jsons: &["versions", "functionIds"],
};
pub static SIGNAL: Table = Table {
    name: "TenantSignalType",
    bools: &[
        "isIp",
        "supportsRedundancy",
        "usesMulticast",
        "isDefault",
        "isActive",
    ],
    jsons: &["connectorIds"],
};
pub static CABLE_MODEL: Table = Table {
    name: "TenantCableModel",
    bools: &["isActive"],
    jsons: &["customFields"],
};
pub static ADAPTER: Table = Table {
    name: "TenantAdapter",
    bools: &["isActive", "shadowsArkyo"],
    jsons: &["inputs", "outputs"],
};
pub static EQUIPMENT: Table = Table {
    name: "TenantEquipment",
    bools: &[
        "shadowsArkyo",
        "isRackable",
        "hasDualPsu",
        "is2110",
        "isLightingFixture",
        "isComponentHost",
        "isComponent",
        "isActive",
    ],
    jsons: &[
        "dmxModes",
        "connectors",
        "signalCapacities",
        "customFields",
        "documents",
        "tags",
        "functionIds",
        "phaseIds",
    ],
};

/// The referentials an item points at (soft foreign keys), by id. Small
/// tables, loaded whole, inactive entries included (an item may still
/// reference one).
pub struct Refs {
    brands: HashMap<String, Obj>,
    categories: HashMap<String, Obj>,
    functions: HashMap<String, Obj>,
    phases: HashMap<String, Obj>,
    types: HashMap<String, Obj>,
}

async fn by_id(pool: &SqlitePool, t: &Table) -> Result<HashMap<String, Obj>, sqlx::Error> {
    Ok(list_rows(pool, t, "", r#""id""#)
        .await?
        .into_iter()
        .filter_map(|r| Some((str_of(&r, "id")?.to_string(), r)))
        .collect())
}

impl Refs {
    pub async fn load(pool: &SqlitePool) -> Result<Self, sqlx::Error> {
        Ok(Self {
            brands: by_id(pool, &BRAND).await?,
            categories: by_id(pool, &CATEGORY).await?,
            functions: by_id(pool, &FUNCTION).await?,
            phases: by_id(pool, &PHASE).await?,
            types: by_id(pool, &TYPE).await?,
        })
    }

    pub fn brand_name(&self, id: &str) -> Option<&str> {
        self.brands.get(id).and_then(|b| str_of(b, "name"))
    }

    pub fn function(&self, id: &str) -> Option<&Obj> {
        self.functions.get(id)
    }
}

fn lookup(map: &HashMap<String, Obj>, id: Option<&str>) -> Value {
    id.and_then(|i| map.get(i))
        .map_or(Value::Null, |o| Value::Object(o.clone()))
}

fn ids_of(item: &Obj, key: &str) -> Vec<String> {
    item.get(key)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// `source`, `isAccessible` and the fork flags of a `PERSONAL` item.
pub fn personal_flags(item: &mut Obj) {
    item.insert("source".into(), "PERSONAL".into());
    item.insert("isAccessible".into(), true.into());
    item.insert("arkyoDrift".into(), false.into());
    item.insert("arkyoSourceGone".into(), false.into());
    item.insert("shadowsArkyo".into(), false.into());
    item.insert("clonedFromArkyoId".into(), Value::Null);
    item.insert("clonedFromArkyoVersion".into(), Value::Null);
}

/// Resolves `brand`, `equipmentCategory`, `type` and `functions[]` (sorted
/// by `sortOrder`, `{id, label, color, sortOrder}` plus `functionId` for the
/// editor, which reads arkyo's join rows) and adds the `PERSONAL` flags.
/// With `detail`, also `phases: [{phaseId}]` like arkyo's join rows.
pub fn enrich_equipment(item: &mut Obj, refs: &Refs, detail: bool) {
    let brand = lookup(&refs.brands, str_of(item, "brandId"));
    let cat = lookup(&refs.categories, str_of(item, "categoryId"));
    let ty = lookup(&refs.types, str_of(item, "typeId"));
    let mut fns: Vec<&Obj> = ids_of(item, "functionIds")
        .iter()
        .filter_map(|id| refs.functions.get(id))
        .collect();
    fns.sort_by_key(|f| f.get("sortOrder").and_then(Value::as_i64).unwrap_or(0));
    let functions: Vec<Value> = fns
        .iter()
        .map(|f| {
            serde_json::json!({
                "id": f.get("id"), "label": f.get("label"),
                "color": f.get("color"), "sortOrder": f.get("sortOrder"),
                "functionId": f.get("id"),
            })
        })
        .collect();
    if detail {
        let phases: Vec<Value> = ids_of(item, "phaseIds")
            .into_iter()
            .filter(|id| refs.phases.contains_key(id))
            .map(|id| serde_json::json!({ "phaseId": id }))
            .collect();
        item.insert("phases".into(), Value::Array(phases));
    }
    item.insert("brand".into(), brand);
    item.insert("equipmentCategory".into(), cat);
    item.insert("type".into(), ty);
    item.insert("functions".into(), Value::Array(functions));
    personal_flags(item);
}
