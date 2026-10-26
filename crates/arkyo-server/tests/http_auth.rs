mod common;
use arkyo_server::users;
use axum::http::StatusCode;
use common::*;
use serde_json::json;

fn setup_body() -> serde_json::Value {
    json!({"email":"owner@site.fr","name":"Proprio","password":"secret123"})
}

#[tokio::test]
async fn auth_state_reports_setup_and_locality() {
    let e = env().await;
    let r = call(&e.app, "GET", "/api/auth/state", REMOTE, None, None).await;
    assert_eq!(r.body, json!({"needsSetup": true, "local": false}));
    add_user(&e.pool, "a@b.fr", "owner", false).await;
    let r = call(&e.app, "GET", "/api/auth/state", LOCAL, None, None).await;
    assert_eq!(r.body, json!({"needsSetup": false, "local": true}));
}

#[tokio::test]
async fn setup_refused_from_remote_ip() {
    let e = env().await;
    let r = call(
        &e.app,
        "POST",
        "/api/auth/setup",
        REMOTE,
        None,
        Some(setup_body()),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(
        r.body["error"],
        "La création du premier compte se fait depuis le serveur"
    );
    assert_eq!(users::count(&e.pool).await, 0);
}

#[tokio::test]
async fn setup_refused_when_users_exist_even_locally() {
    let e = env().await;
    add_user(&e.pool, "a@b.fr", "owner", false).await;
    let r = call(
        &e.app,
        "POST",
        "/api/auth/setup",
        LOCAL,
        None,
        Some(setup_body()),
    )
    .await;
    assert_eq!(r.status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn setup_then_session_shape() {
    let e = env().await;
    let r = call(
        &e.app,
        "POST",
        "/api/auth/setup",
        LOCAL,
        None,
        Some(setup_body()),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!(r.body["user"]["roleKey"], "owner");
    let cookie = r.cookie.unwrap();
    for part in ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=2592000"] {
        assert!(cookie.contains(part), "{cookie}");
    }
    let tok = token_of(&cookie);
    assert_eq!(tok.len(), 43);
    let s = call(&e.app, "GET", "/api/auth/session", LOCAL, Some(&tok), None).await;
    assert_eq!(s.status, StatusCode::OK);
    assert_eq!(s.body["user"]["role"], "OWNER");
    assert_eq!(s.body["user"]["email"], "owner@site.fr");
    assert!(s.body["user"]["collaboratorRole"].is_null());
    assert!(s.body["expires"].is_string());
    // no cookie -> null
    let n = call(&e.app, "GET", "/api/auth/session", LOCAL, None, None).await;
    assert_eq!(n.status, StatusCode::OK);
    assert!(n.body.is_null());
}

#[tokio::test]
async fn login_wrong_password_401_inactive_403() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let t = add_user(&e.pool, "t@b.fr", "technicien", false).await;
    let bad = call(
        &e.app,
        "POST",
        "/api/auth/login",
        LOCAL,
        None,
        Some(json!({"identifier":"t@b.fr","password":"nope"})),
    )
    .await;
    assert_eq!(bad.status, StatusCode::UNAUTHORIZED);
    assert_eq!(bad.body["error"], "Identifiant ou mot de passe incorrect");
    let unknown = call(
        &e.app,
        "POST",
        "/api/auth/login",
        LOCAL,
        None,
        Some(json!({"identifier":"zz","password":"secret123"})),
    )
    .await;
    assert_eq!(unknown.status, StatusCode::UNAUTHORIZED);
    users::set_active(&e.pool, &t.id, false).await.unwrap();
    let off = call(
        &e.app,
        "POST",
        "/api/auth/login",
        LOCAL,
        None,
        Some(json!({"identifier":"t@b.fr","password":"secret123"})),
    )
    .await;
    assert_eq!(off.status, StatusCode::FORBIDDEN);
    assert_eq!(off.body["error"], "Compte désactivé");
    users::set_active(&e.pool, &t.id, true).await.unwrap();
    let ok = call(
        &e.app,
        "POST",
        "/api/auth/login",
        LOCAL,
        None,
        Some(json!({"identifier":"t@b.fr","password":"secret123"})),
    )
    .await;
    assert_eq!(ok.status, StatusCode::OK);
    assert_eq!(ok.body["mustChangePassword"], false);
    assert!(users::get(&e.pool, &t.id)
        .await
        .unwrap()
        .last_login
        .is_some());
}

#[tokio::test]
async fn logout_revokes_session_and_clears_cookie() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    let r = call(&e.app, "POST", "/api/auth/logout", LOCAL, Some(&tok), None).await;
    assert_eq!(r.body, json!({"ok": true}));
    assert!(r.cookie.unwrap().contains("Max-Age=0"));
    let p = call(&e.app, "GET", "/api/site", LOCAL, Some(&tok), None).await;
    assert_eq!(p.status, StatusCode::UNAUTHORIZED);
    assert_eq!(p.body["error"], "Non authentifié");
}

#[tokio::test]
async fn disabled_user_session_rejected_on_next_request() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let t = add_user(&e.pool, "t@b.fr", "technicien", false).await;
    let tok = login(&e.app, "t@b.fr").await;
    let ok = call(
        &e.app,
        "GET",
        "/api/tenant/me/permissions",
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(ok.status, StatusCode::OK);
    users::set_active(&e.pool, &t.id, false).await.unwrap();
    let r = call(
        &e.app,
        "GET",
        "/api/tenant/me/permissions",
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn must_change_password_blocks_api_until_changed() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    add_user(&e.pool, "t@b.fr", "technicien", true).await;
    let tok = login(&e.app, "t@b.fr").await;
    let other = login(&e.app, "t@b.fr").await;
    let blocked = call(&e.app, "GET", "/api/site", LOCAL, Some(&tok), None).await;
    assert_eq!(blocked.status, StatusCode::FORBIDDEN);
    assert_eq!(blocked.body["code"], "PASSWORD_CHANGE_REQUIRED");
    assert_eq!(blocked.body["error"], "Changement de mot de passe requis");
    // auth/* stays reachable
    let s = call(&e.app, "GET", "/api/auth/session", LOCAL, Some(&tok), None).await;
    assert_eq!(s.status, StatusCode::OK);
    let wrong = call(
        &e.app,
        "POST",
        "/api/auth/password",
        LOCAL,
        Some(&tok),
        Some(json!({"currentPassword":"bad","newPassword":"newsecret123"})),
    )
    .await;
    assert_eq!(wrong.status, StatusCode::BAD_REQUEST);
    let weak = call(
        &e.app,
        "POST",
        "/api/auth/password",
        LOCAL,
        Some(&tok),
        Some(json!({"currentPassword":"secret123","newPassword":"x"})),
    )
    .await;
    assert_eq!(weak.status, StatusCode::BAD_REQUEST);
    let ok = call(
        &e.app,
        "POST",
        "/api/auth/password",
        LOCAL,
        Some(&tok),
        Some(json!({"currentPassword":"secret123","newPassword":"newsecret123"})),
    )
    .await;
    assert_eq!(ok.status, StatusCode::OK);
    assert_eq!(ok.body, json!({"ok": true}));
    let site = call(&e.app, "GET", "/api/site", LOCAL, Some(&tok), None).await;
    assert_eq!(site.status, StatusCode::OK);
    assert_eq!(site.body, json!({"name": ""}));
    // other sessions were revoked
    let gone = call(
        &e.app,
        "GET",
        "/api/auth/session",
        LOCAL,
        Some(&other),
        None,
    )
    .await;
    assert!(gone.body.is_null());
}

#[tokio::test]
async fn permissions_shape_for_technicien() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    add_user(&e.pool, "t@b.fr", "technicien", false).await;
    let tok = login(&e.app, "t@b.fr").await;
    let r = call(
        &e.app,
        "GET",
        "/api/tenant/me/permissions",
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(
        r.body,
        json!({"isOwner":false,"roleKey":"technicien","permissions":{"projects":"write","design":"write","catalog":"read","members":"none","settings":"none"}})
    );
    let tok = login(&e.app, "o@b.fr").await;
    let r = call(
        &e.app,
        "GET",
        "/api/tenant/me/permissions",
        LOCAL,
        Some(&tok),
        None,
    )
    .await;
    assert_eq!(r.body["isOwner"], true);
    assert_eq!(r.body["permissions"]["settings"], "admin");
}

#[tokio::test]
async fn locale_validates_and_persists() {
    let e = env().await;
    let o = add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    let bad = call(
        &e.app,
        "POST",
        "/api/platform/locale",
        LOCAL,
        Some(&tok),
        Some(json!({"locale":"xx"})),
    )
    .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert_eq!(bad.body["error"], "Locale invalide");
    let ok = call(
        &e.app,
        "POST",
        "/api/platform/locale",
        LOCAL,
        Some(&tok),
        Some(json!({"locale":"en"})),
    )
    .await;
    assert_eq!(ok.body, json!({"ok": true}));
    assert_eq!(users::get(&e.pool, &o.id).await.unwrap().locale, "en");
}

#[tokio::test]
async fn presence_stubs() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    let g = call(&e.app, "GET", "/api/presence", LOCAL, Some(&tok), None).await;
    assert_eq!(g.body, json!({"members": []}));
    let p = call(
        &e.app,
        "POST",
        "/api/presence",
        LOCAL,
        Some(&tok),
        Some(json!({})),
    )
    .await;
    assert_eq!(p.body, json!({"ok": true}));
}

#[tokio::test]
async fn unknown_api_route_is_json_404() {
    let e = env().await;
    let r = call(&e.app, "GET", "/api/nope/deeper", LOCAL, None, None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.body, json!({"error": "Not found"}));
}
