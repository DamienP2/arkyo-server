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
                sqlx::query("INSERT INTO AppConfig (id, key, value, updatedAt) VALUES (?, ?, 'v', ?)")
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
