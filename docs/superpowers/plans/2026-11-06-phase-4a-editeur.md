# Phase 4a — Éditeur projet : coquille, fiche, inventaire — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** ouvrir l'éditeur projet plein écran `/project/:id`, comme dans arkyo et avec l'habillage Strata. Il comprend :
- la coquille, avec ses onglets et ses topbars ;
- la fiche : panneau droit et dialogue « Caractéristiques » ;
- l'onglet **Inventaire** complet : lieux, contenants, catalogue, assistant d'ajout, composants, accessoires et exports de l'inventaire.

Les onglets Rack et Synoptique restent des bouchons jusqu'aux sous-phases 4b et 4c. Les onglets des phases 5 et 6 restent des bouchons aux chemins d'arkyo.

**Architecture :**
- La migration `0004_editeur.sql` crée les 15 tables de toute la phase 4 (inventaire de la phase 4, §4 et annexe D). Le bus temps réel gagne un flux SSE par rack.
- Les routes d'inventaire d'arkyo (`tenant/projects/:id/racks/**`, `locations/:id`, `inventaire/catalog`, `tenant/racks`) sont réécrites en Rust, avec la logique de `rack-inventory*` et de `rack-clone`.
- La page serveur `/project/:id` devient un `ClientPage`. Elle lit une route d'extension, `GET /api/tenant/projects/:id/editor`.
- Le front copie `project-editor.tsx`, puis `_editor/*` et `inventaire/**`.

**Tech Stack :** Rust (axum, sqlx/SQLite), React 19 + Vite, Vitest. Trois dépendances npm, aux versions d'arkyo : `@radix-ui/react-{dropdown-menu,context-menu,tabs}`. Trois bibliothèques chargées par CDN dans arkyo sont embarquées : jsPDF, html-to-image, svg2pdf.js.

**Specs et référence :**
- [spec](../specs/2026-10-26-arkyo-server-design.md), §4.5, §4.7, §6 et §9 ;
- **inventaire de la phase 4** : [`2026-11-06-phase-4-inventaire.md`](2026-11-06-phase-4-inventaire.md), à lire dans les sections citées par chaque tâche ;
- le code d'arkyo fait foi.

## Découpage de la phase 4 (inventaire §8.2)

| Sous-phase | Contenu | Tâches |
|---|---|---|
| **4a** (ce plan) | migration 0004, SSE par rack, coquille, fiche, inventaire | 13 |
| 4b | onglet Rack (élévations FRONT/REAR/REAR_INTERIOR/SIDE), slots, `canvas-data`, contrôles de construction, exports Rack | 9 |
| 4c | synoptique : routes par rack, connexions, renumérotation, `general`/`location`, audit, `synoptic-view.tsx` | 14 |
| 4d | éditeur de rack (`/racks/:rackId`, `/rigs/:id/rack/:rackId`, sous-routes projet), inventaire de modèle, construction | 10 |

Chaque sous-phase a son propre plan, écrit au moment de la lancer, et se termine par une parité vérifiée et une CI verte.

## Décisions de la phase 4

Elles valent pour 4a à 4d (inventaire §9).

1. **Bouchons aux chemins d'arkyo** (inventaire §1.4) :
   - `project-editor.tsx` reste une copie conforme ;
   - chaque module des phases 5 et 6 qu'il importe existe sous forme de bouchon : mêmes exports, `ComingSoon` dans la coquille, en-tête `// arkyo-server: bouchon phase N, remplacé par la copie d'arkyo` ;
   - les bouchons sont exclus de `COPIED_FILES` ;
   - des bouchons temporaires couvrent les onglets Rack (4b) et Synoptique (4c).
2. **`cabling/**`** (Préparation) passe en phase 6, avec `estimateCableLength` en Rust (inventaire §0.1).
3. **Routes sans appelant** (≈ 2 645 l., inventaire §0.7) : non portées, notées au suivi. Les 15 tables sont créées dans tous les cas.
4. **Gardes serveur alignées sur l'UI**, dans la continuité de la phase 3 :
   - `projects:write` pour les écritures sous `/api/tenant/projects/:id/**` ;
   - `design:write` pour les écritures `/api/racks/:id/**` et `/api/tenant/racks` ;
   - les lectures demandent seulement une session ;
   - chaque garde porte le commentaire `// arkyo-server: garde serveur alignée sur l'UI`.
5. **Pas d'erreur 500 implicite** : un JSON invalide donne 400, un id absent donne 404, avec les messages d'arkyo quand il en a. C'est aussi le cas de l'audit quand `limit` n'est pas numérique.
6. **Bibliothèques CDN embarquées** aux versions CDN d'arkyo : jsPDF 2.5.1, html-to-image 1.11.13, svg2pdf.js 2.2.3. Chaque changement porte le commentaire `// arkyo-server: bundlé (hors ligne)`. Si deux versions de jsPDF sont nécessaires (4d, `construction-export-pdf.ts` en ^4.2.1), on utilise un alias npm.
7. **Évènements du catalogue** : parité. Les éditeurs écoutent `catalog` et `signal`, que le serveur local n'émet pas. Comme dans arkyo pour le catalogue perso, une modification du catalogue ne rafraîchit pas un éditeur ouvert. `/api/admin/signals*` n'est donc jamais appelé.
8. **Sous-routes orphelines** `/project/:id/inventaire/{rack/:rackId,synoptique}` : portées en 4d (même `RackEditor`).
9. **`catalogCableModelId` = `TenantCableModel.id`.** La garde d'usage passe du câble au modèle de câble en 4c (correction d'un défaut d'arkyo, commentée).
10. **Index** sur `RackConnection(rackId)`, `(fromSlotId)`, `(toSlotId)` : ajoutés dans 0004 et documentés comme écart de performance.
11. **Écarts de parité des annexes** (inventaire §9.11) : reproduits, sauf ceux que la décision 5 couvre.
12. **SaaS retiré** (inventaire §7) :
    - snapshots (`update-snapshot-modal`, `use-catalogue-drift`, `resolve*` → lecture directe) ;
    - `mainDb` → tables locales ;
    - nom du tenant → nom du site et `StrataBrand` ;
    - `assertNotGhost` (no-op).

    Le mot « snapshot » de l'undo/redo du synoptique et les « slots fantômes » ne sont **pas** du SaaS.
13. **Très gros fichiers** (inventaire §8.3) :
    - une tâche chacun ;
    - un commit de copie brute (`cp`), puis un commit qui ne contient que les retouches `// arkyo-server:` ;
    - toutes leurs dépendances sont portées avant ;
    - un test de fumée au montage.

## Global Constraints

- **Contraintes de `CLAUDE.md` :**
  - copie, retrait du SaaS commenté, habillage Strata commenté, jamais de reformatage ;
  - API identique à arkyo ;
  - tables nommées comme les modèles Prisma ;
  - migrations additives ;
  - couleurs d'interface en variables, couleurs métier inchangées ;
  - pour un texte d'accent sur fond teinté, `--accent-strong`.
- **Migration** : nouvelle migration `0004_editeur.sql`. `0001` à `0003` ne sont jamais modifiées, en-têtes compris, car sqlx contrôle leur somme.
- **Transactions d'écriture** : `db::begin_immediate`, seul point d'entrée (un test interdit `.begin()`).
- **Chaque route d'écriture**, dans cet ordre :
  1. session et permission (décision 4) ;
  2. validation, avec le format d'erreur d'arkyo de la route : `flatten()` ou `"Validation invalide"` + `issues` ;
  3. transaction ;
  4. audit si arkyo en écrit ;
  5. évènements d'arkyo, app et rack, avec leurs `meta` ;
  6. JSON d'arkyo.
- **Front** :
  - pages en `lazyPage` dans `web/src/router.tsx` ;
  - chargeurs `ClientPage`, avec `LoadingState` et un état d'erreur proposant « Réessayer » ;
  - tests avec `signedInApi()` / `emitAppEvent` ;
  - `COPIED_FILES` de `theme-sweep.test.ts` à jour ;
  - `git add` limité à ses chemins.
- **Git** : pas de push ni de tag sans accord de Damien.

## Review Focus

1. **Suppression en cascade.** Supprimer un lieu, un contenant ou un projet ne laisse ni slot fantôme orphelin, ni connexion pendante, ni inventaire sans rack. Les contenants modèles partagés sont conservés. → tests Tasks 1, 4 et 5.
2. **Inventaire concurrent.** Deux ajouts simultanés sur un même contenant donnent des libellés uniques (`#XXXX` d'`auto-label`), sans 500. → test Task 3.
3. **Références de catalogue invalides.** Un équipement inactif, inexistant, un adaptateur ou un panel inconnu reçoivent les erreurs de `validateInventoryRef` (24 cas d'arkyo), rien n'est écrit. → test Task 3.
4. **Éditeur sur un projet vide ou rempli.** Un projet sans lieu, ou un lieu sans contenant, s'ouvre sans erreur. Un projet de plusieurs centaines d'items s'ouvre en moins de 2 s sur la route `editor`. → tests Tasks 7 et 13.
5. **Garde d'usage active.** Un câble ou un adaptateur référencé par `RackConnection` ou `SynopticAdapter` ne se supprime plus (409 de la phase 2). → test Task 1.

---

### Task 1 : Migration 0004

**Files :** Create `crates/arkyo-server/migrations/0004_editeur.sql`. Modify `tests/catalogue_cables.rs:517-548`, dont les tables factices entrent en conflit avec les vraies (inventaire §0.16). Test `tests/editor_schema.rs`.

**Interfaces :** les 15 tables et l'enum `ExternalPortKind` (`TEXT CHECK`) de l'inventaire §4 et de l'annexe D, avec les colonnes, défauts, `ON DELETE` et index d'arkyo, plus les index de la décision 10. Les `snapshotId` sont nullables et toujours `NULL`.

- [ ] **Step 1 : Tests**
  - `editor_tables_exist_with_defaults` ;
  - `rack_delete_cascades_editor_rows` : zones, labels, bundles, connexions, adaptateurs, ports externes et lignes de panel disparaissent avec le rack ;
  - `cable_and_adapter_in_use_guards_active` : 409 ;
  - `older_binary_tolerates_0004`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN (workspace, clippy, fmt), commit `feat: schéma de l'éditeur projet (0004)`.

### Task 2 : Bus SSE par rack

**Files :** Modify `src/events.rs` (`publish_rack`). Create `src/http/rack_events.rs` (`GET /api/racks/:id/events`). Test `tests/rack_events.rs`.

**Interfaces :** le protocole exact de l'inventaire, annexe A §3.1 :
- commentaire `: connected` à l'ouverture ;
- ni battement de cœur ni filtre `clientId` ;
- 401 et 404 en texte brut ;
- évènements `{type, …}` des 21 types (annexe A §3.3).

Arrêt propre à la fermeture du serveur, comme `/api/events`.

- [ ] **Step 1 : Tests**
  - `rack_stream_receives_only_its_rack` ;
  - `rack_stream_401_404_plain_text` ;
  - `rack_stream_closes_on_shutdown`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: flux temps réel par rack`.

### Task 3 : Services Rust de l'inventaire

**Files :** Create `src/inventory/{validate,sync,auto_label,api,catalog}.rs`. Modify `src/catalogue/enrich.rs` (`fetch_catalog_adapter_map`). Test `tests/inventory_services.rs`.

**Interfaces** (inventaire §5 et annexe D PARTIE 2) :
- `validate::validate_inventory_ref(conn, &Ref) -> Result<(), RefError>`, avec les 24 cas d'arkyo ;
- `sync` : slots fantômes, comme `rack-inventory-sync.ts` ;
- `auto_label::generate_unique_label`, au format `#XXXX` ;
- `api`, version locale de `rack-inventory-api.ts` ;
- `catalog`, version mono-source de `catalog-merge` (catalogue local seul).

- [ ] **Step 1 : Tests**
  - les 24 cas de `validateInventoryRef`, repris des tests Vitest d'arkyo ;
  - `ghost_slots_follow_inventory` ;
  - `auto_labels_unique_under_concurrency` ;
  - `adapter_map_enriches_like_arkyo`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: services de l'inventaire (Rust)`.

### Task 4 : Route d'inventaire d'un contenant

**Files :** Create `src/http/projects/inventory.rs`. Test `tests/project_inventory.rs`.

**Interfaces :** `GET/POST /api/tenant/projects/:id/racks/:rackId/inventory`, les 1 243 l. d'arkyo (inventaire, annexe B) :
- dédoublonnage ;
- composants modulaires (`hostItemId`, `hostSlotIndex`) ;
- slots fantômes ;
- évènements `rack_inventory updated` avec `projectId` et `rackId`.

Sans `getOrCreateSnapshot`, avec le catalogue lu en direct.

- [ ] **Step 1 : Tests**
  - `add_equipment_creates_item_and_ghost_slot` ;
  - `add_component_into_host` ;
  - `duplicate_add_merges_quantity_like_arkyo` ;
  - `invalid_ref_is_rejected_nothing_written` ;
  - `consultation_cannot_write`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: API inventaire d'un contenant (copie arkyo)`.

### Task 5 : Routes d'inventaire annexes

**Files :** Create `src/http/projects/{inventory_item,locations_item,racks_item}.rs` et `src/http/tenant_racks.rs`. Test `tests/project_inventory_misc.rs`.

**Interfaces** (inventaire §3.2 et annexe B) :
- `PATCH/DELETE …/inventory/:itemId` et `transfer` ;
- `PATCH/DELETE /api/tenant/projects/:id/racks/:rackId` ;
- `POST …/racks/reorder` ;
- `PATCH/DELETE …/locations/:locationId` ;
- `GET /api/tenant/inventaire/catalog` et `GET …/projects/:id/inventaire/catalog` ;
- `GET /api/tenant/racks` (`?templates=true` filtre `ACTIF`).

- [ ] **Step 1 : Tests**
  - `transfer_item_between_racks` ;
  - `reorder_racks_positions` ;
  - `delete_location_deletes_its_virtual_and_own_racks` ;
  - `catalog_lists_active_local_items` ;
  - `tenant_racks_templates_only_actif`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: API inventaire, lieux et contenants (copie arkyo)`.

### Task 6 : Clonage de contenants

**Files :** Create `src/inventory/clone.rs`. Il est mutualisé avec `clone_rack` (`src/http/racks.rs:310`) et avec la branche `fromTemplateId` de la phase 3. Routes `…/racks/save-as-template` et `…/racks/clone-from-template`. Test `tests/rack_clone.rs`.

**Interfaces :** `clone_rack_into(conn, source_rack_id, target) -> Result<NewRack>`, sur le modèle de `rack-clone.ts`. Les ids sont neufs, et ces références sont remappées :
- les slots et leurs parents ;
- l'inventaire et les hôtes ;
- les zones, labels, bundles, adaptateurs et ports externes ;
- les connexions ;
- les guides.

- [ ] **Step 1 : Tests**
  - `save_as_template_then_clone_roundtrip_identical` (comparaison normalisée) ;
  - `clone_remaps_every_reference` ;
  - la branche `fromTemplateId` de la phase 3 garde ses tests verts.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: clonage de contenants (copie arkyo)`.

### Task 7 : Route `editor` (données de la page serveur)

**Files :** Create `src/http/projects/editor.rs`. Test `tests/project_editor_data.rs`.

**Interfaces :** `GET /api/tenant/projects/:id/editor` renvoie exactement `ProjectEditorData` (`arkyo:app/(fullscreen)/project/[id]/_components/project-editor.tsx:207-231`), tel que `page.tsx` le construit (inventaire §1.1), avec :
- les libellés français des accessoires (« Plaque pleine 2U »…) ;
- la couleur de catégorie du BOM ;
- le dédoublonnage des `RigRack` ;
- `constructionChecks` réduit à un compte ;
- `cartographie.maps = []`.

Le tout porte le commentaire `// arkyo-server: données de la page serveur d'arkyo`.

- [ ] **Step 1 : Tests**
  - `editor_data_shape_matches_arkyo` : un projet avec 2 lieux, 3 contenants, des équipements, des panels, des adaptateurs et des accessoires ; le JSON est comparé à une fixture construite à la main depuis `page.tsx` ;
  - `empty_project_opens` ;
  - `large_project_under_2s` : 500 items.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: données de l'éditeur projet`.

### Task 8 : Front, socle de l'éditeur

**Files :**
- `web/package.json` : Radix aux versions d'arkyo, plus jsPDF, html-to-image et svg2pdf.js embarqués (décision 6) ;
- copies de `lib/client-id.ts`, de `components/editor-shell/*` (coquille) et de `components/synoptique/lib/{types,constants,colors}.ts` ;
- route plein écran `project/:id` en `ClientPage`, avec la garde `projects:read` et `ConfirmProvider` (layout d'arkyo), qui lit la route `editor` ;
- tests du chargeur.

- [ ] **Step 1 :** écrire les tests `editor_loader_renders_shell`, `editor_loader_error_retry` et `client_id_header_sent`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN (`npm test && npx tsc --noEmit && npm run build`), commit `feat: socle de l'éditeur projet (copie arkyo)`.

### Task 9 : Front, coquille de l'éditeur

**Files :**
- copies de `_components/project-editor.tsx` (commit brut puis commit de retouches), de `_editor/*` et de `fiche/fiche-client.tsx` ;
- les 17 bouchons des phases 5 et 6, plus les bouchons temporaires Rack et Synoptique (inventaire §1.4) ;
- la topbar en habillage Strata : `StrataBrand` suivi du nom du site.

- [ ] **Step 1 :** écrire les tests :
  - `tabs_navigate_and_persist` (`?tab=` et `localStorage`) ;
  - `fiche_dialog_patches_project` ;
  - `status_change_patches` ;
  - `phase5_6_tabs_show_coming_soon` ;
  - `tab_fiche_maps_to_inventaire`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: coquille de l'éditeur projet (copie arkyo)`.

### Task 10 : Front, inventaire 1/3

**Files :** copies d'`inventaire-client`, d'`inventaire-scope` (dérive retirée), des barres d'outils, du panneau latéral, du sélecteur et des fiches de lieu, de l'aide et des raccourcis.

Ces fichiers sont branchés dans la coquille à la place du bouchon Inventaire, s'il y en a un.

- [ ] **Step 1 :** écrire les tests `inventory_lists_locations_and_racks`, `add_location`, `rename_and_delete_location` et `project_sync_refreshes_on_rack_inventory_event`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: inventaire du projet 1/3 (copie arkyo)`.

### Task 11 : Front, inventaire 2/3

**Files :** copies de `catalog-panel` (1 490 l.), d'`add-container-wizard` (2 645 l., commit brut puis commit de retouches), de `template-selector` et de `component-config-modal`.

- [ ] **Step 1 :** écrire les tests `catalog_panel_adds_equipment`, `add_container_wizard_creates_rack` (le chemin d'arkyo, avec un contenant modèle via `clone-from-template`) et `component_config_places_component`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: inventaire du projet 2/3 (copie arkyo)`.

### Task 12 : Front, inventaire 3/3 et exports

**Files :**
- les composants de carte et de propriétés de `rack-card-canvas` (sans `update-snapshot-modal`), `rack-mini-svg`, `slot-ruler`, `container-sheet-card`, `equipment-card`, `accessory-face` ;
- les exports de l'inventaire : `inventaire-export`, `bom-table`, `bom-pdf`, `export-menu`, `reseau/_components/shared/export-{capture,pdf}`, `lib/export/*`, `lib/print/technical-frame`, `technical-table-pdf`.

Le détail est à l'inventaire §8.2, tâche 12.

- [ ] **Step 1 :** écrire les tests :
  - `item_properties_patch` ;
  - `transfer_and_delete_item` ;
  - `bom_export_builds_rows` : XLSX/CSV via les bibliothèques embarquées ;
  - `pdf_export_uses_bundled_jspdf` : aucun chargement CDN.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: inventaire du projet 3/3 et exports (copie arkyo)`.

### Task 13 : Intégration et vérification

**Files :** `tests/phase4a_smoke.rs`, `CLAUDE.md` (« État actuel »), `docs/superpowers/plans/2026-11-06-phase-4a-suivi.md`.

**Parcours HTTP** sur une base neuve :
1. créer le projet par les trois appels de l'assistant ;
2. ajouter un deuxième lieu ;
3. ajouter des équipements, un panel, un adaptateur et un accessoire au contenant ;
4. ajouter un composant dans un hôte ;
5. transférer un item ;
6. sauver le contenant comme modèle, puis le cloner dans le projet ;
7. vérifier que `GET …/editor` est cohérent ;
8. vérifier que supprimer le câble ou l'adaptateur utilisé renvoie 409 ;
9. supprimer le lieu, puis le projet, sans aucun orphelin.

**Vérification visuelle (contrôleur)** : l'éditeur en clair et en sombre, à 1440 et à 800 px ; inventaire, fiche, onglets en `ComingSoon` ; console sans erreur.

- [ ] **Step 1 à 4 :** parcours en RED, écarts corrigés avec un test ciblé chacun, tous les contrôles verts, commits `test: parcours de bout en bout de la phase 4a` puis `docs: phase 4a livrée`.
