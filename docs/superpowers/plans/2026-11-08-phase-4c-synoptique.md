# Phase 4c — Éditeur projet : synoptique, câblage et numérotation, audit — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** remplacer le bouchon de l'onglet **Synoptique** de l'éditeur projet par la copie d'arkyo, habillée Strata. Le synoptique couvre :
- la vue générale (tous les lieux) et la vue par lieu ;
- le câblage par connexions, les adaptateurs, les bundles, les zones, les étiquettes, les ports externes et les lignes de panel ;
- la validation (11 contrôles), l'undo/redo et la multi-sélection ;
- la renumérotation des câbles ;
- le panneau d'audit ;
- les exports PNG et PDF.

**Architecture :**
- **Serveur :** on porte les routes par rack `/api/racks/:id/{zones,labels,bundles,external-ports,panel-rows,adapters,connections,renumber,audit}`. On porte aussi les routes du synoptique projet `general`, `location/:locationId`, `connections` et `connections/renumber`, et `GET …/projects/:id/audit`. Le calcul `computeCableLabel` et le service `synoptic-focus-payload` sont réécrits en Rust, avec des fixtures partagées.
- **Front :** on copie le socle `editor-shell` du synoptique, les composants, puis `synoptic-view.tsx` (14 023 l.), l'onglet et ses exports.

**Références :**
- plans [4a](2026-11-06-phase-4a-editeur.md) (décisions 1 à 13) et [4b](2026-11-07-phase-4b-rack.md) ;
- [inventaire de la phase 4](2026-11-06-phase-4-inventaire.md) : §0.7, §0.11, §0.17, §5, §6, §8.2 « 4c », §8.3, annexes A, C et D ;
- suivis [4a](2026-11-06-phase-4a-suivi.md) et [4b](2026-11-07-phase-4b-suivi.md) ;
- en cas de doute, le code d'arkyo fait foi.

## Décisions propres à la 4c

1. **Routes mortes du synoptique projet** (inventaire §0.7) : non portées. Cela couvre `adapters`, `bundles`, `labels`, `zones`, `layout`, `canvas-data`, `focus`, le GET de `connections` et les guides. La vue par lieu passe par les routes **par rack**, comme dans arkyo.
2. **`catalogCableModelId` = `TenantCableModel.id`** (décision 9 de la 4a). La garde d'usage passe du câble au modèle de câble, avec un commentaire qui signale la correction d'un défaut d'arkyo. Les tests de phase 2 et de 4a qui mettaient un `TenantCable.id` sont réécrits.
3. **Numérotation** : `computeCableLabel` est porté en Rust. Les cas de `web/src/lib/services/cable-numbering.test.ts` (déjà copié) deviennent des fixtures JSON lues par le test Rust et par le test Vitest. Les deux implémentations doivent donner exactement les mêmes libellés.
4. **Guides du synoptique** : ils restent en `localStorage`, comme dans arkyo. `clone-from-template` ne les copie pas.
5. **Évènements du catalogue** : on garde la parité (4a, décision 7). Les entités `catalog`, `signal` et `signal_category` ne sont pas émises et `/api/admin/signals*` n'est pas appelé, ni porté.
6. **Audit** : `GET /api/racks/:id/audit` et `GET /api/tenant/projects/:id/audit`, avec l'union d'arkyo (Project, Rack, RackConnection, ProjectConnection). Un `limit` non numérique renvoie 400 (4a, décision 5). `audit-format` est copié tel quel.
7. **`synoptic-view.tsx`** : copie brute, puis un commit de retouches seules (décision 13 de la 4a). La relecture porte sur les retraits, les couleurs d'interface en dur et les `fetch` vers des routes absentes. Le mot « snapshot » y désigne l'undo/redo et n'est pas du SaaS.

## Global Constraints

On garde celles des plans 4a et 4b :
- `CLAUDE.md` ;
- migrations 0001 à 0004 intactes ;
- `db::begin_immediate` ;
- gardes `design:write` / `projects:write` ;
- erreurs 400 et 404 explicites ;
- évènements app et rack d'arkyo, avec leurs `meta` ;
- `ClientPage` et `lazyPage` ;
- `COPIED_FILES` ;
- règles `--accent-strong` et `--danger-text` ;
- pas de CDN ni de marque Arkyo dans les exports ;
- `git add` limité à ses chemins ;
- pas de push ni de tag sans accord ;
- les fichiers de plus de 1 500 lignes se commitent en deux temps : copie brute, puis retouches.

## Review Focus

1. **Suppressions en cascade du synoptique.** Supprimer un slot, un adaptateur, une zone ou un rack ne laisse ni connexion pendante, ni membre de bundle orphelin, ni étiquette sans cible. → tests des Tasks 1 à 3.
2. **Renumérotation stable.** Relancer la renumérotation sur des câbles déjà numérotés ne change aucun libellé. Les libellés en Rust et en TS sont identiques sur toutes les fixtures. → test de la Task 4.
3. **Connexions invalides.** Un port inexistant, un composant hors de son hôte ou un câble entre deux projets est refusé avec le message d'arkyo, et rien n'est écrit. → tests des Tasks 3 et 7.
4. **Validation (11 contrôles), undo/redo et multi-sélection** sur un vrai projet. → tests de la Task 12 et contrôle visuel de la Task 14.
5. **Grande vue générale.** Un projet de 10 racks et 300 connexions s'ouvre en moins de 2 s côté serveur. → test de la Task 6.

---

### Task 1 : Routes par rack, objets 1/2 (zones, étiquettes, bundles)

**Files :** create `src/http/rack_objects.rs`. Test : `tests/rack_objects.rs`.

**Interfaces :** CRUD `/api/racks/:id/{zones,labels,bundles}` et `/…/:objectId` (inventaire, annexe A), avec :
- l'id fourni par le client quand arkyo l'accepte ;
- les évènements rack `zone_*`, `label_*`, `bundle_*` et les évènements app `rackZone`, `rackLabel`, `cableBundle`, avec leurs `meta` ;
- l'audit quand arkyo en écrit.

- [ ] **Step 1 :** écrire les tests :
  - `zone_crud_and_events` ;
  - `label_crud_and_events` ;
  - `bundle_members_validated_and_cascade` ;
  - `consultation_cannot_write`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: zones, étiquettes et bundles par rack (copie arkyo)`.

### Task 2 : Routes par rack, objets 2/2 (ports externes, lignes de panel, adaptateurs)

**Files :** create `src/http/rack_objects2.rs`. Test : `tests/rack_objects2.rs`.

**Interfaces :**
- `/api/racks/:id/external-ports(/:externalId)`, où `kind` vaut INTER_LIEU ou MONDE ;
- `GET /api/racks/:id/panel-rows`, qui purge comme arkyo ;
- `/api/racks/:id/adapters(/:adapterId)`, avec `fetch_catalog_adapter_map` et la garde d'usage.

- [ ] **Step 1 :** écrire les tests :
  - `external_port_kinds` ;
  - `panel_rows_get_purges_like_arkyo` ;
  - `adapter_crud_enriched` ;
  - `adapter_delete_cascades_connections`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: ports externes, lignes de panel et adaptateurs par rack (copie arkyo)`.

### Task 3 : Connexions par rack

**Files :** create `src/http/rack_connections.rs`. Test : `tests/rack_connections.rs`.

**Interfaces :**
- `GET`, `POST` (lot) et `DELETE` (lot) `/api/racks/:id/connections` ;
- `PATCH` et `DELETE /api/racks/:id/connections/:connId`.

Elles reprennent :
- la validation des composants de `racks/[id]/connections/route.ts:51-68` ;
- le comportement d'arkyo pour le label `null` au PATCH (parité, inventaire §9.11) ;
- `catalogCableModelId`, conformément à la décision 2 ;
- les évènements rack `connection_*` et app `rackConnection`.

- [ ] **Step 1 :** écrire les tests :
  - `batch_create_and_delete` ;
  - `component_port_validation` ;
  - `invalid_port_rejected_nothing_written` ;
  - `cable_model_in_use_guard` (décision 2).
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: connexions par rack (copie arkyo)`.

### Task 4 : Numérotation (Rust) et renumérotation par rack

**Files :** create `src/numbering/cable_label.rs`, `tests/fixtures/cable-numbering.json`, `src/http/rack_renumber.rs`. Modify `web/src/lib/services/cable-numbering.test.ts` pour qu'il lise les fixtures. Test : `tests/cable_numbering.rs`.

**Interfaces :**
- `compute_cable_label(...)` produit les mêmes libellés que `computeCableLabel` (`lib/services/cable-numbering.ts:541-580`) ;
- `POST /api/racks/:id/renumber` (472 l.) gère l'ordre, la fusion de la configuration, `normCode` et `getConnectorInfo`.

- [ ] **Step 1 :** écrire les tests :
  - `labels_match_shared_fixtures`, avec les mêmes fixtures en Vitest ;
  - `renumber_is_stable_on_second_run` ;
  - `renumber_respects_override_and_cable_code`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN (workspace et web), commit `feat: numérotation des câbles (Rust, fixtures partagées)`.

### Task 5 : Charge utile du focus et vue par lieu

**Files :** create `src/synoptic/focus_payload.rs`, `src/http/projects/synoptic_location.rs`. Test : `tests/synoptic_location.rs`.

**Interfaces :**
- `synoptic-focus-payload` (762 l.), dont le chargement est séparé du calcul (`enrichRackPayload` pur) ;
- `GET /api/tenant/projects/:id/synoptic/location/:locationId`.

- [ ] **Step 1 :** écrire les tests :
  - `location_payload_shape_matches_arkyo`, comparé à une fixture écrite à la main ;
  - `enrich_rack_payload_pure_cases`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: vue par lieu du synoptique (copie arkyo)`.

### Task 6 : Vue générale

**Files :** create `src/http/projects/synoptic_general.rs`. Test : `tests/synoptic_general.rs`.

**Interfaces :** `GET /api/tenant/projects/:id/synoptic/general` (615 l.), qui renvoie `locations: []` quand il n'y a aucun rack, comme dans arkyo. Elle lit `ProjectCableBundle`.

- [ ] **Step 1 :** écrire les tests :
  - `general_payload_shape_matches_arkyo` ;
  - `empty_project_general` ;
  - `large_project_under_2s` (10 racks et 300 connexions).
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: vue générale du synoptique (copie arkyo)`.

### Task 7 : Connexions projet, renumérotation projet et audit

**Files :** create `src/http/projects/synoptic_connections.rs` et `src/http/audit_read.rs`. Test : `tests/synoptic_connections.rs`.

**Interfaces :**
- `POST`, `PATCH` et `DELETE` `…/synoptic/connections(/:id)`. Un câble intra-rack donne 404, comme dans arkyo ;
- `…/connections/renumber` (316 l.), qui réutilise la Task 4 ;
- `GET /api/racks/:id/audit` et `GET …/projects/:id/audit`, selon la décision 6.

- [ ] **Step 1 :** écrire les tests :
  - `inter_rack_connection_crud` ;
  - `intra_rack_is_404_like_arkyo` ;
  - `project_renumber_stable` ;
  - `audit_union_and_limit`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: connexions projet, renumérotation et audit (copie arkyo)`.

### Task 8 : Front, socle du synoptique

**Files :** copies de
- `components/editor-shell/{left-toolbar, right-panel, contextual-topbar, slide-over-panel, cursor-hint, floating-context-menu, tools-synoptic, synoptic-actions-bar, hooks/*}` ;
- `components/synoptique/lib/{cable-paths, cabling-api, connection-devirt, external-ports, fit-all, grid, scene-descriptor, snapshot-sync}` ;
- `hooks/{use-synoptic-history, use-validation-report, use-cable-lane-offsets}` ;
- `audit-format`, avec le test d'arkyo s'il existe.

On saute les fichiers déjà portés.

- [ ] **Step 1 :** écrire les tests :
  - `history_undo_redo` ;
  - `validation_report_11_checks`, avec les tests d'arkyo de `rack-validation` copiés ;
  - `audit_format_cases`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: socle du synoptique (copie arkyo)`.

### Task 9 : Front, composants du synoptique 1/2

**Files :** copies des 9 panneaux de propriétés, de `synoptic-label-{toolbar,input}`, `zone-color-picker`, `incompat-tooltip`, `drawing-hint`, `toasts` et des dialogues `empty-info`, `decable` et `clear-labels`.

- [ ] **Step 1 :** écrire le test de fumée `property_panels_render_with_real_data`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: composants du synoptique 1/2 (copie arkyo)`.

### Task 10 : Front, composants du synoptique 2/2

**Files :** copies de `synoptic-layers-panel` (726 l.), `mini-map`, `rulers`, `adapter-node` / `adapter-picker`, `port-adapter-picker`, `cable-model-dialog` / `cable-model-picker`, `bundles-section`, `synoptic-renumber-dialog` (777 l.), `validation-panel` et `audit-panel`.

- [ ] **Step 1 :** écrire les tests :
  - `renumber_dialog_posts_and_shows_result` ;
  - `audit_panel_lists_entries` ;
  - `cable_model_picker_uses_cable_models`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: composants du synoptique 2/2 (copie arkyo)`.

### Task 11 : Front, `synoptic-view.tsx` (14 023 l.)

**Files :** copie seule, en deux commits (décision 7). Toutes les dépendances doivent déjà être portées : si l'une manque, elle est ajoutée ici dans un commit séparé.

- [ ] **Step 1 :** écrire les tests :
  - `synoptic_view_mounts_without_console_error` (fumée, données réelles d'un rack) ;
  - `draw_cable_posts_connection` ;
  - `rack_stream_updates_view`.
- [ ] **Step 2 à 5 :** RED, copie brute, retouches, GREEN, commits `feat: copie brute de synoptic-view.tsx (arkyo)`, `feat: retouches arkyo-server de synoptic-view.tsx` et `feat: vue synoptique (copie arkyo)`.

### Task 12 : Front, onglet Synoptique

**Files :** copies de `synoptique-tab-client` (1 465 l.), `general-canvas` (901 l.), `location-canvas` (986 l.), `general-info-panel`, `general-properties-panels` et `synoptique-rack-selector`. Elles remplacent le bouchon de la 4a.

- [ ] **Step 1 :** écrire les tests :
  - `general_view_lists_locations_and_racks` ;
  - `location_view_uses_per_rack_routes` ;
  - `multi_select_and_undo_redo` ;
  - `validation_panel_shows_checks`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: onglet Synoptique de l'éditeur projet (copie arkyo)`.

### Task 13 : Front, exports du synoptique

**Files :** copies de `_components/project-view-export`, `export-live-page`, `lib/pdf/{synoptic-cards,synoptic-vector}` et `lib/export/{svg-inline-styles,synoptic-capture}`. `pending-export-store` est déjà porté. Ni CDN, ni marque Arkyo.

- [ ] **Step 1 :** écrire les tests `synoptic_export_png_pdf_without_cdn` et `no_arkyo_brand_text_in_synoptic_export`.
- [ ] **Step 2 à 5 :** RED, implémenter, GREEN, commit `feat: exports du synoptique (copie arkyo)`.

### Task 14 : Intégration et vérification

**Files :** `tests/phase4c_smoke.rs`, `CLAUDE.md` (« État actuel ») et `docs/superpowers/plans/2026-11-08-phase-4c-suivi.md`.

**Parcours HTTP**, sur une base neuve :
1. créer un projet avec 2 lieux et 3 racks remplis ;
2. créer des zones, des étiquettes, un bundle, un adaptateur et un port externe ;
3. câbler en intra-rack, puis en inter-rack (projet) ;
4. renuméroter deux fois sans que rien ne change ;
5. vérifier que l'audit contient les opérations ;
6. supprimer un adaptateur, puis un rack, sans laisser d'orphelin ;
7. vérifier que la garde du modèle de câble renvoie 409.

**Vérification visuelle (contrôleur)** : synoptique général et par lieu, en clair et en sombre. Tester le câblage, la validation, l'undo/redo, la multi-sélection, la renumérotation, l'audit et un export. La console doit rester sans erreur.

- [ ] **Step 1 à 4 :** parcours RED, corriger chaque écart avec un test ciblé, tous les contrôles verts, puis les commits `test: parcours de bout en bout de la phase 4c` et `docs: phase 4c livrée`.
