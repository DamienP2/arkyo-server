//! Project connections (inter-rack cables of the project synoptic):
//! arkyo:app/api/tenant/projects/[id]/synoptic/connections/route.ts
//! (`POST`), `[connectionId]/route.ts` (`PATCH`, `DELETE`) and
//! `renumber/route.ts` (`POST`) (phase-4 inventory, annex C §7-9). The
//! `GET` of the list is not ported (dead route, 4c decision 1).
//!
//! - `POST {from, to, label?, color?, waypoints?, cableStyle?, notes?,
//!   tags?, bundleId?}`: an endpoint is `{rackId, slotId?, connectorIndex?,
//!   adapterId?, adapterPortIndex?, adapterSide?}`, never a slot and an
//!   adapter at once. Both racks must be racks of the project
//!   (`rigs.some.rigConfig.projectId`), else 404 « Un rack n'appartient pas
//!   à ce projet » : two endpoints on the same rack give one row, so an
//!   intra-rack cable is always this 404, as in arkyo. Two racks of the
//!   same location give 400 (the cable is drawn in the location view). The
//!   rack check also refuses a cable spanning two projects (arkyo's own
//!   check). `catalogCableModelId` is not accepted at creation. 201, the
//!   row.
//! - `PATCH`: every field optional and nullable; a key present is written
//!   (`null` clears, `label` included). 200, the row.
//! - `DELETE`: `{ok: true}`.
//! - `renumber`: every connection of the project, in creation order, with
//!   one counter per `prefix:dirDigit` for the whole project; the signal of
//!   a cable is its `from` port's, else its `to` port's; direction digit
//!   `3` when either end is `BIDI`/`BIDIR`, `1` when `from` is `IN`, else
//!   `2`; rack segment and `numberingOverride` of the `from` rack; a label
//!   already given in this pass is skipped. `{ok: true, count}`; no
//!   connection gives `{ok: true, count: 0}` with neither audit nor event.
//!   The configuration and catalogue helpers are those of the rack
//!   renumbering ([`super::super::rack_renumber`]).
//!
//! Errors: 404 « Not found » (project, or connection absent or of another
//! project), 400 « Validation invalide » with Zod's issues. Audit
//! `create_project_connection` (`after {fromRackId, toRackId}`),
//! `update_project_connection` (`after` = the parsed body),
//! `delete_project_connection` / `ProjectConnection` / id, and
//! `project_connection.renumber` / `Project` / projectId, all with
//! `projectId`. App bus `project_synoptic_connection`: `created` (id,
//! `{projectId, rackId: from.rackId, itemId, clientId}`), `updated` /
//! `deleted` (id, `{projectId, itemId, clientId}`), `renumbered`
//! (projectId, `{projectId, clientId}`).
//!
//! arkyo-server:
//! - mode fantôme SaaS retiré (`assertNotGhost`, no-op dans arkyo) ;
//! - garde serveur `projects:write` (arkyo : session seule) ;
//! - une transaction `BEGIN IMMEDIATE` par écriture, contrôles et audit
//!   compris (arkyo : audit hors transaction) ;
//! - 404 au lieu des clés étrangères en 500 : un `slotId` absent ou d'un
//!   autre rack que celui de son extrémité (« Slot introuvable »), un
//!   `adapterId` absent ou d'un autre projet (« Adaptateur introuvable »),
//!   un `bundleId` absent ou d'un autre projet (« Bundle introuvable »).
//!   La route est rattachée au projet : aucune référence d'un autre projet
//!   n'est acceptée ;
//! - renumérotation : catalogue local (`TenantSignalType`,
//!   `TenantFunction`, `TenantEquipment.connectors`) au lieu de `mainDb`.

#![allow(clippy::result_large_err)]

use std::collections::{HashMap, HashSet};

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::SqliteConnection;

use super::super::parametres::{
    begin, bind, db_error, js_type, row_map, str_of, validate_flat, Field, Kind, Obj,
};
use super::super::rack_connections::{ADAPTER_404, SLOT_404};
use super::super::rack_renumber::{
    admin_config, apply_override, connector_info, counter_key, norm_code, signal_affixes, PortInfo,
};
use super::super::{client_id, error, require, AppState, CurrentUser};
use super::synoptic_general::PROJECT_CONNECTION_COLS;
use super::{invalid, issue, lenient_body, rack_in_project, zod_issues};
use crate::audit;
use crate::events::EventMeta;
use crate::ids::{new_id, now_iso};
use crate::numbering::{compute_cable_label, CableLabelInput};
use crate::synoptic::focus_payload::PROJECT_CONNECTION;
use crate::users::User;

const ENTITY: &str = "project_synoptic_connection";
const NOT_FOUND: &str = "Not found";
const RACK_404: &str = "Un rack n'appartient pas à ce projet";
const SAME_LOCATION: &str = "Les deux extrémités sont dans le même emplacement — tirez un câble direct dans la vue de l'emplacement.";
const BOTH_ENDS: &str = "Endpoint ne peut pas avoir à la fois slotId et adapterId";
const BUNDLE_404: &str = "Bundle introuvable";

const SIDES: &[&str] = &["left", "right"];
const SIDE_MSG: &str = r#"Invalid option: expected one of "left"|"right""#;
const STYLES: &[&str] = &["ortho", "rounded", "arrow"];
const STYLE_MSG: &str = r#"Invalid option: expected one of "ortho"|"rounded"|"arrow""#;

/// `endpointSchema` (route.ts:13-25), before its `.refine`.
static ENDPOINT: [Field; 6] = [
    Field::new("rackId", Kind::NonEmpty).required(),
    Field::new("slotId", Kind::Str),
    Field::new("connectorIndex", Kind::Int),
    Field::new("adapterId", Kind::Str),
    Field::new("adapterPortIndex", Kind::Int),
    Field::new("adapterSide", Kind::Enum(SIDES, SIDE_MSG)),
];

/// The endpoint fields, as `ProjectConnection` columns after the side.
const ENDPOINT_COLS: [(&str, &str); 6] = [
    ("rackId", "RackId"),
    ("slotId", "SlotId"),
    ("connectorIndex", "ConnectorIndex"),
    ("adapterId", "AdapterId"),
    ("adapterPortIndex", "AdapterPortIndex"),
    ("adapterSide", "AdapterSide"),
];

/// `createSchema` (route.ts:27-37) without `from` / `to`. `z.unknown()`
/// accepts `null`.
static CREATE: [Field; 7] = [
    Field::new("label", Kind::Str),
    Field::new("color", Kind::Str),
    Field::new("waypoints", Kind::Any).nullable(),
    Field::new("cableStyle", Kind::Enum(STYLES, STYLE_MSG)),
    Field::new("notes", Kind::Str),
    Field::new("tags", Kind::Any).nullable(),
    Field::new("bundleId", Kind::Str),
];

/// `patchSchema` ([connectionId]/route.ts:12-21).
static PATCH: [Field; 8] = [
    Field::new("label", Kind::Str).nullable(),
    Field::new("color", Kind::Str).nullable(),
    Field::new("waypoints", Kind::Any).nullable(),
    Field::new("cableStyle", Kind::Enum(STYLES, STYLE_MSG)).nullable(),
    Field::new("notes", Kind::Str).nullable(),
    Field::new("tags", Kind::Any).nullable(),
    Field::new("bundleId", Kind::Str).nullable(),
    Field::new("catalogCableModelId", Kind::Str).nullable(),
];

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, NOT_FOUND)
}

/// A non-empty string (JavaScript truthiness).
fn truthy<'a>(o: &'a Obj, key: &str) -> Option<&'a str> {
    str_of(o, key).filter(|s| !s.is_empty())
}

// ── validation ──────────────────────────────────────────────────────────────

struct Create {
    ends: [(&'static str, Obj); 2],
    rest: Obj,
}

/// `createSchema.safeParse(body)`, as `zodIssuesFromError`: the issues of
/// `from` (paths `["from", …]`), `to`, then the other fields.
fn parse_create(body: &Value) -> Result<Create, Vec<Value>> {
    let Value::Object(obj) = body else {
        return Err(vec![issue(
            "root",
            &format!(
                "Invalid input: expected object, received {}",
                js_type(Some(body))
            ),
        )]);
    };
    let mut issues = Vec::new();
    let mut ends = Vec::with_capacity(2);
    for side in ["from", "to"] {
        let Some(v) = obj.get(side) else {
            issues.push(issue(
                side,
                "Invalid input: expected object, received undefined",
            ));
            continue;
        };
        match validate_flat(v, &ENDPOINT) {
            Ok(end) => {
                // The `.refine` runs on a valid endpoint only (Zod 4).
                if truthy(&end, "slotId").is_some() && truthy(&end, "adapterId").is_some() {
                    issues.push(issue(side, BOTH_ENDS));
                }
                ends.push((side, end));
            }
            Err((form, fields)) => {
                issues.extend(form.iter().map(|m| issue(side, m)));
                for f in &ENDPOINT {
                    for m in fields.get(f.name).into_iter().flatten() {
                        issues.push(json!({ "path": [side, f.name], "message": m }));
                    }
                }
            }
        }
    }
    let rest = match validate_flat(body, &CREATE) {
        Ok(r) => r,
        Err(flat) => {
            issues.extend(zod_issues(&CREATE, flat));
            Obj::new()
        }
    };
    if !issues.is_empty() {
        return Err(issues);
    }
    let [from, to]: [(&'static str, Obj); 2] = ends.try_into().map_err(|_| Vec::new())?;
    Ok(Create {
        ends: [from, to],
        rest,
    })
}

// ── checks ──────────────────────────────────────────────────────────────────

async fn project_exists(conn: &mut SqliteConnection, id: &str) -> Result<bool, Response> {
    let found: Option<i64> = sqlx::query_scalar(r#"SELECT 1 FROM "Project" WHERE "id" = ?"#)
        .bind(id)
        .fetch_optional(conn)
        .await
        .map_err(db_error)?;
    Ok(found.is_some())
}

/// The connection belongs to the project (`assertConnectionBelongsToProject`).
async fn owned(conn: &mut SqliteConnection, id: &str, project: &str) -> Result<(), Response> {
    let found: Option<i64> = sqlx::query_scalar(
        r#"SELECT 1 FROM "ProjectConnection" WHERE "id" = ? AND "projectId" = ?"#,
    )
    .bind(id)
    .bind(project)
    .fetch_optional(conn)
    .await
    .map_err(db_error)?;
    found.map(|_| ()).ok_or_else(not_found)
}

/// `SELECT 1 FROM table WHERE id = ? AND col = ?`, else `msg` (404).
async fn scoped(
    conn: &mut SqliteConnection,
    table: &str,
    id: &str,
    col: &str,
    owner: &str,
    msg: &str,
) -> Result<(), Response> {
    let found: Option<i64> = sqlx::query_scalar(&format!(
        r#"SELECT 1 FROM "{table}" WHERE "id" = ? AND "{col}" = ?"#
    ))
    .bind(id)
    .bind(owner)
    .fetch_optional(conn)
    .await
    .map_err(db_error)?;
    found
        .map(|_| ())
        .ok_or_else(|| error(StatusCode::NOT_FOUND, msg))
}

/// A `bundleId` (non-null) is a bundle of the project.
async fn check_bundle(
    conn: &mut SqliteConnection,
    obj: &Obj,
    project: &str,
) -> Result<(), Response> {
    match str_of(obj, "bundleId") {
        Some(b) => {
            scoped(
                conn,
                "ProjectCableBundle",
                b,
                "projectId",
                project,
                BUNDLE_404,
            )
            .await
        }
        None => Ok(()),
    }
}

/// The racks of both ends (route.ts:90-117): racks of the project, at two
/// different locations (or one of them without location).
async fn check_racks(
    conn: &mut SqliteConnection,
    project: &str,
    from: &str,
    to: &str,
) -> Result<(), Response> {
    let mut locations: Vec<Option<String>> = Vec::with_capacity(2);
    let ids: Vec<&str> = if from == to {
        vec![from]
    } else {
        vec![from, to]
    };
    for id in ids {
        if !rack_in_project(conn, id, project).await.map_err(db_error)? {
            continue;
        }
        let loc: Option<String> =
            sqlx::query_scalar(r#"SELECT "locationId" FROM "Rack" WHERE "id" = ?"#)
                .bind(id)
                .fetch_one(&mut *conn)
                .await
                .map_err(db_error)?;
        locations.push(loc);
    }
    // `racks.length < rackIds.length`: an intra-rack cable finds one row.
    if locations.len() < 2 {
        return Err(error(StatusCode::NOT_FOUND, RACK_404));
    }
    if let [Some(a), Some(b)] = &locations[..] {
        if a == b {
            return Err(error(StatusCode::BAD_REQUEST, SAME_LOCATION));
        }
    }
    Ok(())
}

/// The full row (Prisma scalars).
async fn fetch(conn: &mut SqliteConnection, id: &str) -> Result<Value, Response> {
    let row = sqlx::query(&format!(
        r#"SELECT {PROJECT_CONNECTION_COLS} FROM "ProjectConnection" WHERE "id" = ?"#
    ))
    .bind(id)
    .fetch_one(conn)
    .await
    .map_err(db_error)?;
    Ok(Value::Object(row_map(&row, &PROJECT_CONNECTION)))
}

fn event_meta(project: &str, item: &str, client: Option<String>) -> EventMeta {
    EventMeta {
        project_id: Some(project.to_string()),
        item_id: Some(item.to_string()),
        client_id: client,
        ..EventMeta::default()
    }
}

// ── POST ────────────────────────────────────────────────────────────────────

pub async fn create(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(project): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    run_create(&st, &me, &project, &headers, &body)
        .await
        .unwrap_or_else(|r| r)
}

async fn run_create(
    st: &AppState,
    me: &User,
    project: &str,
    headers: &HeaderMap,
    body: &Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let client = client_id::read(headers);
    let parsed = parse_create(&lenient_body(body))
        .map_err(|issues| invalid(StatusCode::BAD_REQUEST, issues))?;
    let [(_, from), (_, to)] = &parsed.ends;
    let from_rack = str_of(from, "rackId").unwrap_or_default().to_string();
    let to_rack = str_of(to, "rackId").unwrap_or_default();

    let mut tx = begin(&st.pool).await?;
    if !project_exists(&mut tx, project).await? {
        return Err(not_found());
    }
    check_racks(&mut tx, project, &from_rack, to_rack).await?;
    // arkyo-server: références vérifiées (arkyo : clé étrangère, 500).
    for (_, end) in &parsed.ends {
        let rack = str_of(end, "rackId").unwrap_or_default();
        if let Some(slot) = str_of(end, "slotId") {
            scoped(&mut tx, "RackSlot", slot, "rackId", rack, SLOT_404).await?;
        }
        if let Some(adapter) = str_of(end, "adapterId") {
            scoped(
                &mut tx,
                "ProjectSynopticAdapter",
                adapter,
                "projectId",
                project,
                ADAPTER_404,
            )
            .await?;
        }
    }
    check_bundle(&mut tx, &parsed.rest, project).await?;

    let id = new_id();
    let mut cols: Vec<String> = vec!["id".into(), "projectId".into(), "createdAt".into()];
    let mut vals: Vec<Value> = vec![json!(id), json!(project), json!(now_iso())];
    for (side, end) in &parsed.ends {
        for (key, col) in ENDPOINT_COLS {
            if let Some(v) = end.get(key) {
                cols.push(format!("{side}{col}"));
                vals.push(v.clone());
            }
        }
    }
    for (k, v) in &parsed.rest {
        cols.push(k.clone());
        vals.push(v.clone());
    }
    let sql = format!(
        r#"INSERT INTO "ProjectConnection" ({}) VALUES ({})"#,
        cols.iter()
            .map(|c| format!(r#""{c}""#))
            .collect::<Vec<_>>()
            .join(", "),
        vec!["?"; cols.len()].join(", ")
    );
    let mut q = sqlx::query(&sql);
    for v in &vals {
        q = bind(q, v);
    }
    q.execute(&mut *tx).await.map_err(db_error)?;
    audit::log(
        &mut tx,
        &me.id,
        "create_project_connection",
        "ProjectConnection",
        &id,
        Some(project),
        None,
        Some(json!({ "fromRackId": from_rack, "toRackId": to_rack })),
    )
    .await
    .map_err(db_error)?;
    let row = fetch(&mut tx, &id).await?;
    tx.commit().await.map_err(db_error)?;

    let mut meta = event_meta(project, &id, client);
    meta.rack_id = Some(from_rack);
    st.events.publish_meta(ENTITY, "created", Some(&id), meta);
    Ok((StatusCode::CREATED, Json(row)).into_response())
}

// ── PATCH ───────────────────────────────────────────────────────────────────

pub async fn update(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((project, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    run_update(&st, &me, &project, &id, &headers, &body)
        .await
        .unwrap_or_else(|r| r)
}

async fn run_update(
    st: &AppState,
    me: &User,
    project: &str,
    id: &str,
    headers: &HeaderMap,
    body: &Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let client = client_id::read(headers);

    let mut tx = begin(&st.pool).await?;
    // arkyo checks the connection before the body.
    owned(&mut tx, id, project).await?;
    let obj = validate_flat(&lenient_body(body), &PATCH)
        .map_err(|flat| invalid(StatusCode::BAD_REQUEST, zod_issues(&PATCH, flat)))?;
    // arkyo-server: faisceau vérifié (arkyo : P2025, 500).
    check_bundle(&mut tx, &obj, project).await?;
    if !obj.is_empty() {
        let sets: Vec<String> = obj.keys().map(|k| format!(r#""{k}" = ?"#)).collect();
        let sql = format!(
            r#"UPDATE "ProjectConnection" SET {} WHERE "id" = ?"#,
            sets.join(", ")
        );
        let mut q = sqlx::query(&sql);
        for v in obj.values() {
            q = bind(q, v);
        }
        q.bind(id).execute(&mut *tx).await.map_err(db_error)?;
    }
    audit::log(
        &mut tx,
        &me.id,
        "update_project_connection",
        "ProjectConnection",
        id,
        Some(project),
        None,
        Some(Value::Object(obj)),
    )
    .await
    .map_err(db_error)?;
    let row = fetch(&mut tx, id).await?;
    tx.commit().await.map_err(db_error)?;

    st.events
        .publish_meta(ENTITY, "updated", Some(id), event_meta(project, id, client));
    Ok(Json(row).into_response())
}

// ── DELETE ──────────────────────────────────────────────────────────────────

pub async fn remove(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path((project, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    run_remove(&st, &me, &project, &id, &headers)
        .await
        .unwrap_or_else(|r| r)
}

async fn run_remove(
    st: &AppState,
    me: &User,
    project: &str,
    id: &str,
    headers: &HeaderMap,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let client = client_id::read(headers);

    let mut tx = begin(&st.pool).await?;
    owned(&mut tx, id, project).await?;
    sqlx::query(r#"DELETE FROM "ProjectConnection" WHERE "id" = ?"#)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    audit::log(
        &mut tx,
        &me.id,
        "delete_project_connection",
        "ProjectConnection",
        id,
        Some(project),
        None,
        None,
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    st.events
        .publish_meta(ENTITY, "deleted", Some(id), event_meta(project, id, client));
    Ok(Json(json!({ "ok": true })).into_response())
}

// ── renumber ────────────────────────────────────────────────────────────────

pub async fn renumber(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(project): Path<String>,
    headers: HeaderMap,
) -> Response {
    run_renumber(&st, &me, &project, &headers)
        .await
        .unwrap_or_else(|r| r)
}

/// `id`, `fromRackId`, `fromSlotId`, `fromConnectorIndex`, `toSlotId`,
/// `toConnectorIndex`.
type ConnRow = (
    String,
    String,
    Option<String>,
    Option<i64>,
    Option<String>,
    Option<i64>,
);

/// `id`, `name`, `cableCode`, `numberingOverride`.
type RackRow = (String, String, Option<String>, Option<String>);

async fn run_renumber(
    st: &AppState,
    me: &User,
    project: &str,
    headers: &HeaderMap,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (projects:write).
    require(me, &st.pool, Domain::Projects, Level::Write).await?;
    let client = client_id::read(headers);

    let mut tx = begin(&st.pool).await?;
    if !project_exists(&mut tx, project).await? {
        return Err(not_found());
    }
    let updates = numbering(&mut tx, project).await.map_err(db_error)?;
    if updates.is_empty() {
        return Ok(Json(json!({ "ok": true, "count": 0 })).into_response());
    }
    for (id, label) in &updates {
        sqlx::query(r#"UPDATE "ProjectConnection" SET "label" = ? WHERE "id" = ?"#)
            .bind(label)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }
    audit::log(
        &mut tx,
        &me.id,
        "project_connection.renumber",
        "Project",
        project,
        Some(project),
        None,
        None,
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    st.events.publish_meta(
        ENTITY,
        "renumbered",
        Some(project),
        EventMeta {
            project_id: Some(project.to_string()),
            client_id: client,
            ..EventMeta::default()
        },
    );
    Ok(Json(json!({ "ok": true, "count": updates.len() })).into_response())
}

/// The labels of every connection of the project, in creation order
/// (renumber/route.ts:99-287).
async fn numbering(
    conn: &mut SqliteConnection,
    project: &str,
) -> Result<Vec<(String, String)>, sqlx::Error> {
    let conns: Vec<ConnRow> = sqlx::query_as(
        r#"SELECT "id", "fromRackId", "fromSlotId", "fromConnectorIndex", "toSlotId", "toConnectorIndex"
           FROM "ProjectConnection" WHERE "projectId" = ? ORDER BY "createdAt" ASC, rowid ASC"#,
    )
    .bind(project)
    .fetch_all(&mut *conn)
    .await?;
    if conns.is_empty() {
        return Ok(Vec::new());
    }

    // Connectors of the referenced slots (local catalogue).
    let slots: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT s."id", e."connectors" FROM "RackSlot" s
           LEFT JOIN "TenantEquipment" e ON e."id" = s."catalogEquipmentId"
           WHERE s."id" IN (SELECT "fromSlotId" FROM "ProjectConnection" WHERE "projectId" = ?
                            UNION SELECT "toSlotId" FROM "ProjectConnection" WHERE "projectId" = ?)"#,
    )
    .bind(project)
    .bind(project)
    .fetch_all(&mut *conn)
    .await?;
    let slot_connectors: HashMap<String, Value> = slots
        .into_iter()
        .filter_map(|(id, c)| Some((id, serde_json::from_str(&c?).ok()?)))
        .collect();
    let racks: Vec<RackRow> = sqlx::query_as(
        r#"SELECT "id", "name", "cableCode", "numberingOverride" FROM "Rack"
           WHERE "id" IN (SELECT "fromRackId" FROM "ProjectConnection" WHERE "projectId" = ?)"#,
    )
    .bind(project)
    .fetch_all(&mut *conn)
    .await?;
    let racks: HashMap<String, RackRow> = racks.into_iter().map(|r| (r.0.clone(), r)).collect();
    let admin = admin_config(conn).await?;
    let sig_map = signal_affixes(conn).await?;

    let info = |slot: &Option<String>, port: Option<i64>| -> PortInfo {
        match port {
            Some(p) => connector_info(slot.as_ref().and_then(|s| slot_connectors.get(s)), p),
            None => PortInfo::default(),
        }
    };
    let is_bidi = |d: &Option<String>| matches!(d.as_deref(), Some("BIDI" | "BIDIR"));

    let mut counters: HashMap<String, i64> = HashMap::new();
    let mut given: HashSet<String> = HashSet::new();
    let mut updates = Vec::with_capacity(conns.len());
    for (id, from_rack, from_slot, from_port, to_slot, to_port) in conns {
        let from = info(&from_slot, from_port);
        let to = info(&to_slot, to_port);
        // `fromInfo.signalName ?? toInfo.signalName`, then `if (!sigName)`.
        let (prefix, suffix) = from
            .signal
            .or(to.signal)
            .as_ref()
            .and_then(Value::as_str)
            .filter(|n| !n.is_empty())
            .and_then(|n| sig_map.get(n))
            .cloned()
            .unwrap_or_default();
        let dir = if is_bidi(&from.direction) || is_bidi(&to.direction) {
            "3"
        } else if from.direction.as_deref() == Some("IN") {
            "1"
        } else {
            "2"
        };

        let rack = racks.get(&from_rack);
        let mut config = admin.clone();
        apply_override(&mut config, rack.and_then(|r| r.3.as_deref()));
        let rack_code =
            rack.and_then(|r| norm_code(r.2.as_deref(), 5).or_else(|| norm_code(Some(&r.1), 4)));

        let key = counter_key(&prefix, dir);
        let mut num = counters.get(&key).copied().unwrap_or(0) + 1;
        let mut guard = 0;
        let label = loop {
            counters.insert(key.clone(), num);
            let label = compute_cable_label(&CableLabelInput {
                zone_code: None,
                rack_code: rack_code.as_deref(),
                signal_prefix: &prefix,
                signal_suffix: &suffix,
                dir_digit: dir,
                seq: num as f64,
                config: &config,
            });
            if given.contains(&label) {
                num += 1;
                guard += 1;
                if guard >= 10_000 {
                    break label;
                }
            } else {
                break label;
            }
        };
        given.insert(label.clone());
        updates.push((id, label));
    }
    Ok(updates)
}
