//! Permissions, site info and locale of the current user.

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{error, role_permissions, server_error, AppState, CurrentUser, Resolved};
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

/// Sets the `locale` cookie; also stores it on the user when signed in (the
/// sign-in page's language selector works without a session, as in arkyo).
pub async fn locale(
    State(st): State<AppState>,
    resolved: Option<Extension<Resolved>>,
    body: Result<Json<LocaleBody>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let locale = body
        .ok()
        .and_then(|b| b.0.locale)
        .filter(|l| LOCALES.contains(&l.as_str()));
    let Some(locale) = locale else {
        return error(StatusCode::BAD_REQUEST, "Locale invalide");
    };
    if let Some(Extension(r)) = resolved {
        if users::set_locale(&st.pool, &r.user.id, &locale)
            .await
            .is_err()
        {
            return server_error();
        }
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
