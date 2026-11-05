//! arkyo:app/api/tenant/roles/route.ts and roles/[id]/route.ts: the
//! `TenantRole` semantics on the local `Role` table (owner locked, built-in
//! roles kept, members reassigned to `technicien` on delete).

#![allow(clippy::result_large_err)]

use std::collections::BTreeMap;

use arkyo_core::permissions::{parse_permissions, Domain, Level};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Map, Value};
use sqlx::Row;

use super::members::with_extra;
use super::parametres::{
    bad, begin, db_error, failure, parse_body, validate_flat, Field, Kind, Obj,
};
use super::{error, require, role_permissions, AppState, CurrentUser};
use crate::ids::{new_id, now_iso};

const DOMAINS: [&str; 5] = ["projects", "design", "catalog", "members", "settings"];
const LEVELS: [&str; 4] = ["none", "read", "write", "admin"];
const LEVEL_MSG: &str = r#"Invalid option: expected one of "none"|"read"|"write"|"admin""#;
const COLOR_MSG: &str = "Invalid string: must match pattern /^#[0-9a-fA-F]{6}$/";
const FALLBACK_ROLE: &str = "technicien";

fn valid_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Validates `label` (1-64), `color` and `permissions` (partial map of levels).
fn check(body: &Value) -> Result<Obj, Response> {
    let fields = [
        Field::new("label", Kind::NonEmpty),
        Field::new("color", Kind::Str),
        Field::new("permissions", Kind::Any),
    ];
    let mut extra: Vec<(&str, &str)> = vec![];
    if let Some(Value::String(l)) = body.get("label") {
        if l.chars().count() > 64 {
            extra.push(("label", "Too big: expected string to have <=64 characters"));
        }
    }
    if let Some(Value::String(c)) = body.get("color") {
        if !valid_color(c) {
            extra.push(("color", COLOR_MSG));
        }
    }
    match body.get("permissions") {
        None => {}
        Some(Value::Object(m)) => {
            for (d, l) in m {
                if !DOMAINS.contains(&d.as_str()) {
                    continue;
                }
                if !l.as_str().is_some_and(|l| LEVELS.contains(&l)) {
                    extra.push(("permissions", LEVEL_MSG));
                    break;
                }
            }
        }
        Some(other) => {
            let _ = other;
            extra.push((
                "permissions",
                "Invalid input: expected object, received non-object",
            ));
        }
    }
    with_extra(validate_flat(body, &fields), extra).map_err(failure)
}

fn role_row(r: &sqlx::sqlite::SqliteRow) -> Value {
    let perms: String = r.get("permissions");
    let is_owner: bool = r.get("isOwner");
    let perms = if is_owner {
        arkyo_core::permissions::owner_permissions()
    } else {
        parse_permissions(&perms)
    };
    json!({
        "id": r.get::<String, _>("id"),
        "key": r.get::<String, _>("key"),
        "label": r.get::<String, _>("label"),
        "color": r.get::<String, _>("color"),
        "isOwner": is_owner,
        "isBuiltin": r.get::<bool, _>("isBuiltin"),
        "permissions": perms,
        "memberCount": r.get::<i64, _>("memberCount"),
        "createdAt": r.get::<String, _>("createdAt"),
        "updatedAt": r.get::<String, _>("updatedAt"),
    })
}

pub async fn list(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Members, Level::Admin).await {
        return r;
    }
    let rows = sqlx::query(
        r#"SELECT r.*, (SELECT COUNT(*) FROM "User" u WHERE u."roleKey" = r."key" AND u."isActive" = 1) AS memberCount
           FROM "Role" r ORDER BY r."isOwner" DESC, r."isBuiltin" DESC, r."createdAt" ASC, r."label""#,
    )
    .fetch_all(&st.pool)
    .await;
    match rows {
        Ok(rows) => Json(Value::Array(rows.iter().map(role_row).collect())).into_response(),
        Err(e) => db_error(e),
    }
}

/// `custom-<slug of the label>-<base36 ms>`.
fn role_key(label: &str) -> String {
    let mut slug = String::new();
    for c in label.to_lowercase().chars() {
        let folded = match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
            'ç' => 'c',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ñ' => 'n',
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ý' | 'ÿ' => 'y',
            c => c,
        };
        if folded.is_ascii_alphanumeric() {
            slug.push(folded);
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug: String = slug.trim_matches('-').chars().take(32).collect();
    let mut n = u64::try_from(jiff::Timestamp::now().as_millisecond()).unwrap_or(0);
    let mut suffix = String::new();
    while n > 0 {
        suffix.insert(0, char::from_digit((n % 36) as u32, 36).unwrap_or('0'));
        n /= 36;
    }
    format!("custom-{slug}-{suffix}")
}

pub async fn create(
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
    // `label` is required on create
    let mut v = match check(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Some(label) = v.remove("label") else {
        return failure((
            vec![],
            BTreeMap::from([(
                "label".to_string(),
                vec!["Invalid input: expected string, received undefined".to_string()],
            )]),
        ));
    };
    let label = label.as_str().unwrap_or_default().to_string();
    let color = v
        .get("color")
        .and_then(Value::as_str)
        .unwrap_or("#6b7280")
        .to_string();
    let (id, key, now) = (new_id(), role_key(&label), now_iso());
    let res = sqlx::query(
        r#"INSERT INTO "Role" ("id","key","label","color","isOwner","isBuiltin","permissions","createdAt","updatedAt")
           VALUES (?,?,?,?,0,0,'{}',?,?)"#,
    )
    .bind(&id)
    .bind(&key)
    .bind(&label)
    .bind(&color)
    .bind(&now)
    .bind(&now)
    .execute(&st.pool)
    .await;
    if let Err(e) = res {
        return db_error(e);
    }
    st.events.publish("tenant_roles", "created", Some(&id));
    (
        StatusCode::CREATED,
        Json(json!({
            "id": id, "key": key, "label": label, "color": color,
            "isOwner": false, "isBuiltin": false, "permissions": {},
            "memberCount": 0, "createdAt": now, "updatedAt": now,
        })),
    )
        .into_response()
}

pub async fn update(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Members, Level::Admin).await {
        return r;
    }
    let mut tx = match begin(&st.pool).await {
        Ok(t) => t,
        Err(r) => return r,
    };
    let row = match sqlx::query(r#"SELECT * FROM "Role" WHERE "id" = ?"#)
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await
    {
        Ok(r) => r,
        Err(e) => return db_error(e),
    };
    let Some(row) = row else {
        return error(StatusCode::NOT_FOUND, "Rôle introuvable");
    };
    if row.get::<bool, _>("isOwner") {
        return bad("Le rôle Propriétaire est verrouillé");
    }
    let body = match parse_body(&body) {
        Ok(b) => b,
        Err(r) => return r,
    };
    let v = match check(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let key: String = row.get("key");
    let (me_owner, _) = role_permissions(&st.pool, &me.role_key).await;
    // no self-escalation: members:admin must not raise the role it carries
    if !me_owner && v.contains_key("permissions") && me.role_key == key {
        return error(
            StatusCode::FORBIDDEN,
            "Vous ne pouvez pas modifier les permissions de votre propre rôle.",
        );
    }
    let label = v
        .get("label")
        .and_then(Value::as_str)
        .map_or_else(|| row.get::<String, _>("label"), str::to_string);
    let color = v
        .get("color")
        .and_then(Value::as_str)
        .map_or_else(|| row.get::<String, _>("color"), str::to_string);
    let stored: String = row.get("permissions");
    let permissions = match v.get("permissions").and_then(Value::as_object) {
        Some(sent) => {
            let existing: Map<String, Value> = serde_json::from_str(&stored).unwrap_or_default();
            let mut merged = Map::new();
            for d in DOMAINS {
                merged.insert(
                    d.into(),
                    existing.get(d).cloned().unwrap_or_else(|| json!("none")),
                );
            }
            for (d, l) in sent {
                if DOMAINS.contains(&d.as_str()) {
                    merged.insert(d.clone(), l.clone());
                }
            }
            Value::Object(merged)
        }
        None => serde_json::from_str(&stored).unwrap_or_else(|_| json!({})),
    };
    let now = now_iso();
    let res = sqlx::query(
        r#"UPDATE "Role" SET "label" = ?, "color" = ?, "permissions" = ?, "updatedAt" = ? WHERE "id" = ?"#,
    )
    .bind(&label)
    .bind(&color)
    .bind(permissions.to_string())
    .bind(&now)
    .bind(&id)
    .execute(&mut *tx)
    .await;
    if let Err(e) = res {
        return db_error(e);
    }
    if let Err(e) = tx.commit().await {
        return db_error(e);
    }
    st.events.publish("tenant_roles", "updated", Some(&id));
    Json(json!({
        "id": id, "key": key, "label": label, "color": color,
        "isOwner": false, "isBuiltin": row.get::<bool, _>("isBuiltin"),
        "permissions": permissions, "updatedAt": now,
    }))
    .into_response()
}

pub async fn remove(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Path(id): Path<String>,
) -> Response {
    if let Err(r) = require(&me, &st.pool, Domain::Members, Level::Admin).await {
        return r;
    }
    let mut tx = match begin(&st.pool).await {
        Ok(t) => t,
        Err(r) => return r,
    };
    let row = match sqlx::query(r#"SELECT * FROM "Role" WHERE "id" = ?"#)
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await
    {
        Ok(r) => r,
        Err(e) => return db_error(e),
    };
    let Some(row) = row else {
        return error(StatusCode::NOT_FOUND, "Rôle introuvable");
    };
    if row.get::<bool, _>("isOwner") {
        return bad("Impossible de supprimer le rôle Propriétaire");
    }
    if row.get::<bool, _>("isBuiltin") {
        return bad("Impossible de supprimer un rôle built-in");
    }
    let key: String = row.get("key");
    let steps = async {
        sqlx::query(r#"UPDATE "User" SET "roleKey" = ?, "updatedAt" = ? WHERE "roleKey" = ?"#)
            .bind(FALLBACK_ROLE)
            .bind(now_iso())
            .bind(&key)
            .execute(&mut *tx)
            .await?;
        sqlx::query(r#"DELETE FROM "Role" WHERE "id" = ?"#)
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await
    };
    if let Err(e) = steps.await {
        return db_error(e);
    }
    st.events.publish("tenant_roles", "deleted", Some(&id));
    Json(json!({ "ok": true })).into_response()
}
