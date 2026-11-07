# Sauvegardes, import et export : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** points de restauration de projet, export/import d'objets `.arkyo` (projet, contenant, régie, panel) et sauvegarde complète du site, pilotés depuis Administration › Système.

**Architecture:** module serveur neuf `crates/arkyo-server/src/transfer/` (graphe des tables, archive zip, import, points, site), routes `/api/system/backups/*` et `/api/system/transfer/*` dans `http/backups.rs`, section « Sauvegardes » de la page Système (code neuf sous `web/src/app/(app)/admin/systeme/backups/`). Les lignes voyagent brutes (noms de tables et colonnes de la base), l'import n'écrit que les colonnes qui existent localement.

**Tech Stack:** Rust (axum, sqlx SQLite, zip 9, sha2, tokio), React 19 + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-07-sauvegardes-design.md` (à lire en entier ; ce plan ne la répète pas).

## Global Constraints

- Garde serveur `settings:admin` sur toutes les routes (`require(&me, &st.pool, Domain::Settings, Level::Admin)`, comme `http/system.rs`). Erreurs `{ "error": "<message FR>" }`.
- Écritures en `db::begin_immediate` (un test interdit `.begin()`), lectures cohérentes : une seule connexion et une transaction de lecture (`BEGIN` différé) pour toute la collecte d'un export.
- Aucune migration de schéma nécessaire : les réglages vont dans `AppConfig` (clés `backups.projects` et `backups.site`, valeur JSON), les fichiers dans `<data>/backups/`.
- Ids `ids::new_id()`, dates `ids::now_iso()`. Pas de macros `sqlx::query!`.
- Aucun fichier copié d'arkyo n'est modifié. Code front neuf : composants partagés (`EmptyState`, `LoadingState`, `useConfirm`, `useToast`, `ActionButton`, `InfoCard`, `property-patterns`), couleurs d'interface en variables CSS, bouton d'ajout en pointillés s'il y en a un, textes FR sans hint inutile.
- Commits sur `main`, petits, en français, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Ne jamais pousser.
- Fin de chaque tâche : `cargo test -p arkyo-server`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --check` ; pour le front `cd web && npm test && npx tsc --noEmit`.

## Review Focus

1. **Gros projet** (plusieurs milliers de lignes, centaines de Mo d'uploads) : export et import en flux vers un fichier temporaire, jamais tout le zip en mémoire côté réponse HTTP ; test avec un projet de 5 000 connexions sous 5 s en debug.
2. **Fichier hostile ou abîmé** : zip invalide, `manifest` absent ou d'un autre format, chemin `../` ou absolu dans `uploads/`, taille décompressée démesurée (plafond 4 Gio) → 400 avec message FR, rien d'écrit.
3. **Fichier d'une autre version** : table inconnue ignorée avec avertissement dans le rapport, colonne inconnue ignorée, colonne manquante à sa valeur par défaut, colonne `NOT NULL` sans défaut absente → la ligne est refusée et l'import entier annulé avec un message nommant table et colonne.
4. **Édition concurrente pendant un point automatique** : la collecte se fait dans une transaction de lecture unique ; un point n'est jamais un mélange de deux états.
5. **Remplacer un projet ouvert dans un autre navigateur** : évènements temps réel `project` `updated` (et `rack` `updated` par contenant) publiés après commit pour que l'éditeur ouvert se recharge ; un projet supprimé puis restauré réapparaît dans la liste (`project` `created`).

---

### Task 1: Graphe des tables et collecte

**Files:**
- Create: `crates/arkyo-server/src/transfer/mod.rs`, `crates/arkyo-server/src/transfer/graph.rs`, `crates/arkyo-server/src/transfer/rows.rs`
- Modify: `crates/arkyo-server/src/lib.rs` (`pub mod transfer;`)
- Test: `crates/arkyo-server/tests/transfer_graph.rs`

**Interfaces:**
- Produces:
  - `pub enum RootKind { Project, Rack, Rig, Panel }` (serde `"project"|"rack"|"rig"|"panel"`), `pub struct Root { kind: RootKind, id: String, name: String }`.
  - `pub type Row = serde_json::Map<String, Value>;` valeurs brutes : TEXT → string, INTEGER → nombre entier, REAL → nombre, NULL → null.
  - `pub struct Bundle { pub roots: Vec<Root>, pub tables: BTreeMap<String, Vec<Row>>, pub uploads: BTreeSet<String> }` (`uploads` = chemins relatifs sous `uploads/`, sans le préfixe `/uploads/`, trouvés dans toute valeur texte commençant par `/uploads/`, y compris dans du JSON).
  - `pub async fn collect(conn: &mut SqliteConnection, roots: &[(RootKind, String)]) -> Result<Bundle, TransferError>` (racine inconnue → `TransferError::NotFound(kind, id)`).
  - `pub fn classification() -> &'static [(&'static str, Class)]` avec `enum Class { Owned, Catalogue, Dependency, System }` ; `pub fn owned_tables_in_insert_order() -> &'static [&'static str]` (parents avant enfants).
  - `rows.rs` : `pub async fn columns(conn, table) -> Result<Vec<ColumnInfo>>` (PRAGMA `table_info` : nom, `notnull`, `dflt_value`, `pk`), `pub async fn select_rows(conn, table, where_sql, binds) -> Result<Vec<Row>>`.
  - `pub enum TransferError` (thiserror ou à la main) avec `NotFound`, `Invalid(String)` (message FR), `Db(sqlx::Error)`, `Io(std::io::Error)`.

- [ ] **Step 1: Write the failing tests** dans `tests/transfer_graph.rs` (helpers de test existants pour ouvrir une base migrée et semer un projet ; s'inspirer de `tests/phase4c_smoke.rs`) :
  - `every_table_is_classified` : toutes les tables de `sqlite_master` (hors `_sqlx_migrations` et `sqlite_%`) apparaissent dans `classification()`, et aucune entrée de `classification()` n'est absente de la base.
  - `project_bundle_holds_its_graph` : projet semé avec un lieu, une régie, deux racks (un par régie, un par lieu), un slot équipé d'un équipement du catalogue, un panel référencé, une connexion de rack, une connexion projet, une zone, un label, un document avec `url = "/uploads/documents/a.pdf"` → `Bundle` contient chaque table du §3.1 de la spec avec le bon nombre de lignes, le panel en dépendance, l'équipement référencé, tous les référentiels, et `uploads == {"documents/a.pdf"}`.
  - `rack_bundle_excludes_project_rows`, `panel_bundle_is_panel_and_slots`, `rig_bundle_includes_its_racks`.
  - `unknown_root_is_not_found`.
- [ ] **Step 2: Run** `cargo test -p arkyo-server --test transfer_graph` → FAIL (module absent).
- [ ] **Step 3: Implement** `graph.rs` et `rows.rs` : périmètres exacts du §3.1–3.2 de la spec ; `AuditLog` du projet = même filtre que `http/audit_read.rs::project` (sans limite), celui d'un rack = `audit_read.rs::rack`. Les équipements référencés incluent ceux désignés par les `TenantEquipmentComponent` des équipements exportés (fermeture transitive). Classer `User`, `UserProfile`, `Role`, `AuthSession`, `Notification`, `AppConfig`, `CatalogSymbol`, `PrintSettings`, `TenantPrintTemplate`, `TenantCableLabelStock`, `TenantPrintExportModel`, `TenantPrintExportPage`, `ExportTemplate` en `System` (non exportés) ; `TenantCable`, `TenantAdapter`, `TenantEquipment`, `TenantEquipmentComponent` et les référentiels en `Catalogue` ; `Panel`, `PanelSlot` en `Dependency` (et racine possible).
- [ ] **Step 4: Run** les tests → PASS.
- [ ] **Step 5: Commit** `feat: graphe des tables et collecte d'un objet à transférer`.

### Task 2: Archive `.arkyo`

**Files:**
- Create: `crates/arkyo-server/src/transfer/archive.rs`
- Test: `crates/arkyo-server/tests/transfer_archive.rs`

**Interfaces:**
- Consumes: `Bundle`, `Root` (Task 1).
- Produces:
  - `pub struct Manifest { format: String /* "arkyo-server-transfer" */, version: u32 /* 1 */, app_version: String, created_at: String, created_by: Option<Author>, roots: Vec<Root>, counts: BTreeMap<String, usize> }` (JSON camelCase), `pub struct Author { id, name: Option<String>, email: Option<String> }`.
  - `pub fn write_archive(bundle: &Bundle, author: Option<Author>, uploads_dir: &Path, out: &Path) -> Result<Manifest, TransferError>` (un fichier référencé mais absent de `uploads_dir` est ignoré ; la valeur reste dans les lignes).
  - `pub fn read_archive(path: &Path) -> Result<(Manifest, Bundle), TransferError>` (ne lit pas les uploads en mémoire) ; `pub fn extract_uploads(path: &Path, uploads_dir: &Path) -> Result<usize, TransferError>` (copie uniquement les fichiers absents, renvoie le nombre copié).
  - `pub fn data_digest(bundle: &Bundle) -> String` : SHA-256 hex du `data.json` canonique (tables triées, lignes triées par `id`, puis par JSON), utilisé par les points automatiques.

- [ ] **Step 1: Write the failing tests** : `roundtrip_keeps_rows_and_uploads` ; `rejects_non_zip`, `rejects_missing_manifest`, `rejects_foreign_format` (`format` différent → `Invalid("Ce fichier n'est pas un export Strata Arkyo.")`), `rejects_newer_major_version` (`version: 2` → `Invalid("Ce fichier vient d'une version plus récente de Strata Arkyo.")`), `rejects_path_traversal` (`uploads/../../x` et chemin absolu → `Invalid("Archive invalide.")`), `rejects_oversized` (somme des tailles déclarées > 4 Gio → `Invalid("Archive trop volumineuse.")`), `extract_never_overwrites`, `digest_is_order_independent`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** avec la crate `zip` (déjà en dépendance, deflate). `data.json` écrit en flux (`serde_json::to_writer`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: archive .arkyo (manifeste, données, fichiers envoyés)`.

### Task 3: Import, export et routes de transfert

**Files:**
- Create: `crates/arkyo-server/src/transfer/import.rs`, `crates/arkyo-server/src/http/backups.rs`
- Modify: `crates/arkyo-server/src/http/mod.rs` (routes), `crates/arkyo-server/src/transfer/mod.rs`
- Test: `crates/arkyo-server/tests/transfer_import.rs`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `pub enum Mode { Insert, Replace, Copy }` (serde `"insert"|"replace"|"copy"`).
  - `pub struct Preview { manifest: Manifest, roots: Vec<RootPreview> }`, `RootPreview { kind, id, name, exists: bool, counts: BTreeMap<String,usize> }`.
  - `pub async fn preview(pool, bundle, manifest) -> Result<Preview>`.
  - `pub struct ImportOptions { modes: HashMap<String /* root id */, Mode> }` (racine absente ici → `Insert` forcé ; présente sans mode → `Invalid("Choisissez Remplacer ou Copie pour « <nom> ».")`).
  - `pub struct Report { roots: Vec<RootReport>, catalogue_added: BTreeMap<String,usize>, uploads_copied: usize, warnings: Vec<String> }`, `RootReport { kind, id /* id final */, name /* nom final */, mode, inserted: BTreeMap<String,usize> }`.
  - `pub async fn import(st: &AppState, user: &User, archive: &Path, opts: ImportOptions) -> Result<Report, TransferError>` (`Replace` d'un projet appelle d'abord `points::snapshot_before_restore(st, project_id, user) -> Result<()>`, créée dans cette tâche sous forme minimale : elle écrit l'archive du projet courant dans `<data>/backups/projects/<id>/<horodatage>-avant-restauration.arkyo` ; Task 4 la branche sur l'index des points).
  - `pub async fn export_to_file(st: &AppState, user: &User, roots: &[(RootKind,String)], out: &Path) -> Result<Manifest>`.
- Routes (`http/backups.rs`, garde `settings:admin`) :
  - `POST /api/system/transfer/export` corps `{ "roots": [{ "kind", "id" }] }` → fichier `application/zip`, `Content-Disposition: attachment; filename="<nom ou Arkyo-export>-<AAAAMMJJ-HHMM>.arkyo"` (nom ASCII sûr), servi en flux depuis un fichier temporaire ;
  - `GET /api/system/transfer/objects` → `{ projects: [{id,name,updatedAt}], racks: [...bibliothèque, même filtre que http/racks.rs ligne 134 (racks hors projet)], rigs: [...modèles, isTemplate=1 et projectId NULL], panels: [...] }` ;
  - `POST /api/system/transfer/inspect` (corps brut = fichier, limite 2 Gio, écrit en flux dans `<data>/tmp/<id>.arkyo`) → `{ token, preview }` ; le fichier temporaire est supprimé après import ou au bout d'1 h ;
  - `POST /api/system/transfer/import` `{ token, modes: { "<rootId>": "replace"|"copy" } }` → `Report`.

- [ ] **Step 1: Write the failing tests** :
  - `export_delete_import_restores_identical_rows` : collecte → archive → suppression du projet (route existante) → import → nouvelle collecte égale à l'ancienne (hors `AuditLog` ajouté par l'import).
  - `copy_mode_renews_every_owned_id` : import en `Copy` d'un projet existant → aucun id possédé commun avec l'original, ids présents dans les JSON (`constructionChecks`, `numberingOverride`, colonnes JSON de connexion) remplacés aussi, nom `"<nom> (copie)"`, panels et catalogue partagés (pas dupliqués).
  - `replace_mode_restores_and_keeps_a_point` : modifier le projet après export, importer en `Replace` → état du fichier, et un fichier existe sous `backups/projects/<id>/`.
  - `catalogue_rows_are_insert_only` : équipement présent ici avec un autre nom → nom local inchangé ; équipement absent → inséré et compté.
  - `unknown_column_and_table_are_ignored_with_warning`, `missing_not_null_column_rolls_back` (message `La colonne « <col> » de « <table> » manque dans le fichier.`), `missing_column_takes_default`.
  - `unknown_author_becomes_importer`, `taken_cable_id_is_reassigned`.
  - `import_is_atomic` (erreur au milieu → aucune ligne ajoutée).
  - `routes_require_settings_admin` (403 avec un rôle sans `settings:admin`), `inspect_rejects_garbage_with_400`.
  - `large_project_exports_quickly` (5 000 `RackConnection`, export+import < 5 s, `#[ignore]` si trop lent en CI Windows : non, garder actif).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Ordre d'insertion = `owned_tables_in_insert_order()` puis dépendances avant possédées (référentiels → catalogue → panels → possédées). `Replace` : supprimer les lignes du graphe courant (collecté dans la même transaction) en ordre inverse, puis insérer. `Copy` : table `ancien id → new_id()` pour chaque ligne possédée, puis remplacement textuel de chaque ancien id dans toutes les valeurs texte des lignes possédées (implémentation efficace : un seul passage par valeur avec recherche des cuid via motif `c[a-z0-9]{24}` et lookup dans la table). Audit : `audit::log(conn, user, "IMPORT", "<Project|Rack|RigConfig|Panel>", id, project_id, None, Some(json!({"mode": …, "file": manifest.created_at})))`. Évènements après commit : `st.events.publish("project", "created"|"updated", Some(id))` etc. Uploads extraits après commit.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: export et import d'objets .arkyo (insertion, remplacement, copie)`.

### Task 4: Points de restauration de projet

**Files:**
- Create: `crates/arkyo-server/src/transfer/points.rs`
- Modify: `crates/arkyo-server/src/http/backups.rs`, `crates/arkyo-server/src/main.rs` (lancer la tâche de fond dans `serve`)
- Test: `crates/arkyo-server/tests/transfer_points.rs`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `pub enum PointKind { Auto, Manual, BeforeRestore }` (fichiers `-auto`, `-manuel`, `-avant-restauration`), `pub struct Point { id /* nom de fichier sans extension */, project_id, project_name, kind, label: Option<String>, created_at, author: Option<Author>, digest, size }`.
  - `pub struct ProjectSettings { enabled: bool /* true */, interval_hours: u32 /* 1 ; 1|6|24 */, keep: u32 /* 48 */ }` lu/écrit dans `AppConfig` clé `backups.projects`.
  - `pub async fn create_point(st, project_id, kind, label, author) -> Result<Option<Point>>` (`Auto` : `None` si l'empreinte égale celle du dernier point du projet).
  - `pub fn list_projects(data_dir) / list_points(data_dir, project_id)` (index `points.json` par projet, reconstruit depuis les fichiers s'il est absent ou abîmé).
  - `pub async fn run_auto_pass(st) -> usize` (tous les projets, puis rétention) ; `pub fn spawn_scheduler(st: AppState)` (tokio, relit le réglage à chaque tour, premier passage 5 min après le démarrage).
  - Remplace le bouchon `snapshot_before_restore` de Task 3.
- Routes : `GET /api/system/backups/projects` (projets ayant des points + projets existants sans point : `{ id, name, deleted: bool, lastPoint, count }`), `GET /api/system/backups/projects/{id}/points`, `POST /api/system/backups/projects/{id}/points` `{ label? }` → `Point`, `POST …/points/{pointId}/restore` → `Report` (mode `Replace`, ou `Insert` si le projet n'existe plus), `GET …/points/{pointId}/download`, `DELETE …/points/{pointId}`, `GET|PUT /api/system/backups/settings/projects`. `pointId` validé (`^[0-9A-Za-z-]+$`), 404 « Point de restauration introuvable ».

- [ ] **Step 1: Write the failing tests** : `auto_point_skips_unchanged_project`, `auto_point_after_change`, `retention_keeps_last_n_auto_and_all_manual`, `restore_point_of_deleted_project_recreates_it`, `restore_point_creates_before_restore_point`, `index_is_rebuilt_from_files`, `settings_roundtrip_and_validation` (intervalle hors {1,6,24} → 400 « Paramètres invalides »), `point_id_traversal_is_404`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Écriture atomique : fichier temporaire puis `rename`. Un verrou (`tokio::sync::Mutex` par projet ou global) empêche deux points simultanés du même projet.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: points de restauration de projet automatiques et manuels`.

### Task 5: Sauvegarde complète du site et CLI

**Files:**
- Create: `crates/arkyo-server/src/transfer/site.rs`
- Modify: `crates/arkyo-server/src/http/backups.rs`, `crates/arkyo-server/src/main.rs` (sous-commandes `backup` et `restore`, application d'une restauration en attente au début de `serve` avant `db::open`, tâche de fond quotidienne), `crates/arkyo-server/Cargo.toml` si une crate d'heure locale est nécessaire (`chrono` avec `clock`, choix du builder)
- Test: `crates/arkyo-server/tests/transfer_site.rs`

**Interfaces:**
- Produces:
  - `pub struct SiteSettings { enabled: bool /* true */, hour: u32 /* 3, heure locale */, dir: Option<String> /* None = <data>/backups/site */, keep: u32 /* 7 */ }` (`AppConfig` `backups.site`).
  - `pub async fn create_site_backup(pool, data_dir, out_dir) -> Result<SiteBackup>` : `VACUUM INTO` vers un temporaire, zip `manifest.json` (`format: "arkyo-server-site"`, `version: 1`, `appVersion`, `createdAt`, `migration`: plus grand `version` de `_sqlx_migrations`), `arkyo.db`, `config.json`, `uploads/**`, `backups/projects/**` ; nom `Arkyo-site-AAAAMMJJ-HHMMSS.zip` ; écriture en `.part` puis `rename`.
  - `pub fn verify_site_archive(path) -> Result<SiteManifest>` (format, présence et ouverture SQLite de `arkyo.db` en lecture seule depuis un fichier extrait temporaire, chemins sûrs).
  - `pub fn stage_restore(data_dir, archive) -> Result<()>` (copie vers `<data>/restore-pending.zip` après vérification) ; `pub fn apply_pending_restore(data_dir) -> Result<bool>` (déplace `arkyo.db*`, `config.json`, `uploads/`, `backups/projects/` vers `<data>/before-restore-<horodatage>/`, déplie l'archive, supprime `restore-pending.zip` ; échec → remet les données d'origine et renomme l'archive en `restore-failed-<horodatage>.zip`).
  - CLI : `arkyo-server backup [--data-dir] [--out <dossier>]` (affiche le chemin produit), `arkyo-server restore <fichier> [--data-dir]` (vérifie, met en attente, affiche « Restauration prête : elle sera appliquée au prochain démarrage du service. »).
- Routes : `GET /api/system/backups/site` (`{ settings, backups: [{ name, size, createdAt }] , dir }`), `POST /api/system/backups/site` → crée, `GET /api/system/backups/site/{name}/download`, `DELETE /api/system/backups/site/{name}`, `PUT /api/system/backups/settings/site` (dossier : chemin absolu existant et inscriptible, sinon 400 « Dossier inaccessible »), `POST /api/system/backups/site/restore` (corps brut en flux, limite 8 Gio) → vérifie, met en attente, `update::restart_soon()`, répond `{ "restarting": true }`.

- [ ] **Step 1: Write the failing tests** : `site_backup_contains_db_uploads_config_points`, `site_backup_db_is_consistent_while_writing` (écritures concurrentes pendant la sauvegarde, la base extraite passe `PRAGMA integrity_check`), `verify_rejects_project_archive_and_garbage`, `apply_pending_restore_swaps_data_and_keeps_old`, `apply_pending_restore_failure_rolls_back`, `retention_keeps_last_n`, `settings_dir_must_exist`, `cli_backup_writes_archive` (via `assert_cmd` si déjà en dev‑dépendance, sinon appel de la fonction).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** La tâche quotidienne vérifie chaque minute si l'heure locale réglée est passée et qu'aucune sauvegarde n'existe pour la date du jour.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: sauvegarde complète du site, restauration au démarrage et CLI`.

### Task 6: Écran « Sauvegardes » — points de restauration

**Files:**
- Create: `web/src/app/(app)/admin/systeme/backups/backups-section.tsx`, `.../backups/restore-points.tsx`, `.../backups/api.ts`, tests `.../backups/restore-points.test.tsx`
- Modify: `web/src/app/(app)/admin/systeme/systeme-page.tsx` (insérer `<BackupsSection />` après le bloc des mises à jour)

**Interfaces:**
- Consumes: routes de Task 4.
- Produces: `BackupsSection` (trois blocs, Tasks 6–8 en remplissent un chacun ; Task 6 pose le conteneur et le bloc 1), `api.ts` : fonctions typées pour toutes les routes `/api/system/backups/*` et `/api/system/transfer/*` (via `api` de `@/lib/api-client`, téléchargements via `fetch` + `Blob` + lien temporaire, envois de fichier en corps brut).

- [ ] **Step 1: Write the failing tests** (Vitest + happy-dom, mocks de `api`) : liste des projets avec dernier point ; projet supprimé marqué « Supprimé » ; ouverture d'un projet → ses points (date, type « Automatique » / « Manuel » / « Avant restauration », auteur, taille) ; « Créer un point » → POST puis rafraîchissement ; « Restaurer » → confirmation (« Le projet sera remplacé par l'état du <date>. Un point de l'état actuel est créé avant. ») → POST → toast de succès ; « Supprimer » → confirmation → DELETE ; aucun projet → `EmptyState` ; chargement → `LoadingState` ; réglages (activé, intervalle 1 h / 6 h / 24 h, nombre gardé) → PUT.
- [ ] **Step 2: Run** `cd web && npx vitest run src/app/\(app\)/admin/systeme/backups` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS, `npx tsc --noEmit` OK.
- [ ] **Step 5: Commit** `feat: écran des points de restauration (Système › Sauvegardes)`.

### Task 7: Écran « Sauvegardes » — exporter / importer

**Files:**
- Create: `web/src/app/(app)/admin/systeme/backups/transfer.tsx`, `.../backups/transfer.test.tsx`
- Modify: `.../backups/backups-section.tsx`

- [ ] **Step 1: Write the failing tests** : onglets Projets / Contenants / Régies / Panels listant `GET /transfer/objects` ; cases à cocher, « Exporter (n) » désactivé à 0 → POST export et téléchargement ; « Importer un fichier » → inspect → aperçu (racine, type, comptes résumés, « Existe déjà ici » avec choix Remplacer / Copie, défaut Copie) → « Importer » → rapport (racines et mode, éléments de catalogue ajoutés, fichiers copiés, avertissements) ; fichier refusé → message d'erreur du serveur en toast.
- [ ] **Step 2–4:** FAIL → implémenter → PASS + `tsc`.
- [ ] **Step 5: Commit** `feat: écran d'export et d'import d'objets .arkyo`.

### Task 8: Écran « Sauvegardes » — site, documentation

**Files:**
- Create: `web/src/app/(app)/admin/systeme/backups/site-backups.tsx`, `.../backups/site-backups.test.tsx`
- Modify: `.../backups/backups-section.tsx`, `docs/INSTALL.md` (section « Sauvegarder et restaurer »), `docs/ARCHITECTURE.md` (module `transfer`, dossier `backups/`, `restore-pending.zip`), `docs/superpowers/specs/2026-11-07-interface-strata-design.md` (table « Où vit chaque fonction » : Sauvegardes → Système, les deux interfaces), `CLAUDE.md` (« État actuel » : sauvegardes livrées).

- [ ] **Step 1: Write the failing tests** : dernière sauvegarde et liste (nom, date, taille, Télécharger, Supprimer) ; « Sauvegarder maintenant » ; réglages (activé, heure, dossier, nombre gardé) avec erreur « Dossier inaccessible » affichée ; « Restaurer une sauvegarde du site » → choix du fichier → confirmation explicite (« Toutes les données actuelles seront remplacées. Elles sont mises de côté dans le dossier de données. Le serveur redémarre. ») → envoi → écran d'attente puis rechargement quand `/api/system` répond à nouveau (même mécanique que l'installation d'une mise à jour dans `systeme-page.tsx`).
- [ ] **Step 2–4:** FAIL → implémenter → PASS + `tsc` + `npm run build`.
- [ ] **Step 5: Commit** `feat: écran de sauvegarde du site` puis `docs: sauvegardes, import et export`.
