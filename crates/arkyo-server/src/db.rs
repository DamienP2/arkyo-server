//! SQLite database: connection options, migrations and built-in role seed.

use std::path::Path;
use std::time::Duration;

use anyhow::Context;
use arkyo_core::permissions::BUILTIN_ROLES;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::ids::{new_id, now_iso};

/// Opens (creating if needed) `<data_dir>/arkyo.db`, migrates it and seeds the built-in roles.
///
/// Migrations already applied by a newer version are ignored: after a rollback
/// (or the install of an older package) this binary must still open the base.
/// Hence the rule: migrations are additive only, and an older binary must
/// tolerate the tables and columns a newer one added.
pub async fn open(data_dir: &Path) -> anyhow::Result<SqlitePool> {
    let path = data_dir.join("arkyo.db");
    let ctx = || format!("cannot open {}", path.display());
    std::fs::create_dir_all(data_dir).with_context(ctx)?;
    create_private(&path).with_context(ctx)?;
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await
        .with_context(ctx)?;
    restrict_files(data_dir);
    let mut migrator = sqlx::migrate!("./migrations");
    migrator.set_ignore_missing(true);
    migrator.run(&pool).await.with_context(ctx)?;
    seed_builtin_roles(&pool).await.with_context(ctx)?;
    Ok(pool)
}

/// The base and its WAL companions.
pub const DB_FILES: [&str; 3] = ["arkyo.db", "arkyo.db-wal", "arkyo.db-shm"];

/// Creates an empty base readable by its owner only (it holds the password
/// hashes); SQLite gives its `-wal` / `-shm` files the same mode.
fn create_private(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
        {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
            Err(e) => Err(e),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

/// Tightens a base created before it was made private (best effort: a file
/// of another account is left as it is).
fn restrict_files(data_dir: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for name in DB_FILES {
            let p = data_dir.join(name);
            if let Ok(m) = std::fs::metadata(&p) {
                if m.permissions().mode() & 0o077 != 0 {
                    let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
                }
            }
        }
    }
    #[cfg(not(unix))]
    let _ = data_dir;
}

/// Whether a command run with effective uid `euid` must hand the files it
/// created back to the owner of the data directory: root writing into the
/// directory of the service account would otherwise leave files the service
/// cannot open.
pub fn should_chown(euid: u32, dir_owner: u32) -> bool {
    euid == 0 && dir_owner != 0
}

/// After a CLI command: gives the base files back to the owner of the data
/// directory when root ran it in a directory it does not own.
#[cfg(unix)]
pub fn restore_owner(data_dir: &Path) {
    use std::os::unix::fs::MetadataExt;
    let Ok(dir) = std::fs::metadata(data_dir) else {
        return;
    };
    // SAFETY: geteuid has no preconditions and cannot fail.
    let euid = unsafe { libc::geteuid() };
    if !should_chown(euid, dir.uid()) {
        return;
    }
    for name in DB_FILES {
        let p = data_dir.join(name);
        if p.exists() {
            if let Err(e) = std::os::unix::fs::chown(&p, Some(dir.uid()), Some(dir.gid())) {
                eprintln!(
                    "warning: cannot give {} back to its owner: {e}",
                    p.display()
                );
            }
        }
    }
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
