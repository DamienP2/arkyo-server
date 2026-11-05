//! arkyo:app/api/tenant/members/route.ts and members/[id]/route.ts.
//!
//! Members are local accounts: the membership-shaped JSON is built from
//! `User`, `Role` and `UserProfile` (`id` = `membershipId` = `userId`).
//! "Inviting" creates the account with a one-time temporary password;
//! "removing" disables it (`isActive = 0`).

#![allow(clippy::result_large_err)]

use std::collections::{BTreeMap, HashMap};

use argon2::password_hash::rand_core::{OsRng, RngCore};
use arkyo_core::permissions::{Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};

use super::parametres::{bad, db_error, failure, parse_body, validate_flat, Field, Kind, Obj};
use super::{error, require, role_permissions, server_error, AppState, CurrentUser};
use crate::sessions;
use crate::users::{self, NewUser, UserError};

pub(super) type Flat = (Vec<String>, BTreeMap<String, Vec<String>>);

/// Adds `extra` errors (checks Zod does with `.email()` / `.regex()`) to a
/// validation result, for the fields that were sent as strings.
pub(super) fn with_extra(res: Result<Obj, Flat>, extra: Vec<(&str, &str)>) -> Result<Obj, Flat> {
    if extra.is_empty() {
        return res;
    }
    let (form, mut fields) = match res {
        Ok(_) => (vec![], BTreeMap::new()),
        Err(f) => f,
    };
    for (k, m) in extra {
        fields.entry(k.into()).or_default().push(m.into());
    }
    Err((form, fields))
}

/// `^[^\s@]+@[^\s@]+\.[^\s@]+$`.
pub(super) fn valid_email(s: &str) -> bool {
    if s.chars().any(char::is_whitespace) {
        return false;
    }
    let Some((local, domain)) = s.split_once('@') else {
        return false;
    };
    if local.is_empty() || domain.contains('@') {
        return false;
    }
    domain
        .rsplit_once('.')
        .is_some_and(|(a, b)| !a.is_empty() && !b.is_empty())
}

/// arkyo `USERNAME_REGEX`: `^[a-z0-9._-]{3,30}$`.
pub(super) fn valid_username(s: &str) -> bool {
    (3..=30).contains(&s.chars().count())
        && s.chars()
            .all(|c| matches!(c, 'a'..='z' | '0'..='9' | '.' | '_' | '-'))
}

pub(super) const USERNAME_MSG: &str = "Invalid string: must match pattern /^[a-z0-9._-]{3,30}$/";

/// The `MemberRole` tier arkyo keeps next to the role key.
pub(super) fn tier(role_key: &str, is_owner: bool) -> &'static str {
    if is_owner {
        return "OWNER";
    }
    match role_key {
        "owner" => "OWNER",
        "chef-projet" => "CHEF_PROJET",
        "consultation" => "CONSULTATION",
        _ => "TECHNICIEN",
    }
}

fn key_of_tier(tier: &str) -> &'static str {
    match tier {
        "OWNER" => "owner",
        "CHEF_PROJET" => "chef-projet",
        "CONSULTATION" => "consultation",
        _ => "technicien",
    }
}

const SELECT: &str = r#"SELECT u."id" AS id, u."email" AS email, u."name" AS name, u."username" AS username,
    u."roleKey" AS roleKey, u."isActive" AS isActive, u."createdAt" AS createdAt,
    r."label" AS roleLabel, r."color" AS roleColor, COALESCE(r."isOwner", 0) AS roleOwner,
    p."id" AS profileId, p."civility" AS civility, p."firstName" AS firstName,
    p."lastName" AS lastName, p."phone" AS phone, p."company" AS company,
    p."jobTitle" AS jobTitle, p."avatarUrl" AS avatarUrl
  FROM "User" u
  LEFT JOIN "Role" r ON r."key" = u."roleKey"
  LEFT JOIN "UserProfile" p ON p."userId" = u."id""#;

fn member_json(row: &sqlx::sqlite::SqliteRow) -> Value {
    let id: String = row.get("id");
    let role_key: String = row.get("roleKey");
    let is_owner: bool = row.get("roleOwner");
    let created: String = row.get("createdAt");
    let profile = row
        .get::<Option<String>, _>("profileId")
        .map(|_| {
            json!({
                "civility": row.get::<Option<String>, _>("civility"),
                "firstName": row.get::<Option<String>, _>("firstName"),
                "lastName": row.get::<Option<String>, _>("lastName"),
                "phone": row.get::<Option<String>, _>("phone"),
                "company": row.get::<Option<String>, _>("company"),
                "jobTitle": row.get::<Option<String>, _>("jobTitle"),
                "avatarUrl": row.get::<Option<String>, _>("avatarUrl"),
            })
        })
        .unwrap_or(Value::Null);
    let email: String = row.get("email");
    let name: Option<String> = row.get("name");
    let username: Option<String> = row.get("username");
    let active: bool = row.get("isActive");
    let tenant_role = row.get::<Option<String>, _>("roleLabel").map(|label| {
        json!({
            "key": role_key,
            "label": label,
            "color": row.get::<Option<String>, _>("roleColor"),
            "isOwner": is_owner,
        })
    });
    json!({
        "id": id,
        "userId": id,
        "membershipId": id,
        "email": email,
        "name": name,
        "username": username,
        "user": {
            "id": id,
            "email": email,
            "name": name,
            "username": username,
            "isActive": active,
            "createdAt": created,
            "profile": profile,
        },
        "role": tier(&role_key, is_owner),
        "roleKey": role_key,
        "tenantRole": tenant_role,
        "isActive": active,
        "isPending": false,
        "invitedEmail": null,
        "invitedAt": created,
        "acceptedAt": created,
        "createdAt": created,
    })
}

pub(super) async fn member_by_id(pool: &SqlitePool, id: &str) -> Result<Option<Value>, Response> {
    let row = sqlx::query(&format!(r#"{SELECT} WHERE u."id" = ?"#))
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(db_error)?;
    Ok(row.as_ref().map(member_json))
}

fn user_error(e: UserError) -> Response {
    match e {
        UserError::EmailTaken => error(StatusCode::CONFLICT, "Déjà membre ou invité"),
        UserError::UsernameTaken => error(StatusCode::CONFLICT, &e.to_string()),
        UserError::UnknownRole => bad("Rôle introuvable pour cet espace"),
        UserError::LastOwner => error(
            StatusCode::CONFLICT,
            "Impossible de retirer le dernier propriétaire",
        ),
        UserError::NotFound => error(StatusCode::NOT_FOUND, "Membre introuvable"),
        UserError::WeakPassword(_) => bad(&e.to_string()),
        UserError::Db(e) => db_error(e),
    }
}

/// 12 characters, letters and digits without the look-alikes (`0 O o 1 l I`),
/// with at least one lowercase letter, one uppercase letter and one digit.
fn temporary_password() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    loop {
        let pw: String = (0..12)
            .map(|_| ALPHABET[(OsRng.next_u32() as usize) % ALPHABET.len()] as char)
            .collect();
        if pw.chars().any(|c| c.is_ascii_lowercase())
            && pw.chars().any(|c| c.is_ascii_uppercase())
            && pw.chars().any(|c| c.is_ascii_digit())
        {
            return pw;
        }
    }
}

/// Session only, as arkyo; `?inactive=1` also lists the removed members.
pub async fn list(
    State(st): State<AppState>,
    _u: CurrentUser,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let filter = if q.contains_key("inactive") {
        ""
    } else {
        r#" WHERE u."isActive" = 1"#
    };
    let rows = sqlx::query(&format!(
        r#"{SELECT}{filter} ORDER BY u."createdAt", u."email""#
    ))
    .fetch_all(&st.pool)
    .await;
    match rows {
        Ok(rows) => Json(Value::Array(rows.iter().map(member_json).collect())).into_response(),
        Err(e) => db_error(e),
    }
}

const ROLE_ENUM_MSG: &str =
    r#"Invalid option: expected one of "CHEF_PROJET"|"TECHNICIEN"|"CONSULTATION""#;
const PATCH_ROLE_ENUM_MSG: &str =
    r#"Invalid option: expected one of "OWNER"|"CHEF_PROJET"|"TECHNICIEN"|"CONSULTATION""#;

const OWNER_INVITE: &str = "Impossible d'attribuer le rôle Propriétaire via invitation";

/// members:admin. `POST` creates the account (`email`, `name`, `roleKey`
/// or `role`, optional `username`) and answers with `temporaryPassword`.
pub async fn invite(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    body: Bytes,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Members, Level::Admin).await {
        return r;
    }
    let body = match parse_body(&body) {
        Ok(b) => b,
        Err(r) => return r,
    };
    let fields = [
        Field::new("email", Kind::Str).required(),
        Field::new("name", Kind::MaxLen(200)).required(),
        Field::new("username", Kind::Str).nullable(),
        Field::new("roleKey", Kind::NonEmpty),
        Field::new(
            "role",
            Kind::Enum(
                &["CHEF_PROJET", "TECHNICIEN", "CONSULTATION"],
                ROLE_ENUM_MSG,
            ),
        ),
    ];
    let mut extra = vec![];
    if let Some(Value::String(e)) = body.get("email") {
        if !valid_email(e.trim()) {
            extra.push(("email", "Invalid email address"));
        }
    }
    if let Some(Value::String(n)) = body.get("name") {
        if n.trim().is_empty() {
            extra.push(("name", "Too small: expected string to have >=1 characters"));
        }
    }
    if let Some(Value::String(u)) = body.get("username") {
        if !valid_username(u) {
            extra.push(("username", USERNAME_MSG));
        }
    }
    let v = match with_extra(validate_flat(&body, &fields), extra) {
        Ok(v) => v,
        Err(f) => return failure(f),
    };
    let email = v["email"].as_str().unwrap_or_default().trim().to_string();
    let role_key = match (v.get("roleKey").and_then(Value::as_str), v.get("role")) {
        (Some(k), _) => k.to_string(),
        (None, Some(r)) => key_of_tier(r.as_str().unwrap_or_default()).to_string(),
        (None, None) => "technicien".to_string(),
    };
    if role_key == "owner" {
        return bad(OWNER_INVITE);
    }
    let (is_owner, _) = role_permissions(&st.pool, &role_key).await;
    let exists: Option<i64> = match sqlx::query_scalar(r#"SELECT 1 FROM "Role" WHERE "key" = ?"#)
        .bind(&role_key)
        .fetch_optional(&st.pool)
        .await
    {
        Ok(x) => x,
        Err(e) => return db_error(e),
    };
    if exists.is_none() {
        return bad("Rôle introuvable pour cet espace");
    }
    if is_owner {
        return bad(OWNER_INVITE);
    }
    let name = v["name"].as_str().map(|s| s.trim().to_string());
    let username = v
        .get("username")
        .and_then(Value::as_str)
        .map(str::to_string);
    let password = temporary_password();

    let existing: Option<(String, bool)> =
        match sqlx::query_as(r#"SELECT "id", "isActive" FROM "User" WHERE "email" = ?"#)
            .bind(&email)
            .fetch_optional(&st.pool)
            .await
        {
            Ok(x) => x,
            Err(e) => return db_error(e),
        };
    let id = match existing {
        // a removed member comes back: new temporary password, role, sessions closed
        Some((id, false)) => {
            let res = async {
                users::reset_password(&st.pool, &id, &password, true).await?;
                users::set_role(&st.pool, &id, &role_key).await?;
                users::set_active(&st.pool, &id, true).await
            }
            .await;
            if let Err(e) = res {
                return user_error(e);
            }
            id
        }
        Some((_, true)) => return error(StatusCode::CONFLICT, "Déjà membre ou invité"),
        None => {
            let new = NewUser {
                email,
                name,
                username,
                role_key,
                password: password.clone(),
                must_change_password: true,
            };
            match users::create(&st.pool, new).await {
                Ok(u) => u.id,
                Err(e) => return user_error(e),
            }
        }
    };
    st.events.publish("tenant_members", "created", Some(&id));
    match member_by_id(&st.pool, &id).await {
        Ok(Some(mut m)) => {
            m["temporaryPassword"] = Value::String(password);
            (StatusCode::CREATED, Json(m)).into_response()
        }
        Ok(None) => server_error(),
        Err(r) => r,
    }
}

/// members:admin. `{roleKey | role, isActive}`; owners are only handled by owners.
pub async fn update(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Members, Level::Admin).await {
        return r;
    }
    let body = match parse_body(&body) {
        Ok(b) => b,
        Err(r) => return r,
    };
    let fields = [
        Field::new("roleKey", Kind::NonEmpty),
        Field::new(
            "role",
            Kind::Enum(
                &["OWNER", "CHEF_PROJET", "TECHNICIEN", "CONSULTATION"],
                PATCH_ROLE_ENUM_MSG,
            ),
        ),
        Field::new("isActive", Kind::Bool),
    ];
    let v = match validate_flat(&body, &fields) {
        Ok(v) => v,
        Err(f) => return failure(f),
    };
    let Some(target) = users::get(&st.pool, &id).await else {
        return error(StatusCode::NOT_FOUND, "Membre introuvable");
    };
    let new_key = match (v.get("roleKey").and_then(Value::as_str), v.get("role")) {
        (Some(k), _) => Some(k.to_string()),
        (None, Some(r)) => Some(key_of_tier(r.as_str().unwrap_or_default()).to_string()),
        (None, None) => None,
    };
    let active = v.get("isActive").and_then(Value::as_bool);
    if new_key.is_none() && active.is_none() {
        return bad("roleKey ou role requis");
    }
    let (me_owner, _) = role_permissions(&st.pool, &me.role_key).await;
    let (target_owner, _) = role_permissions(&st.pool, &target.role_key).await;
    if let Some(k) = &new_key {
        let row: Option<bool> =
            match sqlx::query_scalar(r#"SELECT "isOwner" FROM "Role" WHERE "key" = ?"#)
                .bind(k)
                .fetch_optional(&st.pool)
                .await
            {
                Ok(x) => x,
                Err(e) => return db_error(e),
            };
        let Some(role_owner) = row else {
            return bad("Rôle introuvable pour cet espace");
        };
        // only an owner makes owners, or edits one; nobody edits their own role
        if !me_owner && (role_owner || target_owner) {
            return error(StatusCode::FORBIDDEN, "OWNER requis");
        }
        if !me_owner && me.id == target.id {
            return error(
                StatusCode::FORBIDDEN,
                "Vous ne pouvez pas modifier votre propre rôle.",
            );
        }
    }
    if active.is_some() {
        if !me_owner && target_owner {
            return error(StatusCode::FORBIDDEN, "OWNER requis");
        }
        if active == Some(false) && me.id == target.id {
            return bad("Impossible de vous retirer vous-même");
        }
    }
    if let Some(k) = &new_key {
        if let Err(e) = users::set_role(&st.pool, &id, k).await {
            return user_error(e);
        }
    }
    if let Some(a) = active {
        if let Err(e) = users::set_active(&st.pool, &id, a).await {
            return user_error(e);
        }
        if !a {
            let _ = sessions::revoke_all_for(&st.pool, &id).await;
        }
    }
    st.events.publish("tenant_members", "updated", Some(&id));
    match member_by_id(&st.pool, &id).await {
        Ok(Some(m)) => Json(m).into_response(),
        Ok(None) => error(StatusCode::NOT_FOUND, "Membre introuvable"),
        Err(r) => r,
    }
}

/// members:admin. Disables the account and closes its sessions.
pub async fn remove(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Members, Level::Admin).await {
        return r;
    }
    let Some(target) = users::get(&st.pool, &id).await else {
        return error(StatusCode::NOT_FOUND, "Membre introuvable");
    };
    if target.id == me.id {
        return bad("Impossible de vous retirer vous-même");
    }
    let (me_owner, _) = role_permissions(&st.pool, &me.role_key).await;
    let (target_owner, _) = role_permissions(&st.pool, &target.role_key).await;
    if target_owner && !me_owner {
        return error(StatusCode::FORBIDDEN, "OWNER requis");
    }
    if let Err(e) = users::set_active(&st.pool, &id, false).await {
        return user_error(e);
    }
    let _ = sessions::revoke_all_for(&st.pool, &id).await;
    st.events.publish("tenant_members", "deleted", Some(&id));
    Json(json!({ "ok": true })).into_response()
}
