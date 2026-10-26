use arkyo_server::db::open;
use arkyo_server::users::{self, NewUser, UserError};

fn nu(email: &str, username: Option<&str>, role: &str) -> NewUser {
    NewUser {
        email: email.into(),
        name: None,
        username: username.map(Into::into),
        role_key: role.into(),
        password: "secret123".into(),
        must_change_password: false,
    }
}

async fn pool() -> (tempfile::TempDir, sqlx::SqlitePool) {
    let d = tempfile::tempdir().unwrap();
    let p = open(d.path()).await.unwrap();
    (d, p)
}

#[tokio::test]
async fn create_and_login_by_email_or_username() {
    let (_d, p) = pool().await;
    let u = users::create(&p, nu("Ana@Site.fr", Some("ana"), "owner"))
        .await
        .unwrap();
    let (a, hash) = users::find_by_identifier(&p, "ana@site.fr").await.unwrap();
    let (b, _) = users::find_by_identifier(&p, "ANA").await.unwrap();
    assert_eq!(a.id, u.id);
    assert_eq!(b.id, u.id);
    assert!(users::verify_password(&hash, "secret123"));
    assert!(!users::verify_password(&hash, "secret124"));
    assert!(hash.starts_with("$argon2id$"));
    assert!(users::find_by_identifier(&p, "nobody").await.is_none());
}

#[tokio::test]
async fn duplicate_email_and_username_rejected() {
    let (_d, p) = pool().await;
    users::create(&p, nu("a@b.fr", Some("a"), "owner"))
        .await
        .unwrap();
    assert!(matches!(
        users::create(&p, nu("A@B.fr", None, "owner")).await,
        Err(UserError::EmailTaken)
    ));
    assert!(matches!(
        users::create(&p, nu("c@b.fr", Some("A"), "owner")).await,
        Err(UserError::UsernameTaken)
    ));
    assert!(matches!(
        users::create(&p, nu("c@b.fr", None, "nope")).await,
        Err(UserError::UnknownRole)
    ));
}

#[tokio::test]
async fn weak_password_rejected() {
    let (_d, p) = pool().await;
    let mut n = nu("a@b.fr", None, "owner");
    n.password = "1234567".into();
    assert!(matches!(
        users::create(&p, n).await,
        Err(UserError::WeakPassword(_))
    ));
}

#[tokio::test]
async fn cannot_remove_disable_or_demote_last_active_owner() {
    let (_d, p) = pool().await;
    let a = users::create(&p, nu("a@b.fr", None, "owner"))
        .await
        .unwrap();
    assert!(matches!(
        users::delete(&p, &a.id).await,
        Err(UserError::LastOwner)
    ));
    assert!(matches!(
        users::set_active(&p, &a.id, false).await,
        Err(UserError::LastOwner)
    ));
    assert!(matches!(
        users::set_role(&p, &a.id, "technicien").await,
        Err(UserError::LastOwner)
    ));
    // a non-owner does not count; an inactive owner does not count either
    let t = users::create(&p, nu("t@b.fr", None, "technicien"))
        .await
        .unwrap();
    assert!(matches!(
        users::delete(&p, &a.id).await,
        Err(UserError::LastOwner)
    ));
    users::delete(&p, &t.id).await.unwrap();

    let b = users::create(&p, nu("b@b.fr", None, "owner"))
        .await
        .unwrap();
    users::set_role(&p, &a.id, "technicien").await.unwrap();
    assert!(matches!(
        users::set_active(&p, &b.id, false).await,
        Err(UserError::LastOwner)
    ));
    users::set_role(&p, &a.id, "owner").await.unwrap();
    users::set_active(&p, &b.id, false).await.unwrap();
    assert!(matches!(
        users::delete(&p, &a.id).await,
        Err(UserError::LastOwner)
    ));
    users::set_active(&p, &b.id, true).await.unwrap();
    users::delete(&p, &a.id).await.unwrap();
    assert_eq!(users::count(&p).await, 1);
    assert!(matches!(
        users::delete(&p, "zzz").await,
        Err(UserError::NotFound)
    ));
}

#[tokio::test]
async fn set_password_and_flags() {
    let (_d, p) = pool().await;
    let a = users::create(&p, nu("a@b.fr", None, "owner"))
        .await
        .unwrap();
    users::set_password(&p, &a.id, "newsecret1", true)
        .await
        .unwrap();
    let (u, h) = users::find_by_identifier(&p, "a@b.fr").await.unwrap();
    assert!(u.must_change_password);
    assert!(users::verify_password(&h, "newsecret1"));
    assert!(matches!(
        users::set_password(&p, &a.id, "short", false).await,
        Err(UserError::WeakPassword(_))
    ));
    assert_eq!(users::list(&p).await.len(), 1);
}

#[tokio::test]
async fn hash_is_not_serialized() {
    let (_d, p) = pool().await;
    let u = users::create(&p, nu("a@b.fr", None, "owner"))
        .await
        .unwrap();
    let j = serde_json::to_string(&u).unwrap();
    assert!(!j.contains("passwordHash") && !j.contains("argon2"));
    assert!(j.contains("roleKey") && j.contains("mustChangePassword"));
}

#[tokio::test]
async fn create_while_another_pool_is_open() {
    let d = tempfile::tempdir().unwrap();
    let a = open(d.path()).await.unwrap();
    let b = open(d.path()).await.unwrap();
    let u = users::create(&b, nu("a@b.fr", None, "owner"))
        .await
        .unwrap();
    assert_eq!(users::get(&a, &u.id).await.unwrap().email, "a@b.fr");
}

#[tokio::test]
async fn identifier_prefers_email_over_other_users_username() {
    // Whichever user was created first, an exact email match wins.
    for a_first in [true, false] {
        let (_d, p) = pool().await;
        let mk_a = || nu("a@site.fr", None, "technicien");
        let mk_b = || nu("b@site.fr", Some("a@site.fr"), "owner");
        let (a, b) = if a_first {
            let a = users::create(&p, mk_a()).await.unwrap();
            (a, users::create(&p, mk_b()).await.unwrap())
        } else {
            let b = users::create(&p, mk_b()).await.unwrap();
            (users::create(&p, mk_a()).await.unwrap(), b)
        };
        let (found, _) = users::find_by_identifier(&p, "a@site.fr").await.unwrap();
        assert_eq!(found.id, a.id, "a_first={a_first}");
        assert_ne!(found.id, b.id);
    }
}

#[tokio::test]
async fn reset_password_revokes_every_session() {
    let (_d, p) = pool().await;
    let u = users::create(&p, nu("a@b.fr", None, "owner"))
        .await
        .unwrap();
    let other = users::create(&p, nu("c@d.fr", None, "technicien"))
        .await
        .unwrap();
    let t1 = arkyo_server::sessions::create(&p, &u.id).await.unwrap();
    let t2 = arkyo_server::sessions::create(&p, &u.id).await.unwrap();
    let kept = arkyo_server::sessions::create(&p, &other.id).await.unwrap();
    users::reset_password(&p, &u.id, "nouveau123", true)
        .await
        .unwrap();
    assert!(arkyo_server::sessions::lookup(&p, &t1).await.is_none());
    assert!(arkyo_server::sessions::lookup(&p, &t2).await.is_none());
    assert!(arkyo_server::sessions::lookup(&p, &kept).await.is_some());
    let (fresh, hash) = users::find_by_identifier(&p, "a@b.fr").await.unwrap();
    assert!(users::verify_password(&hash, "nouveau123"));
    assert!(fresh.must_change_password);
}
