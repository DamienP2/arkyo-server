# Phase 1 — Socle : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Livrer un `arkyo-server` installable sur macOS, Windows et Ubuntu, qui sert la coquille d'arkyo (connexion, sidebar, topbar, thème, langue, notifications) depuis un binaire Rust unique, avec service natif, app tray, mise à jour intégrée et releases GitHub.

**Architecture :** Un workspace Rust calqué sur CG : `arkyo-core` (logique pure), `arkyo-server` (axum + SQLite via sqlx, front embarqué avec rust-embed) et `arkyo-tray`. Le front est une SPA Vite qui reprend **verbatim** le code d'arkyo. Les imports `next/*` y sont redirigés par des alias Vite vers de petits shims, pour que les fichiers copiés compilent sans retouche.

**Tech Stack :** Rust stable (edition 2021), axum 0.8, tokio, sqlx 0.8 (sqlite), argon2 0.5, clap 4, rust-embed 8, ureq 3, tray-icon/tao, React 19.2.4, Vite, Tailwind CSS v4, Vitest, react-router 7, WiX 5, pkgbuild/productbuild.

**Spec :** [`docs/superpowers/specs/2026-10-26-arkyo-server-design.md`](../specs/2026-10-26-arkyo-server-design.md)

## Global Constraints

- **Référence fonctionnelle** : arkyo au commit `88b2e4b245b3c11bb8e4a8989c83fe98b063582d`. **Référence d'architecture** : CG au commit `8ad8b56`. Les deux sont clonés dans `.ref/arkyo` et `.ref/cg` (Task 1). Dans ce plan, `arkyo:<chemin>` et `cg:<chemin>` désignent des fichiers de ces clones.
- Exécutable `arkyo-server`, app tray `arkyo-tray`, service `arkyo-server`, repo de mise à jour `DamienP2/arkyo-server`.
- Paquets : `Arkyo-<version>-macos-universal.pkg|.dmg`, `Arkyo-<version>-windows-x64.msi`, `Arkyo-<version>-ubuntu-x64.tar.gz`. Paquets de mise à jour : `Arkyo-<version>-{macos-arm64,macos-x86_64,windows-x86_64,linux-x86_64}` (`.tar.gz`, `.zip` pour Windows).
- Port HTTP par défaut **8090**, bind par défaut `0.0.0.0`.
- Dossier de données : interactif = `directories::ProjectDirs::from("com", "Arkyo", "Arkyo").data_dir()` ; service = `%ProgramData%\Arkyo` (Windows), `/Library/Application Support/Arkyo` (macOS), `/var/lib/arkyo` (Linux). Variable d'environnement `ARKYO_DATA_DIR`.
- Contenu du dossier de données : `arkyo.db` (SQLite, WAL), `config.json`, `uploads/`.
- **API** : chemins, formes JSON et messages d'erreur identiques à arkyo pour toute route reprise. Erreur = `{ "error": "<message FR>" }` avec le même code HTTP qu'arkyo.
- **Base** : tables = noms des modèles Prisma (PascalCase), colonnes = noms des champs Prisma (camelCase, entre guillemets). ID = cuid v1 (`cuid::cuid1()`), dates = TEXT ISO 8601 UTC avec millisecondes (`2026-10-26T10:00:00.000Z`), booléens = INTEGER 0/1, JSON = TEXT. Pas de macros `sqlx::query!` (pas de `DATABASE_URL` au build).
- **Front** : les fichiers repris d'arkyo sont copiés **à l'identique** au même chemin relatif sous `web/src/` (alias `@/*` → `web/src/*`). On ne modifie un fichier copié que pour retirer ce qui relève du SaaS (liste au §2 de la spec), et chaque retrait est commenté `// arkyo-server: <raison>`.
- Versions npm : celles de `arkyo:package.json` pour toute dépendance reprise.
- Textes UI en français, comme arkyo.
- Une table n'est créée que par la phase qui la consomme. La phase 1 ne crée que `User`, `UserProfile`, `Role`, `AuthSession`, `Notification` et `AppConfig`.

## Review Focus

1. **Premier admin à distance** : sans aucun utilisateur, un `POST /api/auth/setup` venant d'une IP non-loopback doit être refusé (403). Avec un utilisateur existant, il doit répondre 409, même en local. → tests Task 4.
2. **Session d'un compte désactivé ou supprimé** : la requête suivante doit répondre 401, même avec un cookie encore valide. → test Task 4.
3. **Verrouillage hors du site** : la CLI ne doit pas pouvoir supprimer, désactiver ni rétrograder le dernier propriétaire actif. → test Task 3.
4. **Fallback SPA** : une URL profonde (`/project/abc/synoptique`) rechargée sert `index.html`, mais `/api/inconnu` renvoie un 404 JSON, et `/uploads/../arkyo.db` ne sort jamais du dossier `uploads`. → tests Task 5.
5. **CLI pendant que le service tourne** : `arkyo-server user add` sur la base ouverte par le service doit aboutir (WAL + `busy_timeout` 5 s) et viser le dossier du service quand il existe. → tests Task 2 et Task 3.

---

## Structure des fichiers

```
Cargo.toml                         workspace (version, deps partagées, profil release copié de cg:Cargo.toml)
.gitignore                         target/, web/node_modules, web/dist, .ref/
scripts/fetch-refs.sh              clone arkyo et CG aux commits de référence dans .ref/
crates/arkyo-core/src/lib.rs       modules purs
crates/arkyo-core/src/permissions.rs   domaines, niveaux, rôles intégrés, résolution
crates/arkyo-core/src/password.rs      validation de mot de passe
crates/arkyo-server/build.rs       gzip du front (copié de cg:crates/cg-server/build.rs, sans examples())
crates/arkyo-server/migrations/0001_socle.sql
crates/arkyo-server/src/main.rs    CLI clap, démarrage
crates/arkyo-server/src/paths.rs   dossiers de données (adapté de cg)
crates/arkyo-server/src/config.rs  config.json
crates/arkyo-server/src/db.rs      pool SQLite, migrations, amorçage des rôles
crates/arkyo-server/src/ids.rs     cuid + horodatage ISO
crates/arkyo-server/src/users.rs   dépôt utilisateurs + hachage Argon2
crates/arkyo-server/src/sessions.rs    sessions par cookie
crates/arkyo-server/src/http/mod.rs    routeur, état partagé, extracteurs
crates/arkyo-server/src/http/auth.rs   /api/auth/*
crates/arkyo-server/src/http/me.rs     /api/tenant/me/permissions, /api/site, /api/platform/locale
crates/arkyo-server/src/http/notifications.rs
crates/arkyo-server/src/http/presence.rs   stubs (phase 7)
crates/arkyo-server/src/http/system.rs     /api/system, /api/system/update/*
crates/arkyo-server/src/web.rs     front embarqué + /uploads
crates/arkyo-server/src/service.rs service natif (adapté de cg)
crates/arkyo-server/src/update.rs  mise à jour (adapté de cg)
crates/arkyo-server/tests/*.rs     tests d'intégration HTTP
crates/arkyo-tray/                 adapté de cg:crates/cg-tray
web/                               SPA Vite (voir Task 6 et 7)
packaging/                         macos/ windows/ linux/ stamp-version.sh
.github/workflows/ci.yml, release.yml
assets/icons/                      icônes générées depuis arkyo:public/favicon.svg
docs/INSTALL.md, README.md, CLAUDE.md, UI_PATTERNS.md
```

---

### Task 1 : Workspace, CLI et configuration

**Files :**
- Create : `Cargo.toml`, `.gitignore`, `scripts/fetch-refs.sh`, `crates/arkyo-core/{Cargo.toml,src/lib.rs}`, `crates/arkyo-server/{Cargo.toml,src/main.rs,src/paths.rs,src/config.rs}`
- Test : `crates/arkyo-server/src/config.rs` (module `tests`), `crates/arkyo-server/src/paths.rs` (module `tests`)

**Interfaces :**
- Produces :
  - `paths::SERVICE_NAME: &str = "arkyo-server"`, `paths::user_data_dir() -> PathBuf`, `paths::system_data_dir() -> PathBuf`
  - `paths::cli_data_dir(explicit: Option<PathBuf>) -> PathBuf` = `cli_data_dir_in(explicit, &system_data_dir(), &user_data_dir())`, et `paths::cli_data_dir_in(explicit: Option<PathBuf>, system: &Path, user: &Path) -> PathBuf` : la valeur explicite, sinon `system` s'il contient `config.json`, sinon `user` (même règle que `cg:crates/cg-server/src/main.rs::cli_data_dir`). Le service écrit toujours `config.json` au démarrage, ce qui rend son dossier détectable.
  - `config::Config { port: u16, bind: IpAddr }` (serde camelCase), `Config::load(dir: &Path) -> Config` (défauts si absent ou illisible), `Config::save(&self, dir: &Path) -> anyhow::Result<()>` (écriture atomique : fichier temporaire puis rename).
  - CLI `arkyo-server [run] [--port N] [--bind IP] [--data-dir DIR]` (env `ARKYO_PORT`, `ARKYO_BIND`, `ARKYO_DATA_DIR`), sous-commandes `service …` et `user …` déclarées vides ici et remplies dans les Tasks 3 et 9.

- [ ] **Step 1 : Écrire `scripts/fetch-refs.sh` et l'exécuter.** Le script clone `https://github.com/DamienP2/arkyo` et `https://github.com/DamienP2/CG` dans `.ref/arkyo` et `.ref/cg`, puis fait un checkout des commits de référence. Il est idempotent. Run : `bash scripts/fetch-refs.sh && git -C .ref/arkyo rev-parse HEAD` → `88b2e4b245b3c11bb8e4a8989c83fe98b063582d`.
- [ ] **Step 2 : Écrire les tests de config et de chemins**

```rust
#[test] fn defaults_when_missing() { let d = tempfile::tempdir().unwrap(); let c = Config::load(d.path()); assert_eq!(c.port, 8090); assert_eq!(c.bind.to_string(), "0.0.0.0"); }
#[test] fn roundtrip() { /* save {port: 9001} puis load → 9001 ; le fichier contient "port": 9001 */ }
#[test] fn unreadable_falls_back_to_defaults() { /* config.json = "{oops" → port 8090 */ }
#[test] fn cli_data_dir_prefers_explicit() { assert_eq!(cli_data_dir_in(Some("/x".into()), sys, usr), PathBuf::from("/x")); }
#[test] fn cli_data_dir_targets_service_dir_when_it_has_config() { /* sys contient config.json → sys ; sinon → usr */ }
```

- [ ] **Step 3 : Lancer les tests.** Run : `cargo test -p arkyo-server` → FAIL (les modules n'existent pas).
- [ ] **Step 4 : Implémenter** le workspace (dépendances partagées et `[profile.release]` repris de `cg:Cargo.toml`, `version = "0.1.0"`, `license = "UNLICENSED"`), `paths.rs` (adapté de `cg:crates/cg-server/src/paths.rs` sans la migration PulseCG), `config.rs` et `main.rs`. `run` démarre un serveur axum qui répond `200 ok` sur `/healthz` et écrit dans les logs (`tracing-subscriber`, filtre `RUST_LOG`, défaut `info`) l'adresse d'écoute.
- [ ] **Step 5 : Lancer les tests et le binaire.** Run : `cargo test -p arkyo-server` → PASS. Puis `cargo run -p arkyo-server -- --data-dir /tmp/ak --port 8099 &` et `curl -s localhost:8099/healthz` → `ok`.
- [ ] **Step 6 : Commit**

```bash
git add -A && git commit -m "feat: workspace, CLI et configuration"
```

---

### Task 2 : Base SQLite et migration du socle

**Files :**
- Create : `crates/arkyo-server/migrations/0001_socle.sql`, `src/db.rs`, `src/ids.rs`, `crates/arkyo-core/src/permissions.rs`
- Test : `crates/arkyo-server/tests/db.rs`, `crates/arkyo-core/src/permissions.rs` (module `tests`), `crates/arkyo-server/src/ids.rs` (module `tests`)

**Interfaces :**
- Produces :
  - `ids::new_id() -> String` (cuid v1), `ids::now_iso() -> String` (format `%Y-%m-%dT%H:%M:%S%.3fZ`, UTC, via `jiff`).
  - `db::open(data_dir: &Path) -> anyhow::Result<sqlx::SqlitePool>` : crée le dossier, ouvre `arkyo.db` avec `create_if_missing`, `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5s`, applique `sqlx::migrate!("./migrations")`, puis `seed_builtin_roles`.
  - `arkyo_core::permissions` : `enum Domain { Projects, Design, Catalog, Members, Settings }` (serde `"projects"`…), `enum Level { None, Read, Write, Admin }` (ordonné, serde minuscule), `type Permissions = BTreeMap<Domain, Level>`, `struct BuiltinRole { key, label, color, is_owner, permissions }`, `const BUILTIN_ROLES: [BuiltinRole; 4]`, `fn parse_permissions(json: &str) -> Permissions` (clé inconnue ignorée, domaine manquant = `None`, JSON invalide = tout `None`), `fn has_permission(p: &Permissions, d: Domain, min: Level) -> bool`, `fn owner_permissions() -> Permissions` (tout `Admin`).

Schéma `0001_socle.sql`, repris des modèles d'arkyo (`arkyo:database/main/schema.prisma` pour `User`, `UserProfile`, `Notification`, `AppConfig` via `arkyo:database/tenant/schema.prisma`, et `TenantRole` sans `tenantId`) :

| Table | Colonnes |
| --- | --- |
| `Role` | `id` PK, `key` UNIQUE, `label`, `color` défaut `'#6b7280'`, `isOwner`, `isBuiltin`, `permissions` TEXT défaut `'{}'`, `createdAt`, `updatedAt` |
| `User` | `id` PK, `email` UNIQUE NOT NULL (COLLATE NOCASE), `name`, `username` UNIQUE NULL (COLLATE NOCASE), `passwordHash` NOT NULL, `mustChangePassword` défaut 0, `roleKey` NOT NULL → `Role(key)` ON UPDATE CASCADE, `isActive` défaut 1, `locale` défaut `'fr'`, `lastLogin`, `createdAt`, `updatedAt` |
| `UserProfile` | colonnes d'arkyo (`civility`, `firstName`, `lastName`, `phone`, `company`, `jobTitle`, `avatarUrl`), `userId` UNIQUE → `User` ON DELETE CASCADE |
| `AuthSession` | `id` PK, `tokenHash` UNIQUE (sha256 hex), `userId` → `User` ON DELETE CASCADE, `createdAt`, `expiresAt`, `lastSeenAt` |
| `Notification` | colonnes d'arkyo, `recipientId` → `User` ON DELETE CASCADE, index `(recipientId, readAt)` et `(recipientId, createdAt)` |
| `AppConfig` | `id` PK, `key` UNIQUE, `value`, `updatedAt` |

Rôles intégrés (valeurs exactes de `arkyo:scripts/backfill-tenant-roles.ts`) :

| key | label | color | isOwner | projects | design | catalog | members | settings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `owner` | Propriétaire | `#7c3aed` | oui | admin | admin | admin | admin | admin |
| `chef-projet` | Chef de projet | `#4f46e5` | non | write | write | write | none | none |
| `technicien` | Technicien | `#059669` | non | write | write | read | none | none |
| `consultation` | Consultation | `#6b7280` | non | read | none | read | none | none |

- [ ] **Step 1 : Écrire les tests**

```rust
// crates/arkyo-server/tests/db.rs
#[tokio::test] async fn open_creates_db_and_seeds_four_builtin_roles() { /* open(tmp) ; SELECT key FROM Role ORDER BY key → ["chef-projet","consultation","owner","technicien"] ; tous isBuiltin=1 */ }
#[tokio::test] async fn reopen_is_idempotent() { /* open deux fois → toujours 4 rôles ; un label modifié par l'utilisateur n'est pas écrasé */ }
#[tokio::test] async fn two_pools_can_write_concurrently() { /* deux open() sur le même dossier, 50 INSERT AppConfig chacun en parallèle → 100 lignes, aucune erreur "database is locked" */ }
#[tokio::test] async fn foreign_keys_enforced() { /* INSERT User avec roleKey "inconnu" → erreur */ }
// arkyo-core permissions
#[test] fn parse_ignores_unknown_and_defaults_none() { let p = parse_permissions(r#"{"projects":"write","foo":"admin"}"#); assert_eq!(p[&Domain::Projects], Level::Write); assert_eq!(p[&Domain::Settings], Level::None); }
#[test] fn level_ordering() { assert!(has_permission(&owner_permissions(), Domain::Members, Level::Admin)); }
// arkyo-server ids (module tests de src/ids.rs)
#[test] fn ids_format() { assert!(new_id().starts_with('c') && new_id().len() == 25); let t = now_iso(); assert_eq!(t.len(), 24); assert!(t.ends_with('Z') && t.as_bytes()[19] == b'.'); }
```

- [ ] **Step 2 : Lancer les tests.** Run : `cargo test --workspace` → FAIL.
- [ ] **Step 3 : Implémenter** la migration, `db.rs`, `ids.rs` et `permissions.rs`. `seed_builtin_roles` fait un `INSERT … ON CONFLICT(key) DO NOTHING` pour ne pas écraser les rôles édités.
- [ ] **Step 4 : Lancer les tests.** Run : `cargo test --workspace` → PASS.
- [ ] **Step 5 : Commit**

```bash
git add -A && git commit -m "feat: base SQLite, migration du socle et rôles intégrés"
```

---

### Task 3 : Utilisateurs, mots de passe et CLI `user`

**Files :**
- Create : `crates/arkyo-core/src/password.rs`, `crates/arkyo-server/src/users.rs`
- Modify : `crates/arkyo-server/src/main.rs` (sous-commande `user`)
- Test : `crates/arkyo-server/tests/users.rs`

**Interfaces :**
- Consumes : `db::open`, `ids::*`, `permissions::*` (Task 2).
- Produces :
  - `arkyo_core::password::validate(pw: &str) -> Result<(), String>` : au moins 8 caractères, sinon `Err("Le mot de passe doit contenir au moins 8 caractères")`.
  - `users::User { id, email, name: Option<String>, username: Option<String>, role_key, must_change_password: bool, is_active: bool, locale, last_login: Option<String>, created_at, updated_at }` (serde camelCase, sans le hash).
  - `users::NewUser { email, name: Option<String>, username: Option<String>, role_key: String, password: String, must_change_password: bool }`
  - `users::create(pool, NewUser) -> Result<User, UserError>`, `find_by_identifier(pool, &str) -> Option<(User, String /*hash*/)>` (email **ou** username, insensible à la casse), `get(pool, id) -> Option<User>`, `list(pool) -> Vec<User>`, `set_password(pool, id, pw, must_change: bool)`, `set_active(pool, id, bool)`, `set_role(pool, id, role_key)`, `delete(pool, id)`, `verify_password(hash, pw) -> bool` (Argon2id, paramètres par défaut du crate `argon2`), `count(pool) -> i64`.
  - `UserError` : `EmailTaken`, `UsernameTaken`, `UnknownRole`, `WeakPassword(String)`, `LastOwner`, `NotFound`, `Db(sqlx::Error)` ; `Display` en français.
  - CLI : `arkyo-server user add <email> [--name N] [--username U] [--role owner|chef-projet|technicien|consultation|<clé>] [--temporary] [--data-dir D]` (rôle par défaut `owner`, mot de passe demandé deux fois avec `rpassword` comme `cg:…/main.rs::prompt_password`), `user passwd <email|username> [--temporary]`, `user list`, `user remove <email|username>`, `user disable|enable <email|username>`.

- [ ] **Step 1 : Écrire les tests**

```rust
#[tokio::test] async fn create_and_login_by_email_or_username() { /* create {email "Ana@Site.fr", username "ana"} ; find_by_identifier("ana@site.fr") et ("ANA") → même id ; verify_password(hash,"secret123") */ }
#[tokio::test] async fn duplicate_email_rejected() { /* → UserError::EmailTaken */ }
#[tokio::test] async fn weak_password_rejected() { /* "1234567" → WeakPassword */ }
#[tokio::test] async fn cannot_remove_disable_or_demote_last_active_owner() { /* un seul owner : delete, set_active(false), set_role("technicien") → LastOwner ; avec 2 owners → ok */ }
#[tokio::test] async fn hash_is_not_serialized() { /* serde_json::to_string(&user) ne contient pas "passwordHash" */ }
#[tokio::test] async fn create_while_another_pool_is_open() { /* pool A ouvert (le « service ») ; create() via un pool B sur le même dossier → ok, visible depuis A */ }
```

- [ ] **Step 2 : Lancer les tests.** Run : `cargo test -p arkyo-server --test users` → FAIL.
- [ ] **Step 3 : Implémenter** `password.rs`, `users.rs` et la CLI. La garde `LastOwner` s'applique dans `delete`, `set_active(false)` et `set_role`, dans une transaction : compter les autres utilisateurs actifs dont le rôle a `isOwner = 1`.
- [ ] **Step 4 : Lancer les tests et un essai manuel.** Run : `cargo test -p arkyo-server` → PASS. Puis `cargo run -p arkyo-server -- user add a@b.fr --data-dir /tmp/ak` (saisir `secret123` deux fois) et `… user list --data-dir /tmp/ak` → une ligne `a@b.fr  owner`.
- [ ] **Step 5 : Commit**

```bash
git add -A && git commit -m "feat: comptes locaux Argon2 et CLI user"
```

---

### Task 4 : API HTTP du socle (auth, session, permissions, notifications)

**Files :**
- Create : `src/sessions.rs`, `src/http/{mod.rs,auth.rs,me.rs,notifications.rs,presence.rs}`
- Modify : `src/main.rs` (monter le routeur)
- Test : `crates/arkyo-server/tests/http_auth.rs`, `tests/http_notifications.rs`

**Interfaces :**
- Consumes : `users::*` (Task 3), `permissions::*` (Task 2).
- Produces :
  - `http::AppState { pool: SqlitePool, data_dir: PathBuf, config: Arc<RwLock<Config>> }`, `http::router(state: AppState) -> axum::Router` (servi avec `into_make_service_with_connect_info::<SocketAddr>()`).
  - Extracteur `http::CurrentUser(User)` : lit le cookie `arkyo_session`, cherche `sha256(token)` dans `AuthSession` non expirée, recharge l'utilisateur, refuse s'il est inactif ou supprimé. Échec → `401 {"error":"Non authentifié"}`. Met à jour `lastSeenAt` au plus une fois par minute.
  - `http::require(user: &User, pool, Domain, Level) -> Result<(), Response>` → `403 {"error":"Accès refusé"}`.
  - `sessions::create(pool, user_id) -> String /*token*/` (32 octets aléatoires, base64url), durée **30 jours** ; `sessions::revoke(pool, token)`, `sessions::revoke_all_for(pool, user_id)`.
  - Cookie : `arkyo_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`.

Routes :

| Méthode et chemin | Accès | Réponse |
| --- | --- | --- |
| `GET /api/auth/state` | public | `{ "needsSetup": bool, "local": bool }` (`local` = IP du client loopback) |
| `POST /api/auth/setup` `{email,name,username?,password}` | public, loopback, aucun utilisateur | crée un `owner`, ouvre la session, `200 {user}` ; IP distante → 403 `{"error":"La création du premier compte se fait depuis le serveur"}` ; utilisateurs existants → 409 |
| `POST /api/auth/login` `{identifier,password}` | public | `200 {user, mustChangePassword}` + cookie ; mauvais couple → 401 `{"error":"Identifiant ou mot de passe incorrect"}` ; compte inactif → 403 `{"error":"Compte désactivé"}` ; met à jour `lastLogin` |
| `POST /api/auth/logout` | public | révoque la session, efface le cookie, `200 {"ok":true}` |
| `GET /api/auth/session` | public | forme next-auth : `{"user":{"id","email","name","role","collaboratorRole":null},"expires"}` où `role` est le `MemberRole` d'arkyo (`owner`→`OWNER`, `chef-projet`→`CHEF_PROJET`, `technicien`→`TECHNICIEN`, `consultation`→`CONSULTATION`, autre clé→`TECHNICIEN`) ; sans session → `200 null` |
| `POST /api/auth/password` `{currentPassword,newPassword}` | connecté | vérifie l'actuel, valide le nouveau, `mustChangePassword=0`, révoque les **autres** sessions, `200 {"ok":true}` |
| `GET /api/tenant/me/permissions` | connecté | `{isOwner, roleKey, permissions}` (forme de `arkyo:app/api/tenant/me/permissions/route.ts`) |
| `GET /api/site` | connecté | `{ "name": <AppConfig "site.name" ou ""> }` |
| `POST /api/platform/locale` `{locale}` | connecté | même contrat que `arkyo:app/api/platform/locale/route.ts` ; écrit `User.locale` |
| `GET/PATCH /api/notifications`, `GET /api/notifications/count`, `PATCH/DELETE /api/notifications/:id` | connecté | mêmes paramètres et formes que les routes `arkyo:app/api/notifications/**` |
| `GET /api/presence` → `{"members":[]}`, `POST /api/presence` → `{"ok":true}` | connecté | stubs jusqu'à la phase 7 |
| toute autre route `/api/*` | — | `404 {"error":"Not found"}` |

Tant que `mustChangePassword = 1`, toute route `/api/*` autre que `auth/*` répond `403 {"error":"Changement de mot de passe requis","code":"PASSWORD_CHANGE_REQUIRED"}`.

- [ ] **Step 1 : Écrire les tests** (routeur en `oneshot`, `ConnectInfo` injecté à la main)

```rust
#[tokio::test] async fn setup_refused_from_remote_ip() { /* base vide, peer 192.168.1.20 → 403 */ }
#[tokio::test] async fn setup_refused_when_users_exist_even_locally() { /* → 409 */ }
#[tokio::test] async fn setup_then_session_shape() { /* setup local → cookie ; GET /api/auth/session → user.role == "OWNER", collaboratorRole null */ }
#[tokio::test] async fn login_wrong_password_401_inactive_403() {}
#[tokio::test] async fn disabled_user_session_rejected_on_next_request() { /* login, set_active(false) via users::, GET /api/tenant/me/permissions → 401 */ }
#[tokio::test] async fn must_change_password_blocks_api_until_changed() { /* user --temporary ; GET /api/site → 403 code PASSWORD_CHANGE_REQUIRED ; POST /api/auth/password → 200 ; GET /api/site → 200 */ }
#[tokio::test] async fn permissions_shape_for_technicien() { /* {isOwner:false, roleKey:"technicien", permissions:{projects:"write",design:"write",catalog:"read",members:"none",settings:"none"}} */ }
#[tokio::test] async fn unknown_api_route_is_json_404() {}
#[tokio::test] async fn notifications_list_count_read_delete() { /* 3 notifications insérées ; count → 3 ; PATCH :id → count 2 ; DELETE → total 2 ; un autre utilisateur ne voit rien */ }
```

- [ ] **Step 2 : Lancer les tests.** Run : `cargo test -p arkyo-server --test http_auth --test http_notifications` → FAIL.
- [ ] **Step 3 : Implémenter** `sessions.rs` et `http/*`. Les handlers de notifications reproduisent la logique de `arkyo:app/api/notifications/**` (pagination, `limit`, filtre, action `markAllRead` : lire le fichier pour les noms exacts).
- [ ] **Step 4 : Lancer les tests.** Run : `cargo test --workspace` → PASS.
- [ ] **Step 5 : Commit**

```bash
git add -A && git commit -m "feat: API d'authentification, permissions et notifications"
```

---

### Task 5 : Front embarqué et fichiers uploadés

**Files :**
- Create : `crates/arkyo-server/build.rs`, `src/web.rs`
- Modify : `src/http/mod.rs` (monter `web::routes()` en dernier)
- Test : `crates/arkyo-server/tests/http_web.rs`

**Interfaces :**
- Produces : `web::routes(data_dir: &Path) -> Router<AppState>`. Il sert : `GET /uploads/*path` depuis `<data_dir>/uploads` (chemin canonicalisé, refus de toute sortie du dossier → 404) ; les fichiers de `web/dist` embarqués via `rust-embed`, avec la version `.gz` si le client accepte gzip (comme `cg:crates/cg-server/src/web.rs`) ; et le **fallback SPA** `index.html` pour toute autre URL hors `/api/`. `Cache-Control: no-cache` pour `index.html`, `public, max-age=31536000, immutable` pour `assets/*`.

- [ ] **Step 1 : Écrire les tests**

```rust
#[tokio::test] async fn deep_link_serves_index() { /* GET /project/abc/synoptique → 200 text/html */ }
#[tokio::test] async fn api_not_swallowed_by_spa() { /* GET /api/inconnu → 404 application/json */ }
#[tokio::test] async fn uploads_served_and_traversal_blocked() { /* uploads/a/x.png servi ; GET /uploads/../arkyo.db et /uploads/%2e%2e/arkyo.db → 404 */ }
#[tokio::test] async fn gzip_variant_when_accepted() { /* Accept-Encoding: gzip sur un .js > 512 o → Content-Encoding: gzip (test sauté si web/dist est vide) */ }
```

- [ ] **Step 2 : Lancer les tests.** Run : `cargo test -p arkyo-server --test http_web` → FAIL.
- [ ] **Step 3 : Implémenter** `build.rs` (copie de `cg:crates/cg-server/build.rs` sans `examples()`, icône Windows `assets/icons/arkyo.ico`, `FileDescription` = « Arkyo Server », `ProductName` = « Arkyo ») et `web.rs`. Sans `web/dist`, `/` affiche une page texte qui explique `cd web && npm run build`.
- [ ] **Step 4 : Lancer les tests.** Run : `cargo test -p arkyo-server --test http_web` → PASS.
- [ ] **Step 5 : Commit**

```bash
git add -A && git commit -m "feat: front embarqué, fallback SPA et /uploads"
```

---

### Task 6 : SPA Vite, design system et shims Next.js

**Files :**
- Create : `web/{package.json,vite.config.ts,tsconfig.json,index.html,vitest.config.ts}`, `web/src/main.tsx`, `web/src/shims/next/{navigation.ts,link.tsx,image.tsx,headers.ts}`, `web/src/shims/next-auth-react.tsx`, `web/src/shims/next-intl.tsx`, `web/src/fonts.css`
- Copy verbatim : `arkyo:app/globals.css` → `web/src/app/globals.css`, `arkyo:public/**` → `web/public/` (sauf `next.svg`, `vercel.svg`), `arkyo:messages/*.json` → `web/src/messages/`, `arkyo:components/ui/**` → `web/src/components/ui/`, `arkyo:components/layout/theme-provider.tsx`, `arkyo:components/system/theme-override.tsx`, `arkyo:lib/utils.ts`, `arkyo:lib/api-client.ts`, `arkyo:lib/form-errors.ts`, plus **la fermeture de leurs imports** `@/…` (copier tout fichier importé transitivement)
- Test : `web/src/shims/*.test.tsx`, et copie de `arkyo:lib/api-client.test.ts`, `arkyo:tests/unit/badge.test.tsx`, `arkyo:tests/unit/range-input.test.tsx`

**Interfaces :**
- Produces (alias Vite **et** `tsconfig` `paths`) : `@/*` → `web/src/*` ; `next/navigation` → shim (`useRouter()` avec `push`, `replace`, `back`, `refresh` (recharge les données de la route via un évènement `arkyo:refresh`), `prefetch` (no-op) ; `usePathname`, `useSearchParams`, `useParams`, `redirect(url)` (lève une erreur de navigation interceptée par le routeur), `notFound()`) ; `next/link` → `<Link href prefetch? replace? scroll?>` ; `next/image` → `<img>` avec les mêmes props utiles (`src`, `alt`, `width`, `height`, `className`, `fill` → `absolute inset-0 w-full h-full object-cover`) ; `next-auth/react` → `SessionProvider`, `useSession()` (`{data, status}` lu sur `/api/auth/session`), `signOut({callbackUrl})` (POST `/api/auth/logout` puis redirection) ; `next-intl` → `NextIntlClientProvider`, `useTranslations(ns?)`, `useLocale()` avec les messages du fichier de la locale de l'utilisateur.
- Polices : `@fontsource-variable/dm-sans`, `@fontsource/ibm-plex-mono` (300, 400, 500, 600), `@fontsource/instrument-serif` (400 italique), exposées en `--font-sans`, `--font-mono`, `--font-serif` comme dans `arkyo:app/layout.tsx`.
- Proxy de dev Vite : `/api` et `/uploads` → `http://localhost:8090`.

- [ ] **Step 1 : Écrire les tests des shims**

```tsx
test("useRouter().push change l'URL et usePathname suit", …)
test("useParams expose les paramètres de route", /* route /project/:id → { id: "abc" } */ …)
test("useSearchParams lit la query", …)
test("useSession renvoie unauthenticated quand /api/auth/session répond null", …)
test("useTranslations('ns') lit messages/fr.json et retombe sur la clé si absente", …)
```

- [ ] **Step 2 : Lancer les tests.** Run : `cd web && npm test` → FAIL.
- [ ] **Step 3 : Implémenter** les shims sur `react-router` 7 (mode bibliothèque, `createBrowserRouter`), la config Vite (`@vitejs/plugin-react`, `@tailwindcss/vite`) et copier les fichiers listés. Copiez la fermeture des imports jusqu'à ce que `npx tsc --noEmit` ne signale plus de module manquant.
- [ ] **Step 4 : Lancer les tests, le typage et le build.** Run : `cd web && npm test && npx tsc --noEmit && npm run build` → tout PASS, `web/dist/index.html` existe.
- [ ] **Step 5 : Commit**

```bash
git add -A && git commit -m "feat: SPA Vite, design system arkyo et shims Next.js"
```

---

### Task 7 : Coquille de l'application, connexion et premier lancement

**Files :**
- Create : `web/src/router.tsx`, `web/src/app/(app)/app-layout.tsx`, `web/src/app/auth/auth-page.tsx`, `web/src/app/auth/setup-page.tsx`, `web/src/app/auth/password-page.tsx`, `web/src/components/coming-soon.tsx`, `web/src/app/root.tsx`
- Copy verbatim, puis retirer le SaaS : `arkyo:components/layout/{sidebar,topbar}.tsx`, `arkyo:components/app-sync.tsx`, `arkyo:components/notifications-panel.tsx`, `arkyo:components/locale-selector.tsx`, `arkyo:components/presence/**`, `arkyo:lib/{view-context,topbar-tabs-context,tenant-membership-context,tenant-plan-context,ghost-mode-context,app-events-client,unsaved-changes}.tsx|ts`, `arkyo:components/tenant-permissions-context.tsx`, `arkyo:lib/permissions/**`, `arkyo:app/(app)/admin/_components/admin-tab-layout.tsx`
- Test : `web/src/app/auth/*.test.tsx`, `web/src/router.test.tsx`

**Interfaces :**
- Consumes : routes de la Task 4, shims de la Task 6.
- Produces :
  - `router.tsx` : l'arbre des URL d'arkyo. Layout `(app)` (sidebar et topbar) pour `/dashboard`, `/projects/*`, `/racks/*`, `/rigs/*`, `/panels`, `/templates`, `/admin/*`, `/settings`, `/profile`. Layout `(fullscreen)` (sans chrome) pour `/project/:id/*` et `/panels/:id`. Routes `/auth`, `/auth/setup`, `/auth/password`. `/` redirige vers `/dashboard`. Chaque URL dont la page n'est pas encore portée rend `<ComingSoon />`. Les phases suivantes remplacent ces éléments un par un.
  - `<ComingSoon />` = `EmptyState` d'arkyo, titre « Bientôt disponible », sans action.
  - `AppLayout` reproduit `arkyo:app/(app)/layout.tsx` côté client : garde de session (sinon `/auth`), garde `mustChangePassword` (sinon `/auth/password`), `TenantPlanProvider plan="ENTERPRISE"`, `TenantMembershipProvider tenantSlug="local" tenantName={site.name} role={session.user.role}`, `TenantPermissionsProvider` alimenté par `/api/tenant/me/permissions`, `GhostModeProvider isGhost={false}`, puis le même arbre `PresenceProvider > ViewProvider > TopbarTabsProvider > Topbar + Sidebar + main + AppSync`. Sont retirés : `ImpersonationBanner`, `BugReportWidget`, `DevModeBanner`, l'écran « Espace suspendu ».
  - Sidebar : l'entrée **Support** est retirée. Une entrée **Système** (`/admin/systeme`, icône `lucide-react` `Server`) est ajoutée au groupe admin, visible avec `settings:admin`.
  - `auth-page.tsx` : reprend le cadre visuel de `arkyo:app/platform/auth/page.tsx` (fond, monogramme, carte, typographie, boutons, messages d'erreur) avec une seule étape « connexion » : champ identifiant (email ou nom d'utilisateur) et champ mot de passe, au lieu des étapes `email` et `code`. Si `GET /api/auth/state` renvoie `needsSetup`, il redirige vers `/auth/setup`.
  - `setup-page.tsx` : même cadre. Champs nom, email, nom d'utilisateur (optionnel, `UsernameField` d'arkyo), mot de passe et confirmation. Si `local` est faux, il n'affiche pas le formulaire mais le message « Créez le premier compte depuis le serveur : ouvrez http://localhost:8090 sur la machine, ou lancez `arkyo-server user add`. »
  - `password-page.tsx` : même cadre. Champs mot de passe actuel, nouveau et confirmation.
  - Titre d'onglet : `arkyo.io`, ou `arkyo.io | <page>` via un hook `usePageTitle(title)`.

- [ ] **Step 1 : Écrire les tests** (fetch simulé)

```tsx
test("sans utilisateur, /auth redirige vers /auth/setup", …)
test("setup à distance affiche la consigne au lieu du formulaire", …)
test("connexion réussie mène à /dashboard ; erreur 401 affiche « Identifiant ou mot de passe incorrect »", …)
test("mustChangePassword renvoie vers /auth/password", …)
test("une URL non portée affiche « Bientôt disponible » dans la coquille", …)
test("la sidebar n'affiche pas Support et montre Système seulement avec settings:admin", …)
```

- [ ] **Step 2 : Lancer les tests.** Run : `cd web && npm test` → FAIL.
- [ ] **Step 3 : Implémenter** le routeur, les layouts et les trois pages. Copier les fichiers listés et retirer le SaaS en commentant chaque retrait.
- [ ] **Step 4 : Lancer les tests et le build.** Run : `cd web && npm test && npx tsc --noEmit && npm run build` → PASS.
- [ ] **Step 5 : Vérifier la parité visuelle dans le navigateur.** Lancer arkyo de référence (`.ref/arkyo` : `docker compose up -d`, `npm i`, migrations, seed, `npm run dev`) et `arkyo-server` (`cargo run -p arkyo-server`). Comparer côte à côte, en clair et en sombre : la page de connexion (cadre), la topbar, la sidebar, le panneau de notifications, le sélecteur de langue. Les seules différences admises sont celles listées ci-dessus. Faire des captures avant/après.
- [ ] **Step 6 : Commit**

```bash
git add -A && git commit -m "feat: coquille arkyo, connexion et premier lancement"
```

---

### Task 8 : Écran Système et mise à jour intégrée

**Files :**
- Create : `crates/arkyo-server/src/update.rs`, `src/http/system.rs`, `web/src/app/(app)/admin/systeme/systeme-page.tsx`
- Modify : `src/main.rs` (garde de démarrage, contrôle automatique), `web/src/router.tsx`
- Test : `crates/arkyo-server/src/update.rs` (module `tests`), `tests/http_system.rs`, `web/src/app/(app)/admin/systeme/systeme-page.test.tsx`

**Interfaces :**
- Produces :
  - `update.rs` : port de `cg:crates/cg-server/src/update.rs` avec `DEFAULT_REPO = "DamienP2/arkyo-server"`, préfixe d'archive `Arkyo-`, binaire `arkyo-server`, sans `add_ffmpeg`. Mêmes fonctions publiques : `current_version`, `info`, `check`, `install_release`, `extract_binary`, `is_newer`, `install`, `rollback`, `restart_soon`, `startup_guard`, `confirm_after`, `spawn_auto_check`, `Settings::{load,save}`.
  - Routes (admin = `settings:admin`) : `GET /api/system` → `{version, dataDir, urls: ["http://<ip>:<port>", …]}` (IP via `if-addrs`, comme CG) ; `GET /api/system/update`, `PUT /api/system/update/settings`, `POST /api/system/update/check`, `POST /api/system/update/install`, `POST /api/system/update/upload` (corps binaire, 512 Mo max), `POST /api/system/update/rollback`, mêmes contrats que les routes du même nom dans `cg:crates/cg-server/src/api.rs`.
  - Page `/admin/systeme` dans `AdminTabLayout`, avec les patterns d'arkyo (`InfoCard`, `ActionButton`, `ConfirmDialog`, `LoadingState`) : version et adresses d'accès (copier l'adresse) ; Mises à jour (vérification automatique on/off, « Rechercher », version disponible avec ses notes, « Installer », « Importer un paquet », « Revenir à la version précédente »).

- [ ] **Step 1 : Écrire les tests**

```rust
#[test] fn is_newer_semver() { assert!(is_newer("0.2.0","0.1.9")); assert!(!is_newer("0.1.0","0.1.0")); assert!(!is_newer("0.1.0-dev","0.1.0")); }
#[test] fn extract_binary_from_update_tarball() { /* tar.gz construit en test contenant Arkyo-0.2.0-linux-x86_64/arkyo-server → octets du binaire */ }
#[test] fn asset_name_per_platform() { /* "Arkyo-0.2.0-macos-arm64.tar.gz", "Arkyo-0.2.0-windows-x86_64.zip" … */ }
#[tokio::test] async fn system_routes_require_settings_admin() { /* technicien → 403 ; owner → 200 */ }
```
```tsx
test("affiche la version et les adresses, et demande confirmation avant Installer", …)
```

- [ ] **Step 2 : Lancer les tests.** Run : `cargo test -p arkyo-server && (cd web && npm test)` → FAIL.
- [ ] **Step 3 : Implémenter** le port de `update.rs`, `http/system.rs` et la page.
- [ ] **Step 4 : Lancer les tests.** Run : `cargo test --workspace && (cd web && npm test)` → PASS.
- [ ] **Step 5 : Commit**

```bash
git add -A && git commit -m "feat: écran Système et mise à jour intégrée"
```

---

### Task 9 : Service natif

**Files :**
- Create : `crates/arkyo-server/src/service.rs`
- Modify : `src/main.rs` (sous-commande `service install|uninstall|start|stop|status`)
- Test : `crates/arkyo-server/src/service.rs` (module `tests`)

**Interfaces :**
- Produces : port de `cg:crates/cg-server/src/service.rs` (systemd, launchd `com.arkyo.server`, service Windows `arkyo-server` via `windows-service`), le service s'exécutant sur `paths::system_data_dir()`. Fonction pure testable `service::unit_file(exe: &Path, data_dir: &Path) -> String` (systemd) et `service::launchd_plist(exe, data_dir) -> String`.

- [ ] **Step 1 : Écrire les tests**

```rust
#[test] fn systemd_unit_points_to_exe_and_system_dir() { /* contient "ExecStart=/opt/arkyo/arkyo-server run --data-dir /var/lib/arkyo" et "Restart=on-failure" */ }
#[test] fn launchd_plist_label() { /* contient "<string>com.arkyo.server</string>" */ }
```

- [ ] **Step 2 : Lancer les tests.** Run : `cargo test -p arkyo-server service` → FAIL.
- [ ] **Step 3 : Implémenter** le port.
- [ ] **Step 4 : Lancer les tests.** Run : `cargo test -p arkyo-server service` → PASS. Puis, sur macOS : `sudo target/debug/arkyo-server service install && arkyo-server service status` → « running », et `curl localhost:8090/healthz` → `ok`. Désinstaller ensuite.
- [ ] **Step 5 : Commit**

```bash
git add -A && git commit -m "feat: service natif systemd, launchd et Windows"
```

---

### Task 10 : App tray et icônes

**Files :**
- Create : `crates/arkyo-tray/{Cargo.toml,build.rs,src/main.rs,src/app.rs}`, `assets/icons/{arkyo.ico,arkyo.icns,tray-template-44.rgba,tray-color-64.rgba}`, `scripts/make-icons.sh`
- Test : `crates/arkyo-tray/src/app.rs` (module `tests`)

**Interfaces :**
- Produces : binaire `arkyo-tray`, port de `cg:crates/cg-tray` avec `DEFAULT_PORT = 8090`, libellés « Arkyo » (ouvrir l'interface, démarrer/arrêter le service, état, quitter). L'app interroge `GET /healthz` pour l'état. `scripts/make-icons.sh` génère les quatre icônes à partir de `web/public/favicon.svg` (`rsvg-convert`, `iconutil`, conversion RGBA brute comme les fichiers `cg:assets/icons/*.rgba`).

- [ ] **Step 1 : Écrire le test** `fn ui_url_uses_configured_port()` : avec un `config.json` `{ "port": 9001 }` → `http://localhost:9001`, sans fichier → `http://localhost:8090`.
- [ ] **Step 2 : Lancer le test.** Run : `cargo test -p arkyo-tray` → FAIL.
- [ ] **Step 3 : Implémenter** le port et générer les icônes.
- [ ] **Step 4 : Lancer les tests et l'app.** Run : `cargo test -p arkyo-tray` → PASS. `cargo run -p arkyo-tray` affiche l'icône dans la barre des menus, et « Ouvrir Arkyo » ouvre le navigateur sur l'interface.
- [ ] **Step 5 : Commit**

```bash
git add -A && git commit -m "feat: app tray et icônes Arkyo"
```

---

### Task 11 : Packaging et workflows CI / Release

**Files :**
- Create : `packaging/stamp-version.sh`, `packaging/linux/{install.sh,uninstall.sh}`, `packaging/macos/pkg/{build.sh,make-dmg.sh,Distribution.xml,scripts/preinstall,scripts/postinstall,app/Info.plist,com.arkyo.tray.plist,uninstaller/*}`, `packaging/windows/msi/arkyo.wxs`, `.github/workflows/{ci.yml,release.yml}`
- Test : les workflows eux-mêmes (exécution sur une branche et sur un tag de test)

**Interfaces :**
- Produces : port de `cg:packaging/**` et `cg:.github/workflows/**`, **sans** ffmpeg, NDI, DeckLink, Premiere ni `integrations/`. `stamp-version.sh` met à jour `Cargo.toml`, les crates `arkyo-*` dans `Cargo.lock` et `web/package.json`. Le `.msi` installe `arkyo-server.exe` et `arkyo-tray.exe`, déclare le service et ouvre le port 8090 dans le pare-feu (`WixToolset.Firewall`). Le `.pkg` installe le serveur dans `/usr/local/arkyo/`, le service launchd et `Arkyo.app` (tray). Le `.tar.gz` Ubuntu contient `arkyo-server`, `install.sh`, `uninstall.sh` et `INSTALL.md`. Signature et notarisation macOS conditionnées aux mêmes secrets que CG (`MACOS_CERTS_P12`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`, `MACOS_INSTALLER_IDENTITY`).
- `ci.yml` : job `engine` (clippy `-D warnings` + `cargo test --workspace`, matrice ubuntu/macos/windows) et job `web` (`npm ci`, `npm test`, `npx tsc --noEmit`, `npm run build`). Le job `engine` télécharge l'artefact `web-dist` pour que les tests de `http_web` s'exécutent sur un vrai front.

- [ ] **Step 1 : Écrire les scripts et workflows** par port de CG.
- [ ] **Step 2 : Vérifier localement.** Run : `bash -n packaging/**/*.sh` → aucune erreur. `GITHUB_REF_TYPE=tag GITHUB_REF_NAME=v0.1 bash packaging/stamp-version.sh && grep -m1 '^version' Cargo.toml` → `version = "0.1.0"` (puis `git checkout Cargo.toml Cargo.lock web/package.json`).
- [ ] **Step 3 : Vérifier en CI.** Pousser la branche : `CI` passe au vert sur les trois OS. Lancer `Release` en `workflow_dispatch` (sans tag) : les artefacts `Arkyo-dev-<sha>-*` sont produits pour les trois plateformes.
- [ ] **Step 4 : Installer les artefacts.** Installer le `.pkg` sur macOS et vérifier `http://localhost:8090` → page de création du premier compte, puis connexion. Si une machine Windows ou Ubuntu est disponible, même vérification avec le `.msi` et le `.tar.gz` ; sinon, le noter dans le rapport.
- [ ] **Step 5 : Commit**

```bash
git add -A && git commit -m "build: packaging macOS/Windows/Ubuntu et workflows CI/Release"
```

---

### Task 12 : Documentation du repo

**Files :**
- Create : `README.md`, `docs/INSTALL.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md`
- Copy : `arkyo:UI_PATTERNS.md` → `UI_PATTERNS.md`

**Interfaces :**
- Produces :
  - `README.md` : présentation (reprise de celle d'arkyo, sans SaaS), installation par plateforme, premier lancement, commandes CLI.
  - `INSTALL.md` : structuré comme `cg:docs/INSTALL.md` (paquets, dossiers de données, pare-feu, mises à jour en ligne et hors ligne, désinstallation).
  - `ARCHITECTURE.md` : crates, contrat d'API, shims, base et migrations par phase.
  - `CLAUDE.md` : règles de travail pour les phases suivantes (Global Constraints ci-dessus, règle « copier verbatim puis retirer le SaaS en le commentant », règles UI non négociables d'arkyo, commandes de test et de build).

- [ ] **Step 1 : Rédiger les documents.**
- [ ] **Step 2 : Vérifier les commandes citées.** Chaque commande de `INSTALL.md` et de `CLAUDE.md` est exécutée une fois et fonctionne telle qu'écrite.
- [ ] **Step 3 : Commit**

```bash
git add -A && git commit -m "docs: README, installation, architecture et règles du repo"
```

---

## Fin de phase

- `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `cd web && npm test && npx tsc --noEmit && npm run build` passent.
- La CI est verte. Un `workflow_dispatch` de Release produit les paquets des trois plateformes.
- Parité vérifiée (Task 7, Step 5) et captures jointes au rapport.
- La release `v0.1.0` (pousser le tag) se fait **uniquement sur accord de Damien**.
