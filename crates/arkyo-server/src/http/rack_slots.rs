//! Rack slots: arkyo:app/api/racks/[id]/slots/route.ts (`POST` places,
//! `DELETE` clears the rack) and arkyo:app/api/racks/[id]/slots/[slotId]/route.ts
//! (`PATCH` moves or edits, `DELETE` removes).
//!
//! BOM ↔ placement coupling (arkyo's « Vague 5C »): an equipment or a panel
//! placed outside a shelf claims a ghost slot of the rack's inventory
//! ([`sync::ensure_ghost_slot_for_ref`]), raising the inventory by one when
//! there is none; removing an inventory slot turns it back into a ghost
//! (`startU` null), the inventory is never lowered here. Shelf children,
//! accessories and legacy slots are plain rows.
//!
//! No server-side collision check, as in arkyo: the canvas refuses occupied
//! or overflowing positions before posting (`findFreeColForWf` and the
//! `totalU` checks of rack-placement-canvas.tsx). The route only enforces
//! the Zod schema (`startU >= 1`, `column` 0..3, `heightU > 0`, the enums).
//!
//! Events: rack bus `slot_added` / `slot_updated` (`{type, slot}`),
//! `slot_removed` (`{type, slotId, removedAdapterIds}`), `rack_cleared`;
//! app bus `slot created|updated|deleted` with `{rackId, itemId?, clientId}`
//! and, when the placement raised the inventory, `rack_inventory updated`.
//!
//! arkyo-server:
//! - catalogue lu en local (`TenantEquipment`, `TenantBrand`) au lieu de
//!   `mainDb`, sans repli : l'équipement d'un slot a la forme d'arkyo
//!   `{id, name, reference, heightU, widthFraction, brand}` ;
//! - mode fantôme SaaS retiré (`assertNotGhost`, 403 « Mode lecture seule ») ;
//! - garde serveur `design:write` (arkyo : session seule) ;
//! - une transaction `BEGIN IMMEDIATE` par requête, audit compris (arkyo :
//!   écritures séquentielles sans transaction, audit hors bloc) ;
//! - 400/404 au lieu des 500 implicites : corps illisible, rack ou slot
//!   inconnu, référence (`panelId`, `inventoryItemId`) inconnue ;
//! - plafond de la quantité d'inventaire (999) quand la pose l'augmente.

#![allow(clippy::result_large_err)]

use std::collections::BTreeMap;

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{patch, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::parametres::{
    begin, bind, db_error, failure, parse_body, row_map, str_of, validate_flat, Def, Field, Kind,
    Obj, Table,
};
use super::projects::inventory::{quantity_too_big, MAX_QUANTITY};
use super::projects::PLAIN;
use super::{client_id, error, require, AppState, CurrentUser};
use crate::audit;
use crate::events::EventMeta;
use crate::ids::{new_id, now_iso};
use crate::inventory::sync::{self, GhostError, GhostRef};
use crate::projects::enrich::RACK_SLOT;
use crate::users::User;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/racks/{id}/slots", post(create).delete(clear))
        .route("/racks/{id}/slots/{slot_id}", patch(update).delete(remove))
}

const VIEWS: &[&str] = &["FRONT", "REAR", "REAR_INTERIOR", "SIDE"];
const VIEW_MSG: &str = r#"Invalid option: expected one of "FRONT"|"REAR"|"REAR_INTERIOR"|"SIDE""#;
const WIDTHS: &[&str] = &["FULL", "HALF", "THIRD", "QUARTER"];
const WIDTH_MSG: &str = r#"Invalid option: expected one of "FULL"|"HALF"|"THIRD"|"QUARTER""#;

/// The `.refine` of `createSchema` (route.ts:32-34).
const REFINE_MSG: &str = "catalogEquipmentId, panelId, or (label + heightU) required";

/// `createSchema` (route.ts:12-34).
static CREATE: [Field; 12] = [
    Field::new("catalogEquipmentId", Kind::NonEmpty),
    // legacy compat
    Field::new("equipmentId", Kind::NonEmpty),
    Field::new("panelId", Kind::NonEmpty),
    Field::new("parentSlotId", Kind::NonEmpty),
    Field::new("inventoryItemId", Kind::NonEmpty),
    Field::new("view", Kind::Enum(VIEWS, VIEW_MSG)).or(Def::Str("FRONT")),
    Field::new("startU", Kind::IntMin(1)).required(),
    Field::new("heightU", Kind::NumPos),
    Field::new("widthFraction", Kind::Enum(WIDTHS, WIDTH_MSG)).or(Def::Str("FULL")),
    Field::new("column", Kind::IntRange(0, 3)).or(Def::Zero),
    Field::new("label", Kind::Str),
    Field::new("notes", Kind::Str),
];

/// `updateSchema` ([slotId]/route.ts:11-21); `panelLabels` is a
/// `z.record(z.string(), z.unknown())`, checked by [`parse_update`].
static UPDATE: [Field; 9] = [
    Field::new("startU", Kind::IntMin(1)),
    Field::new("view", Kind::Enum(VIEWS, VIEW_MSG)),
    Field::new("widthFraction", Kind::Enum(WIDTHS, WIDTH_MSG)),
    Field::new("column", Kind::IntRange(0, 3)),
    Field::new("label", Kind::Str).nullable(),
    Field::new("notes", Kind::Str).nullable(),
    Field::new("panelLabels", Kind::Any).nullable(),
    Field::new("synopticX", Kind::Num).nullable(),
    Field::new("synopticY", Kind::Num).nullable(),
];

/// The columns a placement writes from the body (`...rest` of route.ts:177),
/// `heightU` apart.
const PLACEMENT_COLS: [&str; 7] = [
    "inventoryItemId",
    "view",
    "startU",
    "widthFraction",
    "column",
    "label",
    "notes",
];

/// The fields a removed slot loses to become a ghost (route.ts:89-98,
/// [slotId]/route.ts:197-208); `panelLabels` gets SQL `NULL`
/// (`Prisma.DbNull`).
const GHOST_SET: &str = r#""startU" = NULL, "heightU" = NULL, "column" = 0, "label" = NULL,
    "notes" = NULL, "patchNotes" = NULL, "panelLabels" = NULL, "synopticX" = NULL,
    "synopticY" = NULL"#;

/// `slotSelect` (route.ts:177-207) scalars, in the select's order.
const SLOT_COLS: &str = r#""id", "rackId", "catalogEquipmentId", "panelId", "parentSlotId",
    "view", "startU", "heightU", "widthFraction", "column", "label", "notes", "patchNotes",
    "panelLabels", "synopticX", "synopticY", "createdAt", "updatedAt""#;

const PANEL_SLOT: Table = Table {
    name: "PanelSlot",
    bools: &["mountD"],
    jsons: &[],
};

fn rack_not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Not found")
}

/// arkyo's message of `DELETE /slots/:slotId` (route.ts:170), also used for
/// the unknown slot of `PATCH` (arkyo: Prisma P2025, implicit 500).
fn slot_not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Slot introuvable")
}

/// A write failing on a foreign key (unknown `panelId` or
/// `inventoryItemId`) is the client's reference: 400, as the settings
/// routes; anything else is a logged 500.
fn write_error(e: sqlx::Error) -> Response {
    if let sqlx::Error::Database(d) = &e {
        if d.is_foreign_key_violation() {
            return error(StatusCode::BAD_REQUEST, "Référence introuvable.");
        }
    }
    db_error(e)
}

fn ghost_error(e: GhostError) -> Response {
    match e {
        GhostError::NoGhost(ref msg) => error(e.status(), msg),
        GhostError::Db(e) => write_error(e),
    }
}

async fn rack_exists(conn: &mut SqliteConnection, id: &str) -> Result<bool, Response> {
    let found: Option<i64> = sqlx::query_scalar(r#"SELECT 1 FROM "Rack" WHERE "id" = ?"#)
        .bind(id)
        .fetch_optional(conn)
        .await
        .map_err(db_error)?;
    Ok(found.is_some())
}

// ── the slot as arkyo returns it ────────────────────────────────────────────

/// `slotSelect` + `{ ...slot, equipment }` (route.ts:177-275): the scalars
/// (no `inventoryItemId`, no `snapshotId`), `panel` (`panelInclude`),
/// `children` and the catalogue `equipment`.
async fn slot_dto(conn: &mut SqliteConnection, id: &str) -> Result<Option<Obj>, sqlx::Error> {
    let row = sqlx::query(&format!(
        r#"SELECT {SLOT_COLS} FROM "RackSlot" WHERE "id" = ?"#
    ))
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let mut slot = row_map(&row, &RACK_SLOT);

    // panelInclude (route.ts:36-55).
    let panel = match str_of(&slot, "panelId").map(str::to_string) {
        Some(pid) => {
            let p = sqlx::query(
                r#"SELECT "id", "name", "heightU", "slotsPerU", "rearCableDepthMm"
                   FROM "Panel" WHERE "id" = ?"#,
            )
            .bind(&pid)
            .fetch_optional(&mut *conn)
            .await?;
            match p {
                Some(p) => {
                    let mut p = row_map(&p, &PLAIN);
                    let slots: Vec<Value> = sqlx::query(
                        r#"SELECT "id", "position", "sizeSlots", "label", "notes",
                             "catalogConnectorTypeId", "mountD"
                           FROM "PanelSlot" WHERE "panelId" = ? ORDER BY rowid"#,
                    )
                    .bind(&pid)
                    .fetch_all(&mut *conn)
                    .await?
                    .iter()
                    .map(|r| Value::Object(row_map(r, &PANEL_SLOT)))
                    .collect();
                    p.insert("slots".into(), Value::Array(slots));
                    Value::Object(p)
                }
                None => Value::Null,
            }
        }
        None => Value::Null,
    };
    slot.insert("panel".into(), panel);

    let children: Vec<Value> = sqlx::query(
        r#"SELECT "id", "catalogEquipmentId", "heightU", "widthFraction", "synopticX", "synopticY"
           FROM "RackSlot" WHERE "parentSlotId" = ? ORDER BY "createdAt", rowid"#,
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?
    .iter()
    .map(|r| Value::Object(row_map(r, &PLAIN)))
    .collect();
    slot.insert("children".into(), Value::Array(children));

    let equipment = match str_of(&slot, "catalogEquipmentId").map(str::to_string) {
        Some(eid) => equipment_lite(conn, &eid).await?,
        None => Value::Null,
    };
    slot.insert("equipment".into(), equipment);
    Ok(Some(slot))
}

/// `{id, name, reference, heightU, widthFraction, brand: {id, name} | null}`
/// (route.ts:262-275), from the local catalogue; `null` when unknown.
async fn equipment_lite(conn: &mut SqliteConnection, id: &str) -> Result<Value, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT "id", "name", "reference", "heightU", "widthFraction", "brandId"
           FROM "TenantEquipment" WHERE "id" = ?"#,
    )
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(row) = row else {
        return Ok(Value::Null);
    };
    let mut eq = row_map(&row, &PLAIN);
    let brand = match eq
        .remove("brandId")
        .and_then(|v| v.as_str().map(str::to_string))
    {
        Some(bid) => sqlx::query(r#"SELECT "id", "name" FROM "TenantBrand" WHERE "id" = ?"#)
            .bind(&bid)
            .fetch_optional(&mut *conn)
            .await?
            .map_or(Value::Null, |r| Value::Object(row_map(&r, &PLAIN))),
        None => Value::Null,
    };
    eq.insert("brand".into(), brand);
    Ok(Value::Object(eq))
}

// ── POST /api/racks/:id/slots ───────────────────────────────────────────────

pub async fn create(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(rack_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    create_inner(&st, &me, &rack_id, &headers, body)
        .await
        .unwrap_or_else(|r| r)
}

/// `createSchema.safeParse(body)`: the sent fields with the schema's
/// defaults; the `.refine` only runs on an otherwise valid body (Zod).
fn parse_create(body: &Value) -> Result<Obj, Response> {
    let mut vals = validate_flat(body, &CREATE).map_err(failure)?;
    let has = |k: &str| str_of(&vals, k).is_some_and(|s| !s.is_empty());
    let accessory = has("label") && vals.get("heightU").is_some();
    if !(has("catalogEquipmentId") || has("equipmentId") || has("panelId") || accessory) {
        return Err(failure((vec![REFINE_MSG.into()], BTreeMap::new())));
    }
    for f in &CREATE {
        if !vals.contains_key(f.name) && !matches!(f.default, Def::Null) {
            vals.insert(f.name.into(), f.default.value());
        }
    }
    Ok(vals)
}

/// Whether the parent's `notes` is a shelf's metadata
/// (`JSON.parse(notes ?? "{}").accessoryType === "etagere"`, route.ts:163-170).
fn is_shelf(notes: Option<&str>) -> bool {
    serde_json::from_str::<Value>(notes.unwrap_or("{}"))
        .ok()
        .and_then(|v| v.get("accessoryType").cloned())
        == Some(json!("etagere"))
}

async fn create_inner(
    st: &AppState,
    me: &User,
    rack_id: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    let vals = parse_create(&parse_body(&body)?)?;
    let get = |k: &str| str_of(&vals, k).map(str::to_string);
    // Normalise legacy equipmentId → catalogEquipmentId (route.ts:140).
    let equipment_id = get("catalogEquipmentId").or_else(|| get("equipmentId"));
    let panel_id = get("panelId");
    let parent_slot_id = get("parentSlotId");

    let mut tx = begin(&st.pool).await?;
    // arkyo-server: un rack inconnu donne 404 « Not found » ; arkyo
    // échouait sur une clé étrangère (500).
    if !rack_exists(&mut tx, rack_id).await? {
        return Err(rack_not_found());
    }

    // heightU: the body's, else the catalogue's or the panel's, else 1
    // (route.ts:142-154).
    let height_u: Value = match vals.get("heightU") {
        Some(h) => h.clone(),
        None => {
            let (sql, id) = match (&equipment_id, &panel_id) {
                (Some(e), _) => (
                    r#"SELECT "heightU" FROM "TenantEquipment" WHERE "id" = ?"#,
                    e,
                ),
                (None, Some(p)) => (r#"SELECT "heightU" FROM "Panel" WHERE "id" = ?"#, p),
                // The refine guarantees heightU for an accessory.
                (None, None) => return Err(failure((vec![REFINE_MSG.into()], BTreeMap::new()))),
            };
            let h: Option<Option<i64>> = sqlx::query_scalar(sql)
                .bind(id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db_error)?;
            Value::from(h.flatten().unwrap_or(1))
        }
    };

    // parentSlotId: a shelf of this rack, 10 children at most (route.ts:157-175).
    if let Some(parent) = &parent_slot_id {
        let row: Option<(Option<String>, i64)> = sqlx::query_as(
            r#"SELECT p."notes", (SELECT COUNT(*) FROM "RackSlot" c WHERE c."parentSlotId" = p."id")
               FROM "RackSlot" p WHERE p."id" = ? AND p."rackId" = ?"#,
        )
        .bind(parent)
        .bind(rack_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
        let Some((notes, children)) = row else {
            return Err(error(StatusCode::BAD_REQUEST, "Parent shelf not found"));
        };
        if !is_shelf(notes.as_deref()) {
            return Err(error(StatusCode::BAD_REQUEST, "Parent slot is not a shelf"));
        }
        if children >= 10 {
            return Err(error(
                StatusCode::BAD_REQUEST,
                "Maximum 10 équipements par étagère",
            ));
        }
    }

    let sent: Vec<&str> = PLACEMENT_COLS
        .into_iter()
        .filter(|c| vals.contains_key(*c))
        .collect();
    let now = now_iso();

    // Couplage BOM ↔ placement (route.ts:209-259).
    let ghost_ref = match (&equipment_id, &panel_id, &parent_slot_id) {
        (Some(e), _, None) => Some(GhostRef::Equipment(e.clone())),
        (None, Some(p), None) => Some(GhostRef::Panel(p.clone())),
        _ => None,
    };
    let mut claimed: Option<sync::EnsuredGhost> = None;
    let slot_id = match &ghost_ref {
        Some(r) => {
            cap_inventory(&mut tx, rack_id, r).await?;
            let ghost = sync::ensure_ghost_slot_for_ref(&mut tx, rack_id, r)
                .await
                .map_err(ghost_error)?;
            // Mutates the ghost: the body's placement (defaults included)
            // and the resolved height.
            let sets: String = sent.iter().map(|c| format!(r#", "{c}" = ?"#)).collect();
            let sql = format!(
                r#"UPDATE "RackSlot" SET "heightU" = ?, "updatedAt" = ?{sets} WHERE "id" = ?"#
            );
            let mut q = bind(sqlx::query(&sql), &height_u).bind(&now);
            for c in &sent {
                q = bind(q, &vals[*c]);
            }
            q.bind(&ghost.slot_id)
                .execute(&mut *tx)
                .await
                .map_err(write_error)?;
            let id = ghost.slot_id.clone();
            claimed = Some(ghost);
            id
        }
        None => {
            let id = new_id();
            let mut cols: Vec<&str> = sent.clone();
            let mut binds: Vec<Value> = sent.iter().map(|c| vals[*c].clone()).collect();
            for (col, v) in [
                ("catalogEquipmentId", &equipment_id),
                ("panelId", &panel_id),
                ("parentSlotId", &parent_slot_id),
            ] {
                if let Some(v) = v {
                    cols.push(col);
                    binds.push(Value::String(v.clone()));
                }
            }
            let names: String = cols.iter().map(|c| format!(r#", "{c}""#)).collect();
            let sql = format!(
                r#"INSERT INTO "RackSlot" ("id", "rackId", "heightU", "createdAt", "updatedAt"{names})
                   VALUES (?, ?, ?, ?, ?{})"#,
                ", ?".repeat(cols.len())
            );
            let mut q = sqlx::query(&sql).bind(&id).bind(rack_id);
            q = bind(q, &height_u).bind(&now).bind(&now);
            for v in &binds {
                q = bind(q, v);
            }
            q.execute(&mut *tx).await.map_err(write_error)?;
            id
        }
    };

    audit::log(
        &mut tx,
        &me.id,
        "rackSlot.create",
        "RackSlot",
        &slot_id,
        None,
        None,
        None,
    )
    .await
    .map_err(db_error)?;
    let slot = slot_dto(&mut tx, &slot_id)
        .await
        .map_err(db_error)?
        .ok_or_else(slot_not_found)?;
    tx.commit().await.map_err(db_error)?;

    // A ghost the client already knew → slot_updated, so useRackSync applies
    // the new position instead of ignoring a known slot (route.ts:288-298).
    let promoted = claimed.as_ref().is_some_and(|g| !g.quantity_incremented);
    let slot = Value::Object(slot);
    st.events.publish_rack(
        rack_id,
        json!({ "type": if promoted { "slot_updated" } else { "slot_added" }, "slot": slot }),
    );
    st.events.publish_meta(
        "slot",
        if promoted { "updated" } else { "created" },
        Some(&slot_id),
        EventMeta {
            rack_id: Some(rack_id.to_string()),
            client_id: client.clone(),
            ..EventMeta::default()
        },
    );
    if let Some(g) = claimed.filter(|g| g.quantity_incremented) {
        st.events.publish_meta(
            "rack_inventory",
            "updated",
            Some(rack_id),
            EventMeta {
                rack_id: Some(rack_id.to_string()),
                item_id: Some(g.inventory_item_id),
                client_id: client,
                ..EventMeta::default()
            },
        );
    }
    Ok((StatusCode::CREATED, Json(slot)).into_response())
}

/// arkyo-server: plafond de quantité d'inventaire (999, comme les routes
/// d'inventaire). Sans fantôme libre, la pose augmenterait de 1 la ligne
/// d'inventaire que choisit `ensureGhostSlotForRef` : refusée au plafond.
async fn cap_inventory(
    conn: &mut SqliteConnection,
    rack_id: &str,
    r: &GhostRef,
) -> Result<(), Response> {
    if sync::find_claimable_ghost_slot(conn, rack_id, r)
        .await
        .map_err(db_error)?
        .is_some()
    {
        return Ok(());
    }
    let (col, id) = match r {
        GhostRef::Equipment(id) => ("catalogEquipmentId", id),
        GhostRef::Panel(id) => ("panelId", id),
    };
    let quantity: Option<i64> = sqlx::query_scalar(&format!(
        r#"SELECT "quantity" FROM "RackInventoryItem" WHERE "rackId" = ? AND "{col}" = ?
           ORDER BY "createdAt", rowid LIMIT 1"#
    ))
    .bind(rack_id)
    .bind(id)
    .fetch_optional(conn)
    .await
    .map_err(db_error)?;
    if quantity.is_some_and(|q| q >= MAX_QUANTITY) {
        return Err(quantity_too_big());
    }
    Ok(())
}

// ── DELETE /api/racks/:id/slots ─────────────────────────────────────────────

pub async fn clear(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(rack_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    clear_inner(&st, &me, &rack_id, &headers)
        .await
        .unwrap_or_else(|r| r)
}

/// Empties the rack (route.ts:72-116): its cables, adapters, zones, labels,
/// bundles and panel rows go; the inventory slots become ghosts, the others
/// are deleted (their children, cables and external ports by cascade);
/// `constructionChecks` gets `[]`. The inventory, the external ports of the
/// ghosts and the guides stay.
async fn clear_inner(
    st: &AppState,
    me: &User,
    rack_id: &str,
    headers: &HeaderMap,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    let mut tx = begin(&st.pool).await?;
    // arkyo-server: un rack inconnu donne 404 « Not found » ; arkyo
    // échouait sur `rack.update` (500).
    if !rack_exists(&mut tx, rack_id).await? {
        return Err(rack_not_found());
    }
    let now = now_iso();
    for sql in [
        r#"DELETE FROM "RackConnection" WHERE "rackId" = ?"#,
        r#"DELETE FROM "SynopticAdapter" WHERE "rackId" = ?"#,
        r#"DELETE FROM "RackZone" WHERE "rackId" = ?"#,
        r#"DELETE FROM "RackLabel" WHERE "rackId" = ?"#,
        r#"DELETE FROM "CableBundle" WHERE "rackId" = ?"#,
        r#"DELETE FROM "RackSlotPanelRow"
           WHERE "slotId" IN (SELECT "id" FROM "RackSlot" WHERE "rackId" = ?)"#,
    ] {
        sqlx::query(sql)
            .bind(rack_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }
    sqlx::query(&format!(
        r#"UPDATE "RackSlot" SET {GHOST_SET}, "updatedAt" = ?
           WHERE "rackId" = ? AND "inventoryItemId" IS NOT NULL"#
    ))
    .bind(&now)
    .bind(rack_id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    sqlx::query(r#"DELETE FROM "RackSlot" WHERE "rackId" = ? AND "inventoryItemId" IS NULL"#)
        .bind(rack_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    // An empty array, not the JSON `null` of construction-checks (inventory §0.18).
    sqlx::query(r#"UPDATE "Rack" SET "constructionChecks" = '[]', "updatedAt" = ? WHERE "id" = ?"#)
        .bind(&now)
        .bind(rack_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    audit::log(
        &mut tx,
        &me.id,
        "rackSlot.clearAll",
        "RackSlot",
        rack_id,
        None,
        None,
        None,
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    st.events
        .publish_rack(rack_id, json!({ "type": "rack_cleared" }));
    st.events.publish_meta(
        "slot",
        "deleted",
        Some(rack_id),
        EventMeta {
            rack_id: Some(rack_id.to_string()),
            client_id: client,
            ..EventMeta::default()
        },
    );
    Ok(Json(json!({ "ok": true })).into_response())
}

// ── PATCH /api/racks/:id/slots/:slotId ──────────────────────────────────────

pub async fn update(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((rack_id, slot_id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    update_inner(&st, &me, &rack_id, &slot_id, &headers, body)
        .await
        .unwrap_or_else(|r| r)
}

/// `updateSchema.safeParse(body)`, `panelLabels` an object or `null`.
fn parse_update(body: &Value) -> Result<Obj, Response> {
    let (vals, form, mut by_field) = match validate_flat(body, &UPDATE) {
        Ok(v) => (v, Vec::new(), BTreeMap::new()),
        Err((f, b)) => (Obj::new(), f, b),
    };
    if form.is_empty() {
        if let Some(v) = body
            .get("panelLabels")
            .filter(|v| !v.is_null() && !v.is_object())
        {
            by_field
                .entry("panelLabels".to_string())
                .or_insert_with(Vec::new)
                .push(format!(
                    "Invalid input: expected record, received {}",
                    super::parametres::js_type(Some(v))
                ));
        }
    }
    if form.is_empty() && by_field.is_empty() {
        Ok(vals)
    } else {
        Err(failure((form, by_field)))
    }
}

async fn update_inner(
    st: &AppState,
    me: &User,
    rack_id: &str,
    slot_id: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    let vals = parse_update(&parse_body(&body)?)?;

    let mut tx = begin(&st.pool).await?;
    let cols: Vec<&str> = UPDATE
        .iter()
        .map(|f| f.name)
        .filter(|n| vals.contains_key(*n))
        .collect();
    let sets: String = cols.iter().map(|c| format!(r#", "{c}" = ?"#)).collect();
    let sql =
        format!(r#"UPDATE "RackSlot" SET "updatedAt" = ?{sets} WHERE "id" = ? AND "rackId" = ?"#);
    let mut q = sqlx::query(&sql).bind(now_iso());
    for c in &cols {
        q = bind(q, &vals[*c]);
    }
    let changed = q
        .bind(slot_id)
        .bind(rack_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?
        .rows_affected();
    // arkyo-server: slot inconnu (ou d'un autre rack) → 404 « Slot
    // introuvable » ; Prisma levait P2025 (500) dans arkyo.
    if changed == 0 {
        return Err(slot_not_found());
    }
    audit::log(
        &mut tx,
        &me.id,
        "rackSlot.update",
        "RackSlot",
        slot_id,
        None,
        None,
        None,
    )
    .await
    .map_err(db_error)?;
    let slot = slot_dto(&mut tx, slot_id)
        .await
        .map_err(db_error)?
        .ok_or_else(slot_not_found)?;
    tx.commit().await.map_err(db_error)?;

    let slot = Value::Object(slot);
    st.events
        .publish_rack(rack_id, json!({ "type": "slot_updated", "slot": slot }));
    st.events.publish_meta(
        "slot",
        "updated",
        Some(slot_id),
        EventMeta {
            rack_id: Some(rack_id.to_string()),
            item_id: Some(slot_id.to_string()),
            client_id: client,
            ..EventMeta::default()
        },
    );
    Ok(Json(slot).into_response())
}

// ── DELETE /api/racks/:id/slots/:slotId ─────────────────────────────────────

pub async fn remove(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((rack_id, slot_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    remove_inner(&st, &me, &rack_id, &slot_id, &headers)
        .await
        .unwrap_or_else(|r| r)
}

/// Removes a slot ([slotId]/route.ts:153-252). The adapters attached to it
/// go with their cables (`removedAdapterIds`). An inventory slot is turned
/// back into a ghost (its cables and panel rows go, its external ports and
/// shelf children stay): `{ok, unplaced}`. Any other slot is deleted, its
/// cables, panel rows, external ports and shelf children by cascade.
async fn remove_inner(
    st: &AppState,
    me: &User,
    rack_id: &str,
    slot_id: &str,
    headers: &HeaderMap,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    let mut tx = begin(&st.pool).await?;
    let existing: Option<Option<String>> = sqlx::query_scalar(
        r#"SELECT "inventoryItemId" FROM "RackSlot" WHERE "id" = ? AND "rackId" = ?"#,
    )
    .bind(slot_id)
    .bind(rack_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?;
    let Some(inventory_item_id) = existing else {
        return Err(slot_not_found());
    };

    // Adapters attached to this slot (FK SetNull): their cables, then them.
    let adapters: Vec<String> = sqlx::query_scalar(
        r#"SELECT "id" FROM "SynopticAdapter" WHERE "attachedSlotId" = ? ORDER BY "createdAt", rowid"#,
    )
    .bind(slot_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_error)?;
    if !adapters.is_empty() {
        let marks = crate::inventory::marks(adapters.len());
        let sql = format!(
            r#"DELETE FROM "RackConnection" WHERE "fromAdapterId" IN ({marks}) OR "toAdapterId" IN ({marks})"#
        );
        let mut q = sqlx::query(&sql);
        for id in adapters.iter().chain(adapters.iter()) {
            q = q.bind(id);
        }
        q.execute(&mut *tx).await.map_err(db_error)?;
        let sql = format!(r#"DELETE FROM "SynopticAdapter" WHERE "id" IN ({marks})"#);
        let mut q = sqlx::query(&sql);
        for id in &adapters {
            q = q.bind(id);
        }
        q.execute(&mut *tx).await.map_err(db_error)?;
    }

    let unplaced = inventory_item_id.is_some();
    if unplaced {
        // A ghost keeps no physical cable on its ports.
        sqlx::query(r#"DELETE FROM "RackConnection" WHERE "fromSlotId" = ? OR "toSlotId" = ?"#)
            .bind(slot_id)
            .bind(slot_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        sqlx::query(r#"DELETE FROM "RackSlotPanelRow" WHERE "slotId" = ?"#)
            .bind(slot_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        sqlx::query(&format!(
            r#"UPDATE "RackSlot" SET {GHOST_SET}, "updatedAt" = ? WHERE "id" = ? AND "rackId" = ?"#
        ))
        .bind(now_iso())
        .bind(slot_id)
        .bind(rack_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    } else {
        sqlx::query(r#"DELETE FROM "RackSlot" WHERE "id" = ? AND "rackId" = ?"#)
            .bind(slot_id)
            .bind(rack_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }
    let action = if unplaced {
        "rackSlot.unplace"
    } else {
        "rackSlot.delete"
    };
    audit::log(
        &mut tx, &me.id, action, "RackSlot", slot_id, None, None, None,
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    st.events.publish_rack(
        rack_id,
        json!({ "type": "slot_removed", "slotId": slot_id, "removedAdapterIds": adapters }),
    );
    st.events.publish_meta(
        "slot",
        "deleted",
        Some(slot_id),
        EventMeta {
            rack_id: Some(rack_id.to_string()),
            item_id: Some(slot_id.to_string()),
            client_id: client,
            ..EventMeta::default()
        },
    );
    let body = if unplaced {
        json!({ "ok": true, "unplaced": true })
    } else {
        json!({ "ok": true })
    };
    Ok(Json(body).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shelf_detection_like_arkyo() {
        assert!(is_shelf(Some(
            r#"{"accessoryType":"etagere","childOrder":[]}"#
        )));
        assert!(!is_shelf(Some(r#"{"accessoryType":"plaque"}"#)));
        assert!(!is_shelf(None));
        assert!(!is_shelf(Some("null")));
        assert!(!is_shelf(Some("[1]")));
        assert!(!is_shelf(Some("pas du json")));
    }
}
