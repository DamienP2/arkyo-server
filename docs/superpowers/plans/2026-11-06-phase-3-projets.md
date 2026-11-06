# Phase 3 — Projets et bibliothèques : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Rendre fonctionnels, à l'identique d'arkyo (ergonomie) et avec l'habillage Strata :
- le tableau de bord ;
- la liste des projets et l'assistant « Nouveau projet » ;
- les bibliothèques `/templates` (contenants et panels), le détail de régie ;
- l'éditeur de panel plein écran.

**Architecture :** une migration `0003_projets.sql` crée les tables de projets, de lieux, de régies, de racks, de slots, d'inventaire et de panels. L'API Rust reprend les routes `arkyo:app/api/{tenant/projects,projects,racks,rigs,panels}/**` : chemins, JSON et erreurs identiques. Le front copie les pages et composants d'arkyo, convertit les Server Components en chargeurs client, retire le SaaS et applique l'habillage Strata.

**Tech Stack :** Rust (axum, sqlx/SQLite), React 19 + Vite, Vitest, `zustand` (nouvelle dépendance, version d'`arkyo:package.json`).

**Specs :**
- [`docs/superpowers/specs/2026-10-26-arkyo-server-design.md`](../specs/2026-10-26-arkyo-server-design.md) (§4.5, §4.7, §6, §9).
- **Inventaire détaillé** (pages, routes, modèles, numéros de ligne d'arkyo) : [`2026-11-06-phase-3-inventaire.md`](2026-11-06-phase-3-inventaire.md). Chaque tâche cite ses sections ; l'implémenteur les lit avant de coder.
- **Référence fonctionnelle :** le code d'arkyo ; en cas de doute, le comportement d'arkyo fait foi.

## Décisions de la phase

Damien a demandé une application fonctionnelle, avec les choix techniques tranchés par moi. Ces décisions sont consignées ici.

1. **Éditeur de rack reporté en phase 4.**
   - Sa fermeture d'imports, synoptique et inventaire projet compris, fait 60 k lignes, et il dépend de 21 routes `/api/racks/:id/**` (inventaire §6.2).
   - `/racks/:rackId` et `/rigs/:id/rack/:rackId` restent `ComingSoon`, comme `/project/:id/*`.
   - Les liens qui y mènent (cartes de contenant, fin d'assistant, cartes de projet) restent tels qu'arkyo les écrit et ouvrent donc l'écran `ComingSoon`.
2. **Éditeur de panel porté en phase 3.** Il est autonome : 5,6 k lignes, 4 routes, la table `PanelSlot` (inventaire §6.3).
3. **Fiche projet, audit et documents.**
   - La fiche fait partie de l'éditeur de la phase 4 : `/projects/:id` redirige comme arkyo.
   - Les deux `GET …/audit` vont en phase 4, avec `audit-panel`.
   - Les routes documents ne sont pas portées : aucun écran ne les appelle.
4. **Tables `Task`, `Message`, `ProjectDocument` créées vides**, pour que les compteurs (`_count`, `taskStats`) soient de vraies requêtes. Rien ne les écrit, comme dans arkyo.
5. **Colonnes `snapshotId`** de `RackSlot` et `RackInventoryItem` : présentes, nullables, toujours `NULL`. On garde le schéma d'arkyo, mais la logique de snapshot n'est pas portée (spec §4.7).
6. **Permissions serveur reprises des gardes de l'UI**, alors qu'arkyo ne vérifiait que la session (inventaire §2.4) :
   - `projects:write` pour POST/PATCH projets, lieux et racks de projet ;
   - `projects:admin` pour DELETE projet ;
   - `design:write` pour POST/PATCH racks, rigs, panels et slots ;
   - `design:admin` pour DELETE rack, rig et panel ;
   - les lectures demandent une session ; `GET /api/panels` et `GET /api/panels/:id` aussi (arkyo ne demandait rien).

   Chaque garde est commentée `// arkyo-server: garde serveur alignée sur l'UI`.
7. **Suppression d'un projet** : elle supprime aussi ses régies (`RigConfig.projectId`) et les racks qui n'appartiennent qu'à ces régies, racks virtuels de lieux compris. arkyo les laissait réapparaître dans `/templates` (inventaire §0.10). C'est un défaut d'arkyo, corrigé avec un commentaire `// arkyo-server:`. Les lignes `AuditLog` du projet passent à `projectId = NULL` (SetNull d'arkyo).
8. **`RigsClient`** (code mort d'arkyo) n'est pas porté. L'onglet « Dossiers » de `/templates` affiche `ComingSoon` jusqu'à la phase 6, avec le commentaire `// arkyo-server: phase 6`.
9. **Évènements temps réel** :
   - `EventBus` gagne `publish_meta(entity, action, id, meta: EventMeta)`, avec `EventMeta { project_id, rack_id, item_id, client_id, data }` sérialisé en camelCase comme `arkyo:lib/app-events.ts:47-60` ;
   - `clientId` est lu dans l'en-tête que lit `arkyo:lib/client-id.ts` ;
   - le SSE par rack reste en phase 4.
10. **Curseurs live et WebSocket** (`use-live-cursors.ts`) : copiés tels quels, sauf la connexion, neutralisée par un retour anticipé commenté `// arkyo-server: temps réel en phase 7`. Il ne doit y avoir ni appel à `/api/realtime/ticket`, ni erreur en console.
11. **Données des Server Components** : elles passent par l'API, avec des extensions commentées `// arkyo-server: données de la page serveur d'arkyo` :
    - `GET /api/tenant/projects` renvoie en plus `description`, `documentsCount` et `rigConfigsCount` (projets) ;
    - `GET /api/racks?templates=true` applique le filtre de `arkyo:app/(app)/templates/page.tsx:27-37` (contenants) ;
    - le tableau de bord lit `GET /api/projects` et `taskStats` par une nouvelle clé `?stats=tasks` sur la même route (`[{status, _count}]`).

## Global Constraints

- **Contraintes de `CLAUDE.md`**, notamment :
  - copie, puis retrait du SaaS (commenté), puis habillage Strata (commenté), jamais de reformatage ;
  - API identique à arkyo ;
  - tables nommées comme les modèles Prisma ;
  - migrations additives ;
  - couleurs d'interface en variables, couleurs métier inchangées.
- **Migration** : nouvelle migration `0003_projets.sql`, sans aucune modification de `0001`/`0002`. Les conventions de types sont celles d'en-tête de `0002_catalogue.sql`. `ON DELETE` est celui d'arkyo (Prisma : relation optionnelle sans `onDelete` → SetNull, obligatoire → Restrict).
- **Erreurs de validation**, au format d'arkyo route par route :
  - `{ error: flatten() }` (`http::parametres::valid::failure`) pour `/api/projects`, `/api/racks/**`, `/api/rigs/**` et `/api/panels/:id/slots/**` ;
  - `{ error: "Validation invalide", issues }` pour `/api/tenant/projects/**`.
- **Chaque route d'écriture**, dans cet ordre :
  1. session et permission (décision 6) ;
  2. validation ;
  3. écriture en transaction ;
  4. audit si arkyo en écrit (mêmes `action`/`entityType`) ;
  5. évènement d'arkyo ;
  6. JSON d'arkyo.

  `assertNotGhost` disparaît.
- **Front** :
  - pages chargées en `lazyPage(...)` dans `web/src/router.tsx` ;
  - chargeur client `ClientPage` (`web/src/components/client-page.tsx`), avec `LoadingState` puis un état d'erreur avec « Réessayer » ;
  - gardes de page d'arkyo (`projects:read`, `design:read`, `design:write`) ;
  - fichiers copiés ajoutés à `COPIED_FILES` de `web/src/theme-sweep.test.ts`.
- **Git** : pas de push ni de tag sans accord de Damien.

## Review Focus

1. **Noms en double insensibles à la casse et aux accents.** « Régie Nord » et « regie nord » donnent un 409 avec le message d'arkyo, en suivant le `fold` de `http::parametres` (Unicode). → test Task 2.
2. **Projet supprimé.** Rien ne réapparaît dans `/templates` : les racks virtuels des lieux et les racks propres au projet disparaissent. Un rack modèle lié par ailleurs à une autre régie est conservé. → test Task 2.
3. **Panel redimensionné.** Changer `heightU` ou `slotsPerU` vide les slots (comme arkyo). Changer le seul nom les garde. → test Task 5.
4. **Rôle « consultation ».** Toute écriture des routes de la phase renvoie 403, et les lectures 200. → tests Tasks 2, 4 et 5.
5. **Catalogue utilisé dans un rack.** Supprimer un équipement référencé par un `RackSlot` ou un `RackInventoryItem` est refusé (409, message de la phase 2). → test Task 1.

---

## Structure

```
crates/arkyo-server/migrations/0003_projets.sql
crates/arkyo-server/src/events.rs                    + publish_meta / EventMeta
crates/arkyo-server/src/http/client_id.rs            lecture de l'en-tête clientId
crates/arkyo-server/src/http/projects/{mod,tenant,legacy,locations,racks}.rs
crates/arkyo-server/src/http/racks.rs, rigs.rs, panels.rs
crates/arkyo-server/src/projects/{naming,cable_code,enrich}.rs   logique pure (ensureUniqueRackName, deriveCableCode, cableId, enrichissement des slots)
crates/arkyo-server/tests/{projects,project_racks,racks_rigs,panels,phase3_smoke}.rs
web/src/app/(app)/{dashboard,projects,templates,racks,rigs,panels}/**   copies d'arkyo + chargeurs
web/src/app/(fullscreen)/panels/[id]/**
web/src/components/{projects,racks,panels,editor-shell}/**, web/src/components/synoptique/{components,hooks}/** (partiel)
web/src/lib/services/rack-validation.ts
```

---

### Task 1 : Schéma de la phase et socle serveur

**Files :**
- Create : `crates/arkyo-server/migrations/0003_projets.sql`, `src/http/client_id.rs`
- Modify : `src/events.rs`, `src/http/mod.rs`
- Test : `tests/projects_schema.rs`, `tests/http_events.rs` (ajout)

**Interfaces :**
- **Tables** (inventaire §3.1 et §3.2, colonnes, défauts et `ON DELETE` d'arkyo) :
  - `Project`, `TechnicalSheet`, `Location`, `RigConfig`, `RigRack`, `Rack`, `RackSlot`, `RackInventoryItem`, `Panel`, `PanelSlot` ;
  - `Task`, `Message`, `ProjectDocument`.

  Les enums d'arkyo deviennent `TEXT CHECK`, plus les index d'arkyo.
- `EventBus::publish_meta(&self, entity: &str, action: &str, id: Option<&str>, meta: EventMeta)`, avec `#[derive(Default)] pub struct EventMeta { pub project_id: Option<String>, pub rack_id: Option<String>, pub item_id: Option<String>, pub client_id: Option<String>, pub data: Option<Value> }`. Les champs `None` sont omis du JSON.
- `client_id::read(headers: &HeaderMap) -> Option<String>`, qui lit le même en-tête qu'`arkyo:lib/client-id.ts` et applique les mêmes bornes.

- [ ] **Step 1 : Tests**

```rust
#[tokio::test] async fn phase3_tables_exist_with_defaults() { /* insert Project (name seul) → status EN_PREPARATION, interventionType PRESTATION ; Rack → totalU 42, depthMm 600, rackType STANDARD, templateStatus BROUILLON ; Panel → panelType PATCH, heightU 1, slotsPerU 8, rearCableDepthMm 80 */ }
#[tokio::test] async fn project_delete_cascades_like_arkyo() { /* delete Project → TechnicalSheet, Location gone ; RigConfig.projectId NULL ; Rack.locationId NULL (règles SQL ; la suppression des racks est faite par la route, Task 2) */ }
#[tokio::test] async fn enum_check_rejects_unknown_status() { /* status 'X' → erreur */ }
#[tokio::test] async fn equipment_in_rack_slot_cannot_be_deleted() { /* équipement créé par l'API, RackSlot.catalogEquipmentId = id → DELETE /api/tenant/catalogue/equipment/:id → 409 message de la phase 2 ; idem RackInventoryItem */ }
#[tokio::test] async fn publish_meta_serializes_camel_case() { /* subscribe ; publish_meta("rack","updated",Some("r1"), EventMeta{project_id:Some("p"),client_id:Some("c"),..}) → {"type":"update","entity":"rack","action":"updated","id":"r1","projectId":"p","clientId":"c"} */ }
#[test] fn client_id_header_read_and_bounded() { /* valeur valide lue ; vide ou trop longue → None */ }
#[tokio::test] async fn older_binary_tolerates_0003() { /* règle additive, comme les phases 1 et 2 */ }
```

- [ ] **Step 2 :** lancer `cargo test -p arkyo-server --test projects_schema` : échec attendu (tables absentes).
- [ ] **Step 3 :** écrire la migration, `publish_meta` et `client_id`.
- [ ] **Step 4 :** lancer `cargo test --workspace` puis `cargo clippy --workspace --all-targets -- -D warnings` : succès attendu.
- [ ] **Step 5 :** commit `feat: schéma des projets, racks et panels (0003)`.

---

### Task 2 : API projets

**Files :**
- Create : `src/http/projects/{mod,tenant,legacy}.rs`
- Test : `tests/projects.rs`

**Interfaces :**
- Routes (inventaire §2.1, lignes 182-191) :
  - `GET/POST /api/tenant/projects` : le GET ajoute `description`, `documentsCount` et `rigConfigsCount` (décision 11) ;
  - `GET/PATCH/DELETE /api/tenant/projects/:id` ;
  - `GET/POST /api/projects` : le GET accepte `?stats=tasks` → `[{status, _count}]` (décision 11).
- Le POST crée la `TechnicalSheet` et `status EN_PREPARATION`. Le doublon de nom renvoie le 409 d'arkyo, avec `issues` et le message exact.
- DELETE : décision 7. Supprime les régies du projet et les racks qui ne sont liés à aucune autre régie, met `AuditLog.projectId` à NULL, et écrit l'audit `delete` sans `projectId`.
- Consomme : `require` (`http::mod`), `audit::log`, `EventBus::publish_meta` (Task 1), `http::parametres::fold`.

- [ ] **Step 1 : Tests**

```rust
#[tokio::test] async fn create_project_like_arkyo() { /* POST {name:"Tournage A", interventionType:"PRESTATION"} → 201, status EN_PREPARATION, TechnicalSheet créée ; audit create/Project ; évènement project created avec projectId */ }
#[tokio::test] async fn duplicate_name_is_409_case_and_accent_insensitive() { /* "Régie Nord" puis "regie nord" → 409 {error:"Validation invalide", issues:[{path:["name"],message:"Un projet porte déjà ce nom dans cet espace."}]} */ }
#[tokio::test] async fn invalid_body_returns_issues() { /* interventionType "X" → 400 {error:"Validation invalide", issues} */ }
#[tokio::test] async fn list_has_page_fields() { /* GET /api/tenant/projects → projects[0] a description, documentsCount 0, rigConfigsCount, triés updatedAt desc */ }
#[tokio::test] async fn patch_and_get_detail() { /* PATCH status PRET → GET :id renvoie status PRET, _count {tasks:0,messages:0,documents:0}, documents [], rigConfigs [] ; 404 "Not found" sur id inconnu */ }
#[tokio::test] async fn delete_project_leaves_no_template_ghosts() { /* projet + lieu (Task 3 non requise : insérer RigConfig/Rack/RigRack en SQL) + rack lié aussi à une régie modèle → DELETE → racks propres supprimés, rack partagé conservé, AuditLog.projectId NULL */ }
#[tokio::test] async fn dashboard_routes() { /* GET /api/projects → technicalSheet.completionPercent, _count.tasks ; ?stats=tasks → [] */ }
#[tokio::test] async fn consultation_role_cannot_write() { /* POST/PATCH/DELETE → 403 ; GET → 200 */ }
```

- [ ] **Step 2 :** lancer `cargo test -p arkyo-server --test projects` : échec attendu.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** lancer `cargo test --workspace` et clippy : succès attendu.
- [ ] **Step 5 :** commit `feat: API projets (copie arkyo)`.

---

### Task 3 : API lieux et racks d'un projet

**Files :**
- Create : `src/http/projects/{locations,racks}.rs`, `src/projects/{naming,cable_code}.rs`
- Test : `tests/project_racks.rs`

**Interfaces :**
- Routes (inventaire §2.1, lignes 187-189) :
  - `GET/POST /api/tenant/projects/:id/locations` : le POST crée la régie implicite « ${name} — Régie principale », puis le `Location` et un rack virtuel relié par `RigRack` ;
  - `POST /api/tenant/projects/:id/racks`, avec la branche `fromTemplateId`, qui clone `RackSlot` et `RackInventoryItem`.
- Logique pure, dans `src/projects/` :
  - `naming::ensure_unique_rack_name(conn, project_id, base) -> String` (`arkyo:lib/services/rack-naming.ts`) ;
  - `cable_code::derive(name) -> String` (`locations/route.ts:13-16`).

- [ ] **Step 1 : Tests**

```rust
#[tokio::test] async fn first_location_creates_rig_and_virtual_rack() { /* POST locations {name:"Plateau"} → 201 {…, virtualRackId, containerCount:0} ; RigConfig "… — Régie principale" ; Rack isVirtual=1 ; audit create_location */ }
#[test] fn derive_cable_code_like_arkyo() { /* cas tirés de la fonction d'arkyo, max 5 caractères */ }
#[tokio::test] async fn add_racks_names_unique_per_project() { /* deux racks "Rack" → "Rack", "Rack 2" ; 201 {rigConfigId, racks:[…]} ; audit add_rack */ }
#[tokio::test] async fn unknown_location_is_400() { /* → 400 "Emplacement introuvable" */ }
#[tokio::test] async fn from_template_clones_slots_and_inventory() { /* régie isTemplate + rack + 2 RackSlot + 1 RackInventoryItem → clone, ids neufs, inventoryItemId remappé ; id inconnu → 404 "Template introuvable : <id>" */ }
```

- [ ] **Step 2 à 5 :** RED, implémenter, GREEN (workspace et clippy), commit `feat: API lieux et racks d'un projet (copie arkyo)`.

---

### Task 4 : API racks et régies

**Files :**
- Create : `src/http/{racks,rigs}.rs`, `src/projects/enrich.rs`
- Test : `tests/racks_rigs.rs`

**Interfaces :**
- Routes (inventaire §2.1, lignes 192-202) :
  - `GET/POST /api/racks` : le GET accepte `?unassigned=true&rigConfigId=` et `?templates=true` (décision 11) ;
  - `PATCH/DELETE /api/racks/:id`, avec `cableCode` normalisé A-Z0-9, `numberingOverride` et `templateStatus`, et l'évènement avec `rackId` et `clientId` ;
  - `GET/POST /api/rigs`, `GET/PATCH/DELETE /api/rigs/:id` (règle `isTemplate`, message 400 exact) ;
  - `POST /api/rigs/:id/racks` (lier ou créer), `DELETE /api/rigs/:id/racks/:rackId`.
- `enrich::slots(conn, &mut [Rack]) -> Result<()>` ajoute à chaque slot `equipmentId`, `equipment` (catalogue local, via `catalogue::enrich`) et `panel{…, slots[{position, mountD, connectorTypeId, connectorType}]}`, comme `enrichRacks` (`arkyo:app/api/racks/route.ts:66-106`).
- `cableId` du POST : premier numéro libre dans l'ordre `[1..9, 0]`, sinon `null`.

- [ ] **Step 1 : Tests**

```rust
#[tokio::test] async fn create_rack_allocates_cable_id() { /* 10 racks → cableId 1..9 puis 0 ; 11e → null */ }
#[tokio::test] async fn rack_validation_uses_flatten() { /* totalU 99 → 400 {error:{formErrors,fieldErrors:{totalU:[…]}}} */ }
#[tokio::test] async fn templates_filter_excludes_project_racks() { /* rack d'une régie de projet absent de ?templates=true ; rack libre présent */ }
#[tokio::test] async fn patch_rack_normalizes_cable_code_and_publishes_client_id() { /* cableCode "a-b 1" → "AB1" ; en-tête clientId → évènement {rackId, clientId} */ }
#[tokio::test] async fn slots_are_enriched() { /* RackSlot.catalogEquipmentId → slot.equipment.name ; panelId → slot.panel.slots[*].connectorType */ }
#[tokio::test] async fn rig_linked_to_project_cannot_become_template() { /* PATCH isTemplate:true → 400 message exact */ }
#[tokio::test] async fn link_unlink_rack() { /* POST {rackId} → 201 ; deuxième fois → 409 "Rack already linked to this rig" ; DELETE → {ok:true} ; DELETE à nouveau → 404 "Link not found" */ }
#[tokio::test] async fn consultation_role_cannot_write_racks_or_rigs() { /* écritures 403, lectures 200 */ }
```

- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: API racks et régies (copie arkyo)`.

---

### Task 5 : API panels

**Files :**
- Create : `src/http/panels.rs`
- Test : `tests/panels.rs`

**Interfaces :**
- Routes (inventaire §2.1, lignes 203-211) :
  - `GET/POST /api/panels` (`?scope=inventaire`) ;
  - `GET/PATCH/DELETE /api/panels/:id` ;
  - `POST/DELETE /api/panels/:id/slots` ;
  - `PATCH/DELETE /api/panels/:id/slots/:slotId`.
- `checkMountDAllowed` lit `TenantConnectorType` avec la dérivation Neutrik D de la phase 2 (`http::parametres::connectors::{has_neutrik_d, load_symbols}`).
- `createdById` = utilisateur courant.

- [ ] **Step 1 : Tests**

```rust
#[tokio::test] async fn create_panel_requires_name() { /* POST {} → 400 "Nom requis" ; POST {name:"Patch 1"} → 201, panelType PATCH */ }
#[tokio::test] async fn private_panels_hidden_unless_inventaire_scope() { /* private:true absent de GET /api/panels, présent avec ?scope=inventaire */ }
#[tokio::test] async fn resizing_panel_clears_slots() { /* 2 slots ; PATCH {name} → slots gardés ; PATCH {slotsPerU:12} → slots supprimés */ }
#[tokio::test] async fn neutrik_d_rules() { /* connecteur sans version D + mountD → 400 "Ce connecteur n'existe pas en version Neutrik D." ; >16 modules D par U → 400 "Panneau trop dense pour un module Neutrik D (max 16 par U)." */ }
#[tokio::test] async fn slot_crud_and_enrichment() { /* POST slot → connectorType enrichi ; PATCH inconnu → 404 "Slot introuvable" ; DELETE /slots → panel vidé */ }
#[tokio::test] async fn panel_routes_require_session_and_design_rights() { /* GET sans session → 401 (décision 6) ; consultation : écritures 403 */ }
```

- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: API panels (copie arkyo)`.

---

### Task 6 : Front, routeur de la phase et tableau de bord

**Files :**
- Copy : `arkyo:app/(app)/dashboard/page.tsx`, transformé en chargeur client. Le rendu reste à l'identique : seul l'accès aux données passe de Prisma à `GET /api/projects` et `?stats=tasks`, et le prénom vient de `useSession`. Le tout est commenté.
- Modify : `web/src/router.tsx`
- Test : `web/src/app/(app)/dashboard/dashboard-page.test.tsx`, `web/src/router.test.tsx` (ajout)

**Interfaces :**
- Routeur :
  - `dashboard` et `projects` : pages réelles ;
  - `projects/:id` → redirection `/project/:id?tab=fiche` ;
  - `racks`, `rigs` et `panels` → redirections d'arkyo ;
  - `templates`, `rigs/:id`, `panels/:id` (plein écran) : pages réelles, branchées par les Tasks 7 à 12 (route réservée ici, `ComingSoon` jusque-là) ;
  - `racks/:rackId`, `rigs/:id/rack/:rackId` et `project/:id/*` restent `ComingSoon` (phase 4).

- [ ] **Step 1 :** écrire les tests `dashboard_lists_projects_and_greets_user`, `dashboard_empty_state`, `dashboard_error_state_retry` et `redirects_like_arkyo` (les 4 redirections).
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN (`cd web && npm test && npx tsc --noEmit && npm run build`), commit `feat: tableau de bord et routes de la phase 3`.

---

### Task 7 : Front, liste des projets

**Files :**
- Copy : `arkyo:app/(app)/projects/{page.tsx,projects-client.tsx}`. `page.tsx` devient un chargeur client sur `GET /api/tenant/projects` (décision 11).
- Test : `web/src/app/(app)/projects/projects-page.test.tsx`

- [ ] **Step 1 :** écrire les tests `projects_tabs_prestation_integration` (onglets pilotés par `?tab=`), `filters_and_sort`, `delete_requires_projects_admin` (bouton absent sans le droit ; confirmation puis `DELETE`) et `card_links_to_editor` (lien `/project/:id?tab=fiche`).
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: liste des projets (copie arkyo)`.

---

### Task 8 : Front, assistant « Nouveau projet »

**Files :**
- Copy : `arkyo:components/projects/new-project-dialog.tsx`, `arkyo:components/racks/rack-wizard-steps.tsx`
- Test : `web/src/components/projects/new-project-dialog.test.tsx`

Les mini-maquettes de l'assistant reçoivent l'habillage Strata : couleurs d'interface en variables, couleurs métier inchangées.

- [ ] **Step 1 :** écrire les tests :
  - `wizard_creates_project_location_and_rack` : trois appels dans l'ordre (`POST /api/tenant/projects`, `…/locations`, `…/racks`), puis navigation vers `/project/:id?tab=inventaire` ;
  - `duplicate_name_shows_field_error` : un 409 affiche le message sous le champ nom ;
  - `cancel_mid_wizard_creates_nothing`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: assistant nouveau projet (copie arkyo)`.

---

### Task 9 : Front, `/templates` et onglet Contenants

**Files :**
- Copy : `arkyo:app/(app)/templates/{page.tsx,templates-client.tsx}`, `arkyo:app/(app)/racks/racks-client.tsx`, `arkyo:components/racks/new-rack-wizard.tsx`
- Test : `web/src/app/(app)/templates/templates-page.test.tsx`

**Interfaces :**
- La page lit `GET /api/racks?templates=true`, puis `GET /api/panels` pour l'onglet panels de la Task 10.
- L'onglet `dossiers` affiche `ComingSoon` (décision 8).
- L'enrichissement du catalogue (`fetchCatalog*Map`) vient de l'API : slots enrichis (Task 4).

- [ ] **Step 1 :** écrire les tests `containers_tab_lists_template_racks`, `new_container_wizard_posts_rack`, `delete_container_requires_design_admin` et `dossiers_tab_is_coming_soon`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: bibliothèque des contenants (copie arkyo)`.

---

### Task 10 : Front, onglet Panels et détail de régie

**Files :**
- Copy : `arkyo:app/(app)/panels/panels-client.tsx`, `arkyo:components/panels/new-panel-wizard.tsx`, `arkyo:app/(app)/rigs/[id]/{page.tsx,rig-detail-client.tsx}`
- Test : `web/src/app/(app)/templates/panels-tab.test.tsx`, `web/src/app/(app)/rigs/rig-detail.test.tsx`

**Interfaces :**
- Le chargeur de `rigs/[id]` lit `GET /api/rigs/:id`, `GET /api/racks?unassigned=true&rigConfigId=:id` et le catalogue d'équipements de la phase 2.

- [ ] **Step 1 :** écrire les tests `panels_tab_lists_and_creates` (l'assistant poste puis ouvre `/panels/:id`), `rig_detail_links_and_unlinks_rack` et `rig_detail_reorders_by_drag` (positions envoyées).
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: panels et détail de régie (copie arkyo)`.

---

### Task 11 : Front, dépendances de l'éditeur de panel

**Files :**
- Copy (inventaire §1.2, `/panels/:id`) :
  - `arkyo:components/editor-shell/topbar-actions-context.tsx` ;
  - `arkyo:components/synoptique/components/{synoptic-general-panel,synoptic-help-modal,synoptic-shortcuts-modal,remote-cursors-overlay}.tsx` ;
  - `arkyo:components/synoptique/hooks/use-live-cursors.ts` (décision 10) ;
  - `arkyo:lib/services/rack-validation.ts`.
- Modify : `web/package.json` (`zustand` à la version d'arkyo)
- Create : le chargeur de `web/src/app/(fullscreen)/panels/[id]/page.tsx`. Il lit le panel, les connecteurs avec leurs fonctions, les fonctions et `/api/site`, et refait les calculs `withDerivedHasNeutrikD`, `category` et `categories` de la page serveur d'arkyo. `panel-editor` reste `ComingSoon` jusqu'à la Task 12.
- Test : `web/src/app/(fullscreen)/panels/panel-loader.test.tsx`, `web/src/components/synoptique/hooks/use-live-cursors.test.ts`

- [ ] **Step 1 :** écrire les tests `loader_builds_editor_props_like_arkyo` (catégories et `hasNeutrikD` dérivés à l'identique), `live_cursors_make_no_network_call` et `loader_error_state_retry`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: dépendances de l'éditeur de panel (copie arkyo)`.

---

### Task 12 : Front, éditeur de panel

**Files :**
- Copy : `arkyo:app/(fullscreen)/panels/[id]/panel-editor.tsx`
- Modify : le chargeur de la Task 11 rend `PanelEditor`
- Test : `web/src/app/(fullscreen)/panels/panel-editor.test.tsx`

Topbar : le lockup « arkyo.io | Tenant » devient `StrataBrand`, suivi du nom du site (habillage Strata). Le reste garde la disposition d'arkyo.

- [ ] **Step 1 :** écrire les tests `place_connector_posts_slot`, `rename_panel_patches`, `resize_warns_and_clears_slots` (comportement d'arkyo), `neutrik_d_error_is_shown` et `sse_update_refreshes` (un évènement `panel_slot` recharge).
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: éditeur de panel (copie arkyo)`.

---

### Task 13 : Intégration et vérification

**Files :**
- Test : `crates/arkyo-server/tests/phase3_smoke.rs`
- Modify : `CLAUDE.md` (« État actuel »)
- Create : `docs/superpowers/plans/2026-11-06-phase-3-suivi.md` (points reportés)

**Interfaces :**
- Parcours HTTP sur base neuve :
  1. propriétaire, création d'un projet, d'un lieu et d'un rack de projet ;
  2. création d'un rack modèle (contenant) et d'un panel avec 3 slots ;
  3. création d'une régie, liaison du rack modèle ;
  4. un équipement du catalogue placé dans un slot ;
  5. suppression de l'équipement, refusée ;
  6. suppression du projet ;
  7. vérification que `/api/racks?templates=true` ne contient que le rack modèle ;
  8. sauvegarde du catalogue toujours valide.
- **Vérification visuelle (contrôleur)** dans le navigateur intégré, en clair et en sombre, en 1440 et 800 px : tableau de bord, projets, assistant, `/templates` (deux onglets), détail de régie, éditeur de panel. Disposition comparée au code d'arkyo, console sans erreur.

- [ ] **Step 1 :** écrire le parcours, attendu RED tant qu'une pièce manque.
- [ ] **Step 2 :** corriger les écarts, avec un test ciblé pour chacun.
- [ ] **Step 3 :** lancer `npm run build`, puis `cargo test --workspace`, clippy, `cargo fmt --all --check`, puis `cd web && npm test && npx tsc --noEmit` : tout doit passer.
- [ ] **Step 4 :** commit `test: parcours de bout en bout de la phase 3`, puis commit `docs: phase 3 livrée`.
