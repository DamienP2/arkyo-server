//! arkyo:lib/services/rack-inventory-api.ts: the `BomItemDto` of the
//! inventory routes and the modular-chassis helpers, on the local
//! catalogue.
//!
//! Two flavours of the DTO, chosen by [`BomMode`]:
//! - [`BomMode::Template`]: `enrichRowsForTemplate` (rack template routes
//!   `/api/racks/:id/inventory*`, `clone-from-template`, the rack page);
//! - [`BomMode::Project`]: `enrichRows` / `mapToBomItem`, inlined in
//!   `app/api/tenant/projects/[id]/racks/[rackId]/inventory/route.ts`
//!   (:180-669): `category` and `categoryColor` from the primary function,
//!   the equipment category as fallback.
//!
//! arkyo resolved `CatalogEquipment` / `CatalogAdapter` first and fell back
//! on `TenantEquipment` / `TenantAdapter`; only the tenant branch exists
//! here, with `TenantFunction` for arkyo's `CatalogFunction`. No snapshot:
//! `snapshotId` is always `null`. Rows whose item is gone are dropped
//! (orphans), as in arkyo.

use std::collections::HashMap;

use serde::Serialize;
use sqlx::{FromRow, SqliteConnection};

use crate::inventory::{brands, categories, distinct, functions, json_ids, primary_function};
use crate::inventory::{rows_by_id, CategoryLite};

/// Which of arkyo's two enrichments.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BomMode {
    /// `enrichRowsForTemplate`: no `categoryColor` key, `category` = the
    /// equipment category name (`null` for adapters).
    Template,
    /// The project route's `enrichRows`: `category` / `categoryColor` from
    /// the primary function.
    Project,
}

/// `formatAccessoryName(type, heightU, variant, depthMm)`.
pub fn format_accessory_name(
    accessory_type: &str,
    height_u: i64,
    variant: Option<&str>,
    depth_mm: Option<i64>,
) -> String {
    let depth = depth_mm.filter(|d| *d != 0);
    match accessory_type {
        "plaque" => {
            let v = match variant {
                Some("plein") => "pleine",
                Some("pass-cable") => "pass-câble",
                Some("aere") => "aérée",
                _ => "",
            };
            if v.is_empty() {
                format!("Plaque {height_u}U")
            } else {
                format!("Plaque {v} {height_u}U")
            }
        }
        "etagere" => match depth {
            Some(d) => format!("Étagère {height_u}U · {d}mm"),
            None => format!("Étagère {height_u}U"),
        },
        // "tiroir" (the type is validated before it is stored).
        _ => match depth {
            Some(d) => format!("Tiroir {height_u}U · {d}mm"),
            None => format!("Tiroir {height_u}U"),
        },
    }
}

/// The joined `panel` of a row (`select: { id, name, panelType, heightU }`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PanelRef {
    pub id: String,
    pub name: String,
    pub panel_type: String,
    pub height_u: i64,
}

/// `BareInventoryRow`: a `RackInventoryItem` with `inventorySelectFields`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BareInventoryRow {
    pub id: String,
    pub catalog_equipment_id: Option<String>,
    pub panel_id: Option<String>,
    pub catalog_adapter_id: Option<String>,
    pub accessory_type: Option<String>,
    pub accessory_height_u: Option<i64>,
    pub accessory_variant: Option<String>,
    pub accessory_depth_mm: Option<i64>,
    pub quantity: i64,
    pub snapshot_id: Option<String>,
    pub host_item_id: Option<String>,
    pub host_slot_index: Option<i64>,
    pub panel: Option<PanelRef>,
}

#[derive(FromRow)]
#[sqlx(rename_all = "camelCase")]
struct RawRow {
    id: String,
    catalog_equipment_id: Option<String>,
    panel_id: Option<String>,
    catalog_adapter_id: Option<String>,
    accessory_type: Option<String>,
    accessory_height_u: Option<i64>,
    accessory_variant: Option<String>,
    accessory_depth_mm: Option<i64>,
    quantity: i64,
    snapshot_id: Option<String>,
    host_item_id: Option<String>,
    host_slot_index: Option<i64>,
    p_id: Option<String>,
    p_name: Option<String>,
    p_panel_type: Option<String>,
    p_height_u: Option<i64>,
}

impl From<RawRow> for BareInventoryRow {
    fn from(r: RawRow) -> Self {
        let panel = match (r.p_id, r.p_name, r.p_panel_type, r.p_height_u) {
            (Some(id), Some(name), Some(panel_type), Some(height_u)) => Some(PanelRef {
                id,
                name,
                panel_type,
                height_u,
            }),
            _ => None,
        };
        Self {
            id: r.id,
            catalog_equipment_id: r.catalog_equipment_id,
            panel_id: r.panel_id,
            catalog_adapter_id: r.catalog_adapter_id,
            accessory_type: r.accessory_type,
            accessory_height_u: r.accessory_height_u,
            accessory_variant: r.accessory_variant,
            accessory_depth_mm: r.accessory_depth_mm,
            quantity: r.quantity,
            snapshot_id: r.snapshot_id,
            host_item_id: r.host_item_id,
            host_slot_index: r.host_slot_index,
            panel,
        }
    }
}

/// `inventorySelectFields` on the alias `i`, with the panel on `p`.
const SELECT: &str = r#"SELECT i."id", i."catalogEquipmentId", i."panelId", i."catalogAdapterId",
    i."accessoryType", i."accessoryHeightU", i."accessoryVariant", i."accessoryDepthMm",
    i."quantity", i."snapshotId", i."hostItemId", i."hostSlotIndex",
    p."id" AS "pId", p."name" AS "pName", p."panelType" AS "pPanelType", p."heightU" AS "pHeightU"
    FROM "RackInventoryItem" i LEFT JOIN "Panel" p ON p."id" = i."panelId""#;

/// The inventory of a rack, `orderBy: { createdAt: "asc" }`.
pub async fn inventory_rows(
    conn: &mut SqliteConnection,
    rack_id: &str,
) -> Result<Vec<BareInventoryRow>, sqlx::Error> {
    let rows: Vec<RawRow> = sqlx::query_as(&format!(
        r#"{SELECT} WHERE i."rackId" = ? ORDER BY i."createdAt", i.rowid"#
    ))
    .bind(rack_id)
    .fetch_all(conn)
    .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// One inventory row by id (what `create` / `update` select back).
pub async fn inventory_row(
    conn: &mut SqliteConnection,
    item_id: &str,
) -> Result<Option<BareInventoryRow>, sqlx::Error> {
    let row: Option<RawRow> = sqlx::query_as(&format!(r#"{SELECT} WHERE i."id" = ?"#))
        .bind(item_id)
        .fetch_optional(conn)
        .await?;
    Ok(row.map(Into::into))
}

/// `BomItemDto`. `refId` and the `accessory*` keys are omitted when
/// `undefined` in arkyo; `categoryColor` only exists in [`BomMode::Project`].
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BomItemDto {
    pub id: String,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accessory_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accessory_height_u: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accessory_variant: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accessory_depth_mm: Option<i64>,
    pub quantity: i64,
    pub name: String,
    pub reference: Option<String>,
    pub image_url: Option<String>,
    pub brand_name: Option<String>,
    pub height_u: Option<i64>,
    pub width_fraction: Option<String>,
    pub panel_type: Option<&'static str>,
    pub weight_kg: Option<f64>,
    pub power_w: Option<i64>,
    pub depth_mm: Option<i64>,
    pub is_rackable: bool,
    pub category: Option<String>,
    /// `Some(color)` in project mode (the key is present, maybe `null`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_color: Option<Option<String>>,
    pub snapshot_id: Option<String>,
    pub host_item_id: Option<String>,
    pub host_slot_index: Option<i64>,
    pub is_component_host: bool,
    pub host_slot_count: Option<i64>,
    pub is_component: bool,
    pub component_slot_span: i64,
}

#[derive(Debug, Clone, FromRow)]
#[sqlx(rename_all = "camelCase")]
struct EquipmentRow {
    id: String,
    name: String,
    reference: Option<String>,
    image_url: Option<String>,
    height_u: Option<i64>,
    width_fraction: String,
    brand_id: Option<String>,
    category_id: Option<String>,
    weight: Option<f64>,
    power_w: Option<i64>,
    depth_mm: Option<i64>,
    is_rackable: bool,
    is_component_host: bool,
    host_slot_count: Option<i64>,
    is_component: bool,
    component_slot_span: i64,
    function_ids: String,
}

#[derive(Debug, Clone, FromRow)]
#[sqlx(rename_all = "camelCase")]
struct AdapterRow {
    id: String,
    name: String,
    reference: Option<String>,
    image_url: Option<String>,
    function_id: Option<String>,
}

const EQUIPMENT_COLS: &str = r#""id", "name", "reference", "imageUrl", "heightU",
    "widthFraction", "brandId", "categoryId", "weight", "powerW", "depthMm", "isRackable",
    "isComponentHost", "hostSlotCount", "isComponent", "componentSlotSpan", "functionIds""#;

/// `{ name, color }` of the category of an item.
#[derive(Default)]
struct CategoryInfo {
    name: Option<String>,
    color: Option<String>,
}

/// `enrichRowsForTemplate(rows, db)` or the project route's
/// `enrichRows(rows, snapshotMap, db)`: one DTO per row, orphans dropped,
/// in the order of `rows`.
pub async fn enrich_rows(
    conn: &mut SqliteConnection,
    rows: &[BareInventoryRow],
    mode: BomMode,
) -> Result<Vec<BomItemDto>, sqlx::Error> {
    let eq_ids = distinct(rows.iter().map(|r| r.catalog_equipment_id.as_deref()));
    let ad_ids = distinct(rows.iter().map(|r| r.catalog_adapter_id.as_deref()));
    let equipments: Vec<EquipmentRow> =
        rows_by_id(conn, "TenantEquipment", EQUIPMENT_COLS, &eq_ids).await?;
    let adapters: Vec<AdapterRow> = rows_by_id(
        conn,
        "TenantAdapter",
        r#""id", "name", "reference", "imageUrl", "functionId""#,
        &ad_ids,
    )
    .await?;

    let mut fn_src: Vec<String> = equipments
        .iter()
        .flat_map(|e| json_ids(&e.function_ids))
        .collect();
    fn_src.extend(adapters.iter().filter_map(|a| a.function_id.clone()));
    let fn_ids = distinct(fn_src.iter().map(|s| Some(s.as_str())));
    let fn_lookup = functions(conn, &fn_ids).await?;
    let cat_ids = distinct(equipments.iter().map(|e| e.category_id.as_deref()));
    let cat_lookup: HashMap<String, CategoryLite> = categories(conn, &cat_ids).await?;
    let brand_ids = distinct(equipments.iter().map(|e| e.brand_id.as_deref()));
    let brand_lookup = brands(conn, &brand_ids).await?;

    let eq_cat: HashMap<&str, CategoryInfo> = equipments
        .iter()
        .map(|e| {
            let cat = e.category_id.as_deref().and_then(|c| cat_lookup.get(c));
            let info = match mode {
                BomMode::Project => {
                    let primary = primary_function(&json_ids(&e.function_ids), &fn_lookup);
                    CategoryInfo {
                        name: primary
                            .map(|f| f.label.clone())
                            .or_else(|| cat.map(|c| c.name.clone())),
                        color: primary
                            .and_then(|f| f.color.clone())
                            .or_else(|| cat.and_then(|c| c.color.clone())),
                    }
                }
                BomMode::Template => CategoryInfo {
                    name: cat.map(|c| c.name.clone()),
                    color: None,
                },
            };
            (e.id.as_str(), info)
        })
        .collect();
    let eq_map: HashMap<&str, &EquipmentRow> =
        equipments.iter().map(|e| (e.id.as_str(), e)).collect();
    let ad_map: HashMap<&str, &AdapterRow> = adapters.iter().map(|a| (a.id.as_str(), a)).collect();

    let project = mode == BomMode::Project;
    let color = |c: Option<String>| project.then_some(c);
    let mut out = Vec::with_capacity(rows.len());
    for raw in rows {
        let base = |kind: &'static str, name: String| BomItemDto {
            id: raw.id.clone(),
            kind,
            ref_id: None,
            accessory_type: None,
            accessory_height_u: None,
            accessory_variant: None,
            accessory_depth_mm: None,
            quantity: raw.quantity,
            name,
            reference: None,
            image_url: None,
            brand_name: None,
            height_u: None,
            width_fraction: None,
            panel_type: None,
            weight_kg: None,
            power_w: None,
            depth_mm: None,
            is_rackable: true,
            category: None,
            category_color: color(None),
            snapshot_id: None,
            host_item_id: raw.host_item_id.clone(),
            host_slot_index: raw.host_slot_index,
            is_component_host: false,
            host_slot_count: None,
            is_component: false,
            component_slot_span: 1,
        };

        if let Some(eq_id) = raw
            .catalog_equipment_id
            .as_deref()
            .filter(|s| !s.is_empty())
        {
            let Some(eq) = eq_map.get(eq_id) else {
                continue; // orphan: removed from the catalogue
            };
            let cat = eq_cat.get(eq_id);
            let width = match mode {
                // The project route keeps any string.
                BomMode::Project => Some(eq.width_fraction.clone()),
                BomMode::Template => ["FULL", "HALF", "THIRD", "QUARTER"]
                    .contains(&eq.width_fraction.as_str())
                    .then(|| eq.width_fraction.clone()),
            };
            out.push(BomItemDto {
                ref_id: Some(eq_id.to_string()),
                reference: eq.reference.clone(),
                image_url: eq.image_url.clone(),
                brand_name: eq
                    .brand_id
                    .as_deref()
                    .and_then(|b| brand_lookup.get(b))
                    .map(|b| b.name.clone()),
                height_u: eq.height_u,
                width_fraction: width,
                weight_kg: eq.weight,
                power_w: eq.power_w,
                depth_mm: eq.depth_mm,
                is_rackable: eq.is_rackable,
                category: cat.and_then(|c| c.name.clone()),
                category_color: color(cat.and_then(|c| c.color.clone())),
                is_component_host: eq.is_component_host,
                host_slot_count: eq.host_slot_count,
                is_component: eq.is_component,
                component_slot_span: eq.component_slot_span,
                ..base("equipment", eq.name.clone())
            });
        } else if let Some(p) = &raw.panel {
            let accessory = p.panel_type == "ACCESSORY";
            out.push(BomItemDto {
                ref_id: Some(p.id.clone()),
                height_u: Some(p.height_u),
                panel_type: Some(if accessory { "ACCESSORY" } else { "PATCH" }),
                category: Some(
                    if accessory {
                        "Accessoire rack"
                    } else {
                        "Panels de patch"
                    }
                    .to_string(),
                ),
                ..base("panel", p.name.clone())
            });
        } else if let Some(ad_id) = raw.catalog_adapter_id.as_deref().filter(|s| !s.is_empty()) {
            let Some(ad) = ad_map.get(ad_id) else {
                continue; // orphan
            };
            let f = ad.function_id.as_deref().and_then(|f| fn_lookup.get(f));
            out.push(BomItemDto {
                ref_id: Some(ad.id.clone()),
                reference: ad.reference.clone(),
                image_url: ad.image_url.clone(),
                is_rackable: false,
                category: if project {
                    f.map(|f| f.label.clone())
                } else {
                    None
                },
                category_color: color(f.and_then(|f| f.color.clone())),
                ..base("adapter", ad.name.clone())
            });
        } else if let (Some(t), Some(h)) = (
            raw.accessory_type.as_deref().filter(|t| !t.is_empty()),
            raw.accessory_height_u,
        ) {
            let depth = raw.accessory_depth_mm.filter(|d| *d > 0);
            let variant = raw.accessory_variant.as_deref();
            out.push(BomItemDto {
                accessory_type: Some(t.to_string()),
                accessory_height_u: Some(h),
                accessory_variant: variant.map(str::to_string),
                accessory_depth_mm: depth,
                height_u: Some(h),
                depth_mm: depth,
                category: Some("Accessoire rack".to_string()),
                ..base("accessory", format_accessory_name(t, h, variant, depth))
            });
        }
        // Anything else is an orphan.
    }
    Ok(out)
}

/// `ComponentEquipmentFields`.
#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct ComponentEquipmentFields {
    pub is_component_host: bool,
    pub host_slot_count: Option<i64>,
    pub is_component: bool,
    pub component_slot_span: i64,
}

/// `resolveComponentEquipmentFields(db, equipmentId)`.
pub async fn resolve_component_equipment_fields(
    conn: &mut SqliteConnection,
    equipment_id: &str,
) -> Result<Option<ComponentEquipmentFields>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT "isComponentHost", "hostSlotCount", "isComponent", "componentSlotSpan"
           FROM "TenantEquipment" WHERE "id" = ?"#,
    )
    .bind(equipment_id)
    .fetch_optional(conn)
    .await
}

/// `resolveComponentSpansBatch(db, equipmentIds)`: `componentSlotSpan` by
/// equipment id, unknown ids absent.
pub async fn resolve_component_spans_batch(
    conn: &mut SqliteConnection,
    equipment_ids: &[String],
) -> Result<HashMap<String, i64>, sqlx::Error> {
    let ids = distinct(equipment_ids.iter().map(|s| Some(s.as_str())));
    let rows: Vec<(String, i64)> = rows_by_id(
        conn,
        "TenantEquipment",
        r#""id", "componentSlotSpan""#,
        &ids,
    )
    .await?;
    Ok(rows.into_iter().collect())
}

/// `resolveIsComponentHost(db, equipmentId)`.
pub async fn resolve_is_component_host(
    conn: &mut SqliteConnection,
    equipment_id: &str,
) -> Result<bool, sqlx::Error> {
    Ok(resolve_component_equipment_fields(conn, equipment_id)
        .await?
        .is_some_and(|f| f.is_component_host))
}
