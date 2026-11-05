//! Members, roles (Task 8 of phase 2): `/api/tenant/{members,roles}`.
mod common;
use axum::http::StatusCode;
use common::*;
use serde_json::{json, Value};

const MEMBERS: &str = "/api/tenant/members";
const ROLES: &str = "/api/tenant/roles";

struct Ctx {
    e: Env,
    tok: String,
    owner: String,
}

async fn ctx() -> Ctx {
    let e = env().await;
    let o = add_user(&e.pool, "o@b.fr", "owner", false).await;
    let tok = login(&e.app, "o@b.fr").await;
    Ctx {
        e,
        tok,
        owner: o.id,
    }
}

impl Ctx {
    async fn req(&self, method: &str, path: &str, body: Option<Value>) -> Reply {
        call(&self.e.app, method, path, LOCAL, Some(&self.tok), body).await
    }
}

async fn next_event(rx: &mut tokio::sync::broadcast::Receiver<String>) -> Value {
    serde_json::from_str(&rx.recv().await.unwrap()).unwrap()
}

#[tokio::test]
async fn invite_creates_user_with_temp_password_must_change() {
    let c = ctx().await;
    let mut rx = c.e.events.subscribe();
    let r = c
        .req(
            "POST",
            MEMBERS,
            Some(json!({"email":"new@b.fr","name":"Nouvelle","roleKey":"technicien","username":"nouvelle"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let pw = r.body["temporaryPassword"].as_str().unwrap().to_string();
    assert_eq!(pw.len(), 12);
    assert!(pw.chars().all(|c| c.is_ascii_alphanumeric()));
    assert!(!pw.contains(['0', 'O', 'o', 'l', 'I', '1']));
    assert_eq!(r.body["email"], "new@b.fr");
    assert_eq!(r.body["roleKey"], "technicien");
    assert_eq!(r.body["role"], "TECHNICIEN");
    assert_eq!(r.body["isActive"], true);
    assert_eq!(r.body["isPending"], false);
    assert_eq!(r.body["user"]["username"], "nouvelle");
    assert_eq!(r.body["id"], r.body["userId"]);
    assert_eq!(r.body["tenantRole"]["label"], "Technicien");
    let ev = next_event(&mut rx).await;
    assert_eq!(ev["entity"], "tenant_members");
    assert_eq!(ev["action"], "created");

    let must: bool =
        sqlx::query_scalar(r#"SELECT "mustChangePassword" FROM "User" WHERE "email" = 'new@b.fr'"#)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    assert!(must);
    // the temporary password works, then the gate demands a change
    let t = login_with(&c.e.app, "new@b.fr", &pw).await;
    let gated = call(&c.e.app, "GET", MEMBERS, LOCAL, Some(&t), None).await;
    assert_eq!(gated.status, StatusCode::FORBIDDEN);
    assert_eq!(gated.body["code"], "PASSWORD_CHANGE_REQUIRED");
    // the password is not part of the list
    let list = c.req("GET", MEMBERS, None).await;
    assert_eq!(list.status, StatusCode::OK);
    assert_eq!(list.body.as_array().unwrap().len(), 2);
    assert!(list.body[1].get("temporaryPassword").is_none());

    // duplicates and bad input
    let dup = c
        .req(
            "POST",
            MEMBERS,
            Some(json!({"email":"NEW@b.fr","name":"X","roleKey":"technicien"})),
        )
        .await;
    assert_eq!(dup.status, StatusCode::CONFLICT);
    assert_eq!(dup.body["error"], "Déjà membre ou invité");
    let owner_role = c
        .req(
            "POST",
            MEMBERS,
            Some(json!({"email":"x@b.fr","name":"X","roleKey":"owner"})),
        )
        .await;
    assert_eq!(owner_role.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        owner_role.body["error"],
        "Impossible d'attribuer le rôle Propriétaire via invitation"
    );
    let unknown = c
        .req(
            "POST",
            MEMBERS,
            Some(json!({"email":"y@b.fr","name":"Y","roleKey":"nope"})),
        )
        .await;
    assert_eq!(unknown.status, StatusCode::BAD_REQUEST);
    assert_eq!(unknown.body["error"], "Rôle introuvable pour cet espace");
    let bad = c.req("POST", MEMBERS, Some(json!({"email":"nope"}))).await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert!(bad.body["error"]["fieldErrors"]["email"].is_array());
    assert!(bad.body["error"]["fieldErrors"]["name"].is_null());
    // the name is optional: defaults to the local part of the email
    let nn = c
        .req(
            "POST",
            MEMBERS,
            Some(json!({"email":"sans.nom@b.fr","roleKey":"technicien"})),
        )
        .await;
    assert_eq!(nn.status, StatusCode::CREATED, "{:?}", nn.body);
    assert_eq!(nn.body["name"], "sans.nom");
}

#[tokio::test]
async fn remove_disables_and_reinvite_reactivates() {
    let c = ctx().await;
    let r = c
        .req(
            "POST",
            MEMBERS,
            Some(json!({"email":"m@b.fr","name":"M","roleKey":"consultation"})),
        )
        .await;
    let id = r.body["id"].as_str().unwrap().to_string();
    let t = {
        let pw = r.body["temporaryPassword"].as_str().unwrap();
        login_with(&c.e.app, "m@b.fr", pw).await
    };
    let mut rx = c.e.events.subscribe();
    let d = c.req("DELETE", &format!("{MEMBERS}/{id}"), None).await;
    assert_eq!(d.status, StatusCode::OK);
    assert_eq!(d.body, json!({"ok": true}));
    assert_eq!(next_event(&mut rx).await["action"], "deleted");
    // gone from the list, session closed, row kept
    let list = c.req("GET", MEMBERS, None).await;
    assert_eq!(list.body.as_array().unwrap().len(), 1);
    let s = call(&c.e.app, "GET", "/api/auth/session", LOCAL, Some(&t), None).await;
    assert_eq!(s.body, Value::Null);
    let kept: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "User" WHERE "email" = 'm@b.fr'"#)
        .fetch_one(&c.e.pool)
        .await
        .unwrap();
    assert_eq!(kept, 1);
    // re-invitation reactivates with a new temporary password
    let again = c
        .req(
            "POST",
            MEMBERS,
            Some(json!({"email":"m@b.fr","name":"M","roleKey":"technicien"})),
        )
        .await;
    assert_eq!(again.status, StatusCode::CREATED, "{:?}", again.body);
    assert_eq!(again.body["id"], id);
    assert_eq!(again.body["isActive"], true);
    assert!(again.body["temporaryPassword"].is_string());
    // self removal refused
    let me = c
        .req("DELETE", &format!("{MEMBERS}/{}", c.owner), None)
        .await;
    assert_eq!(me.status, StatusCode::BAD_REQUEST);
    assert_eq!(me.body["error"], "Impossible de vous retirer vous-même");
    let nf = c.req("DELETE", &format!("{MEMBERS}/zzz"), None).await;
    assert_eq!(nf.status, StatusCode::NOT_FOUND);
    assert_eq!(nf.body["error"], "Membre introuvable");
}

#[tokio::test]
async fn cannot_demote_or_remove_last_owner() {
    let c = ctx().await;
    let demote = c
        .req(
            "PATCH",
            &format!("{MEMBERS}/{}", c.owner),
            Some(json!({"roleKey":"technicien"})),
        )
        .await;
    assert_eq!(demote.status, StatusCode::BAD_REQUEST, "{:?}", demote.body);
    assert_eq!(
        demote.body["error"],
        "Impossible de retirer le dernier propriétaire"
    );
    let off = c
        .req(
            "PATCH",
            &format!("{MEMBERS}/{}", c.owner),
            Some(json!({"isActive": false})),
        )
        .await;
    assert_eq!(off.status, StatusCode::BAD_REQUEST);
    // a second owner: the first can be demoted, then the second is the last
    let o2 = add_user(&c.e.pool, "o2@b.fr", "owner", false).await;
    let ok = c
        .req(
            "PATCH",
            &format!("{MEMBERS}/{}", c.owner),
            Some(json!({"roleKey":"technicien"})),
        )
        .await;
    assert_eq!(ok.status, StatusCode::OK, "{:?}", ok.body);
    assert_eq!(ok.body["roleKey"], "technicien");
    let t2 = login(&c.e.app, "o2@b.fr").await;
    let last = call(
        &c.e.app,
        "PATCH",
        &format!("{MEMBERS}/{}", o2.id),
        LOCAL,
        Some(&t2),
        Some(json!({"role":"CONSULTATION"})),
    )
    .await;
    assert_eq!(last.status, StatusCode::BAD_REQUEST);
    // nothing to change
    let none = call(
        &c.e.app,
        "PATCH",
        &format!("{MEMBERS}/{}", o2.id),
        LOCAL,
        Some(&t2),
        Some(json!({})),
    )
    .await;
    assert_eq!(none.status, StatusCode::BAD_REQUEST);
    assert_eq!(none.body["error"], "roleKey ou role requis");
}

#[tokio::test]
async fn role_crud_and_delete_reassigns() {
    let c = ctx().await;
    let mut rx = c.e.events.subscribe();
    let r = c
        .req(
            "POST",
            ROLES,
            Some(json!({"label":"Régie vidéo","color":"#112233"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let id = r.body["id"].as_str().unwrap().to_string();
    let key = r.body["key"].as_str().unwrap().to_string();
    assert!(key.starts_with("custom-regie-video-"));
    assert_eq!(r.body["memberCount"], 0);
    assert_eq!(r.body["isBuiltin"], false);
    assert_eq!(next_event(&mut rx).await["entity"], "tenant_roles");

    let p = c
        .req(
            "PATCH",
            &format!("{ROLES}/{id}"),
            Some(json!({"label":"Régie","permissions":{"projects":"write"}})),
        )
        .await;
    assert_eq!(p.status, StatusCode::OK, "{:?}", p.body);
    assert_eq!(p.body["label"], "Régie");
    assert_eq!(p.body["permissions"]["projects"], "write");
    assert_eq!(p.body["permissions"]["settings"], "none");
    let p2 = c
        .req(
            "PATCH",
            &format!("{ROLES}/{id}"),
            Some(json!({"permissions":{"catalog":"read"}})),
        )
        .await;
    assert_eq!(p2.body["permissions"]["projects"], "write");
    assert_eq!(p2.body["permissions"]["catalog"], "read");
    let badp = c
        .req(
            "PATCH",
            &format!("{ROLES}/{id}"),
            Some(json!({"color":"red","label":""})),
        )
        .await;
    assert_eq!(badp.status, StatusCode::BAD_REQUEST);
    assert!(badp.body["error"]["fieldErrors"]["color"].is_array());

    let m = c
        .req(
            "POST",
            MEMBERS,
            Some(json!({"email":"r@b.fr","name":"R","roleKey": key})),
        )
        .await;
    assert_eq!(m.status, StatusCode::CREATED);
    let list = c.req("GET", ROLES, None).await;
    let arr = list.body.as_array().unwrap();
    let mine = arr.iter().find(|x| x["id"] == id).unwrap();
    assert_eq!(mine["memberCount"], 1);
    assert_eq!(arr[0]["key"], "owner");
    assert_eq!(arr.iter().filter(|x| x["isBuiltin"] == true).count(), 4);
    assert_eq!(arr[0]["permissions"]["members"], "admin");

    let d = c.req("DELETE", &format!("{ROLES}/{id}"), None).await;
    assert_eq!(d.status, StatusCode::OK);
    assert_eq!(d.body, json!({"ok": true}));
    let role: String =
        sqlx::query_scalar(r#"SELECT "roleKey" FROM "User" WHERE "email" = 'r@b.fr'"#)
            .fetch_one(&c.e.pool)
            .await
            .unwrap();
    assert_eq!(role, "technicien");
    let gone = c.req("DELETE", &format!("{ROLES}/{id}"), None).await;
    assert_eq!(gone.status, StatusCode::NOT_FOUND);
    assert_eq!(gone.body["error"], "Rôle introuvable");
}

#[tokio::test]
async fn owner_role_locked() {
    let c = ctx().await;
    let list = c.req("GET", ROLES, None).await;
    let owner = list
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["key"] == "owner")
        .unwrap()
        .clone();
    let oid = owner["id"].as_str().unwrap();
    let p = c
        .req(
            "PATCH",
            &format!("{ROLES}/{oid}"),
            Some(json!({"label":"X"})),
        )
        .await;
    assert_eq!(p.status, StatusCode::BAD_REQUEST);
    assert_eq!(p.body["error"], "Le rôle Propriétaire est verrouillé");
    let d = c.req("DELETE", &format!("{ROLES}/{oid}"), None).await;
    assert_eq!(d.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        d.body["error"],
        "Impossible de supprimer le rôle Propriétaire"
    );
    let tech = list
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["key"] == "technicien")
        .unwrap()
        .clone();
    let d = c
        .req(
            "DELETE",
            &format!("{ROLES}/{}", tech["id"].as_str().unwrap()),
            None,
        )
        .await;
    assert_eq!(d.status, StatusCode::BAD_REQUEST);
    assert_eq!(d.body["error"], "Impossible de supprimer un rôle built-in");
}

#[tokio::test]
async fn members_requires_members_admin() {
    let c = ctx().await;
    sqlx::query(
        r#"INSERT INTO "Role" ("id","key","label","permissions","createdAt","updatedAt")
           VALUES ('r1','viewer','Viewer','{"members":"read"}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .execute(&c.e.pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "Role" ("id","key","label","permissions","createdAt","updatedAt")
           VALUES ('r2','mgr','Mgr','{"members":"admin"}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .execute(&c.e.pool)
    .await
    .unwrap();
    add_user(&c.e.pool, "v@b.fr", "viewer", false).await;
    let mgr = add_user(&c.e.pool, "g@b.fr", "mgr", false).await;
    let t = login(&c.e.app, "v@b.fr").await;
    let go = |m: &'static str, p: String, b: Option<Value>| {
        let t = t.clone();
        let app = c.e.app.clone();
        async move { call(&app, m, &p, LOCAL, Some(&t), b).await }
    };
    for (m, p, b) in [
        (
            "POST",
            MEMBERS.to_string(),
            Some(json!({"email":"z@b.fr","name":"Z","roleKey":"technicien"})),
        ),
        (
            "PATCH",
            format!("{MEMBERS}/{}", c.owner),
            Some(json!({"roleKey":"technicien"})),
        ),
        ("DELETE", format!("{MEMBERS}/{}", c.owner), None),
        ("GET", ROLES.to_string(), None),
        ("POST", ROLES.to_string(), Some(json!({"label":"Z"}))),
        ("PATCH", format!("{ROLES}/r1"), Some(json!({"label":"Z"}))),
        ("DELETE", format!("{ROLES}/r1"), None),
    ] {
        let r = go(m, p.clone(), b).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN, "{m} {p}");
        assert_eq!(r.body["error"], "Accès refusé");
    }
    // anonymous
    let anon = call(&c.e.app, "GET", MEMBERS, LOCAL, None, None).await;
    assert_eq!(anon.status, StatusCode::UNAUTHORIZED);
    // a members:admin (non-owner) cannot make anyone owner nor touch an owner
    let tm = login(&c.e.app, "g@b.fr").await;
    let up = call(
        &c.e.app,
        "PATCH",
        &format!("{MEMBERS}/{}", mgr.id),
        LOCAL,
        Some(&tm),
        Some(json!({"roleKey":"owner"})),
    )
    .await;
    assert_eq!(up.status, StatusCode::FORBIDDEN);
    let own = call(
        &c.e.app,
        "PATCH",
        &format!("{MEMBERS}/{}", c.owner),
        LOCAL,
        Some(&tm),
        Some(json!({"roleKey":"technicien"})),
    )
    .await;
    assert_eq!(own.status, StatusCode::FORBIDDEN);
    // but can invite a technicien
    let inv = call(
        &c.e.app,
        "POST",
        MEMBERS,
        LOCAL,
        Some(&tm),
        Some(json!({"email":"z@b.fr","name":"Z","roleKey":"viewer"})),
    )
    .await;
    assert_eq!(inv.status, StatusCode::CREATED);
    // and cannot edit the permissions of its own role
    let selfp = call(
        &c.e.app,
        "PATCH",
        &format!("{ROLES}/r2"),
        LOCAL,
        Some(&tm),
        Some(json!({"permissions":{"settings":"admin"}})),
    )
    .await;
    assert_eq!(selfp.status, StatusCode::FORBIDDEN);
    assert_eq!(
        selfp.body["error"],
        "Vous ne pouvez pas modifier les permissions de votre propre rôle."
    );
}

async fn mgr_env() -> (Ctx, String) {
    let c = ctx().await;
    sqlx::query(
        r#"INSERT INTO "Role" ("id","key","label","permissions","createdAt","updatedAt")
           VALUES ('r2','mgr','Mgr','{"members":"admin","projects":"write","catalog":"read"}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .execute(&c.e.pool)
    .await
    .unwrap();
    add_user(&c.e.pool, "g@b.fr", "mgr", false).await;
    let tm = login(&c.e.app, "g@b.fr").await;
    (c, tm)
}

#[tokio::test]
async fn non_owner_cannot_grant_more_rights_than_own() {
    let (c, tm) = mgr_env().await;
    let go = |m: &'static str, p: String, b: Option<Value>| {
        let (app, tm) = (c.e.app.clone(), tm.clone());
        async move { call(&app, m, &p, LOCAL, Some(&tm), b).await }
    };
    let msg = "Vous ne pouvez pas accorder plus de droits que les vôtres";
    // (a) role writes above own level
    let r = go("POST", ROLES.into(), Some(json!({"label":"Mine"}))).await;
    assert_eq!(r.status, StatusCode::CREATED);
    let id = r.body["id"].as_str().unwrap().to_string();
    let up = go(
        "PATCH",
        format!("{ROLES}/{id}"),
        Some(json!({"permissions":{"settings":"admin"}})),
    )
    .await;
    assert_eq!(up.status, StatusCode::FORBIDDEN);
    assert_eq!(up.body["error"], msg);
    let up = go(
        "PATCH",
        format!("{ROLES}/{id}"),
        Some(json!({"permissions":{"projects":"admin"}})),
    )
    .await;
    assert_eq!(up.status, StatusCode::FORBIDDEN);
    let ok = go(
        "PATCH",
        format!("{ROLES}/{id}"),
        Some(json!({"permissions":{"projects":"write","members":"read"}})),
    )
    .await;
    assert_eq!(ok.status, StatusCode::OK, "{:?}", ok.body);
    // a builtin cannot be raised either
    let roles = go("GET", ROLES.into(), None).await;
    let chef = roles
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["key"] == "chef-projet")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let up = go(
        "PATCH",
        format!("{ROLES}/{chef}"),
        Some(json!({"permissions":{"settings":"admin"}})),
    )
    .await;
    assert_eq!(up.status, StatusCode::FORBIDDEN);
    // (b) invite / PATCH into a role above own rights (chef-projet has design/catalog write)
    let inv = go(
        "POST",
        MEMBERS.into(),
        Some(json!({"email":"p@b.fr","name":"P","roleKey":"chef-projet"})),
    )
    .await;
    assert_eq!(inv.status, StatusCode::FORBIDDEN);
    assert_eq!(inv.body["error"], msg);
    let inv = go(
        "POST",
        MEMBERS.into(),
        Some(json!({"email":"p@b.fr","name":"P","roleKey":id})),
    )
    .await;
    assert_eq!(inv.status, StatusCode::BAD_REQUEST); // key, not id
    let key = ok.body["key"].as_str().unwrap().to_string();
    let inv = go(
        "POST",
        MEMBERS.into(),
        Some(json!({"email":"p@b.fr","name":"P","roleKey":key})),
    )
    .await;
    assert_eq!(inv.status, StatusCode::CREATED, "{:?}", inv.body);
    let pid = inv.body["id"].as_str().unwrap().to_string();
    let mv = go(
        "PATCH",
        format!("{MEMBERS}/{pid}"),
        Some(json!({"roleKey":"chef-projet"})),
    )
    .await;
    assert_eq!(mv.status, StatusCode::FORBIDDEN);
    assert_eq!(mv.body["error"], msg);
    // owner stays unrestricted
    let o = c
        .req(
            "PATCH",
            &format!("{ROLES}/{chef}"),
            Some(json!({"permissions":{"settings":"admin"}})),
        )
        .await;
    assert_eq!(o.status, StatusCode::OK);
}

#[tokio::test]
async fn reinvite_of_disabled_owner_needs_owner() {
    let (c, tm) = mgr_env().await;
    let o2 = add_user(&c.e.pool, "o2@b.fr", "owner", false).await;
    let d = c.req("DELETE", &format!("{MEMBERS}/{}", o2.id), None).await;
    assert_eq!(d.status, StatusCode::OK);
    let r = call(
        &c.e.app,
        "POST",
        MEMBERS,
        LOCAL,
        Some(&tm),
        Some(json!({"email":"o2@b.fr","name":"X","roleKey":"consultation"})),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN, "{:?}", r.body);
    assert_eq!(r.body["error"], "OWNER requis");
    let active: bool = sqlx::query_scalar(r#"SELECT "isActive" FROM "User" WHERE "id" = ?"#)
        .bind(&o2.id)
        .fetch_one(&c.e.pool)
        .await
        .unwrap();
    assert!(!active);
    // an owner reactivates it and the sent name / username apply
    let r = c.req("POST", MEMBERS, Some(json!({"email":"o2@b.fr","name":"Nouveau Nom","username":"nouveau","roleKey":"consultation"}))).await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    assert_eq!(r.body["name"], "Nouveau Nom");
    assert_eq!(r.body["username"], "nouveau");
}

/// Final review, Important 2: reactivating an account grants its rights, so a
/// non-owner cannot reactivate a member whose current role exceeds their own.
#[tokio::test]
async fn non_owner_cannot_reactivate_member_above_own_rights() {
    let (c, tm) = mgr_env().await;
    let msg = "Vous ne pouvez pas accorder plus de droits que les vôtres";
    sqlx::query(
        r#"INSERT INTO "Role" ("id","key","label","permissions","createdAt","updatedAt")
           VALUES ('r3','lecteur','Lecteur','{"projects":"read"}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .execute(&c.e.pool)
    .await
    .unwrap();
    let marc = add_user(&c.e.pool, "marc@b.fr", "chef-projet", false).await;
    let lea = add_user(&c.e.pool, "lea@b.fr", "lecteur", false).await;
    for id in [&marc.id, &lea.id] {
        let d = c.req("DELETE", &format!("{MEMBERS}/{id}"), None).await;
        assert_eq!(d.status, StatusCode::OK);
    }
    let active = |id: String| {
        let pool = c.e.pool.clone();
        async move {
            sqlx::query_scalar::<_, bool>(r#"SELECT "isActive" FROM "User" WHERE "id" = ?"#)
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    let r = call(
        &c.e.app,
        "PATCH",
        &format!("{MEMBERS}/{}", marc.id),
        LOCAL,
        Some(&tm),
        Some(json!({"isActive": true})),
    )
    .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN, "{:?}", r.body);
    assert_eq!(r.body["error"], msg);
    assert!(!active(marc.id.clone()).await);
    // a member within the caller's rights comes back
    let r = call(
        &c.e.app,
        "PATCH",
        &format!("{MEMBERS}/{}", lea.id),
        LOCAL,
        Some(&tm),
        Some(json!({"isActive": true})),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert!(active(lea.id.clone()).await);
    // the owner stays unrestricted
    let r = c
        .req(
            "PATCH",
            &format!("{MEMBERS}/{}", marc.id),
            Some(json!({"isActive": true})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert!(active(marc.id).await);
}

/// Final review, Minor 2: a re-invitation whose username is taken answers
/// 409 and leaves the removed account untouched (password, role, state).
#[tokio::test]
async fn reinvite_with_taken_username_changes_nothing() {
    let c = ctx().await;
    let r = c
        .req(
            "POST",
            MEMBERS,
            Some(json!({"email":"m@b.fr","name":"M","roleKey":"consultation"})),
        )
        .await;
    let id = r.body["id"].as_str().unwrap().to_string();
    let r = c
        .req(
            "POST",
            MEMBERS,
            Some(json!({"email":"p@b.fr","name":"P","username":"pris","roleKey":"consultation"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let d = c.req("DELETE", &format!("{MEMBERS}/{id}"), None).await;
    assert_eq!(d.status, StatusCode::OK);
    let snapshot = || {
        let (pool, id) = (c.e.pool.clone(), id.clone());
        async move {
            sqlx::query_as::<_, (String, String, bool, bool, Option<String>, Option<String>)>(
                r#"SELECT "passwordHash","roleKey","isActive","mustChangePassword","name","username" FROM "User" WHERE "id" = ?"#,
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    let before = snapshot().await;
    let r = c
        .req(
            "POST",
            MEMBERS,
            Some(json!({"email":"m@b.fr","name":"Autre","username":"pris","roleKey":"technicien"})),
        )
        .await;
    assert_eq!(r.status, StatusCode::CONFLICT, "{:?}", r.body);
    assert_eq!(snapshot().await, before);
}
