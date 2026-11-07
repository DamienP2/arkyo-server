//! Audit reads of the synoptic history panel (4c decision 6):
//! - `GET /api/tenant/projects/:id/audit?limit=150`
//!   (arkyo:app/api/tenant/projects/[id]/audit/route.ts): the `AuditLog`
//!   rows of the project (`Project` / projectId), of its racks (`Rack`, the
//!   racks of its rigs), of their cables (`RackConnection`) and of its
//!   project cables (`ProjectConnection`); 404 « Project not found »;
//! - `GET /api/racks/:id/audit?limit=100`
//!   (arkyo:app/api/racks/[id]/audit/route.ts): `Rack` / rackId and the
//!   `RackConnection` rows of the rack's cables. An unknown rack answers an
//!   empty list, as arkyo.
//!
//! Newest first, `limit = min(500, max(1, Number(limit ?? default)))`. The
//! cables are those that still exist (arkyo reads their ids first): the
//! entries of a deleted cable leave the history. Raw `AuditLog` rows
//! (`before` / `after` as JSON). Labels are made on the client
//! (`lib/services/audit-format.ts`).
//!
//! arkyo-server:
//! - garde serveur `projects:read` (arkyo : session seule) ;
//! - un `limit` non numérique (ou fractionnaire) donne 400 « Paramètres
//!   invalides » (arkyo : `take: NaN`, erreur Prisma, 500) ;
//! - à date égale, l'ordre d'insertion départage (Postgres : indéfini).

#![allow(clippy::result_large_err)]

use arkyo_core::permissions::{Domain, Level};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::Value;

use super::parametres::{db_error, row_map, Table};
use super::{error, require, AppState, CurrentUser};
use crate::numbering::cable_label::{js_max, js_min, string_to_number};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tenant/projects/{id}/audit", get(project))
        .route("/racks/{id}/audit", get(rack))
}

static AUDIT_LOG: Table = Table {
    name: "AuditLog",
    bools: &[],
    jsons: &["before", "after"],
};

/// The scalar fields of the Prisma `AuditLog` model, in the schema's order.
const AUDIT_COLS: &str = r#""id", "userId", "action", "entityType", "entityId", "projectId",
    "before", "after", "createdAt""#;

/// `Math.min(500, Math.max(1, Number(searchParams.get("limit") ??
/// default)))`, as an integer `take`.
fn limit(query: &[(String, String)], default: f64) -> Result<i64, Response> {
    let raw = query
        .iter()
        .find(|(k, _)| k == "limit")
        .map(|(_, v)| v.as_str());
    let n = js_min(500.0, js_max(1.0, raw.map_or(default, string_to_number)));
    // arkyo-server: 400 au lieu de l'erreur Prisma (NaN ou non entier).
    if n.is_nan() || n.fract() != 0.0 {
        return Err(error(StatusCode::BAD_REQUEST, "Paramètres invalides"));
    }
    Ok(n as i64)
}

async fn rows(st: &AppState, sql: &str, binds: &[&str], take: i64) -> Response {
    let mut conn = match st.pool.acquire().await {
        Ok(c) => c,
        Err(e) => return db_error(e),
    };
    let mut q = sqlx::query(sql);
    for b in binds {
        q = q.bind(*b);
    }
    match q.bind(take).fetch_all(&mut *conn).await {
        Ok(rows) => Json(Value::Array(
            rows.iter()
                .map(|r| Value::Object(row_map(r, &AUDIT_LOG)))
                .collect(),
        ))
        .into_response(),
        Err(e) => db_error(e),
    }
}

pub async fn project(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(project_id): Path<String>,
    Query(query): Query<Vec<(String, String)>>,
) -> Response {
    // arkyo-server: garde serveur alignée sur l'UI (projects:read).
    if let Err(r) = require(&me, &st.pool, Domain::Projects, Level::Read).await {
        return r;
    }
    let take = match limit(&query, 150.0) {
        Ok(n) => n,
        Err(r) => return r,
    };
    let found: Result<Option<i64>, _> =
        sqlx::query_scalar(r#"SELECT 1 FROM "Project" WHERE "id" = ?"#)
            .bind(&project_id)
            .fetch_optional(&st.pool)
            .await;
    match found {
        Ok(Some(_)) => {}
        Ok(None) => return error(StatusCode::NOT_FOUND, "Project not found"),
        Err(e) => return db_error(e),
    }
    // Racks of the project: those of its rigs (`rigConfigs.rigRacks`).
    let racks = r#"SELECT rr."rackId" FROM "RigRack" rr
        JOIN "RigConfig" rc ON rc."id" = rr."rigConfigId" WHERE rc."projectId" = ?"#;
    let sql = format!(
        r#"SELECT {AUDIT_COLS} FROM "AuditLog" WHERE
            ("entityType" = 'Project' AND "entityId" = ?)
         OR ("entityType" = 'Rack' AND "entityId" IN ({racks}))
         OR ("entityType" = 'RackConnection' AND "entityId" IN
              (SELECT "id" FROM "RackConnection" WHERE "rackId" IN ({racks})))
         OR ("entityType" = 'ProjectConnection' AND "entityId" IN
              (SELECT "id" FROM "ProjectConnection" WHERE "projectId" = ?))
         ORDER BY "createdAt" DESC, rowid DESC LIMIT ?"#
    );
    let p = project_id.as_str();
    rows(&st, &sql, &[p, p, p, p], take).await
}

pub async fn rack(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(rack_id): Path<String>,
    Query(query): Query<Vec<(String, String)>>,
) -> Response {
    // arkyo-server: garde serveur alignée sur l'UI (projects:read).
    if let Err(r) = require(&me, &st.pool, Domain::Projects, Level::Read).await {
        return r;
    }
    let take = match limit(&query, 100.0) {
        Ok(n) => n,
        Err(r) => return r,
    };
    let sql = format!(
        r#"SELECT {AUDIT_COLS} FROM "AuditLog" WHERE
            ("entityType" = 'Rack' AND "entityId" = ?)
         OR ("entityType" = 'RackConnection' AND "entityId" IN
              (SELECT "id" FROM "RackConnection" WHERE "rackId" = ?))
         ORDER BY "createdAt" DESC, rowid DESC LIMIT ?"#
    );
    let r = rack_id.as_str();
    rows(&st, &sql, &[r, r], take).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(v: &str) -> Vec<(String, String)> {
        vec![("limit".into(), v.into())]
    }

    #[test]
    fn limits_like_arkyo() {
        assert_eq!(limit(&[], 150.0).ok(), Some(150));
        assert_eq!(limit(&q("12"), 150.0).ok(), Some(12));
        assert_eq!(limit(&q(""), 150.0).ok(), Some(1));
        assert_eq!(limit(&q("0x10"), 150.0).ok(), Some(16));
        assert_eq!(limit(&q("9999"), 150.0).ok(), Some(500));
        assert_eq!(limit(&q("-Infinity"), 150.0).ok(), Some(1));
        assert!(limit(&q("abc"), 150.0).is_err());
        assert!(limit(&q("1.5"), 150.0).is_err());
    }
}
