use arkyo_server::db::open;

async fn keys(pool: &sqlx::SqlitePool) -> Vec<String> {
    sqlx::query_scalar("SELECT key FROM Role ORDER BY key")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn open_creates_db_and_seeds_four_builtin_roles() {
    let d = tempfile::tempdir().unwrap();
    let pool = open(&d.path().join("sub")).await.unwrap();
    assert!(d.path().join("sub/arkyo.db").exists());
    assert_eq!(
        keys(&pool).await,
        ["chef-projet", "consultation", "owner", "technicien"]
    );
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM Role WHERE isBuiltin = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 4);
    let owner: (i64, String, String) =
        sqlx::query_as("SELECT isOwner, label, permissions FROM Role WHERE key = 'owner'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(owner.0, 1);
    assert_eq!(owner.1, "Propriétaire");
    let p = arkyo_core::permissions::parse_permissions(&owner.2);
    assert_eq!(p, arkyo_core::permissions::owner_permissions());
}

#[tokio::test]
async fn reopen_is_idempotent() {
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    sqlx::query("UPDATE Role SET label = 'Patron' WHERE key = 'owner'")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    let pool = open(d.path()).await.unwrap();
    assert_eq!(keys(&pool).await.len(), 4);
    let label: String = sqlx::query_scalar("SELECT label FROM Role WHERE key = 'owner'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(label, "Patron");
}

#[tokio::test]
async fn two_pools_can_write_concurrently() {
    let d = tempfile::tempdir().unwrap();
    let a = open(d.path()).await.unwrap();
    let b = open(d.path()).await.unwrap();
    async fn fill(pool: sqlx::SqlitePool, tag: &str) {
        let mut set = tokio::task::JoinSet::new();
        for i in 0..50 {
            let pool = pool.clone();
            let key = format!("{tag}-{i}");
            set.spawn(async move {
                sqlx::query(
                    "INSERT INTO AppConfig (id, key, value, updatedAt) VALUES (?, ?, 'v', ?)",
                )
                .bind(arkyo_server::ids::new_id())
                .bind(key)
                .bind(arkyo_server::ids::now_iso())
                .execute(&pool)
                .await
            });
        }
        while let Some(r) = set.join_next().await {
            r.unwrap().unwrap();
        }
    }
    tokio::join!(fill(a.clone(), "a"), fill(b, "b"));
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM AppConfig")
        .fetch_one(&a)
        .await
        .unwrap();
    assert_eq!(n, 100);
}

#[tokio::test]
async fn foreign_keys_enforced() {
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    let r = sqlx::query(
        "INSERT INTO User (id, email, passwordHash, roleKey, createdAt, updatedAt) \
         VALUES ('u1', 'a@b.c', 'x', 'inconnu', 'now', 'now')",
    )
    .execute(&pool)
    .await;
    assert!(r.is_err());
}

#[tokio::test]
async fn opens_a_base_migrated_by_a_newer_version() {
    // After a rollback, the base carries a migration this binary does not know.
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    sqlx::query(
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
         VALUES (9999, 'future phase', 1, X'00', 0)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("CREATE TABLE \"FutureTable\" (id TEXT PRIMARY KEY)")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    let pool = open(d.path())
        .await
        .expect("older binary opens a newer base");
    assert_eq!(keys(&pool).await.len(), 4);
}

#[tokio::test]
async fn open_errors_name_the_base() {
    let d = tempfile::tempdir().unwrap();
    // The data directory is a file.
    let file = d.path().join("plain-file");
    std::fs::write(&file, b"x").unwrap();
    let e = open(&file).await.unwrap_err();
    let msg = format!("{e:#}");
    assert!(
        msg.starts_with(&format!("cannot open {}", file.join("arkyo.db").display())),
        "{msg}"
    );
    // Not a SQLite file.
    let bad = d.path().join("bad");
    std::fs::create_dir_all(&bad).unwrap();
    std::fs::write(bad.join("arkyo.db"), vec![b'z'; 4096]).unwrap();
    let e = open(&bad).await.unwrap_err();
    let msg = format!("{e:#}");
    assert!(
        msg.starts_with(&format!("cannot open {}", bad.join("arkyo.db").display())),
        "{msg}"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn base_is_private_to_its_owner() {
    use std::os::unix::fs::PermissionsExt;
    let d = tempfile::tempdir().unwrap();
    let pool = open(d.path()).await.unwrap();
    for name in ["arkyo.db", "arkyo.db-wal", "arkyo.db-shm"] {
        let p = d.path().join(name);
        if p.exists() {
            let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "{name}");
        }
    }
    pool.close().await;
    // A base created readable by all is tightened on the next open.
    let p = d.path().join("arkyo.db");
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o644)).unwrap();
    let _pool = open(d.path()).await.unwrap();
    let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
}

#[test]
fn only_root_in_a_directory_it_does_not_own_hands_files_back() {
    use arkyo_server::db::should_chown;
    assert!(should_chown(0, 998)); // sudo in /var/lib/arkyo (owned by arkyo)
    assert!(!should_chown(0, 0)); // root in a root-owned directory (macOS service)
    assert!(!should_chown(998, 998)); // sudo -u arkyo
    assert!(!should_chown(501, 998)); // another account: cannot chown anyway
}
