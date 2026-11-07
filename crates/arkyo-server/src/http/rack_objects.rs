//! Rack zones, labels and cable bundles of the synoptic:
//! arkyo:app/api/racks/[id]/zones/route.ts (`GET`, `POST`),
//! arkyo:app/api/racks/[id]/zones/[zoneId]/route.ts (`PATCH`, `DELETE`),
//! arkyo:app/api/racks/[id]/labels/route.ts (`GET`, `POST`),
//! arkyo:app/api/racks/[id]/labels/[labelId]/route.ts (`PATCH`, `DELETE`),
//! arkyo:app/api/racks/[id]/bundles/route.ts (`GET`, `POST`) and
//! arkyo:app/api/racks/[id]/bundles/[bundleId]/route.ts (`PATCH`, `DELETE`).
//!
//! The three objects share one flow (phase-4 inventory, annex A §1.4, 1.5,
//! 1.15, 1.16, 1.21, 1.22):
//! - `GET` lists the rack's rows, oldest first (an unknown rack gives `[]`,
//!   as in arkyo);
//! - `POST` accepts the client's `id` (6 to 64 characters, optimistic
//!   creation) or generates a cuid; Zod's defaults are the column defaults;
//!   200 with the row;
//! - `PATCH` writes the sent fields only; 200 with the row;
//! - `DELETE` answers `{ok: true}`;
//! - audit `<entity>.create|update|delete` / `<Model>` / id, no `before`
//!   or `after`;
//! - rack bus `{type: "<noun>_added|_updated", <noun>: row}` and
//!   `{type: "<noun>_removed", <noun>Id}`; app bus `<entity>
//!   created|updated|deleted` with `{rackId, itemId, clientId}`.
//!
//! Bundle members are `RackConnection.bundleId`: `cableIds` (POST) and
//! `addCableIds` attach the cables **of this rack** among the given ids,
//! the others are ignored as in arkyo (`updateMany where {rackId, id in}`);
//! `removeCableIds` only detaches the bundle's own cables. No
//! `connection_updated` event, as in arkyo. Deleting a bundle frees its
//! cables (`ON DELETE SET NULL`), deleting a cable or its slot removes the
//! member with the row (`ON DELETE CASCADE`), deleting the rack removes its
//! zones, labels and bundles (0004).
//!
//! arkyo-server:
//! - mode fantôme SaaS retiré (`assertNotGhost`, 403 « Mode lecture seule ») ;
//! - garde serveur `design:write` sur les écritures (arkyo : session seule) ;
//! - une transaction `BEGIN IMMEDIATE` par écriture, membres et audit
//!   compris (arkyo : écritures séquentielles, audit hors bloc) ;
//! - 400/404/409 au lieu des 500 implicites : corps illisible (400), rack
//!   inconnu au `POST` (404 « Not found », arkyo : clé étrangère), objet
//!   inconnu ou d'un autre rack (404, arkyo : P2025), identifiant client
//!   déjà pris (409, arkyo : P2002) ;
//! - `PATCH` d'un bundle : cherché dans ce rack. arkyo le cherchait par son
//!   seul id quand ni `name` ni `color` n'étaient envoyés : un id inconnu
//!   répondait `null` en 200, et un bundle d'un autre rack recevait les
//!   câbles de celui-ci.

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
use super::{client_id, error, require, AppState, CurrentUser};
use crate::audit;
use crate::events::EventMeta;
use crate::ids::{new_id, now_iso};
use crate::users::User;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/racks/{id}/zones", get(list_zones).post(create_zone))
        .route(
            "/racks/{id}/zones/{object_id}",
            patch(update_zone).delete(remove_zone),
        )
        .route("/racks/{id}/labels", get(list_labels).post(create_label))
        .route(
            "/racks/{id}/labels/{object_id}",
            patch(update_label).delete(remove_label),
        )
        .route("/racks/{id}/bundles", get(list_bundles).post(create_bundle))
        .route(
            "/racks/{id}/bundles/{object_id}",
            patch(update_bundle).delete(remove_bundle),
        )
}

/// One of the three per-rack objects.
struct Spec {
    table: Table,
    /// Rack-bus noun: `zone` → `zone_added`, `{zone}`, `{zoneId}`.
    noun: &'static str,
    /// App-bus entity and audit prefix (`rackZone.create`).
    entity: &'static str,
    not_found: &'static str,
    create: &'static [Field],
    update: &'static [Field],
}

/// `id: z.string().min(6).max(64).optional()` of the create schemas.
const CLIENT_ID: Field = Field::new("id", Kind::StrLen(6, 64));

const BORDER_STYLES: &[&str] = &["solid", "dashed", "dotted"];
const BORDER_STYLE_MSG: &str = r#"Invalid option: expected one of "solid"|"dashed"|"dotted""#;
const FONT_STYLES: &[&str] = &["normal", "italic"];
const FONT_STYLE_MSG: &str = r#"Invalid option: expected one of "normal"|"italic""#;
const DECORATIONS: &[&str] = &["none", "underline"];
const DECORATION_MSG: &str = r#"Invalid option: expected one of "none"|"underline""#;

/// `createSchema` of zones/route.ts:9-27 (Zod defaults = column defaults).
static ZONE_CREATE: [Field; 17] = [
    CLIENT_ID,
    Field::new("label", Kind::Str),
    Field::new("labelPosition", Kind::Str),
    Field::new("color", Kind::Str),
    Field::new("x", Kind::Num).required(),
    Field::new("y", Kind::Num).required(),
    Field::new("w", Kind::Num).required(),
    Field::new("h", Kind::Num).required(),
    Field::new("borderRadius", Kind::IntRange(0, 24)),
    Field::new("borderWidth", Kind::IntRange(0, 6)),
    Field::new("borderStyle", Kind::Enum(BORDER_STYLES, BORDER_STYLE_MSG)),
    Field::new("opacity", Kind::NumRange(0, 1)),
    Field::new("labelFontSize", Kind::Int),
    Field::new("labelFontWeight", Kind::Str),
    Field::new("labelFontStyle", Kind::Str),
    Field::new("labelTextDecoration", Kind::Str),
    Field::new("labelFontFamily", Kind::Str).nullable(),
];

/// `updateSchema` of zones/[zoneId]/route.ts:9-26.
static ZONE_UPDATE: [Field; 16] = [
    Field::new("label", Kind::Str),
    Field::new("labelPosition", Kind::Str),
    Field::new("color", Kind::Str),
    Field::new("x", Kind::Num),
    Field::new("y", Kind::Num),
    Field::new("w", Kind::Num),
    Field::new("h", Kind::Num),
    Field::new("borderRadius", Kind::IntRange(0, 24)),
    Field::new("borderWidth", Kind::IntRange(0, 6)),
    Field::new("borderStyle", Kind::Enum(BORDER_STYLES, BORDER_STYLE_MSG)),
    Field::new("opacity", Kind::NumRange(0, 1)),
    Field::new("labelFontSize", Kind::Int),
    Field::new("labelFontWeight", Kind::Str),
    Field::new("labelFontStyle", Kind::Str),
    Field::new("labelTextDecoration", Kind::Str),
    Field::new("labelFontFamily", Kind::Str).nullable(),
];

/// `createSchema` of labels/route.ts:9-23; no `width`.
static LABEL_CREATE: [Field; 13] = [
    CLIENT_ID,
    Field::new("text", Kind::Str),
    Field::new("x", Kind::Num).required(),
    Field::new("y", Kind::Num).required(),
    Field::new("fontSize", Kind::Int),
    Field::new("color", Kind::Str),
    Field::new("fontWeight", Kind::Str),
    Field::new("fontFamily", Kind::Str).nullable(),
    Field::new("fontStyle", Kind::Enum(FONT_STYLES, FONT_STYLE_MSG)),
    Field::new("textDecoration", Kind::Enum(DECORATIONS, DECORATION_MSG)),
    Field::new("pill", Kind::Bool),
    Field::new("pillBg", Kind::Str).nullable(),
    Field::new("pillRadius", Kind::IntRange(0, 64)),
];

/// `updateSchema` of labels/[labelId]/route.ts:9-23.
static LABEL_UPDATE: [Field; 13] = [
    Field::new("text", Kind::Str),
    Field::new("x", Kind::Num),
    Field::new("y", Kind::Num),
    Field::new("fontSize", Kind::Int),
    Field::new("width", Kind::Num).nullable(),
    Field::new("color", Kind::Str),
    Field::new("fontWeight", Kind::Str),
    Field::new("fontFamily", Kind::Str).nullable(),
    Field::new("fontStyle", Kind::Enum(FONT_STYLES, FONT_STYLE_MSG)),
    Field::new("textDecoration", Kind::Enum(DECORATIONS, DECORATION_MSG)),
    Field::new("pill", Kind::Bool),
    Field::new("pillBg", Kind::Str).nullable(),
    Field::new("pillRadius", Kind::IntRange(0, 64)),
];

/// `z.array(z.string().min(1)).max(500).optional()`.
const MEMBERS: Kind = Kind::IdArr { min: 0, max: 500 };

/// `createSchema` of bundles/route.ts:9-14 (`color ?? "#6366f1"` = column
/// default).
static BUNDLE_CREATE: [Field; 4] = [
    CLIENT_ID,
    Field::new("name", Kind::StrLen(1, 120)).required(),
    Field::new("color", Kind::StrLen(1, 16)),
    Field::new("cableIds", MEMBERS),
];

/// `updateSchema` of bundles/[bundleId]/route.ts:9-14.
static BUNDLE_UPDATE: [Field; 4] = [
    Field::new("name", Kind::StrLen(1, 120)),
    Field::new("color", Kind::StrLen(1, 16)),
    Field::new("addCableIds", MEMBERS),
    Field::new("removeCableIds", MEMBERS),
];

static ZONE: Spec = Spec {
    table: Table {
        name: "RackZone",
        bools: &[],
        jsons: &[],
    },
    noun: "zone",
    entity: "rackZone",
    not_found: "Zone introuvable",
    create: &ZONE_CREATE,
    update: &ZONE_UPDATE,
};

static LABEL: Spec = Spec {
    table: Table {
        name: "RackLabel",
        bools: &["pill"],
        jsons: &[],
    },
    noun: "label",
    entity: "rackLabel",
    not_found: "Libellé introuvable",
    create: &LABEL_CREATE,
    update: &LABEL_UPDATE,
};

static BUNDLE: Spec = Spec {
    table: Table {
        name: "CableBundle",
        bools: &[],
        jsons: &[],
    },
    noun: "bundle",
    entity: "cableBundle",
    not_found: "Bundle introuvable",
    create: &BUNDLE_CREATE,
    update: &BUNDLE_UPDATE,
};

// ── handlers ────────────────────────────────────────────────────────────────

macro_rules! handlers {
    ($spec:ident, $list:ident, $create:ident, $update:ident, $remove:ident) => {
        pub async fn $list(
            State(st): State<AppState>,
            _u: CurrentUser,
            Path(rack): Path<String>,
        ) -> Response {
            list(&st, &$spec, &rack).await.unwrap_or_else(|r| r)
        }

        pub async fn $create(
            State(st): State<AppState>,
            CurrentUser(me): CurrentUser,
            Path(rack): Path<String>,
            headers: HeaderMap,
            body: Bytes,
        ) -> Response {
            create(&st, &$spec, &me, &rack, &headers, body)
                .await
                .unwrap_or_else(|r| r)
        }

        pub async fn $update(
            State(st): State<AppState>,
            CurrentUser(me): CurrentUser,
            Path((rack, id)): Path<(String, String)>,
            headers: HeaderMap,
            body: Bytes,
        ) -> Response {
            update(&st, &$spec, &me, &rack, &id, &headers, body)
                .await
                .unwrap_or_else(|r| r)
        }

        pub async fn $remove(
            State(st): State<AppState>,
            CurrentUser(me): CurrentUser,
            Path((rack, id)): Path<(String, String)>,
            headers: HeaderMap,
        ) -> Response {
            remove(&st, &$spec, &me, &rack, &id, &headers)
                .await
                .unwrap_or_else(|r| r)
        }
    };
}

handlers!(ZONE, list_zones, create_zone, update_zone, remove_zone);
handlers!(LABEL, list_labels, create_label, update_label, remove_label);
handlers!(
    BUNDLE,
    list_bundles,
    create_bundle,
    update_bundle,
    remove_bundle
);

// ── shared flow ─────────────────────────────────────────────────────────────

/// The object `id` of rack `rack`, `None` when absent or of another rack.
async fn fetch(
    conn: &mut SqliteConnection,
    spec: &Spec,
    rack: &str,
    id: &str,
) -> Result<Option<Obj>, Response> {
    let row = sqlx::query(&format!(
        r#"SELECT * FROM "{}" WHERE "id" = ? AND "rackId" = ?"#,
        spec.table.name
    ))
    .bind(id)
    .bind(rack)
    .fetch_optional(conn)
    .await
    .map_err(db_error)?;
    Ok(row.map(|r| row_map(&r, &spec.table)))
}

/// A duplicate client-supplied `id`: 409 (arkyo: P2002, implicit 500).
fn insert_error(e: sqlx::Error) -> Response {
    if let sqlx::Error::Database(d) = &e {
        if d.is_unique_violation() {
            return error(StatusCode::CONFLICT, "Identifiant déjà utilisé");
        }
    }
    db_error(e)
}

/// `RackConnection.updateMany({where: {rackId, id in ids, [bundleId]},
/// data: {bundleId: to}})`: only this rack's cables (and, when `only_of`
/// is set, only that bundle's members) move.
async fn set_members(
    conn: &mut SqliteConnection,
    rack: &str,
    ids: &[Value],
    to: Option<&str>,
    only_of: Option<&str>,
) -> Result<(), Response> {
    if ids.is_empty() {
        return Ok(());
    }
    let marks = vec!["?"; ids.len()].join(", ");
    let only = if only_of.is_some() {
        r#" AND "bundleId" = ?"#
    } else {
        ""
    };
    let sql = format!(
        r#"UPDATE "RackConnection" SET "bundleId" = ?
           WHERE "rackId" = ? AND "id" IN ({marks}){only}"#
    );
    let mut q = sqlx::query(&sql).bind(to).bind(rack);
    for id in ids {
        q = bind(q, id);
    }
    if let Some(b) = only_of {
        q = q.bind(b);
    }
    q.execute(conn).await.map_err(db_error)?;
    Ok(())
}

/// The array field `name` of a validated body (absent: empty).
fn ids_of(obj: &mut Obj, name: &str) -> Vec<Value> {
    match obj.remove(name) {
        Some(Value::Array(a)) => a,
        _ => Vec::new(),
    }
}

/// `{type: "<noun>_<what>", <key>: value}` of the rack bus.
fn rack_payload(spec: &Spec, what: &str, key: &str, value: Value) -> Value {
    let mut m = Obj::new();
    m.insert("type".into(), json!(format!("{}_{what}", spec.noun)));
    m.insert(key.into(), value);
    Value::Object(m)
}

fn meta(rack: &str, id: &str, client: Option<String>) -> EventMeta {
    EventMeta {
        rack_id: Some(rack.to_string()),
        item_id: Some(id.to_string()),
        client_id: client,
        ..EventMeta::default()
    }
}

async fn list(st: &AppState, spec: &Spec, rack: &str) -> Result<Response, Response> {
    let rows = sqlx::query(&format!(
        r#"SELECT * FROM "{}" WHERE "rackId" = ? ORDER BY "createdAt" ASC, rowid ASC"#,
        spec.table.name
    ))
    .bind(rack)
    .fetch_all(&st.pool)
    .await
    .map_err(db_error)?;
    let out: Vec<Value> = rows
        .iter()
        .map(|r| Value::Object(row_map(r, &spec.table)))
        .collect();
    Ok(Json(Value::Array(out)).into_response())
}

async fn create(
    st: &AppState,
    spec: &Spec,
    me: &User,
    rack: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    let mut obj = validate(&parse_body(&body)?, spec.create)?;
    let members = ids_of(&mut obj, "cableIds");
    let id = match obj.remove("id") {
        Some(Value::String(s)) => s,
        _ => new_id(),
    };

    let mut tx = begin(&st.pool).await?;
    let found: Option<i64> = sqlx::query_scalar(r#"SELECT 1 FROM "Rack" WHERE "id" = ?"#)
        .bind(rack)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
    if found.is_none() {
        return Err(error(StatusCode::NOT_FOUND, "Not found"));
    }
    let now = now_iso();
    let cols: String = obj.keys().map(|k| format!(r#", "{k}""#)).collect();
    let marks: String = obj.keys().map(|_| ", ?").collect();
    let sql = format!(
        r#"INSERT INTO "{}" ("id", "rackId", "createdAt", "updatedAt"{cols})
           VALUES (?, ?, ?, ?{marks})"#,
        spec.table.name
    );
    let mut q = sqlx::query(&sql).bind(&id).bind(rack).bind(&now).bind(&now);
    for v in obj.values() {
        q = bind(q, v);
    }
    q.execute(&mut *tx).await.map_err(insert_error)?;
    set_members(&mut tx, rack, &members, Some(&id), None).await?;
    audit::log(
        &mut tx,
        &me.id,
        &format!("{}.create", spec.entity),
        spec.table.name,
        &id,
        None,
        None,
        None,
    )
    .await
    .map_err(db_error)?;
    let row = fetch(&mut tx, spec, rack, &id)
        .await?
        .ok_or_else(|| db_error(sqlx::Error::RowNotFound))?;
    tx.commit().await.map_err(db_error)?;

    let row = Value::Object(row);
    st.events
        .publish_rack(rack, rack_payload(spec, "added", spec.noun, row.clone()));
    st.events
        .publish_meta(spec.entity, "created", Some(&id), meta(rack, &id, client));
    Ok(Json(row).into_response())
}

async fn update(
    st: &AppState,
    spec: &Spec,
    me: &User,
    rack: &str,
    id: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    // arkyo-server: garde serveur alignée sur l'UI (design:write).
    require(me, &st.pool, Domain::Design, Level::Write).await?;
    let client = client_id::read(headers);
    let mut obj = validate(&parse_body(&body)?, spec.update)?;
    let add = ids_of(&mut obj, "addCableIds");
    let detach = ids_of(&mut obj, "removeCableIds");

    let mut tx = begin(&st.pool).await?;
    if fetch(&mut tx, spec, rack, id).await?.is_none() {
        return Err(error(StatusCode::NOT_FOUND, spec.not_found));
    }
    // Prisma `update` with the sent fields; a bundle without `name` nor
    // `color` is only read (bundles/[bundleId]/route.ts:36-39).
    if !obj.is_empty() {
        let sets: String = obj.keys().map(|k| format!(r#", "{k}" = ?"#)).collect();
        let sql = format!(
            r#"UPDATE "{}" SET "updatedAt" = ?{sets} WHERE "id" = ?"#,
            spec.table.name
        );
        let mut q = sqlx::query(&sql).bind(now_iso());
        for v in obj.values() {
            q = bind(q, v);
        }
        q.bind(id).execute(&mut *tx).await.map_err(db_error)?;
    }
    set_members(&mut tx, rack, &add, Some(id), None).await?;
    set_members(&mut tx, rack, &detach, None, Some(id)).await?;
    audit::log(
        &mut tx,
        &me.id,
        &format!("{}.update", spec.entity),
        spec.table.name,
        id,
        None,
        None,
        None,
    )
    .await
    .map_err(db_error)?;
    let row = fetch(&mut tx, spec, rack, id)
        .await?
        .ok_or_else(|| db_error(sqlx::Error::RowNotFound))?;
    tx.commit().await.map_err(db_error)?;

    let row = Value::Object(row);
    st.events
        .publish_rack(rack, rack_payload(spec, "updated", spec.noun, row.clone()));
    st.events
        .publish_meta(spec.entity, "updated", Some(id), meta(rack, id, client));
    Ok(Json(row).into_response())
}

async fn remove(
    st: &AppState,
    spec: &Spec,
    me: &User,
    rack: &str,
    id: &str,
    headers: &HeaderMap,
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
    audit::log(
        &mut tx,
        &me.id,
        &format!("{}.delete", spec.entity),
        spec.table.name,
        id,
        None,
        None,
        None,
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    let key = format!("{}Id", spec.noun);
    st.events
        .publish_rack(rack, rack_payload(spec, "removed", &key, json!(id)));
    st.events
        .publish_meta(spec.entity, "deleted", Some(id), meta(rack, id, client));
    Ok(Json(json!({ "ok": true })).into_response())
}
