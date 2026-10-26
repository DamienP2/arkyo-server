//! Login, logout, first-run setup, session and password change.

use std::net::SocketAddr;

use axum::extract::rejection::JsonRejection;
use axum::extract::{ConnectInfo, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{error, server_error, AppState, CurrentUser, Resolved};
use crate::sessions;
use crate::users::{self, NewUser, User, UserError};

pub async fn state(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> Json<Value> {
    Json(json!({
        "needsSetup": users::count(&st.pool).await == 0,
        "local": peer.ip().is_loopback(),
    }))
}

fn with_cookie(set_cookie: String, body: Value) -> Response {
    ([(header::SET_COOKIE, set_cookie)], Json(body)).into_response()
}

fn user_error(e: UserError) -> Response {
    match e {
        UserError::EmailTaken | UserError::UsernameTaken => {
            error(StatusCode::CONFLICT, &e.to_string())
        }
        UserError::WeakPassword(_) | UserError::UnknownRole => {
            error(StatusCode::BAD_REQUEST, &e.to_string())
        }
        UserError::NotFound => error(StatusCode::NOT_FOUND, &e.to_string()),
        _ => server_error(),
    }
}

async fn open_session(st: &AppState, user: &User, extra: Value) -> Response {
    let Ok(token) = sessions::create(&st.pool, &user.id).await else {
        return server_error();
    };
    let mut body = json!({ "user": user });
    if let (Some(o), Some(e)) = (body.as_object_mut(), extra.as_object()) {
        o.extend(e.clone());
    }
    with_cookie(sessions::cookie(&token), body)
}

#[derive(Deserialize)]
pub struct SetupBody {
    email: String,
    name: Option<String>,
    username: Option<String>,
    password: String,
}

pub async fn setup(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    body: Result<Json<SetupBody>, JsonRejection>,
) -> Response {
    if users::count(&st.pool).await > 0 {
        return error(StatusCode::CONFLICT, "Le serveur est déjà configuré");
    }
    if !peer.ip().is_loopback() {
        return error(
            StatusCode::FORBIDDEN,
            "La création du premier compte se fait depuis le serveur",
        );
    }
    let Ok(Json(b)) = body else {
        return error(StatusCode::BAD_REQUEST, "Requête invalide");
    };
    if !b.email.contains('@') {
        return error(StatusCode::BAD_REQUEST, "Email invalide");
    }
    let created = users::create(
        &st.pool,
        NewUser {
            email: b.email,
            name: b.name,
            username: b.username,
            role_key: "owner".into(),
            password: b.password,
            must_change_password: false,
        },
    )
    .await;
    match created {
        Ok(u) => {
            let _ = users::touch_login(&st.pool, &u.id).await;
            let u = users::get(&st.pool, &u.id).await.unwrap_or(u);
            open_session(&st, &u, json!({})).await
        }
        Err(e) => user_error(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginBody {
    identifier: String,
    password: String,
}

pub async fn login(
    State(st): State<AppState>,
    body: Result<Json<LoginBody>, JsonRejection>,
) -> Response {
    let bad = || {
        error(
            StatusCode::UNAUTHORIZED,
            "Identifiant ou mot de passe incorrect",
        )
    };
    let Ok(Json(b)) = body else {
        return bad();
    };
    let Some((user, hash)) = users::find_by_identifier(&st.pool, &b.identifier).await else {
        return bad();
    };
    if !users::verify_password(&hash, &b.password) {
        return bad();
    }
    if !user.is_active {
        return error(StatusCode::FORBIDDEN, "Compte désactivé");
    }
    let _ = users::touch_login(&st.pool, &user.id).await;
    let user = users::get(&st.pool, &user.id).await.unwrap_or(user);
    open_session(
        &st,
        &user,
        json!({ "mustChangePassword": user.must_change_password }),
    )
    .await
}

pub async fn logout(
    State(st): State<AppState>,
    resolved: Option<Extension<Resolved>>,
    headers: axum::http::HeaderMap,
) -> Response {
    let token = resolved.map(|Extension(r)| r.token).or_else(|| {
        headers
            .get(header::COOKIE)
            .and_then(|v| v.to_str().ok())
            .and_then(sessions::token_from_cookie_header)
            .map(str::to_string)
    });
    if let Some(t) = token {
        let _ = sessions::revoke(&st.pool, &t).await;
    }
    with_cookie(sessions::clear_cookie(), json!({ "ok": true }))
}

/// MemberRole name used by arkyo's session shape.
fn member_role(role_key: &str) -> &'static str {
    match role_key {
        "owner" => "OWNER",
        "chef-projet" => "CHEF_PROJET",
        "consultation" => "CONSULTATION",
        _ => "TECHNICIEN",
    }
}

pub async fn session(resolved: Option<Extension<Resolved>>) -> Json<Value> {
    let Some(Extension(r)) = resolved else {
        return Json(Value::Null);
    };
    Json(json!({
        "user": {
            "id": r.user.id,
            "email": r.user.email,
            "name": r.user.name,
            "role": member_role(&r.user.role_key),
            "collaboratorRole": null,
        },
        "expires": r.expires_at,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordBody {
    current_password: String,
    new_password: String,
}

pub async fn change_password(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Extension(r): Extension<Resolved>,
    body: Result<Json<PasswordBody>, JsonRejection>,
) -> Response {
    let Ok(Json(b)) = body else {
        return error(StatusCode::BAD_REQUEST, "Requête invalide");
    };
    let hash = users::find_by_identifier(&st.pool, &user.email)
        .await
        .map(|(_, h)| h);
    if !hash.is_some_and(|h| users::verify_password(&h, &b.current_password)) {
        return error(StatusCode::BAD_REQUEST, "Mot de passe actuel incorrect");
    }
    if let Err(e) = users::set_password(&st.pool, &user.id, &b.new_password, false).await {
        return user_error(e);
    }
    let _ = sessions::revoke_others(&st.pool, &user.id, &r.token).await;
    Json(json!({ "ok": true })).into_response()
}
