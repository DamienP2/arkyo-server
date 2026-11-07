//! Panels: arkyo:app/api/panels/route.ts (`GET`, `POST`),
//! arkyo:app/api/panels/[id]/route.ts (`GET`, `PATCH`, `DELETE`),
//! arkyo:app/api/panels/[id]/slots/route.ts (`POST`, `DELETE`) and
//! arkyo:app/api/panels/[id]/slots/[slotId]/route.ts (`PATCH`, `DELETE`).
//!
//! `POST`/`PATCH /api/panels[/:id]` have no Zod schema in arkyo: only the
//! name check (`"Nom requis"`), then Prisma. The slot routes answer Zod's
//! `{ error: flatten() }`. arkyo writes no audit row on these routes.
//!
//! Slots are enriched with `connectorTypeId` and `connectorType` (arkyo's
//! `fetchCatalogConnectorTypeMap`, read from the local catalogue by
//! [`enrich::connector_type_map`]).

#![allow(clippy::result_large_err)]

use std::collections::HashMap;

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::parametres::connectors;
use super::parametres::{
    bad, begin, bind, db_error, failure, parse_body, row_map, str_of, validate_flat, Field, Kind,
    Obj, Table,
};
use super::{error, require, AppState, CurrentUser};
use crate::ids::{new_id, now_iso};
use crate::projects::enrich;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/panels", get(list).post(create))
        .route("/panels/{id}", get(detail).patch(update).delete(remove))
        .route("/panels/{id}/slots", post(add_slot).delete(clear_slots))
        .route(
            "/panels/{id}/slots/{slot_id}",
            patch(update_slot).delete(remove_slot),
        )
}

/// The scalars of the Prisma `Panel` model, in the schema's order.
const PANEL_COLS: &str = r#""id", "name", "panelType", "accessoryType", "plateType", "heightU",
    "slotsPerU", "depthMm", "rearCableDepthMm", "notes", "private", "createdById", "createdAt",
    "updatedAt""#;

/// The scalars of the Prisma `PanelSlot` model, in the schema's order.
const SLOT_COLS: &str = r#""id", "panelId", "position", "sizeSlots", "label", "notes",
    "catalogConnectorTypeId", "mountD", "familyLabel""#;

const PANEL: Table = Table {
    name: "Panel",
    bools: &["private"],
    jsons: &[],
};

const PANEL_SLOT: Table = Table {
    name: "PanelSlot",
    bools: &["mountD"],
    jsons: &[],
};

const DENSE_MSG: &str = "Panneau trop dense pour un module Neutrik D (max 16 par U).";
const NO_D_MSG: &str = "Ce connecteur n'existe pas en version Neutrik D.";
const SLOT_NOT_FOUND: &str = "Slot introuvable";

/// The columns `POST /api/panels` reads besides `name` and `private`
/// (route.ts:63-75), each `body.x ?? default`: `null` takes the default.
/// Only used to refuse what Prisma would refuse.
static CREATE: [Field; 8] = [
    Field::new("panelType", Kind::Str).nullable(),
    Field::new("accessoryType", Kind::Str).nullable(),
    Field::new("plateType", Kind::Str).nullable(),
    Field::new("heightU", Kind::Int).nullable(),
    Field::new("slotsPerU", Kind::Int).nullable(),
    Field::new("depthMm", Kind::Int).nullable(),
    Field::new("rearCableDepthMm", Kind::Int).nullable(),
    Field::new("notes", Kind::Str).nullable(),
];

/// The columns `PATCH /api/panels/:id` writes ([id]/route.ts:67-73), each
/// when `!== undefined`. Only used to refuse what Prisma would refuse.
static UPDATE: [Field; 5] = [
    Field::new("name", Kind::Str),
    Field::new("heightU", Kind::Int),
    Field::new("slotsPerU", Kind::Int),
    Field::new("rearCableDepthMm", Kind::Int),
    Field::new("notes", Kind::Str).nullable(),
];

/// `createSlotSchema` (slots/route.ts:10-20).
static CREATE_SLOT: [Field; 7] = [
    Field::new("position", Kind::IntMin(1)).required(),
    Field::new("sizeSlots", Kind::IntMin(1)),
    Field::new("label", Kind::Str).nullable(),
    Field::new("notes", Kind::Str).nullable(),
    Field::new("connectorTypeId", Kind::Str).nullable(),
    // Pose en coque Neutrik D — cf. commentaire schéma `PanelSlot.mountD`.
    Field::new("mountD", Kind::Bool),
    // Famille choisie au drag (label de CatalogFunction) — cf. schéma.
    Field::new("familyLabel", Kind::Str).nullable(),
];

/// `updateSlotSchema` (slots/[slotId]/route.ts:10-20).
static UPDATE_SLOT: [Field; 7] = [
    Field::new("label", Kind::Str).nullable(),
    Field::new("notes", Kind::Str).nullable(),
    Field::new("connectorTypeId", Kind::Str).nullable(),
    Field::new("position", Kind::IntMin(1)),
    Field::new("sizeSlots", Kind::IntMin(1)),
    Field::new("mountD", Kind::Bool),
    Field::new("familyLabel", Kind::Str).nullable(),
];

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Not found")
}

/// A body Prisma would refuse (a string for an `Int`, `null` for a required
/// column…).
/// arkyo-server: Prisma levait une erreur (500) dans arkyo.
fn invalid_body() -> Response {
    bad("Corps de requête invalide")
}

/// `true` when `v` is a JSON `true` (`=== true`).
fn is_true(v: Option<&Value>) -> bool {
    v == Some(&Value::Bool(true))
}

/// `?, ?, …` for `n` values.
fn marks(n: usize) -> String {
    vec!["?"; n].join(", ")
}

// ── rows ────────────────────────────────────────────────────────────────────

/// The panels `filter` selects (a literal of the routes), newest first.
async fn panel_rows(
    conn: &mut SqliteConnection,
    filter: &str,
    binds: &[&str],
) -> Result<Vec<Obj>, sqlx::Error> {
    let sql = format!(
        r#"SELECT {PANEL_COLS} FROM "Panel" {filter} ORDER BY "createdAt" DESC, "id" DESC"#
    );
    let mut q = sqlx::query(&sql);
    for b in binds {
        q = q.bind(*b);
    }
    Ok(q.fetch_all(conn)
        .await?
        .iter()
        .map(|r| row_map(r, &PANEL))
        .collect())
}

/// Adds `connectorTypeId` and `connectorType` (or `null`) to every slot.
async fn enrich_slots(conn: &mut SqliteConnection, slots: &mut [Obj]) -> Result<(), sqlx::Error> {
    let mut ids: Vec<String> = slots
        .iter()
        .filter_map(|s| str_of(s, "catalogConnectorTypeId"))
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .collect();
    ids.sort_unstable();
    ids.dedup();
    let map = enrich::connector_type_map(conn, &ids).await?;
    for s in slots.iter_mut() {
        let ct = s
            .get("catalogConnectorTypeId")
            .cloned()
            .unwrap_or(Value::Null);
        let lite = ct
            .as_str()
            .and_then(|id| map.get(id))
            .cloned()
            .unwrap_or(Value::Null);
        s.insert("connectorTypeId".into(), ct);
        s.insert("connectorType".into(), lite);
    }
    Ok(())
}

/// Adds the enriched `slots` to every panel: by `position` (the detail and
/// the writes, `orderBy: { position: "asc" }`), or in insertion order (the
/// list, `slots: true`).
async fn attach_slots(
    conn: &mut SqliteConnection,
    panels: &mut [Obj],
    by_position: bool,
) -> Result<(), sqlx::Error> {
    let ids: Vec<String> = panels
        .iter()
        .filter_map(|p| str_of(p, "id").map(str::to_string))
        .collect();
    if ids.is_empty() {
        return Ok(());
    }
    let order = if by_position {
        r#""position", "rowid""#
    } else {
        r#""rowid""#
    };
    let sql = format!(
        r#"SELECT {SLOT_COLS} FROM "PanelSlot" WHERE "panelId" IN ({}) ORDER BY {order}"#,
        marks(ids.len())
    );
    let mut q = sqlx::query(&sql);
    for id in &ids {
        q = q.bind(id);
    }
    let mut slots: Vec<Obj> = q
        .fetch_all(&mut *conn)
        .await?
        .iter()
        .map(|r| row_map(r, &PANEL_SLOT))
        .collect();
    enrich_slots(conn, &mut slots).await?;
    let mut by_panel: HashMap<String, Vec<Value>> = HashMap::new();
    for s in slots {
        let panel = str_of(&s, "panelId").unwrap_or_default().to_string();
        by_panel.entry(panel).or_default().push(Value::Object(s));
    }
    for p in panels.iter_mut() {
        let list = str_of(p, "id")
            .and_then(|id| by_panel.remove(id))
            .unwrap_or_default();
        p.insert("slots".into(), Value::Array(list));
    }
    Ok(())
}

/// The panel `id` with its slots by position, enriched (`enrichPanel`).
async fn panel(conn: &mut SqliteConnection, id: &str) -> Result<Option<Obj>, sqlx::Error> {
    let Some(p) = panel_rows(conn, r#"WHERE "id" = ?"#, &[id])
        .await?
        .into_iter()
        .next()
    else {
        return Ok(None);
    };
    let mut panels = [p];
    attach_slots(conn, &mut panels, true).await?;
    let [p] = panels;
    Ok(Some(p))
}

/// The slot `id`, enriched.
async fn slot(conn: &mut SqliteConnection, id: &str) -> Result<Option<Obj>, sqlx::Error> {
    let sql = format!(r#"SELECT {SLOT_COLS} FROM "PanelSlot" WHERE "id" = ?"#);
    let Some(row) = sqlx::query(&sql)
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?
    else {
        return Ok(None);
    };
    let mut slots = [row_map(&row, &PANEL_SLOT)];
    enrich_slots(conn, &mut slots).await?;
    let [s] = slots;
    Ok(Some(s))
}

/// `checkMountDAllowed` (slots/route.ts:30-55): a Neutrik D module needs
/// (a) a parent panel with `slotsPerU <= 16` (a missing panel fails this
/// guard too, as arkyo) and (b) a connector that exists in D, derived from
/// its symbol. Returns the French error, `None` when allowed.
///
/// The connector is read from `TenantConnectorType` (the local catalogue)
/// with the phase-2 derivation ([`connectors::has_neutrik_d`]).
async fn check_mount_d(
    conn: &mut SqliteConnection,
    panel_id: &str,
    connector_type_id: Option<&str>,
) -> Result<Option<&'static str>, sqlx::Error> {
    let per_u: Option<i64> =
        sqlx::query_scalar(r#"SELECT "slotsPerU" FROM "Panel" WHERE "id" = ?"#)
            .bind(panel_id)
            .fetch_optional(&mut *conn)
            .await?;
    if per_u.is_none_or(|n| n > 16) {
        return Ok(Some(DENSE_MSG));
    }
    let connector: Option<(Option<String>, Option<String>)> = match connector_type_id {
        Some(id) => {
            sqlx::query_as(r#"SELECT "iconId", "svgUrl" FROM "TenantConnectorType" WHERE "id" = ?"#)
                .bind(id)
                .fetch_optional(&mut *conn)
                .await?
        }
        None => None,
    };
    let symbols = connectors::load_symbols(conn).await?;
    let (icon, svg) = connector.unwrap_or_default();
    if connectors::has_neutrik_d(icon.as_deref(), svg.as_deref(), &symbols) {
        Ok(None)
    } else {
        Ok(Some(NO_D_MSG))
    }
}

// ── GET /api/panels ─────────────────────────────────────────────────────────

/// The panels (createdAt desc) with their slots. `?scope=inventaire`
/// includes the private ones (instances created from an inventory);
/// without it, only the public panels (reusable models, `/panels`).
pub async fn list(
    State(st): State<AppState>,
    // arkyo-server: garde serveur alignée sur l'UI (session ; arkyo ne
    // demandait rien sur cette lecture).
    _u: CurrentUser,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let include_private = q.get("scope").map(String::as_str) == Some("inventaire");
    let filter = if include_private {
        ""
    } else {
        r#"WHERE "private" = 0"#
    };
    let mut conn = match st.pool.acquire().await {
        Ok(c) => c,
        Err(e) => return db_error(e),
    };
    let res = async {
        let mut panels = panel_rows(&mut conn, filter, &[]).await?;
        attach_slots(&mut conn, &mut panels, false).await?;
        Ok::<_, sqlx::Error>(panels)
    }
    .await;
    match res {
        Ok(p) => Json(Value::Array(p.into_iter().map(Value::Object).collect())).into_response(),
        Err(e) => db_error(e),
    }
}

// ── POST /api/panels ────────────────────────────────────────────────────────

pub async fn create(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    body: Bytes,
) -> Response {
    create_inner(&st, &me, body).await.unwrap_or_else(|r| r)
}

async fn create_inner(
    st: &AppState,
    me: &crate::users::User,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let body = parse_body(&body)?;
    // arkyo-server: un nom qui n'est pas une chaîne donne aussi « Nom
    // requis » ; `body.name?.trim()` levait une TypeError (500) dans arkyo.
    let name = body
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .ok_or_else(|| bad("Nom requis"))?
        .to_string();
    // `createdById` is the current user: arkyo's lookup in the main
    // database (and its 401 « Session expirée, reconnectez-vous ») has no
    // object here, the session already resolves to an active user.
    let vals = validate_flat(&body, &CREATE).map_err(|_| invalid_body())?;
    let or = |k: &str, d: Value| vals.get(k).filter(|v| !v.is_null()).cloned().unwrap_or(d);
    let cols: [(&str, Value); 9] = [
        ("panelType", or("panelType", json!("PATCH"))),
        ("accessoryType", or("accessoryType", Value::Null)),
        ("plateType", or("plateType", Value::Null)),
        ("heightU", or("heightU", json!(1))),
        ("slotsPerU", or("slotsPerU", json!(8))),
        ("depthMm", or("depthMm", Value::Null)),
        ("rearCableDepthMm", or("rearCableDepthMm", json!(80))),
        ("notes", or("notes", Value::Null)),
        ("private", Value::Bool(is_true(body.get("private")))),
    ];

    let id = new_id();
    let now = now_iso();
    let sql = format!(
        r#"INSERT INTO "Panel" ("id", "name", "createdById", "createdAt", "updatedAt", {}) VALUES (?, ?, ?, ?, ?, {})"#,
        cols.iter()
            .map(|(c, _)| format!(r#""{c}""#))
            .collect::<Vec<_>>()
            .join(", "),
        marks(cols.len())
    );
    let mut tx = begin(&st.pool).await?;
    let mut q = sqlx::query(&sql)
        .bind(&id)
        .bind(&name)
        .bind(&me.id)
        .bind(&now)
        .bind(&now);
    for (_, v) in &cols {
        q = bind(q, v);
    }
    q.execute(&mut *tx).await.map_err(db_error)?;
    let panel = panel(&mut tx, &id)
        .await
        .map_err(db_error)?
        .ok_or_else(not_found)?;
    tx.commit().await.map_err(db_error)?;
    st.events.publish("panel", "create", Some(&id));
    Ok((StatusCode::CREATED, Json(Value::Object(panel))).into_response())
}

// ── GET /api/panels/:id ─────────────────────────────────────────────────────

/// The panel with its slots by position, enriched.
pub async fn detail(
    State(st): State<AppState>,
    // arkyo-server: garde serveur alignée sur l'UI (session ; arkyo ne
    // demandait rien sur cette lecture).
    _u: CurrentUser,
    Path(id): Path<String>,
) -> Response {
    let mut conn = match st.pool.acquire().await {
        Ok(c) => c,
        Err(e) => return db_error(e),
    };
    match panel(&mut conn, &id).await {
        Ok(Some(p)) => Json(Value::Object(p)).into_response(),
        Ok(None) => not_found(),
        Err(e) => db_error(e),
    }
}

// ── PATCH /api/panels/:id ───────────────────────────────────────────────────

pub async fn update(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    update_inner(&st, &me, &id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn update_inner(
    st: &AppState,
    me: &crate::users::User,
    id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let vals = validate_flat(&parse_body(&body)?, &UPDATE).map_err(|_| invalid_body())?;

    let mut tx = begin(&st.pool).await?;
    let current: Option<(i64, i64)> =
        sqlx::query_as(r#"SELECT "heightU", "slotsPerU" FROM "Panel" WHERE "id" = ?"#)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?;
    // arkyo-server: un panel inconnu donne 404 « Not found » ; Prisma levait
    // une erreur (500) dans arkyo, après avoir vidé ses slots.
    let (height_u, slots_per_u) = current.ok_or_else(not_found)?;
    let differs = |k: &str, cur: i64| {
        vals.get(k)
            .and_then(Value::as_f64)
            .is_some_and(|v| v != cur as f64)
    };
    // Changing the height or the density empties the panel (the editor has
    // already asked the user).
    if differs("heightU", height_u) || differs("slotsPerU", slots_per_u) {
        sqlx::query(r#"DELETE FROM "PanelSlot" WHERE "panelId" = ?"#)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }
    let cols: Vec<&str> = UPDATE
        .iter()
        .map(|f| f.name)
        .filter(|n| vals.contains_key(*n))
        .collect();
    let sets: String = cols.iter().map(|c| format!(r#", "{c}" = ?"#)).collect();
    let sql = format!(r#"UPDATE "Panel" SET "updatedAt" = ?{sets} WHERE "id" = ?"#);
    let mut q = sqlx::query(&sql).bind(now_iso());
    for c in &cols {
        q = bind(q, &vals[*c]);
    }
    q.bind(id).execute(&mut *tx).await.map_err(db_error)?;
    let panel = panel(&mut tx, id)
        .await
        .map_err(db_error)?
        .ok_or_else(not_found)?;
    tx.commit().await.map_err(db_error)?;
    st.events.publish("panel", "update", Some(id));
    Ok(Json(Value::Object(panel)).into_response())
}

// ── DELETE /api/panels/:id ──────────────────────────────────────────────────

/// The panel and its slots (`PanelSlot` ON DELETE CASCADE).
///
/// arkyo-server: écart assumé (4a M-1), sur le modèle de la garde de
/// l'adaptateur (4a I-4) : un panel utilisé par un contenant (`RackSlot` ou
/// `RackInventoryItem`) est refusé en 409. arkyo le supprimait, ces lignes
/// gardaient un `panelId` `NULL` (SetNull) : un slot « — » ineffaçable dans
/// l'élévation (son DELETE le rend fantôme) et une ligne d'inventaire
/// invisible.
pub async fn remove(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    remove_inner(&st, &me, &id).await.unwrap_or_else(|r| r)
}

async fn remove_inner(
    st: &AppState,
    me: &crate::users::User,
    id: &str,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:admin).
    require(me, &st.pool, Domain::Design, Level::Admin).await?;
    let mut tx = begin(&st.pool).await?;
    // arkyo-server: garde d'usage, nombre de contenants distincts.
    let used: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM (
             SELECT "rackId" FROM "RackSlot" WHERE "panelId" = ?1
             UNION
             SELECT "rackId" FROM "RackInventoryItem" WHERE "panelId" = ?1)"#,
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_error)?;
    if used > 0 {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({
                "error": format!("Utilisé dans {used} contenant(s) — suppression impossible"),
                "usageCount": used,
            })),
        )
            .into_response());
    }
    let r = sqlx::query(r#"DELETE FROM "Panel" WHERE "id" = ?"#)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    // arkyo-server: un panel inconnu donne 404 « Not found » ; Prisma
    // levait une erreur (500) dans arkyo.
    if r.rows_affected() == 0 {
        return Err(not_found());
    }
    tx.commit().await.map_err(db_error)?;
    st.events.publish("panel", "delete", Some(id));
    Ok(Json(json!({ "ok": true })).into_response())
}

// ── POST /api/panels/:id/slots ──────────────────────────────────────────────

pub async fn add_slot(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(panel_id): Path<String>,
    body: Bytes,
) -> Response {
    add_slot_inner(&st, &me, &panel_id, body)
        .await
        .unwrap_or_else(|r| r)
}

async fn add_slot_inner(
    st: &AppState,
    me: &crate::users::User,
    panel_id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let vals = validate_flat(&parse_body(&body)?, &CREATE_SLOT).map_err(failure)?;
    let ct = vals.get("connectorTypeId").and_then(Value::as_str);

    let mut tx = begin(&st.pool).await?;
    // A Neutrik D module asked for explicitly at creation: both guards must
    // pass, otherwise 400 (there is no previous state to keep).
    if is_true(vals.get("mountD")) {
        if let Some(msg) = check_mount_d(&mut tx, panel_id, ct)
            .await
            .map_err(db_error)?
        {
            return Err(bad(msg));
        }
    }
    let id = new_id();
    let get = |k: &str| vals.get(k).cloned().unwrap_or(Value::Null);
    let q = sqlx::query(
        r#"INSERT INTO "PanelSlot" ("id", "panelId", "position", "sizeSlots", "label", "notes",
           "catalogConnectorTypeId", "mountD", "familyLabel") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&id)
    .bind(panel_id);
    let q = bind(q, &get("position"));
    let q = bind(q, &vals.get("sizeSlots").cloned().unwrap_or(json!(1)));
    let q = bind(q, &get("label"));
    let q = bind(q, &get("notes"));
    let q = bind(q, &get("connectorTypeId"));
    let q = bind(q, &Value::Bool(is_true(vals.get("mountD"))));
    let q = bind(q, &get("familyLabel"));
    if let Err(e) = q.execute(&mut *tx).await {
        // arkyo-server: un panel inconnu donne 404 « Not found » ; Prisma
        // levait une erreur de clé étrangère (500) dans arkyo.
        if let sqlx::Error::Database(d) = &e {
            if d.is_foreign_key_violation() {
                return Err(not_found());
            }
        }
        return Err(db_error(e));
    }
    let slot = slot(&mut tx, &id)
        .await
        .map_err(db_error)?
        .ok_or_else(not_found)?;
    tx.commit().await.map_err(db_error)?;
    // arkyo publishes the panel id here.
    st.events.publish("panel_slot", "create", Some(panel_id));
    Ok((StatusCode::CREATED, Json(Value::Object(slot))).into_response())
}

// ── DELETE /api/panels/:id/slots ────────────────────────────────────────────

/// Empties the panel.
pub async fn clear_slots(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(panel_id): Path<String>,
) -> Response {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    if let Err(r) = require(&me, &st.pool, Domain::Design, Level::Write).await {
        return r;
    }
    let res = sqlx::query(r#"DELETE FROM "PanelSlot" WHERE "panelId" = ?"#)
        .bind(&panel_id)
        .execute(&st.pool)
        .await;
    match res {
        Ok(_) => {
            st.events.publish("panel", "update", Some(&panel_id));
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => db_error(e),
    }
}

// ── PATCH /api/panels/:id/slots/:slotId ─────────────────────────────────────

pub async fn update_slot(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((_panel_id, slot_id)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    update_slot_inner(&st, &me, &slot_id, body)
        .await
        .unwrap_or_else(|r| r)
}

/// The slot is found by its id alone, as arkyo (the panel of the path is
/// not read).
async fn update_slot_inner(
    st: &AppState,
    me: &crate::users::User,
    slot_id: &str,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let vals = validate_flat(&parse_body(&body)?, &UPDATE_SLOT).map_err(failure)?;

    let mut tx = begin(&st.pool).await?;
    let current: Option<(String, Option<String>, bool)> = sqlx::query_as(
        r#"SELECT "panelId", "catalogConnectorTypeId", "mountD" FROM "PanelSlot" WHERE "id" = ?"#,
    )
    .bind(slot_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?;
    let (panel_id, current_ct, current_mount_d) =
        current.ok_or_else(|| error(StatusCode::NOT_FOUND, SLOT_NOT_FOUND))?;

    let touches_mount_d = vals.contains_key("mountD");
    let touches_connector = vals.contains_key("connectorTypeId");
    let mut final_mount_d = vals
        .get("mountD")
        .and_then(Value::as_bool)
        .unwrap_or(current_mount_d);

    // The guards are only re-checked when mountD or connectorTypeId is
    // touched by this PATCH and the result would be true: a PATCH of the
    // label alone never re-validates.
    if final_mount_d && (touches_mount_d || touches_connector) {
        let effective = if touches_connector {
            vals.get("connectorTypeId")
                .and_then(Value::as_str)
                .map(str::to_string)
        } else {
            current_ct
        };
        if let Some(msg) = check_mount_d(&mut tx, &panel_id, effective.as_deref())
            .await
            .map_err(db_error)?
        {
            if touches_mount_d {
                // Explicit request (mountD in the body): refuse rather than
                // reset silently.
                return Err(bad(msg));
            }
            // Only the connector changed (mountD inherited): the new
            // connector has no D version, so the D mount is dropped.
            final_mount_d = false;
        }
    }

    // `connectorTypeId` is stored as `catalogConnectorTypeId`.
    let mut sets: Vec<(&str, Value)> = UPDATE_SLOT
        .iter()
        .map(|f| f.name)
        .filter(|n| *n != "mountD")
        .filter_map(|n| {
            let col = if n == "connectorTypeId" {
                "catalogConnectorTypeId"
            } else {
                n
            };
            vals.get(n).map(|v| (col, v.clone()))
        })
        .collect();
    sets.push(("mountD", Value::Bool(final_mount_d)));
    let sql = format!(
        r#"UPDATE "PanelSlot" SET {} WHERE "id" = ?"#,
        sets.iter()
            .map(|(c, _)| format!(r#""{c}" = ?"#))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let mut q = sqlx::query(&sql);
    for (_, v) in &sets {
        q = bind(q, v);
    }
    q.bind(slot_id).execute(&mut *tx).await.map_err(db_error)?;
    let slot = slot(&mut tx, slot_id)
        .await
        .map_err(db_error)?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, SLOT_NOT_FOUND))?;
    tx.commit().await.map_err(db_error)?;
    st.events.publish("panel_slot", "update", Some(slot_id));
    Ok(Json(Value::Object(slot)).into_response())
}

// ── DELETE /api/panels/:id/slots/:slotId ────────────────────────────────────

/// Found by the slot id alone, as arkyo.
pub async fn remove_slot(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((_panel_id, slot_id)): Path<(String, String)>,
) -> Response {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    if let Err(r) = require(&me, &st.pool, Domain::Design, Level::Write).await {
        return r;
    }
    let res = sqlx::query(r#"DELETE FROM "PanelSlot" WHERE "id" = ?"#)
        .bind(&slot_id)
        .execute(&st.pool)
        .await;
    match res {
        // arkyo-server: un slot inconnu donne 404 « Slot introuvable » (le
        // message du PATCH) ; Prisma levait une erreur (500) dans arkyo.
        Ok(r) if r.rows_affected() == 0 => error(StatusCode::NOT_FOUND, SLOT_NOT_FOUND),
        Ok(_) => {
            st.events.publish("panel_slot", "delete", Some(&slot_id));
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => db_error(e),
    }
}
