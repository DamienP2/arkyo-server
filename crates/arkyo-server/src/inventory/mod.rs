//! Inventory services of the project editor (phase 4), the server side of
//! arkyo's `lib/services`:
//! - [`validate`]: `validateInventoryRef` (rack-inventory.ts:208-303) and the
//!   catalogue check of the referenced item;
//! - [`sync`]: phantom ("ghost") slots (rack-inventory-sync.ts);
//! - [`auto_label`]: `#XXXX` slot labels (auto-label.ts);
//! - [`api`]: `BomItemDto` enrichment and the component helpers
//!   (rack-inventory-api.ts, and the project variant inlined in
//!   `app/api/tenant/projects/[id]/racks/[rackId]/inventory/route.ts`);
//! - [`catalog`]: the inventory catalogue panel (catalog-merge.ts).
//! - [`clone`]: copy of a rack and its content with remapped ids
//!   (rack-clone.ts `cloneRackInto`).
//!
//! Single local catalogue: arkyo's "main DB first, tenant fallback" lookups
//! read the `Tenant*` tables directly, snapshots do not exist (`snapshotId`
//! is always `null`), and the functions of an equipment come from its
//! `functionIds` only.
//!
//! Every function takes a `&mut SqliteConnection`: the write routes call them
//! inside their [`crate::db::begin_immediate`] transaction.

pub mod api;
pub mod auto_label;
pub mod catalog;
pub mod clone;
pub mod sync;
pub mod validate;

use std::collections::HashMap;

use sqlx::sqlite::SqliteRow;
use sqlx::{FromRow, SqliteConnection};

/// `?, ?, …` for `n` values.
pub(crate) fn marks(n: usize) -> String {
    vec!["?"; n].join(", ")
}

/// Distinct non-empty ids, in order of appearance.
pub(crate) fn distinct<'a>(ids: impl IntoIterator<Item = Option<&'a str>>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for id in ids.into_iter().flatten() {
        if !id.is_empty() && !out.iter().any(|o| o == id) {
            out.push(id.to_string());
        }
    }
    out
}

/// `SELECT cols FROM "table" WHERE "id" IN (ids)` as `T`; `table` and `cols`
/// are literals of this module.
pub(crate) async fn rows_by_id<T>(
    conn: &mut SqliteConnection,
    table: &str,
    cols: &str,
    ids: &[String],
) -> Result<Vec<T>, sqlx::Error>
where
    T: for<'r> FromRow<'r, SqliteRow> + Send + Unpin,
{
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let sql = format!(
        r#"SELECT {cols} FROM "{table}" WHERE "id" IN ({}) ORDER BY "id""#,
        marks(ids.len())
    );
    let mut q = sqlx::query_as::<_, T>(&sql);
    for id in ids {
        q = q.bind(id);
    }
    q.fetch_all(conn).await
}

/// A `TenantFunction` (arkyo's `CatalogFunction`): `label` and `color` are
/// the "category" of an item in the inventory.
#[derive(Debug, Clone, FromRow)]
#[sqlx(rename_all = "camelCase")]
pub(crate) struct FunctionLite {
    pub id: String,
    pub label: String,
    pub color: Option<String>,
    pub sort_order: i64,
}

/// A `TenantEquipmentCategory` (`CatalogEquipmentCategory`).
#[derive(Debug, Clone, FromRow)]
pub(crate) struct CategoryLite {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

/// A `TenantBrand` (`CatalogBrand`).
#[derive(Debug, Clone, FromRow)]
pub(crate) struct BrandLite {
    pub id: String,
    pub name: String,
}

pub(crate) async fn functions(
    conn: &mut SqliteConnection,
    ids: &[String],
) -> Result<HashMap<String, FunctionLite>, sqlx::Error> {
    let rows: Vec<FunctionLite> = rows_by_id(
        conn,
        "TenantFunction",
        r#""id", "label", "color", "sortOrder""#,
        ids,
    )
    .await?;
    Ok(rows.into_iter().map(|f| (f.id.clone(), f)).collect())
}

pub(crate) async fn categories(
    conn: &mut SqliteConnection,
    ids: &[String],
) -> Result<HashMap<String, CategoryLite>, sqlx::Error> {
    let rows: Vec<CategoryLite> = rows_by_id(
        conn,
        "TenantEquipmentCategory",
        r#""id", "name", "color""#,
        ids,
    )
    .await?;
    Ok(rows.into_iter().map(|c| (c.id.clone(), c)).collect())
}

pub(crate) async fn brands(
    conn: &mut SqliteConnection,
    ids: &[String],
) -> Result<HashMap<String, BrandLite>, sqlx::Error> {
    let rows: Vec<BrandLite> = rows_by_id(conn, "TenantBrand", r#""id", "name""#, ids).await?;
    Ok(rows.into_iter().map(|b| (b.id.clone(), b)).collect())
}

/// The string ids of a JSON array column (`functionIds`); anything else
/// gives no id, as arkyo's `Array.isArray(...) ? filter(string) : []`.
pub(crate) fn json_ids(raw: &str) -> Vec<String> {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|a| {
            a.into_iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// The primary function of `fn_ids`: the known one with the lowest
/// `sortOrder` (stable on ties, like `Array.prototype.sort`).
pub(crate) fn primary_function<'a>(
    fn_ids: &[String],
    lookup: &'a HashMap<String, FunctionLite>,
) -> Option<&'a FunctionLite> {
    let mut fns: Vec<&FunctionLite> = fn_ids.iter().filter_map(|id| lookup.get(id)).collect();
    fns.sort_by_key(|f| f.sort_order);
    fns.first().copied()
}
