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
use sqlx::{SqliteConnection, SqlitePool};

use crate::http::parametres::{
    brands, cabling, categories, connectors, list_rows, row_map, signals, str_of, Obj, Table,
};

// One definition per table: the ones of the settings routes.
pub static BRAND: &Table = &brands::RES.table;
pub static CATEGORY: &Table = &categories::CATEGORY.table;
pub static FUNCTION: &Table = &categories::FUNCTION.table;
pub static PHASE: &Table = &categories::PHASE.table;
pub static TYPE: &Table = &categories::TYPE.table;
pub static CONNECTOR_TYPE: &Table = &connectors::RES.table;
pub static SIGNAL: &Table = &signals::RES.table;
pub static CABLE_MODEL: &Table = &cabling::RES.table;
pub static ADAPTER: Table = Table {
    name: "TenantAdapter",
    bools: &["isActive", "shadowsArkyo"],
    jsons: &["inputs", "outputs"],
};
pub static CABLE: Table = Table {
    name: "TenantCable",
    bools: &["isActive", "shadowsArkyo"],
    jsons: &["useCases", "availableLengths"],
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
    types: HashMap<String, Obj>,
}

pub async fn by_id(pool: &SqlitePool, t: &Table) -> Result<HashMap<String, Obj>, sqlx::Error> {
    Ok(list_rows(pool, t, "", r#""id""#)
        .await?
        .into_iter()
        .filter_map(|r| Some((str_of(&r, "id")?.to_string(), r)))
        .collect())
}

impl Refs {
    pub async fn load(pool: &SqlitePool) -> Result<Self, sqlx::Error> {
        Ok(Self {
            brands: by_id(pool, BRAND).await?,
            categories: by_id(pool, CATEGORY).await?,
            functions: by_id(pool, FUNCTION).await?,
            types: by_id(pool, TYPE).await?,
        })
    }

    pub fn brand_name(&self, id: &str) -> Option<&str> {
        self.brands.get(id).and_then(|b| str_of(b, "name"))
    }

    pub fn function(&self, id: &str) -> Option<&Obj> {
        self.functions.get(id)
    }
}

pub fn lookup(map: &HashMap<String, Obj>, id: Option<&str>) -> Value {
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
/// With `detail`, the list `functions` is replaced by the editor payload
/// (see [`editor_payload`]).
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
    item.insert("brand".into(), brand);
    item.insert("equipmentCategory".into(), cat);
    item.insert("type".into(), ty);
    item.insert("functions".into(), Value::Array(functions));
    personal_flags(item);
    if detail {
        editor_payload(item, refs);
    }
}

/// What arkyo's editor page (`admin/catalogue/equipment/[id]/page.tsx`,
/// PERSONAL branch) hands to the editor on top of the row: `sourceType`,
/// `functions: [{functionId}]` and `phases: [{phaseId}]` in stored order
/// (unknown ids kept), and `category` (the name of `categoryId`, or null;
/// the editor sends it back on every autosave). The fork flags are already
/// set by [`personal_flags`].
fn editor_payload(item: &mut Obj, refs: &Refs) {
    let fns: Vec<Value> = ids_of(item, "functionIds")
        .into_iter()
        .map(|id| serde_json::json!({ "functionId": id }))
        .collect();
    let phs: Vec<Value> = ids_of(item, "phaseIds")
        .into_iter()
        .map(|id| serde_json::json!({ "phaseId": id }))
        .collect();
    let cat = str_of(item, "categoryId")
        .and_then(|id| refs.categories.get(id))
        .and_then(|c| str_of(c, "name"))
        .map_or(Value::Null, |n| Value::String(n.to_string()));
    item.insert("sourceType".into(), "TENANT".into());
    item.insert("functions".into(), Value::Array(fns));
    item.insert("phases".into(), Value::Array(phs));
    item.insert("category".into(), cat);
}

/// arkyo:lib/services/catalog-enrich.ts `fetchCatalogAdapterMap(ids, db)`
/// (:225-270): `CatalogAdapterLite` by id, `{id, name, reference, imageUrl,
/// inputs, outputs, notes, source}`. Null, empty and duplicate ids are
/// dropped, unknown ids are absent, inactive adapters are kept (an item may
/// still reference one). Single catalogue: arkyo's tenant fallback only, so
/// `source` is always `PERSONAL`.
pub async fn fetch_catalog_adapter_map<'a>(
    conn: &mut SqliteConnection,
    ids: impl IntoIterator<Item = Option<&'a str>>,
) -> Result<HashMap<String, Value>, sqlx::Error> {
    let ids = crate::inventory::distinct(ids);
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let sql = format!(
        r#"SELECT "id", "name", "reference", "imageUrl", "inputs", "outputs", "notes"
           FROM "TenantAdapter" WHERE "id" IN ({})"#,
        crate::inventory::marks(ids.len())
    );
    let mut q = sqlx::query(&sql);
    for id in &ids {
        q = q.bind(id);
    }
    Ok(q.fetch_all(conn)
        .await?
        .iter()
        .map(|row| {
            let mut a = row_map(row, &ADAPTER);
            a.insert("source".into(), "PERSONAL".into());
            (
                str_of(&a, "id").unwrap_or_default().to_string(),
                Value::Object(a),
            )
        })
        .collect())
}
