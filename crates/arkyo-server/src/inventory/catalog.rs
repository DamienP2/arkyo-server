//! arkyo:lib/services/catalog-merge.ts, single-source version: the
//! inventory catalogue panel (`GET /api/tenant/inventaire/catalog` and
//! `GET /api/tenant/projects/:id/inventaire/catalog`).
//!
//! arkyo merged the active `CatalogEquipment` / `CatalogAdapter` of the
//! central catalogue (minus those a `shadowsArkyo` fork eclipses) with the
//! tenant's own items. The local catalogue is the tenant's alone: only the
//! `PERSONAL` half remains, `isActive` rows, `orderBy: { createdAt: "desc" }`.
//! Brand, category and function are read from `TenantBrand`,
//! `TenantEquipmentCategory` and `TenantFunction` (arkyo's main-first
//! lookups).

use serde::Serialize;
use sqlx::{FromRow, SqliteConnection};

use crate::inventory::{brands, categories, distinct, functions, json_ids, primary_function};

/// `MergedCatalogEquipment`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedCatalogEquipment {
    pub id: String,
    pub name: String,
    pub reference: Option<String>,
    pub brand_name: Option<String>,
    pub category_name: Option<String>,
    pub category_color: Option<String>,
    pub image_url: Option<String>,
    pub height_u: Option<i64>,
    pub width_fraction: &'static str,
    pub is_rackable: bool,
    pub power_w: Option<i64>,
    pub depth_mm: Option<i64>,
    pub weight_kg: Option<f64>,
    pub is_component_host: bool,
    pub is_component: bool,
    pub is_2110: bool,
    pub is_lighting_fixture: bool,
    /// Always `PERSONAL`.
    pub source: &'static str,
}

/// `MergedCatalogAdapter`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedCatalogAdapter {
    pub id: String,
    pub name: String,
    pub reference: Option<String>,
    pub image_url: Option<String>,
    pub category_name: Option<String>,
    pub category_color: Option<String>,
    /// Always `PERSONAL`.
    pub source: &'static str,
}

#[derive(FromRow)]
#[sqlx(rename_all = "camelCase")]
struct EquipmentRow {
    id: String,
    name: String,
    reference: Option<String>,
    image_url: Option<String>,
    height_u: Option<i64>,
    width_fraction: String,
    is_rackable: bool,
    power_w: Option<i64>,
    depth_mm: Option<i64>,
    weight: Option<f64>,
    brand_id: Option<String>,
    category_id: Option<String>,
    is_component_host: bool,
    is_component: bool,
    #[sqlx(rename = "is2110")]
    is_2110: bool,
    is_lighting_fixture: bool,
    function_ids: String,
}

#[derive(FromRow)]
#[sqlx(rename_all = "camelCase")]
struct AdapterRow {
    id: String,
    name: String,
    reference: Option<String>,
    image_url: Option<String>,
    function_id: Option<String>,
}

/// `toWidthFraction`: `HALF`, `THIRD`, `QUARTER`, anything else `FULL`.
fn to_width_fraction(v: &str) -> &'static str {
    match v {
        "HALF" => "HALF",
        "THIRD" => "THIRD",
        "QUARTER" => "QUARTER",
        _ => "FULL",
    }
}

/// `fetchMergedInventaireEquipments(db)`: `categoryName` / `categoryColor`
/// from the primary function (lowest `sortOrder` of `functionIds`), else the
/// equipment category.
pub async fn fetch_inventaire_equipments(
    conn: &mut SqliteConnection,
) -> Result<Vec<MergedCatalogEquipment>, sqlx::Error> {
    let rows: Vec<EquipmentRow> = sqlx::query_as(
        r#"SELECT "id", "name", "reference", "imageUrl", "heightU", "widthFraction",
             "isRackable", "powerW", "depthMm", "weight", "brandId", "categoryId",
             "isComponentHost", "isComponent", "is2110", "isLightingFixture", "functionIds"
           FROM "TenantEquipment" WHERE "isActive" = 1
           ORDER BY "createdAt" DESC, rowid DESC"#,
    )
    .fetch_all(&mut *conn)
    .await?;

    let fn_src: Vec<String> = rows
        .iter()
        .flat_map(|r| json_ids(&r.function_ids))
        .collect();
    let fn_lookup = functions(conn, &distinct(fn_src.iter().map(|s| Some(s.as_str())))).await?;
    let brand_lookup = brands(conn, &distinct(rows.iter().map(|r| r.brand_id.as_deref()))).await?;
    let cat_lookup = categories(
        conn,
        &distinct(rows.iter().map(|r| r.category_id.as_deref())),
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(|p| {
            let primary = primary_function(&json_ids(&p.function_ids), &fn_lookup);
            let cat = p.category_id.as_deref().and_then(|c| cat_lookup.get(c));
            MergedCatalogEquipment {
                brand_name: p
                    .brand_id
                    .as_deref()
                    .and_then(|b| brand_lookup.get(b))
                    .map(|b| b.name.clone()),
                category_name: primary
                    .map(|f| f.label.clone())
                    .or_else(|| cat.map(|c| c.name.clone())),
                category_color: primary
                    .and_then(|f| f.color.clone())
                    .or_else(|| cat.and_then(|c| c.color.clone())),
                width_fraction: to_width_fraction(&p.width_fraction),
                id: p.id,
                name: p.name,
                reference: p.reference,
                image_url: p.image_url,
                height_u: p.height_u,
                is_rackable: p.is_rackable,
                power_w: p.power_w,
                depth_mm: p.depth_mm,
                weight_kg: p.weight,
                is_component_host: p.is_component_host,
                is_component: p.is_component,
                is_2110: p.is_2110,
                is_lighting_fixture: p.is_lighting_fixture,
                source: "PERSONAL",
            }
        })
        .collect())
}

/// `fetchMergedInventaireAdapters(db)`: the category is the adapter's
/// function.
pub async fn fetch_inventaire_adapters(
    conn: &mut SqliteConnection,
) -> Result<Vec<MergedCatalogAdapter>, sqlx::Error> {
    let rows: Vec<AdapterRow> = sqlx::query_as(
        r#"SELECT "id", "name", "reference", "imageUrl", "functionId"
           FROM "TenantAdapter" WHERE "isActive" = 1
           ORDER BY "createdAt" DESC, rowid DESC"#,
    )
    .fetch_all(&mut *conn)
    .await?;
    let fn_lookup = functions(
        conn,
        &distinct(rows.iter().map(|r| r.function_id.as_deref())),
    )
    .await?;
    Ok(rows
        .into_iter()
        .map(|a| {
            let f = a.function_id.as_deref().and_then(|f| fn_lookup.get(f));
            MergedCatalogAdapter {
                category_name: f.map(|f| f.label.clone()),
                category_color: f.and_then(|f| f.color.clone()),
                id: a.id,
                name: a.name,
                reference: a.reference,
                image_url: a.image_url,
                source: "PERSONAL",
            }
        })
        .collect())
}
