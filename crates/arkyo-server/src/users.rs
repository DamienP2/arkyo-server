//! Local accounts: Argon2id hashes, role guard, CRUD on the `User` table.

use std::fmt;

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use arkyo_core::password;
use serde::Serialize;
use sqlx::{Sqlite, SqlitePool, Transaction};

use crate::ids::{new_id, now_iso};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub username: Option<String>,
    #[sqlx(rename = "roleKey")]
    pub role_key: String,
    #[sqlx(rename = "mustChangePassword")]
    pub must_change_password: bool,
    #[sqlx(rename = "isActive")]
    pub is_active: bool,
    pub locale: String,
    #[sqlx(rename = "lastLogin")]
    pub last_login: Option<String>,
    #[sqlx(rename = "createdAt")]
    pub created_at: String,
    #[sqlx(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct NewUser {
    pub email: String,
    pub name: Option<String>,
    pub username: Option<String>,
    pub role_key: String,
    pub password: String,
    pub must_change_password: bool,
}

#[derive(Debug)]
pub enum UserError {
    EmailTaken,
    UsernameTaken,
    UnknownRole,
    WeakPassword(String),
    LastOwner,
    NotFound,
    Db(sqlx::Error),
}

impl fmt::Display for UserError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmailTaken => write!(f, "Cet email est déjà utilisé"),
            Self::UsernameTaken => write!(f, "Cet identifiant est déjà utilisé"),
            Self::UnknownRole => write!(f, "Rôle inconnu"),
            Self::WeakPassword(m) => write!(f, "{m}"),
            Self::LastOwner => write!(f, "Il doit rester au moins un propriétaire actif"),
            Self::NotFound => write!(f, "Utilisateur introuvable"),
            Self::Db(e) => write!(f, "Erreur de base de données : {e}"),
        }
    }
}

impl std::error::Error for UserError {}

impl From<sqlx::Error> for UserError {
    fn from(e: sqlx::Error) -> Self {
        Self::Db(e)
    }
}

const COLS: &str = r#""id", "email", "name", "username", "roleKey", "mustChangePassword", "isActive", "locale", "lastLogin", "createdAt", "updatedAt""#;

fn hash_password(pw: &str) -> Result<String, UserError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pw.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| UserError::Db(sqlx::Error::Protocol(format!("hash: {e}"))))
}

/// Argon2id check; a malformed hash never verifies.
pub fn verify_password(hash: &str, pw: &str) -> bool {
    PasswordHash::new(hash)
        .is_ok_and(|h| Argon2::default().verify_password(pw.as_bytes(), &h).is_ok())
}

fn clean(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn unique_violation(e: &sqlx::Error) -> Option<String> {
    match e {
        sqlx::Error::Database(d) if d.is_unique_violation() => Some(d.message().to_string()),
        _ => None,
    }
}

pub async fn create(pool: &SqlitePool, new: NewUser) -> Result<User, UserError> {
    password::validate(&new.password).map_err(UserError::WeakPassword)?;
    let email = new.email.trim().to_string();
    let username = clean(new.username);
    let role_exists: Option<i64> = sqlx::query_scalar(r#"SELECT 1 FROM "Role" WHERE "key" = ?"#)
        .bind(&new.role_key)
        .fetch_optional(pool)
        .await?;
    if role_exists.is_none() {
        return Err(UserError::UnknownRole);
    }
    let hash = hash_password(&new.password)?;
    let id = new_id();
    let now = now_iso();
    let res = sqlx::query(
        r#"INSERT INTO "User" ("id","email","name","username","passwordHash","mustChangePassword","roleKey","isActive","locale","createdAt","updatedAt")
           VALUES (?,?,?,?,?,?,?,1,'fr',?,?)"#,
    )
    .bind(&id)
    .bind(&email)
    .bind(clean(new.name))
    .bind(&username)
    .bind(&hash)
    .bind(new.must_change_password)
    .bind(&new.role_key)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await;
    if let Err(e) = res {
        return Err(match unique_violation(&e) {
            Some(m) if m.contains("username") => UserError::UsernameTaken,
            Some(_) => UserError::EmailTaken,
            None => e.into(),
        });
    }
    get(pool, &id).await.ok_or(UserError::NotFound)
}

/// Looks an account up by email or username (case-insensitive); returns the hash too.
pub async fn find_by_identifier(pool: &SqlitePool, ident: &str) -> Option<(User, String)> {
    let ident = ident.trim();
    let user: User = sqlx::query_as(&format!(
        r#"SELECT {COLS} FROM "User" WHERE "email" = ?1 OR "username" = ?1 LIMIT 1"#
    ))
    .bind(ident)
    .fetch_optional(pool)
    .await
    .ok()??;
    let hash: String = sqlx::query_scalar(r#"SELECT "passwordHash" FROM "User" WHERE "id" = ?"#)
        .bind(&user.id)
        .fetch_one(pool)
        .await
        .ok()?;
    Some((user, hash))
}

pub async fn get(pool: &SqlitePool, id: &str) -> Option<User> {
    sqlx::query_as(&format!(r#"SELECT {COLS} FROM "User" WHERE "id" = ?"#))
        .bind(id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

pub async fn list(pool: &SqlitePool) -> Vec<User> {
    sqlx::query_as(&format!(
        r#"SELECT {COLS} FROM "User" ORDER BY "createdAt", "email""#
    ))
    .fetch_all(pool)
    .await
    .unwrap_or_default()
}

pub async fn count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar(r#"SELECT COUNT(*) FROM "User""#)
        .fetch_one(pool)
        .await
        .unwrap_or(0)
}

pub async fn set_password(
    pool: &SqlitePool,
    id: &str,
    pw: &str,
    must_change: bool,
) -> Result<(), UserError> {
    password::validate(pw).map_err(UserError::WeakPassword)?;
    let hash = hash_password(pw)?;
    let r = sqlx::query(
        r#"UPDATE "User" SET "passwordHash" = ?, "mustChangePassword" = ?, "updatedAt" = ? WHERE "id" = ?"#,
    )
    .bind(hash)
    .bind(must_change)
    .bind(now_iso())
    .bind(id)
    .execute(pool)
    .await?;
    if r.rows_affected() == 0 {
        return Err(UserError::NotFound);
    }
    Ok(())
}

/// Fails with `LastOwner` when no OTHER active owner would remain.
async fn ensure_other_owner(tx: &mut Transaction<'_, Sqlite>, id: &str) -> Result<(), UserError> {
    let n: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM "User" u JOIN "Role" r ON r."key" = u."roleKey"
           WHERE u."id" <> ? AND u."isActive" = 1 AND r."isOwner" = 1"#,
    )
    .bind(id)
    .fetch_one(&mut **tx)
    .await?;
    if n == 0 {
        return Err(UserError::LastOwner);
    }
    Ok(())
}

async fn is_active_owner(tx: &mut Transaction<'_, Sqlite>, id: &str) -> Result<bool, UserError> {
    let row: Option<i64> = sqlx::query_scalar(
        r#"SELECT 1 FROM "User" u JOIN "Role" r ON r."key" = u."roleKey"
           WHERE u."id" = ? AND u."isActive" = 1 AND r."isOwner" = 1"#,
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(row.is_some())
}

async fn exists(tx: &mut Transaction<'_, Sqlite>, id: &str) -> Result<(), UserError> {
    let row: Option<i64> = sqlx::query_scalar(r#"SELECT 1 FROM "User" WHERE "id" = ?"#)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?;
    row.map(|_| ()).ok_or(UserError::NotFound)
}

pub async fn set_active(pool: &SqlitePool, id: &str, active: bool) -> Result<(), UserError> {
    // IMMEDIATE-like behaviour: the first statement is a write so the guard is race-free.
    let mut tx = begin_write(pool).await?;
    exists(&mut tx, id).await?;
    if !active && is_active_owner(&mut tx, id).await? {
        ensure_other_owner(&mut tx, id).await?;
    }
    sqlx::query(r#"UPDATE "User" SET "isActive" = ?, "updatedAt" = ? WHERE "id" = ?"#)
        .bind(active)
        .bind(now_iso())
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn set_role(pool: &SqlitePool, id: &str, role_key: &str) -> Result<(), UserError> {
    let mut tx = begin_write(pool).await?;
    exists(&mut tx, id).await?;
    let is_owner: Option<bool> =
        sqlx::query_scalar(r#"SELECT "isOwner" FROM "Role" WHERE "key" = ?"#)
            .bind(role_key)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(is_owner) = is_owner else {
        return Err(UserError::UnknownRole);
    };
    if !is_owner && is_active_owner(&mut tx, id).await? {
        ensure_other_owner(&mut tx, id).await?;
    }
    sqlx::query(r#"UPDATE "User" SET "roleKey" = ?, "updatedAt" = ? WHERE "id" = ?"#)
        .bind(role_key)
        .bind(now_iso())
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn delete(pool: &SqlitePool, id: &str) -> Result<(), UserError> {
    let mut tx = begin_write(pool).await?;
    exists(&mut tx, id).await?;
    if is_active_owner(&mut tx, id).await? {
        ensure_other_owner(&mut tx, id).await?;
    }
    sqlx::query(r#"DELETE FROM "User" WHERE "id" = ?"#)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// Starts a transaction and takes the write lock right away (a no-op write
/// upgrades the deferred transaction before the guard reads anything).
async fn begin_write(pool: &SqlitePool) -> Result<Transaction<'static, Sqlite>, UserError> {
    let mut tx = pool.begin().await?;
    sqlx::query(r#"UPDATE "User" SET "id" = "id" WHERE 0"#)
        .execute(&mut *tx)
        .await?;
    Ok(tx)
}
