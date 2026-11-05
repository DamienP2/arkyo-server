# Phase 2 — Catalogue et administration : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Rendre fonctionnelles, à l'identique d'arkyo (ergonomie) et avec l'habillage Strata, l'administration du catalogue (équipements, cordons, adaptateurs, éditeurs), les Paramètres (classification, fabricants, connecteurs, signaux, câblage, dimensions, impression hors éditeur visuel, numérotation, import/export, sauvegarde), les utilisateurs et rôles, l'espace (informations du site) et le profil.

**Architecture :** Un catalogue local unique, stocké dans des tables reprenant les modèles `Tenant*` d'arkyo, enrichies des colonnes qui n'existaient que dans les modèles `Catalog*`. L'API Rust reprend les chemins et les formes JSON des routes `arkyo:app/api/tenant/**`. Les listes répondent `{ "arkyo": [], "personal": [...] }` avec `source: "PERSONAL"`, ce qui garde le front d'arkyo intact. Des référentiels de départ sont extraits des seeds d'arkyo et livrés dans le binaire. Le front copie les pages et composants d'arkyo, retire le SaaS et applique l'habillage Strata.

**Tech Stack :** Rust (axum, sqlx/SQLite, csv, calamine), React 19 + Vite, Vitest, SheetJS (`xlsx`, bundlé), jsPDF (bundlé).

**Specs :** [`docs/superpowers/specs/2026-10-26-arkyo-server-design.md`](../specs/2026-10-26-arkyo-server-design.md) (§4.7, §6), [`docs/superpowers/specs/2026-10-26-strata-arkyo-design.md`](../specs/2026-10-26-strata-arkyo-design.md) (§7). **Référence fonctionnelle :** le code d'arkyo lui-même ; en cas de doute, le comportement d'arkyo fait foi.

## Décisions de la phase (Damien, 2026-11-05 : « on oublie les projets, images… fait l'application fonctionnelle »)

1. **Pas de reprise de données.** Sauvegarde SaaS, CSV et images : hors périmètre. La phase 8 (import d'un tenant) est abandonnée.
2. **Catalogue unique.** Toutes les données vivent dans les tables `Tenant*`. L'API présente tout comme `PERSONAL` :
   - `clonedFromArkyoId` et `clonedFromArkyoVersion` restent `null`, `shadowsArkyo` reste `false` ;
   - `arkyoDrift` et `arkyoSourceGone` valent `false` ;
   - les routes `…/restore` (« Récupérer la version Arkyo ») répondent `404 {"error":"Aucune version Arkyo"}` ;
   - les routes `…/restore-arkyo` des paramètres recréent les éléments intégrés à partir des seeds.
3. **Colonnes fusionnées.** Quand un modèle `Catalog*` porte une colonne absente du `Tenant*` jumeau, la table `Tenant*` la reçoit, nullable ou avec sa valeur par défaut :
   - `TenantFunction` : `cablePrefix`, `cableSuffix`, `systemCategory` ;
   - `TenantType` : `iconId`, `schemaImageUrl` ;
   - `TenantConnectorType` : `cablesLeft`/`cablesRight` ne sont pas stockés (relations) ;
   - `TenantSignalType` : `isDefault`, `sortOrder` ;
   - tous les autres écarts sont listés par la Task 1.

   Les relations « table de jointure » de main deviennent les tableaux JSON du tenant (`functionIds`, `phaseIds`, `connectorIds`).
4. **Référentiels de départ** extraits des routes de seed d'arkyo (`arkyo:app/api/supervisor/dev/seed-*/route.ts`, `arkyo:scripts/seed-*.ts`) : connecteurs, symboles, signaux, fonctions, phases, types, catégories, fabricants, modèles de câble, dimensions, gabarits d'impression, stocks d'étiquettes, modèles d'export d'impression, cordons et adaptateurs de base.
   - Ils sont figés en JSON dans `crates/arkyo-server/seeds/`, avec des ID cuid stables générés une fois.
   - Ils sont insérés à la création de la base, et pour les tables vides lors d'une migration.
   - Ils ne sont **pas** réinsérés si l'utilisateur les supprime. Exception : les routes `restore-arkyo`.
   - Pas d'équipements de démonstration (`seed-equipment`) : le catalogue d'équipements démarre vide.
5. **Impression.**
   - Onglet Impression porté pour la gestion des listes : créer, renommer, supprimer, dupliquer, valeurs numériques, restaurer les intégrés.
   - L'éditeur visuel (`components/print/*` → `components/drawing-editor`) est remplacé, dans les entrées qui l'ouvrent, par `<ComingSoon />`, avec le commentaire `// arkyo-server: éditeur visuel en phase 6`.
6. **Bibliothèques CDN bundlées.** Le serveur est en réseau local, sans internet garanti.
   - `lib/export/table-xlsx.ts` et `lib/xlsx-server.ts` importent `xlsx` (npm, version 0.18.5 de npm ou la dernière publiée par SheetJS sur son CDN npm `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` ; choisir `xlsx@0.18.5` de npm si l'installation tarball pose problème).
   - `lib/pdf/load-jspdf.ts` importe `jspdf` (dépendance déjà présente dans `arkyo:package.json`).
   - Chaque changement porte le commentaire `// arkyo-server: bundlé (hors ligne)`.
7. **Utilisateurs.**
   - L'« invitation » d'arkyo crée directement un compte : email, nom, rôle et mot de passe provisoire généré par le serveur (12 caractères), renvoyé une seule fois dans la réponse et affiché dans la boîte de dialogue avec un bouton « Copier ».
   - `mustChangePassword` est mis à 1.
   - Pas d'email envoyé. Retirer et réactiver un membre correspondent à `isActive`.
8. **Profil.**
   - Changement d'email direct, sans code OTP : modification du champ email avec validation d'unicité.
   - Ajout d'une carte « Mot de passe » (actuel, nouveau, confirmation) dans l'onglet Identité, via `POST /api/auth/password`, avec le commentaire `// arkyo-server: comptes locaux`.
9. **Espace.**
   - Seul l'onglet Informations est porté : nom du site (`AppConfig` `site.name`) et logo (`site.logoUrl`), plus la zone « Vider les référentiels ».
   - « Vider les référentiels » supprime tout le catalogue et les référentiels, puis réinsère les seeds.
   - Abonnements, factures, crédits et « Supprimer mon espace » sont retirés.
10. **Temps réel.** Un bus d'évènements en mémoire (`tokio::sync::broadcast`) alimente `/api/events` : les évènements `{type:"update", entity, action, id}` sont publiés par chaque route d'écriture, avec les mêmes `entity` qu'arkyo. La présence reste en stub jusqu'à la phase 7.
11. **Journal d'audit.** Table `AuditLog` (colonnes d'arkyo, `projectId` sans clé étrangère, table `Project` en phase 3) alimentée par les routes d'écriture.

## Global Constraints

- Toutes les contraintes de `CLAUDE.md`, notamment :
  - **copie des fichiers** : copier, puis retirer le SaaS (commenté), puis appliquer l'habillage Strata (commenté), jamais de reformatage ;
  - **API** : chemins, JSON et erreurs d'arkyo ;
  - **base** : tables nommées comme les modèles Prisma et migrations additives ;
  - **couleurs** : couleurs d'interface en variables, couleurs métier inchangées.
- Nouvelle migration `0002_catalogue.sql`. Aucune modification de `0001`.
- **Permissions** : comme arkyo (`lib/tenant-permissions.ts`) :
  - lectures : session seule, sauf les pages d'administration ;
  - écritures du catalogue : `catalog:write` ;
  - paramètres : `settings:write` (et `settings:admin` pour l'application et la purge) ;
  - membres et rôles : `members:admin`.

  Le propriétaire passe partout.
- **Chaque route d'écriture** :
  - valide son corps comme le schéma Zod d'arkyo ;
  - écrit en transaction ;
  - ajoute une ligne d'audit avec l'`action` et l'`entityType` d'arkyo ;
  - publie l'évènement temps réel d'arkyo ;
  - renvoie le JSON d'arkyo.
- Les pages portées remplacent leur `ComingSoon` dans `web/src/router.tsx`.
- **Pas de push ni de tag** sans accord de Damien.

## Review Focus

1. **Les formes JSON qu'attend le front copié.** Une liste vide au lieu d'une erreur, `source`/`isAccessible` présents, `brand`/`functions`/`type` résolus. Un écart casse l'écran sans erreur visible. → tests de forme Tasks 4 à 7, et vérification dans le navigateur (Task 13).
2. **Suppression d'un référentiel utilisé** (fabricant, connecteur, signal, fonction, type) : réponse 409 avec le même message qu'arkyo, rien supprimé. → tests Tasks 3, 4 et 5.
3. **Sauvegarde/restauration aller-retour.** Exporter puis restaurer en `replace` sur une base neuve redonne exactement le même catalogue. Une section en échec n'annule pas les précédentes (comme arkyo). → test Task 7.
4. **Import CSV/XLSX** d'un fichier exporté par l'application. Re-import sans perte des champs gérés par l'import d'arkyo, et doublons détectés. → test Task 7.
5. **Dernier propriétaire.** On ne peut ni le rétrograder, ni le retirer, ni le désactiver via l'interface des membres (garde de la phase 1). → test Task 8.

---

## Structure

```
crates/arkyo-server/migrations/0002_catalogue.sql
crates/arkyo-server/seeds/*.json                 référentiels figés
tools/extract-seeds/                              script Node one-shot (non livré) qui génère seeds/*.json depuis .ref/arkyo
crates/arkyo-server/src/seeds.rs                  insertion des seeds (création de base / tables vides / restore-arkyo / purge)
crates/arkyo-server/src/events.rs                 bus d'évènements (publish) branché sur /api/events
crates/arkyo-server/src/audit.rs                  insertion AuditLog
crates/arkyo-server/src/http/upload.rs            /api/upload, /api/upload/from-url
crates/arkyo-server/src/http/catalogue/{equipment,cables,adapters,connectors,lookup}.rs
crates/arkyo-server/src/http/parametres/{brands,connectors,signals,cabling,categories,dimensions,symbols,cable_models,print,numbering,application,backup,import}.rs
crates/arkyo-server/src/http/{members,roles,profile,espace,admin}.rs
crates/arkyo-server/src/catalogue/*.rs            logique pure : in-use checks, duplicate check, numérotation helpers, import (parse/detect/coerce/build)
crates/arkyo-server/tests/{catalogue,parametres,backup,import,members,profile}.rs
web/src/app/(app)/admin/{catalogue,parametres,users,espace}/**, web/src/app/(app)/profile/**   copies d'arkyo
web/src/components/{catalogue,equipment,cables,adapters,wizard,synoptique(partiel),print(partiel)}/**  copies d'arkyo
web/src/lib/**                                     copies d'arkyo nécessaires (services purs, export, hooks)
```

---

### Task 1 : Schéma du catalogue et seeds

**Files :**
- Create : `crates/arkyo-server/migrations/0002_catalogue.sql`, `crates/arkyo-server/src/seeds.rs`, `crates/arkyo-server/seeds/*.json`, `tools/extract-seeds/{package.json,extract.mjs}`
- Modify : `crates/arkyo-server/src/db.rs` (appel des seeds après migration), `src/lib.rs`
- Test : `crates/arkyo-server/tests/catalogue_schema.rs`

**Interfaces :**
- **Tables**, colonnes des modèles d'`arkyo:database/tenant/schema.prisma` complétées des colonnes listées au §3 des décisions :
  - catalogue : `TenantBrand`, `TenantEquipmentCategory`, `TenantFunction`, `TenantPhase`, `TenantType`, `TenantConnectorType`, `TenantSignalType`, `TenantEquipment`, `TenantEquipmentComponent`, `TenantCable`, `TenantCableModel`, `TenantAdapter`, `TenantDimensionPreset` ;
  - impression : `TenantPrintTemplate`, `TenantCableLabelStock`, `TenantPrintExportModel`, `TenantPrintExportPage` ;
  - autres : `ExportTemplate`, `AuditLog`, `CatalogSymbol` (modèle main, utilisé tel quel), `PrintSettings` (singleton main, lecture seule).

  Clés étrangères seulement là où arkyo a une vraie relation dans le schéma tenant. Les « soft FK » restent du texte.
- `seeds::apply(pool, mode: SeedMode)`, avec `SeedMode::{Initial, MissingTables, Restore(kind), Purge}`.
- `tools/extract-seeds/extract.mjs` lit les routes de seed d'arkyo et écrit les JSON :
  - il évalue les tableaux littéraux de données de chaque route, en remplaçant les appels Prisma par un collecteur ;
  - ID générés en cuid v1, stables : une fois générés, les JSON sont commités et ne sont plus régénérés.
- **Mapping Catalog* → Tenant* documenté** en tête de `0002_catalogue.sql` : pour chaque modèle, colonnes ajoutées, colonnes ignorées (SaaS : `visibleFromPlan`, `propagation`, `pinned` sauf usage d'affichage), relations converties en JSON.

- [ ] **Step 1 : Écrire les tests**

```rust
#[tokio::test] async fn fresh_db_has_seeded_referentials() { /* open() → TenantConnectorType ≥ 30, TenantSignalType ≥ 40, TenantFunction ≥ 8, TenantPhase ≥ 1, TenantType ≥ 1, CatalogSymbol ≥ 40, TenantDimensionPreset ≥ 1, TenantPrintTemplate ≥ 1, TenantCableLabelStock ≥ 1 ; TenantEquipment = 0 */ }
#[tokio::test] async fn seeds_not_reinserted_after_user_deletes() { /* delete all TenantBrand, reopen → 0 */ }
#[tokio::test] async fn seeds_fill_empty_tables_on_upgrade() { /* base v0.2 (0001 only) → open() applies 0002 + seeds */ }
#[test] fn seed_ids_are_unique_and_stable() { /* parse every seeds/*.json : ids uniques, format cuid, références internes résolues (functionId d'un type, connectorIds d'un signal, etc.) */ }
#[tokio::test] async fn older_binary_tolerates_0002() { /* règle des migrations additives : 0001 seul + table inconnue → open ok (déjà couvert phase 1, étendre au cas 0002) */ }
```

Les seuils minimaux sont à ajuster aux comptes réels des seeds d'arkyo et documentés dans le test.

- [ ] **Step 2 : Lancer les tests.** Run : `cargo test -p arkyo-server --test catalogue_schema` → FAIL.
- [ ] **Step 3 : Implémenter.** Écrire l'extracteur, générer et vérifier les JSON (spot-check de 3 entrées par fichier contre les sources d'arkyo), écrire la migration et `seeds.rs`.
- [ ] **Step 4 : Lancer les tests.** Run : `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings` → PASS.
- [ ] **Step 5 : Commit** `feat: schéma du catalogue unique et référentiels de départ`

---

### Task 2 : Socle serveur (évènements, audit, uploads)

**Files :**
- Create : `src/events.rs`, `src/audit.rs`, `src/http/upload.rs`
- Modify : `src/http/events.rs` (diffuse le bus en plus de `connected`/`ping`), `src/http/mod.rs`, `src/main.rs`
- Test : `tests/http_events.rs` (étendu), `tests/http_upload.rs`

**Interfaces :**
- `events::EventBus` (dans `AppState`) avec `publish(&self, entity: &str, action: &str, id: Option<&str>)`. Format SSE identique à `arkyo:lib/app-events.ts` et `app/api/events/route.ts`.
- `audit::log(tx, user_id, action, entity_type, entity_id, project_id: Option<&str>, before: Option<Value>, after: Option<Value>)`.
- `POST /api/upload` (multipart `file` + `folder`) et `POST /api/upload/from-url` (`{url, folder}`). Mêmes limites, types acceptés, noms (`uuid.ext`), réponses et erreurs que `arkyo:app/api/upload/**`. Écriture dans `<data>/uploads/<folder>/`. `folder` est validé contre la liste d'arkyo ; tout `..` ou séparateur est refusé.
- Headers des fichiers servis : ajouter `X-Content-Type-Options: nosniff`, et `Content-Security-Policy: sandbox` pour le SVG et le HTML (point différé de la phase 1, bloquant pour la phase 2).

- [ ] **Step 1 : Tests.**
  - `publish_reaches_sse_subscriber` : abonné SSE, publish → reçoit `data: {"type":"update","entity":"tenant_catalogue",...}`.
  - `upload_image_then_served_with_nosniff`.
  - `upload_rejects_bad_folder_and_traversal`.
  - `upload_rejects_too_large_or_wrong_type` : messages d'arkyo.
  - `from_url_rejects_non_http`.
  - `audit_row_written`.
- [ ] **Step 2 : Lancer les tests.** → FAIL.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 : Lancer les tests.** `cargo test --workspace`, clippy → PASS.
- [ ] **Step 5 : Commit** `feat: bus d'évènements, journal d'audit et uploads`

---

### Task 3 : API paramètres — référentiels

**Files :**
- Create : `src/http/parametres/{mod,brands,connectors,signals,cabling,categories,dimensions,symbols,cable_models}.rs`, `src/catalogue/in_use.rs`
- Test : `tests/parametres.rs`

**Interfaces :**
- Routes de `arkyo:app/api/tenant/parametres/{brands,connectors,signals,cabling,categories/**,dimensions/**,symbols,cable-models}` : mêmes méthodes, mêmes corps, mêmes formes. Les GET renvoient `{arkyo: [], personal: [...]}` là où arkyo renvoie cette forme.
- **Gardes reprises d'arkyo** :
  - doublons de nom : 409 ;
  - hiérarchie des types : `arkyo:lib/services/catalog/type-hierarchy.ts` et `_type-hierarchy-guard.ts` ;
  - in-use checks avant suppression : comptes par références dans les tables du catalogue. Les tables projet n'existent pas encore ; `in_use.rs` prévoit un point d'extension que la phase 3 complétera.
- `dimensions/restore-arkyo` : réinsère les dimensions intégrées manquantes depuis les seeds.
- Écritures : `settings:write`. Évènements `tenant_parametres_<x>` comme arkyo.

- [ ] **Step 1 : Tests.** Pour chaque référentiel : liste, création, renommage, suppression.
  - `delete_brand_in_use_is_409` (fabricant référencé par un équipement ou un cordon).
  - `create_duplicate_connector_is_409`.
  - `type_hierarchy_depth_1_enforced`.
  - `technicien_cannot_write_settings_403`.
  - `restore_dimensions_recreates_builtins`.
- [ ] **Step 2 à 4.** RED, implémenter, GREEN (`cargo test --workspace`, clippy).
- [ ] **Step 5 : Commit** `feat: API des référentiels du catalogue`

---

### Task 4 : API catalogue — équipements et lookup

**Files :**
- Create : `src/http/catalogue/{mod,equipment,lookup,connectors}.rs`, `src/catalogue/{enrich,duplicate}.rs`
- Test : `tests/catalogue_equipment.rs`

**Interfaces :**
- Routes de `arkyo:app/api/tenant/catalogue/equipment/**` :
  - liste et détail ;
  - POST, PATCH (pas de fork : écriture directe) et DELETE (409 si utilisé) ;
  - `duplicate`, `bulk-delete`, `check-duplicate` ;
  - `restore` → 404.
- `lookup` GET et POST, plus `connectors` GET (avec `hasNeutrikD` dérivé, `arkyo:app/api/_lib/connector-dtype.ts`).
- **Forme des éléments** : celle d'arkyo pour un élément `PERSONAL`, enrichie comme le fait `arkyo:lib/services/tenant-catalogue.ts` et `catalog-enrich.ts` (`brand`, `equipmentCategory`, `functions[]`, `type`), avec `source:"PERSONAL"` et `isAccessible:true`.
  - **Écart volontaire** : le type est résolu (`type`) aussi pour les éléments perso. Arkyo ne le faisait que pour ses éléments Arkyo, ce qui laissait la colonne Type vide à l'export (bug d'arkyo, corrigé ici).
- Règles de validation : `arkyo:lib/schemas/*` et les handlers (hôte/composant exclusifs, etc.).

- [ ] **Step 1 : Tests.**
  - `list_shape_matches_arkyo` : `{arkyo:[], personal:[{source:"PERSONAL", isAccessible:true, brand:{…}, functions:[…], type:{…}}]}`.
  - `create_patch_delete_roundtrip`.
  - `duplicate_names_copy`.
  - `check_duplicate_by_name_ci`.
  - `bulk_delete_skips_in_use`.
  - `restore_is_404`.
  - `lookup_returns_all_referentials`.
  - `connectors_has_neutrik_d`.
  - `consultation_cannot_write_403`.
- [ ] **Step 2 à 5.** RED, implémenter, GREEN, commit `feat: API du catalogue d'équipements`.

---

### Task 5 : API catalogue — cordons et adaptateurs

**Files :** `src/http/catalogue/{cables,adapters}.rs`, `tests/catalogue_cables.rs`

**Interfaces :** routes de `arkyo:app/api/tenant/catalogue/{cables,adapters}/**`, y compris `cables/lengths` et `?kind=model`, avec les mêmes formes que la Task 4.

- [ ] **Step 1 : Tests.**
  - `cable_list_resolves_connectors_brand_function`.
  - `cable_kind_model_returns_cable_models`.
  - `adapter_inputs_outputs_roundtrip`.
  - `delete_in_use_409`.
  - `duplicate_and_bulk_delete`.
- [ ] **Step 2 à 5.** RED, implémenter, GREEN, commit `feat: API des cordons et adaptateurs`.

---

### Task 6 : API paramètres — impression, numérotation, application, purge

**Files :** `src/http/parametres/{print,numbering,application}.rs`, `src/http/admin.rs` (`/api/admin/config`, `/api/admin/purge`), `tests/parametres_misc.rs`

**Interfaces :**
- **Impression** :
  - `print` GET : `printSettings` en lecture seule depuis la table singleton seedée, plus les gabarits ;
  - `print` POST ;
  - `print/templates/[id]`, `print/label-stocks/**`, `print/export-models/**` et leurs pages ;
  - les `restore-arkyo` réinsèrent depuis les seeds.
- **Numérotation** : `numbering` GET/PATCH, avec les clés autorisées d'arkyo et la valeur `"__DELETE__"`.
- **Application** : `application` GET/PATCH.
- **`/api/admin/config`** : GET/PATCH.
- **`/api/admin/purge`** : `settings:admin`. Vide le catalogue et les référentiels, puis appelle `seeds::apply(Purge)`. Réimplémenté sur les tables `Tenant*` (la version d'arkyo est cassée).

- [ ] **Step 1 : Tests.**
  - `numbering_allowlist_and_delete`.
  - `print_template_crud_and_restore`.
  - `label_stock_crud`.
  - `export_model_pages_crud`.
  - `purge_resets_to_seeds`.
  - `purge_requires_settings_admin`.
- [ ] **Step 2 à 5.** RED, implémenter, GREEN, commit `feat: API impression, numérotation, application et purge`.

---

### Task 7 : API sauvegarde, restauration et import CSV/XLSX

**Files :**
- `src/http/parametres/{backup,import}.rs`
- `src/catalogue/import/{parse,detect,coerce,resolve,build,preview}.rs`, port de `arkyo:lib/services/import/*`
- `tests/backup.rs`, `tests/import.rs`

**Interfaces :**
- **`backup`** : GET `?sections=` avec le format `arkyo-backup` v1 d'arkyo, mêmes sections et listes de champs (`arkyo:app/api/tenant/parametres/backup/_lib.ts`). `createdById` est réécrit avec l'utilisateur courant à la restauration.
- **`backup/summary`** et **`backup/restore`** : mêmes modes `merge`/`replace`, même ordre, une transaction par section.
- **`import/analyze`** :
  - entrée multipart `file`, ou JSON `{csv}`/`{matrix}` ;
  - CSV via le crate `csv`, avec détection du séparateur `;`/`,` et du BOM ;
  - XLSX via `calamine` ;
  - 12 Mo et 5000 lignes maximum.
- **`import/preview`** et **`import/commit`** : mêmes classifications, décisions de référence et politiques de doublons qu'arkyo.

- [ ] **Step 1 : Tests.**
  - `backup_restore_replace_roundtrip_identical` (Review Focus 3).
  - `restore_section_failure_keeps_previous_sections`.
  - `restore_merge_upserts_without_delete`.
  - `import_reimports_exported_csv` : exporter via la fonction d'export du front n'est pas accessible côté Rust, donc générer le CSV au format de `arkyo:lib/export/catalogue-export.ts`, en-têtes exacts du §4 du relevé (Review Focus 4).
  - `import_detects_columns_by_synonyms`.
  - `import_preview_flags_duplicates_in_file_and_db`.
  - `import_commit_creates_brands_on_decision`.
  - `import_xlsx_same_as_csv`.
- [ ] **Step 2 à 5.** RED, implémenter, GREEN, commit `feat: sauvegarde, restauration et import du catalogue`.

---

### Task 8 : API membres, rôles, profil, espace

**Files :** `src/http/{members,roles,profile,espace}.rs`, `tests/members.rs`, `tests/profile.rs`

**Interfaces :**
- **`/api/tenant/members`** GET/POST et `/[id]` PATCH/DELETE.
  - Même forme « membership » qu'arkyo, construite à partir de `User` et `Role` : `{id: userId, userId, user:{id,email,name,username,profile…}, role, roleKey, isActive, invitedEmail:null, acceptedAt:createdAt…}`. Lire la forme exacte dans `arkyo:app/api/tenant/members/route.ts` et l'onglet utilisateurs.
  - POST crée un utilisateur avec un mot de passe provisoire (décision 7) et renvoie `{…membre, temporaryPassword}`.
  - DELETE désactive le compte (même comportement visible qu'arkyo : le membre disparaît de la liste active).
- **`/api/tenant/roles`** GET/POST et `/[id]` PATCH/DELETE : mêmes gardes qu'arkyo (rôle propriétaire verrouillé, intégrés non supprimables, réaffectation des membres à la suppression).
- **`/api/tenant/profile`** GET/PATCH : `User`/`UserProfile`, unicité du nom d'utilisateur et de l'email.
- **`/api/tenant/espace/informations`** GET/PATCH : `site.name`/`site.logoUrl` dans `AppConfig`. `/api/site` renvoie aussi `logoUrl`.

- [ ] **Step 1 : Tests.**
  - `invite_creates_user_with_temp_password_must_change`.
  - `cannot_demote_or_remove_last_owner_409`.
  - `role_crud_and_delete_reassigns`.
  - `owner_role_locked`.
  - `profile_username_unique_409`.
  - `espace_name_logo_roundtrip`.
  - `members_requires_members_admin`.
- [ ] **Step 2 à 5.** RED, implémenter, GREEN, commit `feat: API membres, rôles, profil et espace`.

---

### Task 9 : Front — fondations partagées

**Files :**
- Copy, depuis arkyo vers `web/src/`, avec la fermeture des imports :
  - `components/catalogue/**` (sauf `catalog-proposal-dialog`, `correction-request-dialog`, `proposal-status-badge`) ;
  - `components/equipment/**`, `components/cables/**`, `components/adapters/**`, `components/wizard/**` ;
  - les fichiers de `components/synoptique/**` requis par `connectivity-tab` ;
  - les `components/ui/*` manquants ;
  - `lib/{api-client,catalog-broadcast,types/catalog,type-icons,hooks/use-local-storage-state}`, `lib/services/{cable-numbering,dimensions,print-layout,text-bbox,username}`, `lib/export/{catalogue-export,table-xlsx}` ;
  - `app/(app)/admin/_components/{admin-list-toolbar,list-toolbar-helpers,types,numbering-tab,users-list-tab}`.
- Modify : `web/package.json` (dépendances d'arkyo nécessaires, avec les versions d'arkyo, plus `xlsx`).
- Test : `web/src/tests/phase2-imports.test.ts` (chaque module copié s'importe), plus les tests unitaires d'arkyo correspondants copiés (`tests/unit/{cable-numbering,dimensions,csv-export,catalogue-export,import-*,row-selection,alias,username,…}.test.ts` qui portent sur des modules copiés).

**Interfaces :**
- **Retraits SaaS**, commentés :
  - plan (`useTenantPlan`, `canAccess`, `isAccessible` → toujours vrai) ;
  - propositions et badges Arkyo/perso ;
  - `use-pending-updates` ;
  - liens support.
- **CDN remplacés par les paquets** (décision 6).
- **Habillage Strata** des couleurs d'interface, selon la règle de `CLAUDE.md`. La liste des couleurs métier conservées est mise dans le rapport.

- [ ] **Step 1 :** copier les tests unitaires d'arkyo concernés et le test d'imports. Run : `cd web && npx vitest run` → FAIL (modules absents).
- [ ] **Step 2 :** copier les modules, retirer le SaaS, bundler les CDN, appliquer l'habillage.
- [ ] **Step 3 :** `cd web && npm test && npx tsc --noEmit && npm run build` → PASS.
- [ ] **Step 4 : Commit** `feat: composants partagés du catalogue (copie arkyo)`

---

### Task 10 : Front — Paramètres

**Files :** copy `arkyo:app/(app)/admin/parametres/**`. Les `*-proposal-dialog` ne sont pas copiés. L'onglet Impression suit la décision 5. Brancher `/admin/parametres` dans `web/src/router.tsx`, avec un chargement paresseux (`lazy()`).

**Interfaces :** même page, mêmes 9 onglets et sous-onglets, même persistance d'onglet ; gardée par `settings:admin` comme arkyo.

- [ ] **Step 1 : Tests (vitest, fetch simulé sur les formes des Tasks 3 et 6).**
  - `parametres_renders_9_tabs`.
  - `brands_tab_lists_and_creates`.
  - `delete_in_use_shows_arkyo_message`.
  - `numbering_preview_updates`.
  - `print_editor_entry_shows_coming_soon`.
- [ ] **Step 2 à 4.** RED, implémenter, GREEN (`npm test`, `tsc`, `build`).
- [ ] **Step 5 : Commit** `feat: page Paramètres (copie arkyo)`

---

### Task 11 : Front — Catalogue et éditeurs

**Files :** copy `arkyo:app/(app)/admin/catalogue/**` et `arkyo:app/(app)/admin/equipment/**` (éditeur partagé ; l'onglet Distribution reste masqué comme côté tenant). Brancher les routes `/admin/catalogue`, `…/equipment/new|:id`, `…/cables/new|:id` et `…/adapters/new|:id` (en `lazy()`).

**Interfaces :**
- Pages d'arkyo telles quelles. Les server pages (`page.tsx`) qui pré-chargeaient côté serveur deviennent des composants client qui chargent la même donnée via l'API, au même moment du rendu. Même affichage d'attente : `LoadingState`.
- Les redirections de forks (shadow) disparaissent : il n'y a plus de fork.

- [ ] **Step 1 : Tests.**
  - `catalogue_tabs_equipment_cables_adapters`.
  - `equipment_list_empty_state` et `equipment_list_from_api`.
  - `equipment_editor_autosave_patch`.
  - `new_equipment_wizard_creates`.
  - `cable_editor_connectors`.
  - `adapter_editor_inputs_outputs`.
- [ ] **Step 2 à 5.** RED, implémenter, GREEN, commit `feat: catalogue et éditeurs (copie arkyo)`.

---

### Task 12 : Front — Utilisateurs, espace, profil

**Files :**
- Copy `arkyo:app/(app)/admin/users/**`, `arkyo:app/(app)/admin/espace/**` (onglet Informations seulement ; l'import d'`espace-client` vers Abonnements est coupé proprement) et `arkyo:app/(app)/profile/**`.
- Inline des dépendances `app/supervisor/users/[id]/_editor/{ui,avatar-upload-shared,types}`, en les copiant sous `web/src/app/supervisor/users/[id]/_editor/` au même chemin relatif.
- Brancher `/admin/users`, `/admin/espace` et `/profile`. `/settings` redirige vers `/admin/espace`, comme arkyo.
- Le logo du site s'affiche dans la topbar comme arkyo (lockup, puis séparateur, puis logo et nom).

**Interfaces :** décisions 7, 8 et 9.

- [ ] **Step 1 : Tests.**
  - `invite_dialog_shows_temp_password_once`.
  - `roles_panel_crud`.
  - `profile_password_card_changes_password`.
  - `espace_informations_saves_name_and_logo`.
  - `topbar_shows_site_name`.
- [ ] **Step 2 à 5.** RED, implémenter, GREEN, commit `feat: utilisateurs, espace et profil (copie arkyo)`.

---

### Task 13 : Intégration et vérification

**Files :** `crates/arkyo-server/tests/phase2_smoke.rs`, `CLAUDE.md` (« État actuel »), `docs/superpowers/plans/2026-10-26-phase-1-suivi.md` (points traités)

**Interfaces :** un test d'intégration qui enchaîne, sur une base neuve, les étapes suivantes via HTTP :
1. créer le propriétaire ;
2. créer un fabricant ;
3. créer un équipement avec deux ports ;
4. le dupliquer ;
5. créer un cordon ;
6. exporter la sauvegarde ;
7. purger ;
8. restaurer ;
9. vérifier que le catalogue est identique.

**Vérification visuelle (contrôleur) :** parcours dans le navigateur intégré, en clair et en sombre, de chaque onglet des Paramètres, du catalogue (listes, éditeurs, assistants), des utilisateurs et rôles, de l'espace et du profil. Comparaison de disposition avec le code d'arkyo. Aucune erreur dans la console.

- [ ] **Step 1 :** écrire le test d'intégration → RED tant qu'une pièce manque.
- [ ] **Step 2 :** corriger les écarts → GREEN.
- [ ] **Step 3 :** `cargo test --workspace`, clippy, `cd web && npm test && npx tsc --noEmit && npm run build` → PASS.
- [ ] **Step 4 : Commit** `test: parcours de bout en bout de la phase 2`
