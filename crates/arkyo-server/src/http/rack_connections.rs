//! Rack connections (cables of the rack synoptic):
//! arkyo:app/api/racks/[id]/connections/route.ts (`GET`, `POST` single or
//! batch, `DELETE` batch) and
//! arkyo:app/api/racks/[id]/connections/[connId]/route.ts (`PATCH`,
//! `DELETE`) (phase-4 inventory, annex A §1.7, 1.8).
//!
//! - `POST` creates a batch when `{connections: [1..500]}`, one connection
//!   otherwise. The client's `id` (6 to 64 characters) is kept (optimistic
//!   creation, undo/redo). `notes`, `tags`, `catalogCableModelId`, `wired`,
//!   `bundleId` are not accepted at creation (Zod strips them); no automatic
//!   label (`label ?? null`, the renumbering sets it).
//! - Component ports (modular chassis): `fromComponentItemId` /
//!   `toComponentItemId` require their host slot (`.refine`), and must be a
//!   `RackInventoryItem` of this rack with a `hostItemId`: otherwise arkyo's
//!   400 « fromComponentItemId/toComponentItemId invalide (<id>) : item
//!   introuvable, hors rack, ou pas un composant », first bad id.
//! - `PATCH`: `null` means "unchanged" for `label`, `color`, `cableStyle`,
//!   `notes` and every endpoint field (arkyo converts `null` to `undefined`,
//!   so a label cannot be cleared here: parity, inventory §9.11); `null`
//!   clears `catalogCableModelId`, `waypoints` and `tags`.
//!   `catalogCableModelId` is a `TenantCableModel.id` (soft FK, 4c decision
//!   2): the usage guard is on the cable model
//!   (`catalogue::in_use::cable_model`).
//! - Audit: `rackConnection.create|update|delete` / `RackConnection` / id;
//!   batches `rackConnection.createMany` / `Rack` / rackId and
//!   `rackConnection.deleteMany` / `RackConnection` / rackId, both with
//!   `after: {ids, count}`.
//! - Rack bus: `connection_added {connection}` (one per created cable),
//!   `connection_updated {connection}`, `connection_removed {connId}` (one
//!   per requested id of a batch, unknown ones included). App bus
//!   `rackConnection created|updated|deleted`: id and `{rackId, itemId,
//!   clientId}` for one connection, rackId and `{rackId, clientId}` for a
//!   batch.
//! - Deleting a slot, an adapter, a component (or its host) or the rack
//!   removes its cables, and with them their bundle membership (0004).
//!
//! arkyo-server:
//! - mode fantôme SaaS retiré (`assertNotGhost`, 403 « Mode lecture seule ») ;
//! - garde serveur `design:write` sur les écritures (arkyo : session seule) ;
//! - une transaction `BEGIN IMMEDIATE` par écriture, audit compris (arkyo :
//!   lot en transaction, audit hors bloc) ;
//! - 400/404/409 au lieu des 500 implicites : corps illisible (400, sauf le
//!   `DELETE` en lot, qui le lit comme `null`, comme arkyo), rack inconnu au
//!   `POST` (404 « Not found »), connexion inconnue ou d'un autre rack
//!   (404 « Connexion introuvable », arkyo : P2025), identifiant client déjà
//!   pris (409, arkyo : P2002) ;
//! - une extrémité (slot ou adaptateur) inexistante donne 404 « Slot
//!   introuvable » / « Adaptateur introuvable » (arkyo : clé étrangère,
//!   500). Celle d'un autre rack est acceptée, comme dans arkyo : la vue
//!   lieu glisse une extrémité sur n'importe quel port du lieu et envoie le
//!   `PATCH` au rack du câble (`location-canvas.tsx`, `patchOne`), et
//!   l'annulation recrée ce câble par le `POST` en lot ;
//! - un corps `{connections: …}` invalide est refusé (400, `fieldErrors.
//!   connections`) : arkyo retombait sur le schéma unitaire et créait une
//!   connexion vide.
//!
//! The port index itself is not checked against the equipment's connectors,
//! as in arkyo (virtual rows and component ports are resolved by the
//! client).

#![allow(clippy::result_large_err)]

use std::collections::BTreeMap;

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
    begin, bind, db_error, failure, js_type, parse_body, row_map, validate, validate_flat, Field,
    Flat, Kind, Obj, Table,
};
use super::rack_objects::{
    audit_row, fetch_row, insert_error, meta, rack_payload, remove_row, Removal,
};
use super::{client_id, error, require, AppState, CurrentUser};
use crate::audit;
use crate::events::EventMeta;
use crate::ids::{new_id, now_iso};
use crate::users::User;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/racks/{id}/connections",
            get(list).post(create).delete(remove_many),
        )
        .route(
            "/racks/{id}/connections/{object_id}",
            patch(update).delete(remove_one),
        )
}

pub(super) static CONN: Table = Table {
    name: "RackConnection",
    bools: &["wired"],
    jsons: &["waypoints", "tags"],
};

const ENTITY: &str = "rackConnection";
const CONN_404: &str = "Connexion introuvable";
const SLOT_404: &str = "Slot introuvable";
const ADAPTER_404: &str = "Adaptateur introuvable";

const SIDES: &[&str] = &["left", "right"];
const SIDE_MSG: &str = r#"Invalid option: expected one of "left"|"right""#;

/// `createSchema` of connections/route.ts:10-38 (before its `.refine`s).
static CREATE: [Field; 17] = [
    Field::new("id", Kind::StrLen(6, 64)),
    Field::new("fromSlotId", Kind::Str).nullable(),
    Field::new("fromConnectorIndex", Kind::IntMin(0)).nullable(),
    Field::new("fromAdapterId", Kind::Str).nullable(),
    Field::new("fromAdapterSide", Kind::Enum(SIDES, SIDE_MSG)).nullable(),
    Field::new("fromAdapterPortIndex", Kind::IntMin(0)).nullable(),
    Field::new("fromComponentItemId", Kind::Str).nullable(),
    Field::new("toSlotId", Kind::Str).nullable(),
    Field::new("toConnectorIndex", Kind::IntMin(0)).nullable(),
    Field::new("toAdapterId", Kind::Str).nullable(),
    Field::new("toAdapterSide", Kind::Enum(SIDES, SIDE_MSG)).nullable(),
    Field::new("toAdapterPortIndex", Kind::IntMin(0)).nullable(),
    Field::new("toComponentItemId", Kind::Str).nullable(),
    Field::new("label", Kind::Str).nullable(),
    Field::new("color", Kind::Str).nullable(),
    Field::new("waypoints", Kind::Points).nullable(),
    Field::new("cableStyle", Kind::Str).nullable(),
];

/// `updateSchema` of connections/[connId]/route.ts:10-43 (indices without
/// `min(0)`), before its `.refine`s.
static UPDATE: [Field; 19] = [
    Field::new("label", Kind::Str).nullable(),
    Field::new("color", Kind::Str).nullable(),
    Field::new("waypoints", Kind::Points).nullable(),
    Field::new("cableStyle", Kind::Str).nullable(),
    Field::new("notes", Kind::MaxLen(2000)).nullable(),
    Field::new("tags", Kind::Tags).nullable(),
    Field::new("catalogCableModelId", Kind::Str).nullable(),
    Field::new("fromSlotId", Kind::Str).nullable(),
    Field::new("fromConnectorIndex", Kind::Int).nullable(),
    Field::new("fromAdapterId", Kind::Str).nullable(),
    Field::new("fromAdapterSide", Kind::Enum(SIDES, SIDE_MSG)).nullable(),
    Field::new("fromAdapterPortIndex", Kind::Int).nullable(),
    Field::new("fromComponentItemId", Kind::Str).nullable(),
    Field::new("toSlotId", Kind::Str).nullable(),
    Field::new("toConnectorIndex", Kind::Int).nullable(),
    Field::new("toAdapterId", Kind::Str).nullable(),
    Field::new("toAdapterSide", Kind::Enum(SIDES, SIDE_MSG)).nullable(),
    Field::new("toAdapterPortIndex", Kind::Int).nullable(),
    Field::new("toComponentItemId", Kind::Str).nullable(),
];

/// `batchDeleteSchema` (route.ts:208-210).
static BATCH_DELETE: [Field; 1] = [Field::new("ids", Kind::IdArr { min: 1, max: 500 }).required()];

/// PATCH fields where `null` is written (route.ts:120-132); for the others
/// `null` means "unchanged".
const NULL_CLEARS: &[&str] = &["catalogCableModelId", "waypoints", "tags"];

/// `batchCreateSchema`: 1 to 500 connections.
const BATCH_MAX: usize = 500;

// ── validation ──────────────────────────────────────────────────────────────

/// The `.refine`s of both schemas, on an otherwise valid body: a component
/// needs its host slot, truthy on `POST` (route.ts:39-46), not an explicit
/// `null` on `PATCH` ([connId]/route.ts:44-51), as a `flatten()`.
fn refine(obj: &Obj, patch: bool) -> Result<(), Flat> {
    let mut errs: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for side in ["from", "to"] {
        let truthy = |k: &str| matches!(obj.get(k), Some(Value::String(s)) if !s.is_empty());
        if !truthy(&format!("{side}ComponentItemId")) {
            continue;
        }
        let slot = format!("{side}SlotId");
        let refused = if patch {
            obj.get(&slot) == Some(&Value::Null)
        } else {
            !truthy(&slot)
        };
        if refused {
            let msg = if patch {
                format!("{side}ComponentItemId requiert {side}SlotId (slot hôte) non-null")
            } else {
                format!("{side}ComponentItemId requiert {side}SlotId (slot hôte)")
            };
            errs.entry(slot).or_default().push(msg);
        }
    }
    if errs.is_empty() {
        Ok(())
    } else {
        Err((vec![], errs))
    }
}

/// `createSchema.safeParse` of one connection, as a `flatten()` on error.
fn parse_one(body: &Value) -> Result<Obj, Flat> {
    let obj = validate_flat(body, &CREATE)?;
    refine(&obj, false)?;
    Ok(obj)
}

/// The connections of a `POST` body, and whether it was a batch.
fn parse_create(body: &Value) -> Result<(Vec<Obj>, bool), Response> {
    let Some(batch) = body.as_object().and_then(|o| o.get("connections")) else {
        return parse_one(body).map(|o| (vec![o], false)).map_err(failure);
    };
    // arkyo-server: correction, un lot invalide est refusé (arkyo retombait
    // sur `createSchema`, qui retire `connections`, et créait une connexion
    // vide).
    let mut msgs: Vec<String> = Vec::new();
    let mut out = Vec::new();
    match batch {
        Value::Array(items) => {
            for it in items {
                match parse_one(it) {
                    Ok(o) => out.push(o),
                    Err((form, fields)) => {
                        msgs.extend(form);
                        msgs.extend(fields.into_values().flatten());
                    }
                }
            }
            if items.is_empty() {
                msgs.push("Too small: expected array to have >=1 items".into());
            }
            if items.len() > BATCH_MAX {
                msgs.push(format!(
                    "Too big: expected array to have <={BATCH_MAX} items"
                ));
            }
        }
        other => msgs.push(format!(
            "Invalid input: expected array, received {}",
            js_type(Some(other))
        )),
    }
    if msgs.is_empty() {
        Ok((out, true))
    } else {
        Err(failure((
            vec![],
            BTreeMap::from([("connections".to_string(), msgs)]),
        )))
    }
}

/// `findInvalidComponentItemId` (route.ts:54-71): the first component id
/// (string values, in order) that is unknown, of another rack or not a
/// component, as arkyo's 400.
async fn check_components(
    conn: &mut SqliteConnection,
    rack: &str,
    rows: &[Obj],
) -> Result<(), Response> {
    let mut seen: Vec<&str> = Vec::new();
    for obj in rows {
        for k in ["fromComponentItemId", "toComponentItemId"] {
            if let Some(Value::String(id)) = obj.get(k) {
                if !seen.contains(&id.as_str()) {
                    seen.push(id);
                }
            }
        }
    }
    for id in seen {
        let row: Option<(String, Option<String>)> = sqlx::query_as(
            r#"SELECT "rackId", "hostItemId" FROM "RackInventoryItem" WHERE "id" = ?"#,
        )
        .bind(id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(db_error)?;
        if !matches!(row, Some((r, Some(_))) if r == rack) {
            return Err(error(
                StatusCode::BAD_REQUEST,
                &format!(
                    "fromComponentItemId/toComponentItemId invalide ({id}) : item introuvable, hors rack, ou pas un composant"
                ),
            ));
        }
    }
    Ok(())
}

/// The slots and adapters named (non-null values) exist, in any rack (see
/// the module notes). arkyo-server: 404 au lieu de la clé étrangère en 500.
async fn check_endpoints(conn: &mut SqliteConnection, rows: &[Obj]) -> Result<(), Response> {
    for obj in rows {
        for (k, table, msg) in [
            ("fromSlotId", "RackSlot", SLOT_404),
            ("fromAdapterId", "SynopticAdapter", ADAPTER_404),
            ("toSlotId", "RackSlot", SLOT_404),
            ("toAdapterId", "SynopticAdapter", ADAPTER_404),
        ] {
            let Some(Value::String(id)) = obj.get(k) else {
                continue;
            };
            let found: Option<i64> =
                sqlx::query_scalar(&format!(r#"SELECT 1 FROM "{table}" WHERE "id" = ?"#))
                    .bind(id)
                    .fetch_optional(&mut *conn)
                    .await
                    .map_err(db_error)?;
            if found.is_none() {
                return Err(error(StatusCode::NOT_FOUND, msg));
            }
        }
    }
    Ok(())
}

// ── shared helpers ──────────────────────────────────────────────────────────

/// `{rackId, clientId}` of the batch app events.
fn batch_meta(rack: &str, client: Option<String>) -> EventMeta {
    EventMeta {
        rack_id: Some(rack.to_string()),
        client_id: client,
        ..EventMeta::default()
    }
}

// ── GET ─────────────────────────────────────────────────────────────────────

pub async fn list(
    State(st): State<AppState>,
    _u: CurrentUser,
    Path(rack): Path<String>,
) -> Response {
    let rows = sqlx::query(
        r#"SELECT * FROM "RackConnection" WHERE "rackId" = ? ORDER BY "createdAt" ASC, rowid ASC"#,
    )
    .bind(&rack)
    .fetch_all(&st.pool)
    .await;
    match rows {
        Ok(rows) => Json(Value::Array(
            rows.iter()
                .map(|r| Value::Object(row_map(r, &CONN)))
                .collect(),
        ))
        .into_response(),
        Err(e) => db_error(e),
    }
}

// ── POST ────────────────────────────────────────────────────────────────────

pub async fn create(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(rack): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    run_create(&st, &me, &rack, &headers, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn run_create(
    st: &AppState,
    me: &User,
    rack: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    let (mut conns, is_batch) = parse_create(&parse_body(&body)?)?;

    let mut tx = begin(&st.pool).await?;
    let found: Option<i64> = sqlx::query_scalar(r#"SELECT 1 FROM "Rack" WHERE "id" = ?"#)
        .bind(rack)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
    if found.is_none() {
        return Err(error(StatusCode::NOT_FOUND, "Not found"));
    }
    check_components(&mut tx, rack, &conns).await?;
    check_endpoints(&mut tx, &conns).await?;

    let now = now_iso();
    let mut ids = Vec::with_capacity(conns.len());
    for obj in &mut conns {
        let id = match obj.remove("id") {
            Some(Value::String(s)) => s,
            _ => new_id(),
        };
        let cols: String = obj.keys().map(|k| format!(r#", "{k}""#)).collect();
        let marks: String = obj.keys().map(|_| ", ?").collect();
        let sql = format!(
            r#"INSERT INTO "RackConnection" ("id", "rackId", "createdAt"{cols})
               VALUES (?, ?, ?{marks})"#
        );
        let mut q = sqlx::query(&sql).bind(&id).bind(rack).bind(&now);
        for v in obj.values() {
            q = bind(q, v);
        }
        q.execute(&mut *tx).await.map_err(insert_error)?;
        ids.push(id);
    }
    if is_batch {
        audit::log(
            &mut tx,
            &me.id,
            "rackConnection.createMany",
            "Rack",
            rack,
            None,
            None,
            Some(json!({ "ids": ids, "count": ids.len() })),
        )
        .await
        .map_err(db_error)?;
    } else {
        audit_row(&mut tx, me, "rackConnection.create", &CONN, &ids[0]).await?;
    }
    let mut rows = Vec::with_capacity(ids.len());
    for id in &ids {
        let row = fetch_row(&mut tx, &CONN, rack, id)
            .await?
            .ok_or_else(|| db_error(sqlx::Error::RowNotFound))?;
        rows.push(Value::Object(row));
    }
    tx.commit().await.map_err(db_error)?;

    for row in &rows {
        st.events.publish_rack(
            rack,
            rack_payload("connection_added", "connection", row.clone()),
        );
    }
    if is_batch {
        st.events
            .publish_meta(ENTITY, "created", Some(rack), batch_meta(rack, client));
        Ok(Json(Value::Array(rows)).into_response())
    } else {
        st.events.publish_meta(
            ENTITY,
            "created",
            Some(&ids[0]),
            meta(rack, &ids[0], client),
        );
        Ok(Json(rows.remove(0)).into_response())
    }
}

// ── PATCH ───────────────────────────────────────────────────────────────────

pub async fn update(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((rack, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    run_update(&st, &me, &rack, &id, &headers, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn run_update(
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
    let mut obj = validate(&parse_body(&body)?, &UPDATE)?;
    refine(&obj, true).map_err(failure)?;
    // `null` → `undefined` (unchanged), except the soft FK and the JSON
    // columns ([connId]/route.ts:113-132).
    obj.retain(|k, v| !v.is_null() || NULL_CLEARS.contains(&k.as_str()));

    let mut tx = begin(&st.pool).await?;
    if fetch_row(&mut tx, &CONN, rack, id).await?.is_none() {
        return Err(error(StatusCode::NOT_FOUND, CONN_404));
    }
    let rows = [obj];
    check_components(&mut tx, rack, &rows).await?;
    check_endpoints(&mut tx, &rows).await?;
    let [obj] = rows;
    if !obj.is_empty() {
        let sets: Vec<String> = obj.keys().map(|k| format!(r#""{k}" = ?"#)).collect();
        let sql = format!(
            r#"UPDATE "RackConnection" SET {} WHERE "id" = ?"#,
            sets.join(", ")
        );
        let mut q = sqlx::query(&sql);
        for v in obj.values() {
            q = bind(q, v);
        }
        q.bind(id).execute(&mut *tx).await.map_err(db_error)?;
    }
    audit_row(&mut tx, me, "rackConnection.update", &CONN, id).await?;
    let row = fetch_row(&mut tx, &CONN, rack, id)
        .await?
        .ok_or_else(|| db_error(sqlx::Error::RowNotFound))?;
    tx.commit().await.map_err(db_error)?;

    let row = Value::Object(row);
    st.events.publish_rack(
        rack,
        rack_payload("connection_updated", "connection", row.clone()),
    );
    st.events
        .publish_meta(ENTITY, "updated", Some(id), meta(rack, id, client));
    Ok(Json(row).into_response())
}

// ── DELETE ──────────────────────────────────────────────────────────────────

pub async fn remove_one(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((rack, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    remove_row(&st, &me, &rack, &id, &headers, &REMOVE)
        .await
        .unwrap_or_else(|r| r)
}

static REMOVE: Removal = Removal {
    table: &CONN,
    not_found: CONN_404,
    audit: "rackConnection.delete",
    rack_type: "connection_removed",
    rack_key: "connId",
    entity: ENTITY,
};

pub async fn remove_many(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(rack): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    run_remove_many(&st, &me, &rack, &headers, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn run_remove_many(
    st: &AppState,
    me: &User,
    rack: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    // `req.json().catch(() => null)` (route.ts:226).
    let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let obj = validate(&body, &BATCH_DELETE)?;
    let ids: Vec<Value> = obj["ids"].as_array().cloned().unwrap_or_default();

    let mut tx = begin(&st.pool).await?;
    let marks = vec!["?"; ids.len()].join(", ");
    let sql = format!(r#"DELETE FROM "RackConnection" WHERE "rackId" = ? AND "id" IN ({marks})"#);
    let mut q = sqlx::query(&sql).bind(rack);
    for id in &ids {
        q = bind(q, id);
    }
    let count = q.execute(&mut *tx).await.map_err(db_error)?.rows_affected();
    audit::log(
        &mut tx,
        &me.id,
        "rackConnection.deleteMany",
        CONN.name,
        rack,
        None,
        None,
        Some(json!({ "ids": ids, "count": count })),
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    for id in &ids {
        st.events.publish_rack(
            rack,
            rack_payload("connection_removed", "connId", id.clone()),
        );
    }
    st.events
        .publish_meta(ENTITY, "deleted", Some(rack), batch_meta(rack, client));
    Ok(Json(json!({ "ok": true, "count": count })).into_response())
}
