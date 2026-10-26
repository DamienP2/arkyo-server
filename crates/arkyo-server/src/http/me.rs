//! Permissions, site info and locale of the current user.

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{error, role_permissions, server_error, AppState, CurrentUser};
use crate::users;

pub async fn permissions(State(st): State<AppState>, CurrentUser(u): CurrentUser) -> Json<Value> {
    let (is_owner, perms) = role_permissions(&st.pool, &u.role_key).await;
    Json(json!({ "isOwner": is_owner, "roleKey": u.role_key, "permissions": perms }))
}

pub async fn site(State(st): State<AppState>, _: CurrentUser) -> Json<Value> {
    let name: Option<String> =
        sqlx::query_scalar(r#"SELECT "value" FROM "AppConfig" WHERE "key" = 'site.name'"#)
            .fetch_optional(&st.pool)
            .await
            .ok()
            .flatten();
    Json(json!({ "name": name.unwrap_or_default() }))
}

const LOCALES: [&str; 5] = ["fr", "en", "es", "de", "it"];

#[derive(Deserialize)]
pub struct LocaleBody {
    locale: Option<String>,
}

pub async fn locale(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    body: Result<Json<LocaleBody>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let locale = body
        .ok()
        .and_then(|b| b.0.locale)
        .filter(|l| LOCALES.contains(&l.as_str()));
    let Some(locale) = locale else {
        return error(StatusCode::BAD_REQUEST, "Locale invalide");
    };
    if users::set_locale(&st.pool, &u.id, &locale).await.is_err() {
        return server_error();
    }
    (
        [(
            header::SET_COOKIE,
            format!("locale={locale}; Path=/; Max-Age=31536000"),
        )],
        Json(json!({ "ok": true })),
    )
        .into_response()
}
