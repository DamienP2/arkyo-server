//! Server-side login sessions: opaque random tokens, stored hashed.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

use crate::ids::{iso_in, new_id, now_iso};

pub const COOKIE_NAME: &str = "arkyo_session";
pub const LIFETIME_SECS: i64 = 30 * 24 * 3600;

/// Hex SHA-256 of the token, as stored in `AuthSession.tokenHash`.
pub fn hash_token(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Opens a session for the user and returns the raw token (never stored).
pub async fn create(pool: &SqlitePool, user_id: &str) -> Result<String, sqlx::Error> {
    let mut raw = [0u8; 32];
    OsRng.fill_bytes(&mut raw);
    let token = URL_SAFE_NO_PAD.encode(raw);
    let now = now_iso();
    sqlx::query(
        r#"INSERT INTO "AuthSession" ("id","tokenHash","userId","createdAt","expiresAt","lastSeenAt")
           VALUES (?,?,?,?,?,?)"#,
    )
    .bind(new_id())
    .bind(hash_token(&token))
    .bind(user_id)
    .bind(&now)
    .bind(iso_in(LIFETIME_SECS))
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(token)
}

pub async fn revoke(pool: &SqlitePool, token: &str) -> Result<(), sqlx::Error> {
    sqlx::query(r#"DELETE FROM "AuthSession" WHERE "tokenHash" = ?"#)
        .bind(hash_token(token))
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn revoke_all_for(pool: &SqlitePool, user_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(r#"DELETE FROM "AuthSession" WHERE "userId" = ?"#)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Revokes every session of the user except the one holding `keep_token`.
pub async fn revoke_others(
    pool: &SqlitePool,
    user_id: &str,
    keep_token: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(r#"DELETE FROM "AuthSession" WHERE "userId" = ? AND "tokenHash" <> ?"#)
        .bind(user_id)
        .bind(hash_token(keep_token))
        .execute(pool)
        .await?;
    Ok(())
}

/// A live session: the owning user id and its expiry.
pub struct Live {
    pub user_id: String,
    pub expires_at: String,
}

/// Finds the unexpired session for a token and bumps `lastSeenAt` at most once a minute.
pub async fn lookup(pool: &SqlitePool, token: &str) -> Option<Live> {
    let hash = hash_token(token);
    let row: Option<(String, String)> = sqlx::query_as(
        r#"SELECT "userId", "expiresAt" FROM "AuthSession" WHERE "tokenHash" = ? AND "expiresAt" > ?"#,
    )
    .bind(&hash)
    .bind(now_iso())
    .fetch_optional(pool)
    .await
    .ok()?;
    let (user_id, expires_at) = row?;
    let _ = sqlx::query(
        r#"UPDATE "AuthSession" SET "lastSeenAt" = ? WHERE "tokenHash" = ? AND "lastSeenAt" < ?"#,
    )
    .bind(now_iso())
    .bind(&hash)
    .bind(iso_in(-60))
    .execute(pool)
    .await;
    Some(Live {
        user_id,
        expires_at,
    })
}

pub fn cookie(token: &str) -> String {
    format!("{COOKIE_NAME}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={LIFETIME_SECS}")
}

pub fn clear_cookie() -> String {
    format!("{COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
}

/// Extracts the session token from a `Cookie` header value.
pub fn token_from_cookie_header(header: &str) -> Option<&str> {
    header.split(';').find_map(|p| {
        let (k, v) = p.trim().split_once('=')?;
        (k == COOKIE_NAME && !v.is_empty()).then_some(v)
    })
}
