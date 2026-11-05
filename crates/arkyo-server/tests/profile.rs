//! Profile and espace (Task 8 of phase 2): `/api/tenant/{profile,espace/informations}`, `/api/site`.
mod common;
use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};

const PROFILE: &str = "/api/tenant/profile";
const ESPACE: &str = "/api/tenant/espace/informations";

async fn next_event(rx: &mut tokio::sync::broadcast::Receiver<String>) -> Value {
    serde_json::from_str(&rx.recv().await.unwrap()).unwrap()
}

#[tokio::test]
async fn profile_username_unique_409() {
    let e = env().await;
    add_user(&e.pool, "a@b.fr", "owner", false).await;
    add_user(&e.pool, "b@b.fr", "technicien", false).await;
    let ta = login(&e.app, "a@b.fr").await;
    let tb = login(&e.app, "b@b.fr").await;
    let mut rx = e.events.subscribe();
    let ok = call(
        &e.app,
        "PATCH",
        PROFILE,
        LOCAL,
        Some(&ta),
        Some(json!({"firstName":" Ana ","lastName":"Durand","username":"ana.d","phone":"0102","jobTitle":"Régie","locale":"en","avatarUrl":"/uploads/a.png"})),
    )
    .await;
    assert_eq!(ok.status, StatusCode::OK, "{:?}", ok.body);
    assert_eq!(ok.body, json!({"ok": true}));
    let ev = next_event(&mut rx).await;
    assert_eq!(
        (ev["entity"].as_str(), ev["action"].as_str()),
        (Some("tenant_profile"), Some("updated"))
    );
    let g = call(&e.app, "GET", PROFILE, LOCAL, Some(&ta), None).await;
    assert_eq!(g.status, StatusCode::OK);
    assert_eq!(g.body["username"], "ana.d");
    assert_eq!(g.body["name"], "Ana Durand");
    assert_eq!(g.body["locale"], "en");
    assert_eq!(g.body["memberRole"], "OWNER");
    assert_eq!(g.body["profile"]["firstName"], "Ana");
    assert_eq!(g.body["profile"]["avatarUrl"], "/uploads/a.png");
    assert_eq!(g.body["profile"]["phone"], "0102");
    // taken by someone else
    let dup = call(
        &e.app,
        "PATCH",
        PROFILE,
        LOCAL,
        Some(&tb),
        Some(json!({"username":"ana.d"})),
    )
    .await;
    assert_eq!(dup.status, StatusCode::CONFLICT);
    assert_eq!(dup.body["error"], "Identifiant déjà pris");
    // own username again is fine; null clears it
    let same = call(
        &e.app,
        "PATCH",
        PROFILE,
        LOCAL,
        Some(&ta),
        Some(json!({"username":"ana.d"})),
    )
    .await;
    assert_eq!(same.status, StatusCode::OK);
    let clr = call(
        &e.app,
        "PATCH",
        PROFILE,
        LOCAL,
        Some(&ta),
        Some(json!({"username":null,"phone":null})),
    )
    .await;
    assert_eq!(clr.status, StatusCode::OK);
    let g = call(&e.app, "GET", PROFILE, LOCAL, Some(&ta), None).await;
    assert_eq!(g.body["username"], Value::Null);
    assert_eq!(g.body["profile"]["phone"], Value::Null);
    // invalid
    let bad = call(
        &e.app,
        "PATCH",
        PROFILE,
        LOCAL,
        Some(&ta),
        Some(json!({"username":"A B","locale":"xx"})),
    )
    .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert_eq!(bad.body["error"], "Validation échouée");
    assert!(bad.body["details"]["fieldErrors"]["username"].is_array());
    assert!(bad.body["details"]["fieldErrors"]["locale"].is_array());
}

#[tokio::test]
async fn profile_email_change_direct() {
    let e = env().await;
    add_user(&e.pool, "a@b.fr", "owner", false).await;
    add_user(&e.pool, "b@b.fr", "technicien", false).await;
    let ta = login(&e.app, "a@b.fr").await;
    let taken = call(
        &e.app,
        "PATCH",
        PROFILE,
        LOCAL,
        Some(&ta),
        Some(json!({"email":"B@b.fr"})),
    )
    .await;
    assert_eq!(taken.status, StatusCode::CONFLICT);
    assert_eq!(taken.body["error"], "Cet email est déjà utilisé");
    let bad = call(
        &e.app,
        "PATCH",
        PROFILE,
        LOCAL,
        Some(&ta),
        Some(json!({"email":"nope"})),
    )
    .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert_eq!(bad.body["error"], "Validation échouée");
    let ok = call(
        &e.app,
        "PATCH",
        PROFILE,
        LOCAL,
        Some(&ta),
        Some(json!({"email":"new@b.fr"})),
    )
    .await;
    assert_eq!(ok.status, StatusCode::OK);
    let g = call(&e.app, "GET", PROFILE, LOCAL, Some(&ta), None).await;
    assert_eq!(g.body["email"], "new@b.fr");
    assert_eq!(g.body["profile"], Value::Null);
    let anon = call(&e.app, "GET", PROFILE, LOCAL, None, None).await;
    assert_eq!(anon.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn espace_name_logo_roundtrip() {
    let e = env().await;
    add_user(&e.pool, "o@b.fr", "owner", false).await;
    add_user(&e.pool, "t@b.fr", "technicien", false).await;
    let to = login(&e.app, "o@b.fr").await;
    let tt = login(&e.app, "t@b.fr").await;
    let mut rx = e.events.subscribe();
    let g = call(&e.app, "GET", ESPACE, LOCAL, Some(&tt), None).await;
    assert_eq!(g.status, StatusCode::OK);
    assert_eq!(g.body["name"], "");
    assert_eq!(g.body["logoUrl"], Value::Null);
    let p = call(
        &e.app,
        "PATCH",
        ESPACE,
        LOCAL,
        Some(&to),
        Some(json!({"name":"Studio Lyon","logoUrl":"/uploads/logo.png"})),
    )
    .await;
    assert_eq!(p.status, StatusCode::OK, "{:?}", p.body);
    assert_eq!(p.body["name"], "Studio Lyon");
    assert_eq!(p.body["logoUrl"], "/uploads/logo.png");
    assert_eq!(next_event(&mut rx).await["entity"], "tenant_espace_infos");
    let g = call(&e.app, "GET", ESPACE, LOCAL, Some(&tt), None).await;
    assert_eq!(g.body["name"], "Studio Lyon");
    assert_eq!(g.body["logoUrl"], "/uploads/logo.png");
    let site = call(&e.app, "GET", "/api/site", LOCAL, Some(&tt), None).await;
    assert_eq!(
        site.body,
        json!({"name":"Studio Lyon","logoUrl":"/uploads/logo.png"})
    );
    // clear the logo, keep the name
    let c = call(
        &e.app,
        "PATCH",
        ESPACE,
        LOCAL,
        Some(&to),
        Some(json!({"logoUrl":null})),
    )
    .await;
    assert_eq!(c.status, StatusCode::OK);
    let site = call(&e.app, "GET", "/api/site", LOCAL, Some(&tt), None).await;
    assert_eq!(site.body, json!({"name":"Studio Lyon","logoUrl":null}));
    // validation, empty, permission
    let v = call(
        &e.app,
        "PATCH",
        ESPACE,
        LOCAL,
        Some(&to),
        Some(json!({"name":"","logoUrl":"nope"})),
    )
    .await;
    assert_eq!(v.status, StatusCode::BAD_REQUEST);
    assert_eq!(v.body["error"], "Validation échouée");
    assert_eq!(
        v.body["details"]["fieldErrors"]["name"][0],
        "Le nom ne peut pas être vide"
    );
    let n = call(&e.app, "PATCH", ESPACE, LOCAL, Some(&to), Some(json!({}))).await;
    assert_eq!(n.status, StatusCode::BAD_REQUEST);
    assert_eq!(n.body["error"], "Aucun champ à modifier");
    let f = call(
        &e.app,
        "PATCH",
        ESPACE,
        LOCAL,
        Some(&tt),
        Some(json!({"name":"X"})),
    )
    .await;
    assert_eq!(f.status, StatusCode::FORBIDDEN);
    assert_eq!(f.body["error"], "Réservé au propriétaire de l'espace");
}

#[tokio::test]
async fn espace_patch_owner_only_even_with_settings_admin() {
    let e = env().await;
    sqlx::query(
        r#"INSERT INTO "Role" ("id","key","label","permissions","createdAt","updatedAt")
           VALUES ('r1','adm','Adm','{"settings":"admin"}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .execute(&e.pool)
    .await
    .unwrap();
    add_user(&e.pool, "a@b.fr", "adm", false).await;
    let t = login(&e.app, "a@b.fr").await;
    let r = call(
        &e.app,
        "PATCH",
        ESPACE,
        LOCAL,
        Some(&t),
        Some(json!({"name":"X"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(r.body["error"], "Réservé au propriétaire de l'espace");
}
