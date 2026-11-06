//! arkyo:app/api/tenant/projects/[id]/racks/[rackId]/inventory/route.ts
//! (`GET`, `POST`): the inventory (BOM) of a project container.
//!
//! `POST` has arkyo's three flows:
//! - a component placed in a modular host (`hostItemId` + `hostSlotIndex`,
//!   `handleComponentPlacement`): its own row, quantity 1, no slot;
//! - a host chassis (`isComponentHost`, `handleHostEquipmentPlacement`):
//!   never merged, quantity 1, optionally cloning another unit's components;
//! - the normal flow: a row per reference, merged (quantity added) when the
//!   rack already has it.
//!
//! The equipments and panels get their ghost slots (`syncInventorySlots`).
//! Each write is audited (`create_inventory_item`) and publishes the app
//! event `rack_inventory updated` with `{ projectId, rackId, itemId }`, no
//! `clientId` and no rack event, as in arkyo.
//!
//! arkyo-server:
//! - snapshots SaaS retirés (`getOrCreateSnapshot`, `loadProjectSnapshotMap`) :
//!   le catalogue local est lu en direct, `snapshotId` reste `null` ;
//! - mode fantôme SaaS retiré (`assertNotGhost`, no-op dans arkyo) ;
//! - une transaction `BEGIN IMMEDIATE` par requête : l'audit est écrit dedans
//!   (arkyo l'écrivait après, sans bloquer) et une erreur n'écrit rien ;
//! - la référence est vérifiée avant toute écriture (`validate_inventory_ref`) :
//!   arkyo créait la ligne puis répondait 500 « Référence catalogue
//!   introuvable après création. », ici 404 avec ce message, rien n'est écrit ;
//! - un corps JSON illisible donne 400 (arkyo : 500 implicite, décision 5) ;
//! - un échec de la synchronisation des slots fantômes donne 500 et annule
//!   toute la requête (arkyo l'ignorait, la ligne restait écrite) ;
//! - `quantity` plafonnée à 999, fusion comprise (arkyo : pas de maximum) :
//!   une transaction SQLite verrouille toute la base pendant la création des
//!   slots fantômes, Postgres ne verrouillait que les lignes.

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Map, Value};
use sqlx::SqliteConnection;

use super::super::parametres::{begin, db_error, parse_body, str_of, validate_flat, Field, Kind};
use super::super::{error, require, AppState, CurrentUser};
use super::{invalid, rack_in_project, zod_issues};
use crate::audit;
use crate::events::EventMeta;
use crate::ids::{new_id, now_iso};
use crate::inventory::api::{
    enrich_rows, inventory_row, inventory_rows, resolve_component_equipment_fields,
    resolve_component_spans_batch, BomItemDto, BomMode,
};
use crate::inventory::sync::sync_inventory_slots;
use crate::inventory::validate::{
    parse_inventory_ref, validate_inventory_ref, InventoryRef, RefError, RefInput, UNKNOWN_MSG,
};
use crate::users::User;

const ACCESSORY_TYPE_MSG: &str = r#"Invalid option: expected one of "plaque"|"etagere"|"tiroir""#;
const ACCESSORY_VARIANT_MSG: &str =
    r#"Invalid option: expected one of "plein"|"pass-cable"|"aere""#;

/// arkyo-server: plafond de `quantity` (arkyo : `int().min(1)` seul). Les
/// slots fantômes sont créés un par un dans une transaction `BEGIN
/// IMMEDIATE`, qui verrouille toute la base SQLite.
pub(crate) const MAX_QUANTITY: i64 = 999;

/// The Zod issue of a quantity over [`MAX_QUANTITY`] (`.max()`'s message).
pub(crate) fn quantity_too_big() -> Response {
    invalid(
        StatusCode::BAD_REQUEST,
        vec![super::issue(
            "quantity",
            &format!("Too big: expected number to be <={MAX_QUANTITY}"),
        )],
    )
}

/// `postBodySchema` (route.ts:26-48). `quantity` defaults to 1 and is not
/// nullable.
static BODY: [Field; 13] = [
    Field::new("catalogEquipmentId", Kind::Str).nullable(),
    Field::new("equipmentId", Kind::Str).nullable(),
    Field::new("panelId", Kind::Str).nullable(),
    Field::new("catalogAdapterId", Kind::Str).nullable(),
    Field::new("adapterId", Kind::Str).nullable(),
    Field::new(
        "accessoryType",
        Kind::Enum(&["plaque", "etagere", "tiroir"], ACCESSORY_TYPE_MSG),
    )
    .nullable(),
    Field::new("accessoryHeightU", Kind::IntRange(1, 8)).nullable(),
    Field::new(
        "accessoryVariant",
        Kind::Enum(&["plein", "pass-cable", "aere"], ACCESSORY_VARIANT_MSG),
    )
    .nullable(),
    Field::new("accessoryDepthMm", Kind::IntPos).nullable(),
    // arkyo-server: plafond (une transaction SQLite verrouille toute la base, Postgres ne verrouillait que les lignes)
    Field::new("quantity", Kind::IntRange(1, MAX_QUANTITY)),
    Field::new("hostItemId", Kind::Str).nullable(),
    Field::new("hostSlotIndex", Kind::IntMin(0)).nullable(),
    Field::new("cloneComponentsFromItemId", Kind::Str).nullable(),
];

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Not found")
}

fn bad(msg: &str) -> Response {
    error(StatusCode::BAD_REQUEST, msg)
}

/// An integer field of the validated body (Zod's `int()` accepts `2.0`).
fn int_of(vals: &Map<String, Value>, key: &str) -> Option<i64> {
    vals.get(key).and_then(Value::as_f64).map(|f| f as i64)
}

fn string_of(vals: &Map<String, Value>, key: &str) -> Option<String> {
    str_of(vals, key).map(str::to_string)
}

/// `RefError` as arkyo's answer; a database error is a logged 500.
fn ref_error(e: RefError) -> Response {
    match e {
        RefError::Db(e) => db_error(e),
        other => error(other.status(), other.message()),
    }
}

/// The DTO of a row just written. Its reference was checked inside this
/// transaction, so it always resolves; arkyo's explicit 500 stays as a
/// guard.
async fn enrich_one(conn: &mut SqliteConnection, item_id: &str) -> Result<BomItemDto, Response> {
    let raw = inventory_row(conn, item_id)
        .await
        .map_err(db_error)?
        .ok_or_else(|| error(StatusCode::INTERNAL_SERVER_ERROR, UNKNOWN_MSG))?;
    enrich_rows(conn, &[raw], BomMode::Project)
        .await
        .map_err(db_error)?
        .pop()
        .ok_or_else(|| error(StatusCode::INTERNAL_SERVER_ERROR, UNKNOWN_MSG))
}

/// Audit `create_inventory_item` on the row, then the commit is the
/// caller's.
async fn audit_create(
    conn: &mut SqliteConnection,
    me: &User,
    project_id: &str,
    item_id: &str,
    after: Value,
) -> Result<(), Response> {
    audit::log(
        conn,
        &me.id,
        "create_inventory_item",
        "RackInventoryItem",
        item_id,
        Some(project_id),
        None,
        Some(after),
    )
    .await
    .map_err(db_error)
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

/// `INSERT` of a `RackInventoryItem` (`snapshotId` left `NULL`).
#[allow(clippy::too_many_arguments)]
async fn insert_item(
    conn: &mut SqliteConnection,
    rack_id: &str,
    equipment: Option<&str>,
    panel: Option<&str>,
    adapter: Option<&str>,
    accessory: Option<(&str, i64, Option<&str>, Option<i64>)>,
    quantity: i64,
    host: Option<(&str, i64)>,
) -> Result<String, sqlx::Error> {
    let id = new_id();
    let now = now_iso();
    let (a_type, a_height, a_variant, a_depth) = match accessory {
        Some((t, h, v, d)) => (Some(t), Some(h), v, d),
        None => (None, None, None, None),
    };
    sqlx::query(
        r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId","panelId",
               "catalogAdapterId","accessoryType","accessoryHeightU","accessoryVariant",
               "accessoryDepthMm","quantity","hostItemId","hostSlotIndex","createdAt","updatedAt")
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"#,
    )
    .bind(&id)
    .bind(rack_id)
    .bind(equipment)
    .bind(panel)
    .bind(adapter)
    .bind(a_type)
    .bind(a_height)
    .bind(a_variant)
    .bind(a_depth)
    .bind(quantity)
    .bind(host.map(|h| h.0))
    .bind(host.map(|h| h.1))
    .bind(&now)
    .bind(&now)
    .execute(conn)
    .await?;
    Ok(id)
}

// ── GET /api/tenant/projects/:id/racks/:rackId/inventory ────────────────────

pub async fn list(
    State(st): State<AppState>,
    _u: CurrentUser,
    Path((project_id, rack_id)): Path<(String, String)>,
) -> Response {
    let run = async {
        let mut conn = st.pool.acquire().await.map_err(db_error)?;
        if !rack_in_project(&mut conn, &rack_id, &project_id)
            .await
            .map_err(db_error)?
        {
            return Err(not_found());
        }
        let rows = inventory_rows(&mut conn, &rack_id)
            .await
            .map_err(db_error)?;
        let items = enrich_rows(&mut conn, &rows, BomMode::Project)
            .await
            .map_err(db_error)?;
        Ok(Json(json!({ "items": items })).into_response())
    };
    run.await.unwrap_or_else(|r: Response| r)
}

// ── POST /api/tenant/projects/:id/racks/:rackId/inventory ───────────────────

pub async fn create(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((project_id, rack_id)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    create_inner(&st, &me, &project_id, &rack_id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn create_inner(
    st: &AppState,
    me: &User,
    project_id: &str,
    rack_id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;

    let mut tx = begin(&st.pool).await?;
    // arkyo checks the rack before reading the body (route.ts:1037-1040).
    if !rack_in_project(&mut tx, rack_id, project_id)
        .await
        .map_err(db_error)?
    {
        return Err(not_found());
    }
    let vals = validate_flat(&parse_body(&body)?, &BODY)
        .map_err(|flat| invalid(StatusCode::BAD_REQUEST, zod_issues(&BODY, flat)))?;

    // `resolveInventoryRef`: legacy names normalised, then
    // `validateInventoryRef` (400 with its message).
    let ref_input = RefInput {
        equipment_id: string_of(&vals, "catalogEquipmentId")
            .or_else(|| string_of(&vals, "equipmentId")),
        panel_id: string_of(&vals, "panelId"),
        adapter_id: string_of(&vals, "catalogAdapterId").or_else(|| string_of(&vals, "adapterId")),
        accessory_type: string_of(&vals, "accessoryType"),
        accessory_height_u: int_of(&vals, "accessoryHeightU"),
        accessory_variant: string_of(&vals, "accessoryVariant"),
        accessory_depth_mm: int_of(&vals, "accessoryDepthMm"),
    };
    let r = parse_inventory_ref(&ref_input).map_err(ref_error)?;
    let quantity = int_of(&vals, "quantity").unwrap_or(1);
    let host_item_id = string_of(&vals, "hostItemId");
    let host_slot_index = int_of(&vals, "hostSlotIndex");

    let ctx = Ctx {
        st,
        me,
        project_id,
        rack_id,
    };

    // ── Component in a host item (modular chassis) ──────────────────────
    if host_item_id.is_some() || host_slot_index.is_some() {
        let (Some(host_item_id), Some(host_slot_index)) = (host_item_id, host_slot_index) else {
            return Err(bad(
                "hostItemId et hostSlotIndex doivent être fournis ensemble",
            ));
        };
        // arkyo's own checks cover the component's equipment (404
        // « Équipement composant introuvable »).
        return ctx.component(tx, &r, &host_item_id, host_slot_index).await;
    }

    // arkyo-server: référence vérifiée avant toute écriture (décision 5).
    validate_inventory_ref(&mut tx, &r)
        .await
        .map_err(ref_error)?;

    // ── Host chassis (isComponentHost): never merged ────────────────────
    if let InventoryRef::Equipment(eq) = &r {
        let fields = resolve_component_equipment_fields(&mut tx, eq)
            .await
            .map_err(db_error)?;
        if fields.is_some_and(|f| f.is_component_host) {
            let clone_from =
                string_of(&vals, "cloneComponentsFromItemId").filter(|s| !s.is_empty());
            return ctx.host(tx, eq, clone_from.as_deref()).await;
        }
    }

    ctx.normal(tx, &r, quantity).await
}

/// What every flow needs.
struct Ctx<'a> {
    st: &'a AppState,
    me: &'a User,
    project_id: &'a str,
    rack_id: &'a str,
}

type Tx = sqlx::Transaction<'static, sqlx::Sqlite>;

impl Ctx<'_> {
    /// Audit, commit, event, `{ item }` with `status`.
    async fn finish(
        &self,
        mut tx: Tx,
        item: BomItemDto,
        after: Value,
        status: StatusCode,
    ) -> Result<Response, Response> {
        audit_create(&mut tx, self.me, self.project_id, &item.id, after).await?;
        tx.commit().await.map_err(db_error)?;
        publish(self.st, self.project_id, self.rack_id, &item.id);
        Ok((status, Json(json!({ "item": item }))).into_response())
    }

    /// `handleComponentPlacement` (route.ts:678-833).
    async fn component(
        &self,
        mut tx: Tx,
        r: &InventoryRef,
        host_item_id: &str,
        host_slot_index: i64,
    ) -> Result<Response, Response> {
        let InventoryRef::Equipment(comp_eq_id) = r else {
            return Err(bad("Seul un équipement peut être installé comme composant"));
        };
        let cannot_host = || bad("Cet équipement ne peut pas accueillir de composants");

        let host: Option<(Option<String>, Option<String>)> = sqlx::query_as(
            r#"SELECT "catalogEquipmentId", "hostItemId" FROM "RackInventoryItem"
               WHERE "id" = ? AND "rackId" = ?"#,
        )
        .bind(host_item_id)
        .bind(self.rack_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
        let Some((host_eq, host_parent)) = host else {
            return Err(not_found());
        };
        if host_parent.is_some() {
            return Err(bad("Impossible d'imbriquer un composant dans un composant"));
        }
        let Some(host_eq) = host_eq.filter(|s| !s.is_empty()) else {
            return Err(cannot_host());
        };
        let host_fields = resolve_component_equipment_fields(&mut tx, &host_eq)
            .await
            .map_err(db_error)?;
        let slot_count = match host_fields {
            Some(f) if f.is_component_host => f.host_slot_count.filter(|n| *n != 0),
            _ => None,
        };
        let Some(slot_count) = slot_count else {
            return Err(cannot_host());
        };

        let Some(comp) = resolve_component_equipment_fields(&mut tx, comp_eq_id)
            .await
            .map_err(db_error)?
        else {
            return Err(error(
                StatusCode::NOT_FOUND,
                "Équipement composant introuvable",
            ));
        };
        let span = comp.component_slot_span;
        if host_slot_index + span > slot_count {
            return Err(bad("Composant hors des limites de l'équipement modulaire"));
        }

        // Overlap of [index, index + span) with the host's components.
        let existing: Vec<(Option<i64>, Option<String>)> = sqlx::query_as(
            r#"SELECT "hostSlotIndex", "catalogEquipmentId" FROM "RackInventoryItem"
               WHERE "hostItemId" = ?"#,
        )
        .bind(host_item_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_error)?;
        let eq_ids: Vec<String> = existing
            .iter()
            .filter_map(|(_, e)| e.clone().filter(|s| !s.is_empty()))
            .collect();
        let spans = resolve_component_spans_batch(&mut tx, &eq_ids)
            .await
            .map_err(db_error)?;
        let (new_start, new_end) = (host_slot_index, host_slot_index + span);
        for (index, eq) in &existing {
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

        // No RackSlot for a component (no U footprint, no sync).
        let id = insert_item(
            &mut tx,
            self.rack_id,
            Some(comp_eq_id),
            None,
            None,
            None,
            1,
            Some((host_item_id, host_slot_index)),
        )
        .await
        .map_err(db_error)?;
        let item = enrich_one(&mut tx, &id).await?;
        let after = json!({
            "rackId": self.rack_id,
            "refKind": "equipment",
            "refId": comp_eq_id,
            "quantity": item.quantity,
            "hostItemId": host_item_id,
            "hostSlotIndex": host_slot_index,
        });
        self.finish(tx, item, after, StatusCode::CREATED).await
    }

    /// `handleHostEquipmentPlacement` (route.ts:843-977).
    async fn host(
        &self,
        mut tx: Tx,
        eq_id: &str,
        clone_from: Option<&str>,
    ) -> Result<Response, Response> {
        if let Some(src) = clone_from {
            let parent: Option<(Option<String>,)> = sqlx::query_as(
                r#"SELECT "hostItemId" FROM "RackInventoryItem" WHERE "id" = ? AND "rackId" = ?"#,
            )
            .bind(src)
            .bind(self.rack_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?;
            match parent {
                None => return Err(bad("Exemplaire source introuvable dans ce rack")),
                Some((Some(_),)) => return Err(bad("Impossible de dupliquer depuis un composant")),
                Some((None,)) => {}
            }
        }

        // The body's quantity is ignored: one row per physical unit.
        let id = insert_item(
            &mut tx,
            self.rack_id,
            Some(eq_id),
            None,
            None,
            None,
            1,
            None,
        )
        .await
        .map_err(db_error)?;

        let mut cloned = 0_i64;
        if let Some(src) = clone_from {
            let components: Vec<(Option<String>, Option<i64>)> = sqlx::query_as(
                r#"SELECT "catalogEquipmentId", "hostSlotIndex" FROM "RackInventoryItem"
                   WHERE "hostItemId" = ? ORDER BY "createdAt", rowid"#,
            )
            .bind(src)
            .fetch_all(&mut *tx)
            .await
            .map_err(db_error)?;
            for (eq, index) in &components {
                let now = now_iso();
                sqlx::query(
                    r#"INSERT INTO "RackInventoryItem" ("id","rackId","catalogEquipmentId",
                           "hostItemId","hostSlotIndex","quantity","createdAt","updatedAt")
                       VALUES (?,?,?,?,?,1,?,?)"#,
                )
                .bind(new_id())
                .bind(self.rack_id)
                .bind(eq)
                .bind(&id)
                .bind(index)
                .bind(&now)
                .bind(&now)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
            }
            cloned = components.len() as i64;
        }

        let item = enrich_one(&mut tx, &id).await?;
        // Ghost slot of the host itself; the cloned components have none.
        sync_inventory_slots(&mut tx, &id).await.map_err(db_error)?;
        let mut after = json!({
            "rackId": self.rack_id,
            "refKind": "equipment",
            "refId": eq_id,
            "quantity": item.quantity,
        });
        if let Some(src) = clone_from {
            after["clonedComponentsFrom"] = json!(src);
            after["clonedComponentCount"] = json!(cloned);
        }
        self.finish(tx, item, after, StatusCode::CREATED).await
    }

    /// The normal flow (route.ts:1107-1242): merge or create.
    async fn normal(
        &self,
        mut tx: Tx,
        r: &InventoryRef,
        quantity: i64,
    ) -> Result<Response, Response> {
        // Dedup (route.ts:1107-1137). arkyo's `findFirst` has no order: the
        // oldest row wins.
        const SELECT: &str =
            r#"SELECT "id", "quantity" FROM "RackInventoryItem" WHERE "rackId" = ?"#;
        const ORDER: &str = r#"ORDER BY "createdAt", rowid LIMIT 1"#;
        let existing: Option<(String, i64)> = match r {
            InventoryRef::Equipment(id) | InventoryRef::Panel(id) | InventoryRef::Adapter(id) => {
                let filter = match r {
                    // arkyo-server: correction (un ajout au niveau racine ne fusionne pas avec un composant)
                    InventoryRef::Equipment(_) => {
                        r#""catalogEquipmentId" = ? AND "hostItemId" IS NULL"#
                    }
                    InventoryRef::Panel(_) => r#""panelId" = ?"#,
                    _ => r#""catalogAdapterId" = ?"#,
                };
                sqlx::query_as(&format!(r#"{SELECT} AND {filter} {ORDER}"#))
                    .bind(self.rack_id)
                    .bind(id)
                    .fetch_optional(&mut *tx)
                    .await
            }
            InventoryRef::Accessory {
                accessory_type,
                height_u,
                variant,
                depth_mm,
            } => {
                // Prisma's `field: null` is `IS NULL`; `IS ?` matches both.
                sqlx::query_as(&format!(
                    r#"{SELECT} AND "accessoryType" = ? AND "accessoryHeightU" = ?
                       AND "accessoryVariant" IS ? AND "accessoryDepthMm" IS ? {ORDER}"#
                ))
                .bind(self.rack_id)
                .bind(accessory_type)
                .bind(height_u)
                .bind(variant)
                .bind(depth_mm)
                .fetch_optional(&mut *tx)
                .await
            }
        }
        .map_err(db_error)?;

        let id = match &existing {
            Some((id, current)) => {
                // arkyo-server: plafond (une transaction SQLite verrouille toute la base, Postgres ne verrouillait que les lignes)
                let total = current
                    .checked_add(quantity)
                    .filter(|q| *q <= MAX_QUANTITY)
                    .ok_or_else(quantity_too_big)?;
                sqlx::query(
                    r#"UPDATE "RackInventoryItem" SET "quantity" = ?, "updatedAt" = ? WHERE "id" = ?"#,
                )
                .bind(total)
                .bind(now_iso())
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
                id.clone()
            }
            None => {
                let (eq, panel, adapter, accessory) = match r {
                    InventoryRef::Equipment(id) => (Some(id.as_str()), None, None, None),
                    InventoryRef::Panel(id) => (None, Some(id.as_str()), None, None),
                    InventoryRef::Adapter(id) => (None, None, Some(id.as_str()), None),
                    InventoryRef::Accessory {
                        accessory_type,
                        height_u,
                        variant,
                        depth_mm,
                    } => (
                        None,
                        None,
                        None,
                        Some((
                            accessory_type.as_str(),
                            *height_u,
                            variant.as_deref(),
                            *depth_mm,
                        )),
                    ),
                };
                insert_item(
                    &mut tx,
                    self.rack_id,
                    eq,
                    panel,
                    adapter,
                    accessory,
                    quantity,
                    None,
                )
                .await
                .map_err(db_error)?
            }
        };

        let item = enrich_one(&mut tx, &id).await?;
        // Ghost slots for equipments and panels (route.ts:1199-1203); a
        // merged row has the same reference.
        if matches!(r, InventoryRef::Equipment(_) | InventoryRef::Panel(_)) {
            sync_inventory_slots(&mut tx, &id).await.map_err(db_error)?;
        }

        let after = match r {
            InventoryRef::Accessory {
                accessory_type,
                height_u,
                variant,
                depth_mm,
            } => json!({
                "rackId": self.rack_id,
                "refKind": "accessory",
                "accessoryType": accessory_type,
                "accessoryHeightU": height_u,
                "accessoryVariant": variant,
                "accessoryDepthMm": depth_mm,
                "quantity": item.quantity,
            }),
            _ => json!({
                "rackId": self.rack_id,
                "refKind": r.kind(),
                "refId": r.ref_id(),
                "quantity": item.quantity,
            }),
        };
        let status = if existing.is_some() {
            StatusCode::OK
        } else {
            StatusCode::CREATED
        };
        self.finish(tx, item, after, status).await
    }
}
