//! SQLite database: connection options, migrations and built-in role seed.

use std::path::Path;
use std::time::Duration;

use arkyo_core::permissions::BUILTIN_ROLES;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::ids::{new_id, now_iso};

/// Opens (creating if needed) `<data_dir>/arkyo.db`, migrates it and seeds the built-in roles.
pub async fn open(data_dir: &Path) -> anyhow::Result<SqlitePool> {
    std::fs::create_dir_all(data_dir)?;
    let options = SqliteConnectOptions::new()
        .filename(data_dir.join("arkyo.db"))
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    seed_builtin_roles(&pool).await?;
    Ok(pool)
}

/// Inserts missing built-in roles; existing (possibly edited) roles are left untouched.
async fn seed_builtin_roles(pool: &SqlitePool) -> anyhow::Result<()> {
    for role in BUILTIN_ROLES {
        let now = now_iso();
        sqlx::query(
            "INSERT INTO Role (id, key, label, color, isOwner, isBuiltin, permissions, createdAt, updatedAt) \
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(key) DO NOTHING",
        )
        .bind(new_id())
        .bind(role.key)
        .bind(role.label)
        .bind(role.color)
        .bind(role.is_owner)
        .bind(serde_json::to_string(&role.permissions())?)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;
    }
    Ok(())
}
