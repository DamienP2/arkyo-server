mod common;
use axum::http::StatusCode;
use common::*;
use serde_json::json;

const GETS: [&str; 2] = ["/api/system", "/api/system/update"];
const POSTS: [&str; 3] = [
    "/api/system/update/check",
    "/api/system/update/install",
    "/api/system/update/rollback",
];

#[tokio::test]
async fn system_routes_require_settings_admin() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    add_user(&e.pool, "t@b.fr", "technicien", false).await;
    let tech = login(&e.app, "t@b.fr").await;
    for uri in GETS {
        let r = call(&e.app, "GET", uri, LOCAL, Some(&tech), None).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{uri}");
        assert_eq!(r.body["error"], "Accès refusé");
        let r = call(&e.app, "GET", uri, LOCAL, None, None).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{uri}");
    }
    for uri in POSTS {
        let r = call(&e.app, "POST", uri, LOCAL, Some(&tech), None).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{uri}");
    }
    let r = call(
        &e.app,
        "PUT",
        "/api/system/update/settings",
        LOCAL,
        Some(&tech),
        Some(json!({"repo":"a/b"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    let r = call(
        &e.app,
        "POST",
        "/api/system/update/upload",
        LOCAL,
        Some(&tech),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    let owner = login(&e.app, "o@b.fr").await;
    let r = call(&e.app, "GET", "/api/system", LOCAL, Some(&owner), None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["version"], env!("CARGO_PKG_VERSION"));
    assert!(r.body["dataDir"].is_string());
    assert!(r.body["urls"].is_array());
    let r = call(
        &e.app,
        "GET",
        "/api/system/update",
        LOCAL,
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["repo"], "DamienP2/arkyo-server");
    assert_eq!(r.body["autoCheck"], true);
}

#[tokio::test]
async fn update_settings_validate_and_persist() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let owner = login(&e.app, "o@b.fr").await;
    let put = |b| {
        call(
            &e.app,
            "PUT",
            "/api/system/update/settings",
            LOCAL,
            Some(&owner),
            Some(b),
        )
    };
    let r = put(json!({"repo":"nope"})).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = put(json!({"repo":"https://github.com/x/y/","autoCheck":false,"token":"t"})).await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    let r = call(
        &e.app,
        "GET",
        "/api/system/update",
        LOCAL,
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(r.body["repo"], "x/y");
    assert_eq!(r.body["autoCheck"], false);
    assert_eq!(r.body["hasToken"], true);
    assert!(r.body.get("token").is_none());
}

#[tokio::test]
async fn upload_of_garbage_is_refused() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let owner = login(&e.app, "o@b.fr").await;
    let r = call(
        &e.app,
        "POST",
        "/api/system/update/upload",
        LOCAL,
        Some(&owner),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}

// ── Interface (classique / strata) ──────────────────────────────────────────

async fn site_interface(e: &Env, tok: &str) -> serde_json::Value {
    let r = call(&e.app, "GET", "/api/site", LOCAL, Some(tok), None).await;
    assert_eq!(r.status, StatusCode::OK);
    r.body["interface"].clone()
}

#[tokio::test]
async fn site_exposes_interface_classique_by_default() {
    let e = env().await;
    add_user(&e.pool, "t@b.fr", "technicien", false).await;
    let tech = login(&e.app, "t@b.fr").await;
    assert_eq!(site_interface(&e, &tech).await, "classique");
}

#[tokio::test]
async fn interface_requires_settings_admin() {
    let e = env().await;
    add_user(&e.pool, "t@b.fr", "technicien", false).await;
    let tech = login(&e.app, "t@b.fr").await;
    let body = Some(json!({"interface":"strata"}));
    let r = call(
        &e.app,
        "PUT",
        "/api/system/interface",
        LOCAL,
        Some(&tech),
        body.clone(),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(r.body["error"], "Accès refusé");
    let r = call(&e.app, "PUT", "/api/system/interface", LOCAL, None, body).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    assert_eq!(site_interface(&e, &tech).await, "classique");
}

#[tokio::test]
async fn interface_put_switches_and_publishes() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let owner = login(&e.app, "o@b.fr").await;
    let mut rx = e.events.subscribe();
    for v in ["strata", "classique"] {
        let r = call(
            &e.app,
            "PUT",
            "/api/system/interface",
            LOCAL,
            Some(&owner),
            Some(json!({ "interface": v })),
        )
        .await;
        assert_eq!(r.status, StatusCode::NO_CONTENT);
        let ev: serde_json::Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
        assert_eq!(
            ev,
            json!({"type":"update","entity":"config","action":"updated"})
        );
        assert_eq!(site_interface(&e, &owner).await, v);
    }
}

#[tokio::test]
async fn interface_rejects_unknown() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    let owner = login(&e.app, "o@b.fr").await;
    for body in [Some(json!({"interface":"rose"})), Some(json!({})), None] {
        let r = call(
            &e.app,
            "PUT",
            "/api/system/interface",
            LOCAL,
            Some(&owner),
            body,
        )
        .await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST);
        assert_eq!(r.body["error"], "Interface inconnue.");
    }
    assert_eq!(site_interface(&e, &owner).await, "classique");
}
