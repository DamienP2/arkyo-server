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
///
/// Only regular, single-link files are touched, through a descriptor opened
/// with `O_NOFOLLOW`: the data directory belongs to the service account, so
/// when root runs this a planted symlink or hard link must never redirect the
/// chmod to another file.
fn restrict_files(data_dir: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for name in DB_FILES {
            let p = data_dir.join(name);
            let file = match open_plain(&p) {
                Ok(Some(f)) => f,
                Ok(None) => continue,
                Err(why) => {
                    tracing::warn!("not tightening {}: {why}", p.display());
                    continue;
                }
            };
            if let Ok(m) = file.metadata() {
                if m.permissions().mode() & 0o077 != 0 {
                    // fchmod: acts on the file opened above, not on the path.
                    let _ = file.set_permissions(std::fs::Permissions::from_mode(0o600));
                }
            }
        }
    }
    #[cfg(not(unix))]
    let _ = data_dir;
}

/// Whether `m` (from `symlink_metadata` or `File::metadata`) is a regular file
/// with a single link: the only kind of base file root may chmod or chown.
#[cfg(unix)]
pub fn is_plain_file(m: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    m.file_type().is_file() && m.nlink() == 1
}

/// Opens a base file without following a symlink. `Ok(None)` when it does not
/// exist; `Err(reason)` when it is not a regular single-link file (symlink,
/// hard link, FIFO…) or cannot be opened, in which case it must be left alone.
#[cfg(unix)]
fn open_plain(p: &Path) -> Result<Option<std::fs::File>, String> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    let before = match std::fs::symlink_metadata(p) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if !is_plain_file(&before) {
        return Err("not a regular single-link file".into());
    }
    let file = std::fs::OpenOptions::new()
        .read(true)
        // O_NONBLOCK: a FIFO swapped in after the check must not block us.
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(p)
        .map_err(|e| e.to_string())?;
    let after = file.metadata().map_err(|e| e.to_string())?;
    if !is_plain_file(&after) || after.dev() != before.dev() || after.ino() != before.ino() {
        return Err("replaced while being checked".into());
    }
    Ok(Some(file))
}

/// Refuses a data directory whose base files are not regular single-link
/// files. Root must not let SQLite open (and write through) a symlink or a
/// hard link planted by the account that owns the directory.
#[cfg(unix)]
pub fn check_db_files(data_dir: &Path) -> anyhow::Result<()> {
    for name in DB_FILES {
        let p = data_dir.join(name);
        match std::fs::symlink_metadata(&p) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(e).with_context(|| format!("impossible de vérifier {}", p.display()))
            }
            Ok(m) if is_plain_file(&m) => {}
            Ok(_) => anyhow::bail!(
                "refus d'ouvrir la base en root : {} n'est pas un fichier ordinaire \
                 (lien symbolique, lien physique ou autre type). Le dossier de données \
                 a pu être modifié par un autre compte ; vérifiez-le, ou lancez la \
                 commande avec `sudo -u <propriétaire du dossier> arkyo-server …`.",
                p.display()
            ),
        }
    }
    Ok(())
}

/// Before a root CLI command opens the base in a directory root does not own
/// (`sudo arkyo-server user …` in `/var/lib/arkyo`): see [`check_db_files`].
#[cfg(unix)]
pub fn check_root_open(data_dir: &Path) -> anyhow::Result<()> {
    use std::os::unix::fs::MetadataExt;
    let Ok(dir) = std::fs::metadata(data_dir) else {
        return Ok(()); // created by `open`, hence empty
    };
    // SAFETY: geteuid has no preconditions and cannot fail.
    let euid = unsafe { libc::geteuid() };
    if should_chown(euid, dir.uid()) {
        check_db_files(data_dir)?;
    }
    Ok(())
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
    if should_chown(euid, dir.uid()) {
        hand_back(data_dir, dir.uid(), dir.gid());
    }
}

/// Chowns each regular single-link base file to `uid:gid` through a
/// descriptor opened with `O_NOFOLLOW` (fchown, never the path); anything
/// else is skipped with a warning. Returns the files handed back.
#[cfg(unix)]
fn hand_back(data_dir: &Path, uid: u32, gid: u32) -> Vec<std::path::PathBuf> {
    let mut done = Vec::new();
    for name in DB_FILES {
        let p = data_dir.join(name);
        let file = match open_plain(&p) {
            Ok(Some(f)) => f,
            Ok(None) => continue,
            Err(why) => {
                eprintln!(
                    "warning: {} left as it is ({why}); not giving it back to its owner",
                    p.display()
                );
                continue;
            }
        };
        match std::os::unix::fs::fchown(&file, Some(uid), Some(gid)) {
            Ok(()) => done.push(p),
            Err(e) => eprintln!(
                "warning: cannot give {} back to its owner: {e}",
                p.display()
            ),
        }
    }
    done
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    fn mode(p: &Path) -> u32 {
        std::fs::symlink_metadata(p).unwrap().permissions().mode() & 0o777
    }

    fn file_0644(p: &Path) {
        std::fs::write(p, b"x").unwrap();
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o644)).unwrap();
    }

    #[test]
    fn a_symlinked_base_is_never_followed() {
        let d = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let target = elsewhere.path().join("sudoers");
        file_0644(&target);
        std::os::unix::fs::symlink(&target, d.path().join("arkyo.db")).unwrap();

        restrict_files(d.path());
        assert_eq!(mode(&target), 0o644, "chmod went through the symlink");
        let (uid, gid) = (
            target.metadata().unwrap().uid(),
            target.metadata().unwrap().gid(),
        );
        assert!(hand_back(d.path(), uid, gid).is_empty());
        assert!(check_db_files(d.path())
            .unwrap_err()
            .to_string()
            .contains("n'est pas un fichier ordinaire"));
    }

    #[test]
    fn a_hard_linked_base_is_skipped() {
        let d = tempfile::tempdir().unwrap();
        let target = d.path().join("other");
        file_0644(&target);
        std::fs::hard_link(&target, d.path().join("arkyo.db-wal")).unwrap();

        restrict_files(d.path());
        assert_eq!(mode(&target), 0o644, "chmod reached a hard-linked file");
        let m = target.metadata().unwrap();
        assert!(hand_back(d.path(), m.uid(), m.gid()).is_empty());
        assert!(check_db_files(d.path()).is_err());
    }

    #[test]
    fn a_regular_base_is_tightened_and_handed_back() {
        let d = tempfile::tempdir().unwrap();
        let db = d.path().join("arkyo.db");
        file_0644(&db);
        assert!(check_db_files(d.path()).is_ok());
        restrict_files(d.path());
        assert_eq!(mode(&db), 0o600);
        // fchown to our own ids is allowed without root.
        let m = db.metadata().unwrap();
        assert_eq!(hand_back(d.path(), m.uid(), m.gid()), vec![db]);
        // A FIFO is neither opened (it would block) nor accepted.
        let fifo = d.path().join("arkyo.db-shm");
        let c = std::ffi::CString::new(fifo.as_os_str().as_encoded_bytes()).unwrap();
        // SAFETY: valid NUL-terminated path.
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o644) }, 0);
        assert!(check_db_files(d.path()).is_err());
        restrict_files(d.path());
        assert_eq!(mode(&fifo), 0o644);
    }

    #[test]
    fn plain_file_filter() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("f");
        std::fs::write(&f, b"").unwrap();
        assert!(is_plain_file(&std::fs::symlink_metadata(&f).unwrap()));
        std::os::unix::fs::symlink(&f, d.path().join("l")).unwrap();
        assert!(!is_plain_file(
            &std::fs::symlink_metadata(d.path().join("l")).unwrap()
        ));
        assert!(!is_plain_file(
            &std::fs::symlink_metadata(d.path()).unwrap()
        ));
        std::fs::hard_link(&f, d.path().join("h")).unwrap();
        assert!(!is_plain_file(&std::fs::symlink_metadata(&f).unwrap()));
    }
}
