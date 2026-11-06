# Phase 4b — Éditeur projet : onglet Rack (élévations) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** remplacer le bouchon de l'onglet **Rack** de l'éditeur projet par la copie d'arkyo, avec l'habillage Strata. Sont concernés :
- les élévations FRONT, REAR, REAR_INTERIOR et SIDE ;
- le placement des équipements, panels et accessoires dans les U ;
- les emplacements fantômes et le panneau de propriétés d'emplacement ;
- la vue par emplacement ;
- les contrôles de construction et les exports du Rack.

**Architecture :**
- Serveur : les routes d'arkyo `POST/DELETE /api/racks/:id/slots`, `PATCH/DELETE /api/racks/:id/slots/:slotId`, `GET …/racks/:rackId/canvas-data`, `GET/PATCH /api/racks/:id/construction-checks` et `PATCH /api/racks/:id/canvas-position`. Elles publient sur les bus app et rack de la 4a.
- Front : les composants rack partagés avec l'éditeur de rack (`app/(app)/rigs/[id]/rack/[rackId]/_components/*`), l'onglet `rack/**` et ses exports.

**Spec et références :**
- [plan 4a](2026-11-06-phase-4a-editeur.md), dont les décisions 1 à 13 s'appliquent telles quelles à la 4b ;
- [inventaire de la phase 4](2026-11-06-phase-4-inventaire.md), §0.6, §0.18, §1.3, §8.2 « 4b » et annexes A, B et E ;
- [suivi 4a](2026-11-06-phase-4a-suivi.md) ;
- le code d'arkyo fait foi.

## Décisions propres à la 4b

1. **`NoGhost` (sync des slots fantômes)** : la route `slots` reprend le statut et le message exacts d'arkyo pour ce cas. La 4a avait mis provisoirement 409 (`GhostError`) ; on ajuste si arkyo diffère.
2. **`constructionChecks` vidé** : la colonne reçoit le texte JSON `null`, la réponse renvoie `[]` (inventaire §0.18). `DELETE /api/racks/:id/slots` écrit `[]`.
3. **`canvas-data`** : sans snapshots. La palette est faite des `TenantEquipment` actifs. Le filtre `rackAccessories` d'arkyo porte sur une colonne `category` que `TenantEquipment` n'a pas : on le reproduit en lisant la catégorie réelle et on le documente (inventaire §9.11).
4. **Exports Rack** : même règle qu'en 4a. Les bibliothèques sont embarquées, et aucun texte de marque « Arkyo » ne doit apparaître dans un export accessible. `design-export.ts:34` (CDN jsPDF) reste en 4d.
5. **Plafond de quantité** (suivi 4a) : le bouton « + » de la carte de contenant est plafonné à 999 dans cette sous-phase, avec un commentaire.

## Global Constraints

Celles du plan 4a, sans changement :
- `CLAUDE.md` ;
- migrations non modifiées (0004 contient déjà les tables) ;
- `db::begin_immediate` ;
- gardes `design:write` pour les écritures `/api/racks/:id/**` et `projects:write` pour celles sous les projets ;
- erreurs 400/404 au lieu des 500 implicites ;
- évènements app et rack d'arkyo avec leurs `meta` (`publish_meta`, `publish_rack`) ;
- `ClientPage`/`lazyPage` ;
- `COPIED_FILES` ;
- `git add` limité à ses propres chemins ;
- pas de push ni de tag sans accord ;
- très gros fichiers en deux commits : copie brute, puis retouches (décision 13).

## Review Focus

1. **Collisions dans le rack.** Poser un équipement sur des U occupés, ou hors des bornes (`totalU`, demi-largeurs), renvoie l'erreur d'arkyo, et rien n'est écrit. → test Task 1.
2. **Slots fantômes et inventaire restent cohérents.** Poser, déplacer ou retirer un slot met à jour l'inventaire et les fantômes, comme arkyo. Retirer un slot porteur de composants les retire aussi. → test Task 1.
3. **Suppression d'adaptateurs** liée aux slots (`removedAdapterIds`). Aucune connexion ni aucun adaptateur pendant ne subsiste. → test Task 1.
4. **Contrôles de construction.** Les opérations bascule, pose et effacement conservent le piège JSON `null` d'arkyo, et le flux par rack diffuse `construction_checks_updated`. → test Task 2.
5. **Rendu des quatre vues** (FRONT, REAR, REAR_INTERIOR, SIDE) avec des données réelles, sans erreur en console. → tests Tasks 4 et 5, puis contrôle visuel Task 9.

---

### Task 1 : Routes des slots

**Files :** Create `src/http/rack_slots.rs`. Test `tests/rack_slots.rs`.

**Interfaces :**
- `POST /api/racks/:id/slots` et `DELETE /api/racks/:id/slots` ;
- `PATCH /api/racks/:id/slots/:slotId` et `DELETE /api/racks/:id/slots/:slotId`.

Le détail est dans l'inventaire, annexe A. Ces routes produisent :
- les évènements rack `slot_added`, `slot_updated`, `slot_removed` et `rack_cleared` ;
- les évènements app `slot …` et `rack_inventory updated` ;
- la gestion des slots fantômes via `inventory::sync` ;
- `removedAdapterIds`.

Le catalogue est lu en local et le `clientId` est repris dans les `meta`.

- [ ] **Step 1 : Tests**
  - `place_equipment_in_free_units` ;
  - `collision_and_out_of_bounds_rejected_nothing_written` ;
  - `move_slot_updates_inventory_and_ghosts` ;
  - `remove_host_slot_removes_components` ;
  - `clear_rack_writes_empty_checks_and_event` ;
  - `removed_adapters_reported_and_deleted` ;
  - `consultation_cannot_write`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN (workspace, clippy, fmt), commit `feat: API des emplacements de rack (copie arkyo)`.

### Task 2 : `canvas-data`, contrôles de construction, position de canvas

**Files :** Create `src/http/projects/canvas_data.rs` et `src/http/rack_construction.rs`. Test `tests/rack_canvas.rs`.

**Interfaces :**
- `GET /api/tenant/projects/:id/racks/:rackId/canvas-data` (587 l., inventaire annexe B §2), sans snapshots, selon la décision 3 ;
- `GET` et `PATCH /api/racks/:id/construction-checks`, selon la décision 2, avec l'évènement rack `construction_checks_updated` ;
- `PATCH /api/racks/:id/canvas-position`.

- [ ] **Step 1 : Tests**
  - `canvas_data_shape_matches_arkyo`, comparé à une fixture écrite à la main à partir de la route d'arkyo ;
  - `construction_checks_toggle_set_clear_null_trap` ;
  - `construction_checks_event_on_rack_stream` ;
  - `canvas_position_patch`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: données de canvas et contrôles de construction (copie arkyo)`.

### Task 3 : Front, composants rack partagés

**Files :** copies d'arkyo (inventaire §8.2, 4b tâche 3), à savoir :
- `app/(app)/rigs/[id]/rack/[rackId]/_components/{rack-visual, side-rack-visual, panel-rack-visual, draggable-slot, draggable-items, draggable-bom-item, projected-slot, toast-stack, port-label-editor}` ;
- `_hooks/use-rack-bom` et `_shell/slot-context-menu` ;
- `components/synoptique/hooks/{use-rack-sync, use-confirm, use-toasts}` ;
- `components/synoptique/lib/{collision, panel-labels}` ;
- `components/synoptique/components/slot-properties-panel`, `use-catalog-lookup` et `lib/services/rack-inventory.ts` (client), avec ses tests Vitest d'arkyo.

Les bouchons temporaires de `slot-properties-panel` et de `port-label-editor` (4a) sont remplacés.

- [ ] **Step 1 : Tests**
  - `rack_visual_renders_four_views` (fumée) ;
  - `use_rack_sync_applies_slot_events` ;
  - les tests Vitest d'arkyo de `rack-inventory` et de `collision`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN (`npm test && npx tsc --noEmit && npm run build`), commit `feat: composants rack partagés (copie arkyo)`.

### Task 4 : Front, onglet Rack

**Files :** copies de `rack/rack-tab-client.tsx`, `rack/_components/{rack-tab-left-toolbar, rack-location-selector-dropdown, rack-location-info-panel, rack-tab-side-panel, rack-info-panel}`, `category-legend` et `rack-drag-eligibility`. Elles remplacent les bouchons de la 4a, et `rack-placement-canvas` reste un bouchon jusqu'à la Task 5. On vérifie aussi le câblage de `project-editor.tsx` (`RackTabRightPanel`, `RackTabSlotPropertiesWrapper`).

- [ ] **Step 1 : Tests**
  - `rack_tab_lists_racks_and_switches_view` ;
  - `slot_properties_patch_and_delete` ;
  - `project_sync_refreshes_on_slot_event`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: onglet Rack de l'éditeur projet (copie arkyo)`.

### Task 5 : Front, `rack-placement-canvas.tsx` (2 503 l.)

**Files :** copie seule de ce fichier, en deux commits : la copie brute, puis les retouches.

- [ ] **Step 1 : Tests**
  - `placement_canvas_mounts_with_real_data` (fumée) ;
  - `drop_equipment_posts_slot` (chemin d'arkyo, avec un `elementsFromPoint` simulé comme en 4a) ;
  - `ghost_slot_drag_to_unit`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commits `feat: copie brute de rack-placement-canvas.tsx (arkyo)`, `feat: retouches arkyo-server de rack-placement-canvas.tsx` puis `feat: canvas de placement du rack (copie arkyo)`.

### Task 6 : Front, vue par emplacement

**Files :** copie de `location-placement-canvas.tsx` (portée « par emplacement »). Le bouton « + » de la carte de contenant est plafonné à 999, avec un commentaire (décision 5).

- [ ] **Step 1 : Tests**
  - `location_scope_shows_all_racks_of_location` ;
  - `plus_button_capped_at_999`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: vue par emplacement de l'onglet Rack (copie arkyo)`.

### Task 7 : Front, exports Rack 1/2

**Files :** copies de `rack-export`, `rack-export-{layout,capture,stage}`, `export-cartouche-options`, `export-pdf-model-options`, `lib/print/{export-with-cartouche,render-print-layout}` et `lib/pdf/synoptic-export`. Aucun chargement CDN, aucun texte de marque Arkyo dans les exports accessibles.

- [ ] **Step 1 : Tests**
  - `rack_export_png_pdf_without_cdn` ;
  - `no_arkyo_brand_text_in_rack_export`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: exports de l'onglet Rack 1/2 (copie arkyo)`.

### Task 8 : Front, exports Rack 2/2

**Files :** copies de `rack-export-composer.tsx` (1 439 l.) et de `rack-export-{object,views}-panel`.

- [ ] **Step 1 :** écrire le test `composer_builds_pages_from_views`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: exports de l'onglet Rack 2/2 (copie arkyo)`.

### Task 9 : Intégration et vérification

**Files :** `tests/phase4b_smoke.rs`, `CLAUDE.md` (« État actuel »), `docs/superpowers/plans/2026-11-07-phase-4b-suivi.md`.

Le parcours HTTP suivant tourne sur une base neuve :
1. créer le projet, le lieu et le contenant de 24 U ;
2. remplir l'inventaire : 2 équipements, 1 panel, 1 hôte avec un composant ;
3. poser les éléments en FRONT et en REAR ;
4. vérifier qu'une collision est refusée ;
5. déplacer un slot ;
6. faire une bascule, une pose et un effacement des contrôles de construction ;
7. lire `canvas-data` ;
8. vider le rack ;
9. supprimer le contenant, sans aucun orphelin.

**Vérification visuelle (contrôleur)** : l'onglet Rack en clair et en sombre, à 1440 et à 800 px, avec les quatre vues, le placement, les propriétés, la vue par emplacement et un export. La console doit rester sans erreur.

- [ ] **Step 1 à 4 :** écrire le parcours (RED), corriger chaque écart avec un test ciblé, faire passer tous les contrôles, puis commits `test: parcours de bout en bout de la phase 4b` et `docs: phase 4b livrée`.
