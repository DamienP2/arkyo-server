//! Racks as arkyo's container routes return them: the Prisma scalars, the
//! `slots` (with `include: { panel: { select … } }`) and the `rigs` links
//! (`include: { rigConfig: { select: { id, name } } }`), then `enrichRacks`
//! (arkyo:app/api/racks/route.ts:66-106), which resolves the catalogue.
//!
//! The catalogue lookups are arkyo's `fetchCatalogEquipmentMap` and
//! `fetchCatalogConnectorTypeMap` (arkyo:lib/services/catalog-enrich.ts),
//! read from the single local catalogue (phase 2): the `TenantEquipment` and
//! `TenantConnectorType` tables, with the table definitions of
//! [`crate::catalogue::enrich`] and the Neutrik D derivation of the settings
//! route ([`connectors::has_neutrik_d`]). They return arkyo's `*Lite`
//! shapes, not the catalogue's full payload.

use std::collections::HashMap;

use serde_json::{json, Value};
use sqlx::SqliteConnection;

use crate::catalogue::enrich::{lookup, CONNECTOR_TYPE, EQUIPMENT};
use crate::http::parametres::connectors;
use crate::http::parametres::{row_map, str_of, Obj, Table};
use crate::http::projects::{PLAIN, RACK};

/// The scalars of the Prisma `Rack` model, in the schema's order. Listed
/// rather than `*` so a newer database's extra columns stay out of the JSON.
pub const RACK_COLS: &str = r#""id", "name", "totalU", "depthMm", "maxWeightKg", "maxPowerW",
    "emptyWeightKg", "notes", "rearInteriorGapMm", "cableId", "cableNextNum", "cableCode",
    "numberingOverride", "rackType", "isRackable", "widthMm", "heightMm", "hasWheels",
    "constructionChecks", "templateStatus", "prepStatus", "sourcing", "canvasX", "canvasY",
    "locationId", "isVirtual", "createdAt", "updatedAt""#;

/// The scalars of the Prisma `RackSlot` model, in the schema's order.
pub const SLOT_COLS: &str = r#""id", "rackId", "catalogEquipmentId", "snapshotId", "panelId",
    "parentSlotId", "inventoryItemId", "view", "startU", "heightU", "widthFraction", "column",
    "label", "notes", "patchNotes", "panelLabels", "synopticX", "synopticY", "createdAt",
    "updatedAt""#;

pub static RACK_SLOT: Table = Table {
    name: "RackSlot",
    bools: &[],
    jsons: &["panelLabels"],
};

/// The `select` of `CatalogEquipmentLite` (catalog-enrich.ts:123-149).
const EQUIPMENT_COLS: &str = r#""id", "name", "reference", "categoryId", "heightU",
    "widthFraction", "depthMm", "rearCableDepthMm", "dimLmm", "dimWmm", "dimHmm", "weight",
    "powerW", "isRackable", "isComponentHost", "hostSlotCount", "isComponent",
    "componentSlotSpan", "connectors", "imageUrl", "rackSymbolUrl", "rackSymbolRearUrl",
    "rackPhotoFrontUrl", "rackPhotoRearUrl", "brandId""#;

/// How the slots of a rack are sorted.
#[derive(Clone, Copy)]
pub enum SlotOrder {
    /// No `orderBy` in arkyo: insertion order.
    Created,
    /// `orderBy: { startU: "asc" }`, unplaced slots last as in Postgres.
    StartU,
}

/// `?, ?, …` for `n` values.
fn marks(n: usize) -> String {
    vec!["?"; n].join(", ")
}

/// Distinct non-empty values of `key` in `rows`, in order of appearance.
fn distinct<'a>(rows: impl IntoIterator<Item = &'a Obj>, key: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in rows {
        if let Some(v) = str_of(r, key).filter(|v| !v.is_empty()) {
            if !out.iter().any(|o| o == v) {
                out.push(v.to_string());
            }
        }
    }
    out
}

/// `SELECT cols FROM table WHERE col IN (ids) ORDER BY order`, mapped with
/// `t`; `table`, `cols`, `col` and `order` are literals of this module.
async fn rows_in(
    conn: &mut SqliteConnection,
    t: &Table,
    table: &str,
    cols: &str,
    col: &str,
    ids: &[String],
    order: &str,
) -> Result<Vec<Obj>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let sql = format!(
        r#"SELECT {cols} FROM "{table}" WHERE "{col}" IN ({}) ORDER BY {order}"#,
        marks(ids.len())
    );
    let mut q = sqlx::query(&sql);
    for id in ids {
        q = q.bind(id);
    }
    Ok(q.fetch_all(conn)
        .await?
        .iter()
        .map(|r| row_map(r, t))
        .collect())
}

// ── racks ───────────────────────────────────────────────────────────────────

/// The racks `filter` selects (a `WHERE` clause on the alias `r`, a literal
/// of the routes, with `binds` for its `?`), in `order`, as Prisma scalars.
pub async fn rack_rows(
    conn: &mut SqliteConnection,
    filter: &str,
    binds: &[&str],
    order: &str,
) -> Result<Vec<Obj>, sqlx::Error> {
    let cols = RACK_COLS
        .split(',')
        .map(|c| format!("r.{}", c.trim()))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(r#"SELECT {cols} FROM "Rack" r {filter} ORDER BY {order}"#);
    let mut q = sqlx::query(&sql);
    for b in binds {
        q = q.bind(*b);
    }
    Ok(q.fetch_all(conn)
        .await?
        .iter()
        .map(|r| row_map(r, &RACK))
        .collect())
}

/// The rack `id` (Prisma scalars), `None` when it does not exist.
pub async fn rack_row(conn: &mut SqliteConnection, id: &str) -> Result<Option<Obj>, sqlx::Error> {
    Ok(rack_rows(conn, r#"WHERE r."id" = ?"#, &[id], r#"r."id""#)
        .await?
        .into_iter()
        .next())
}

/// Adds `slots` (raw `RackSlot` rows) to each rack.
pub async fn attach_slots(
    conn: &mut SqliteConnection,
    racks: &mut [Obj],
    order: SlotOrder,
) -> Result<(), sqlx::Error> {
    let ids = distinct(racks.iter(), "id");
    let order = match order {
        SlotOrder::Created => r#""createdAt", "id""#,
        SlotOrder::StartU => r#""startU" IS NULL, "startU", "createdAt", "id""#,
    };
    let rows = rows_in(
        conn, &RACK_SLOT, "RackSlot", SLOT_COLS, "rackId", &ids, order,
    )
    .await?;
    let mut by_rack: HashMap<String, Vec<Value>> = HashMap::new();
    for s in rows {
        let rack = str_of(&s, "rackId").unwrap_or_default().to_string();
        by_rack.entry(rack).or_default().push(Value::Object(s));
    }
    for r in racks.iter_mut() {
        let slots = str_of(r, "id")
            .and_then(|id| by_rack.remove(id))
            .unwrap_or_default();
        r.insert("slots".into(), Value::Array(slots));
    }
    Ok(())
}

/// Adds `rigs`: the `RigRack` links of each rack with
/// `rigConfig: { id, name }`.
pub async fn attach_rigs(
    conn: &mut SqliteConnection,
    racks: &mut [Obj],
) -> Result<(), sqlx::Error> {
    let ids = distinct(racks.iter(), "id");
    if ids.is_empty() {
        return Ok(());
    }
    let sql = format!(
        r#"SELECT rr."id", rr."rigConfigId", rr."rackId", rr."position", g."name" AS "rigName"
           FROM "RigRack" rr JOIN "RigConfig" g ON g."id" = rr."rigConfigId"
           WHERE rr."rackId" IN ({}) ORDER BY rr."position", rr."id""#,
        marks(ids.len())
    );
    let mut q = sqlx::query(&sql);
    for id in &ids {
        q = q.bind(id);
    }
    let mut by_rack: HashMap<String, Vec<Value>> = HashMap::new();
    for row in q.fetch_all(conn).await? {
        let mut link = row_map(&row, &PLAIN);
        let name = link.remove("rigName").unwrap_or(Value::Null);
        let rig = link.get("rigConfigId").cloned().unwrap_or(Value::Null);
        link.insert("rigConfig".into(), json!({ "id": rig, "name": name }));
        let rack = str_of(&link, "rackId").unwrap_or_default().to_string();
        by_rack.entry(rack).or_default().push(Value::Object(link));
    }
    for r in racks.iter_mut() {
        let rigs = str_of(r, "id")
            .and_then(|id| by_rack.remove(id))
            .unwrap_or_default();
        r.insert("rigs".into(), Value::Array(rigs));
    }
    Ok(())
}

/// The slots of every rack, as plain objects.
fn slots_of(racks: &[Obj]) -> impl Iterator<Item = &Obj> {
    racks
        .iter()
        .filter_map(|r| r.get("slots").and_then(Value::as_array))
        .flatten()
        .filter_map(Value::as_object)
}

fn slots_of_mut(racks: &mut [Obj]) -> impl Iterator<Item = &mut Obj> {
    racks
        .iter_mut()
        .filter_map(|r| r.get_mut("slots").and_then(Value::as_array_mut))
        .flatten()
        .filter_map(Value::as_object_mut)
}

/// `enrichRacks`: adds to every slot (already attached by
/// [`attach_slots`]) `equipmentId`, `equipment` (the catalogue item or
/// `null`) and `panel` (`{id, name, heightU, slotsPerU, rearCableDepthMm,
/// slots: [{position, mountD, connectorTypeId, connectorType}]}` or `null`).
pub async fn slots(conn: &mut SqliteConnection, racks: &mut [Obj]) -> Result<(), sqlx::Error> {
    let eq_ids = distinct(slots_of(racks), "catalogEquipmentId");
    let equipment = equipment_map(conn, &eq_ids).await?;

    let panel_ids = distinct(slots_of(racks), "panelId");
    let panels = rows_in(
        conn,
        &PLAIN,
        "Panel",
        r#""id", "name", "heightU", "slotsPerU", "rearCableDepthMm""#,
        "id",
        &panel_ids,
        r#""id""#,
    )
    .await?;
    let panel_slots = rows_in(
        conn,
        &Table {
            name: "PanelSlot",
            bools: &["mountD"],
            jsons: &[],
        },
        "PanelSlot",
        r#""panelId", "position", "catalogConnectorTypeId", "mountD""#,
        "panelId",
        &panel_ids,
        r#""position", "id""#,
    )
    .await?;
    let ct_ids = distinct(panel_slots.iter(), "catalogConnectorTypeId");
    let connector_types = connector_type_map(conn, &ct_ids).await?;

    let mut by_panel: HashMap<String, Value> = HashMap::new();
    for mut p in panels {
        let id = str_of(&p, "id").unwrap_or_default().to_string();
        let slots: Vec<Value> = panel_slots
            .iter()
            .filter(|ps| str_of(ps, "panelId") == Some(id.as_str()))
            .map(|ps| {
                let ct = str_of(ps, "catalogConnectorTypeId");
                json!({
                    "position": ps.get("position"),
                    "mountD": ps.get("mountD"),
                    "connectorTypeId": ct,
                    "connectorType": ct
                        .and_then(|c| connector_types.get(c))
                        .cloned()
                        .unwrap_or(Value::Null),
                })
            })
            .collect();
        p.insert("slots".into(), Value::Array(slots));
        by_panel.insert(id, Value::Object(p));
    }

    for s in slots_of_mut(racks) {
        let eq = s.get("catalogEquipmentId").cloned().unwrap_or(Value::Null);
        let item = eq
            .as_str()
            .and_then(|id| equipment.get(id))
            .cloned()
            .unwrap_or(Value::Null);
        let panel = str_of(s, "panelId")
            .and_then(|id| by_panel.get(id))
            .cloned()
            .unwrap_or(Value::Null);
        s.insert("equipmentId".into(), eq);
        s.insert("equipment".into(), item);
        s.insert("panel".into(), panel);
    }
    Ok(())
}

/// The `equipment` of every slot only, as the rig page and
/// `GET /api/rigs/:id` add it (arkyo:app/api/rigs/[id]/route.ts:43-61).
pub async fn slot_equipment(
    conn: &mut SqliteConnection,
    racks: &mut [Obj],
) -> Result<(), sqlx::Error> {
    let eq_ids = distinct(slots_of(racks), "catalogEquipmentId");
    let equipment = equipment_map(conn, &eq_ids).await?;
    for s in slots_of_mut(racks) {
        let item = str_of(s, "catalogEquipmentId")
            .and_then(|id| equipment.get(id))
            .cloned()
            .unwrap_or(Value::Null);
        s.insert("equipment".into(), item);
    }
    Ok(())
}

/// `fetchRacksRaw` + `enrichRacks` of arkyo:app/api/racks/route.ts: the
/// racks `filter` selects, with enriched `slots` and `rigs`.
pub async fn racks(
    conn: &mut SqliteConnection,
    filter: &str,
    binds: &[&str],
    order: &str,
) -> Result<Vec<Obj>, sqlx::Error> {
    let mut racks = rack_rows(conn, filter, binds, order).await?;
    attach_slots(conn, &mut racks, SlotOrder::Created).await?;
    slots(conn, &mut racks).await?;
    attach_rigs(conn, &mut racks).await?;
    Ok(racks)
}

// ── catalogue lookups ───────────────────────────────────────────────────────

/// `fetchCatalogEquipmentMap(ids, db)`: `CatalogEquipmentLite` by id
/// (`category: null`, `brand: {id, name}`, `source: "PERSONAL"`, as arkyo's
/// tenant fallback, catalog-enrich.ts:189-218). Unknown ids are absent.
pub async fn equipment_map(
    conn: &mut SqliteConnection,
    ids: &[String],
) -> Result<HashMap<String, Value>, sqlx::Error> {
    let rows = rows_in(
        conn,
        &EQUIPMENT,
        "TenantEquipment",
        EQUIPMENT_COLS,
        "id",
        ids,
        r#""id""#,
    )
    .await?;
    let brand_ids = distinct(rows.iter(), "brandId");
    let brands: HashMap<String, Obj> = rows_in(
        conn,
        &PLAIN,
        "TenantBrand",
        r#""id", "name""#,
        "id",
        &brand_ids,
        r#""id""#,
    )
    .await?
    .into_iter()
    .filter_map(|b| Some((str_of(&b, "id")?.to_string(), b)))
    .collect();
    Ok(rows
        .into_iter()
        .map(|mut r| {
            let brand = lookup(&brands, str_of(&r, "brandId"));
            r.remove("brandId");
            r.insert("category".into(), Value::Null);
            r.insert("brand".into(), brand);
            r.insert("source".into(), "PERSONAL".into());
            (
                str_of(&r, "id").unwrap_or_default().to_string(),
                Value::Object(r),
            )
        })
        .collect())
}

/// `fetchCatalogConnectorTypeMap(ids)`: `CatalogConnectorTypeLite` by id
/// (`{id, name, versions, iconId, color, category: null, hasNeutrikD,
/// dTypeSvgUrl}`), the D flags derived from the referenced symbol.
pub async fn connector_type_map(
    conn: &mut SqliteConnection,
    ids: &[String],
) -> Result<HashMap<String, Value>, sqlx::Error> {
    let rows = rows_in(
        conn,
        CONNECTOR_TYPE,
        "TenantConnectorType",
        r#""id", "name", "versions", "iconId", "color", "svgUrl""#,
        "id",
        ids,
        r#""id""#,
    )
    .await?;
    if rows.is_empty() {
        return Ok(HashMap::new());
    }
    let symbols = connectors::load_symbols(conn).await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let icon = str_of(&r, "iconId");
            let svg = str_of(&r, "svgUrl");
            let lite = json!({
                "id": r.get("id"),
                "name": r.get("name"),
                "versions": r.get("versions"),
                "iconId": r.get("iconId"),
                "color": r.get("color"),
                "category": null,
                "hasNeutrikD": connectors::has_neutrik_d(icon, svg, &symbols),
                "dTypeSvgUrl": connectors::d_type_svg_url(icon, svg, &symbols),
            });
            (str_of(&r, "id").unwrap_or_default().to_string(), lite)
        })
        .collect())
}
