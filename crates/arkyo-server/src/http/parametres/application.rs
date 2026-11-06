//! arkyo:app/api/tenant/parametres/application/route.ts and
//! arkyo:app/api/admin/config/route.ts: the `AppConfig` key/value store.
//!
//! `seeds.*` keys are internal (seed markers): never returned, never written.
//! `site.*` keys (site name and logo) are returned but not written here:
//! arkyo kept them on the tenant, edited by the owner only through
//! `/api/tenant/espace/informations` (with its logo URL check).

use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::SqlitePool;

use super::{bad, begin, db_error, parse_body, require, Obj};
use crate::http::{AppState, CurrentUser};
use crate::ids::{new_id, now_iso};

fn internal(key: &str) -> bool {
    key.starts_with("seeds.")
}

/// Owner-only keys of the espace route (arkyo-server: arkyo stored them
/// outside `AppConfig`).
fn owner_only(key: &str) -> bool {
    key.starts_with("site.")
}

/// JavaScript `String(value)` of a JSON value.
fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => match n.as_f64() {
            Some(f) if f.fract() == 0.0 && f.abs() < 1e15 => format!("{}", f as i64),
            _ => n.to_string(),
        },
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".into(),
        Value::Array(a) => a
            .iter()
            .map(|x| {
                if x.is_null() {
                    String::new()
                } else {
                    js_string(x)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// `{ key: value }` of the stored keys (restricted to `only` when given).
pub async fn read_map(pool: &SqlitePool, only: Option<&[&str]>) -> Response {
    let rows: Vec<(String, String)> =
        match sqlx::query_as(r#"SELECT "key", "value" FROM "AppConfig" ORDER BY "key""#)
            .fetch_all(pool)
            .await
        {
            Ok(r) => r,
            Err(e) => return db_error(e),
        };
    let out: Obj = rows
        .into_iter()
        .filter(|(k, _)| !internal(k) && only.is_none_or(|o| o.contains(&k.as_str())))
        .map(|(k, v)| (k, Value::String(v)))
        .collect();
    Json(Value::Object(out)).into_response()
}

/// Upserts (or deletes, for `"__DELETE__"`) the keys of the body; keys not in
/// `allowed` (when given) are skipped. `{ ok: true }` and a `config` event.
pub async fn patch_map(
    st: &AppState,
    user: &crate::users::User,
    level: Level,
    allowed: Option<&[&str]>,
    body: Bytes,
) -> Response {
    let run = async {
        require(user, &st.pool, Domain::Settings, level).await?;
        let Value::Object(map) = parse_body(&body)? else {
            return Err(bad("Corps de requête invalide"));
        };
        let mut tx = begin(&st.pool).await?;
        for (key, value) in &map {
            if internal(key)
                || owner_only(key)
                || allowed.is_some_and(|a| !a.contains(&key.as_str()))
            {
                continue;
            }
            if value.as_str() == Some("__DELETE__") {
                sqlx::query(r#"DELETE FROM "AppConfig" WHERE "key" = ?"#)
                    .bind(key)
                    .execute(&mut *tx)
                    .await
                    .map_err(db_error)?;
            } else {
                sqlx::query(
                    r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES (?,?,?,?)
                       ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt""#,
                )
                .bind(new_id())
                .bind(key)
                .bind(js_string(value))
                .bind(now_iso())
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
            }
        }
        tx.commit().await.map_err(db_error)?;
        st.events.publish("config", "updated", None);
        Ok::<Response, Response>(Json(json!({ "ok": true })).into_response())
    };
    run.await.unwrap_or_else(|r| r)
}

pub async fn get(State(st): State<AppState>, _u: CurrentUser) -> Response {
    read_map(&st.pool, None).await
}

/// settings:write, like arkyo's `parametres/application`.
pub async fn patch(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    patch_map(&st, &u, Level::Write, None, body).await
}
