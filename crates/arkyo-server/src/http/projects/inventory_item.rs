//! arkyo:app/api/tenant/projects/[id]/racks/[rackId]/inventory/[itemId]/route.ts
//! (`PATCH`, `DELETE`) and …/[itemId]/transfer/route.ts (`POST`): one
//! inventory item of a project container.
//!
//! - `PATCH { hostSlotIndex }` moves a component within its host;
//!   `PATCH { quantity }` changes a row's quantity and re-syncs its ghost
//!   slots (`syncInventorySlots`).
//! - `DELETE` removes the item and its placements (`RackSlot`, and the
//!   cables with them), a host its components.
//! - `transfer` moves the item (and its components) to another container
//!   of the project, its slots purged and not re-synced (arkyo).
//!
//! Validation errors use `{ error: "Validation invalide", issues }`. Each
//! write is audited and publishes `rack_inventory updated` with
//! `{ projectId, rackId, itemId }` (twice for a transfer: source, then
//! target). The answers carry the raw `RackInventoryItem` row.
//!
//! arkyo-server:
//! - garde serveur alignée sur l'UI (`projects:write`, décision 4) ;
//! - mode fantôme SaaS retiré (`assertNotGhost`, no-op dans arkyo) ;
//! - lectures main d'abord / repli tenant des champs composant → lecture
//!   directe de `TenantEquipment` (snapshots SaaS retirés) ;
//! - une transaction `BEGIN IMMEDIATE` par requête, audit compris ; le
//!   `DELETE` d'arkyo n'en avait pas ;
//! - un corps JSON illisible donne 400 au `PATCH` (arkyo : 500 implicite,
//!   décision 5) ;
//! - `quantity` plafonnée à 999 (voir `inventory.rs`).

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::super::parametres::{
    begin, db_error, parse_body, row_map, validate_flat, Field, Kind, Obj,
};
use super::super::{error, require, server_error, AppState, CurrentUser};
use super::{invalid, issue, lenient_body, rack_in_project, zod_issues, PLAIN};
use crate::audit;
use crate::events::EventMeta;
use crate::ids::now_iso;
use crate::inventory::api::{
    resolve_component_equipment_fields, resolve_component_spans_batch, resolve_is_component_host,
};
use crate::inventory::sync::sync_inventory_slots;
use crate::users::User;

/// The scalars of the Prisma `RackInventoryItem` model, in the schema's
/// order (what `update` returns).
const ITEM_COLS: &str = r#""id", "rackId", "catalogEquipmentId", "panelId", "catalogAdapterId",
    "snapshotId", "accessoryType", "accessoryHeightU", "accessoryVariant", "accessoryDepthMm",
    "quantity", "notes", "hostItemId", "hostSlotIndex", "createdAt", "updatedAt""#;

/// `patchBodySchema` (route.ts:17-25), before its `refine`.
static PATCH: [Field; 2] = [
    // arkyo-server: plafond (une transaction SQLite verrouille toute la base, Postgres ne verrouillait que les lignes)
    Field::new(
        "quantity",
        Kind::IntRange(1, super::inventory::MAX_QUANTITY),
    ),
    Field::new("hostSlotIndex", Kind::IntMin(0)),
];
const REFINE_MSG: &str = "quantity ou hostSlotIndex requis";

/// `bodySchema` of transfer (transfer/route.ts:11-13).
static TRANSFER: [Field; 1] = [Field::new("targetRackId", Kind::NonEmpty).required()];

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Not found")
}

fn bad(msg: &str) -> Response {
    error(StatusCode::BAD_REQUEST, msg)
}

/// `assertItemBelongsToProjectRack`: the item is in `rack_id`, a rack of
/// the project.
async fn item_in_project_rack(
    conn: &mut SqliteConnection,
    item_id: &str,
    rack_id: &str,
    project_id: &str,
) -> Result<(), Response> {
    let found: Option<i64> =
        sqlx::query_scalar(r#"SELECT 1 FROM "RackInventoryItem" WHERE "id" = ? AND "rackId" = ?"#)
            .bind(item_id)
            .bind(rack_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(db_error)?;
    if found.is_none()
        || !rack_in_project(conn, rack_id, project_id)
            .await
            .map_err(db_error)?
    {
        return Err(not_found());
    }
    Ok(())
}

/// The raw row (Prisma scalars) of `item_id`.
async fn raw_item(conn: &mut SqliteConnection, item_id: &str) -> Result<Obj, Response> {
    let row = sqlx::query(&format!(
        r#"SELECT {ITEM_COLS} FROM "RackInventoryItem" WHERE "id" = ?"#
    ))
    .bind(item_id)
    .fetch_optional(conn)
    .await
    .map_err(db_error)?
    .ok_or_else(server_error)?;
    Ok(row_map(&row, &PLAIN))
}

/// `publishAppUpdate("rack_inventory", "updated", rackId, { projectId,
/// rackId, itemId })`.
fn publish(st: &AppState, project_id: &str, rack_id: &str, item_id: &str) {
    st.events.publish_meta(
        "rack_inventory",
        "updated",
        Some(rack_id),
        EventMeta {
            project_id: Some(project_id.to_string()),
            rack_id: Some(rack_id.to_string()),
            item_id: Some(item_id.to_string()),
            ..EventMeta::default()
        },
    );
}

/// Audit on the item; the commit is the caller's.
async fn audit_item(
    conn: &mut SqliteConnection,
    me: &User,
    action: &str,
    project_id: &str,
    item_id: &str,
    before: Option<Value>,
    after: Option<Value>,
) -> Result<(), Response> {
    audit::log(
        conn,
        &me.id,
        action,
        "RackInventoryItem",
        item_id,
        Some(project_id),
        before,
        after,
    )
    .await
    .map_err(db_error)
}

// ── PATCH /api/tenant/projects/:id/racks/:rackId/inventory/:itemId ──────────

pub async fn update(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((project_id, rack_id, item_id)): Path<(String, String, String)>,
    body: Bytes,
) -> Response {
    update_inner(&st, &me, &project_id, &rack_id, &item_id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn update_inner(
    st: &AppState,
    me: &User,
    project_id: &str,
    rack_id: &str,
    item_id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let mut tx = begin(&st.pool).await?;
    item_in_project_rack(&mut tx, item_id, rack_id, project_id).await?;
    let vals = validate_flat(&parse_body(&body)?, &PATCH)
        .map_err(|flat| invalid(StatusCode::BAD_REQUEST, zod_issues(&PATCH, flat)))?;
    let int = |k: &str| vals.get(k).and_then(Value::as_f64).map(|f| f as i64);
    let (quantity, host_slot_index) = (int("quantity"), int("hostSlotIndex"));
    if quantity.is_none() && host_slot_index.is_none() {
        return Err(invalid(
            StatusCode::BAD_REQUEST,
            vec![issue("root", REFINE_MSG)],
        ));
    }

    let (host_item_id, equipment_id): (Option<String>, Option<String>) = sqlx::query_as(
        r#"SELECT "hostItemId", "catalogEquipmentId" FROM "RackInventoryItem" WHERE "id" = ?"#,
    )
    .bind(item_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_error)?;
    let equipment_id = equipment_id.filter(|s| !s.is_empty());

    // ── A component moves within its host: { hostSlotIndex } wins ───────
    if let Some(new_start) = host_slot_index {
        let Some(host_item_id) = host_item_id else {
            return Err(bad("Seul un composant installé peut changer de slot"));
        };
        let host_eq: Option<Option<String>> = sqlx::query_scalar(
            r#"SELECT "catalogEquipmentId" FROM "RackInventoryItem" WHERE "id" = ?"#,
        )
        .bind(&host_item_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
        let host_fields = match host_eq.flatten().filter(|s| !s.is_empty()) {
            Some(eq) => resolve_component_equipment_fields(&mut tx, &eq)
                .await
                .map_err(db_error)?,
            None => None,
        };
        let slot_count = match host_fields {
            Some(f) if f.is_component_host => f.host_slot_count.filter(|n| *n != 0),
            _ => None,
        };
        let Some(slot_count) = slot_count else {
            return Err(bad("Châssis hôte introuvable"));
        };
        let span = match &equipment_id {
            Some(eq) => resolve_component_equipment_fields(&mut tx, eq)
                .await
                .map_err(db_error)?
                .map_or(1, |f| f.component_slot_span),
            None => 1,
        };
        let new_end = new_start + span;
        if new_end > slot_count {
            return Err(bad("Composant hors des limites de l'équipement modulaire"));
        }
        let siblings: Vec<(Option<i64>, Option<String>)> = sqlx::query_as(
            r#"SELECT "hostSlotIndex", "catalogEquipmentId" FROM "RackInventoryItem"
               WHERE "hostItemId" = ? AND "id" <> ?"#,
        )
        .bind(&host_item_id)
        .bind(item_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_error)?;
        let eq_ids: Vec<String> = siblings
            .iter()
            .filter_map(|(_, e)| e.clone().filter(|s| !s.is_empty()))
            .collect();
        let spans = resolve_component_spans_batch(&mut tx, &eq_ids)
            .await
            .map_err(db_error)?;
        for (index, eq) in &siblings {
            let Some(start) = *index else { continue };
            let c_span = eq
                .as_deref()
                .and_then(|e| spans.get(e))
                .copied()
                .unwrap_or(1);
            if new_start < start + c_span && start < new_end {
                return Err(error(StatusCode::CONFLICT, "Slot occupé"));
            }
        }

        sqlx::query(
            r#"UPDATE "RackInventoryItem" SET "hostSlotIndex" = ?, "updatedAt" = ? WHERE "id" = ?"#,
        )
        .bind(new_start)
        .bind(now_iso())
        .bind(item_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        let item = raw_item(&mut tx, item_id).await?;
        audit_item(
            &mut tx,
            me,
            "update_inventory_item",
            project_id,
            item_id,
            None,
            Some(json!({ "hostSlotIndex": new_start })),
        )
        .await?;
        tx.commit().await.map_err(db_error)?;
        publish(st, project_id, rack_id, item_id);
        return Ok(Json(json!({ "item": item })).into_response());
    }

    // ── Quantity: { quantity } ──────────────────────────────────────────
    // A component installed in a host is always quantity 1.
    if host_item_id.is_some() {
        return Err(bad("La quantité d'un composant installé est fixe"));
    }
    // A host chassis is added unit by unit, never merged.
    if let Some(eq) = &equipment_id {
        if resolve_is_component_host(&mut tx, eq)
            .await
            .map_err(db_error)?
        {
            return Err(bad(
                "Un châssis s'ajoute par exemplaire — ajoutez ou supprimez des exemplaires.",
            ));
        }
    }
    sqlx::query(r#"UPDATE "RackInventoryItem" SET "quantity" = ?, "updatedAt" = ? WHERE "id" = ?"#)
        .bind(quantity)
        .bind(now_iso())
        .bind(item_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    let item = raw_item(&mut tx, item_id).await?;
    // Ghost slots of an equipment or a panel (route.ts:198-203).
    // arkyo-server: un échec de synchro annule la requête (500) ; arkyo l'ignorait.
    let has_slots = |k: &str| {
        item.get(k)
            .and_then(Value::as_str)
            .is_some_and(|s| !s.is_empty())
    };
    if has_slots("catalogEquipmentId") || has_slots("panelId") {
        sync_inventory_slots(&mut tx, item_id)
            .await
            .map_err(db_error)?;
    }
    audit_item(
        &mut tx,
        me,
        "update_inventory_item",
        project_id,
        item_id,
        None,
        Some(json!({ "quantity": item["quantity"] })),
    )
    .await?;
    tx.commit().await.map_err(db_error)?;
    publish(st, project_id, rack_id, item_id);
    Ok(Json(json!({ "item": item })).into_response())
}

// ── DELETE /api/tenant/projects/:id/racks/:rackId/inventory/:itemId ─────────

pub async fn remove(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((project_id, rack_id, item_id)): Path<(String, String, String)>,
) -> Response {
    remove_inner(&st, &me, &project_id, &rack_id, &item_id)
        .await
        .unwrap_or_else(|r| r)
}

async fn remove_inner(
    st: &AppState,
    me: &User,
    project_id: &str,
    rack_id: &str,
    item_id: &str,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let mut tx = begin(&st.pool).await?;
    item_in_project_rack(&mut tx, item_id, rack_id, project_id).await?;

    // The inventory is the source of truth: its placements go with it
    // (`RackSlot.inventoryItemId` is SET NULL), their cables by cascade.
    // arkyo-server: correction (les slots des composants partent aussi ;
    // arkyo ne purgeait que ceux de l'item, un slot de composant serait
    // resté orphelin).
    sqlx::query(
        r#"DELETE FROM "RackSlot" WHERE "inventoryItemId" = ?
               OR "inventoryItemId" IN (SELECT "id" FROM "RackInventoryItem" WHERE "hostItemId" = ?)"#,
    )
    .bind(item_id)
    .bind(item_id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    // Components (`hostItemId`) and their cables go by cascade.
    sqlx::query(r#"DELETE FROM "RackInventoryItem" WHERE "id" = ?"#)
        .bind(item_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;

    audit_item(
        &mut tx,
        me,
        "delete_inventory_item",
        project_id,
        item_id,
        Some(json!({ "rackId": rack_id, "itemId": item_id })),
        None,
    )
    .await?;
    tx.commit().await.map_err(db_error)?;
    publish(st, project_id, rack_id, item_id);
    Ok(Json(json!({ "ok": true })).into_response())
}

// ── POST …/inventory/:itemId/transfer ───────────────────────────────────────

pub async fn transfer(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((project_id, rack_id, item_id)): Path<(String, String, String)>,
    body: Bytes,
) -> Response {
    transfer_inner(&st, &me, &project_id, &rack_id, &item_id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn transfer_inner(
    st: &AppState,
    me: &User,
    project_id: &str,
    rack_id: &str,
    item_id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let mut tx = begin(&st.pool).await?;
    item_in_project_rack(&mut tx, item_id, rack_id, project_id).await?;
    let vals = validate_flat(&lenient_body(&body), &TRANSFER)
        .map_err(|flat| invalid(StatusCode::BAD_REQUEST, zod_issues(&TRANSFER, flat)))?;
    let target = vals
        .get("targetRackId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    // Any rack of the project, a location's virtual rack included
    // (« équipements libres »). arkyo does not refuse the source rack.
    if !rack_in_project(&mut tx, &target, project_id)
        .await
        .map_err(db_error)?
    {
        return Err(not_found());
    }

    // Cabling guard: no RackConnection on the item's slots or its
    // components, no ExternalPort on its slots (transfer/route.ts:87-124).
    let cabled: i64 = sqlx::query_scalar(
        r#"SELECT
             (SELECT COUNT(*) FROM "RackConnection" c
               WHERE c."fromSlotId" IN (SELECT "id" FROM "RackSlot" WHERE "inventoryItemId" = ?1)
                  OR c."toSlotId" IN (SELECT "id" FROM "RackSlot" WHERE "inventoryItemId" = ?1)
                  OR c."fromComponentItemId" IN (SELECT "id" FROM "RackInventoryItem" WHERE "hostItemId" = ?1)
                  OR c."toComponentItemId" IN (SELECT "id" FROM "RackInventoryItem" WHERE "hostItemId" = ?1))
           + (SELECT COUNT(*) FROM "ExternalPort" e
               WHERE e."slotId" IN (SELECT "id" FROM "RackSlot" WHERE "inventoryItemId" = ?1))"#,
    )
    .bind(item_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_error)?;
    if cabled > 0 {
        return Err(error(
            StatusCode::CONFLICT,
            "Décâblez cet équipement avant de le déplacer.",
        ));
    }

    // Slots purged (the item is « à placer » again in the target), the
    // components follow their host. No re-sync, as in arkyo.
    sqlx::query(
        r#"DELETE FROM "RackSlot" WHERE "inventoryItemId" = ?1
               OR "inventoryItemId" IN (SELECT "id" FROM "RackInventoryItem" WHERE "hostItemId" = ?1)"#,
    )
    .bind(item_id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    let now = now_iso();
    sqlx::query(
        r#"UPDATE "RackInventoryItem" SET "rackId" = ?, "updatedAt" = ?
           WHERE "id" = ? OR "hostItemId" = ?"#,
    )
    .bind(&target)
    .bind(&now)
    .bind(item_id)
    .bind(item_id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    let item = raw_item(&mut tx, item_id).await?;

    audit_item(
        &mut tx,
        me,
        "transfer_inventory_item",
        project_id,
        item_id,
        Some(json!({ "rackId": rack_id })),
        Some(json!({ "targetRackId": target })),
    )
    .await?;
    tx.commit().await.map_err(db_error)?;
    publish(st, project_id, rack_id, item_id);
    publish(st, project_id, &target, item_id);
    Ok(Json(json!({ "item": item })).into_response())
}
