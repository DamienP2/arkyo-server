//! Rack external ports, panel rows and synoptic adapters:
//! arkyo:app/api/racks/[id]/external-ports/route.ts (`GET`, `POST`),
//! arkyo:app/api/racks/[id]/external-ports/[externalId]/route.ts (`PATCH`,
//! `DELETE`), arkyo:app/api/racks/[id]/panel-rows/route.ts (`GET`, `POST`),
//! arkyo:app/api/racks/[id]/adapters/route.ts (`GET`, `POST`) and
//! arkyo:app/api/racks/[id]/adapters/[adapterId]/route.ts (`PATCH`,
//! `DELETE`) (phase-4 inventory, annex A §1.1, 1.2, 1.11, 1.12, 1.17).
//!
//! - External ports: `kind` is `INTER_LIEU` (default) or `MONDE`; one per
//!   `(slotId, portIndex)`. Rack bus `external_port_added|_updated`
//!   `{externalPort}` / `external_port_removed {externalPortId}`; app bus
//!   `external_port` (snake_case, as in arkyo).
//! - Panel rows: `POST` upserts on `(slotId, rowIndex)`; rack bus
//!   `panelrow_updated {slotId, rowIndex, x, y}`, app bus `rackSlotPanelRow
//!   updated`. `GET` purges, as arkyo does, the rack's rows whose slot has
//!   no panel or whose `rowIndex >= panel.heightU` (no audit, no event).
//! - Adapters: `adapterId` is stored in `catalogAdapterId`; the auto label
//!   is `#ADP<count + 1>` (a count, not a max: it can repeat after a
//!   deletion, as in arkyo); answers are enriched with `adapterId` and
//!   `adapter` (`fetch_catalog_adapter_map`). `PATCH` has no audit, as in
//!   arkyo. Deleting an adapter removes its cables (`RackConnection.
//!   fromAdapterId/toAdapterId ON DELETE CASCADE`, 0004), and with them
//!   their bundle membership (`RackConnection.bundleId`); no
//!   `connection_removed` event, as in arkyo. The catalogue guard
//!   (`catalogue::in_use::adapter`) counts these rows.
//! - Every app event carries `{rackId, itemId, clientId}`.
//!
//! arkyo-server:
//! - mode fantôme SaaS retiré (`assertNotGhost`, 403 « Mode lecture seule ») ;
//! - garde serveur `design:write` sur les écritures (arkyo : session seule) ;
//!   le `GET` de `panel-rows`, qui purge, reste à la seule session ;
//! - une transaction `BEGIN IMMEDIATE` par écriture, purge du `GET`
//!   comprise (arkyo : écritures séquentielles, audit hors bloc) ;
//! - 400/404/409 au lieu des 500 implicites : corps illisible (400), objet
//!   inconnu ou d'un autre rack (404, arkyo : P2025 ; `PATCH`/`DELETE`
//!   d'un adaptateur sans filtre `rackId` dans arkyo), rack inconnu au
//!   `POST` d'un adaptateur (404 « Not found », arkyo : clé étrangère),
//!   identifiant client déjà pris (409, arkyo : P2002), port déjà marqué au
//!   `PATCH` (409, arkyo : P2002 non intercepté) ;
//! - `attachedSlotId` d'un adaptateur doit appartenir au rack : 404
//!   « Slot introuvable dans ce rack » (arkyo : clé étrangère en 500 ; son
//!   front refuse déjà de rattacher à un autre contenant) ;
//! - `PATCH` d'un port : le `slotId` peut être celui d'un autre rack, comme
//!   dans arkyo (glisser de la bulle en vue lieu), et `rackId` ne change
//!   pas ; seul un slot inexistant donne 404 « Slot introuvable » (arkyo :
//!   clé étrangère, 500).

#![allow(clippy::result_large_err)]

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::parametres::{
    begin, bind, db_error, parse_body, row_map, validate, Field, Kind, Obj, Table,
};
use super::rack_objects::{insert_error, meta};
use super::{client_id, error, require, AppState, CurrentUser};
use crate::audit;
use crate::catalogue::enrich::fetch_catalog_adapter_map;
use crate::ids::{new_id, now_iso};
use crate::users::User;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/racks/{id}/external-ports",
            get(list_ports).post(create_port),
        )
        .route(
            "/racks/{id}/external-ports/{object_id}",
            patch(update_port).delete(remove_port),
        )
        .route(
            "/racks/{id}/panel-rows",
            get(list_panel_rows).post(upsert_panel_row),
        )
        .route(
            "/racks/{id}/adapters",
            get(list_adapters).post(create_adapter),
        )
        .route(
            "/racks/{id}/adapters/{object_id}",
            patch(update_adapter).delete(remove_adapter),
        )
}

static PORT: Table = Table {
    name: "ExternalPort",
    bools: &[],
    jsons: &[],
};
static PANEL_ROW: Table = Table {
    name: "RackSlotPanelRow",
    bools: &[],
    jsons: &[],
};
static ADAPTER: Table = Table {
    name: "SynopticAdapter",
    bools: &[],
    jsons: &[],
};

const SLOT_404: &str = "Slot introuvable dans ce rack";
const SLOT_UNKNOWN: &str = "Slot introuvable";
const PORT_404: &str = "Port externe introuvable";
const ADAPTER_404: &str = "Adaptateur introuvable";
const PORT_TAKEN: &str = "Ce port est déjà marqué comme externe";

const KINDS: &[&str] = &["INTER_LIEU", "MONDE"];
const KIND_MSG: &str = r#"Invalid option: expected one of "INTER_LIEU"|"MONDE""#;
const SIDES: &[&str] = &["left", "right"];
const SIDE_MSG: &str = r#"Invalid option: expected one of "left"|"right""#;

/// `createSchema` of external-ports/route.ts:10-18.
static PORT_CREATE: [Field; 6] = [
    Field::new("slotId", Kind::NonEmpty).required(),
    Field::new("portIndex", Kind::IntMin(0)).required(),
    Field::new("labelX", Kind::Num).nullable(),
    Field::new("labelY", Kind::Num).nullable(),
    Field::new("label", Kind::Str).nullable(),
    Field::new("kind", Kind::Enum(KINDS, KIND_MSG)),
];

/// `patchSchema` of external-ports/[externalId]/route.ts:9-17.
static PORT_PATCH: [Field; 6] = [
    Field::new("labelX", Kind::Num).nullable(),
    Field::new("labelY", Kind::Num).nullable(),
    Field::new("label", Kind::Str).nullable(),
    Field::new("slotId", Kind::NonEmpty),
    Field::new("portIndex", Kind::IntMin(0)),
    Field::new("kind", Kind::Enum(KINDS, KIND_MSG)),
];

/// `upsertSchema` of panel-rows/route.ts:9-14.
static PANEL_ROW_UPSERT: [Field; 4] = [
    Field::new("slotId", Kind::Str).required(),
    Field::new("rowIndex", Kind::IntMin(0)).required(),
    Field::new("x", Kind::Num).required(),
    Field::new("y", Kind::Num).required(),
];

/// `createSchema` of adapters/route.ts:10-19.
static ADAPTER_CREATE: [Field; 8] = [
    Field::new("id", Kind::StrLen(6, 64)),
    Field::new("adapterId", Kind::Str).required(),
    Field::new("x", Kind::Num).required(),
    Field::new("y", Kind::Num).required(),
    Field::new("attachedSlotId", Kind::Str).nullable(),
    Field::new("attachedSide", Kind::Enum(SIDES, SIDE_MSG)).nullable(),
    Field::new("attachedPortIndex", Kind::Int).nullable(),
    Field::new("notes", Kind::Str).nullable(),
];

/// `patchSchema` of adapters/[adapterId]/route.ts:10-18.
static ADAPTER_PATCH: [Field; 7] = [
    Field::new("x", Kind::Num),
    Field::new("y", Kind::Num),
    Field::new("attachedSlotId", Kind::Str).nullable(),
    Field::new("attachedSide", Kind::Enum(SIDES, SIDE_MSG)).nullable(),
    Field::new("attachedPortIndex", Kind::Int).nullable(),
    Field::new("label", Kind::Str).nullable(),
    Field::new("notes", Kind::Str).nullable(),
];

// ── shared helpers ──────────────────────────────────────────────────────────

/// Whether slot `slot` belongs to rack `rack` (shelf children included:
/// no `parentSlotId` filter, as in arkyo).
async fn slot_in_rack(
    conn: &mut SqliteConnection,
    rack: &str,
    slot: &str,
) -> Result<bool, Response> {
    let found: Option<i64> =
        sqlx::query_scalar(r#"SELECT 1 FROM "RackSlot" WHERE "id" = ? AND "rackId" = ?"#)
            .bind(slot)
            .bind(rack)
            .fetch_optional(conn)
            .await
            .map_err(db_error)?;
    Ok(found.is_some())
}

/// Whether slot `slot` exists, in any rack.
async fn slot_exists(conn: &mut SqliteConnection, slot: &str) -> Result<bool, Response> {
    let found: Option<i64> = sqlx::query_scalar(r#"SELECT 1 FROM "RackSlot" WHERE "id" = ?"#)
        .bind(slot)
        .fetch_optional(conn)
        .await
        .map_err(db_error)?;
    Ok(found.is_some())
}

/// The row `id` of `table` in rack `rack`, `None` when absent or of
/// another rack.
async fn fetch(
    conn: &mut SqliteConnection,
    table: &Table,
    rack: &str,
    id: &str,
) -> Result<Option<Obj>, Response> {
    let row = sqlx::query(&format!(
        r#"SELECT * FROM "{}" WHERE "id" = ? AND "rackId" = ?"#,
        table.name
    ))
    .bind(id)
    .bind(rack)
    .fetch_optional(conn)
    .await
    .map_err(db_error)?;
    Ok(row.map(|r| row_map(&r, table)))
}

/// `INSERT` of `id`, `rackId`, the timestamps and the validated fields.
async fn insert(
    conn: &mut SqliteConnection,
    table: &Table,
    id: &str,
    rack: &str,
    obj: &Obj,
) -> Result<(), sqlx::Error> {
    let now = now_iso();
    let cols: String = obj.keys().map(|k| format!(r#", "{k}""#)).collect();
    let marks: String = obj.keys().map(|_| ", ?").collect();
    let sql = format!(
        r#"INSERT INTO "{}" ("id", "rackId", "createdAt", "updatedAt"{cols})
           VALUES (?, ?, ?, ?{marks})"#,
        table.name
    );
    let mut q = sqlx::query(&sql).bind(id).bind(rack).bind(&now).bind(&now);
    for v in obj.values() {
        q = bind(q, v);
    }
    q.execute(conn).await?;
    Ok(())
}

/// Prisma `update` with the sent fields (and `updatedAt`).
async fn update_row(
    conn: &mut SqliteConnection,
    table: &Table,
    id: &str,
    obj: &Obj,
) -> Result<(), sqlx::Error> {
    let sets: String = obj.keys().map(|k| format!(r#", "{k}" = ?"#)).collect();
    let sql = format!(
        r#"UPDATE "{}" SET "updatedAt" = ?{sets} WHERE "id" = ?"#,
        table.name
    );
    let mut q = sqlx::query(&sql).bind(now_iso());
    for v in obj.values() {
        q = bind(q, v);
    }
    q.bind(id).execute(conn).await?;
    Ok(())
}

/// `auditLog.create({userId, action, entityType, entityId})`.
async fn log(
    conn: &mut SqliteConnection,
    me: &User,
    action: &str,
    table: &Table,
    id: &str,
) -> Result<(), Response> {
    audit::log(conn, &me.id, action, table.name, id, None, None, None)
        .await
        .map_err(db_error)
}

/// A taken `(slotId, portIndex)`: 409 (arkyo: P2002 → 409 at `POST`).
fn port_error(e: sqlx::Error) -> Response {
    if let sqlx::Error::Database(d) = &e {
        if d.is_unique_violation() {
            return error(StatusCode::CONFLICT, PORT_TAKEN);
        }
    }
    db_error(e)
}

/// `{type, <key>: value}` of the rack bus.
fn rack_payload(kind: &str, key: &str, value: Value) -> Value {
    let mut m = Obj::new();
    m.insert("type".into(), json!(kind));
    m.insert(key.into(), value);
    Value::Object(m)
}

// ── external ports ──────────────────────────────────────────────────────────

pub async fn list_ports(
    State(st): State<AppState>,
    _u: CurrentUser,
    Path(rack): Path<String>,
) -> Response {
    let rows = sqlx::query(
        r#"SELECT * FROM "ExternalPort" WHERE "rackId" = ? ORDER BY "createdAt" ASC, rowid ASC"#,
    )
    .bind(&rack)
    .fetch_all(&st.pool)
    .await;
    match rows {
        Ok(rows) => Json(Value::Array(
            rows.iter()
                .map(|r| Value::Object(row_map(r, &PORT)))
                .collect(),
        ))
        .into_response(),
        Err(e) => db_error(e),
    }
}

pub async fn create_port(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(rack): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    run_create_port(&st, &me, &rack, &headers, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn run_create_port(
    st: &AppState,
    me: &User,
    rack: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    let obj = validate(&parse_body(&body)?, &PORT_CREATE)?;
    let slot = obj["slotId"].as_str().unwrap_or_default().to_string();

    let mut tx = begin(&st.pool).await?;
    if !slot_in_rack(&mut tx, rack, &slot).await? {
        return Err(error(StatusCode::NOT_FOUND, SLOT_404));
    }
    let id = new_id();
    insert(&mut tx, &PORT, &id, rack, &obj)
        .await
        .map_err(port_error)?;
    log(&mut tx, me, "externalPort.create", &PORT, &id).await?;
    let row = fetch(&mut tx, &PORT, rack, &id)
        .await?
        .ok_or_else(|| db_error(sqlx::Error::RowNotFound))?;
    tx.commit().await.map_err(db_error)?;

    let row = Value::Object(row);
    st.events.publish_rack(
        rack,
        rack_payload("external_port_added", "externalPort", row.clone()),
    );
    st.events.publish_meta(
        "external_port",
        "created",
        Some(&id),
        meta(rack, &id, client),
    );
    Ok(Json(row).into_response())
}

pub async fn update_port(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((rack, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    run_update_port(&st, &me, &rack, &id, &headers, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn run_update_port(
    st: &AppState,
    me: &User,
    rack: &str,
    id: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    let obj = validate(&parse_body(&body)?, &PORT_PATCH)?;

    let mut tx = begin(&st.pool).await?;
    if fetch(&mut tx, &PORT, rack, id).await?.is_none() {
        return Err(error(StatusCode::NOT_FOUND, PORT_404));
    }
    // Any existing slot, even of another rack: the location view drags a
    // bubble onto any free port of the location, and `rackId` stays the
    // port's own (arkyo: no check). arkyo-server: un slot inexistant donne
    // 404 « Slot introuvable » (arkyo : clé étrangère, 500).
    if let Some(Value::String(slot)) = obj.get("slotId") {
        if !slot_exists(&mut tx, slot).await? {
            return Err(error(StatusCode::NOT_FOUND, SLOT_UNKNOWN));
        }
    }
    update_row(&mut tx, &PORT, id, &obj)
        .await
        .map_err(port_error)?;
    log(&mut tx, me, "externalPort.update", &PORT, id).await?;
    let row = fetch(&mut tx, &PORT, rack, id)
        .await?
        .ok_or_else(|| db_error(sqlx::Error::RowNotFound))?;
    tx.commit().await.map_err(db_error)?;

    let row = Value::Object(row);
    st.events.publish_rack(
        rack,
        rack_payload("external_port_updated", "externalPort", row.clone()),
    );
    st.events
        .publish_meta("external_port", "updated", Some(id), meta(rack, id, client));
    Ok(Json(row).into_response())
}

pub async fn remove_port(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((rack, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    remove(&st, &me, &rack, &id, &headers, &REMOVE_PORT)
        .await
        .unwrap_or_else(|r| r)
}

// ── shared DELETE ───────────────────────────────────────────────────────────

/// How one object is deleted and announced.
struct Removal {
    table: &'static Table,
    not_found: &'static str,
    audit: &'static str,
    rack_type: &'static str,
    rack_key: &'static str,
    entity: &'static str,
}

static REMOVE_PORT: Removal = Removal {
    table: &PORT,
    not_found: PORT_404,
    audit: "externalPort.delete",
    rack_type: "external_port_removed",
    rack_key: "externalPortId",
    entity: "external_port",
};

static REMOVE_ADAPTER: Removal = Removal {
    table: &ADAPTER,
    not_found: ADAPTER_404,
    audit: "synopticAdapter.delete",
    rack_type: "adapter_removed",
    rack_key: "adapterId",
    entity: "synopticAdapter",
};

/// `delete({where: {id, rackId}})`, audit, `{ok: true}`. The foreign keys
/// of 0004 do the rest (an adapter's cables, and with them their bundle
/// membership).
async fn remove(
    st: &AppState,
    me: &User,
    rack: &str,
    id: &str,
    headers: &HeaderMap,
    spec: &Removal,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);

    let mut tx = begin(&st.pool).await?;
    let done = sqlx::query(&format!(
        r#"DELETE FROM "{}" WHERE "id" = ? AND "rackId" = ?"#,
        spec.table.name
    ))
    .bind(id)
    .bind(rack)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    if done.rows_affected() == 0 {
        return Err(error(StatusCode::NOT_FOUND, spec.not_found));
    }
    log(&mut tx, me, spec.audit, spec.table, id).await?;
    tx.commit().await.map_err(db_error)?;

    st.events
        .publish_rack(rack, rack_payload(spec.rack_type, spec.rack_key, json!(id)));
    st.events
        .publish_meta(spec.entity, "deleted", Some(id), meta(rack, id, client));
    Ok(Json(json!({ "ok": true })).into_response())
}

// ── panel rows ──────────────────────────────────────────────────────────────

/// `GET`: purges the rack's rows whose slot lost its panel or whose
/// `rowIndex` is past the panel height, then lists the others
/// (panel-rows/route.ts:26-54). arkyo-server : purge dans une transaction
/// `BEGIN IMMEDIATE`.
pub async fn list_panel_rows(
    State(st): State<AppState>,
    _u: CurrentUser,
    Path(rack): Path<String>,
) -> Response {
    run_list_panel_rows(&st, &rack).await.unwrap_or_else(|r| r)
}

async fn run_list_panel_rows(st: &AppState, rack: &str) -> Result<Response, Response> {
    let mut tx = begin(&st.pool).await?;
    sqlx::query(
        r#"DELETE FROM "RackSlotPanelRow" WHERE "id" IN (
               SELECT r."id" FROM "RackSlotPanelRow" r
               JOIN "RackSlot" s ON s."id" = r."slotId"
               LEFT JOIN "Panel" p ON p."id" = s."panelId"
               WHERE s."rackId" = ? AND (p."id" IS NULL OR r."rowIndex" >= p."heightU"))"#,
    )
    .bind(rack)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    let rows = sqlx::query(
        r#"SELECT r.* FROM "RackSlotPanelRow" r
           JOIN "RackSlot" s ON s."id" = r."slotId"
           WHERE s."rackId" = ? ORDER BY r."createdAt" ASC, r.rowid ASC"#,
    )
    .bind(rack)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    Ok(Json(Value::Array(
        rows.iter()
            .map(|r| Value::Object(row_map(r, &PANEL_ROW)))
            .collect(),
    ))
    .into_response())
}

pub async fn upsert_panel_row(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(rack): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    run_upsert_panel_row(&st, &me, &rack, &headers, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn run_upsert_panel_row(
    st: &AppState,
    me: &User,
    rack: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    let obj = validate(&parse_body(&body)?, &PANEL_ROW_UPSERT)?;
    let slot = obj["slotId"].as_str().unwrap_or_default().to_string();
    let (row_index, x, y) = (obj["rowIndex"].clone(), obj["x"].clone(), obj["y"].clone());

    let mut tx = begin(&st.pool).await?;
    if !slot_in_rack(&mut tx, rack, &slot).await? {
        return Err(error(StatusCode::NOT_FOUND, "Slot not found"));
    }
    let now = now_iso();
    let q = sqlx::query(
        r#"INSERT INTO "RackSlotPanelRow"
               ("id", "slotId", "rowIndex", "synopticX", "synopticY", "createdAt", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT ("slotId", "rowIndex") DO UPDATE SET
               "synopticX" = excluded."synopticX",
               "synopticY" = excluded."synopticY",
               "updatedAt" = excluded."updatedAt""#,
    )
    .bind(new_id())
    .bind(&slot);
    let q = bind(q, &row_index);
    let q = bind(q, &x);
    let q = bind(q, &y);
    q.bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    let q =
        sqlx::query(r#"SELECT * FROM "RackSlotPanelRow" WHERE "slotId" = ? AND "rowIndex" = ?"#)
            .bind(&slot);
    let row = bind(q, &row_index)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_error)?;
    let row = row_map(&row, &PANEL_ROW);
    let id = row["id"].as_str().unwrap_or_default().to_string();
    log(&mut tx, me, "rackSlotPanelRow.upsert", &PANEL_ROW, &id).await?;
    tx.commit().await.map_err(db_error)?;

    st.events.publish_rack(
        rack,
        json!({"type": "panelrow_updated", "slotId": slot, "rowIndex": row_index, "x": x, "y": y}),
    );
    st.events.publish_meta(
        "rackSlotPanelRow",
        "updated",
        Some(&id),
        meta(rack, &id, client),
    );
    Ok(Json(Value::Object(row)).into_response())
}

// ── adapters ────────────────────────────────────────────────────────────────

/// `{...row, adapterId: catalogAdapterId, adapter: CatalogAdapterLite|null}`
/// (adapters/route.ts:35-40).
async fn enrich(conn: &mut SqliteConnection, rows: Vec<Obj>) -> Result<Vec<Value>, Response> {
    let catalog_ids: Vec<Option<String>> = rows
        .iter()
        .map(|r| {
            r.get("catalogAdapterId")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect();
    let map = fetch_catalog_adapter_map(conn, catalog_ids.iter().map(|s| s.as_deref()))
        .await
        .map_err(db_error)?;
    Ok(rows
        .into_iter()
        .zip(catalog_ids)
        .map(|(mut r, cid)| {
            let adapter = cid
                .as_ref()
                .and_then(|c| map.get(c).cloned())
                .unwrap_or(Value::Null);
            r.insert("adapterId".into(), json!(cid));
            r.insert("adapter".into(), adapter);
            Value::Object(r)
        })
        .collect())
}

/// The adapter `id` of rack `rack`, enriched.
async fn fetch_adapter(
    conn: &mut SqliteConnection,
    rack: &str,
    id: &str,
) -> Result<Value, Response> {
    let row = fetch(conn, &ADAPTER, rack, id)
        .await?
        .ok_or_else(|| db_error(sqlx::Error::RowNotFound))?;
    Ok(enrich(conn, vec![row]).await?.remove(0))
}

/// `attachedSlotId`, when set, must be a slot of this rack.
async fn check_attached(
    conn: &mut SqliteConnection,
    rack: &str,
    obj: &Obj,
) -> Result<(), Response> {
    if let Some(Value::String(slot)) = obj.get("attachedSlotId") {
        if !slot_in_rack(conn, rack, slot).await? {
            return Err(error(StatusCode::NOT_FOUND, SLOT_404));
        }
    }
    Ok(())
}

pub async fn list_adapters(
    State(st): State<AppState>,
    _u: CurrentUser,
    Path(rack): Path<String>,
) -> Response {
    let run = async {
        let mut conn = st.pool.acquire().await.map_err(db_error)?;
        // arkyo: no `orderBy`; oldest first here, for a stable answer.
        let rows = sqlx::query(
            r#"SELECT * FROM "SynopticAdapter" WHERE "rackId" = ? ORDER BY "createdAt" ASC, rowid ASC"#,
        )
        .bind(&rack)
        .fetch_all(&mut *conn)
        .await
        .map_err(db_error)?;
        let rows = rows.iter().map(|r| row_map(r, &ADAPTER)).collect();
        let out = enrich(&mut conn, rows).await?;
        Ok::<_, Response>(Json(Value::Array(out)).into_response())
    };
    run.await.unwrap_or_else(|r| r)
}

pub async fn create_adapter(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(rack): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    run_create_adapter(&st, &me, &rack, &headers, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn run_create_adapter(
    st: &AppState,
    me: &User,
    rack: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    let mut obj = validate(&parse_body(&body)?, &ADAPTER_CREATE)?;
    let id = match obj.remove("id") {
        Some(Value::String(s)) => s,
        _ => new_id(),
    };
    if let Some(a) = obj.remove("adapterId") {
        obj.insert("catalogAdapterId".into(), a);
    }

    let mut tx = begin(&st.pool).await?;
    let found: Option<i64> = sqlx::query_scalar(r#"SELECT 1 FROM "Rack" WHERE "id" = ?"#)
        .bind(rack)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
    if found.is_none() {
        return Err(error(StatusCode::NOT_FOUND, "Not found"));
    }
    check_attached(&mut tx, rack, &obj).await?;
    let existing: i64 =
        sqlx::query_scalar(r#"SELECT COUNT(*) FROM "SynopticAdapter" WHERE "rackId" = ?"#)
            .bind(rack)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_error)?;
    obj.insert("label".into(), json!(format!("#ADP{}", existing + 1)));
    insert(&mut tx, &ADAPTER, &id, rack, &obj)
        .await
        .map_err(insert_error)?;
    let created = fetch_adapter(&mut tx, rack, &id).await?;
    log(&mut tx, me, "synopticAdapter.create", &ADAPTER, &id).await?;
    tx.commit().await.map_err(db_error)?;

    st.events.publish_rack(
        rack,
        rack_payload("adapter_added", "adapter", created.clone()),
    );
    st.events.publish_meta(
        "synopticAdapter",
        "created",
        Some(&id),
        meta(rack, &id, client),
    );
    Ok(Json(created).into_response())
}

pub async fn update_adapter(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((rack, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    run_update_adapter(&st, &me, &rack, &id, &headers, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn run_update_adapter(
    st: &AppState,
    me: &User,
    rack: &str,
    id: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    let obj = validate(&parse_body(&body)?, &ADAPTER_PATCH)?;

    let mut tx = begin(&st.pool).await?;
    // arkyo-server: cherché dans ce rack (arkyo : `where {id}` seul).
    if fetch(&mut tx, &ADAPTER, rack, id).await?.is_none() {
        return Err(error(StatusCode::NOT_FOUND, ADAPTER_404));
    }
    check_attached(&mut tx, rack, &obj).await?;
    update_row(&mut tx, &ADAPTER, id, &obj)
        .await
        .map_err(db_error)?;
    let updated = fetch_adapter(&mut tx, rack, id).await?;
    tx.commit().await.map_err(db_error)?;

    st.events.publish_rack(
        rack,
        rack_payload("adapter_updated", "adapter", updated.clone()),
    );
    st.events.publish_meta(
        "synopticAdapter",
        "updated",
        Some(id),
        meta(rack, id, client),
    );
    Ok(Json(updated).into_response())
}

pub async fn remove_adapter(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((rack, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    // arkyo-server: cherché dans ce rack (arkyo : `where {id}` seul).
    remove(&st, &me, &rack, &id, &headers, &REMOVE_ADAPTER)
        .await
        .unwrap_or_else(|r| r)
}
