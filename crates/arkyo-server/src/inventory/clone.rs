//! arkyo:lib/services/rack-clone.ts (`cloneRackInto`): copy of a rack
//! (container) and of everything it holds, with new ids and every internal
//! reference remapped to the copy. Used both ways between templates and
//! projects (`save-as-template`, `clone-from-template`), and by the
//! `fromTemplateId` branch of `POST /api/tenant/projects/:id/racks`.
//!
//! Two depths, one per arkyo source ([`CloneScope`]):
//! - [`CloneScope::Full`], `cloneRackInto` (rack-clone.ts:43-352): the rack,
//!   then `RackInventoryItem` (hosts, then components), `RackSlot` (then
//!   their `parentSlotId`), `SynopticAdapter`, `CableBundle`,
//!   `RackConnection`, `RackSlotPanelRow`, `ExternalPort`, `RackZone`,
//!   `RackLabel` and `SynopticGuide`. Left out as in arkyo: `cableId`,
//!   `constructionChecks`, `templateStatus` (and the other rack columns
//!   arkyo does not list: `prepStatus`, `sourcing`, `isVirtual`), the
//!   wiring state of the connections (`wired`, `wiredAt`, `wiredNotes`)
//!   and the rack-level `SynopticGuide.projectId`;
//! - [`CloneScope::SlotsOnly`], the inline copy of
//!   arkyo:app/api/tenant/projects/[id]/racks/route.ts:150-218: a subset of
//!   the rack's fields, the slots without their links, and one inventory
//!   item per catalogue reference of the slots (quantity = slot count),
//!   bound to those slots.
//!
//! A reference whose target is not a row of the source rack has no
//! counterpart and becomes `NULL` (`idMap.get(old) ?? null`).
//!
//! The caller picks the name (already unique in its scope,
//! [`crate::projects::naming::ensure_unique_rack_name`]) and links the copy
//! to a rig (`RigRack`); this module does neither, as in arkyo.
//!
//! arkyo-server:
//! - snapshots SaaS retirés : `snapshotId` n'est pas recopié et reste
//!   `NULL` (arkyo le recopiait, rack-clone.ts:115, :135, :176, :240) ;
//! - le lieu de la copie est posé à la création (arkyo : `rack.update
//!   { locationId }` juste après, clone-from-template/route.ts:126-129) ;
//! - correction : `ExternalPort.kind` est recopié. arkyo l'omettait, si bien
//!   qu'une bulle `MONDE` (étiquette libre) revenait `INTER_LIEU` sur la
//!   copie (perte de donnée).

use std::collections::HashMap;

use sqlx::sqlite::{SqliteArguments, SqliteRow};
use sqlx::{Row, Sqlite, SqliteConnection, TypeInfo, ValueRef};

use crate::ids::{new_id, now_iso};

/// How much of the rack is copied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloneScope {
    /// `cloneRackInto` (rack-clone.ts): everything, references remapped.
    Full,
    /// racks/route.ts:150-218 (`fromTemplateId`): rack subset, slots, and
    /// the inventory derived from the slots.
    SlotsOnly,
}

/// Where the copy goes.
#[derive(Debug, Clone, Copy)]
pub struct CloneTarget<'a> {
    /// The copy's name, used as is.
    pub name: &'a str,
    /// The copy's `locationId` (`None` for a template rack).
    pub location_id: Option<&'a str>,
    pub scope: CloneScope,
}

/// Row counts of the source rack (the `clone_rack_from_template` audit).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CloneCounts {
    pub slots: usize,
    pub inventory: usize,
    pub connections: usize,
    pub adapters: usize,
    pub bundles: usize,
}

/// The rack created by [`clone_rack_into`].
#[derive(Debug, Clone)]
pub struct NewRack {
    pub id: String,
    pub name: String,
    pub rack_type: String,
    pub counts: CloneCounts,
}

/// Old id → new id of one table.
type IdMap = HashMap<String, String>;

/// One table to copy: the source rows (`filter`, a literal of this module
/// where `?1` is the source rack id), the columns copied as they are and
/// the timestamps set to now.
struct Spec {
    table: &'static str,
    filter: &'static str,
    cols: &'static [&'static str],
    stamps: &'static [&'static str],
}

const BOTH: &[&str] = &["createdAt", "updatedAt"];

/// rack-clone.ts:71-91.
const RACK_FULL: Spec = Spec {
    table: "Rack",
    filter: r#""id" = ?1"#,
    cols: &[
        "totalU",
        "depthMm",
        "maxWeightKg",
        "maxPowerW",
        "emptyWeightKg",
        "notes",
        "rearInteriorGapMm",
        "rackType",
        "isRackable",
        "widthMm",
        "heightMm",
        "hasWheels",
        "cableCode",
        "cableNextNum",
        "numberingOverride",
        "canvasX",
        "canvasY",
    ],
    stamps: BOTH,
};

/// racks/route.ts:159-171.
const RACK_SLOTS_ONLY: Spec = Spec {
    table: "Rack",
    filter: r#""id" = ?1"#,
    cols: &[
        "totalU",
        "depthMm",
        "maxWeightKg",
        "maxPowerW",
        "emptyWeightKg",
        "notes",
        "rackType",
        "hasWheels",
    ],
    stamps: BOTH,
};

/// rack-clone.ts:107-126, top-level items first (their components need
/// them), then the components (`hostItemId` remapped).
const INVENTORY_COLS: &[&str] = &[
    "catalogEquipmentId",
    "panelId",
    "catalogAdapterId",
    "accessoryType",
    "accessoryHeightU",
    "accessoryVariant",
    "accessoryDepthMm",
    "quantity",
    "notes",
    "hostSlotIndex",
];
const HOSTS: Spec = Spec {
    table: "RackInventoryItem",
    filter: r#""rackId" = ?1 AND "hostItemId" IS NULL"#,
    cols: INVENTORY_COLS,
    stamps: BOTH,
};
const COMPONENTS: Spec = Spec {
    table: "RackInventoryItem",
    filter: r#""rackId" = ?1 AND "hostItemId" IS NOT NULL"#,
    cols: INVENTORY_COLS,
    stamps: BOTH,
};

/// rack-clone.ts:131-151 (`inventoryItemId` remapped; `parentSlotId` in a
/// second pass, :156-165).
const SLOTS_FULL: Spec = Spec {
    table: "RackSlot",
    filter: r#""rackId" = ?1"#,
    cols: &[
        "catalogEquipmentId",
        "panelId",
        "view",
        "startU",
        "heightU",
        "widthFraction",
        "column",
        "label",
        "notes",
        "patchNotes",
        "panelLabels",
        "synopticX",
        "synopticY",
    ],
    stamps: BOTH,
};

/// racks/route.ts:174-188.
const SLOTS_ONLY: Spec = Spec {
    table: "RackSlot",
    filter: r#""rackId" = ?1"#,
    cols: &[
        "catalogEquipmentId",
        "panelId",
        "view",
        "startU",
        "heightU",
        "widthFraction",
        "column",
        "label",
        "notes",
    ],
    stamps: BOTH,
};

/// rack-clone.ts:168-185 (`attachedSlotId` remapped).
const ADAPTERS: Spec = Spec {
    table: "SynopticAdapter",
    filter: r#""rackId" = ?1"#,
    cols: &[
        "catalogAdapterId",
        "x",
        "y",
        "attachedSide",
        "attachedPortIndex",
        "label",
        "notes",
    ],
    stamps: BOTH,
};

/// rack-clone.ts:188-197.
const BUNDLES: Spec = Spec {
    table: "CableBundle",
    filter: r#""rackId" = ?1"#,
    cols: &["name", "color"],
    stamps: BOTH,
};

/// rack-clone.ts:202-244: every endpoint and the bundle remapped; the
/// wiring state starts over (defaults).
const CONNECTIONS: Spec = Spec {
    table: "RackConnection",
    filter: r#""rackId" = ?1"#,
    cols: &[
        "fromConnectorIndex",
        "fromAdapterSide",
        "fromAdapterPortIndex",
        "toConnectorIndex",
        "toAdapterSide",
        "toAdapterPortIndex",
        "label",
        "color",
        "waypoints",
        "cableStyle",
        "notes",
        "tags",
        "catalogCableModelId",
    ],
    stamps: &["createdAt"],
};

/// rack-clone.ts:248-266: the rows of the rack's slots (`slotId` remapped).
const PANEL_ROWS: Spec = Spec {
    table: "RackSlotPanelRow",
    filter: r#""slotId" IN (SELECT "id" FROM "RackSlot" WHERE "rackId" = ?1)"#,
    cols: &["rowIndex", "synopticX", "synopticY"],
    stamps: BOTH,
};

/// rack-clone.ts:269-290: the ports of the rack's slots (`slotId`
/// remapped).
const EXTERNAL_PORTS: Spec = Spec {
    table: "ExternalPort",
    filter: r#""slotId" IN (SELECT "id" FROM "RackSlot" WHERE "rackId" = ?1)"#,
    // arkyo-server: correction, `kind` recopié (voir l'en-tête du module).
    cols: &["portIndex", "labelX", "labelY", "label", "kind"],
    stamps: BOTH,
};

/// rack-clone.ts:293-315.
const ZONES: Spec = Spec {
    table: "RackZone",
    filter: r#""rackId" = ?1"#,
    cols: &[
        "label",
        "labelPosition",
        "color",
        "x",
        "y",
        "w",
        "h",
        "borderRadius",
        "borderWidth",
        "borderStyle",
        "opacity",
        "labelFontSize",
        "labelFontWeight",
        "labelFontStyle",
        "labelTextDecoration",
        "labelFontFamily",
    ],
    stamps: BOTH,
};

/// rack-clone.ts:318-337.
const LABELS: Spec = Spec {
    table: "RackLabel",
    filter: r#""rackId" = ?1"#,
    cols: &[
        "text",
        "x",
        "y",
        "fontSize",
        "width",
        "color",
        "fontWeight",
        "fontFamily",
        "fontStyle",
        "textDecoration",
        "pill",
        "pillBg",
        "pillRadius",
    ],
    stamps: BOTH,
};

/// rack-clone.ts:340-349: the rack's guides (`projectId` stays `NULL`).
const GUIDES: Spec = Spec {
    table: "SynopticGuide",
    filter: r#""rackId" = ?1"#,
    cols: &["axis", "position", "color", "label"],
    stamps: BOTH,
};

/// A value as SQLite stores it, copied without conversion (a `REAL` keeps
/// every bit, a JSON column stays its text).
enum Cell {
    Null,
    Int(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

fn cell(row: &SqliteRow, i: usize) -> Result<Cell, sqlx::Error> {
    let raw = row.try_get_raw(i)?;
    if raw.is_null() {
        return Ok(Cell::Null);
    }
    let kind = raw.type_info().name().to_string();
    Ok(match kind.as_str() {
        "INTEGER" => Cell::Int(row.try_get_unchecked(i)?),
        "REAL" => Cell::Real(row.try_get_unchecked(i)?),
        "TEXT" => Cell::Text(row.try_get_unchecked(i)?),
        _ => Cell::Blob(row.try_get_unchecked(i)?),
    })
}

type Query<'q> = sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>>;

fn bind_cell(q: Query<'_>, c: Cell) -> Query<'_> {
    match c {
        Cell::Null => q.bind(None::<String>),
        Cell::Int(v) => q.bind(v),
        Cell::Real(v) => q.bind(v),
        Cell::Text(v) => q.bind(v),
        Cell::Blob(v) => q.bind(v),
    }
}

/// Copies the rows `spec` selects from the source rack `source`, in
/// insertion order: a new id each, the `fixed` columns set, `spec.cols`
/// copied, each `remap` column replaced by its counterpart in the map
/// (`NULL` when it has none), the timestamps set to `now`. Returns old id →
/// new id.
async fn copy_rows(
    conn: &mut SqliteConnection,
    spec: &Spec,
    source: &str,
    fixed: &[(&str, Option<&str>)],
    remap: &[(&str, &IdMap)],
    now: &str,
) -> Result<IdMap, sqlx::Error> {
    let quoted = |c: &&str| format!(r#""{c}""#);
    let mut select: Vec<String> = vec![r#""id""#.into()];
    select.extend(spec.cols.iter().map(quoted));
    select.extend(remap.iter().map(|(c, _)| quoted(c)));
    let rows = sqlx::query(&format!(
        r#"SELECT {} FROM "{}" WHERE {} ORDER BY "createdAt", rowid"#,
        select.join(", "),
        spec.table,
        spec.filter
    ))
    .bind(source)
    .fetch_all(&mut *conn)
    .await?;

    let mut insert: Vec<String> = vec![r#""id""#.into()];
    insert.extend(fixed.iter().map(|(c, _)| quoted(c)));
    insert.extend(spec.cols.iter().map(quoted));
    insert.extend(remap.iter().map(|(c, _)| quoted(c)));
    insert.extend(spec.stamps.iter().map(quoted));
    let sql = format!(
        r#"INSERT INTO "{}" ({}) VALUES ({})"#,
        spec.table,
        insert.join(", "),
        super::marks(insert.len())
    );

    let mut ids = IdMap::new();
    for row in &rows {
        let old: String = row.try_get(0)?;
        let new = new_id();
        let mut q = sqlx::query(&sql).bind(new.clone());
        for (_, v) in fixed {
            q = q.bind(*v);
        }
        for i in 0..spec.cols.len() {
            q = bind_cell(q, cell(row, 1 + i)?);
        }
        for (j, (_, map)) in remap.iter().enumerate() {
            let old_ref: Option<String> = row.try_get(1 + spec.cols.len() + j)?;
            q = q.bind(old_ref.and_then(|r| map.get(&r).cloned()));
        }
        for _ in spec.stamps {
            q = q.bind(now);
        }
        q.execute(&mut *conn).await?;
        ids.insert(old, new);
    }
    Ok(ids)
}

/// `cloneRackInto(db, sourceRackId, name)`: creates a copy of the rack
/// `source_rack_id` as `target` describes it. Runs on the caller's
/// connection (its `begin_immediate` transaction). An unknown source is
/// `sqlx::Error::RowNotFound` (arkyo threw), before anything is written.
pub async fn clone_rack_into(
    conn: &mut SqliteConnection,
    source_rack_id: &str,
    target: CloneTarget<'_>,
) -> Result<NewRack, sqlx::Error> {
    let rack_type: String = sqlx::query_scalar(r#"SELECT "rackType" FROM "Rack" WHERE "id" = ?"#)
        .bind(source_rack_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;
    let now = now_iso();
    let src = source_rack_id;
    let rack_spec = match target.scope {
        CloneScope::Full => &RACK_FULL,
        CloneScope::SlotsOnly => &RACK_SLOTS_ONLY,
    };
    let rack = copy_rows(
        conn,
        rack_spec,
        src,
        &[
            ("name", Some(target.name)),
            ("locationId", target.location_id),
        ],
        &[],
        &now,
    )
    .await?;
    let id = rack.get(src).cloned().ok_or(sqlx::Error::RowNotFound)?;
    let on_rack: [(&str, Option<&str>); 1] = [("rackId", Some(&id))];

    let counts = match target.scope {
        CloneScope::Full => copy_content(conn, src, &on_rack, &now).await?,
        CloneScope::SlotsOnly => copy_slots_only(conn, src, &id, &on_rack, &now).await?,
    };
    Ok(NewRack {
        id,
        name: target.name.to_string(),
        rack_type,
        counts,
    })
}

/// Steps 2 to 12 of `cloneRackInto`.
async fn copy_content(
    conn: &mut SqliteConnection,
    src: &str,
    on_rack: &[(&str, Option<&str>)],
    now: &str,
) -> Result<CloneCounts, sqlx::Error> {
    // 2. Inventory: hosts, then their components.
    let mut items = copy_rows(conn, &HOSTS, src, on_rack, &[], now).await?;
    let components = copy_rows(
        conn,
        &COMPONENTS,
        src,
        on_rack,
        &[("hostItemId", &items)],
        now,
    )
    .await?;
    items.extend(components);

    // 3. Slots, then 4. their parent (shelves): the parent must exist first.
    let slots = copy_rows(
        conn,
        &SLOTS_FULL,
        src,
        on_rack,
        &[("inventoryItemId", &items)],
        now,
    )
    .await?;
    let parents: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT "id", "parentSlotId" FROM "RackSlot"
           WHERE "rackId" = ? AND "parentSlotId" IS NOT NULL"#,
    )
    .bind(src)
    .fetch_all(&mut *conn)
    .await?;
    for (child, parent) in &parents {
        let (Some(child), Some(parent)) = (slots.get(child), slots.get(parent)) else {
            continue;
        };
        sqlx::query(r#"UPDATE "RackSlot" SET "parentSlotId" = ? WHERE "id" = ?"#)
            .bind(parent)
            .bind(child)
            .execute(&mut *conn)
            .await?;
    }

    // 5. Adapters, 6. bundles, 7. connections.
    let adapters = copy_rows(
        conn,
        &ADAPTERS,
        src,
        on_rack,
        &[("attachedSlotId", &slots)],
        now,
    )
    .await?;
    let bundles = copy_rows(conn, &BUNDLES, src, on_rack, &[], now).await?;
    let connections = copy_rows(
        conn,
        &CONNECTIONS,
        src,
        on_rack,
        &[
            ("fromSlotId", &slots),
            ("fromAdapterId", &adapters),
            ("fromComponentItemId", &items),
            ("toSlotId", &slots),
            ("toAdapterId", &adapters),
            ("toComponentItemId", &items),
            ("bundleId", &bundles),
        ],
        now,
    )
    .await?;

    // 8. Panel rows, 9. external ports (both through the slots).
    copy_rows(conn, &PANEL_ROWS, src, &[], &[("slotId", &slots)], now).await?;
    copy_rows(
        conn,
        &EXTERNAL_PORTS,
        src,
        on_rack,
        &[("slotId", &slots)],
        now,
    )
    .await?;

    // 10. Zones, 11. labels, 12. guides.
    for spec in [&ZONES, &LABELS, &GUIDES] {
        copy_rows(conn, spec, src, on_rack, &[], now).await?;
    }

    Ok(CloneCounts {
        slots: slots.len(),
        inventory: items.len(),
        connections: connections.len(),
        adapters: adapters.len(),
        bundles: bundles.len(),
    })
}

/// racks/route.ts:173-216: the slots, then one inventory item per
/// catalogue reference of the slots (quantity = slot count, in order of
/// first appearance), bound to the copied slots.
async fn copy_slots_only(
    conn: &mut SqliteConnection,
    src: &str,
    id: &str,
    on_rack: &[(&str, Option<&str>)],
    now: &str,
) -> Result<CloneCounts, sqlx::Error> {
    let slots = copy_rows(conn, &SLOTS_ONLY, src, on_rack, &[], now).await?;
    let refs: Vec<Option<String>> = sqlx::query_scalar(
        r#"SELECT "catalogEquipmentId" FROM "RackSlot" WHERE "rackId" = ? ORDER BY "createdAt", rowid"#,
    )
    .bind(src)
    .fetch_all(&mut *conn)
    .await?;
    let mut bom: Vec<(String, i64)> = Vec::new();
    for eq in refs.into_iter().flatten() {
        match bom.iter_mut().find(|(e, _)| *e == eq) {
            Some((_, n)) => *n += 1,
            None => bom.push((eq, 1)),
        }
    }
    for (equipment, quantity) in &bom {
        let item = new_id();
        sqlx::query(
            r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","quantity","createdAt","updatedAt")
               VALUES (?,?,?,?,?,?)"#,
        )
        .bind(&item)
        .bind(id)
        .bind(equipment)
        .bind(quantity)
        .bind(now)
        .bind(now)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            r#"UPDATE "RackSlot" SET "inventoryItemId" = ?
               WHERE "rackId" = ? AND "catalogEquipmentId" = ? AND "inventoryItemId" IS NULL"#,
        )
        .bind(&item)
        .bind(id)
        .bind(equipment)
        .execute(&mut *conn)
        .await?;
    }
    Ok(CloneCounts {
        slots: slots.len(),
        inventory: bom.len(),
        ..CloneCounts::default()
    })
}
