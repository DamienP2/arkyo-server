//! arkyo:lib/services/rack-inventory-sync.ts: inventory rows ↔ rack slots.
//!
//! Each `RackInventoryItem` of an equipment (`catalogEquipmentId`) or a panel
//! (`panelId`) has exactly `quantity` `RackSlot`s linked by
//! `inventoryItemId`. The slots created here are "ghosts" (`startU` and
//! `heightU` null): drawn in the synoptic, not in the physical rack view.
//! Adapters and accessories are left alone.
//!
//! "Ghost" here is this phantom slot, not arkyo's SaaS ghost mode.
//!
//! Slot order (arkyo's Prisma reads have none): creation order, `createdAt`
//! then `rowid`.

use sqlx::SqliteConnection;

use crate::ids::{new_id, now_iso};
use crate::inventory::auto_label::generate_unique_label;

/// `SyncResult`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SyncResult {
    /// Ghost slots created.
    pub created: Vec<String>,
    /// Slots deleted.
    pub deleted: Vec<String>,
    /// arkyo's warnings (deleted despite connections, or placed).
    pub warnings: Vec<String>,
}

/// The catalogue reference of a slot that gets ghosts (`InventoryRef` of
/// rack-inventory-sync.ts).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GhostRef {
    Equipment(String),
    Panel(String),
}

impl GhostRef {
    /// The column of `refClause`.
    fn column(&self) -> &'static str {
        match self {
            Self::Equipment(_) => "catalogEquipmentId",
            Self::Panel(_) => "panelId",
        }
    }

    fn id(&self) -> &str {
        match self {
            Self::Equipment(id) | Self::Panel(id) => id,
        }
    }
}

/// A ghost slot ready to be placed (`findClaimableGhostSlot`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GhostSlot {
    pub id: String,
    pub inventory_item_id: String,
}

/// `ensureGhostSlotForRef`'s answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnsuredGhost {
    pub slot_id: String,
    pub inventory_item_id: String,
    /// The inventory quantity was raised (or the row created): the caller
    /// publishes the inventory events.
    pub quantity_incremented: bool,
}

#[derive(sqlx::FromRow)]
#[sqlx(rename_all = "camelCase")]
struct LinkedSlot {
    id: String,
    start_u: Option<i64>,
    conn_from: i64,
    conn_to: i64,
}

/// `syncInventorySlots(db, inventoryItemId)`. Grows with ghosts labelled
/// `#XXXX` (unique among the rack's labels); shrinks in arkyo's order:
/// ghosts without connections, ghosts with connections, placed slots without
/// connections, placed slots with connections (their connections go with
/// them, `ON DELETE CASCADE`). Unknown items, adapters and accessories give
/// an empty result.
pub async fn sync_inventory_slots(
    conn: &mut SqliteConnection,
    inventory_item_id: &str,
) -> Result<SyncResult, sqlx::Error> {
    let mut result = SyncResult::default();
    let item: Option<(String, Option<String>, Option<String>, i64)> = sqlx::query_as(
        r#"SELECT "rackId", "catalogEquipmentId", "panelId", "quantity"
           FROM "RackInventoryItem" WHERE "id" = ?"#,
    )
    .bind(inventory_item_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((rack_id, equipment_id, panel_id, target)) = item else {
        return Ok(result);
    };
    let r = match (
        equipment_id.filter(|s| !s.is_empty()),
        panel_id.filter(|s| !s.is_empty()),
    ) {
        (Some(e), _) => GhostRef::Equipment(e),
        (None, Some(p)) => GhostRef::Panel(p),
        (None, None) => return Ok(result),
    };

    let existing: Vec<LinkedSlot> = sqlx::query_as(
        r#"SELECT s."id", s."startU",
             (SELECT COUNT(*) FROM "RackConnection" c WHERE c."fromSlotId" = s."id") AS "connFrom",
             (SELECT COUNT(*) FROM "RackConnection" c WHERE c."toSlotId" = s."id") AS "connTo"
           FROM "RackSlot" s WHERE s."inventoryItemId" = ?
           ORDER BY s."createdAt", s.rowid"#,
    )
    .bind(inventory_item_id)
    .fetch_all(&mut *conn)
    .await?;
    let current = existing.len() as i64;
    if current == target {
        return Ok(result);
    }

    if current < target {
        // Every label of the rack (other items, placed slots) to avoid
        // collisions.
        let labels: Vec<Option<String>> =
            sqlx::query_scalar(r#"SELECT "label" FROM "RackSlot" WHERE "rackId" = ?"#)
                .bind(&rack_id)
                .fetch_all(&mut *conn)
                .await?;
        let mut used: std::collections::HashSet<String> = labels
            .into_iter()
            .flatten()
            .filter(|l| !l.is_empty())
            .collect();
        let sql = format!(
            r#"INSERT INTO "RackSlot" ("id", "rackId", "{}", "inventoryItemId", "label",
                 "startU", "heightU", "view", "widthFraction", "column", "synopticX", "synopticY",
                 "createdAt", "updatedAt")
               VALUES (?, ?, ?, ?, ?, NULL, NULL, 'FRONT', 'FULL', 0, NULL, NULL, ?, ?)"#,
            r.column()
        );
        for _ in 0..(target - current) {
            let label = generate_unique_label(&used);
            used.insert(label.clone());
            let id = new_id();
            let now = now_iso();
            sqlx::query(&sql)
                .bind(&id)
                .bind(&rack_id)
                .bind(r.id())
                .bind(inventory_item_id)
                .bind(&label)
                .bind(&now)
                .bind(&now)
                .execute(&mut *conn)
                .await?;
            result.created.push(id);
        }
        return Ok(result);
    }

    let to_delete = (current - target.max(0)) as usize;
    let has_conn = |s: &LinkedSlot| s.conn_from + s.conn_to > 0;
    let bucket = |s: &LinkedSlot| match (s.start_u.is_some(), has_conn(s)) {
        (false, false) => 0,
        (false, true) => 1,
        (true, false) => 2,
        (true, true) => 3,
    };
    let mut candidates: Vec<&LinkedSlot> = existing.iter().collect();
    candidates.sort_by_key(|s| bucket(s)); // stable: creation order within a bucket
    for slot in candidates.into_iter().take(to_delete) {
        if has_conn(slot) {
            result.warnings.push(format!(
                "Slot {} supprimé malgré {} connexion(s).",
                slot.id,
                slot.conn_from + slot.conn_to
            ));
        } else if let Some(u) = slot.start_u {
            result.warnings.push(format!(
                "Slot placé {} (U{u}) supprimé — quantité réduite.",
                slot.id
            ));
        }
        sqlx::query(r#"DELETE FROM "RackSlot" WHERE "id" = ?"#)
            .bind(&slot.id)
            .execute(&mut *conn)
            .await?;
        result.deleted.push(slot.id.clone());
    }
    Ok(result)
}

/// `findClaimableGhostSlot(db, rackId, ref)`: the oldest ghost slot of the
/// rack for this reference that belongs to an inventory row.
pub async fn find_claimable_ghost_slot(
    conn: &mut SqliteConnection,
    rack_id: &str,
    r: &GhostRef,
) -> Result<Option<GhostSlot>, sqlx::Error> {
    let row: Option<(String, String)> = sqlx::query_as(&format!(
        r#"SELECT "id", "inventoryItemId" FROM "RackSlot"
           WHERE "rackId" = ? AND "{}" = ? AND "startU" IS NULL AND "inventoryItemId" IS NOT NULL
           ORDER BY "createdAt", rowid LIMIT 1"#,
        r.column()
    ))
    .bind(rack_id)
    .bind(r.id())
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|(id, inventory_item_id)| GhostSlot {
        id,
        inventory_item_id,
    }))
}

/// `ensureGhostSlotForRef(db, rackId, ref)`: a ghost slot to place. The
/// oldest free one, or else the inventory row of the reference (created
/// with quantity 1, or raised by 1) is synced and its new ghost returned.
///
/// arkyo's degenerate case (the sync made no ghost, e.g. more placed slots
/// than the quantity) is an `sqlx::Error::Protocol` with arkyo's message.
pub async fn ensure_ghost_slot_for_ref(
    conn: &mut SqliteConnection,
    rack_id: &str,
    r: &GhostRef,
) -> Result<EnsuredGhost, sqlx::Error> {
    if let Some(g) = find_claimable_ghost_slot(conn, rack_id, r).await? {
        return Ok(EnsuredGhost {
            slot_id: g.id,
            inventory_item_id: g.inventory_item_id,
            quantity_incremented: false,
        });
    }

    let col = r.column();
    let existing: Option<String> = sqlx::query_scalar(&format!(
        r#"SELECT "id" FROM "RackInventoryItem" WHERE "rackId" = ? AND "{col}" = ?
           ORDER BY "createdAt", rowid LIMIT 1"#
    ))
    .bind(rack_id)
    .bind(r.id())
    .fetch_optional(&mut *conn)
    .await?;
    let now = now_iso();
    let item_id = match existing {
        Some(id) => {
            sqlx::query(
                r#"UPDATE "RackInventoryItem" SET "quantity" = "quantity" + 1, "updatedAt" = ?
                   WHERE "id" = ?"#,
            )
            .bind(&now)
            .bind(&id)
            .execute(&mut *conn)
            .await?;
            id
        }
        None => {
            let id = new_id();
            sqlx::query(&format!(
                r#"INSERT INTO "RackInventoryItem" ("id", "rackId", "{col}", "quantity", "createdAt", "updatedAt")
                   VALUES (?, ?, ?, 1, ?, ?)"#
            ))
            .bind(&id)
            .bind(rack_id)
            .bind(r.id())
            .bind(&now)
            .bind(&now)
            .execute(&mut *conn)
            .await?;
            id
        }
    };

    sync_inventory_slots(conn, &item_id).await?;

    match find_claimable_ghost_slot(conn, rack_id, r).await? {
        Some(g) => Ok(EnsuredGhost {
            slot_id: g.id,
            inventory_item_id: g.inventory_item_id,
            quantity_incremented: true,
        }),
        None => {
            let what = match r {
                GhostRef::Equipment(_) => "l'équipement",
                GhostRef::Panel(_) => "le panel",
            };
            Err(sqlx::Error::Protocol(format!(
                "Impossible de créer un slot fantôme pour {what} {} dans le rack {rack_id}.",
                r.id()
            )))
        }
    }
}

/// `ensureGhostSlotForEquipment`.
pub async fn ensure_ghost_slot_for_equipment(
    conn: &mut SqliteConnection,
    rack_id: &str,
    catalog_equipment_id: &str,
) -> Result<EnsuredGhost, sqlx::Error> {
    ensure_ghost_slot_for_ref(
        conn,
        rack_id,
        &GhostRef::Equipment(catalog_equipment_id.to_string()),
    )
    .await
}

/// `ensureGhostSlotForPanel`.
pub async fn ensure_ghost_slot_for_panel(
    conn: &mut SqliteConnection,
    rack_id: &str,
    panel_id: &str,
) -> Result<EnsuredGhost, sqlx::Error> {
    ensure_ghost_slot_for_ref(conn, rack_id, &GhostRef::Panel(panel_id.to_string())).await
}
