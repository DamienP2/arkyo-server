//! arkyo:app/api/tenant/profile/route.ts: the signed-in user's own account.
//! The email is changed directly (decision 8: no OTP), unique and valid.

#![allow(clippy::result_large_err)]

use arkyo_core::permissions::Permissions;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::Row;

use super::members::{tier, valid_email, valid_username, with_extra, USERNAME_MSG};
use super::parametres::{begin, db_error, flat_json, parse_body, validate_flat, Field, Kind};
use super::{error, role_permissions, AppState, CurrentUser};
use crate::ids::{new_id, now_iso};

const LOCALES: &[&str] = &["fr", "en", "es", "de", "it"];
const LOCALE_MSG: &str = r#"Invalid option: expected one of "fr"|"en"|"es"|"de"|"it""#;
const MIN1: &str = "Too small: expected string to have >=1 characters";

pub async fn site_name(pool: &sqlx::SqlitePool) -> String {
    sqlx::query_scalar(r#"SELECT "value" FROM "AppConfig" WHERE "key" = 'site.name'"#)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_default()
}

pub async fn get(State(st): State<AppState>, CurrentUser(u): CurrentUser) -> Response {
    let row = sqlx::query(
        r#"SELECT "id","firstName","lastName","phone","company","jobTitle","avatarUrl"
           FROM "UserProfile" WHERE "userId" = ?"#,
    )
    .bind(&u.id)
    .fetch_optional(&st.pool)
    .await;
    let row = match row {
        Ok(r) => r,
        Err(e) => return db_error(e),
    };
    let profile = row.map_or(Value::Null, |r| {
        let s = |c: &str| r.get::<Option<String>, _>(c);
        json!({
            "firstName": s("firstName"), "lastName": s("lastName"), "phone": s("phone"),
            "company": s("company"), "jobTitle": s("jobTitle"), "avatarUrl": s("avatarUrl"),
        })
    });
    let (is_owner, _): (bool, Permissions) = role_permissions(&st.pool, &u.role_key).await;
    Json(json!({
        "id": u.id,
        "email": u.email,
        "username": u.username,
        "name": u.name,
        "locale": u.locale,
        "memberRole": tier(&u.role_key, is_owner),
        "roleKey": u.role_key,
        "createdAt": u.created_at,
        "lastLogin": u.last_login,
        "profile": profile,
        "tenant": { "id": "site", "slug": "site", "name": site_name(&st.pool).await },
    }))
    .into_response()
}

pub async fn patch(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Bytes,
) -> Response {
    let mut body = match parse_body(&body) {
        Ok(b) => b,
        Err(r) => return r,
    };
    // `z.string().trim()`
    if let Value::Object(m) = &mut body {
        for k in ["firstName", "lastName", "phone", "jobTitle", "email"] {
            if let Some(Value::String(s)) = m.get_mut(k) {
                *s = s.trim().to_string();
            }
        }
    }
    let name_kind = |max: usize| Kind::Bounded {
        min_msg: MIN1,
        max,
        max_msg: if max == 100 {
            "Too big: expected string to have <=100 characters"
        } else {
            "Too big: expected string to have <=50 characters"
        },
        upper: false,
    };
    let fields = [
        Field::new("firstName", name_kind(100)),
        Field::new("lastName", name_kind(100)),
        Field::new("username", Kind::Str).nullable(),
        Field::new("phone", Kind::MaxLen(50)).nullable(),
        Field::new("jobTitle", Kind::MaxLen(100)).nullable(),
        Field::new("locale", Kind::Enum(LOCALES, LOCALE_MSG)),
        Field::new("avatarUrl", Kind::Str).nullable(),
        Field::new("email", Kind::Str),
    ];
    let mut extra = vec![];
    if let Some(Value::String(s)) = body.get("username") {
        if !valid_username(s) {
            extra.push(("username", USERNAME_MSG));
        }
    }
    if let Some(Value::String(s)) = body.get("email") {
        if !valid_email(s) {
            extra.push(("email", "Invalid email address"));
        }
    }
    let v = match with_extra(validate_flat(&body, &fields), extra) {
        Ok(v) => v,
        Err(flat) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Validation échouée", "details": flat_json(&flat) })),
            )
                .into_response()
        }
    };

    let mut tx = match begin(&st.pool).await {
        Ok(t) => t,
        Err(r) => return r,
    };
    let steps = async {
        if let Some(email) = v.get("email").and_then(Value::as_str) {
            if email != u.email {
                let taken: Option<i64> =
                    sqlx::query_scalar(r#"SELECT 1 FROM "User" WHERE "email" = ? AND "id" <> ?"#)
                        .bind(email)
                        .bind(&u.id)
                        .fetch_optional(&mut *tx)
                        .await?;
                if taken.is_some() {
                    return Ok(Some(error(
                        StatusCode::CONFLICT,
                        "Cet email est déjà utilisé",
                    )));
                }
                sqlx::query(r#"UPDATE "User" SET "email" = ? WHERE "id" = ?"#)
                    .bind(email)
                    .bind(&u.id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        if let Some(un) = v.get("username") {
            let lower = un.as_str().map(str::to_lowercase);
            if let Some(l) = &lower {
                let taken: Option<i64> = sqlx::query_scalar(
                    r#"SELECT 1 FROM "User" WHERE "username" = ? AND "id" <> ?"#,
                )
                .bind(l)
                .bind(&u.id)
                .fetch_optional(&mut *tx)
                .await?;
                if taken.is_some() {
                    return Ok(Some(error(StatusCode::CONFLICT, "Identifiant déjà pris")));
                }
            }
            sqlx::query(r#"UPDATE "User" SET "username" = ? WHERE "id" = ?"#)
                .bind(lower)
                .bind(&u.id)
                .execute(&mut *tx)
                .await?;
        }
        if let Some(l) = v.get("locale").and_then(Value::as_str) {
            sqlx::query(r#"UPDATE "User" SET "locale" = ? WHERE "id" = ?"#)
                .bind(l)
                .bind(&u.id)
                .execute(&mut *tx)
                .await?;
        }
        let cols = ["firstName", "lastName", "phone", "jobTitle", "avatarUrl"];
        if cols.iter().any(|c| v.contains_key(*c)) {
            sqlx::query(r#"INSERT OR IGNORE INTO "UserProfile" ("id","userId") VALUES (?,?)"#)
                .bind(new_id())
                .bind(&u.id)
                .execute(&mut *tx)
                .await?;
            for c in cols {
                if let Some(val) = v.get(c) {
                    sqlx::query(&format!(
                        r#"UPDATE "UserProfile" SET "{c}" = ? WHERE "userId" = ?"#
                    ))
                    .bind(val.as_str())
                    .bind(&u.id)
                    .execute(&mut *tx)
                    .await?;
                }
            }
        }
        if v.contains_key("firstName") || v.contains_key("lastName") {
            let (f, l): (Option<String>, Option<String>) = sqlx::query_as(
                r#"SELECT "firstName","lastName" FROM "UserProfile" WHERE "userId" = ?"#,
            )
            .bind(&u.id)
            .fetch_one(&mut *tx)
            .await?;
            let full = [f, l]
                .into_iter()
                .flatten()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            if !full.is_empty() {
                sqlx::query(r#"UPDATE "User" SET "name" = ? WHERE "id" = ?"#)
                    .bind(full)
                    .bind(&u.id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        sqlx::query(r#"UPDATE "User" SET "updatedAt" = ? WHERE "id" = ?"#)
            .bind(now_iso())
            .bind(&u.id)
            .execute(&mut *tx)
            .await?;
        Ok::<_, sqlx::Error>(None)
    };
    match steps.await {
        Ok(Some(refusal)) => return refusal,
        Ok(None) => {}
        Err(e) => return db_error(e),
    }
    if let Err(e) = tx.commit().await {
        return db_error(e);
    }
    st.events.publish("tenant_profile", "updated", Some(&u.id));
    Json(json!({ "ok": true })).into_response()
}
