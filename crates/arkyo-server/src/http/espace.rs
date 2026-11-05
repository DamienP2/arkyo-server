//! arkyo:app/api/tenant/espace/informations/route.ts: the site's name and
//! logo, kept in `AppConfig` (`site.name`, `site.logoUrl`).

#![allow(clippy::result_large_err)]

use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

use super::parametres::{begin, db_error, flat_json, parse_body, validate_flat, Field, Kind};
use super::{error, AppState, CurrentUser};
use crate::ids::{new_id, now_iso};

/// `(name, logoUrl)` of the site.
pub async fn read(pool: &sqlx::SqlitePool) -> (String, Option<String>) {
    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT "key","value" FROM "AppConfig" WHERE "key" IN ('site.name','site.logoUrl')"#,
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let get = |k: &str| {
        rows.iter()
            .find(|(key, _)| key == k)
            .map(|(_, v)| v.clone())
    };
    (get("site.name").unwrap_or_default(), get("site.logoUrl"))
}

pub async fn get(State(st): State<AppState>, _u: CurrentUser) -> Response {
    let (name, logo) = read(&st.pool).await;
    Json(json!({ "id": "site", "name": name, "logoUrl": logo })).into_response()
}

/// Owner only, as arkyo.
pub async fn patch(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    // arkyo: owner only
    if !super::role_permissions(&st.pool, &u.role_key).await.0 {
        return error(StatusCode::FORBIDDEN, "Réservé au propriétaire de l'espace");
    }
    let body = match parse_body(&body) {
        Ok(b) => b,
        Err(r) => return r,
    };
    let fields = [
        Field::new(
            "name",
            Kind::Bounded {
                min_msg: "Le nom ne peut pas être vide",
                max: 200,
                max_msg: "Too big: expected string to have <=200 characters",
                upper: false,
            },
        ),
        Field::new("logoUrl", Kind::Asset).nullable(),
    ];
    let v = match validate_flat(&body, &fields) {
        Ok(v) => v,
        Err(flat) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Validation échouée", "details": flat_json(&flat) })),
            )
                .into_response()
        }
    };
    if v.is_empty() {
        return error(StatusCode::BAD_REQUEST, "Aucun champ à modifier");
    }
    let mut tx = match begin(&st.pool).await {
        Ok(t) => t,
        Err(r) => return r,
    };
    let now = now_iso();
    let res = async {
        if let Some(Value::String(n)) = v.get("name") {
            sqlx::query(
                r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES (?,'site.name',?,?)
                   ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt""#,
            )
            .bind(new_id())
            .bind(n)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        }
        match v.get("logoUrl") {
            Some(Value::String(l)) => {
                sqlx::query(
                    r#"INSERT INTO "AppConfig" ("id","key","value","updatedAt") VALUES (?,'site.logoUrl',?,?)
                       ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt""#,
                )
                .bind(new_id())
                .bind(l)
                .bind(&now)
                .execute(&mut *tx)
                .await?;
            }
            Some(_) => {
                sqlx::query(r#"DELETE FROM "AppConfig" WHERE "key" = 'site.logoUrl'"#)
                    .execute(&mut *tx)
                    .await?;
            }
            None => {}
        }
        tx.commit().await
    };
    if let Err(e) = res.await {
        return db_error(e);
    }
    st.events
        .publish("tenant_espace_infos", "update", Some("site"));
    let (name, logo) = read(&st.pool).await;
    Json(json!({ "id": "site", "name": name, "logoUrl": logo, "updatedAt": now })).into_response()
}
