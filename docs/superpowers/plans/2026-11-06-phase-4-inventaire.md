# Phase 4 : inventaire de ce qu'il faut reprendre d'arkyo

Référence : arkyo@88b2e4b (`.ref/arkyo`). Les citations `fichier:ligne` sont relatives à `.ref/arkyo`, sauf celles préfixées `arkyo-server:` (racine du dépôt).
Nombres de lignes : `wc -l`. « Porté » = le fichier existe déjà sous `web/src/<même chemin>` (phases 1-3).
Fermetures d'imports : script (imports statiques, `import()`, `import("…").Type`, alias `@/`, chemins relatifs ; limitées à `app/`, `components/`, `lib/`, `hooks/`, hors `app/api`). Les types importés comptent, puisque `tsc` en a besoin.

Ce document s'appuie sur l'inventaire de la phase 3 (`docs/superpowers/plans/2026-11-06-phase-3-inventaire.md`, §2.3, §3.3, §6.2), le vérifie et le complète. Les annexes A à D détaillent chaque route et chaque modèle ; le corps donne la synthèse et le découpage.

---

## 0. Surprises (à lire d'abord)

1. **« Câblage » n'est pas l'onglet `cablage/`.** Le dossier `app/(fullscreen)/project/[id]/cablage/` est l'onglet **Livraison > Préparation** (phase 6) : `?tab=cablage` est remappé en `preparation` (`app/(fullscreen)/project/[id]/_components/project-editor.tsx:202`), et le groupe « Livraison » liste Préparation et Recette (`:152-163`). Les routes `tenant/projects/[id]/cabling/**` (711 l.) n'ont pour appelants que Préparation, le dossier et le PDF Réseau (annexe B, « Câblage : phase 4 ou phase 6 ? »). **Le « câblage et numérotation » de la phase 4, c'est le câblage du synoptique** : `racks/[id]/connections/**`, `racks/[id]/renumber`, `tenant/projects/[id]/synoptic/connections/**` et `…/connections/renumber`. → `cabling/**` passe en phase 6, et avec lui le port Rust de `estimateCableLength` (seul appelant serveur : `cabling/route.ts`).
2. **Il n'y a pas d'onglet « Fiche ».** `?tab=fiche` est remappé en `inventaire` (`project-editor.tsx:203`). La fiche, c'est le panneau droit (`_editor/project-info-panel.tsx`, 40 l.) et la boîte « Caractéristiques » (`_editor/project-characteristics-dialog.tsx`, 237 l., `PATCH /api/tenant/projects/:id` :106, déjà porté en phase 3). `fiche/fiche-client.tsx` (504 l.) n'est importé que pour son type `ProjectFicheData` (`project-editor.tsx:42`, `_editor/project-info-panel.tsx:17`, `inventaire/_components/inventaire-export.tsx:54`).
3. **Onglets réels de l'éditeur** (`project-editor.tsx:126-164`, ids `:168-180`) : `inventaire`, `rack` (« Rack » = élévations), `synoptique`, `schema`, `cartographie` (« Plan »), `video`, `audio`, `lumiere` (Plan de feu, Adressage DMX), `reseau` (Map, Adressage IP, Adressage 2110, Configuration), `preparation` et `recette` (groupe « Livraison »). Plus l'**export dossier**, ouvert par le bouton « Exporter » de la topbar globale (`DossierWizard`, `project-editor.tsx:791`). Phase 4 = `inventaire`, `rack`, `synoptique`, la fiche et la coquille. Tout le reste est phase 5 ou 6.
4. **`project-editor.tsx` importe statiquement tous les onglets.** Sa fermeture complète fait **353 fichiers et 151 859 l.** La fermeture de la phase 4 n'a que **17 arêtes** vers des modules des phases 5-6, **toutes dans `project-editor.tsx`** (`:27-38`, `:103-122`) : `dossier-wizard`, `dossier-generators`, `drawing-tab-client`, `lumiere-tab-client`, 6 modules `cartographie/`, 2 `cablage/`, 2 `recette/`, 3 `reseau/` (dont le store zustand `useReseauStore`, utilisé `:322`). Aucun autre fichier de la phase 4 n'en importe. → Proposition : des **modules bouchons aux mêmes chemins** (§1.4), que les phases 5-6 écrasent par la copie d'arkyo. `project-editor.tsx` reste alors une copie conforme, sans aucun retrait.
5. **Le synoptique et l'éditeur de rack partagent tout.** `components/synoptique/synoptic-view.tsx` (14 023 l.) est monté par l'éditeur de rack (workspace `synoptic`) et, dans l'onglet Synoptique, par `general-canvas.tsx:861` et `location-canvas.tsx:940`. La fermeture de l'éditeur de rack (194 fichiers, 70 122 l.) recoupe celle du synoptique sur 127 fichiers (48 951 l.) et celle de l'inventaire sur 49 fichiers (17 303 l.). Une fois l'inventaire, l'onglet Rack et le synoptique portés, l'éditeur de rack n'ajoute que **46 fichiers, 15 855 l.**, dont 3 283 l. de code serveur (4 pages et les modules `lib/` serveur).
6. **L'onglet Rack ne dépend pas du synoptique.** La fermeture de `rack/rack-tab-client.tsx` n'inclut ni `synoptic-view.tsx` ni les composants du synoptique, mais elle tire les composants de l'éditeur de rack (`app/(app)/rigs/[id]/rack/[rackId]/_components/{rack-visual, side-rack-visual, draggable-*, port-label-editor, …}`). L'onglet Rack peut donc précéder le synoptique. En revanche, `rack-editor.tsx` importe statiquement `SynopticView` (`rack-editor.tsx:46-57`) : **l'éditeur de rack ne peut venir qu'après le synoptique**.
7. **Beaucoup de routes de la phase 4 n'ont aucun appelant** (≈ 2 645 l.) :
   - synoptique projet : `adapters` (×2), `bundles` (×2), `canvas-data`, `focus/[rackId]`, `labels` (×2), `layout` (×2), `zones` (×2), le GET de `connections`, `synoptic-guides` (annexe C §19) ;
   - guides : `tenant/racks/[rackId]/synoptic-guides` et `tenant/synoptic-guides/[guideId]`. Les guides vivent en `localStorage` (`components/synoptique/synoptic-view.tsx:2720,2742`) ;
   - `equipments` (×2), `rack-slots` (annexe B §19).

   Le synoptique projet n'utilise que `general`, `location/[locationId]`, `connections` POST/PATCH/DELETE et `connections/renumber`. Les zones, étiquettes, adaptateurs, ports externes et lignes de panel de la vue Lieu passent par les routes **par rack** `/api/racks/:id/**` (`location-canvas.tsx:466,482,494,505`). → Décision : porter ces routes mortes (parité d'API, utile à l'import de la phase 8) ou les documenter comme non portées.
8. **`assertNotGhost` est un no-op au commit de référence** (`lib/tenant-context.ts:161-163`). Les 71 appels (dont 3 dans des routes déjà portées) et leurs branches 403 « Mode lecture seule » des routes de la phase 4 sont du code mort : on les retire sans changer le comportement.
9. **Aucune permission de rôle dans les routes d'arkyo**, seulement la session (annexes A §0, B §0, C §0). La phase 3 a décidé de reprendre les gardes de l'UI côté serveur (`docs/superpowers/plans/2026-11-06-phase-3-projets.md`, décision 6) : à reconduire. Propositions : `projects:write` pour l'éditeur projet, `design:write` pour les écritures `/api/racks/:id/**` (garde de page de l'éditeur de rack : `app/(app)/racks/[rackId]/page.tsx:29`), session seule pour les lectures.
10. **Deux bus temps réel distincts.** `publishRackUpdate` alimente seulement `GET /api/racks/:id/events`, et `publishAppUpdate` seulement `/api/events` (annexe A §3). Le flux par rack envoie `: connected` en commentaire, n'a ni battement de cœur ni filtre `clientId`, et répond 401/404 en texte brut (`app/api/racks/[id]/events/route.ts:11-18,38,51-57`). Le Rust n'a que le bus app (`arkyo-server:crates/arkyo-server/src/events.rs:47-63`).
11. **Les éditeurs écoutent des entités que le serveur local n'émet jamais.**
    - `catalog` (catalogue supervisor) : `inventaire-scope.tsx:506-525`, `synoptique-tab-client.tsx:278-300`, `rack/rack-tab-client.tsx:431-445`.
    - `signal` et `signal_category`, qui déclenchent un `fetch("/api/admin/signals")` et un `fetch("/api/admin/signal-categories")` : `rack-editor.tsx:377-399`, `synoptique-tab-client.tsx:318-345`. Ces deux routes (`app/api/admin/signals`, `app/api/admin/signal-categories`) sont celles du catalogue central et n'existent pas dans arkyo-server.

    Le catalogue local publie `tenant_catalogue` (`arkyo-server:crates/arkyo-server/src/http/catalogue/shared.rs:33`) et `tenant_parametres_signals` (`http/parametres/signals.rs:66`). Dans arkyo, une modification du catalogue **perso** ne rafraîchissait pas non plus les éditeurs : la copie conforme reproduit donc ce comportement. → Décision : parité, ou ajouter `tenant_catalogue` / `tenant_parametres_signals` aux filtres (commentaire `// arkyo-server:`).
12. **Chargement par CDN, incompatible avec un usage hors ligne.**
    - jsPDF 2.5.1 : `lib/pdf/load-jspdf.ts:14`, `app/(app)/rigs/[id]/rack/[rackId]/_lib/design-export.ts:34`, `reseau/_components/shared/export-capture.ts:482` et `export-pdf.ts:323` ;
    - html-to-image 1.11.13 : `lib/export/synoptic-capture.ts:46` ;
    - svg2pdf.js 2.2.3 : `lib/pdf/synoptic-vector.ts:86`.

    Les exports de construction importent en plus `jspdf` ^4.2.1, `docx` ^9.6.1 et `exceljs` ^4.4.0 depuis npm (`_lib/construction-export-{pdf,docx,xlsx}.ts`). Précédent : `xlsx` a été embarqué (`arkyo-server:web/src/lib/export/table-xlsx.ts:61`, « bundlé (hors ligne) »). → Décision : embarquer jsPDF, html-to-image et svg2pdf.js aux versions CDN d'arkyo.
13. **« snapshot » ne veut pas toujours dire SaaS.**
    - `components/synoptique/lib/snapshot-sync.ts` (216 l.) et `hooks/use-synoptic-history.ts` sont l'**undo/redo** du synoptique (`snapshot-sync.ts:1-2`) : à porter.
    - « ghost » dans `rack-placement-canvas.tsx`, `rack-visual.tsx` et `add-container-wizard.tsx` désigne les **slots fantômes** (`startU = null`), pas le ghost mode : à porter.
    - Le SaaS se limite, côté front, à `update-snapshot-modal.tsx` (493 l.), `use-catalogue-drift.ts` (116 l.), leurs points de montage (`rack-card-canvas.tsx:39,334`, `inventaire-scope.tsx:64,532`) et le champ `snapshotId` (toujours `null`).
14. **Les quatre chargeurs de l'éditeur de rack sont des quasi-copies** (436 à 517 l., §2.2). `app/(app)/racks/[rackId]/page.tsx` ne charge pas les `RackLabel` (`:319-324`, contre `rigs/[id]/rack/[rackId]/page.tsx:318`) : à reproduire tel quel. Les deux sous-routes `/project/:id/inventaire/rack/:rackId` et `/project/:id/inventaire/synoptique` **ne sont liées par aucun écran** : il n'existe aucun lien vers elles hors des commentaires (`project-editor.tsx`, `page.tsx:23-24`, `layout.tsx:10`).
15. **Le Server Component de `/project/:id` lit la cartographie** (`app/(fullscreen)/project/[id]/page.tsx:49-59,520-623`). En phase 4, `cartographie.maps = []` : les tables `Carto*` arrivent en phase 5.
16. **Un test de la phase 2 cassera avec la migration 0004.** `use_in` crée des tables factices `CREATE TABLE IF NOT EXISTS "{table}" ("id","{col}")` (`arkyo-server:crates/arkyo-server/tests/catalogue_cables.rs:517-548`). Une fois `RackConnection` et `SynopticAdapter` créées pour de bon, l'insertion échouera (`NOT NULL`, FK). Il faudra le réécrire.
17. **`catalogCableModelId` est ambigu** (annexe D §0.6). Le synoptique y met un `TenantCableModel.id` (`synoptic-cable-model-picker.tsx:48`), mais la garde d'usage compte des `TenantCable.id` (`lib/services/tenant-catalogue.ts:189-213`, reproduite dans `arkyo-server:crates/arkyo-server/src/catalogue/in_use.rs:268-281`). Supprimer un modèle de câble ne vérifie donc jamais les connexions. → Décision.
18. **`constructionChecks` vidé vaut le JSON `null`**, pas `[]` (`app/api/racks/[id]/construction-checks/route.ts:75-80`), dans une colonne `NOT NULL DEFAULT '[]'`. En SQLite, stocker le texte `'null'`. La réponse de la route renvoie `[]` (`:97-100`). `DELETE /api/racks/:id/slots`, lui, écrit `[]` (`slots/route.ts:102`).
19. **Aucune nouvelle colonne sur les tables de la phase 3** (annexe D §1.4). En revanche, la migration 0004 doit créer **15 tables** et un enum (§4).

---

## 1. Éditeur projet `/project/:id`

### 1.1 Pages et chargeurs (Server Components)

| Route | Fichier (l.) | Garde | Données chargées | Devient |
|---|---|---|---|---|
| `/project/:id` (layout) | `app/(fullscreen)/project/[id]/layout.tsx` (24) | `projects:read` (`:22`) | – ; monte `ConfirmProvider` (`:23`) | garde `ClientPage` + `ConfirmProvider` |
| `/project/:id` | `app/(fullscreen)/project/[id]/page.tsx` (627) | session (`:28-29`) | voir ci-dessous | chargeur client + route d'API (extension) |
| `/project/:id/inventaire/rack/:rackId` | `…/inventaire/rack/[rackId]/page.tsx` (436) | session du layout `(fullscreen)` ; projet et appartenance du rack vérifiés (`:27-40`, sinon `notFound`) | idem éditeur de rack (§2.2) → `<RackEditor>` workspace `design` (`:391-392`) | orpheline (aucun lien, §0.14) |
| `/project/:id/inventaire/synoptique` | `…/inventaire/synoptique/page.tsx` (437) | session du layout | 1er rack de la 1re régie qui en a (`:26-50`), sinon redirection `?tab=synoptique` (`:44-47`) ; idem éditeur de rack → `<RackEditor initialView="synoptic">` (`:392-405`) | orpheline |
| `/project/:id/cartographie` | `…/cartographie/page.tsx` (18) | – | redirection `?tab=cartographie` (`:17`) | phase 5 (redirection triviale, portable dès la phase 4) |

**Requêtes de `page.tsx` (`/project/:id`)** :
- nom du tenant : `getTenantSlug` + `mainDb.tenant` (`:37-41`), SaaS. Devient le nom du site (`/api/site`), comme l'éditeur de panel en phase 3 ;
- `project.findUnique` (`:43-100`) avec :
  - `locations` (sortOrder) ;
  - `documents`, `_count{tasks,messages,documents}` (tables vides depuis la phase 3) ;
  - `cartoMaps` et tout leur contenu : **phase 5**, `[]` en phase 4 ;
  - `rigConfigs.rigRacks(position).rack` avec `_count.slots`, les `slots` (`startU`, `heightU`, `widthFraction`, `view`, `catalogEquipmentId`) et les `inventoryItems` (createdAt asc, champs `:79-91`, `panel{id,name,panelType,heightU}`) ;
- enrichissement : `fetchCatalogEquipmentMap` / `fetchCatalogAdapterMap` (`:115-118`), puis couleur de catégorie du BOM (fonction primaire par `sortOrder`, sinon catégorie), lue main d'abord puis tenant (`:120-261`). En local, une seule lecture `TenantEquipment.functionIds` → `TenantFunction`, sinon `TenantEquipmentCategory` ;
- `ficheData` (`:263-293`) ;
- dédoublonnage des `RigRack` par `rackId` (`:295-305`), puis `racks: InventaireRack[]` (`:306-493`) :
  - `constructionChecks` réduit à un **compte** (`:307-309`) ;
  - `hasConnectors` (`:310-314`) ;
  - slots sans `startU`/`heightU` exclus (`:334-353`) ;
  - BOM typé `equipment` / `panel` / `adapter` / `accessory`, avec des libellés FR construits côté serveur : « Plaque pleine 2U », « Étagère 1U »… (`:354-491`) ;
- `inventaire.rigConfigId` = `rigConfigs[0]` (`:509`), `locations[].virtualRackId` (`:511-518`).

→ Proposition : **`GET /api/tenant/projects/:id/editor`** (extension `// arkyo-server: données de la page serveur d'arkyo`) qui renvoie exactement `ProjectEditorData` (`project-editor.tsx:207-231`), avec `cartographie.maps = []`. La page devient un `ClientPage` ; `router.refresh()` (émis par `AppSync`, déjà monté dans `arkyo-server:web/src/app/(fullscreen)/fullscreen-layout.tsx:29`) relance le chargeur, comme en phase 3. Les libellés « Plaque … » et l'agrégation du BOM se portent en Rust à l'identique : un test les fige.

### 1.2 Coquille

| Fichier | l. | Rôle |
|---|---:|---|
| `_components/project-editor.tsx` | 2 283 | coquille : onglets, état des onglets Inventaire / Rack, `getEditorSlots` (`:1095`), panneaux droits (`InventaireRightPanel` :1593, `RackSelectorDropdown` :1686, `RackTabRightPanel` :1896, `RackTabSlotPropertiesWrapper` :2135, avec `PATCH`/`DELETE /api/racks/:id/slots/:slotId` :2166,2216), `CartographieShellGate` :2237 (phase 5) |
| `_editor/project-global-topbar.tsx` | 245 | topbar : lockup `arkyo.io \| tenant` (`:51-59`, `ArkyoPicto` :45) → `StrataBrand` + nom du site (habillage Strata) ; statut, ⚙ caractéristiques, Exporter |
| `_editor/project-contextual-topbar.tsx` | 102 | sous-topbar, `SaveStatus` |
| `_editor/project-tabs-pill.tsx` | 182 | pilule d'onglets avec sous-onglets et groupe de navigation |
| `_editor/project-header-block.tsx` | 229 | `ProjectStatus`, badge de statut |
| `_editor/project-characteristics-dialog.tsx` | 237 | fiche éditable (`PATCH /api/tenant/projects/:id`, déjà porté) |
| `_editor/project-info-panel.tsx` | 40 | panneau droit par défaut (fiche) |
| `_editor/tab-bar.tsx`, `_editor/ui.tsx` | 38, 102 | types `ProjectTabId`, primitives |
| `fiche/fiche-client.tsx` | 504 | type `ProjectFicheData` seulement (§0.2) |
| `components/editor-shell/{editor-shell, workspace-context, workspace-store, tool-registry, tool-topbar-ui, hooks/use-workspace}` | 82 + 30 + 68 + 66 + 46 + 18 | `EditorShell` (overlay `fixed … z-50`, `editor-shell.tsx:34`) |
| `components/synoptique/lib/{types, constants, colors}.ts` | 136 + 96 + 43 | types `Slot`, `ViewId`, `CategoryColorCtx` |

Coquille : 31 fichiers, 6 582 l., **4 547 à porter** (le reste est déjà dans `web/src`). La liste complète est en annexe E.

Appels d'API de la coquille :
- `PATCH /api/tenant/projects/:id` (statut, `:290`) ;
- `POST /api/tenant/projects/:id/racks/reorder` (`:590-592`) ;
- `PATCH /api/tenant/projects/:id/racks/:rackId` (`:1479-1480`) ;
- `PATCH` et `DELETE /api/racks/:id/slots/:slotId` (`:2166`, `:2216`).

### 1.3 Onglets : phase et taille

Tailles calculées par incrément, dans l'ordre du tableau : coquille, puis Inventaire, Rack, Synoptique, puis les onglets des phases 5-6. Un fichier partagé n'est compté qu'au premier onglet qui l'utilise.

| Onglet (id) | Point d'entrée | Phase | Fermeture complète (fichiers / l.) | Incrément (fichiers / l. / à porter) |
|---|---|---|---|---|
| Fiche (panneau droit + dialogue) | `_editor/project-info-panel.tsx`, `project-characteristics-dialog.tsx` | **4** | (dans la coquille) | (dans la coquille) |
| Inventaire (`inventaire`) | `inventaire/inventaire-client.tsx` + `_components/inventaire-*`, propriétés, `_lib/bom-*` | **4** | 65 / 22 855 | 51 / 20 575 / **17 402** |
| Rack (`rack`) = élévations FRONT/REAR/REAR_INTERIOR/SIDE | `rack/rack-tab-client.tsx` + `rack/_components/*`, `slot-properties-panel`, `port-label-editor` | **4** | 99 / 36 453 | 50 / 18 925 / **16 696** |
| Synoptique (`synoptique`) | `synoptique/synoptique-tab-client.tsx` (propre `EditorShell`, `project-editor.tsx:932-967`) | **4** | 139 / 55 658 | 70 / 33 433 / **31 246** |
| Plan (`cartographie`) | `cartographie/cartographie-tab-client.tsx`, `_components/cartographie-*` | 5 | 83 / 41 976 | 28 / 21 679 |
| Schémas, Vidéo, Audio (`schema`, `video`, `audio`) | `_components/drawing-tab-client.tsx` (`DRAWING_KIND_BY_TAB` :185-189, retour anticipé :864) | 5 | 100 / 30 375 (avec Lumière) | 52 / 20 293 |
| Lumière (`lumiere`) | `_components/lumiere-tab-client.tsx` (:897) | 5 | (avec dessins) | (avec dessins) |
| Réseau (`reseau`) | `reseau/_components/reseau-tab-client.tsx`, `reseau-store.ts` | 5 | 57 / 23 842 | 18 / 13 711 |
| Préparation (`preparation`, ex-`cablage`) | `cablage/_components/cablage-tab-client.tsx` | 6 | 58 / 12 787 | 23 / 4 275 |
| Recette (`recette`) | `recette/_components/recette-tab-client.tsx` | 6 | 22 / 5 480 | 6 / 2 315 |
| Export dossier (modal) | `_components/dossier-wizard/dossier-wizard.tsx`, `dossier-generators.ts` | 6 | 188 / 87 668 | 24 / 10 071 |

**Total phase 4, front** (coquille, Inventaire, Rack, Synoptique, éditeur de rack et sous-routes) : **248 fichiers, 95 370 l., dont 85 436 à porter**. Il faut en retirer 3 283 l. de code serveur (5 `page.tsx`, `lib/auth`, `lib/db-*`, `lib/tenant-context`, `lib/services/catalog-enrich`, `lib/services/rack-inventory-api`), qui deviennent des chargeurs ou des routes d'API. Reste **≈ 82 150 l. à copier**. Fichiers déjà portés (36) : `topbar-actions-context`, `presence-*`, `synoptic-node.tsx` (1 149), `synoptic-general-panel`, les modales d'aide et de raccourcis, `use-live-cursors`, `remote-cursors-overlay`, `types/synoptic.ts`, `cable-numbering.ts`, `rack-validation.ts`, `print-layout.ts`, `table-xlsx.ts`, `app-events-client.ts`, `tenant-permissions.ts`, `components/ui/*`, `wizard/*` (liste en annexe E).

Ce que l'inventaire tire hors de son dossier, et qu'il faut copier en phase 4 malgré le chemin :
- `reseau/_components/shared/export-capture.ts` (490) et `export-pdf.ts` (331), utilisés par l'export inventaire ;
- `_components/export-menu.tsx` (927).

Le synoptique tire `_components/project-view-export.tsx` (829), `export-live-page.tsx` (552) et `pending-export-store.ts` (65). L'onglet Rack tire `_components/export-cartouche-options.tsx` (486) et `export-pdf-model-options.tsx` (404). Ce sont les **exports par onglet** (PNG/PDF), qui font partie de la phase 4 (spec §6 : synoptique « export PNG/PDF »). Seul le dossier composé reste en phase 6.

### 1.4 Bouchons aux chemins d'arkyo

`project-editor.tsx` reste une copie conforme si chaque module qu'il importe et qui n'est pas encore porté existe sous forme de **bouchon au même chemin**. Chaque bouchon :
- exporte les mêmes noms et des types compatibles ;
- affiche `ComingSoon` dans la coquille ;
- porte en tête `// arkyo-server: bouchon phase N, remplacé par la copie d'arkyo`.

Les bouchons sont exclus de `COPIED_FILES` (`arkyo-server:web/src/theme-sweep.test.ts`).

| Bouchon | Exports utilisés par `project-editor.tsx` | Remplacé en |
|---|---|---|
| `_components/dossier-wizard/dossier-wizard.tsx` | `DossierWizard` (props `:791-803`), rendu `null` ou dialogue « Bientôt disponible » | 6 |
| `_components/dossier-generators.ts` | `buildDossierDataGenerators`, `buildDossierDataSources` (`:640-760`) | 6 |
| `_components/drawing-tab-client.tsx` | `DrawingTabClient`, `DrawingKind`, rendant `globalTopbar` + `ComingSoon` | 5 |
| `_components/lumiere-tab-client.tsx` | `LumiereTabClient`, `LumiereSubTab` | 5 |
| `cartographie/_components/cartographie-scope.tsx` | `CartographieScope`, `useCartographieScope`, `CartoMap` | 5 |
| `cartographie/_components/cartographie-{left-toolbar, topbar-host, right-panel, side-panel-place}.tsx`, `cartographie/cartographie-tab-client.tsx` | composants + `CartographieClientHandle` | 5 |
| `reseau/_components/reseau-{tab-client, topbar-host}.tsx`, `reseau-store.ts` | composants ; `useReseauStore` avec `activeSection` / `setActiveSection` (`:322-323`) | 5 |
| `cablage/_components/cablage-{tab-client, topbar-host}.tsx` | composants | 6 |
| `recette/_components/recette-{tab-client, topbar-host}.tsx` | composants | 6 |

Si le découpage du §8 est retenu, la sous-phase 4a ajoute des bouchons temporaires pour l'onglet Rack (`rack/rack-tab-client.tsx`, `rack/_components/{rack-tab-left-toolbar, rack-location-selector-dropdown, rack-location-info-panel, rack-tab-side-panel, rack-info-panel, rack-export}.tsx`, `components/synoptique/components/slot-properties-panel.tsx`, `app/(app)/rigs/[id]/rack/[rackId]/_components/port-label-editor.tsx`), remplacés en 4b, et pour `synoptique/synoptique-tab-client.tsx`, remplacé en 4c.

`?tab=` et `localStorage` (`project-editor-tab`, `:124`) valident les ids d'onglets (`:191-205`). Avec des bouchons, toute la navigation d'arkyo reste identique.

---

## 2. Éditeur de rack

### 2.1 Pages

| Route | Fichier (l.) | Garde | Monte |
|---|---|---|---|
| `/racks/:rackId` (contenant modèle) | `app/(app)/racks/[rackId]/page.tsx` (517) | `design:write` (`:29`) | `<RackEditor>` dans `WorkspaceProvider workspace="design"` (`:468-469`), sans `projectBreadcrumb` → **mode modèle** (onglet Inventaire du modèle, statut BROUILLON/INACTIF/ACTIF, `rack-editor.tsx:3367-3401`) |
| `/rigs/:id/rack/:rackId` | `app/(app)/rigs/[id]/rack/[rackId]/page.tsx` (436) | `design:write` (`:22`) | idem (`:396-397`) |
| `/project/:id/inventaire/rack/:rackId` | voir §1.1 | session | idem, avec `projectBreadcrumb` |
| `/project/:id/inventaire/synoptique` | voir §1.1 | session | idem, `initialView="synoptic"` |

`EditorShell` est un overlay plein écran (`components/editor-shell/editor-shell.tsx:34`) : sous `(app)`, il recouvre la sidebar. Les liens qui y mènent sont déjà portés en phase 3 et ouvrent aujourd'hui `ComingSoon` (`arkyo-server:web/src/router.tsx:108-109`).

### 2.2 Requêtes des chargeurs (identiques à quelques lignes près)

Pour `app/(app)/rigs/[id]/rack/[rackId]/page.tsx` :
- `rack.findUnique` + slots (`:27-64`) ;
- `fetchCatalogEquipmentMap` / `fetchCatalogConnectorTypeMap` (`:102-103`) ;
- équipements du catalogue (rackables et accessoires, `mainDb.catalogEquipment` `:176`, `:203`) ;
- `panel.findMany` (`:230`), marques (`:252`), connecteurs des panels (`:291`) ;
- `rackConnection`, `rackZone`, `rackLabel`, `rackSlotPanelRow`, `synopticAdapter`, `externalPort` (`:316-321`) ;
- `fetchCatalogAdapterMap` (`:328`) ;
- catégories (`:337`), `appConfig` (`:338`, clés `patch_panel_depth_mm`, `cable_safety_depth_mm`, `cable_pad`, `cable_sep1`, `cable_sep2`, `cable_include_rack`, `cable_template`, `cable_template_enabled` : voir `inventaire/synoptique/page.tsx:386-436`) ;
- connecteurs et types de signal (`:356-359`).

`app/(app)/racks/[rackId]/page.tsx` ajoute les lignes d'inventaire du modèle (`rackInventoryItem.findMany` `:393`, via `lib/services/rack-inventory-api.ts`) et le nom du tenant (`:34-39`), et omet `rackLabel` (§0.14).

→ Proposition : **`GET /api/racks/:id/editor?projectId=`** (extension commentée), qui renvoie les props de `RackEditor` (catalogue local, sans `mainDb`), et une seule fonction de chargement client partagée par les quatre pages.

### 2.3 Fichiers propres à l'éditeur de rack

Ce sont les fichiers qui ne sont ni dans l'inventaire, ni dans l'onglet Rack, ni dans le synoptique : 46 fichiers, 15 855 l. (12 572 à copier, hors pages et `lib/` serveur). Liste en annexe E. Les principaux :

| Fichier | l. | Rôle |
|---|---:|---|
| `app/(app)/rigs/[id]/rack/[rackId]/rack-editor.tsx` | 4 392 | éditeur : workspaces `design` / `synoptic` / `construction` (`:693-784`), `SynopticView` (`:3507`), sync slots (`useRackSync` :413) |
| `_components/resume-rail.tsx` | 2 019 | workspace construction (récapitulatif) |
| `_shell/global-topbar.tsx` | 354 | lockup `arkyo.io \| tenant` (`:160-168`) → habillage Strata |
| `_shell/tools-design.tsx`, `tools-construction.tsx`, `construction-actions-bar.tsx`, `design-actions-bar.tsx` | 426 + 39 + 51 + 22 | registres d'outils |
| `_components/rack-config-inline.tsx` | 411 | édition du rack (`PATCH /api/racks/:id`, déjà porté) |
| `_components/template-inventory-{shell,view,properties}.tsx`, `template-rack-canvas.tsx` | 160 + 348 + 173 + 205 | inventaire du **modèle** (`/api/racks/:id/inventory**`) |
| `_components/construction-{export,print,progress}-panel.tsx`, `design-export-panel.tsx` | 159 + 477 + 182 + 209 | construction |
| `_hooks/use-construction-checks.ts`, `construction-checks-context.tsx` | 106 + 36 | `GET/PATCH /api/racks/:id/construction-checks`, SSE `construction_checks_updated` (`:12,26`) |
| `_lib/construction-export-{data,docx,pdf,xlsx}.ts`, `design-export.ts` | 574 + 358 + 384 + 219 + 248 | exports DOCX / PDF / XLSX (npm `docx`, `jspdf`, `exceljs`) |
| `_components/{depth-prompt-dialog, rack-editor-clear-confirm-dialog, rack-editor-orphan-slots-dialog, editor-theme-toggle, trash-zone}.tsx` | 139 + 62 + 84 + 50 + 37 | dialogues |
| `components/synoptique/components/{remote-selection-halos, synoptic-pdf-export-dialog, cable-tag-add-button, cable-spread-toggle}.tsx`, `components/editor-shell/layer-{panel,row}.tsx` | 124 + 149 + 85 + 37 + 26 + 86 | spécifiques à l'éditeur |
| `inventaire/_components/equipment-card.tsx` | 179 | partagé avec l'inventaire du modèle |

**Recouvrements** :
- avec le synoptique : 127 fichiers, 48 951 l. ;
- avec l'inventaire projet : 49 fichiers, 17 303 l. (types `InventaireRack`, `catalog-panel`, `rack-card-canvas`, `add-container-wizard`…).

Les composants de `app/(app)/rigs/[id]/rack/[rackId]/_components/{rack-visual, side-rack-visual, panel-rack-visual, draggable-slot, draggable-items, draggable-bom-item, projected-slot, toast-stack, port-label-editor}` et `_hooks/use-rack-bom.ts` arrivent dès l'onglet Rack (§1.3).

---

## 3. Routes d'API de la phase 4

Détail route par route (méthode, chemin, garde, corps Zod, réponse, erreurs, évènements, audit, SaaS) : **annexes A, B et C**. Synthèse :

### 3.1 Volume

| Groupe | Fichiers | l. | Annexe |
|---|---:|---:|---|
| `app/api/racks/[id]/**` (hors `route.ts`, déjà porté) | 22 | 3 345 | A §1, §5 |
| `app/api/tenant/racks/**`, `tenant/synoptic-guides/**`, `tenant/inventaire/catalog` | 4 | 395 | A §2 |
| `tenant/projects/[id]/racks/**` (hors `racks/route.ts`), `locations/[locationId]`, `inventaire/catalog`, `audit`, `equipments/**`, `rack-slots` | 13 | 3 811 | B |
| `tenant/projects/[id]/cabling/**` | 3 | 711 | B (**phase 6**, §0.1) |
| `tenant/projects/[id]/synoptic/**`, `synoptic-guides` | 18 | 3 350 | C |
| SaaS : `snapshots/**`, `catalogue-drift` | 3 | 630 | B §18 (non portés) |

### 3.2 Routes réellement appelées par le front de la phase 4

Liste obtenue par grep des chemins `/api/` dans les 248 fichiers de la fermeture.
- **Par rack** :
  - `/api/racks/:id/{slots, slots/:slotId, connections, connections/:connId, renumber, zones(/:id), labels(/:id), bundles(/:id), adapters(/:id), external-ports(/:id), panel-rows, canvas-position, construction-checks, inventory(/:itemId), audit, events}` ;
  - `/api/tenant/racks` (`add-container-wizard.tsx:354`).
- **Projet** :
  - `PATCH /api/tenant/projects/:id` ;
  - `racks/:rackId` (PATCH/DELETE), `racks/:rackId/canvas-data`, `racks/:rackId/inventory(/:itemId(/transfer))`, `racks/:rackId/save-as-template`, `racks/clone-from-template`, `racks/reorder`, `racks` (POST, phase 3) ;
  - `locations` (POST, phase 3), `locations/:locationId` ;
  - `inventaire/catalog`, `audit` ;
  - `synoptic/general`, `synoptic/location/:locationId`, `synoptic/connections` (POST), `synoptic/connections/:id`, `synoptic/connections/renumber`.
- **Routes hors des groupes du §3.1, déjà en Rust** :
  - `/api/admin/config` (`rack-editor.tsx:907`) ;
  - `/api/tenant/catalogue/{adapters, equipment, lookup}` (`rack-editor.tsx:2345`, `component-config-modal.tsx:326`, `lib/hooks/use-catalog-lookup.ts:80`) ;
  - `/api/tenant/parametres/cable-models` (`synoptic-cable-model-dialog.tsx:190`) ;
  - `/api/tenant/parametres/print(/export-models)` (`export-cartouche-options.tsx:110`, `export-pdf-model-options.tsx:53`) ;
  - `/api/tenant/espace/informations` (`export-cartouche-options.tsx:102`) ;
  - `/api/symbol-overrides`, `/api/presence`, `/api/events`.
- **Absentes du Rust** :
  - `/api/admin/signals`, `/api/admin/signal-categories` (§0.11) ;
  - `/api/realtime/ticket` (neutralisé jusqu'à la phase 7, décision 10 de la phase 3).
- **SaaS appelées** : `catalogue-drift` (`use-catalogue-drift.ts:57`) et `snapshots/**` (`update-snapshot-modal.tsx:242,261`), à retirer avec leurs composants.

Volume Rust des routes vivantes : ≈ 8 370 l. de TypeScript (A sans les guides, 3 598 ; B pour la phase 4, 3 293 ; C vivantes, 1 476), plus ≈ 2 400 l. de services (§5). Routes mortes : ≈ 2 645 l. (§0.7).

### 3.3 Points transverses (annexes A §0, B §0, C §0)

- **Session** : `401 {"error":"Unauthorized"}` (en anglais). Les messages 404 en anglais sont à garder : « Not found », « Rack not found », « Slot not found », « Project not found », « Parent shelf not found », « Parent slot is not a shelf ».
- **Deux formats de validation**, selon la route :
  - `{error: flatten()}` : `racks/[id]/**` (sauf `inventory` POST et `inventory/:itemId` PATCH), `projects/[id]/racks/:rackId` PATCH, `reorder`, `locations/:locationId` PATCH, `synoptic-guides` POST ;
  - `{error:"Validation invalide", issues}` : tout le reste.

  Les deux existent déjà en Rust (`http::parametres::valid`).
- **Identifiants fournis par le client** (création optimiste) : `id: z.string().min(6).max(64).optional()` sur les POST adapters, bundles, connections, labels et zones (annexe A §0.10). Le serveur doit accepter ces id.
- **500 implicites dans arkyo** : JSON invalide, `P2025` sur un id absent. Décision proposée : 404 « Not found » ou 400, comme les écarts assumés de la phase 3 (`2026-11-06-phase-3-suivi.md`, « Écarts assumés »).
- **Audit** : `db.auditLog.create(...).catch(console.warn)`, hors transaction, avec les mêmes `action` / `entityType` que l'annexe. `crate::audit::log` l'écrit dans la transaction.

---

## 4. Modèles Prisma de la phase 4

Détail champ par champ, relations, `onDelete`, index et ébauche SQL dans l'**annexe D** (PARTIE 1). Résumé :

- **15 tables** pour `0004_editeur.sql`, dans l'ordre de dépendance :
  1. `ProjectEquipment` (`schema.prisma:156-169`), lue seulement par des routes mortes ;
  2. `RackZone` (`:612`), `RackLabel` (`:636`), `CableBundle` (`:759`) ;
  3. `RackSlotPanelRow` (`:770`) ;
  4. `SynopticAdapter` (`:838`), `ExternalPort` (`:662`, enum `ExternalPortKind` INTER_LIEU | MONDE, `:694-697`) ;
  5. `RackConnection` (`:699`) ;
  6. `ProjectSynopticAdapter` (`:994`), `ProjectCableBundle` (`:1022`) ;
  7. `ProjectConnection` (`:938`) ;
  8. `ProjectSynopticZone` (`:1036`), `ProjectSynopticLabel` (`:1053`), `SynopticGuide` (`:1070`), `ProjectSynopticLayout` (`:1088`).
- Toutes les relations ont un `onDelete` explicite. Les `catalog*Id` sont des FK souples vers les tables locales de 0002 (annexe D §1.2).
- Colonnes `snapshotId` (`RackConnection`, `SynopticAdapter`, `ProjectSynopticAdapter`) : présentes, nullables, toujours `NULL` (décision 5 de la phase 3).
- **Aucune nouvelle colonne** sur les tables de la phase 3. La phase 4 commence à écrire, entre autres : `Rack.constructionChecks`, `canvasX/Y`, `RackSlot.synopticX/Y`, `panelLabels`, `label`, `notes`, `view`, `startU`, `Location.canvasX..H`, `sortOrder` (annexe D §1.4, avec les routes qui les écrivent).
- `SynopticGuide` est relue par `clone-from-template` (`app/api/tenant/projects/[id]/racks/clone-from-template/route.ts:81`), et `ProjectCableBundle` par `synoptic/general` (`general/route.ts:211`). Les deux sont donc nécessaires même si leurs routes CRUD sont mortes.
- `CartoCablePath` (phase 5) n'est lue que par `cabling` (phase 6). `ProjectCatalogueSnapshot` n'est jamais créée.
- `in_use` (phase 2) lit déjà `RackConnection.catalogCableModelId`, `ProjectConnection.catalogCableModelId`, `SynopticAdapter.catalogAdapterId` et `ProjectSynopticAdapter.catalogAdapterId` s'ils existent (`arkyo-server:crates/arkyo-server/src/catalogue/in_use.rs:258-296`). Ces gardes deviennent actives avec 0004 et demandent des tests.
- Index : arkyo n'a pas d'index sur `RackConnection.rackId`, `fromSlotId` ni `toSlotId`. En ajouter serait un écart (annexe D §0) qu'il faudrait documenter.

---

## 5. Services `lib/`

Détail par fichier : annexe D PARTIE 2, annexe A §6, annexe B §20, annexe C §20.

| Service | l. | Pur ? | Côté | Phase 4 |
|---|---:|---|---|---|
| `lib/services/rack-inventory.ts` | 385 | pur | serveur (`validateInventoryRef` :208-303) + client (`computeBomRemaining`, `use-rack-bom.ts`) | Rust : `validateInventoryRef` (24 cas Vitest) ; TS : copie + tests |
| `lib/services/rack-inventory-sync.ts` + `auto-label.ts` | 345 + 28 | DB | serveur | Rust (slots fantômes, `generateUniqueLabel` `#XXXX`) |
| `lib/services/rack-inventory-api.ts` | 567 | DB (`mainDb`) | serveur (et page `racks/[rackId]`) | Rust, lecture locale |
| `lib/services/rack-clone.ts` | 352 | DB | serveur | Rust (`cloneRackInto`), à mutualiser avec `clone_rack` (`arkyo-server:crates/arkyo-server/src/http/racks.rs:310`) |
| `lib/services/cable-numbering.ts` | 580 | pur | serveur (`computeCableLabel` :541-580, deux routes `renumber`) + client (déjà copié : `numbering-tab`, `synoptic-renumber-dialog`) | Rust + **fixtures JSON partagées** (17 cas existants) |
| `lib/services/synoptic-focus-payload.ts` | 762 | mixte (SQL + pur : `enrichRackPayload` :450-592) | serveur (`location`, `focus`) | Rust, chargement séparé du calcul ; fixtures possibles |
| `lib/services/catalog-enrich.ts` | 314 | DB | serveur | ajouter `fetchCatalogAdapterMap` (:225-270) à `arkyo-server:…/src/catalogue/enrich.rs` |
| `lib/services/catalog-merge.ts` + `tenant-catalogue.ts` | 353 + 238 | DB, SaaS | serveur (`inventaire/catalog` ×2) | version mono-source (catalogue perso seul) |
| `lib/services/project-snapshot-resolve.ts`, `snapshot-placement.ts`, `project-snapshot.ts` | 113 + 133 + 311 | – | serveur | **SaaS, non portés** ; `resolve*` devient `map.get(id)` |
| `lib/services/cable-length.ts` | 158 | pur | serveur (`cabling`, phase 6) + client (`synoptic-view`, `resume-rail`, `construction-export-data`) | TS seulement en phase 4 ; Rust et fixtures en phase 6 |
| `lib/services/audit-format.ts` | 79 | pur | client (`audit-panel`) | copie TS + `tests/unit/audit-format.test.ts` |
| `lib/services/rack-validation.ts` | 524 | pur | client (validation du synoptique, 11 contrôles) | déjà copié ; copier `tests/unit/rack-validation.test.ts` |
| `lib/client-id.ts` | 98 | – | client (`getClientId`, `apiFetch`) ; serveur porté (`http/client_id.rs`) | copie TS |
| `lib/rack-events.ts` + `lib/event-bus.ts` | 24 + 233 | infra | serveur | bus par rack en Rust (§6) ; Redis non porté |
| `components/synoptique/lib/connection-devirt.ts`, `lib/pdf/synoptic-*`, `lib/export/*` | – | pur / DOM | client | copies TS |
| Logique en ligne des routes | – | – | serveur | `construction-checks` (bascule / pose / effacement, JSON `null`), les deux `renumber` (ordre, fusion de la configuration, `normCode`, `getConnectorInfo`), validation des connexions de composant (`racks/[id]/connections/route.ts:51-68`) |

Déjà portés : `rack-naming` (`projects/naming.rs`), `app-events` (`events.rs`), lecture serveur de `client-id`, `connector-dtype`. Code mort : `rack-geometry.ts`, `inventaire/_components/bom-panel.tsx` (annexe B).

---

## 6. Temps réel

**Bus par rack** : à créer, `GET /api/racks/:id/events`. Protocole exact en annexe A §3.1. Publieurs (21 types, annexe A §3.3) :
- `adapter_*`, `bundle_*`, `connection_*`, `external_port_*`, `label_*`, `zone_*` (`added` / `updated` / `removed`) ;
- `construction_checks_updated`, `panelrow_updated`, `rack_cleared`, `slot_added`, `slot_updated`, `slot_removed`.

Aucun évènement rack pour `canvas-position`, `inventory`, `renumber`, guides et audit. Abonnés :
- `components/synoptique/hooks/use-rack-sync.ts:57` (`slot_*`) ;
- `synoptic-view.tsx:3243` (un `EventSource` par rack surveillé) ;
- `use-construction-checks.ts:26`.

**Bus app** (`/api/events`, déjà porté avec `publish_meta`) : entités et actions publiées par les routes vivantes de la phase 4 (grep `publishAppUpdate` sur les groupes du §3.1) :
- inventaire et racks :
  - `rack_inventory updated` (15 appels, `projectId`, `rackId` ; pas de `clientId` dans `racks/[id]/inventory`) ;
  - `rack updated|deleted` ; `rig created|updated` (save-as-template, clone) ; `project updated` (guides) ; `location updated|deleted` ;
  - `slot updated|deleted` (`rack_inventory` aussi sur slots POST) ;
- connexions et objets du rack :
  - `rackConnection created|updated|deleted` (renumber : `updated`) ;
  - `rackZone`, `rackLabel`, `cableBundle`, `synopticAdapter`, `external_port` (`created|updated|deleted`) ; `rackSlotPanelRow updated` ;
- synoptique projet :
  - `project_synoptic_connection created|updated|deleted|renumbered` ;
  - pour les routes mortes : `project_synoptic_{zone,label,adapter,bundle,layout}`, `synoptic_guide`, `project_equipment`.

Le détail des `meta` (`projectId`, `rackId`, `itemId`, `clientId`, `data`) est donné ligne par ligne dans les annexes. Abonnés : `useProjectSync` (`_hooks/use-project-sync.ts:76`) avec les filtres d'entités de `inventaire-scope.tsx:506-525`, `synoptique-tab-client.tsx:278-300` et `rack/rack-tab-client.tsx:431-445` (`acceptUnscoped`, `includeOwn`). Il y a aussi `AppSync` → `router.refresh()` → rechargement du `ClientPage`.

**`clientId`** :
- côté client, `apiFetch` / `getClientId` (`lib/client-id.ts`, 14 fichiers du front) ajoutent l'en-tête `x-client-id` ;
- côté serveur, il est lu par `readClientIdFromRequest` (`lib/client-id.ts:88-98`) dans les routes par rack (adapters, bundles, canvas-position, connections, external-ports, labels, panel-rows, renumber, slots, zones), puis renvoyé dans `meta.clientId` ;
- `useProjectSync` ignore ses propres évènements, sauf avec `includeOwn`.

Présence et curseurs (`use-live-cursors`, `remote-selection-halos`, `presence-avatars`) : copiés, connexion WebSocket neutralisée jusqu'à la phase 7 (décision 10 de la phase 3).

---

## 7. SaaS à retirer

**Serveur** :
- blocs `assertNotGhost` / `GhostModeError` (no-op, §0.8) : 71 appels dans les groupes du §3.1 (36 dans `racks/[id]/**` et `tenant/{racks,synoptic-guides}`, 35 dans `tenant/projects/[id]/**`) ;
- `requireTenantDb`, `TenantAccessError` (500) : remplacés par l'extracteur de session ;
- `mainDb` → tables locales (correspondances en annexe C §20) :
  - `renumber`, `slots`, `slots/:slotId`, `adapters` ;
  - `canvas-data` (projet et synoptique), `inventory` (projet), `clone-from-template`, `synoptic/{general, location, focus, renumber}` ;
  - `rack-inventory-api`, `catalog-enrich`, `synoptic-focus-payload`.

  Partout, le schéma « main d'abord, puis repli tenant » devient une lecture directe. Pour les fonctions d'un équipement, seul le chemin `functionIds` subsiste ;
- snapshots :
  - `getOrCreateSnapshot` (`synoptic/adapters` POST :127-136, `racks/:rackId/inventory` POST) ;
  - `loadProjectSnapshotMap` / `resolveEquipmentData` (`canvas-data` ×2, `inventory`, `general`, `synoptic-focus-payload`) ;
  - routes `snapshots/**` et `catalogue-drift` ;
- `catalog-merge` (éclipse `shadowsArkyo`, champ `source`) ;
- tag `tenantSlug` des évènements ; Redis (`lib/event-bus.ts:88-146`).

**Front** :
- `update-snapshot-modal.tsx` et son montage (`rack-card-canvas.tsx:39,334`), ainsi que le badge de dérive ;
- `use-catalogue-drift.ts` et son montage (`inventaire-scope.tsx:64,532`) : `getDrift` renvoie toujours `null` ;
- nom du tenant :
  - `tenantName` des topbars (`project-global-topbar.tsx:51-59`, `_shell/global-topbar.tsx:160-168`), remplacé par le nom du site et `StrataBrand` (habillage Strata) ;
  - `--impersonation-banner-height` / `--dev-banner-height` déjà à `0px` ;
- widget de rapport de bug : déjà retiré du layout plein écran ;
- `/api/admin/signals` et `/api/admin/signal-categories` (§0.11).

Il n'y a **ni plan, ni crédit, ni proposition au catalogue** dans les 248 fichiers. Le seul résultat « credit » est une icône (`components/ui/icons.tsx:95`), et les résultats « propose » sont du texte d'interface.

---

## 8. Taille et découpage

### 8.1 Volume total

| | l. |
|---|---:|
| Front à copier, puis adapter | ≈ 82 150 (245 fichiers ; 4 pages serveur réécrites en chargeurs) |
| Routes TypeScript vivantes → Rust | ≈ 8 370 |
| Services → Rust | ≈ 2 400 |
| Routes mortes (option) | ≈ 2 645 |
| Migration | 15 tables |

C'est 5,5 fois la phase 3 (≈ 14 950 l. de front et 2 390 l. d'API).

### 8.2 Sous-phases proposées

Ordre imposé par les dépendances :
- **4a** (coquille, fiche, inventaire) précède tout ;
- **4b** (onglet Rack) ne dépend que de 4a ;
- **4c** (synoptique) dépend de 4a (`InventaireRack`, coquille) et réutilise les composants rack de 4b (`rack-visual`, `use-rack-sync`, `slot-properties-panel`) ;
- **4d** (éditeur de rack) dépend de 4c (`SynopticView` importé statiquement, §0.6).

Chaque sous-phase se termine par une release installable et une vérification de parité.

**4a : coquille, fiche, inventaire, migration (13 tâches)**
1. Migration `0004_editeur.sql` (15 tables, enum, cascades). Réécriture de `tests/catalogue_cables.rs:517-548`, tests `in_use` des câbles et adaptateurs.
2. Bus SSE par rack (`events.rs` : `publish_rack`, `GET /api/racks/:id/events`, `: connected`, 401/404 en texte) et ses tests.
3. Services Rust de l'inventaire : `validateInventoryRef` (24 cas), `rack-inventory-sync` + `auto-label`, `rack-inventory-api` local, `catalog-merge` mono-source, `fetchCatalogAdapterMap`.
4. `GET/POST /api/tenant/projects/:id/racks/:rackId/inventory` (1 243 l. : dédoublonnage, composants, slots fantômes).
5. `inventory/:itemId` PATCH/DELETE, `transfer`, `racks/:rackId` PATCH/DELETE, `racks/reorder`, `locations/:locationId` PATCH/DELETE, `GET tenant/inventaire/catalog`, `GET projects/:id/inventaire/catalog`, `GET /api/tenant/racks`.
6. `rack-clone` + `save-as-template` + `clone-from-template` (mutualisé avec `clone_rack`).
7. `GET /api/tenant/projects/:id/editor` (données de `page.tsx`, BOM et libellés d'accessoires, `maps: []`) et ses tests.
8. Front, socle :
   - npm `@radix-ui/react-{dropdown-menu, context-menu, tabs}` ;
   - jsPDF, html-to-image et svg2pdf.js embarqués à la place du CDN (§0.12) ;
   - `lib/client-id.ts`, `components/editor-shell/*` de la coquille, `synoptique/lib/{types, constants, colors}` ;
   - route `project/:id` en `ClientPage`.
9. Front, coquille : `project-editor.tsx`, `_editor/*`, `fiche-client.tsx`, les 17 bouchons des phases 5-6 et les bouchons temporaires Rack / Synoptique (§1.4), topbar en habillage Strata.
10. Front, inventaire 1/3 : `inventaire-client`, `inventaire-scope` (dérive retirée), barres d'outils, panneau latéral, sélecteur et fiches de lieu, aide et raccourcis.
11. Front, inventaire 2/3 : `catalog-panel` (1 490), `add-container-wizard` (2 645, seul dans sa revue s'il le faut), `template-selector`, `component-config-modal`.
12. Front, inventaire 3/3 : `rack-card-canvas` (sans `update-snapshot-modal`), `rack-mini-svg`, `slot-ruler`, `container-sheet-card`, panneaux de propriétés, `equipment-card`, `accessory-face`, puis exports de l'inventaire (`inventaire-export`, `bom-table`, `bom-pdf`, `export-menu`, `reseau/_components/shared/export-{capture,pdf}`, `lib/export/*`, `lib/print/technical-frame`, `technical-table-pdf`).
13. Clôture : parité écran par écran (Inventaire, fiche, onglets en `ComingSoon`), docs, suivi, CI.

**4b : onglet Rack, les élévations (9 tâches)**
1. `POST/DELETE /api/racks/:id/slots` et `PATCH/DELETE /api/racks/:id/slots/:slotId` : évènements rack et app, slots fantômes, suppression d'adaptateurs (`removedAdapterIds`), lecture locale du catalogue.
2. `GET /api/tenant/projects/:id/racks/:rackId/canvas-data` (587 l., sans snapshots, palette = `TenantEquipment` actifs, annexe B §2), `construction-checks` GET/PATCH (piège du JSON `null`), `canvas-position` PATCH.
3. Front, composants rack partagés : `rigs/[id]/rack/[rackId]/_components/{rack-visual, side-rack-visual, panel-rack-visual, draggable-slot, draggable-items, draggable-bom-item, projected-slot, toast-stack, port-label-editor}`, `_hooks/use-rack-bom`, `_shell/slot-context-menu`, `synoptique/hooks/{use-rack-sync, use-confirm, use-toasts}`, `synoptique/lib/{collision, panel-labels}`, `slot-properties-panel`, `use-catalog-lookup`, `rack-inventory.ts` (client) et ses tests.
4. Front : `rack-tab-client`, `rack-tab-left-toolbar`, panneaux latéraux et d'infos, sélecteur de lieu, `category-legend`, `rack-drag-eligibility` (remplacent les bouchons de 4a).
5. Front : `rack-placement-canvas.tsx` (2 503), seul.
6. Front : `location-placement-canvas.tsx` (portée « par emplacement »), puis vérification du câblage de `project-editor` (`RackTabRightPanel`, `RackTabSlotPropertiesWrapper`).
7. Front, exports Rack 1/2 : `rack-export`, `rack-export-{layout, capture, stage}`, `export-cartouche-options`, `export-pdf-model-options`, `lib/print/{export-with-cartouche, render-print-layout}`, `lib/pdf/synoptic-export`.
8. Front, exports Rack 2/2 : `rack-export-composer.tsx` (1 439), `rack-export-{object,views}-panel`.
9. Clôture.

**4c : synoptique, câblage et numérotation, audit (14 tâches)**
1. Routes par rack, objets 1/2 : `zones`, `labels`, `bundles` (CRUD, id client, évènements rack et app, audit).
2. Routes par rack, objets 2/2 : `external-ports`, `panel-rows` (GET avec purge), `adapters` (`fetchCatalogAdapterMap`).
3. `connections` GET/POST (lot)/DELETE (lot) et `connections/:connId` PATCH/DELETE (validation des composants).
4. `computeCableLabel` en Rust + fixtures JSON partagées (`web/src/lib/services/cable-numbering.test.ts` les lit aussi), puis `POST /api/racks/:id/renumber` (472 l.).
5. `synoptic-focus-payload` en Rust (chargement séparé du calcul), `GET synoptic/location/:locationId`.
6. `GET synoptic/general` (615 l.).
7. `synoptic/connections` POST, `connections/:id` PATCH/DELETE, `connections/renumber` (316 l.), et les deux `GET …/audit`.
8. Front, socle : `editor-shell/{left-toolbar, right-panel, contextual-topbar, slide-over-panel, cursor-hint, floating-context-menu, tools-synoptic, synoptic-actions-bar, hooks/*}`, `synoptique/lib/{cable-paths, cabling-api, connection-devirt, external-ports, fit-all, grid, scene-descriptor, snapshot-sync}`, `hooks/{use-synoptic-history, use-validation-report, use-cable-lane-offsets}`, `audit-format` et ses tests.
9. Front, composants 1/2 : les 9 panneaux de propriétés, `synoptic-label-{toolbar,input}`, `zone-color-picker`, `incompat-tooltip`, `drawing-hint`, `toasts`, dialogues `empty-info` / `decable` / `clear-labels`.
10. Front, composants 2/2 : `synoptic-layers-panel` (726), `mini-map`, `rulers`, `adapter-node` / `adapter-picker`, `port-adapter-picker`, `cable-model-dialog` / `cable-model-picker`, `bundles-section`, `synoptic-renumber-dialog` (777), `validation-panel`, `audit-panel`.
11. Front : `components/synoptique/synoptic-view.tsx` (14 023), seul (§8.3).
12. Front, onglet : `synoptique-tab-client` (1 465), `general-canvas` (901), `location-canvas` (986), `general-info-panel`, `general-properties-panels`, `synoptique-rack-selector`.
13. Front, exports : `project-view-export`, `export-live-page`, `pending-export-store`, `lib/pdf/{synoptic-cards, synoptic-vector}`, `lib/export/{svg-inline-styles, synoptic-capture}`.
14. Clôture : parité, avec la validation (11 contrôles), l'undo/redo, la multi-sélection, la renumérotation et l'export PNG/PDF.

**4d : éditeur de rack et fin de la phase (10 tâches)**
1. `GET /api/racks/:id/editor` (props communes aux quatre chargeurs, §2.2).
2. `GET/POST/DELETE /api/racks/:id/inventory` (556 l.) et `inventory/:itemId` (mode modèle).
3. Front : les quatre pages en `ClientPage` (`/racks/:rackId`, `/rigs/:id/rack/:rackId`, les deux sous-routes de projet), routeur, gardes `design:write`.
4. Front : `rack-editor.tsx` (4 392), seul.
5. Front : `_shell/*` (topbar en habillage Strata), `rack-config-inline`, dialogues, `trash-zone`, `editor-theme-toggle`, `layer-{panel,row}`, `remote-selection-halos`, `cable-{tag-add-button, spread-toggle}`, `synoptic-pdf-export-dialog`.
6. Front : inventaire du modèle (`template-inventory-{shell, view, properties}`, `template-rack-canvas`).
7. Front : workspace construction (`resume-rail` 2 019, `construction-progress-panel`, contexte et hook des contrôles).
8. Front, exports de construction : `_lib/construction-export-*`, `design-export`, panneaux d'export et d'impression ; npm `docx`, `exceljs`, `jspdf` (versions d'arkyo).
9. Routes mortes, si Damien les veut (§0.7) : guides (×3), synoptique projet `adapters` / `bundles` / `labels` / `zones` / `layout` / `canvas-data` / `focus`, `equipments`, `rack-slots`. Sinon, une note dans le suivi.
10. Clôture de la phase 4 : parité de bout en bout, `README` / `ARCHITECTURE` / état dans `CLAUDE.md`, suivi, CI.

### 8.3 Très gros fichiers : une tâche chacun, revue par diff

| Fichier | l. | Sous-phase |
|---|---:|---|
| `components/synoptique/synoptic-view.tsx` | 14 023 | 4c-11 |
| `app/(app)/rigs/[id]/rack/[rackId]/rack-editor.tsx` | 4 392 | 4d-4 |
| `inventaire/_components/add-container-wizard.tsx` | 2 645 | 4a-11 |
| `rack/_components/rack-placement-canvas.tsx` | 2 503 | 4b-5 |
| `_components/project-editor.tsx` | 2 283 | 4a-9 |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/resume-rail.tsx` | 2 019 | 4d-7 |

Pour garder ces tâches relisibles :
- **copie brute dans un commit, retouches dans un autre.** Le premier commit est `cp` de `.ref/arkyo/<chemin>` (diff nul avec arkyo, vérifiable par `diff -q`). Le second ne contient que les lignes `// arkyo-server: …`. Le relecteur lit le second commit ou `diff -u .ref/arkyo/<chemin> web/src/<chemin>`, qui ne doit montrer que des blocs commentés ;
- **toutes les dépendances sont portées avant** (bouchons interdits pour ces fichiers, sauf ceux du §1.4), pour que la tâche se limite à « copie + `tsc` vert + test de fumée » ;
- un **test de fumée** par fichier (montage sans erreur avec des données minimales), plutôt que des tests de comportement ;
- pour `synoptic-view.tsx`, la revue porte sur les retraits (`mainDb`, snapshots SaaS : aucun ; `snapshot` = undo, §0.13), sur les couleurs d'interface en dur (habillage Strata) et sur les `fetch` vers des routes absentes. La relecture ligne à ligne de 14 k lignes identiques n'a pas de valeur.

---

## 9. Décisions à prendre

1. **Bouchons aux chemins d'arkyo** (§1.4) plutôt que des retraits dans `project-editor.tsx`.
2. **`cabling/**` en phase 6**, avec `estimateCableLength` en Rust (§0.1).
3. **Routes sans appelant** (≈ 2 645 l.) : les porter en 4d ou les laisser non portées (§0.7). Les 15 tables sont créées dans tous les cas.
4. **Gardes serveur** : `projects:write` / `design:write`, dans la continuité de la phase 3 (§0.9).
5. **Erreurs 500 implicites d'arkyo** (JSON invalide, id absent) : 404 / 400 (§3.3).
6. **Bibliothèques CDN embarquées** (jsPDF 2.5.1, html-to-image 1.11.13, svg2pdf.js 2.2.3), alors que `construction-export-pdf.ts` importe `jspdf` ^4.2.1 depuis npm : deux versions de jsPDF coexistent dans arkyo (§0.12).
7. **Rafraîchissement sur les évènements du catalogue local** (`tenant_catalogue`, `tenant_parametres_signals`) et routes `/api/admin/signals*` absentes (§0.11).
8. **Sous-routes orphelines** `/project/:id/inventaire/{rack/:rackId, synoptique}` : les porter, puisque c'est le même `RackEditor` et presque gratuit, ou les laisser en `ComingSoon`.
9. **`catalogCableModelId`** : `TenantCableModel.id`, avec la garde d'usage à déplacer du câble vers le modèle de câble (§0.17).
10. **Index sur `RackConnection(rackId, fromSlotId, toSlotId)`** : écart de performance, à documenter.
11. **Écarts de parité relevés dans les annexes**, à reproduire ou à corriger :
    - le PATCH de connexion ne permet pas d'effacer un label (`null` = inchangé, annexe A) ;
    - `DELETE` de tout l'inventaire du modèle laisse des slots fantômes orphelins ;
    - `panel-rows` GET purge des lignes en base ;
    - `general` renvoie `locations: []` sans rack ;
    - `targetCableLabel` est absent plutôt que `null` ;
    - POST `synoptic/connections` renvoie 404 sur un câble intra-rack ;
    - `rack-slots` ne vérifie pas l'appartenance au projet ;
    - `audit` répond 500 si `limit` n'est pas un nombre ;
    - `canvas-data` filtre `rackAccessories` sur une colonne `category` que `TenantEquipment` n'a pas ;
    - libellés de catalogue perso ignorés par certaines statistiques d'arkyo, que le catalogue local rendra plus complets (annexe C).

---

# Annexe A : routes `racks/[id]/**`, `tenant/racks`, `tenant/synoptic-guides`, `tenant/inventaire/catalog`

### Inventaire des routes API, lot A (phase 4) : `racks/[id]/**` et `tenant/racks`, `synoptic-guides`, `inventaire/catalog`

Référence : arkyo au commit `88b2e4b`, clone `.ref/arkyo`. Les chemins sont relatifs à ce clone, sous la forme `fichier:ligne`.
Sauf mention contraire, `R/` = `app/api/racks/[id]/` et `T/` = `app/api/tenant/`.

---

#### 0. Invariants communs (à lire avant les blocs)

Ces points valent pour toutes les routes ci-dessous ; les blocs ne les répètent que s'il y a une différence.

1. **Session** : `const session = await auth()`. Deux variantes :
   - `if (!session)` : adapters, audit, bundles, connections, construction-checks, external-ports, labels, panel-rows, renumber, slots, zones ;
   - `if (!session?.user?.id)` : canvas-position, inventory*, tenant/racks, synoptic-guides, inventaire/catalog.
   Dans les deux cas, la réponse est `401 {"error":"Unauthorized"}` (en anglais, comme dans arkyo).
2. **Aucune vérification de permission** : aucune de ces routes n'appelle `requireTenantPermission` ni `requirePermission` (vérifié par grep, aucun résultat). Le seul contrôle est la session, plus l'appartenance active au tenant (`requireTenantDb`).
3. **`requireTenantDb()`** (`lib/tenant-context.ts:126-146`) : il vérifie le slug du tenant, la session et une appartenance active. En cas d'échec, il lève `TenantAccessError`, que les routes n'interceptent pas : on obtient un **500** (seule exception, `R/events`). **SaaS**, il devient l'accès direct à la base SQLite.
4. **Mode fantôme (ghost)** : le bloc `try { await assertNotGhost() } catch (e) { if (e instanceof GhostModeError) return 403 {"error":"Mode lecture seule"} }` est présent dans toutes les routes d'écriture. Or `assertNotGhost()` est un **no-op** (`lib/tenant-context.ts:161-163`, marqué `@deprecated`). Le 403 est donc du code mort. **À retirer** (`// arkyo-server: mode fantôme SaaS`).
5. **Audit** : il n'y a **jamais** de `logAudit` dans ce lot. Les routes appellent `db.auditLog.create({ data: { userId: session.user.id, action, entityType, entityId, [before], [after], [projectId] } }).catch(e => console.warn("[audit] … skipped:", e))`. L'écriture se fait **hors transaction** et sans bloquer : un échec n'est que journalisé. Côté Rust, `crate::audit::log` (`crates/arkyo-server/src/audit.rs`) fait la même chose, dans la transaction.
6. **Temps réel, deux bus distincts** (détail au §3) :
   - `publishRackUpdate(rackId, payload)` (`lib/rack-events.ts:17`) alimente **seulement** `GET /api/racks/:id/events` ;
   - `publishAppUpdate(entity, action, id?, meta?)` (`lib/app-events.ts:120`) alimente `GET /api/events`. Payload : `{entity, action, id?, projectId?, rackId?, itemId?, clientId?, data?, tenantSlug?}`.
7. **`readClientIdFromRequest(req)`** (`lib/client-id.ts:88-98`) lit l'en-tête `x-client-id` ; une valeur vide donne `undefined`. On le retrouve dans `meta.clientId`.
8. **Formats d'erreur de validation** :
   - `parsed.error.flatten()` → `400 {"error": {"formErrors": [...], "fieldErrors": {...}}}` : c'est le cas de presque toutes les routes ;
   - `400 {"error":"Validation invalide","issues": zodIssuesFromError(err)}` : **seulement** `R/inventory` POST et `R/inventory/[itemId]` PATCH. `zodIssuesFromError` est défini en `lib/form-errors.ts:133-145` ; chaque issue vaut `{path:(string|number)[], message}`, et un chemin vide devient `["root"]`.
9. **Erreurs implicites, non interceptées, donc 500** :
   - `await req.json()` sans `.catch` → un JSON invalide donne 500. Seules exceptions : canvas-position:40, connections DELETE:226, synoptic-guides POST:63, guideId PATCH:43 ;
   - Prisma `update`/`delete` sur un id absent (ou d'un autre rack, quand le `where` contient `rackId`) → `P2025` → 500.
   Pour la parité, le serveur Rust doit au minimum renvoyer une erreur. Un 404 serait plus propre, mais à décider : arkyo répond 500 avec un corps non JSON.
10. **Identifiants fournis par le client** : `id: z.string().min(6).max(64).optional()` existe dans adapters, bundles, connections, labels et zones (POST). Lorsqu'il est fourni, il **sert de clé primaire** (création optimiste côté client). Le serveur Rust doit l'accepter tel quel, et générer un `cuid1` sinon.
11. **Tag tenant des évènements app** (`lib/app-events.ts:99-106` et `141-162`, résolution de `x-tenant-slug`) : **SaaS**, il disparaît (`crates/arkyo-server/src/events.rs` le fait déjà : mono-site, sans tag).

---

#### 1. Routes `app/api/racks/[id]/**`

##### 1.1 `R/adapters/route.ts` (92 LOC)

Schéma `createSchema` (`:10-19`) :

| champ | type | contraintes / défaut |
|---|---|---|
| `id` | string | min 6, max 64, optionnel (`:11`) |
| `adapterId` | string | **requis** (`:12`) ; il est enregistré dans `catalogAdapterId` |
| `x`, `y` | number | requis (`:13-14`) |
| `attachedSlotId` | string \| null | optionnel (`:15`) |
| `attachedSide` | `"left"\|"right"` \| null | optionnel (`:16`) |
| `attachedPortIndex` | int \| null | optionnel (`:17`) |
| `notes` | string \| null | optionnel (`:18`) |

###### `GET /api/racks/:id/adapters`
- Contrôle : session `:24-25`, aucune permission.
- Lit `SynopticAdapter where {rackId}`, sans tri (`:28-30`).
- Enrichit chaque adaptateur avec `fetchCatalogAdapterMap(catalogIds, db)` (`lib/services/catalog-enrich.ts:225-270`). Cette fonction lit d'abord `mainDb.catalogAdapter`, puis `TenantAdapter` en repli, et renvoie `{id,name,reference,imageUrl,inputs,outputs,notes,source:"ARKYO"|"PERSONAL"}`.
- Réponse 200 : `[{...SynopticAdapter, adapterId: catalogAdapterId, adapter: CatalogAdapterLite|null}]` (`:35-40`).
- SaaS : la lecture `mainDb` dans `fetchCatalogAdapterMap` devient une lecture directe de `TenantAdapter` ; `source` vaut toujours `"PERSONAL"` (convention de `crates/arkyo-server/src/http/catalogue/lookup.rs`).

###### `POST /api/racks/:id/adapters`
- Contrôle : session `:44-45` ; mode fantôme `:46-52` (à retirer).
- `clientId` lu `:55` ; erreur de validation `{error: flatten()}` 400 (`:58`).
- **Calcul** : `existingCount = count(SynopticAdapter where rackId)`, puis `label = "#ADP" + (existingCount+1)` (`:60-61`). Ce n'est pas un max+1 : après une suppression, des doublons sont possibles (comportement d'arkyo, à reproduire).
- Écrit `SynopticAdapter.create({rackId, label, catalogAdapterId: adapterId, ...rest})` ; `rest` contient `id` s'il est fourni (`:63-66`).
- Réponse 200 : l'objet enrichi `{...row, adapterId, adapter}` (`:69-76`, `:91`).
- Audit `:78-87` : `synopticAdapter.create` / `SynopticAdapter` / `created.id`.
- Évènements : rack `:89` `{type:"adapter_added", adapter: created}` ; app `:90` `("synopticAdapter","created", created.id, {rackId, itemId: created.id, clientId})`.
- Aucune vérification que `adapterId` existe au catalogue ni que le rack existe (la FK rack produirait un 500).

##### 1.2 `R/adapters/[adapterId]/route.ts` (89 LOC)

`patchSchema` (`:10-18`) : `x?`, `y?` number ; `attachedSlotId?` string|null ; `attachedSide?` enum left/right|null ; `attachedPortIndex?` int|null ; `label?` string|null ; `notes?` string|null.

###### `PATCH /api/racks/:id/adapters/:adapterId`
- Session `:23-24` ; fantôme `:25-31` ; clientId `:34` ; validation flatten 400 `:37`.
- `SynopticAdapter.update({where:{id: adapterId}, data})` (`:39-42`). **Le `where` ne contient pas `rackId`** : on peut modifier un adaptateur d'un autre rack. Un id absent donne P2025, donc 500.
- Réponse 200 : l'objet enrichi comme dans le GET (`:44-56`).
- Pas d'audit.
- Évènements : rack `:54` `{type:"adapter_updated", adapter: updated}` ; app `:55` `("synopticAdapter","updated", adapterId, {rackId, itemId: adapterId, clientId})`.
- SaaS : `mainDb` via `fetchCatalogAdapterMap`.

###### `DELETE /api/racks/:id/adapters/:adapterId`
- Session `:60-61` ; fantôme `:62-68` ; clientId `:71`.
- `SynopticAdapter.delete({where:{id: adapterId}})` (`:73`), là encore sans `rackId`. Les cascades FK font le reste : `RackConnection.fromAdapterId/toAdapterId` en `onDelete: Cascade` (`database/tenant/schema.prisma:709,724`), donc les câbles de l'adaptateur sont supprimés par la base.
- Réponse 200 `{ok:true}` (`:88`).
- Audit `:75-84` : `synopticAdapter.delete` / `SynopticAdapter` / `adapterId`.
- Évènements : rack `:86` `{type:"adapter_removed", adapterId}` ; app `:87` `("synopticAdapter","deleted", adapterId, {rackId, itemId: adapterId, clientId})`. **Aucun évènement `connection_removed`** pour les câbles supprimés en cascade.

##### 1.3 `R/audit/route.ts` (41 LOC)

###### `GET /api/racks/:id/audit?limit=100`
- Session `:12-13` ; aucune écriture.
- Paramètre `limit` : `Math.min(500, Math.max(1, Number(limit ?? 100)))` (`:18`). Une valeur non numérique donne `NaN`, d'où `take: NaN`, une erreur Prisma et probablement un 500.
- Lit `RackConnection where {rackId}` (ids) (`:21-25`), puis `AuditLog where OR[{entityType:"Rack", entityId: rackId}, {entityType:"RackConnection", entityId in connIds}]` (ou un sentinel `{id:"__never__"}`), tri `createdAt desc`, `take: limit` (`:27-38`).
- Réponse 200 : les lignes `AuditLog` brutes (`:40`).
- Les audits `RackSlot`, `RackZone`, `RackLabel`, `CableBundle`, `SynopticAdapter`, `ExternalPort` et `RackSlotPanelRow` de ce lot n'apparaissent **jamais** ici, pas plus que `rackConnection.deleteMany` (entityId = rackId mais entityType = RackConnection).

##### 1.4 `R/bundles/route.ts` (78 LOC)

`createSchema` (`:9-14`) : `id?` string 6..64 ; `name` string 1..120 (requis) ; `color?` string 1..16 ; `cableIds?` string[] (éléments min 1, max 500).

###### `GET /api/racks/:id/bundles`
- Session `:19-20`. Lit `CableBundle where {rackId}`, tri `createdAt asc` (`:23-26`). Réponse 200 : tableau brut.

###### `POST /api/racks/:id/bundles`
- Session `:31-32` ; fantôme `:33-39` ; clientId `:42` ; flatten 400 `:45`.
- `CableBundle.create({rackId, name, color: color ?? "#6366f1", id?})` (`:48-55`).
- Si `cableIds` est non vide : `RackConnection.updateMany({where:{rackId, id in cableIds}, data:{bundleId}})` (`:57-62`). Pas de transaction.
- Réponse 200 : le bundle (sans les câbles).
- Audit `:64-73` : `cableBundle.create` / `CableBundle` / `bundle.id`.
- Évènements : rack `:75` `{type:"bundle_added", bundle}` ; app `:76` `("cableBundle","created", bundle.id, {rackId, itemId: bundle.id, clientId})`. Aucun évènement `connection_updated` pour les câbles rattachés.

##### 1.5 `R/bundles/[bundleId]/route.ts` (99 LOC)

`updateSchema` (`:9-14`) : `name?` 1..120 ; `color?` 1..16 ; `addCableIds?` / `removeCableIds?` string[] max 500.

###### `PATCH /api/racks/:id/bundles/:bundleId`
- Session `:19-20` ; fantôme `:21-27` ; clientId `:30` ; flatten 400 `:33`.
- Si `name` ou `color` est fourni : `CableBundle.update({where:{id, rackId}, data:{name?, color?}})`, sinon `findUnique({where:{id}})` (`:36-39`). Dans le second cas, un id inconnu donne `updated = null` et la réponse vaut **`null` en 200**.
- `addCableIds` → `RackConnection.updateMany({rackId, id in add}, {bundleId})` (`:41-46`). `removeCableIds` → `updateMany({rackId, id in remove, bundleId}, {bundleId:null})` (`:47-52`).
- Réponse 200 : le bundle (ou `null`).
- Audit `:54-63` : `cableBundle.update` / `CableBundle` / `bundleId`.
- Évènements : rack `:65` `{type:"bundle_updated", bundle: updated}` ; app `:66` `("cableBundle","updated", bundleId, {rackId, itemId: bundleId, clientId})`.

###### `DELETE /api/racks/:id/bundles/:bundleId`
- Session `:71-72` ; fantôme `:73-79` ; clientId `:82`.
- `CableBundle.delete({where:{id, rackId}})` (`:83`). La FK `RackConnection.bundleId` est en `SetNull` (`schema.prisma:752`).
- Réponse 200 `{ok:true}`.
- Audit `:85-94` : `cableBundle.delete` / `CableBundle` / `bundleId`.
- Évènements : rack `:96` `{type:"bundle_removed", bundleId}` ; app `:97` `("cableBundle","deleted", bundleId, {rackId, itemId: bundleId, clientId})`.

##### 1.6 `R/canvas-position/route.ts` (67 LOC)

`patchSchema` (`:8-11`) : `canvasX?` number|null ; `canvasY?` number|null.

###### `PATCH /api/racks/:id/canvas-position`
- Session `:24-26` (`session?.user?.id`) ; fantôme `:28-34` ; clientId `:38`.
- Corps : `req.json().catch(() => ({}))` (`:40`), donc un JSON invalide équivaut à `{}`, qui passe. Validation flatten 400 `:42-43`.
- `Rack.findUnique({id}, select id)` ; s'il est absent → **404 `{"error":"Not found"}`** (`:45-49`).
- `Rack.update` : `canvasX`/`canvasY` = `Math.round(v)` ou `null`, seulement si la clé est fournie (`:51-62`). La sélection renvoyée est `{id, canvasX, canvasY}`.
- Réponse 200 `{id, canvasX, canvasY}` (`:66`).
- **Pas d'audit, pas d'évènement rack.**
- Évènement app `:64` `("rack","updated", id, {rackId: id, itemId: id, clientId})`.

##### 1.7 `R/connections/route.ts` (248 LOC)

`createSchema` (`:10-46`), où tous les champs sont optionnels :

| champ | type / contrainte |
|---|---|
| `id` | string 6..64 (`:12`) |
| `fromSlotId` | string\|null (`:14`) |
| `fromConnectorIndex` | int ≥ 0 \| null (`:15`) |
| `fromAdapterId` | string\|null (`:16`) |
| `fromAdapterSide` | enum left/right \| null (`:17`) |
| `fromAdapterPortIndex` | int ≥ 0 \| null (`:18`) |
| `fromComponentItemId` | string\|null (`:23`) |
| `toSlotId`, `toConnectorIndex`, `toAdapterId`, `toAdapterSide`, `toAdapterPortIndex`, `toComponentItemId` | symétriques (`:25-30`) |
| `label` | string\|null (`:31`) |
| `color` | string\|null (`:32`) |
| `waypoints` | `{x:number,y:number}[]` \| null (`:33-36`) |
| `cableStyle` | string\|null (`:37`) |

Raffinements :
- `:39-42` : si `fromComponentItemId` est présent, `fromSlotId` doit être vrai (truthy). Message « fromComponentItemId requiert fromSlotId (slot hôte) », path `["fromSlotId"]` ;
- `:43-46` : idem côté `to`, avec « toComponentItemId requiert toSlotId (slot hôte) ».

`batchCreateSchema` (`:204-206`) : `{connections: createSchema[] (min 1, max 500)}`. `batchDeleteSchema` (`:208-210`) : `{ids: string(min1)[] (min 1, max 500)}`.

Aide `findInvalidComponentItemId` (`:54-71`) : elle lit `RackInventoryItem where id in …` et renvoie le premier id introuvable, appartenant à un autre rack, ou dont `hostItemId == null` (pas un composant).

Les champs `notes`, `tags`, `catalogCableModelId`, `wired`, `bundleId` et `snapshotId` ne sont **pas** acceptés à la création. Zod retire les clés inconnues.

###### `GET /api/racks/:id/connections`
- Session `:76-77`. `RackConnection.findMany({rackId})`, sans tri (`:81`). Réponse 200 : tableau brut (`waypoints` et `tags` en JSON).

###### `POST /api/racks/:id/connections`
- Session `:86-87` ; fantôme `:88-94` ; clientId `:98` ; `req.json()` sans catch (`:99`).
- **Mode lot** si `batchCreateSchema` réussit (`:102-152`) :
  - un composant invalide → **400 `{"error":"fromComponentItemId/toComponentItemId invalide (<id>) : item introuvable, hors rack, ou pas un composant"}`** (`:114-121`) ;
  - `db.$transaction([...RackConnection.create({rackId, ...rest, label: c.label ?? null, waypoints?})])` (`:122-136`), en **transaction** ;
  - audit `:137-147` : `rackConnection.createMany` / entityType **`Rack`** / entityId `rackId` / `after: {ids, count}` ;
  - évènements : rack, **un par câble**, `:148-149` `{type:"connection_added", connection}` ; app **un seul** `:150` `("rackConnection","created", rackId, {rackId, clientId})`. L'`id` vaut le rackId et il n'y a pas d'`itemId` ;
  - réponse 200 : le tableau des connexions créées.
- **Mode unitaire** sinon (`:154-201`) :
  - flatten 400 `:155` ;
  - un composant invalide donne le même 400 que ci-dessus (`:166-173`) ;
  - `label = parsed.label ?? null` : **pas de numérotation automatique** à la création (`:175-177`) ;
  - `RackConnection.create({rackId, ...rest, label, waypoints?})` (`:180-187`) ;
  - audit `:188-197` : `rackConnection.create` / `RackConnection` / `connection.id` ;
  - évènements : rack `:199` `{type:"connection_added", connection}` ; app `:200` `("rackConnection","created", connection.id, {rackId, itemId: connection.id, clientId})` ;
  - réponse 200 : la connexion.
- Bizarrerie : un corps `{connections:[<invalide>]}` échoue en mode lot mais **passe `createSchema`**, puisque tous les champs sont optionnels et `connections` est retiré. On crée alors une connexion vide. Comportement d'arkyo.
- Aucune vérification que les slots ou adaptateurs existent dans le rack (une FK invalide donne un 500).

###### `DELETE /api/racks/:id/connections` (lot)
- Session `:213-214` ; fantôme `:215-221` ; clientId `:225` ; `req.json().catch(() => null)` (`:226`) ; flatten 400 `:228`.
- `RackConnection.deleteMany({rackId, id in ids})` (`:231`).
- Réponse 200 `{ok:true, count}` (`:247`).
- Audit `:233-243` : `rackConnection.deleteMany` / `RackConnection` / entityId **`rackId`** / `after: {ids, count}`.
- Évènements : rack, **un par id demandé** (même ceux qui n'existaient pas), `:245` `{type:"connection_removed", connId: id}` ; app `:246` `("rackConnection","deleted", rackId, {rackId, clientId})`.

##### 1.8 `R/connections/[connId]/route.ts` (181 LOC)

`updateSchema` (`:10-51`), où tout est optionnel :
- `label`, `color`, `cableStyle` : string|null (`:12,13,18`) ;
- `waypoints` : `{x,y}[]`|null (`:14-17`) ;
- `notes` : string **max 2000** |null (`:19`) ;
- `tags` : `{color: string max 16, text: string max 60}[]`|null (`:20-23`) ;
- `catalogCableModelId` : string|null (`:25`) ;
- extrémités `from*` / `to*`, comme dans le POST, mais `*ConnectorIndex` et `*PortIndex` sont **int sans `min(0)`** (`:30-42`).

Raffinements `:44-51` : `fromComponentItemId` avec `fromSlotId === null` explicite est refusé (« fromComponentItemId requiert fromSlotId (slot hôte) non-null ») ; idem côté `to` (« toComponentItemId requiert toSlotId (slot hôte) non-null »).

###### `PATCH /api/racks/:id/connections/:connId`
- Session `:81-82` ; fantôme `:83-89` ; clientId `:93` ; flatten 400 `:96`.
- Composant invalide : 400 avec le même message que le POST (`:102-110`).
- **Conversion de `null` en `undefined`** (`:116-118`) : pour tous les champs de `rest` (label, color, cableStyle, notes et toutes les extrémités), `null` signifie « ne pas modifier ». Avec ce PATCH, on **ne peut donc pas effacer** un label, une couleur ou des notes, ni détacher une extrémité. Comportement d'arkyo, à reproduire.
- Exceptions : `catalogCableModelId` (`null` est passé tel quel et le vide) (`:123`) ; `waypoints` et `tags` (`null` donne `Prisma.DbNull`, c'est-à-dire SQL NULL) (`:124-132`).
- `RackConnection.update({where:{id: connId, rackId}})` (`:119-134`) ; un id absent donne P2025, donc 500.
- Réponse 200 : la connexion.
- Audit `:135-144` : `rackConnection.update` / `RackConnection` / `connId`.
- Évènements : rack `:146` `{type:"connection_updated", connection}` ; app `:147` `("rackConnection","updated", connId, {rackId, itemId: connId, clientId})`.
- SaaS : le commentaire `:24` mentionne une « soft-FK cross-DB → main.CableModel » ; en local, ce sera `TenantCableModel`.

###### `DELETE /api/racks/:id/connections/:connId`
- Session `:152-153` ; fantôme `:154-160` ; clientId `:164`.
- `RackConnection.delete({where:{id: connId, rackId}})` (`:165`).
- Réponse 200 `{ok:true}`.
- Audit `:167-176` : `rackConnection.delete` / `RackConnection` / `connId`.
- Évènements : rack `:178` `{type:"connection_removed", connId}` ; app `:179` `("rackConnection","deleted", connId, {rackId, itemId: connId, clientId})`.

##### 1.9 `R/construction-checks/route.ts` (102 LOC)

`patchSchema` (`:10-14`) est une union discriminée sur `action` :
- `{action:"toggle", id: string 1..256}` ;
- `{action:"set", ids: string(1..256)[] max 10000}` ;
- `{action:"clear"}`.

###### `GET /api/racks/:id/construction-checks`
- Session `:17-18`. `Rack.findUnique select constructionChecks` ; s'il est absent → **404 `{"error":"Not found"}`** (`:22-26`).
- Réponse 200 `{checks: string[]}`. Une valeur JSON qui n'est pas un tableau donne `[]` (`:28-31`).

###### `PATCH /api/racks/:id/construction-checks`
- Session `:35-36` ; fantôme `:37-43` ; `req.json()` sans catch ; flatten 400 `:49`. **Pas de lecture de `clientId`.**
- Rack absent → 404 `{"error":"Not found"}` (`:52-56`).
- Calcul `next` : toggle (ajoute ou retire, `:64-67`), set (remplace, `:68-69`), clear (`[]`, `:70-73`).
- `Rack.update({constructionChecks: next.length === 0 ? Prisma.JsonNull : next})` (`:75-82`). Une liste vide est stockée comme **JSON `null`**, c'est-à-dire SQL NULL ou le texte `null` en SQLite ; à décider, la lecture tolère les deux.
- Réponse 200 `{checks}` (`:98-101`).
- Audit `:84-94` : `rack.constructionChecks.update` / `Rack` / `id` / `after: {action, count: next.length}`.
- Évènement **rack seulement** `:96` `{type:"construction_checks_updated"}`, **sans évènement app**.
- Lecture puis écriture sans transaction : course possible sur `toggle`.

##### 1.10 `R/events/route.ts` (58 LOC), flux SSE : voir le §3

###### `GET /api/racks/:id/events`
- **Pas d'appel direct à `auth()`**. `requireTenantDb()` est appelé dans un try/catch : en cas d'échec, la réponse est **`401` en texte brut `Unauthorized`**, pas en JSON (`:11-16`).
- `Rack.findUnique({id}, select id)` ; s'il est absent → **`404` en texte brut `Not found`** (`:17-18`).
- Le flux est détaillé au §3.

##### 1.11 `R/external-ports/route.ts` (101 LOC)

`createSchema` (`:10-18`) : `slotId` string min 1 (requis) ; `portIndex` int ≥ 0 (requis) ; `labelX?`, `labelY?` number|null ; `label?` string|null ; `kind?` enum `"INTER_LIEU"|"MONDE"`.

###### `GET /api/racks/:id/external-ports`
- Session `:23-24`. `ExternalPort.findMany({rackId})`, tri `createdAt asc`. Réponse 200 : tableau brut.

###### `POST /api/racks/:id/external-ports`
- Session `:35-36` ; fantôme `:37-43` ; clientId `:46` ; flatten 400 `:49`.
- `RackSlot.findFirst({id: slotId, rackId})` ; s'il est absent → **404 `{"error":"Slot introuvable dans ce rack"}`** (`:53-59`). Les enfants d'étagère sont acceptés.
- `ExternalPort.create({rackId, slotId, portIndex, labelX ?? null, labelY ?? null, label ?? null, kind: kind ?? "INTER_LIEU"})` (`:62-72`).
- Contrainte unique `(slotId, portIndex)` (`schema.prisma:690`) : P2002 → **409 `{"error":"Ce port est déjà marqué comme externe"}`** (`:93-98`).
- Réponse 200 : la ligne créée (`:91`).
- Audit `:74-83` : `externalPort.create` / `ExternalPort` / `created.id`.
- Évènements : rack `:85` `{type:"external_port_added", externalPort: created}` ; app `:86-90` `("external_port","created", created.id, {rackId, itemId, clientId})`. L'entité est en **snake_case**.

##### 1.12 `R/external-ports/[externalId]/route.ts` (97 LOC)

`patchSchema` (`:9-17`) : `labelX?`, `labelY?` number|null ; `label?` string|null ; `slotId?` string min 1 ; `portIndex?` int ≥ 0 ; `kind?` enum INTER_LIEU|MONDE.

###### `PATCH /api/racks/:id/external-ports/:externalId`
- Session `:22-23` ; fantôme `:24-30` ; clientId `:33` ; flatten 400 `:36`.
- `ExternalPort.update({where:{id, rackId}, data})` (`:38-41`). Aucune vérification que le nouveau `slotId` est dans le rack ; un P2002 (port déjà marqué) **n'est pas intercepté**, d'où un 500.
- Réponse 200 : la ligne.
- Audit `:43-52` : `externalPort.update` / `ExternalPort` / `externalId`.
- Évènements : rack `:54` `{type:"external_port_updated", externalPort: updated}` ; app `:55-59` `("external_port","updated", externalId, {rackId, itemId: externalId, clientId})`.

###### `DELETE /api/racks/:id/external-ports/:externalId`
- Session `:64-65` ; fantôme `:66-72` ; clientId `:75`.
- `ExternalPort.delete({where:{id, rackId}})` (`:77`).
- Réponse 200 `{ok:true}`.
- Audit `:79-88` : `externalPort.delete` / `ExternalPort` / `externalId`.
- Évènements : rack `:90` `{type:"external_port_removed", externalPortId: externalId}` ; app `:91-95` `("external_port","deleted", externalId, {rackId, itemId, clientId})`.

##### 1.13 `R/inventory/route.ts` (556 LOC), inventaire (BOM) en « mode gabarit de rack »

`postBodySchema` (`:32-51`) :

| champ | type / contrainte |
|---|---|
| `catalogEquipmentId` | string \| null, optionnel (`:33`) |
| `equipmentId` | string \| null, optionnel, alias historique (`:34`) |
| `panelId` | string \| null, optionnel (`:35`) |
| `catalogAdapterId` | string \| null, optionnel (`:36`) |
| `adapterId` | string \| null, optionnel, alias (`:37`) |
| `accessoryType` | enum `plaque\|etagere\|tiroir` \| null (`:38`) |
| `accessoryHeightU` | int 1..8 \| null (`:39`) |
| `accessoryVariant` | enum `plein\|pass-cable\|aere` \| null (`:40`) |
| `accessoryDepthMm` | int > 0 \| null (`:41`) |
| `quantity` | int ≥ 1, **défaut 1** (`:42`) |
| `hostItemId` | string \| null (`:45`) |
| `hostSlotIndex` | int ≥ 0 \| null (`:46`) |
| `cloneComponentsFromItemId` | string \| null (`:50`) |

`resolveInventoryRef` (`:53-64`) normalise `catalogEquipmentId ?? equipmentId` et `catalogAdapterId ?? adapterId`, puis appelle `validateInventoryRef` (`lib/services/rack-inventory.ts:208-303`). Cette fonction lève une `Error` avec message FR, renvoyée telle quelle en **400 `{"error": message}`** (`:371-376`, repli « Référence invalide »). Messages possibles :
- « Accessoire incomplet : type et hauteur U requis » (`rack-inventory.ts:239`) ;
- « Type d'accessoire invalide : attendu plaque, etagere ou tiroir » (`:245`) ;
- « Hauteur U d'accessoire invalide : attendu 1, 2, 3 ou 4 » (`:249`). Le texte annonce 1-4 alors que 1-8 est accepté ;
- « Variant requis pour les plaques » (`:257`) ;
- « Profondeur requise pour les étagères et tiroirs » (`:273`) ;
- « Profondeur invalide : valeur en mm > 0 attendue » (`:281`) ;
- « Référence catalogue manquante » (`:293`) ;
- « Plusieurs références catalogue fournies — exactement une attendue » (`:298`).

Services utilisés, tous dans `lib/services/rack-inventory-api.ts` :
- `inventorySelectFields` (`:479-493`) : id, catalogEquipmentId, panelId, `panel{id,name,panelType,heightU}`, catalogAdapterId, accessory*, quantity, snapshotId, hostItemId, hostSlotIndex ;
- `enrichRowsForTemplate(rows, db)` (`:293-462`) produit des `BomItemDto` (`:25-60`). Elle lit `mainDb.catalogEquipment`, `catalogAdapter`, `catalogBrand` et `catalogEquipmentCategory`, avec repli sur `TenantEquipment`, `TenantAdapter`, `TenantBrand` et `TenantEquipmentCategory`. **Les lignes orphelines** (référence catalogue introuvable) **sont retirées** de la sortie. Les champs du DTO sont `id, kind, refId?, accessoryType?, accessoryHeightU?, accessoryVariant?, accessoryDepthMm?, quantity, name, reference, imageUrl, brandName, heightU, widthFraction, panelType, weightKg, powerW, depthMm, isRackable, category, snapshotId(null), hostItemId, hostSlotIndex, isComponentHost, hostSlotCount, isComponent, componentSlotSpan`. Les noms d'accessoires viennent de `formatAccessoryName` (`:85-108`) : « Plaque pleine 2U », « Étagère 1U · 450mm »… ;
- `resolveComponentEquipmentFields(db, eqId)` (`:511-535`) : lecture main d'abord, repli tenant, et renvoie `{isComponentHost, hostSlotCount, isComponent, componentSlotSpan}` ;
- `resolveComponentSpansBatch` (`:538-558`).

Synchronisation des slots : `syncInventorySlots(db, itemId)` (`lib/services/rack-inventory-sync.ts:72-192`) garantit que `count(RackSlot where inventoryItemId) == quantity`, uniquement pour les équipements et panels.
- Création de slots fantômes (`startU/heightU = null`, `view FRONT`, `widthFraction FULL`, `column 0`) avec un label `#XXXX` unique dans le rack, produit par `generateUniqueLabel` (`lib/services/auto-label.ts:18-28`, alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, 100 essais puis repli horodaté).
- Suppression de l'excédent, par priorité : fantôme sans câble, fantôme câblé, placé sans câble, placé câblé. Les câbles partent en cascade FK. Les avertissements sont ignorés par les routes.

###### `GET /api/racks/:id/inventory`
- Session `:320-322`. Rack absent → 404 `{"error":"Not found"}` (`:328-329`).
- `RackInventoryItem.findMany({rackId}, orderBy createdAt asc, select inventorySelectFields)`, puis `enrichRowsForTemplate`.
- Réponse 200 `{items: BomItemDto[]}` (`:338`).

###### `POST /api/racks/:id/inventory`
- Session `:344-346` ; fantôme `:348-354` ; rack absent → 404 « Not found » (`:359-360`) **avant** la validation ; `req.json()` sans catch.
- Validation : **400 `{"error":"Validation invalide","issues":[…]}`** (`:364-368`). Une référence invalide donne 400 avec le message de `validateInventoryRef`.
- **Pas de lecture de `clientId`** : aucun évènement de cette route ne porte `clientId`.
- Branche **composant** (`:381-395`) : dès que `hostItemId` ou `hostSlotIndex` est non nul.
  - Un seul des deux → **400 « hostItemId et hostSlotIndex doivent être fournis ensemble »** (`:382-387`).
  - `handleComponentPlacement` (`:73-200`) :
    - si la référence n'est pas un équipement → 400 « Seul un équipement peut être installé comme composant » (`:85-90`) ;
    - hôte absent du rack → 404 « Not found » (`:96`) ;
    - l'hôte est lui-même un composant → 400 « Impossible d'imbriquer un composant dans un composant » (`:97-102`) ;
    - l'hôte n'a pas de `catalogEquipmentId` → 400 « Cet équipement ne peut pas accueillir de composants » (`:103-108`) ;
    - l'équipement hôte n'est pas `isComponentHost` ou n'a pas de `hostSlotCount` → même message 400 (`:110-116`) ;
    - équipement composant introuvable → 404 « Équipement composant introuvable » (`:118-121`) ;
    - `span = componentSlotSpan ?? 1` ; `hostSlotIndex + span > hostSlotCount` → 400 « Composant hors des limites de l'équipement modulaire » (`:122-129`) ;
    - chevauchement d'intervalles avec les composants existants → **409 « Slot occupé »** (`:131-152`) ;
    - `RackInventoryItem.create({rackId, catalogEquipmentId: refId, hostItemId, hostSlotIndex, snapshotId: null, quantity: 1})` (`:154-165`). **Pas de `syncInventorySlots`.** Enrichissement ; s'il n'y a pas d'item → **500 « Référence catalogue introuvable après création. »** (`:167-173`), alors que **la ligne est déjà créée** (pas de retour arrière) ;
    - audit `:175-195` : `create_inventory_item` / `RackInventoryItem` / `item.id` / `after: {rackId, mode:"template", refKind, refId, quantity, hostItemId, hostSlotIndex}` ;
    - évènement app `:197` `("rack_inventory","updated", rackId, {rackId, itemId: item.id})` ;
    - réponse **201 `{item}`**.
- Branche **châssis hôte** (`:399-409`) : référence équipement et `resolveComponentEquipmentFields(...).isComponentHost`. Appelle `handleHostEquipmentPlacement` (`:211-315`) :
  - si `cloneComponentsFromItemId` est fourni : la source doit être dans le rack, sinon 400 « Exemplaire source introuvable dans ce rack » (`:228-233`), et ne pas être un composant, sinon 400 « Impossible de dupliquer depuis un composant » (`:234-239`) ;
  - création `{rackId, catalogEquipmentId, snapshotId: null, quantity: 1}`. La quantité demandée est **ignorée** : pas de dédoublonnage ni de fusion (`:242-251`) ;
  - clonage : `createMany` des composants de la source (`catalogEquipmentId`, `hostSlotIndex`, `hostItemId` = nouvel id, `quantity: 1`) (`:253-272`) ;
  - enrichissement ; un échec donne 500 « Référence catalogue introuvable après création. » (`:274-280`) ;
  - `syncInventorySlots(db, raw.id)` avec `.catch` qui avertit seulement (`:285-287`) ;
  - audit `:289-310` : `create_inventory_item` / `RackInventoryItem` / `item.id` / `after: {rackId, mode:"template", refKind:"equipment", refId, quantity, [clonedComponentsFrom, clonedComponentCount]}` ;
  - évènement app `:312` `("rack_inventory","updated", rackId, {rackId, itemId: item.id})` ;
  - réponse **201 `{item}`**.
- Branche **normale** (`:411-511`) :
  - dédoublonnage : on cherche une ligne existante avec `(rackId, catalogEquipmentId)`, `(rackId, panelId)`, `(rackId, catalogAdapterId)` ou `(rackId, accessoryType, accessoryHeightU, accessoryVariant ?? null, accessoryDepthMm ?? null)` (`:411-439`) ;
  - si elle existe : `update quantity += quantity ?? 1` (`:442-447`). Sinon, pour un accessoire : `create {rackId, accessory*, quantity}` (`:448-459`). Sinon : `create {rackId, catalogEquipmentId|panelId|catalogAdapterId, snapshotId:null, quantity}` (`:460-473`) ;
  - enrichissement ; un échec donne 500 « Référence catalogue introuvable après création. » (`:475-481`), par exemple pour un `panelId` inexistant ;
  - `syncInventorySlots` si la ligne a un `catalogEquipmentId` ou un `panelId` (`:484-488`) ;
  - audit `:490-507` : `create_inventory_item` / `RackInventoryItem` / `item.id` / `after: {rackId, mode:"template", quantity, refKind}` ;
  - évènement app `:509` `("rack_inventory","updated", rackId, {rackId, itemId: item.id})` ;
  - réponse **`{item}`, en 200 si fusion, 201 si création** (`:511`).
- **Aucun évènement rack** (`slot_added`) pour les slots fantômes créés par la synchronisation.
- SaaS : `snapshotId: null` aux lignes `:161`, `:247`, `:266`, `:468` (colonne SaaS, laissée NULL ou absente) ; `mainDb` partout dans `rack-inventory-api.ts` (`:17`, `:306`, `:329`, `:342`, `:412`, `:515`, `:544`). En local, tout se lit dans `TenantEquipment`, `TenantAdapter`, `TenantBrand` et `TenantEquipmentCategory`.

###### `DELETE /api/racks/:id/inventory` (vide l'inventaire entier)
- Session `:517-519` ; fantôme `:521-527` ; rack absent → 404 « Not found » (`:532-533`).
- `RackInventoryItem.deleteMany({rackId})` (`:535`). FK : `RackSlot.inventoryItemId` en **SetNull** (`schema.prisma:572`), donc les slots, **y compris les fantômes** (`startU` null), survivent sans `inventoryItemId` (aucun nettoyage, contrairement au DELETE unitaire). Les composants partent en cascade (`hostItemId` Cascade), de même que les câbles `from/toComponentItemId` (Cascade).
- Si `count > 0` : audit `:538-550` `clear_inventory` / entityType **`Rack`** / `rackId` / `after: {rackId, mode:"template", deletedCount}` ; évènement app `:552` `("rack_inventory","updated", rackId, {rackId})`.
- Réponse 200 `{deletedCount}` (`:555`).

##### 1.14 `R/inventory/[itemId]/route.ts` (189 LOC)

`patchBodySchema` (`:20-22`) : `quantity` int ≥ 1, **requis**. Aide `assertItemBelongsToRack` (`:24-34`).

###### `PATCH /api/racks/:id/inventory/:itemId`
- Session `:39-41` ; fantôme `:43-49`.
- L'item n'est pas dans le rack → 404 « Not found » (`:54-55`), **avant** la validation.
- Validation **400 `{"error":"Validation invalide","issues"}`** (`:58-63`).
- L'item est un composant (`hostItemId != null`) → **400 « La quantité d'un composant installé est fixe »** (`:67-76`).
- `resolveIsComponentHost(db, catalogEquipmentId)` (`rack-inventory-api.ts:561-567`) ; s'il est vrai → **400 « Un châssis s'ajoute par exemplaire — ajoutez ou supprimez des exemplaires. »** (`:80-91`).
- `RackInventoryItem.update({quantity})` (`:93-96`), puis `syncInventorySlots` si équipement ou panel (`:98-102`). Peut **supprimer des slots placés et câblés**.
- Réponse 200 **`{item}` = ligne Prisma brute, non enrichie** (toutes les colonnes de `RackInventoryItem`) (`:120`).
- Audit `:104-116` : `update_inventory_item` / `RackInventoryItem` / `item.id` / `after: {quantity, mode:"template"}`.
- Évènement app `:118` `("rack_inventory","updated", rackId, {rackId, itemId})`. Pas de clientId, pas d'évènement rack.
- SaaS : `mainDb` via `resolveIsComponentHost`.

###### `DELETE /api/racks/:id/inventory/:itemId`
- Session `:126-128` ; fantôme `:130-136` ; l'item n'est pas dans le rack → 404 « Not found » (`:141-142`).
- Nettoyage manuel : les `RackSlot` liés avec `startU === null` et **sans** câble sont supprimés (`:147-168`). Les autres survivent grâce au SetNull.
- `RackInventoryItem.delete` (`:170`). Les composants (enfants via `hostItemId`) et leurs câbles partent en cascade.
- Réponse 200 `{ok:true}`.
- Audit `:172-184` : `delete_inventory_item` / `RackInventoryItem` / `itemId` / **`before`**: `{rackId, itemId, mode:"template"}`.
- Évènement app `:186` `("rack_inventory","updated", rackId, {rackId, itemId})`.

##### 1.15 `R/labels/route.ts` (68 LOC)

`createSchema` (`:9-23`) :
- `id?` 6..64 ;
- `text` string, **défaut « Libellé »** ;
- `x`, `y` number, requis ;
- `fontSize` int, **défaut 14** ;
- `color` string, **défaut `#111827`** ;
- `fontWeight` string, **défaut `normal`** ;
- `fontFamily?` string|null ;
- `fontStyle?` enum normal|italic ;
- `textDecoration?` enum none|underline ;
- `pill?` boolean ;
- `pillBg?` string|null ;
- `pillRadius?` int 0..64.

Les défauts Prisma complètent le reste (`schema.prisma:640-653`) : fontStyle normal, textDecoration none, pill false, pillRadius 12. Le POST n'accepte pas `width`.

###### `GET /api/racks/:id/labels`
- Session `:28-29`. `RackLabel.findMany({rackId}, createdAt asc)`. Réponse 200 : tableau.

###### `POST /api/racks/:id/labels`
- Session `:37-38` ; fantôme `:39-45` ; clientId `:48` ; flatten 400 `:51`.
- `RackLabel.create({rackId, ...parsed})` (`:52`).
- Réponse 200 : le label.
- Audit `:54-63` : `rackLabel.create` / `RackLabel` / `label.id`.
- Évènements : rack `:65` `{type:"label_added", label}` ; app `:66` `("rackLabel","created", label.id, {rackId, itemId, clientId})`.

##### 1.16 `R/labels/[labelId]/route.ts` (90 LOC)

`updateSchema` (`:9-23`), tout optionnel : `text`, `x`, `y`, `fontSize` (int), `width` (number|null), `color`, `fontWeight`, `fontFamily` (string|null), `fontStyle` (normal|italic), `textDecoration` (none|underline), `pill` (bool), `pillBg` (string|null), `pillRadius` (int 0..64).

###### `PATCH /api/racks/:id/labels/:labelId`
- Session `:28-29` ; fantôme `:30-36` ; clientId `:39` ; flatten 400 `:42`.
- `RackLabel.update({where:{id, rackId}})` (`:43`).
- Réponse 200 : le label.
- Audit `:45-54` : `rackLabel.update` / `RackLabel` / `labelId`.
- Évènements : rack `:56` `{type:"label_updated", label}` ; app `:57` `("rackLabel","updated", labelId, {rackId, itemId, clientId})`.

###### `DELETE /api/racks/:id/labels/:labelId`
- Session `:62-63` ; fantôme `:64-70` ; clientId `:73`.
- `RackLabel.delete({id, rackId})` (`:74`).
- Réponse 200 `{ok:true}`.
- Audit `:76-85` : `rackLabel.delete` / `RackLabel` / `labelId`.
- Évènements : rack `:87` `{type:"label_removed", labelId}` ; app `:88` `("rackLabel","deleted", labelId, {rackId, itemId, clientId})`.

##### 1.17 `R/panel-rows/route.ts` (102 LOC)

`upsertSchema` (`:9-14`) : `slotId` string ; `rowIndex` int ≥ 0 ; `x`, `y` number (tous requis).

###### `GET /api/racks/:id/panel-rows`
- Session `:19-20`.
- Lit `RackSlotPanelRow where slot.rackId`, avec `slot.panel.heightU` (`:29-32`).
- **Écriture dans un GET** : purge des lignes orphelines dont le slot n'a pas de panel, ou dont `rowIndex >= panel.heightU`, par `deleteMany` (`:33-54`). Aucun audit ni évènement.
- Réponse 200 : `[{id, slotId, rowIndex, synopticX, synopticY, createdAt, updatedAt}]`.

###### `POST /api/racks/:id/panel-rows` (upsert)
- Session `:59-60` ; fantôme `:61-67` ; clientId `:71` ; flatten 400 `:74`.
- `RackSlot.findFirst({id: slotId, rackId})` ; s'il est absent → **404 `{"error":"Slot not found"}`** (en anglais, `:79-80`).
- `RackSlotPanelRow.upsert` sur l'unique `(slotId,rowIndex)` (`schema.prisma:780`), avec `synopticX=x`, `synopticY=y` (`:82-86`).
- Réponse 200 : la ligne.
- Audit `:88-97` : `rackSlotPanelRow.upsert` / `RackSlotPanelRow` / `row.id`.
- Évènements : rack `:99` `{type:"panelrow_updated", slotId, rowIndex, x, y}` ; app `:100` `("rackSlotPanelRow","updated", row.id, {rackId, itemId: row.id, clientId})`.

##### 1.18 `R/renumber/route.ts` (472 LOC), numérotation des câbles

Schémas :
- `overrideSchema` (`:14-27`, `.partial()`) : `includeRack?` bool ; `pad?` int 1..10 ; `sep1?`, `sep2?` string max 5 ; `template?` string max 500 ; `templateEnabled?` bool ; anciens champs `includeZone?` bool, `separator?` string, `suffixSeparator?` string ;
- `renumberSchema` (`:29-47`) est une **union, et la première variante valide l'emporte** :
  1. `{clearOnly: true}` (littéral) ;
  2. `{clearIds: string[]}` ;
  3. `{manualLabels: {id: string min1, label: string}[] min 1 max 500}` ;
  4. `{orderedIds: string[], sideMap?: Record<string,"left"|"right">, onlyUnlabelled?: bool, partial?: bool, override?: overrideSchema}`.

###### `POST /api/racks/:id/renumber`
- Session `:73-74` ; fantôme `:75-81` ; clientId `:85` ; `req.json()` sans catch ; flatten 400 `:88`.
- **clearOnly** (`:91-105`) : `RackConnection.updateMany({rackId}, {label:null})`. Audit `rackConnection.clearLabels` / `Rack` / `rackId` (`:93-102`). App `:103` `("rackConnection","updated", rackId, {rackId, clientId})`. Réponse `{ok:true}`.
- **manualLabels** (`:108-129`) : `$transaction` de `RackConnection.update({where:{id, rackId}, data:{label}})`. Un id absent donne P2025, d'où un 500 et le retour arrière de toute la transaction. Audit `rackConnection.manualNumber` / `Rack` / `rackId` (`:116-125`). App `:126` (même forme). Réponse : `RackConnection.findMany({rackId, id in ids})`.
- **clearIds** (`:132-149`) : `updateMany({rackId, id in clearIds}, {label:null})`. Audit `rackConnection.clearLabels` / `Rack` / `rackId`. App `:147`. Réponse `{ok:true}`.
- **orderedIds** (`:151-471`) :
  - `orderedIds` vide → `{ok:true}` **sans audit ni évènement** (`:158`) ;
  - lectures parallèles (`:161-185`) : `Rack {id, name, cableCode, numberingOverride, zones{id,label,x,y,w,h}}` ; `AppConfig where key in ADMIN_CONFIG_KEYS` (`:51-60` : `cable_pad`, `cable_sep1`, `cable_sep2`, `cable_separator`, `cable_suffix_separator`, `cable_include_rack`, `cable_template`, `cable_template_enabled`) ; **`mainDb.catalogSignalType.findMany`** `{id, name, cablePrefix, cableSuffix, functionId, function{cablePrefix, cableSuffix}}` ;
  - rack absent → **404 `{"error":"Rack not found"}`** (`:187`) ;
  - configuration effective = `adminDefaults` < `rack.numberingOverride` < `body.override` (`:190-206`). Défauts : `pad = clamp(Number(cable_pad ?? 5), 3, 10)` ; `sep1 = cable_sep1 ?? cable_separator ?? "-"` ; `sep2 = cable_sep2 ?? cable_suffix_separator ?? ""` ; `includeRack = cable_include_rack !== "false"` ; `template = cable_template ?? ""` ; `templateEnabled = cable_template_enabled === "true"` ;
  - `rackCode = normZoneOrRack(cableCode, 5) ?? normZoneOrRack(name, 4)`. La normalisation (`:62-69`) passe en majuscules et ne garde que `[A-Z0-9]`, tronqué à la longueur maximale ;
  - slots `{id, synopticX, synopticY, catalogEquipmentId}` (`:213-221`), puis **`mainDb.catalogEquipment.findMany({id in …}, select {id, connectors})`** (`:227-233`), **sans repli tenant**. Dans arkyo, un équipement du catalogue perso n'a donc ni signal ni préfixe à la renumérotation ;
  - zone d'un slot = première zone qui contient géométriquement `(synopticX, synopticY)`, puis `normZoneOrRack(label, 4)` (`:246-260`). **Le résultat est calculé mais ignoré** par `computeCableLabel`, qui ne déstructure pas `zoneCode` : la zone est retirée de la convention ;
  - `getConnectorInfo(connectors, portIndex)` (`:285-303`) aplatit les entrées `{signalName, direction, quantity}` selon `quantity`, et renvoie `signalName` et `direction` en majuscules. **Seules les extrémités slot comptent** : adaptateurs et composants sont ignorés ;
  - `resolveSignalPrefixSuffix` (`:316-331`) : préfixe et suffixe du signal (par nom), sinon ceux de la fonction parente, sinon `""` ;
  - compteur par clé `${prefix || "__nosig__"}:${dirDigit}`. `dirDigit` vaut `"3"` si l'une des extrémités est BIDI ; sinon `sideMap[id] ?? "left"` donne `"1"` pour left et `"2"` pour right (`:394-396`) ;
  - mode `partial` (`:340-367`) : les compteurs démarrent depuis les labels hors sélection. On extrait `/(\d{1,10})(?:[^\d]*)?$/`, puis `parseInt(m[1].slice(1))`, ce qui **retire le premier chiffre**, c'est-à-dire `dirDigit` ;
  - `onlyUnlabelled` (`:405-418`) : un câble déjà labellisé est conservé, et son numéro fait avancer le compteur ;
  - génération (`:421-446`) : `num = compteur + 1`, puis `computeCableLabel(...)` (`lib/services/cable-numbering.ts:541-580`) en boucle. Si le label existe déjà (`allExistingLabels`, qui inclut les labels **actuels des câbles renumérotés eux-mêmes**) ou a déjà été attribué dans la passe, on incrémente ; garde à 10 000 essais ;
  - `computeCableLabel` : `numBlock = dirDigit + String(seq).padStart(max(1, pad-1), "0")`. En mode gabarit (`templateEnabled` et `template` non vide), il remplace `{rack|sep1|prefix|dir|seq|sep2|suffix|zone}` ; dans ce mode, `seq` vaut `padStart(pad)` **sans** dir, et `zone` vaut `""`. Sinon : `[rack+sep1 si includeRack && rackCode][prefix][numBlock][sep2+suffix si suffix]`. Les séparateurs se résolvent par `sep1 ?? separator ?? ""` et `sep2 ?? suffixSeparator ?? ""` ;
  - écriture : `$transaction` de `RackConnection.update({where:{id, rackId}, data:{label}})` (`:449-455`) ;
  - réponse 200 : **toutes** les connexions du rack (`findMany({rackId})`, `:457`) ;
  - audit `:459-468` : `rackConnection.renumber` / `Rack` / `rackId` ;
  - app `:470` `("rackConnection","updated", rackId, {rackId, clientId})`.
- **Aucun évènement rack** dans toute la route : le SSE du rack ne voit pas les renumérotations.
- **Le champ `Rack.cableNextNum` n'est pas utilisé ici.**
- SaaS : `mainDb` aux lignes `:4`, `:173-184` (`catalogSignalType`) et `:229-232` (`catalogEquipment`). En local : `TenantSignalType` (`cablePrefix`, `cableSuffix`, `functionId`), plus `TenantFunction` (`cablePrefix`, `cableSuffix`) en jointure sur `functionId`, plus `TenantEquipment.connectors`. **Écart de comportement à trancher** : arkyo ignore le catalogue perso, tandis qu'en local tout le catalogue est « perso ». Le bon choix est la lecture locale, conformément au §4.7 de la spec.

##### 1.19 `R/slots/route.ts` (308 LOC)

`createSchema` (`:12-34`) :

| champ | type / contrainte / défaut |
|---|---|
| `catalogEquipmentId` | string min 1, optionnel (`:14`) |
| `equipmentId` | string min 1, optionnel, alias historique (`:15`) |
| `panelId` | string min 1, optionnel (`:16`) |
| `parentSlotId` | string min 1, optionnel (`:17`) |
| `inventoryItemId` | string min 1, optionnel (`:23`) |
| `view` | enum `FRONT\|REAR\|REAR_INTERIOR\|SIDE`, **défaut FRONT** (`:24`) |
| `startU` | int ≥ 1, **requis** (`:25`) |
| `heightU` | number > 0, optionnel (`:26`) |
| `widthFraction` | enum `FULL\|HALF\|THIRD\|QUARTER`, **défaut FULL** (`:27`) |
| `column` | int 0..3, **défaut 0** (`:28`) |
| `label`, `notes` | string, optionnels (`:29-30`) |

Raffinement `:32-34` : il faut `catalogEquipmentId`, `equipmentId`, `panelId`, ou bien `label && heightU`. Sinon : message « catalogEquipmentId, panelId, or (label + heightU) required », dans `formErrors`.

`panelInclude` (`:36-55`) : `panel {id, name, heightU, slotsPerU, rearCableDepthMm, slots{id, position, sizeSlots, label, notes, catalogConnectorTypeId, mountD}}`.

###### `DELETE /api/racks/:id/slots` (vide le rack)
- Session `:58-59` ; fantôme `:60-66` ; clientId `:70`.
- Suppressions manuelles **séquentielles, sans transaction** (`:78-83`) : `RackConnection`, `SynopticAdapter`, `RackZone`, `RackLabel`, `CableBundle` (tous `where rackId`), puis `RackSlotPanelRow where slot.rackId`.
- Les slots liés à l'inventaire (`inventoryItemId != null`) deviennent des **fantômes** (`:86-99`) : `startU`, `heightU`, `label`, `notes` et `patchNotes` à `null`, `column` à 0, `panelLabels` à DbNull, `synopticX/Y` à `null`.
- Les autres slots sont supprimés (`:101`). Les `ExternalPort` des slots supprimés partent en cascade, mais **ceux des slots devenus fantômes restent**. Les `SynopticGuide` et `RackInventoryItem` sont conservés.
- `Rack.update({constructionChecks: []})` (`:102`) : un **tableau vide**, et non `JsonNull` comme dans construction-checks.
- Réponse 200 `{ok:true}`.
- Audit `:104-113` : `rackSlot.clearAll` / `RackSlot` / entityId `rackId`.
- Évènements : rack `:115` `{type:"rack_cleared"}` ; app `:116` `("slot","deleted", rackId, {rackId, clientId})`.

###### `POST /api/racks/:id/slots` (placement)
- Session `:122-123` ; fantôme `:124-130` ; clientId `:134` ; `req.json()` sans catch ; flatten 400 `:137`.
- `resolvedCatalogEquipmentId = catalogEquipmentId ?? equipmentId` (`:140`).
- Si `heightU` est absent : **`mainDb.catalogEquipment.findUnique(heightU)`** donne `?? 1` (`:144-149`), **sans repli tenant** (un équipement perso aurait 1U). Pour un panel : `Panel.findUnique(heightU) ?? 1` (`:150-153`).
- Validation du `parentSlotId` (`:159-175`) :
  - `RackSlot.findUnique({id, rackId}, _count children)` ; s'il est absent → **400 « Parent shelf not found »** ;
  - `JSON.parse(parent.notes ?? "{}").accessoryType !== "etagere"`, ou un JSON invalide → **400 « Parent slot is not a shelf »** ;
  - `children >= 10` → **400 « Maximum 10 équipements par étagère »**.
- **Couplage avec l'inventaire** (`:218-259`) : `canClaimGhost = (equipement || panelId) && !parentSlotId`.
  - Oui : `ensureGhostSlotForEquipment` ou `ensureGhostSlotForPanel` (`rack-inventory-sync.ts:252-345`). Cette fonction cherche le plus ancien fantôme de cette référence. À défaut, elle cherche ou crée l'item d'inventaire, incrémente sa quantité, appelle `syncInventorySlots` et reprend le fantôme ; un échec lève une `Error` (500). On fait ensuite `RackSlot.update(ghost.slotId, {...rest, heightU})`. Les **défauts de `view`, `widthFraction` et `column` écrasent** les valeurs du fantôme ; un `inventoryItemId` du corps est écrit s'il est fourni. `wasGhostPromoted = !quantityIncremented`.
  - Non : `RackSlot.create({...rest, rackId, heightU, catalogEquipmentId?, panelId?, parentSlotId?})`.
  - Sélection `slotSelect` (`:177-207`) : id, rackId, catalogEquipmentId, panelId, parentSlotId, view, startU, heightU, widthFraction, column, label, notes, patchNotes, panelLabels, synopticX, synopticY, createdAt, updatedAt, `panel` (panelInclude), `children{id, catalogEquipmentId, heightU, widthFraction, synopticX, synopticY}`. **`inventoryItemId` n'est pas renvoyé.**
- Enrichissement (`:262-275`) : **`mainDb.catalogEquipment`** `{id, name, reference, heightU, widthFraction, brandId}` puis **`mainDb.catalogBrand`** `{id, name}`, ce qui donne `equipment: {id, name, reference, heightU, widthFraction, brand:{id,name}|null} | null`. Pas de repli tenant.
- Réponse **201** `{...slot, equipment}` (`:307`).
- Audit `:277-286` : `rackSlot.create` / `RackSlot` / `slot.id`, même en cas de promotion d'un fantôme.
- Évènements :
  - rack `:291-294` `{type: wasGhostPromoted ? "slot_updated" : "slot_added", slot: enrichedSlot}` ;
  - app `:295-298` `("slot", wasGhostPromoted ? "updated" : "created", slot.id, {rackId, clientId})`, **sans itemId** ;
  - si la quantité a été incrémentée : app `:299-305` `("rack_inventory","updated", rackId, {rackId, itemId: claimedInventoryItemId, clientId})`.
- SaaS : `mainDb` aux lignes `:4`, `:145`, `:264`, `:270`. En local : `TenantEquipment` et `TenantBrand`. `crates/arkyo-server/src/projects/enrich.rs:305` (`slot_equipment`) produit déjà cette forme.

##### 1.20 `R/slots/[slotId]/route.ts` (253 LOC)

`updateSchema` (`:11-21`) : `startU?` int ≥ 1 ; `view?` enum FRONT|REAR|REAR_INTERIOR|SIDE ; `widthFraction?` enum FULL|HALF|THIRD|QUARTER ; `column?` int 0..3 ; `label?`, `notes?` string|null ; `panelLabels?` `Record<string, unknown>`|null ; `synopticX?`, `synopticY?` number|null. `heightU` n'est pas modifiable, et `startU` ne peut pas passer à null : le dé-placement passe par DELETE.

###### `PATCH /api/racks/:id/slots/:slotId`
- Session `:47-48` ; fantôme `:49-55` ; clientId `:59` ; flatten 400 `:62`.
- `RackSlot.update({where:{id, rackId}})` ; `panelLabels: null` donne DbNull (`:64-107`). Même sélection que pour le POST.
- Enrichissement `equipment` via **`mainDb`** (`:110-123`).
- Réponse 200 `{...slot, equipment}`.
- Audit `:125-134` : `rackSlot.update` / `RackSlot` / `slotId`.
- Évènements : rack `:136` `{type:"slot_updated", slot: enrichedSlot}` ; app `:137` `("slot","updated", slotId, {rackId, itemId: slotId, clientId})`.

###### `DELETE /api/racks/:id/slots/:slotId`
- Session `:143-144` ; fantôme `:145-151` ; clientId `:155`.
- `RackSlot.findUnique({id, rackId}, select id, inventoryItemId, parentSlotId)` ; s'il est absent → **404 `{"error":"Slot introuvable"}`** (`:166-172`).
- Adaptateurs rattachés (`attachedSlotId = slotId`, FK SetNull, d'où le nettoyage manuel) : `deleteMany RackConnection` sur `from/toAdapterId in ids`, puis `deleteMany SynopticAdapter` (`:175-185`).
- **Cas inventaire** (`inventoryItemId` non nul, `:188-229`) :
  - `deleteMany RackConnection` sur `from/toSlotId = slotId`, puis `deleteMany RackSlotPanelRow` du slot ;
  - le slot devient un fantôme (mêmes champs que pour le vidage du rack) ;
  - `ExternalPort` et enfants d'étagère **conservés** ;
  - audit `rackSlot.unplace` / `RackSlot` / `slotId` (`:211-220`) ;
  - rack `:222-226` `{type:"slot_removed", slotId, removedAdapterIds}` ; app `:227` `("slot","deleted", slotId, {rackId, itemId: slotId, clientId})` ;
  - réponse 200 **`{ok:true, unplaced:true}`**.
- **Cas libre** (`:232-252`) : `RackSlot.delete({id, rackId})`. Les FK suppriment en cascade les câbles (`fromSlot`/`toSlot`), les panel-rows, les `ExternalPort` et les enfants d'étagère (`parentSlot` Cascade).
  - Audit `rackSlot.delete` / `RackSlot` / `slotId` (`:234-243`).
  - Rack `:245-249` `{type:"slot_removed", slotId, removedAdapterIds}` ; app `:250`, même forme que ci-dessus.
  - Réponse 200 `{ok:true}`.
- Aucun évènement `connection_removed` pour les câbles supprimés.

##### 1.21 `R/zones/route.ts` (72 LOC)

`createSchema` (`:9-27`) :
- `id?` 6..64 ;
- `label` défaut **« Zone »** ; `labelPosition` défaut **`top-left`** ; `color` défaut **`#6366f1`** ;
- `x`, `y`, `w`, `h` number, requis ;
- `borderRadius?` int 0..24 ; `borderWidth?` int 0..6 ; `borderStyle?` enum solid|dashed|dotted ; `opacity?` number 0..1 ;
- `labelFontSize?` int ; `labelFontWeight?`, `labelFontStyle?`, `labelTextDecoration?` string ; `labelFontFamily?` string|null.

Défauts Prisma (`schema.prisma:616-630`) : borderRadius 8, borderWidth 2, borderStyle solid, opacity 0.12, labelFontSize 12, labelFontWeight, labelFontStyle normal, labelTextDecoration none.

###### `GET /api/racks/:id/zones`
- Session `:32-33`. `RackZone.findMany({rackId}, createdAt asc)`. Réponse 200 : tableau.

###### `POST /api/racks/:id/zones`
- Session `:41-42` ; fantôme `:43-49` ; clientId `:52` ; flatten 400 `:55`.
- `RackZone.create({rackId, ...parsed})` (`:56`). Réponse 200 : la zone.
- Audit `:58-67` : `rackZone.create` / `RackZone` / `zone.id`.
- Évènements : rack `:69` `{type:"zone_added", zone}` ; app `:70` `("rackZone","created", zone.id, {rackId, itemId, clientId})`.

##### 1.22 `R/zones/[zoneId]/route.ts` (93 LOC)

`updateSchema` (`:9-26`) : les mêmes champs que la création, tous optionnels et sans défaut.

###### `PATCH /api/racks/:id/zones/:zoneId`
- Session `:31-32` ; fantôme `:33-39` ; clientId `:42` ; flatten 400 `:45`.
- `RackZone.update({where:{id, rackId}})` (`:46`). Réponse 200 : la zone.
- Audit `:48-57` : `rackZone.update` / `RackZone` / `zoneId`.
- Évènements : rack `:59` `{type:"zone_updated", zone}` ; app `:60` `("rackZone","updated", zoneId, {rackId, itemId, clientId})`.

###### `DELETE /api/racks/:id/zones/:zoneId`
- Session `:65-66` ; fantôme `:67-73` ; clientId `:76`.
- `RackZone.delete({id, rackId})` (`:77`). Réponse 200 `{ok:true}`.
- Audit `:79-88` : `rackZone.delete` / `RackZone` / `zoneId`.
- Évènements : rack `:90` `{type:"zone_removed", zoneId}` ; app `:91` `("rackZone","deleted", zoneId, {rackId, itemId, clientId})`.

---

#### 2. Routes `app/api/tenant/**`

##### 2.1 `T/racks/route.ts` (91 LOC)

###### `GET /api/tenant/racks[?templates=true]`
- Session `:16-18` (`session?.user?.id`) ; aucune permission ni écriture.
- Paramètre `templates` : seule la valeur exacte `"true"` active le filtre (`:23`).
- Avec le filtre (`:30-63`) : `Rack where templateStatus = "ACTIF"` et `rigs: { none: { rigConfig: { projectId: { not: null } } } }`, c'est-à-dire aucun `RigRack` relié à un `RigConfig` de projet. Tri `createdAt desc`.
- Sans filtre (`:67-90`) : tous les racks (y compris ceux des projets), tri `createdAt desc`.
- Réponse 200 : `[{id, name, rackType, totalU, depthMm, hasWheels, slotsCount}]`, où `slotsCount = _count.slots`. Ce compte inclut les slots fantômes et les enfants d'étagère.
- SaaS : seulement le chemin `/tenant/`, qui est conservé tel quel pour la parité.

##### 2.2 `T/racks/[rackId]/synoptic-guides/route.ts` (102 LOC)

`createSchema` (`:10-18`) : `axis` enum `"h"|"v"` (requis) ; `position` number fini (requis) ; `color?` string regex `^#[0-9a-fA-F]{6}$` ; `label?` string.

###### `GET /api/tenant/racks/:rackId/synoptic-guides`
- Session `:23-25`. Rack absent → 404 `{"error":"Not found"}` (`:30-31`).
- `SynopticGuide where {rackId}`, select `{id, axis, position, color, label}`, `createdAt asc`.
- Réponse 200 : tableau (sans `rackId`, `projectId` ni dates).

###### `POST /api/tenant/racks/:rackId/synoptic-guides`
- Session `:45-47` ; fantôme `:49-55` ; rack absent → 404 « Not found » (`:60-61`) **avant** la validation.
- `req.json().catch(() => ({}))` (`:63`) ; flatten 400 `:65-66`. **Pas de clientId.**
- `SynopticGuide.create({rackId, axis, position, color: color ?? "#06b6d4", label: label ?? null})` (`:68-76`).
- Réponse **201** : la ligne complète (`:101`).
- Audit `:78-88` : `add_synoptic_guide` / `Rack` / `rackId` / `after: {axis, position}`.
- Résolution du `projectId` : `RigRack.findFirst({rackId, rigConfig.projectId not null})` (`:93-97`).
- Évènement app `:99` `("rack","updated", rackId, {rackId, projectId})`. Pas d'évènement rack.

##### 2.3 `T/synoptic-guides/[guideId]/route.ts` (151 LOC)

`patchSchema` (`:10-17`) : `position?` number fini ; `color?` regex `#RRGGBB` ; `label?` string|null.

###### `PATCH /api/tenant/synoptic-guides/:guideId`
- Session `:22-24` ; fantôme `:26-32`.
- `SynopticGuide.findUnique` `{id, rackId, projectId}` ; s'il est absent → 404 `{"error":"Not found"}` (`:37-41`), **avant** la validation.
- `req.json().catch(() => ({}))` ; flatten 400 `:43-46`.
- `updateData` : `position` et `color` s'ils sont définis ; `label` si la clé est présente (`?? null`) (`:48-51`). `SynopticGuide.update` (`:53-56`).
- Réponse 200 : la ligne mise à jour.
- Audit `:61-72` : `update_synoptic_guide` / `entityType = rackId ? "Rack" : "Project"` / `entityId = rackId ?? projectId` / `projectId: existing.projectId ?? undefined` / `after: parsed.data`.
- Évènements app : si `rackId` → résolution du `projectId` par `RigRack`, puis `("rack","updated", rackId, {rackId, projectId})` (`:74-85`) ; sinon, si `projectId` → `("project","updated", projectId, {projectId})` (`:86-88`). Pas de clientId.

###### `DELETE /api/tenant/synoptic-guides/:guideId`
- Session `:96-98` ; fantôme `:100-106` ; guide absent → 404 « Not found » (`:111-115`).
- `SynopticGuide.delete` (`:117`).
- Audit `:122-132` : `delete_synoptic_guide` / `Rack` ou `Project` / `rackId ?? projectId` / `projectId`.
- Évènements app : comme pour le PATCH (`:134-148`).
- Réponse 200 `{ok:true}`.
- Note : les guides de projet (`projectId`) sont créés ailleurs, par une route projet hors de ce lot.

##### 2.4 `T/inventaire/catalog/route.ts` (51 LOC)

###### `GET /api/tenant/inventaire/catalog`
- Session `:20-22` ; aucune écriture.
- Exécute en parallèle `fetchMergedInventaireEquipments(db)`, `Panel.findMany({orderBy name asc, select id, name, panelType, heightU})` et `fetchMergedInventaireAdapters(db)` (`:26-38`).
- Réponse 200 :
  - `equipments: MergedCatalogEquipment[]` : `{id, name, reference, brandName, categoryName, categoryColor, imageUrl, heightU, widthFraction(défaut "FULL"), isRackable, powerW, depthMm, weightKg, isComponentHost, isComponent, is2110, isLightingFixture, source}` ;
  - `panels: [{id, name, reference: null, type: panelType, heightU}]` ;
  - `adapters: MergedCatalogAdapter[]` : `{id, name, reference, imageUrl, categoryName, categoryColor, source}`.
- Services (`lib/services/catalog-merge.ts`, 353 LOC) :
  - équipements (`:72-275`) : `CatalogEquipment` (main, `isActive`, tri `sortOrder, name`) **plus** `TenantEquipment` (`isActive`, tri `createdAt desc`). Les copies `shadowsArkyo` masquent l'original via `eclipsedArkyoIds` (`lib/services/tenant-catalogue.ts:123-129`). La catégorie vient de la **fonction principale** (plus petit `sortOrder`, label et couleur), puis en repli de la catégorie d'équipement. Pour l'équipement perso, les fonctions viennent de `functionIds` (JSON) ; la marque et la catégorie se lisent d'abord dans main, puis dans tenant. La sortie est `[...arkyo, ...perso]` ;
  - adaptateurs (`:280-353`) : `functionId`, qui donne `categoryName/Color` = label et couleur de la fonction.
- **SaaS à retirer** :
  - toute la fusion main/perso (`mainDb.catalog*` aux lignes `:76`, `:162`, `:168`, `:174`, `:284`, `:325`) ;
  - l'éclipse `shadowsArkyo`, `clonedFromArkyoId`, `clonedFromArkyoVersion` (`:121-124`, `:131-138`, `:302-311`) ;
  - `source` : la valeur devient toujours `"PERSONAL"`.
  En local : `TenantEquipment` actif, tri à décider (arkyo trie le perso par `createdAt desc` et main par `sortOrder, name` ; en local, un seul ensemble ; reprendre l'ordre perso ou `sortOrder, name` est un choix à documenter), plus `TenantFunction`, `TenantBrand` et `TenantEquipmentCategory`.

---

#### 3. Le flux SSE `GET /api/racks/:id/events`

##### 3.1 Protocole exact (`R/events/route.ts`)
- **Authentification** : uniquement par `requireTenantDb()` dans un try/catch. Un échec donne `new Response("Unauthorized", {status: 401})` en **texte brut** (`:11-16`). Le rack doit exister, sinon `new Response("Not found", {status: 404})` en texte brut (`:17-18`). Aucune permission.
- **En-têtes** (`:51-57`) : `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. **Pas** de `X-Accel-Buffering` ni de `no-transform`, contrairement à `/api/events`.
- **Premier message** (`:38`) : un **commentaire SSE** `: connected\n\n`, et non un évènement `data:`. Le hook client `use-rack-sync.ts` attend `payload.type === "connected"`, mais ne le reçoit jamais de ce flux ; c'est `es.onopen` qui positionne l'état connecté.
- **Messages** (`:25-36`) : `data: <JSON>\n\n`, où `<JSON>` est exactement `JSON.stringify(payload)` du `publishRackUpdate`, donc `{type: "...", ...}`. Il n'y a ni nom d'évènement (`event:`), ni `id:`, ni `retry:`.
- **Pas de battement de cœur** : aucun ping périodique, alors que `/api/events` envoie `data: {"type":"ping"}` toutes les 25 s (`app/api/events/route.ts:59-66`). Un proxy qui coupe les connexions inactives fermera ce flux, et l'`EventSource` du navigateur se reconnecte seul.
- **Filtrage** : par `rackId` seulement, puisque l'abonnement se fait sur la clé `rackId`. Il n'y a **ni filtre `clientId`** (l'onglet émetteur reçoit ses propres évènements, et les clients dédoublonnent par id), ni tag tenant.
- **Fermeture** : au signal `abort` de la requête, `closed = true`, désabonnement, puis `controller.close()` (`:41-47`). Un `enqueue` qui échoue entraîne aussi `closed = true` et le désabonnement (`:29-35`).

##### 3.2 Le bus qui l'alimente
- `subscribeRack(rackId, fn)`, puis `subscribeRackEvent` (`lib/rack-events.ts:13-15`, `lib/event-bus.ts:178-184`) : `Map<rackId, Set<Listener>>` en mémoire, conservée sur `globalThis` pour survivre au rechargement à chaud.
- `publishRackUpdate(rackId, payload)` (`lib/rack-events.ts:17-24`) : si `shouldPublishRack(rackId)` (au moins un abonné local, ou Redis configuré), `publishRackEvent(rackId, JSON.stringify(payload))` (`lib/event-bus.ts:215-233`), puis distribution aux auditeurs de ce rack.
- **Redis** (`lib/event-bus.ts:88-146`, canaux `arkyo:app-events` et `arkyo:rack-events`, enveloppe `{rackId, data}`) : c'est du multi-instance SaaS, **non porté**. Le mono-site garde le mode mémoire, par exemple avec un `broadcast` tokio par rack, ou un seul `broadcast` filtré par `rackId`.
- **`publishAppUpdate` n'alimente PAS ce flux** : il va sur un `Set` global distinct (`appListeners`), lu par `GET /api/events`.

##### 3.3 Les publieurs : liste complète, obtenue par grep
`racks/[id]/route.ts`, déjà porté, **ne publie pas** sur ce bus. Les seuls publieurs de tout arkyo sont les routes de ce lot :

| `type` | charge utile | source |
|---|---|---|
| `adapter_added` | `adapter` (enrichi) | adapters:89 |
| `adapter_updated` | `adapter` (enrichi) | adapters/[adapterId]:54 |
| `adapter_removed` | `adapterId` | adapters/[adapterId]:86 |
| `bundle_added` | `bundle` | bundles:75 |
| `bundle_updated` | `bundle` (éventuellement `null`) | bundles/[bundleId]:65 |
| `bundle_removed` | `bundleId` | bundles/[bundleId]:96 |
| `connection_added` | `connection` | connections:149 (un par câble du lot), :199 |
| `connection_updated` | `connection` | connections/[connId]:146 |
| `connection_removed` | `connId` | connections:245 (un par id), connections/[connId]:178 |
| `construction_checks_updated` | (aucune) | construction-checks:96 |
| `external_port_added` | `externalPort` | external-ports:85 |
| `external_port_updated` | `externalPort` | external-ports/[externalId]:54 |
| `external_port_removed` | `externalPortId` | external-ports/[externalId]:90 |
| `label_added` / `label_updated` | `label` | labels:65, labels/[labelId]:56 |
| `label_removed` | `labelId` | labels/[labelId]:87 |
| `panelrow_updated` | `slotId, rowIndex, x, y` | panel-rows:99 |
| `rack_cleared` | (aucune) | slots:115 |
| `slot_added` / `slot_updated` | `slot` (enrichi avec `equipment`) | slots:291-294, slots/[slotId]:136 |
| `slot_removed` | `slotId, removedAdapterIds` | slots/[slotId]:222-226, :245-249 |
| `zone_added` / `zone_updated` | `zone` | zones:69, zones/[zoneId]:59 |
| `zone_removed` | `zoneId` | zones/[zoneId]:90 |

**Sans évènement rack** : canvas-position, inventory (toutes les méthodes, y compris les slots fantômes créés), renumber, synoptic-guides et audit.

##### 3.4 Abonnés côté client (pour info)
- `components/synoptique/hooks/use-rack-sync.ts:57` : `slot_added`, `slot_updated`, `slot_removed`.
- `components/synoptique/synoptic-view.tsx:3243` : un `EventSource` par rack surveillé, pour les types connexion, zone, label, slot, adaptateur…
- `app/(app)/rigs/[id]/rack/[rackId]/_hooks/use-construction-checks.ts:26` : `construction_checks_updated`.

---

#### 4. Points d'attention pour le portage (synthèse)

1. **Second bus SSE à créer** : `crates/arkyo-server/src/events.rs` ne couvre que le bus app (`/api/events`), avec un payload `{"type":"update",…}`. Il faut un bus par `rackId` avec la même sémantique que le §3 : préfixe `: connected`, aucun battement, payload brut `{type,…}`.
2. **`mainDb` → catalogue local** : renumber (`catalogSignalType`, `catalogEquipment.connectors`), slots POST et PATCH (`catalogEquipment`, `catalogBrand`), `rack-inventory-api` (`enrich`, `component fields`), `catalog-enrich` (`fetchCatalogAdapterMap`) et `catalog-merge`. Dans arkyo, les routes slots et renumber **n'ont pas** de repli tenant. La lecture locale corrige de fait ce comportement, ce qui va dans le sens du §4.7 de la spec.
3. **Snapshots** : seulement `snapshotId: null` dans `R/inventory` (`:161`, `:247`, `:266`, `:468`) et `snapshotId` renvoyé par `inventorySelectFields` et le DTO (toujours `null`). Les colonnes `snapshotId` de `RackSlot`, `RackConnection`, `SynopticAdapter` et `RackInventoryItem` existent dans Prisma ; ces routes ne les écrivent pas (elles restent NULL). Aucun `project-snapshot*`, `snapshot-placement` ni contrôle de dérive du catalogue dans ce lot.
4. **Le code mort à retirer** se limite aux blocs fantômes (un par handler d'écriture, soit **34 blocs**) et au tag tenant de `publishAppUpdate`. Il n'y a ni plan ni crédit.
5. **Pas de transaction** dans arkyo, sauf : création de connexions en lot, `manualLabels`, application de renumber. Le Rust peut tout envelopper (audit compris), sans changement visible.
6. **Messages d'erreur en anglais à conserver** : « Unauthorized », « Not found », « Rack not found », « Slot not found », « Parent shelf not found », « Parent slot is not a shelf ».

---

#### 5. Tableau récapitulatif

« fantôme » = bloc `assertNotGhost` (no-op). « main » = `mainDb`. « snap » = `snapshotId`.

| chemin | méthodes | LOC | permission | évènements (rack / app) | audit | SaaS ? |
|---|---|---:|---|---|---|---|
| `/api/racks/:id/adapters` | GET, POST | 92 | session | POST : rack `adapter_added` / app `synopticAdapter created` | POST | fantôme, main (enrich) |
| `/api/racks/:id/adapters/:adapterId` | PATCH, DELETE | 89 | session | rack `adapter_updated`/`adapter_removed` ; app `synopticAdapter updated/deleted` | DELETE seul | fantôme, main |
| `/api/racks/:id/audit` | GET | 41 | session | — | lecture | — |
| `/api/racks/:id/bundles` | GET, POST | 78 | session | rack `bundle_added` ; app `cableBundle created` | POST | fantôme |
| `/api/racks/:id/bundles/:bundleId` | PATCH, DELETE | 99 | session | rack `bundle_updated`/`removed` ; app `cableBundle` | oui ×2 | fantôme |
| `/api/racks/:id/canvas-position` | PATCH | 67 | session | app `rack updated` seulement | non | fantôme |
| `/api/racks/:id/connections` | GET, POST, DELETE | 248 | session | rack `connection_added` (×n) / `connection_removed` (×n) ; app `rackConnection` | POST (create/createMany), DELETE | fantôme |
| `/api/racks/:id/connections/:connId` | PATCH, DELETE | 181 | session | rack `connection_updated`/`removed` ; app `rackConnection` | oui ×2 | fantôme, (main CableModel → local) |
| `/api/racks/:id/construction-checks` | GET, PATCH | 102 | session | rack `construction_checks_updated` seulement | PATCH | fantôme |
| `/api/racks/:id/events` | GET (SSE) | 58 | requireTenantDb (401 texte) | abonné du bus rack | — | requireTenantDb, Redis (event-bus) |
| `/api/racks/:id/external-ports` | GET, POST | 101 | session | rack `external_port_added` ; app `external_port created` | POST | fantôme |
| `/api/racks/:id/external-ports/:externalId` | PATCH, DELETE | 97 | session | rack `external_port_updated`/`removed` ; app `external_port` | oui ×2 | fantôme |
| `/api/racks/:id/inventory` | GET, POST, DELETE | 556 | session | app `rack_inventory updated` seulement (sans clientId) | POST (3 variantes), DELETE (`clear_inventory`) | fantôme, main, snap |
| `/api/racks/:id/inventory/:itemId` | PATCH, DELETE | 189 | session | app `rack_inventory updated` seulement | oui ×2 | fantôme, main |
| `/api/racks/:id/labels` | GET, POST | 68 | session | rack `label_added` ; app `rackLabel created` | POST | fantôme |
| `/api/racks/:id/labels/:labelId` | PATCH, DELETE | 90 | session | rack `label_updated`/`removed` ; app `rackLabel` | oui ×2 | fantôme |
| `/api/racks/:id/panel-rows` | GET (avec purge), POST | 102 | session | rack `panelrow_updated` ; app `rackSlotPanelRow updated` | POST | fantôme |
| `/api/racks/:id/renumber` | POST | 472 | session | app `rackConnection updated` seulement | oui (clearLabels / manualNumber / renumber) | fantôme, main (signal types, connecteurs) |
| `/api/racks/:id/slots` | POST, DELETE | 308 | session | rack `slot_added`\|`slot_updated` / `rack_cleared` ; app `slot` (+ `rack_inventory`) | oui ×2 | fantôme, main |
| `/api/racks/:id/slots/:slotId` | PATCH, DELETE | 253 | session | rack `slot_updated` / `slot_removed` ; app `slot` | oui (update / unplace / delete) | fantôme, main |
| `/api/racks/:id/zones` | GET, POST | 72 | session | rack `zone_added` ; app `rackZone created` | POST | fantôme |
| `/api/racks/:id/zones/:zoneId` | PATCH, DELETE | 93 | session | rack `zone_updated`/`removed` ; app `rackZone` | oui ×2 | fantôme |
| `/api/tenant/racks` | GET | 91 | session | — | non | chemin `/tenant` seulement |
| `/api/tenant/racks/:rackId/synoptic-guides` | GET, POST | 102 | session | app `rack updated` (+ projectId) | POST | fantôme |
| `/api/tenant/synoptic-guides/:guideId` | PATCH, DELETE | 151 | session | app `rack updated` ou `project updated` | oui ×2 | fantôme |
| `/api/tenant/inventaire/catalog` | GET | 51 | session | — | non | main, fusion/éclipse, `source` |

**Total : 26 fichiers, 48 handlers, 3 851 LOC** (4 039 avec `racks/[id]/route.ts`, déjà porté et exclu, 188 LOC).

---

#### 6. Services `lib/` importés par ces routes (LOC, `wc -l`)

| fichier | LOC | importé par | rôle / remarque |
|---|---:|---|---|
| `lib/auth.ts` | 271 | toutes (`auth`) | session NextAuth (déjà remplacée côté Rust) |
| `lib/tenant-context.ts` | 163 | toutes (`requireTenantDb`, `assertNotGhost`, `GhostModeError`) | SaaS, retiré |
| `lib/db-main.ts` | 12 | renumber, slots, slots/[slotId] | SaaS, catalogue local |
| `lib/rack-events.ts` | 24 | adapters*, bundles*, connections*, construction-checks, events, external-ports*, labels*, panel-rows, slots*, zones* | bus SSE rack, à porter |
| `lib/event-bus.ts` | 233 | (transitif via rack-events et app-events) | partie mémoire à porter ; Redis = SaaS |
| `lib/app-events.ts` | 163 | toutes les écritures sauf construction-checks | déjà porté (`events.rs`) ; tag tenant = SaaS |
| `lib/client-id.ts` | 98 | adapters*, bundles*, canvas-position, connections*, external-ports*, labels*, panel-rows, renumber, slots*, zones* | déjà porté (`http/client_id.rs`) |
| `lib/form-errors.ts` | 145 | inventory, inventory/[itemId] (`zodIssuesFromError`, l.133-145) | format `issues` |
| `lib/services/catalog-enrich.ts` | 314 | adapters, adapters/[adapterId] (`fetchCatalogAdapterMap`, l.225-270) | main d'abord puis tenant, devient local |
| `lib/services/rack-inventory.ts` | 385 | inventory (`validateInventoryRef`, l.208-303) | pur ; messages FR |
| `lib/services/rack-inventory-sync.ts` | 345 | inventory, inventory/[itemId] (`syncInventorySlots`), slots (`ensureGhostSlotForEquipment`/`Panel`) | logique des fantômes, à porter |
| `lib/services/rack-inventory-api.ts` | 567 | inventory (`enrichRowsForTemplate`, `inventorySelectFields`, `resolveComponentEquipmentFields`, `resolveComponentSpansBatch`), inventory/[itemId] (`resolveIsComponentHost`) | main d'abord, devient local |
| `lib/services/cable-numbering.ts` | 580 | renumber (`computeCableLabel`, l.541-580 ; types `CableDirDigit`, `CableNumberingConfig`) | pur, à porter (seule la partie l.481-580 sert ici) |
| `lib/services/catalog-merge.ts` | 353 | tenant/inventaire/catalog (`fetchMergedInventaireEquipments`, `fetchMergedInventaireAdapters`) | fusion et éclipse = SaaS ; lecture locale simple |
| **Total direct** | **3 653** | | |

Dépendances transitives notables :
- `lib/services/auto-label.ts` (28 LOC, `generateUniqueLabel`, via rack-inventory-sync) ;
- `lib/services/tenant-catalogue.ts` (238 LOC, `eclipsedArkyoIds`, via catalog-merge ; SaaS) ;
- `app/api/_lib/connector-dtype.ts` (101 LOC, via catalog-enrich, pour les connecteurs seulement : inutile pour `fetchCatalogAdapterMap`) ;
- `lib/types/catalog.ts` (133 LOC, types `CatalogAdapterLite` etc.).

---

# Annexe B : routes `tenant/projects/[id]/{racks/**, inventaire, locations/[locationId], audit, equipments, rack-slots, cabling, snapshots, catalogue-drift}`

### Phase 4 : inventaire des routes API, lot B (racks, inventaire, lieux, audit, câblage)

Référence : arkyo `88b2e4b`, clone `.ref/arkyo`. Chemins cités relativement à ce clone, sous la forme `fichier:ligne`. Abréviation : `P/` = `app/api/tenant/projects/[id]/`.

#### 0. Constats transverses (valables pour toutes les routes ci-dessous)

- **Authentification.** Toutes les routes ouvrent par `auth()` puis `if (!session?.user?.id)` → **401 `{"error":"Unauthorized"}`** (message anglais). Seule exception : `audit` teste `if (!session)`. `requireTenantDb()` (`lib/tenant-context.ts:126-146`) vérifie ensuite l'appartenance au tenant (sinon `TenantAccessError`, non interceptée, donc 500). **Aucune** route du lot n'appelle `requireTenantPermission` : arkyo ne contrôle que la session. La phase 3 d'arkyo-server ajoute `require(me, Domain::Projects, Level::Write)` sur les écritures (écart assumé, cf. `docs/superpowers/plans/2026-11-06-phase-3-suivi.md`, « Gardes serveur reprises de l'UI »). À reconduire.
- **Mode fantôme (SaaS).** Chaque écriture contient `try { await assertNotGhost() } catch (GhostModeError) → 403 {"error":"Mode lecture seule"}`. Or, au commit de référence, `assertNotGhost` est un **no-op** (`lib/tenant-context.ts:161-163` : `return;`). La branche 403 est donc du code mort. **À retirer purement.**
- **Erreurs 404 en anglais** : `"Not found"` (presque partout), `"Project not found"` (audit). À reprendre telles quelles.
- **Deux formats de validation** :
  - `{ error: parsed.error.flatten() }` (objet `{formErrors, fieldErrors}`), en 400 : `racks/[rackId]` PATCH, `racks/reorder`, `locations/[locationId]` PATCH.
  - `{ error: "Validation invalide", issues: zodIssuesFromError(err) }`, en 400 (`lib/form-errors.ts:133-145` : `issues = [{path:[...]|["root"], message}]`) : tout le reste.
- **Corps JSON.** Certaines routes font `req.json().catch(() => ({}))` (corps invalide = objet vide), d'autres `await req.json()` sans `catch` (corps invalide = exception, donc **500**). Précisé route par route.
- **Audit.** Toujours `db.auditLog.create({ userId, action, entityType, entityId, projectId, before?, after? }).catch(console.warn)`. L'écriture se fait **après** l'écriture principale, hors transaction, et un échec est ignoré.
- **Temps réel.** `publishAppUpdate(entity, action, id?, meta?)` (`lib/app-events.ts:120-146`) publie `{entity, action, id?, projectId?, rackId?, itemId?, clientId?, data?, tenantSlug?}`. `tenantSlug` est SaaS et ne se porte pas. Aucun « rack event » dédié dans ce lot : tout passe par `publishAppUpdate`. `readClientIdFromRequest` (en-tête `x-client-id`, `lib/client-id.ts:88-98`) n'est utilisé que par `cabling/[cableId]` et `cabling/assign-model`.
- **Catalogue « main d'abord, puis repli tenant ».** Partout, `mainDb.catalogX.findMany({id in})` suivi d'un repli `db.tenantX.findMany({id in manquants})`. En local, cela devient **une lecture directe** : `CatalogEquipment`→`TenantEquipment`, `CatalogBrand`→`TenantBrand`, `CatalogEquipmentCategory`→`TenantEquipmentCategory`, `CatalogFunction`→`TenantFunction`, `CatalogConnectorType`→`TenantConnectorType`, `CatalogSignalType`→`TenantSignalType`, `CableModel`→`TenantCableModel`, `CatalogAdapter`→`TenantAdapter`. Les fonctions d'un équipement Arkyo passent par une jointure M:N (`functions: { function }`). Celles d'un équipement perso passent par le JSON `functionIds`. **Seul le chemin `functionIds` subsiste.**
- **Snapshots (SaaS).** Les colonnes `snapshotId` de `RackSlot` et `RackInventoryItem` existent (`crates/arkyo-server/migrations/0003_projets.sql`) et restent `NULL` (suivi phase 3). On garde la **clé** `snapshotId: null` dans les JSON pour la parité, mais pas la logique.
- **Tables nécessaires absentes de 0001-0003** : `RackConnection`, `ProjectConnection`, `ExternalPort`, `ProjectEquipment`, `SynopticAdapter`, `ProjectSynopticAdapter`, `CableBundle`, `RackZone`, `RackLabel`, `RackSlotPanelRow`, `SynopticGuide`, plus `CartoCablePath` (cartographie, phase 5, lue par `cabling` GET). `ProjectCatalogueSnapshot` n'est pas portée.
- **Cascades.** Le front et les routes comptent sur les `onDelete: Cascade` Prisma (`Rack` → slots, inventaire, zones, labels, connexions…, `RackInventoryItem.hostItemId` → composants, `RackConnection.from/toSlotId` et `from/toComponentItemId`). La migration SQLite les déclare déjà pour `hostItemId` (`ON DELETE CASCADE`). Il faudra les déclarer pour les nouvelles tables et garder `PRAGMA foreign_keys=ON`.

---

#### 1. `P/racks/[rackId]/route.ts` (204 lignes)

Helper d'appartenance `assertRackBelongsToProject` (`:13-30`) : `Rack` où `rigs.some.rigConfig.projectId = :id`. Il renvoie `{id, name, isVirtual}`.

##### `PATCH /api/tenant/projects/:id/racks/:rackId`
- Permission : session seule (`:60-62`), mode fantôme mort (`:64-70`).
- 404 `"Not found"` si le rack n'appartient pas au projet (`:75-76`).
- Corps : `req.json().catch(() => ({}))` (`:78`), schéma `patchSchema` (`:34-55`), tous les champs optionnels :
  - `canvasX`, `canvasY` : `int`, `nullable` (`:36-37`)
  - `locationId` : `string min(1)`, **non nullable** (`:41`)
  - `name` : `string min(1) max(120)` (`:43`)
  - `rackType` : enum `STANDARD|FLIGHT_CASE_CLASSIC|FLIGHT_CASE_SKB|PELICAN|CAP` (`:44-46`)
  - `isRackable` : `bool` (`:47`)
  - `totalU` : `int 1..60` (`:48`)
  - `depthMm` : `int 50..2000` (`:49`)
  - `widthMm`, `heightMm` : `int 50..3000`, `nullable` (`:50-51`)
  - `hasWheels` : `bool` (`:52`)
  - `emptyWeightKg` : `number 0..500`, `nullable` (`:53`)
  - `rearInteriorGapMm` : `int 0..2000`, `nullable` (`:54`)
- Erreurs :
  - 400 `flatten()` (`:80-81`)
  - 400 `"Un contenant virtuel ne peut pas être réaffecté"` si `locationId` est fourni sur un rack virtuel (`:83-88`)
  - 400 `"Emplacement introuvable"` si le lieu n'est pas dans le projet (`:89-95`)
- Effets :
  - Construit `updateData`. Les champs nullables sont écrits si la clé est présente (`"x" in data`), les autres si `!== undefined` (`:97-126`).
  - `name` passe par `ensureUniqueRackName(db, projectId, name, rackId)` (`lib/services/rack-naming.ts:52`, suffixe « 2 », « 3 »…, comparaison insensible à la casse, rack courant exclu) (`:105-115`). Déjà porté : `crates/arkyo-server/src/projects/naming.rs`, `ensure_unique_rack_name_excluding`.
  - `db.rack.update` (`:128-131`).
- Audit (`:133-144`) : `update_rack`, `Rack`, `rackId`, `after = parsed.data`.
- Événement (`:146`) : `("rack","updated", rackId, {projectId, rackId})`.
- Réponse 200 : la ligne `Rack` complète, scalaires Prisma (`:148`).
- Snapshots : aucun impact.
- Appelants :
  - `app/(fullscreen)/project/[id]/inventaire/_components/inventaire-scope.tsx:1172` (glisser-déposer `{locationId}`)
  - `.../inventaire/_components/container-properties-panel.tsx:137` (propriétés du contenant)
  - `app/(fullscreen)/project/[id]/_components/project-editor.tsx:1480` (mise à jour optimiste d'un contenant)

##### `DELETE /api/tenant/projects/:id/racks/:rackId`
- Permission : session seule (`:154-156`), mode fantôme mort (`:158-164`).
- Erreurs :
  - 404 `"Not found"` (`:169-170`)
  - 400 `"Un contenant virtuel se supprime via son emplacement"` (`:176-181`)
- Effets : `db.rack.delete` (`:186`). La cascade Prisma emporte `RackSlot`, `RackInventoryItem`, `RackZone`, `RackLabel`, `RackConnection`, `CableBundle`, `SynopticAdapter` et `RigRack` (commentaire `:183-185`).
- Audit (`:188-199`) : `delete_rack`, `Rack`, `rackId`, `before = {rackId, rackName}`.
- Événement (`:201`) : `("rack","deleted", rackId, {projectId, rackId})`.
- Réponse 200 : `{ok:true}`.
- Appelants :
  - `app/(fullscreen)/project/[id]/inventaire/inventaire-client.tsx:316`
  - `.../inventaire/_components/container-properties-panel.tsx:176`

---

#### 2. `P/racks/[rackId]/canvas-data/route.ts` (587 lignes)

##### `GET /api/tenant/projects/:id/racks/:rackId/canvas-data`
- Permission : session seule (`:48-50`), pas de mode fantôme (lecture).
- Paramètres : aucun (ni query ni corps).
- Erreurs : 404 `"Not found"` si le rack n'appartient pas au projet (`:55-56`) ou s'il est introuvable (`:119`).
- Lectures :
  - `Rack` + `rigs.rigConfig{id,name,projectId}` + `slots` de premier niveau (`parentSlotId=null`, triés par `startU` croissant), chacun avec `panel{…, slots{id,position,sizeSlots,label,notes,catalogConnectorTypeId,mountD}}` et `children` (même `panel`) (`:58-117`).
  - En parallèle (`:142-242`) :
    - catalogue main actif complet, avec fonctions, pour la palette (`:153-163`)
    - « accessoires rack » main : `category = "Accessoire rack"` et actifs (`:165-168`)
    - tous les `Panel` tenant (`:170-190`)
    - `AppConfig` des clés `patch_panel_depth_mm` et `cable_safety_depth_mm` (`:192-196`)
    - `CatalogConnectorType` main (`:198-207`), `CatalogSignalType` main (`:209-219`), `CatalogFunction` main (`:224-227`)
    - composants imbriqués : `RackInventoryItem` où `hostItemId ∈ items hôtes des slots`, triés par `hostSlotIndex` (`:229-241`, sélectionne aussi `snapshotId`)
- Recalculs :
  - `equipmentCategoryMap` = fonction primaire (plus petit `sortOrder`) (`:247-262`)
  - repli `TenantEquipment` pour les équipements placés absents du main (`:278-320`)
  - catégorie et couleur des équipements perso : `functionIds` → `CatalogFunction` main, sinon `categoryId` → catégorie main puis tenant (`:325-382`)
  - marques main puis repli `TenantBrand`, **y compris les `brandId` lus dans les snapshots** (`:384-410`)
  - `overrideCategoryWithFunction` remplace `equipment.category` par le libellé de la fonction primaire (`:417-423`)
  - composants regroupés par hôte, `{itemId, slotIndex, slotSpan (componentSlotSpan ?? 1), equipment}` (`:428-462`)
  - `enrichSlot` ajoute `equipment` (+`brand`), `components`, `panel.slots[].connectorTypeId/connectorType`, et la même chose sur `children` (`:465-526`)
- Réponse 200 (`:558-586`) :
  - `rack` : `Rack` + `rigs` + `slots` enrichis. Les colonnes brutes, dont `snapshotId`, sont conservées.
  - `allEquipment` (palette, + `brand`), `rackAccessories` (+ `brand`), `allPanels` (+ `connectorType`)
  - `connectorTypes[{id, name, versions, functionId (premier de la jointure), iconId, color}]`
  - `signals[{id, name, color, cablePrefix, cableSuffix, functionId, isIp}]`
  - `signalCategories: []`
  - `categories[{id, name: label, color ?? "#71717a", children: []}]`
  - `patchPanelDepthMm` (défaut 5), `cableSafetyDepthMm` (défaut 150)
- Événements et audit : aucun.
- **Ce qui disparaît sans snapshots ni `mainDb`** :
  - `loadProjectSnapshotMap` (`:265`), la boucle des `brandId` issus des snapshots (`:392-395`), `resolveEquipmentData(…snapshotMap…)` (`:442`, `:469`, `:495`). La résolution devient `map.get(catalogEquipmentId)`.
  - La double source palette (main) + repli (tenant) devient une seule lecture de `TenantEquipment` actifs. **Attention** : dans arkyo, la palette `allEquipment` ne liste **que le catalogue Arkyo**, pas le perso. En local, elle doit lister `TenantEquipment isActive`, sinon elle est vide.
  - `functions` M:N est remplacé par `functionIds` → `TenantFunction`.
  - Catégories main puis tenant : `TenantEquipmentCategory` seul.
  - Marques : `TenantBrand` seul.
- **À trancher** : `rackAccessories` filtre la colonne texte héritée `CatalogEquipment.category = "Accessoire rack"` (`:166`). `TenantEquipment` n'a pas de colonne `category` (seulement `categoryId`). Il faut un équivalent local (par exemple `categoryId` → `TenantEquipmentCategory.name = "Accessoire rack"`), ou une liste vide.
- Appelants :
  - `app/(fullscreen)/project/[id]/rack/rack-tab-client.tsx:475` (rack sélectionné) et `:530` (vue agrégée par lieu)
  - `app/(fullscreen)/project/[id]/rack/_components/rack-export-stage.tsx:91` (export)

---

#### 3. `P/racks/[rackId]/inventory/route.ts` (1243 lignes)

Schéma POST `postBodySchema` (`:26-48`), tous les champs optionnels :
- `catalogEquipmentId`, `equipmentId` (ancien nom) : `string nullable`
- `panelId` : `string nullable`
- `catalogAdapterId`, `adapterId` (ancien nom) : `string nullable`
- `accessoryType` : enum `plaque|etagere|tiroir`, `nullable`
- `accessoryHeightU` : `int 1..8`, `nullable`
- `accessoryVariant` : enum `plein|pass-cable|aere`, `nullable`
- `accessoryDepthMm` : `int positive`, `nullable`
- `quantity` : `int min 1`, **défaut 1**
- `hostItemId` : `string nullable`
- `hostSlotIndex` : `int min 0`, `nullable`
- `cloneComponentsFromItemId` : `string nullable`

DTO `BomItemDto` (`:105-158`) : `id, kind ("equipment"|"panel"|"adapter"|"accessory"), refId?, accessoryType?, accessoryHeightU?, accessoryVariant?, accessoryDepthMm?, quantity, name, reference, imageUrl, brandName, heightU, widthFraction, panelType ("PATCH"|"ACCESSORY"|null), weightKg, powerW, depthMm, isRackable, category, categoryColor, snapshotId, hostItemId, hostSlotIndex, isComponentHost, hostSlotCount, isComponent, componentSlotSpan`.

Règles de `mapToBomItem` (`:180-368`) :
- Équipement :
  - données = snapshot si `snapshotId`, sinon catalogue (`:192-199`) ; ligne **ignorée** (orpheline) si introuvable (`:200`)
  - catégorie = fonction primaire, sinon champ hérité `category` (`:216-220`)
  - `isRackable` vaut `true` par défaut (`:212`)
- Panel : `category` = `"Accessoire rack"` si `panelType=ACCESSORY`, sinon `"Panels de patch"` (`:271`).
- Adaptateur : même logique snapshot (`:284-291`), catégorie issue de `functionId`.
- Accessoire : nom produit par `formatAccessoryName` (`:81-101`), par exemple « Plaque pass-câble 2U » ou « Étagère 1U · 450mm » ; `category` = `"Accessoire rack"`.

`enrichRows` (`:400-669`) : main d'abord, repli `TenantEquipment`/`TenantAdapter` (`:474-505`), fonctions main (`:531-537`), catégories main puis tenant (`:538-562`), marques main + **marques des snapshots** (`:623-628`), puis repli tenant (`:639-647`).

##### `GET /api/tenant/projects/:id/racks/:rackId/inventory`
- Permission : session seule (`:982-984`).
- Erreurs : 404 `"Not found"` (`:989-990`).
- Lecture : `RackInventoryItem where rackId`, triés par `createdAt` croissant (`:993-1011`), en parallèle de `loadProjectSnapshotMap` (`:1012`).
- Réponse 200 : `{items: BomItemDto[]}` (`:1016`). Les orphelines sont filtrées en silence.
- Événements et audit : aucun.
- Appelants :
  - `.../inventaire/_components/inventaire-scope.tsx:1191` (`refreshRackBom`, URL produite par `getInventoryUrl` `:447-451`)
  - `app/(app)/rigs/[id]/rack/[rackId]/_hooks/use-rack-bom.ts:231` (hook `useRackBom`, monté par `app/(fullscreen)/project/[id]/rack/_components/rack-tab-side-panel.tsx:338` et `app/(app)/rigs/[id]/rack/[rackId]/rack-editor.tsx:421`, lui-même rendu par `app/(fullscreen)/project/[id]/inventaire/synoptique/page.tsx:4`)
  - `.../inventaire/_components/bom-panel.tsx:229` : **code mort**, aucun fichier n'importe `bom-panel`

##### `POST /api/tenant/projects/:id/racks/:rackId/inventory`
- Permission : session seule (`:1022-1024`), mode fantôme mort (`:1026-1032`).
- Corps : `await req.json()` **sans catch** (`:1040`) : un JSON invalide donne 500.
- Erreurs du flux principal :
  - 404 `"Not found"` (`:1037-1038`)
  - 400 `{error:"Validation invalide", issues}` (`:1041-1046`)
  - 400 avec le message levé par `validateInventoryRef` (`lib/services/rack-inventory.ts:208-302`), via `:1048-1054` (repli `"Référence invalide"`) :
    - `"Accessoire incomplet : type et hauteur U requis"` (`rack-inventory.ts:239`)
    - `"Type d'accessoire invalide : attendu plaque, etagere ou tiroir"` (`:244`)
    - `"Hauteur U d'accessoire invalide : attendu 1, 2, 3 ou 4"` (`:249`, message faux : la liste réelle est 1..8, `:163`)
    - `"Variant requis pour les plaques"` (`:257`)
    - `"Profondeur requise pour les étagères et tiroirs"` (`:272`)
    - `"Profondeur invalide : valeur en mm > 0 attendue"` (`:281`)
    - `"Référence catalogue manquante"` (`:293`)
    - `"Plusieurs références catalogue fournies — exactement une attendue"` (`:297`)
  - 400 `"hostItemId et hostSlotIndex doivent être fournis ensemble"` (`:1075-1081`)
  - 500 `"Référence catalogue introuvable après création."` (`:1191-1196`)
- **Branche 1 : pose d'un composant** (`hostItemId`/`hostSlotIndex`, `:1075-1090` → `handleComponentPlacement` `:678-833`) :
  - Erreurs, dans l'ordre :
    - 400 `"Seul un équipement peut être installé comme composant"` (`:691-696`)
    - 404 `"Not found"` si l'hôte n'est pas dans le rack (`:702`)
    - 400 `"Impossible d'imbriquer un composant dans un composant"` (`:703-708`)
    - 400 `"Cet équipement ne peut pas accueillir de composants"` (`:709-714` et `:717-722`)
    - 404 `"Équipement composant introuvable"` (`:725-727`)
    - 400 `"Composant hors des limites de l'équipement modulaire"` si `index + span > hostSlotCount` (`:730-735`)
    - 409 `"Slot occupé"` en cas de chevauchement de plages `[index, index+span)` avec les composants existants (`:737-758`)
  - Effets : `getOrCreateSnapshot(…"EQUIPMENT"…)` (`:760-766`), puis `create {rackId, catalogEquipmentId, hostItemId, hostSlotIndex, snapshotId, quantity:1}` (`:768-792`). **Pas de `RackSlot`, pas de `syncInventorySlots`.**
  - Audit (`:813-824`) : `create_inventory_item`, `RackInventoryItem`, `item.id`, `after = {rackId, refKind, refId, quantity, hostItemId, hostSlotIndex}`.
  - Événement (`:826-830`) : `("rack_inventory","updated", rackId, {projectId, rackId, itemId})`.
  - Réponse **201** `{item}` (`:832`).
- **Branche 2 : châssis hôte** (`isComponentHost`, détecté par `resolveComponentEquipmentFields` `:1094-1105` → `handleHostEquipmentPlacement` `:843-977`) :
  - **Jamais fusionné** : `quantity` du corps ignorée, toujours 1.
  - Erreurs :
    - 400 `"Exemplaire source introuvable dans ce rack"` (`:861-866`)
    - 400 `"Impossible de dupliquer depuis un composant"` (`:867-872`)
  - Effets : snapshot (`:875-881`) ; `create quantity:1` (`:899-907`) ; si `cloneComponentsFromItemId`, `createMany` des composants de la source avec `hostItemId = nouvel item`, en recopiant `snapshotId` (`:910-928`) ; `syncInventorySlots(raw.id)` (`:943-945`).
  - Audit (`:957-968`) : `create_inventory_item`, `after = {rackId, refKind:"equipment", refId, quantity, clonedComponentsFrom?, clonedComponentCount?}`.
  - Événement identique (`:970-974`). Réponse **201** (`:976`).
- **Branche 3 : flux normal** :
  - Dédoublonnage par `(rackId, catalogEquipmentId | panelId | catalogAdapterId | accessoryType+HeightU+Variant+DepthMm)` (`:1107-1137`) : la ligne existante voit sa `quantity` augmentée (`:1155-1160`), sinon on crée (`:1161-1185`).
  - Snapshot créé seulement à la création d'un équipement ou d'un adaptateur (`:1139-1151`).
  - `syncInventorySlots` si l'item est un équipement ou un panel (`:1199-1203`).
  - Audit (`:1223-1234`) : `create_inventory_item`, `after = {rackId, refKind, refId, quantity}`, ou pour un accessoire `{rackId, refKind:"accessory", accessoryType, accessoryHeightU, accessoryVariant, accessoryDepthMm, quantity}`.
  - Événement (`:1236-1240`) identique.
  - Réponse `{item}` : **200 si fusion, 201 si création** (`:1242`).
- Rapprochement inventaire ↔ slots : `syncInventorySlots` (`lib/services/rack-inventory-sync.ts:72-192`) garantit exactement `quantity` lignes `RackSlot` liées par `inventoryItemId`.
  - Création : slots **fantômes** `startU=null, heightU=null, view=FRONT, widthFraction=FULL, column=0`, avec un libellé unique `#XXXX` (`generateUniqueLabel`, `lib/services/auto-label.ts:18`).
  - Suppression de l'excédent, par priorité : fantôme sans câble, fantôme câblé, placé sans câble, placé câblé (`:149-189`).
  - Pas de transaction.
- **Anomalie à vérifier** : le dédoublonnage équipement (`:1111-1114`) ne filtre pas `hostItemId IS NULL`. Ajouter un équipement déjà installé comme composant dans ce rack peut donc incrémenter la ligne du composant.
- **Ce qui disparaît sans snapshots** :
  - les trois appels `getOrCreateSnapshot` (`lib/services/snapshot-placement.ts:41`), à `:760`, `:875` et `:1144`
  - les `loadProjectSnapshotMap` qui suivent la création (`:794`, `:930`, `:1188`) et celui du GET (`:1012`)
  - les branches `snapshotMap.get(raw.snapshotId)` de `mapToBomItem` (`:194-196`, `:285-287`) et la collecte des marques issues des snapshots (`:623-628`)
  - `snapshotId` est toujours `null` en écriture et vaut `null` dans le DTO
  - `enrichRows` devient une lecture locale unique : `TenantEquipment`, `TenantAdapter`, `TenantFunction`, `TenantEquipmentCategory`, `TenantBrand`
  - `resolveComponentEquipmentFields`, `resolveComponentSpansBatch` et `resolveIsComponentHost` (`lib/services/rack-inventory-api.ts:511-567`) deviennent une seule lecture de `TenantEquipment`
- Appelants du POST, tous via `getInventoryUrl` :
  - `inventaire-scope.tsx:879` (moitié « ajout » d'un transfert partiel), `:932`, `:961` (hôte + `cloneComponentsFromItemId`), `:986` (composant), `:1046` (ajout générique)
  - `.../inventaire/_components/component-config-modal.tsx:157` (composant, `baseUrl` fourni par `slot-ruler.tsx:104`)
  - `bom-panel.tsx:299`, `:322` (code mort)

---

#### 4. `P/racks/[rackId]/inventory/[itemId]/route.ts` (277 lignes)

Appartenance `assertItemBelongsToProjectRack` (`:29-50`) : l'item est dans `rackId` et ce rack est dans le projet.

##### `PATCH /api/tenant/projects/:id/racks/:rackId/inventory/:itemId`
- Permission : session seule (`:55-57`), mode fantôme mort (`:59-65`).
- Corps : `await req.json()` sans catch (`:73`). Schéma (`:17-25`) :
  - `quantity` : `int min 1`, optionnel
  - `hostSlotIndex` : `int min 0`, optionnel
  - `.refine` : au moins un des deux, message `"quantity ou hostSlotIndex requis"`
- Erreurs communes : 404 `"Not found"` (`:70-71`) ; 400 `"Validation invalide"` + `issues` (`:74-79`).
- **Branche `hostSlotIndex`** (prioritaire si présent, `quantity` alors ignorée) (`:89-166`) :
  - Erreurs :
    - 400 `"Seul un composant installé peut changer de slot"` (`:90-95`)
    - 400 `"Châssis hôte introuvable"` (`:103-108`)
    - 400 `"Composant hors des limites de l'équipement modulaire"` (`:115-120`)
    - 409 `"Slot occupé"` (`:131-137`)
  - Effet : `update {hostSlotIndex}` (`:139-142`).
  - Audit (`:144-157`) : `update_inventory_item`, `RackInventoryItem`, `itemId`, `after = {hostSlotIndex}`.
  - Événement (`:159-163`) : `("rack_inventory","updated", rackId, {projectId, rackId, itemId})`.
  - Réponse 200 `{item}`, ligne **brute** non enrichie (`:165`).
- **Branche `quantity`** :
  - Erreurs :
    - 400 `"La quantité d'un composant installé est fixe"` (`:171-176`)
    - 400 `"Un châssis s'ajoute par exemplaire — ajoutez ou supprimez des exemplaires."` (`:180-191`)
  - Effets : `update {quantity}` (`:193-196`) puis `syncInventorySlots`, qui crée ou supprime des fantômes, voire des slots placés (`:199-203`).
  - Audit (`:205-216`) : `update_inventory_item`, `after = {quantity}`.
  - Événement identique (`:218-222`). Réponse 200 `{item}` brut (`:224`).
- Sans snapshots : les lectures main d'abord/repli tenant des champs « composant » deviennent une lecture de `TenantEquipment`.
- Appelants :
  - `inventaire-scope.tsx:883` (`{quantity}`, transfert partiel), `:1016` (`{hostSlotIndex}`)
  - `.../inventaire/_components/rack-card-canvas.tsx:404-406` (`{quantity}`)
  - `bom-panel.tsx:366` (code mort)

##### `DELETE /api/tenant/projects/:id/racks/:rackId/inventory/:itemId`
- Permission : session seule (`:230-232`), mode fantôme mort (`:234-240`).
- Erreurs : 404 `"Not found"` (`:245-246`).
- Effets, **sans transaction** :
  - `rackSlot.deleteMany({inventoryItemId})`, cascade sur les `RackConnection` (`:253`)
  - `rackInventoryItem.delete`, cascade sur les composants via `hostItemId` et sur les connexions des composants (`:255`)
- Audit (`:257-268`) : `delete_inventory_item`, `before = {rackId, itemId}`.
- Événement (`:270-274`) : `("rack_inventory","updated", rackId, {projectId, rackId, itemId})`.
- Réponse 200 `{ok:true}`.
- Appelants :
  - `rack-card-canvas.tsx:430-432` et `:852` (composant)
  - `item-properties-panel.tsx:128-130`
  - `slot-ruler.tsx:159` (composant)
  - `component-config-modal.tsx:143`
  - `bom-panel.tsx:404` (code mort)

---

#### 5. `P/racks/[rackId]/inventory/[itemId]/transfer/route.ts` (168 lignes)

##### `POST /api/tenant/projects/:id/racks/:rackId/inventory/:itemId/transfer`
- Permission : session seule (`:49-51`), mode fantôme mort (`:53-59`).
- Corps : `catch → {}` (`:67`). Schéma : `targetRackId: string min(1)` (`:11-13`).
- Erreurs :
  - 404 `"Not found"` pour l'item (`:64-65`)
  - 400 `"Validation invalide"` + `issues` (`:68-73`)
  - 404 `"Not found"` si le rack cible n'est pas dans le projet ; un rack virtuel est accepté (`:78-85`)
  - **409 `"Décâblez cet équipement avant de le déplacer."`** (`:119-124`) si une `RackConnection` touche les slots de l'item ou ses composants (`from/toSlotId`, `from/toComponentItemId`) ou si un `ExternalPort` touche ses slots (`:92-117`)
- Effets, en **transaction** (`:128-140`) :
  - `RackSlot.deleteMany` sur l'item et ses composants
  - `updateMany` des composants vers `rackId = target`
  - `update` de l'item vers `rackId = target`
- Pas de `syncInventorySlots` après le transfert. L'item garde `quantity = N` avec **0 slot** : les fantômes ne sont recréés qu'au prochain PATCH de quantité ou au prochain placement. Comportement à reproduire tel quel, à noter.
- Aucun contrôle `targetRackId ≠ rackId` : un transfert vers le même rack purge les slots.
- Audit (`:142-154`) : `transfer_inventory_item`, `before = {rackId}`, `after = {targetRackId}`.
- Événements (`:156-165`) : deux fois `("rack_inventory","updated", …)`, une pour la source `{projectId, rackId, itemId}` et une pour la cible `{projectId, rackId: targetRackId, itemId}`.
- Réponse 200 `{item}` brut (`:167`).
- Snapshots : aucun.
- Appelant : `inventaire-scope.tsx:888`.

---

#### 6. `P/racks/[rackId]/save-as-template/route.ts` (125 lignes)

##### `POST /api/tenant/projects/:id/racks/:rackId/save-as-template`
- Permission : session seule (`:19-21`), mode fantôme mort (`:23-29`). Pas de corps.
- Erreurs :
  - 404 `"Contenant introuvable"` (`:51-52`)
  - 404 `"Ce contenant n'appartient pas à ce projet"` (`:54-60`)
- Effets, **sans transaction** :
  - `RigConfig.create {name: "<rack> (modèle)", type: type du RigConfig source, projectId: null, isTemplate: true, createdById}` (`:64-72`)
  - nom unique parmi les modèles : `ensureUniqueRackName(db, null, name)` (`:77`)
  - `cloneRackInto(db, rackId, name)` (`lib/services/rack-clone.ts:43-352`), en 12 étapes avec correspondance des ID :
    - Rack ; `RackInventoryItem` (hôtes puis composants) ; `RackSlot` (2 passes pour `parentSlotId`) ; `SynopticAdapter` ; `CableBundle` ; `RackConnection` ; `RackSlotPanelRow` ; `ExternalPort` ; `RackZone` ; `RackLabel` ; `SynopticGuide`
    - sans `cableId`, `constructionChecks` ni `templateStatus`
  - `RigRack.create {position: 0}` (`:85-87`)
- Audit (`:91-106`) : `save_rack_as_template`, `Rack`, `clonedRack.id`, `projectId` = projet source, `after = {sourceRackId, templateRigConfigId, templateRackId}`.
- Événement (`:110`) : `("rig","created", templateRigConfig.id)`, **sans `meta`**.
- Réponse **201** `{rack:{id,name}, rigConfig:{id,name}}` (`:112-124`).
- Sans snapshots : `cloneRackInto` recopie `snapshotId` (`rack-clone.ts:115`, `:135`, `:176`, `:240`), ce qui donne un modèle pointant vers un snapshot de projet. En local la valeur est `NULL`, donc la recopie est inutile mais sans danger.
- Appelant : `.../inventaire/_components/container-properties-panel.tsx:151`.

---

#### 7. `P/racks/clone-from-template/route.ts` (269 lignes)

##### `POST /api/tenant/projects/:id/racks/clone-from-template`
- Permission : session seule (`:31-33`), mode fantôme mort (`:35-41`).
- Corps : `await req.json()` sans catch (`:46`). Schéma (`:21-26`) : `rackTemplateId: string min(1)`, `locationId: string min(1)`.
- Erreurs :
  - 400 `"Validation invalide"` + `issues` (`:47-52`)
  - 404 `"Projet introuvable"` (`:57-61`)
  - 400 `"Emplacement introuvable"` (`:64-68`)
  - 404 `"Rack template introuvable"` (`:86`)
  - 400 `"Ce rack n'est pas un template (il est déjà associé à un projet)"` (`:89-95`). Un rack sans aucun `RigRack` passe le test (`every` sur une liste vide).
- Effets, **sans transaction** :
  - lecture complète du rack source, utilisée seulement pour les compteurs de l'audit (`:71-84`)
  - régie principale récupérée, ou créée `{name: "<projet> — Régie principale", type: project.rigType ?? "FLIGHT_CASE"}` (`:98-109`)
  - `ensureUniqueRackName(db, projectId, src.name)` (`:117-121`), puis `cloneRackInto` (`:122`)
  - `rack.update {locationId}` (`:126-129`)
  - `RigRack` à la position `max + 1` (`:132-141`)
- Audit (`:144-163`) : `clone_rack_from_template`, `Rack`, `clonedRack.id`, `after = {sourceRackId, clonedRackId, slotsCount, inventoryCount, connectionsCount, adaptersCount, bundlesCount}`.
- Événement (`:165`) : `("rig","updated", rigConfigId, {projectId})`.
- Réponse **201** `{rack:{…}}` (`:244-268`) :
  - `id, rigConfigId, name, rackType, totalU, depthMm, widthMm, heightMm, hasWheels, emptyWeightKg, isRackable`
  - `canvasX:null, canvasY:null, slotsCount, constructionChecks:0, hasConnectors`
  - `slots[]` : `{startU, heightU, widthFraction, view, category, categoryId, equipmentName, equipmentReference, brandName, weightKg, powerW}`, slots de premier niveau, via `fetchCatalogEquipmentMap(ids, db)` (`lib/services/catalog-enrich.ts:33`, `:190`)
  - `bom[]` : DTO réduit via `enrichRowsForTemplate` (`lib/services/rack-inventory-api.ts:293`, `:220`), `categoryColor:null`, `snapshotId`
- `mainDb` est importé mais **inutilisé** (`:4`).
- Sans snapshots ni `mainDb` : `fetchCatalogEquipmentMap` et `enrichRowsForTemplate` (déjà sans snapshot, mais main d'abord puis repli tenant) deviennent des lectures locales.
- À rapprocher de `clone_rack` dans `crates/arkyo-server/src/http/projects/racks.rs:310`, porté en phase 3 pour `POST …/racks {fromTemplateId}`. Cette fonction recopie scalaires, slots et inventaire dérivé, alors que `cloneRackInto` est plus complet (connexions, zones, étiquettes, etc.). Mutualiser.
- Appelant : `.../inventaire/_components/add-container-wizard.tsx:517`.

---

#### 8. `P/racks/reorder/route.ts` (86 lignes)

##### `POST /api/tenant/projects/:id/racks/reorder`
- Permission : session seule (`:23-25`), mode fantôme mort (`:27-33`).
- Corps : `catch → {}` (`:38`). Schéma : `rackIds: string[] min(1)` (`:10-12`).
- Erreurs :
  - 400 `flatten()` (`:39-41`)
  - 400 `"Un ou plusieurs contenants n'appartiennent pas au projet."` (`:51-56`), comparaison du nombre de `RigRack` trouvés : des doublons dans `rackIds` déclenchent aussi ce 400
- Effets : transaction de `rigRack.update {position: idx}` (`:60-68`).
- Audit (`:70-81`) : `reorder_racks`, `Project`, `projectId`, `after = {rackIds}`.
- Événement (`:83`) : `("rack","updated", projectId, {projectId})`. Attention, l'`id` publié est celui du **projet**.
- Réponse 200 `{ok:true}`.
- Snapshots : aucun.
- Appelants :
  - `inventaire-scope.tsx:1081`
  - `app/(fullscreen)/project/[id]/_components/project-editor.tsx:591`

---

#### 9. `P/equipments/route.ts` (251 lignes) : **aucun appelant front**

##### `GET /api/tenant/projects/:id/equipments`
- Permission : session seule (`:14-16`).
- Erreurs : 404 `"Not found"` (`:21-22`).
- Lecture : `ProjectEquipment where projectId`, triés par `id` (`:24-27`), enrichis main d'abord puis repli tenant (`category:null`), marques et catégories main puis tenant (`:30-89`).
- Réponse 200 : `{equipments:[{...ProjectEquipment, equipment: {...catalog, brand, equipmentCategory} | null}]}` (`:91-105`).
- Événements et audit : aucun.

##### `POST /api/tenant/projects/:id/equipments`
- Permission : session seule (`:126-128`), mode fantôme mort (`:130-136`).
- Corps : `await req.json()` sans catch (`:140`). Schéma (`:110-123`), `equipments` est un tableau `min(1)` de :
  - `catalogEquipmentId` : `string min 1`, optionnel
  - `equipmentId` : `string min 1`, optionnel (ancien nom)
  - `quantity` : `int min 1`, défaut 1
  - `notes` : `string`, optionnel
  - `position` : `string`, optionnel
- Erreurs :
  - 400 `"Validation invalide"` + `issues` (`:141-146`)
  - 404 `"Not found"` (`:148-149`, après la validation)
- Effets : boucle d'`upsert` sur la clé unique `(projectId, catalogEquipmentId)`. Les items sans ID sont ignorés (`:155`). La mise à jour écrase toujours `quantity` (`:152-174`). Relecture et enrichissement **sans `equipmentCategory`** (`:177-230`).
- Audit (`:232-247`) : `add_project_equipments`, `ProjectEquipment`, `entityId = projectId`, `after = {addedCatalogEquipmentIds}`.
- Événement (`:249`) : `("project_equipment","created", projectId, {projectId})`.
- Réponse **201** `{equipments}`.
- Sans `mainDb` : lecture locale. Pas de snapshot.

#### 10. `P/equipments/[equipmentId]/route.ts` (57 lignes) : **aucun appelant front**

##### `DELETE /api/tenant/projects/:id/equipments/:equipmentId`
- Permission : session seule (`:14-16`), mode fantôme mort (`:18-24`).
- Recherche `ProjectEquipment` par `projectId` ET (`id = :equipmentId` OU `catalogEquipmentId = :equipmentId`, ancien comportement) (`:30-35`).
- Erreurs : 404 `"Not found"` (`:36`).
- Effet : `delete` (`:38-40`).
- Audit (`:42-53`) : `remove_project_equipment`, `ProjectEquipment`, `existing.id`, `before = ligne complète`.
- Événement (`:55`) : `("project_equipment","deleted", projectId, {projectId})`.
- Réponse 200 `{ok:true}`.

---

#### 11. `P/rack-slots/route.ts` (210 lignes) : **aucun appelant front**

##### `POST /api/tenant/projects/:id/rack-slots`
- Permission : session seule (`:31-33`), mode fantôme mort (`:35-41`).
- Corps : `await req.json()` sans catch (`:45`). Schéma : `slots` est un tableau `min(1)` (`:24-26`) de `slotItemSchema` (`:13-22`) :
  - `rackId` : `string min 1`
  - `catalogEquipmentId` / `equipmentId` : `string min 1`, optionnel
  - `startU` : `int min 1`
  - `view` : enum `FRONT|REAR|REAR_INTERIOR|SIDE`, défaut `FRONT`
  - `widthFraction` : enum `FULL|HALF|THIRD|QUARTER`, défaut `FULL`
  - `column` : `int 0..3`, défaut 0
- Erreurs :
  - 400 `"Validation invalide"` + `issues` (`:46-51`)
  - 404 `"Not found"` pour le projet (`:53-54`)
  - **409** avec message dynamique : `` `Chevauchement détecté pour équipement ${catalogEquipmentId} à U${startU} dans rack ${rackId}` `` (`:116-123`)
- **Faille** : l'appartenance des `rackId` au projet n'est **pas vérifiée**, on peut écrire dans n'importe quel rack.
- Effets :
  - Hauteurs : main, puis repli `TenantEquipment.heightU ?? 1` (`:65-92`).
  - Occupation par `rack:view:column:U`, sur `ceil(heightU)` ; les fantômes (`startU=null`) sont ignorés (`:96-103`).
  - Avec un équipement : `ensureGhostSlotForEquipment` (`lib/services/rack-inventory-sync.ts:318` → `ensureGhostSlotForRef` `:252-312`) prend un fantôme existant ; sinon il crée ou incrémente le `RackInventoryItem`, puis `syncInventorySlots`, puis prend le nouveau fantôme. Le slot est ensuite mis à jour `{startU, heightU, view, widthFraction, column}` (`:148-164`).
  - Sans équipement : `RackSlot.create` nu (`:166-176`).
  - **Sans transaction** : un 409 en milieu de lot laisse les écritures précédentes. Un échec de `ensureGhostSlotForRef` lève une exception (500).
- Audit (`:182-193`) : `add_rack_slots`, `Project`, `projectId`, `after = {count}`.
- Événements :
  - pour chaque slot (`:195-201`) : `("slot","created", slot.id, {projectId, rackId, itemId: slot.id})`
  - pour chaque rack dont l'inventaire a été incrémenté (`:202-207`) : `("rack_inventory","updated", rackId, {projectId, rackId})`
- Réponse **201** `{slots:[{id, rackId, catalogEquipmentId, startU, heightU, view, widthFraction, column}]}`.
- Snapshots : `ensureGhostSlotForRef` crée déjà l'inventaire **sans** snapshot (`rack-inventory-sync.ts:278-285`), rien à retirer.

---

#### 12. `P/inventaire/catalog/route.ts` (59 lignes)

##### `GET /api/tenant/projects/:id/inventaire/catalog`
- Permission : session seule (`:21-23`).
- Erreurs : 404 `"Not found"` (`:28-32`).
- Lectures :
  - `fetchMergedInventaireEquipments(db)` (`lib/services/catalog-merge.ts:72`)
  - `Panel` trié par nom (`:36-44`)
  - `fetchMergedInventaireAdapters(db)` (`catalog-merge.ts:280`)
- Réponse 200 (`:48-58`) :
  - `equipments[{id, name, reference, brandName, categoryName, categoryColor, imageUrl, heightU, widthFraction, isRackable, powerW, depthMm, weightKg, isComponentHost, isComponent, is2110, isLightingFixture, source}]`
  - `panels[{id, name, reference:null, type: panelType, heightU}]`
  - `adapters[{id, name, reference, imageUrl, categoryName, categoryColor, source}]`
- Événements et audit : aucun.
- **SaaS** : `catalog-merge` fusionne main (trié `sortOrder, name`) et tenant (trié `createdAt desc`), et masque l'original Arkyo d'un fork `shadowsArkyo` (`eclipsedArkyoIds`, `lib/services/tenant-catalogue.ts`). En local, il ne reste que la branche « perso » : `TenantEquipment`/`TenantAdapter` `isActive`, triés par `createdAt desc`, `source: "PERSONAL"`, ce qui équivaut à `catalog-merge.ts:240-270`. Le champ `source` est « ignoré par le client » (`catalog-merge.ts:47`) : le garder constant ou le retirer est à trancher (spec : pas de badge Arkyo/perso).
- Route jumelle `GET /api/tenant/inventaire/catalog` (mode modèle), hors lot.
- Appelants :
  - `inventaire-scope.tsx:457` et `:565`
  - `.../inventaire/_components/catalog-panel.tsx:380`

---

#### 13. `P/locations/[locationId]/route.ts` (191 lignes)

Helper (`:12-25`) : `Location` du projet avec `racks{id, isVirtual, _count.inventoryItems}`.

##### `PATCH /api/tenant/projects/:id/locations/:locationId`
- Permission : session seule (`:45-47`), mode fantôme mort (`:49-55`).
- Corps : `catch → {}` (`:63`). Schéma (`:29-37`), tous les champs optionnels :
  - `name` : `string 1..120`
  - `cableCode` : `string max 5`, `nullable`
  - `sortOrder` : `int min 0`
  - `canvasX`, `canvasY` : `int`, `nullable`
  - `canvasW`, `canvasH` : `int positive`, `nullable`
- Erreurs : 404 `"Not found"` (`:60-61`) ; 400 `flatten()` (`:64-66`).
- Effets :
  - `name.trim()`. Un nom fait d'espaces passe `min(1)` puis devient vide.
  - `cableCode` normalisé : `trim().toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,5)`, valeur vide → `null` (`:69-78`).
  - **Transaction** (`:84-101`) : `location.update`, et si `name` ou `cableCode` change, mise à jour du **rack virtuel** du lieu (`name`, `cableCode`).
- Audit (`:103-114`) : `update_location`, `Location`, `locationId`, `after = parsed.data`.
- Événement (`:116`) : `("location","updated", locationId, {projectId})`.
- Réponse 200 (`:118-122`) : `{...Location, virtualRackId, containerCount}` (nombre de racks non virtuels).
- Snapshots : aucun.
- Appelants :
  - `inventaire-scope.tsx:1128-1130`
  - `app/(fullscreen)/project/[id]/synoptique/_components/general-canvas.tsx:688` (`{canvasX, canvasY}` d'un bloc emplacement, synoptique général)

##### `DELETE /api/tenant/projects/:id/locations/:locationId`
- Permission : session seule (`:132-134`), mode fantôme mort (`:136-142`).
- Erreurs :
  - 404 `"Not found"` (`:147-148`)
  - 409 `"Ce lieu contient des contenants — déplacez-les avant suppression"` (`:150-156`)
  - 409 `"Ce lieu contient des équipements libres — retirez-les avant suppression"` (`:158-164`)
- Effets : **transaction** (`:166-173`) supprimant le rack virtuel (cascade) puis le lieu.
- Audit (`:175-186`) : `delete_location`, `before = {name}`.
- Événement (`:188`) : `("location","deleted", locationId, {projectId})`.
- Réponse 200 `{ok:true}`.
- Appelant : `inventaire-scope.tsx:1144-1146`.

(Pour mémoire, `GET`/`POST …/locations` sont déjà portés : `crates/arkyo-server/src/http/projects/locations.rs`.)

---

#### 14. `P/audit/route.ts` (84 lignes)

##### `GET /api/tenant/projects/:id/audit?limit=150`
- Permission : `if (!session)` → 401 `"Unauthorized"` (`:20-22`). Pas de test sur `user.id`.
- Query : `limit = min(500, max(1, Number(limit ?? 150)))` (`:27-30`). Une valeur non numérique donne `NaN`, puis `take: NaN`, donc une erreur Prisma (500).
- Erreurs : 404 **`"Project not found"`** (`:42-43`).
- Lectures : racks du projet via `rigConfigs.rigRacks` (`:34-47`) ; ID des `RackConnection` de ces racks (`:50-57`) ; ID des `ProjectConnection` du projet (`:60-64`).
- `AuditLog` filtré par `OR` (`:67-81`) :
  - `{entityType:"Project", entityId: projectId}`
  - `{entityType:"Rack", entityId ∈ racks}`
  - `{entityType:"RackConnection", entityId ∈ …}`
  - `{entityType:"ProjectConnection", entityId ∈ …}`
  - Tri `createdAt desc`, `take: limit`.
- Les actions `RackInventoryItem`, `Location`, `ProjectEquipment` et `RackSlot` n'apparaissent pas, sauf celles journalisées avec `entityType:"Project"`.
- Réponse 200 : **tableau brut** de lignes `AuditLog` (`:83`).
- Événements et audit : aucun.
- Appelant : `components/synoptique/components/audit-panel.tsx:46` (`AuditPanelContent projectId`, monté par `app/(fullscreen)/project/[id]/synoptique/synoptique-tab-client.tsx:1247`). La variante rack `/api/racks/:id/audit` est à `audit-panel.tsx:45` (hors lot). Libellés produits par `lib/services/audit-format.ts`.
- Report explicite de la phase 3 (« Audit »).

---

#### 15. `P/cabling/route.ts` (441 lignes)

##### `GET /api/tenant/projects/:id/cabling`
- Permission : session seule (`:30-32`).
- Erreurs : 404 `"Not found"` (`:37-41`). Sans rack : `{cables:[]}` (`:52-54`).
- Lectures (`:57-82`) :
  - `Rack{id, name, depthMm}`
  - `RackSlot{id, rackId, label, catalogEquipmentId, startU, heightU}`
  - toutes les `RackConnection` des racks
  - `ProjectConnection` du projet avec `cartoCablePath.routeLengthMm`
- Lectures catalogue :
  - équipements main + repli tenant, champs `{id, name, connectors}` (`:85-110`)
  - `CatalogConnectorType` **main seul**, sans repli (`:113-128`)
  - `CatalogSignalType` **main seul**, par **nom**, avec `function{label, color}` (`:132-160`)
  - `CableModel` **main seul**, avec `brand.name` (`:163-193`)
- Recalculs :
  - `resolvePortLabel` (`:198-249`) aplatit `connectors[]` par `quantity` : libellé « base n » si `qty > 1`, plus `signalName`, `connectorType` et `gender`
  - `slotName` = libellé du slot, sinon nom de l'équipement (`:251-261`)
  - longueur interne : `estimateCableLength` (`lib/services/cable-length.ts:88`, `CONNECTOR_DEPTHS.default`, profondeur de rack par défaut 600), `{rounded: roundedM, exact: mm/1000 au cm}` (`:308-335`)
  - longueur inter-rack : `routeLengthMm` de la carto, `ceil(mm/500)*0.5` (`:337-349`)
- Réponse 200 (`:438-440`) : `{cables: CablingRow[]}`, internes puis projet. Chaque ligne (`:263-304`) contient :
  - `id`, `scope: "internal"|"project"`, `label`, `color`
  - `signalName`, `signalCategory`, `signalCategoryColor`, `connectorType`
  - `from` et `to` : `{rackName, slotName, portLabel, connectorType, gender}`
  - `catalogCableModelId`, `cableModel: {id, name, reference, brandName} | null`
  - `estimatedLengthM`, `exactLengthM`
  - `wired`, `wiredAt` (ISO), `wiredNotes`
- Événements et audit : aucun.
- Sans `mainDb` : `TenantEquipment`, `TenantConnectorType`, `TenantSignalType` (jointure par `name`, `functionId` → `TenantFunction`), `TenantCableModel` + `TenantBrand`. La route n'est **pas** sensible aux snapshots : elle lit déjà le catalogue en direct.
- `CartoCablePath` est une table de phase 5. Prévoir une jointure qui tolère son absence, ou créer la table plus tôt.
- Appelants :
  - `app/(fullscreen)/project/[id]/cablage/_components/sections/cables-section.tsx:150` (onglet **Préparation** → Câbles)
  - `app/(fullscreen)/project/[id]/_components/dossier-generators.ts:515` (générateur de dossier `"cablage-cables"`)
  - `app/(fullscreen)/project/[id]/reseau/_components/shared/section-pdf-generators.ts:550` (PDF Réseau, section « Préparation · Câbles »)

#### 16. `P/cabling/[cableId]/route.ts` (122 lignes) : **aucun appelant front**

##### `PATCH /api/tenant/projects/:id/cabling/:cableId`
- Permission : session seule (`:25-27`), mode fantôme mort (`:28-34`). `clientId = readClientIdFromRequest(req)` (`:38`).
- Corps : `await req.json()` sans catch (`:40`). Schéma (`:14-18`) :
  - `scope` : enum `internal|project`, requis
  - `wired` : `bool`, optionnel
  - `wiredNotes` : `string max 2000`, `nullable`, optionnel
- Erreurs : 400 `"Validation invalide"` + `issues` (`:41-46`) ; 404 `"Not found"` (`:69-70` pour une connexion interne, `:100` pour une connexion projet).
- Effets : `wired=true` pose `wiredAt = now`, `false` le remet à `null` (`:54-57`). Un corps vide déclenche quand même `update({})` et un audit.
  - interne (`:60-93`) : appartenance `RackConnection.rack.rigs.some.rigConfig.projectId`, puis `update`
  - projet (`:96-121`) : `ProjectConnection {id, projectId}`, puis `update`
- Audit (`:75-86` / `:105-116`) : `cabling.wired_set`, `RackConnection` ou `ProjectConnection`, `cableId`, `after = data`.
- Événements :
  - interne (`:87-91`) : `("rackConnection","updated", cableId, {rackId, itemId: cableId, clientId})`, **sans `projectId`**
  - projet (`:117-120`) : `("projectConnection","updated", cableId, {projectId, clientId})`
- Réponse 200 : ligne brute `RackConnection` ou `ProjectConnection`.
- Snapshots : aucun.

#### 17. `P/cabling/assign-model/route.ts` (148 lignes)

##### `POST /api/tenant/projects/:id/cabling/assign-model`
- Permission : session seule (`:33-35`), mode fantôme mort (`:36-42`). `clientId` (`:46`).
- Corps : `catch → {}` (`:48`). Schéma (`:12-24`) :
  - `cables` : tableau `min(1)` de `{id: string min 1, scope: internal|project}`
  - `catalogCableModelId` : `string | null` (null = retirer le modèle)
- Erreurs : 400 `"Validation invalide"` + `issues` (`:49-54`). Aucune autre : les ID étrangers au projet sont **ignorés en silence** (`:58-81`), et l'existence du modèle n'est pas vérifiée.
- Effets : `RackConnection.updateMany` et `ProjectConnection.updateMany` `{catalogCableModelId}` (`:83-97`).
- Audit (`:99-115`) : `cabling.assign_model`, `Project`, `projectId`, `after = {count, catalogCableModelId}`.
- Événements, tous deux avec `id = projectId` :
  - (`:118`) `("rackConnection","updated", projectId, {projectId, clientId})`
  - (`:119-122`) `("projectConnection","updated", projectId, {projectId, clientId})`
- Réponse 200 `{updated, model: {id, name, reference, brandName} | null}` (`:137-147`). Le modèle est lu dans `mainDb.cableModel` sans repli (`:125-135`) ; en local : `TenantCableModel` + `TenantBrand`.
- Appelant : `cables-section.tsx:405`.

##### Câblage : phase 4 ou phase 6 ?

Les appelants tranchent : **phase 6 (Livraison > Préparation)**, pas l'éditeur de rack ni le synoptique.
- Le dossier `cablage/` d'arkyo est l'onglet **Préparation** : `project-editor.tsx:202` redirige `?tab=cablage` vers `"preparation"`, et `:159` définit le sous-onglet « Préparation » du groupe « Livraison ».
- `GET cabling` est appelé par `cablage/.../cables-section.tsx` (Préparation), par `dossier-generators.ts` (dossier, phase 6) et par le PDF de la section Réseau (phase 5).
- `assign-model` est appelé uniquement par `cables-section.tsx` (Préparation).
- `PATCH cabling/[cableId]` (état câblé, donc la recette) n'a **aucun** appelant.
- Le câblage du synoptique et de l'éditeur de rack (phase 4) passe par d'autres routes (`/api/racks/:id/connections…`, `…/project-connections`), hors de ce lot.
- **Recommandation : reporter ces trois routes à la phase 6.** En phase 5, le PDF Réseau pourra déjà avoir besoin de `GET cabling`.

---

#### 18. Routes SaaS non portées (résumé)

##### `POST P/snapshots/[snapshotId]/accept-update` (257 lignes)
- Corps `{confirmed: true}` (littéral).
- Relit la source Arkyo (`mainDb` `catalogEquipment`, `cable` ou `catalogAdapter` selon `itemType`). Erreur 404 `"Source Arkyo introuvable dans le catalogue. Mise à jour impossible."` (`:88-93`).
- Calcule `computeSnapshotDiff` (`lib/services/project-snapshot.ts`), supprime en cascade les `RackConnection`/`ProjectConnection` dont le connecteur a disparu, met à jour le snapshot.
- Audit `accept_snapshot_update` (`:229-245`). Événement `("tenant_catalogue_snapshot","updated", snapshotId, {projectId, itemId})` (`:247-250`).
- Réponse `{ok, updatedFields, deletedConnections}`.
- Appelant : `app/(fullscreen)/project/[id]/inventaire/_components/update-snapshot-modal.tsx:261`.

##### `GET P/snapshots/[snapshotId]/update-preview` (224 lignes)
- Calcule la différence entre le snapshot et la version Arkyo courante : `{snapshotId, itemType, arkyoSourceId, name, hasDrift, sourceDeleted, changes[], cascadeWarnings[]}`.
- Les avertissements de cascade sont enrichis des ID de connexions touchées (helper `enrichCascadeWarningsWithIds`). 404 `"Not found"` si le snapshot n'appartient pas au projet.
- Appelant : `update-snapshot-modal.tsx:242`. La modale est montée par `.../inventaire/_components/rack-card-canvas.tsx:39`/`:334`.

##### `GET P/catalogue-drift` (149 lignes)
- Liste les `ProjectCatalogueSnapshot` du projet et compare `arkyoVersion` à `updatedAt` de la source main (requêtes groupées par `itemType`, `healBuggySnapshotData`).
- Réponse `[{snapshotId, itemType, arkyoSourceId, name, hasDrift, sourceDeleted, snapshotVersion, currentVersion}]`, ou `[]` sans snapshot.
- Appelant : `.../inventaire/_components/use-catalogue-drift.ts:57`, hook monté par `inventaire-scope.tsx:64`/`:532`.

Côté front, le portage retire, avec un commentaire `// arkyo-server: snapshots non portés` :
- le badge de dérive et `UpdateSnapshotModal` dans `rack-card-canvas.tsx`
- `useCatalogueDrift` dans `inventaire-scope.tsx` (`getDrift` renvoie toujours « pas de dérive »)

---

#### 19. Tableau récapitulatif

Perm = « session » : `auth()` seul, aucune permission de rôle dans arkyo.

| Chemin (`/api/tenant/projects/:id/…`) | Méthodes | Lignes | Perm | Événements | Audit | SaaS ? | Appelants front |
|---|---|---:|---|---|---|---|---|
| `racks/:rackId` | PATCH, DELETE | 204 | session | `rack updated`, `rack deleted` | `update_rack`, `delete_rack` | fantôme | inventaire-scope, container-properties-panel, project-editor, inventaire-client |
| `racks/:rackId/canvas-data` | GET | 587 | session | — | — | **snapshots + mainDb** | rack-tab-client (×2), rack-export-stage |
| `racks/:rackId/inventory` | GET, POST | 1243 | session | `rack_inventory updated` | `create_inventory_item` | **snapshots + mainDb**, fantôme | inventaire-scope (×6), use-rack-bom, component-config-modal (bom-panel mort) |
| `racks/:rackId/inventory/:itemId` | PATCH, DELETE | 277 | session | `rack_inventory updated` | `update_inventory_item`, `delete_inventory_item` | mainDb, fantôme | inventaire-scope, rack-card-canvas, item-properties-panel, slot-ruler, component-config-modal |
| `racks/:rackId/inventory/:itemId/transfer` | POST | 168 | session | `rack_inventory updated` ×2 | `transfer_inventory_item` | fantôme | inventaire-scope |
| `racks/:rackId/save-as-template` | POST | 125 | session | `rig created` | `save_rack_as_template` | fantôme (snapshotId recopié) | container-properties-panel |
| `racks/clone-from-template` | POST | 269 | session | `rig updated` | `clone_rack_from_template` | mainDb (via services), fantôme | add-container-wizard |
| `racks/reorder` | POST | 86 | session | `rack updated` (id = projet) | `reorder_racks` | fantôme | inventaire-scope, project-editor |
| `equipments` | GET, POST | 251 | session | `project_equipment created` | `add_project_equipments` | mainDb, fantôme | **aucun** |
| `equipments/:equipmentId` | DELETE | 57 | session | `project_equipment deleted` | `remove_project_equipment` | fantôme | **aucun** |
| `rack-slots` | POST | 210 | session | `slot created`, `rack_inventory updated` | `add_rack_slots` | mainDb, fantôme | **aucun** |
| `inventaire/catalog` | GET | 59 | session | — | — | **fusion catalogue** (`shadowsArkyo`) | inventaire-scope (×2), catalog-panel |
| `locations/:locationId` | PATCH, DELETE | 191 | session | `location updated`, `location deleted` | `update_location`, `delete_location` | fantôme | inventaire-scope (×2), general-canvas |
| `audit` | GET | 84 | session (`!session`) | — | — (lecture) | non | audit-panel (synoptique) |
| `cabling` | GET | 441 | session | — | — | mainDb | cables-section (Préparation), dossier-generators, section-pdf-generators (Réseau) |
| `cabling/:cableId` | PATCH | 122 | session | `rackConnection updated`, `projectConnection updated` (+clientId) | `cabling.wired_set` | fantôme | **aucun** |
| `cabling/assign-model` | POST | 148 | session | `rackConnection updated`, `projectConnection updated` (+clientId) | `cabling.assign_model` | mainDb, fantôme | cables-section (Préparation) |
| `snapshots/:snapshotId/accept-update` | POST | 257 | session | `tenant_catalogue_snapshot updated` | `accept_snapshot_update` | **oui, non porté** | update-snapshot-modal |
| `snapshots/:snapshotId/update-preview` | GET | 224 | session | — | — | **oui, non porté** | update-snapshot-modal |
| `catalogue-drift` | GET | 149 | session | — | — | **oui, non porté** | use-catalogue-drift |

**Lignes** : 4 522 pour les 17 routes à porter, 630 pour les 3 routes SaaS, soit **5 152 au total**.

Routes à porter, regroupées par phase selon leurs appelants :
- **Phase 4** :
  - onglet Inventaire : `racks/:rackId`, `inventory*`, `transfer`, `save-as-template`, `clone-from-template`, `reorder`, `inventaire/catalog`, `locations/:locationId`
  - élévations rack : `canvas-data`
  - synoptique : `audit`, `locations` PATCH
- **Phase 6** (Préparation, dossier) : `cabling`, `cabling/assign-model` ; `cabling/:cableId` sans appelant.
- **Sans appelant** (parité d'API seulement, à porter en dernier ou à documenter comme non portées) : `equipments`, `equipments/:equipmentId`, `rack-slots`, `cabling/:cableId`.

#### 20. Services `lib/` importés par ces routes

| Fichier | Lignes | Utilisé par | Fonctions | Statut local |
|---|---:|---|---|---|
| `lib/tenant-context.ts` | 163 | toutes | `requireTenantDb`, `assertNotGhost` (no-op), `GhostModeError` | SaaS : session + `require` |
| `lib/app-events.ts` | 163 | toutes les écritures | `publishAppUpdate` | porté (`src/events.rs`) |
| `lib/client-id.ts` | 98 | cabling/:cableId, assign-model | `readClientIdFromRequest` | porté (`src/http/client_id.rs`) |
| `lib/form-errors.ts` | 145 | routes « Validation invalide » | `zodIssuesFromError` | à reprendre (format `issues`) |
| `lib/db-main.ts` | 12 | canvas-data, inventory, equipments, rack-slots, cabling, assign-model, clone-from-template (import inutilisé) | `mainDb` | SaaS : tables `Tenant*` |
| `lib/services/rack-naming.ts` | 71 | racks/:rackId, save-as-template, clone-from-template | `ensureUniqueRackName` | porté (`src/projects/naming.rs`) |
| `lib/services/rack-inventory.ts` | 385 | inventory POST | `validateInventoryRef` (+ prédicats) | à porter (la partie validation, environ 100 lignes) |
| `lib/services/rack-inventory-sync.ts` | 345 | inventory POST, inventory/:itemId PATCH, rack-slots | `syncInventorySlots`, `ensureGhostSlotForEquipment`/`ensureGhostSlotForRef`, `findClaimableGhostSlot` | à porter (cœur du rapprochement inventaire ↔ slots) |
| `lib/services/auto-label.ts` | 28 | via rack-inventory-sync | `generateUniqueLabel` (`#XXXX`) | à porter |
| `lib/services/rack-inventory-api.ts` | 567 | inventory, inventory/:itemId, clone-from-template | `resolveComponentEquipmentFields`, `resolveComponentSpansBatch`, `resolveIsComponentHost`, `enrichRowsForTemplate`, `inventorySelectFields` | à porter en lecture locale |
| `lib/services/rack-clone.ts` | 352 | save-as-template, clone-from-template | `cloneRackInto` | à porter (à mutualiser avec `clone_rack` de `racks.rs`) |
| `lib/services/catalog-enrich.ts` | 314 | clone-from-template | `fetchCatalogEquipmentMap` | lecture locale (cf. `src/projects/enrich.rs`) |
| `lib/services/cable-length.ts` | 158 | cabling | `estimateCableLength`, `CONNECTOR_DEPTHS` | à porter (fonction pure) |
| `lib/services/catalog-merge.ts` | 353 | inventaire/catalog | `fetchMergedInventaireEquipments`, `fetchMergedInventaireAdapters` | **SaaS** : seule la branche perso est gardée |
| `lib/services/tenant-catalogue.ts` | 238 | via catalog-merge | `eclipsedArkyoIds` | **SaaS**, non porté |
| `lib/services/project-snapshot-resolve.ts` | 113 | canvas-data, inventory | `loadProjectSnapshotMap`, `resolveEquipmentData`, `extractBrandId` | **SaaS**, non porté |
| `lib/services/snapshot-placement.ts` | 133 | inventory | `getOrCreateSnapshot` | **SaaS**, non porté |
| `lib/services/project-snapshot.ts` | 311 | les 3 routes snapshot, snapshot-placement | `computeSnapshotDiff`, `extractArkyoData`, `computeDrift`, `healBuggySnapshotData` | **SaaS**, non porté |

**Lignes** : 2 789 pour les services à porter ou déjà portés (de `tenant-context` à `cable-length`, hors `db-main`), 1 160 pour les services SaaS (`db-main`, `catalog-merge`, `tenant-catalogue`, `project-snapshot-resolve`, `snapshot-placement`, `project-snapshot`), soit **3 949 au total**.

---

# Annexe C : routes `tenant/projects/[id]/synoptic/**` et `synoptic-guides`

### Inventaire C : routes synoptique projet (phase 4)

Référence : arkyo@88b2e4b (`.ref/arkyo`). Chemins cités relativement à `.ref/arkyo`.
Abréviation : `P/` = `app/api/tenant/projects/[id]/`. Préfixe d'URL : `/api/tenant/projects/{id}/`.

Périmètre : 18 fichiers de route, 3 350 LOC (`wc -l`), 29 handlers exportés (11 GET, 18 écritures).

---

#### 0. Préambule commun à tous les handlers

Ces points valent pour tous les handlers ci-dessous. Les blocs par route ne donnent que les numéros de ligne.

- **Session** : `const session = await auth(); if (!session?.user?.id) → 401 { "error": "Unauthorized" }` (message anglais, à reprendre tel quel).
- **Permission** : **aucune**. Pas de `requirePermission`, de rôle ni de contrôle `canEdit`. La seule barrière est `requireTenantDb()` (`lib/tenant-context.ts:126-146`) : slug tenant + membership actif, sinon `TenantAccessError` non interceptée, donc **500**. C'est du SaaS : en local, la session suffit (même règle qu'arkyo).
- **Ghost mode** (écritures) : `try { await assertNotGhost() } catch (GhostModeError) → 403 { "error": "Mode lecture seule" }`. `assertNotGhost` est un **no-op** dans la référence (`lib/tenant-context.ts:161-163`, `@deprecated`), donc la branche 403 est du **code mort**. À ne pas porter.
- **Projet ou objet absent** : `404 { "error": "Not found" }` (anglais).
- **Corps illisible** : `await req.json().catch(() => ({}))`. Un JSON invalide devient `{}` puis passe la validation : 400 si un champ est requis, sinon PATCH vide.
- **Format d'erreur de validation (Zod 4.3, `package.json:78`)** :
  - standard : `400 { "error": "Validation invalide", "issues": [{ "path": [...], "message": "..." }] }` via `zodIssuesFromError` (`lib/form-errors.ts:133`). Un chemin vide est normalisé en `["root"]`. Les messages sont ceux de Zod par défaut, **en anglais** : aucune locale `z.config` dans arkyo. Le helper Rust `zod_issues` / `invalid` existe déjà (`crates/arkyo-server/src/http/projects/mod.rs:174-190`).
  - **exception** `synoptic-guides` POST : forme legacy `400 { "error": parsed.error.flatten() }`, soit `{ "error": { "formErrors": [], "fieldErrors": { "<champ>": ["..."] } } }`.
  - Zod `z.object` retire les clés inconnues. Les clés optionnelles absentes ne sont pas recopiées, ce qui explique pourquoi les PATCH testent `"champ" in parsed.data`.
  - Zod 4 : `z.number()` refuse `NaN` et `±Infinity`, donc `.finite()` est redondant.
- **Audit** : `db.auditLog.create({ userId, action, entityType, entityId, projectId, after? })`. Aucune route ne pose `before`. L'échec est avalé par `.catch(console.warn)` : best-effort, jamais bloquant.
- **Temps réel** : `publishAppUpdate(entity, action, id, meta)` (`lib/app-events.ts:120-163`). Payload SSE : `{ entity, action, id?, projectId?, rackId?, itemId?, clientId?, data? }`. Le tag `tenantSlug` ambiant (`app-events.ts:99-106,160`) est du SaaS, à retirer. `clientId` = en-tête `X-Client-Id` lu par `readClientIdFromRequest` (`lib/client-id.ts:88-98`). Équivalents Rust existants : `events.rs::publish_meta` et `http/client_id.rs`.
- **Le front écoute** les entités `project_synoptic_connection|zone|label|adapter|bundle|layout` (`app/(fullscreen)/project/[id]/synoptique/synoptique-tab-client.tsx:289-294`). `synoptic_guide` n'est écouté nulle part.

---

#### 1. `synoptic-guides` : `P/synoptic-guides/route.ts` (94 LOC). **Route inutilisée**

##### GET `/api/tenant/projects/{id}/synoptic-guides` (l. 22-40)
- Session : 23-25. Pas de ghost. Projet : 30-31 → 404 « Not found ».
- Query params : aucun.
- Lecture : `SynopticGuide.findMany({ where: { projectId }, select: { id, axis, position, color, label }, orderBy: createdAt asc })` (33-37).
- Réponse 200 : `[{ id, axis, position, color, label }]`.
- Événement, audit : aucun.

##### POST (l. 44-94)
- Session : 45-47. Ghost : 49-55 (mort). Projet : 60-61 → 404. Le projet est vérifié **avant** la validation.
- Corps `createSchema` (10-18) :
  - `axis` : `enum["h","v"]`, requis (11) ;
  - `position` : `number().finite()`, requis (12) ;
  - `color` : `string`, regex `^#[0-9a-fA-F]{6}$`, optionnel (13-16), défaut `"#06b6d4"` (73) ;
  - `label` : `string`, optionnel (17), défaut `null` (74).
- Validation : 64-66 → **400 `{ error: flatten() }`** (forme legacy).
- Écriture : `SynopticGuide.create` (68-76). `rackId` reste NULL.
- Réponse **201** (93) : ligne complète `{ id, rackId: null, projectId, axis, position, color, label, createdAt, updatedAt }`.
- Audit (78-89) : `action "add_synoptic_guide"`, `entityType "Project"`, `entityId = projectId`, `after { axis, position }`.
- Événement (91) : `publishAppUpdate("synoptic_guide", "created", projectId, { projectId })`. L'id est le **projectId** (pas celui du guide), sans itemId ni clientId. `readClientIdFromRequest` n'est **pas** utilisé.
- Il n'y a **ni PATCH ni DELETE** de guide dans arkyo.
- Appelants front : **aucun**. Les guides du synoptique vivent en `localStorage` (`components/synoptique/synoptic-view.tsx:2720,2742`, clé `synoptic-guides-${viewKeyBase}`). Les autres occurrences sont des sélecteurs DOM `data-synoptic-guides`.
- Snapshots : sans objet.

---

#### 2. `synoptic/adapters` : `P/synoptic/adapters/route.ts` (176 LOC). **Route inutilisée**

##### GET (l. 26-70)
- Session : 27-29. Projet : 34-35 → 404.
- Lecture : `ProjectSynopticAdapter.findMany({ projectId }, createdAt asc)` (37-40).
- Composition : `mainDb.catalogAdapter.findMany({ id in catalogIds })` (43-50), puis repli sur `db.tenantAdapter` pour les ids manquants (55-62).
- Réponse 200 : `[{ id, projectId, catalogAdapterId, snapshotId, x, y, notes, color, createdAt, updatedAt, adapter: <ligne CatalogAdapter ou TenantAdapter complète> | null }]`.
- **Snapshots, SaaS** : `snapshotId` n'est **pas** lu ici (pas de résolution snapshot). Le double lookup main + tenant (43-62) se réduit à **un seul** `SELECT * FROM "TenantAdapter" WHERE id IN (…)`.

##### POST (l. 74-176)
- Session : 75-77. Ghost : 79-85. clientId : 89 (`readClientIdFromRequest`).
- Corps `createSchema` (14-22) :
  - `catalogAdapterId` : `string.min(1)`, optionnel (16) ;
  - `adapterId` : `string.min(1)`, optionnel, alias legacy (17) ;
  - `x` : `number`, requis (18) ;
  - `y` : `number`, requis (19) ;
  - `notes` : `string`, optionnel (20) ;
  - `color` : `string`, optionnel (21).
- Ordre des contrôles :
  1. validation 92-97 → 400 « Validation invalide » ;
  2. projet 99-100 → 404 « Not found » ;
  3. `catalogAdapterId ?? adapterId ?? null` (102), absent → **400 `{ "error": "catalogAdapterId requis" }`** (103-104) ;
  4. lookup catalogue (109-123), absent → **404 `{ "error": "Adaptateur introuvable dans le catalogue" }`** (124-125).
- Écriture : `ProjectSynopticAdapter.create({ projectId, catalogAdapterId, snapshotId, x, y, notes ?? null, color ?? null })` (138-148).
- Réponse **201** (175) : `{ ...instance, adapter: catalogAdapter }`. **Attention** : `adapter` vaut seulement `{ id }` (select `id`, 109-112, 115-118), pas l'objet complet comme au GET.
- Audit (156-167) : `"create_project_synoptic_adapter"`, `entityType "ProjectSynopticAdapter"`, `entityId instance.id`, `after { catalogAdapterId }`.
- Événement (169-173) : `("project_synoptic_adapter", "created", instance.id, { projectId, itemId: instance.id, clientId })`.
- **Ce qui disparaît sans snapshots** :
  - l'import `getOrCreateSnapshot` (l. 9) ;
  - le drapeau `isPersonalAdapter` (113, 121) ;
  - le bloc 127-136 (`getOrCreateSnapshot(db, projectId, "ADAPTER", id)`, qui écrit `ProjectCatalogueSnapshot` en main DB → tenant) ;
  - `snapshotId: snapshotResult?.snapshotId ?? null` (142) devient toujours `NULL`.
  
  Les deux lookups main puis tenant (109-123) se réduisent à `TenantAdapter WHERE id = ?`.

##### Appelants front : **aucun** (ni GET ni POST).

---

#### 3. `synoptic/adapters/[adapterInstanceId]` : `P/synoptic/adapters/[adapterInstanceId]/route.ts` (145 LOC). **Route inutilisée**

Helper d'appartenance `assertAdapterBelongsToProject` (20-29) : `findFirst({ id, projectId })`.

##### PATCH (l. 33-100)
- Session : 34-36. Ghost : 38-44. clientId : 48. Appartenance : 50-51 → 404 (vérifiée **avant** la validation).
- Corps `patchSchema` (13-18) :
  - `x` : `number`, optionnel (14) ;
  - `y` : `number`, optionnel (15) ;
  - `notes` : `string`, optionnel, nullable (16) ;
  - `color` : `string`, optionnel, nullable (17).
- Validation : 53-59 → 400 « Validation invalide ».
- Écriture : update partiel (61-70). `notes` et `color` sont mis à null si la clé est présente avec `null`.
- Composition : `mainDb.catalogAdapter.findUnique` (73-78), **sans repli TenantAdapter**. Un adaptateur perso renvoie donc `adapter: null` dans arkyo.
- Réponse 200 (99) : `{ ...updated, adapter: CatalogAdapter | null }`.
- Audit (80-91) : `"update_project_synoptic_adapter"`, `entityId adapterInstanceId`, `after = parsed.data` (clés envoyées).
- Événement (93-97) : `("project_synoptic_adapter", "updated", adapterInstanceId, { projectId, itemId, clientId })`.
- **SaaS** : `mainDb` (73-78) devient un lookup `TenantAdapter`. En local, tous les adaptateurs sont résolus, ce qui s'écarte d'arkyo pour les perso (qui y renvoient null). Je recommande de résoudre via `TenantAdapter`, puisque le catalogue local est unique.

##### DELETE (l. 104-145)
- Session : 105-107. Ghost : 109-115. clientId : 119. Appartenance : 121-122 → 404.
- Écriture : `ProjectSynopticAdapter.delete` (124). **Cascade côté base** : `ProjectConnection.fromAdapterId` / `toAdapterId` sont en `onDelete: Cascade` (`database/tenant/schema.prisma:950,961`), donc les câbles projet attachés sont supprimés. Dans le schéma SQLite, poser `ON DELETE CASCADE` sur ces FK.
- Réponse 200 (144) : `{ "ok": true }`.
- Audit (126-136) : `"delete_project_synoptic_adapter"`, sans `after`.
- Événement (138-142) : `"deleted"`, même meta que le PATCH.

##### Appelants front : **aucun**.

---

#### 4. `synoptic/bundles` : `P/synoptic/bundles/route.ts` (97 LOC). **Route inutilisée**

##### GET (l. 19-37)
- Session : 20-22. Projet : 27-28 → 404.
- Lecture : `ProjectCableBundle.findMany({ projectId }, include: { cables: { select: { id } } }, createdAt asc)` (30-34).
- Réponse 200 : `[{ id, projectId, name, color, createdAt, updatedAt, cables: [{ id }] }]`.

##### POST (l. 41-97)
- Session : 42-44. Ghost : 46-52. clientId : 56.
- Corps (12-15) :
  - `name` : `string.min(1)`, requis (13) ;
  - `color` : `string`, optionnel (14), défaut `"#6366f1"` (73).
- Validation : 59-64 → 400. Projet ensuite : 66-67 → 404.
- Écriture : `ProjectCableBundle.create` (69-75).
- Réponse **201** (96) : la ligne, sans `cables`.
- Audit (77-88) : `"create_project_cable_bundle"`, `entityType "ProjectCableBundle"`, `after { name }`.
- Événement (90-94) : `("project_synoptic_bundle", "created", bundle.id, { projectId, itemId, clientId })`.

---

#### 5. `synoptic/bundles/[bundleId]` : `P/synoptic/bundles/[bundleId]/route.ts` (134 LOC). **Route inutilisée**

Helper d'appartenance : 19-28.

##### PATCH (l. 32-88)
- Session : 33-35. Ghost : 37-43. clientId : 47. Appartenance : 49-50 → 404.
- Corps (12-15) :
  - `name` : `string.min(1)`, optionnel ;
  - `color` : `string`, optionnel (non nullable).
- Validation : 53-58 → 400. Update : 60-66.
- Réponse 200 (87) : la ligne, sans `cables`.
- Audit (68-79) : `"update_project_cable_bundle"`, `after = parsed.data`.
- Événement (81-85) : `"updated"`.

##### DELETE (l. 92-134)
- Session : 93-95. Ghost : 97-103. clientId : 107. Appartenance : 109-110.
- Écriture : delete (113). `ProjectConnection.bundleId` passe en **SET NULL** (`schema.prisma:981`, `onDelete: SetNull`). Utiliser une FK `ON DELETE SET NULL`.
- Réponse 200 : `{ ok: true }` (133).
- Audit (115-125) : `"delete_project_cable_bundle"`.
- Événement (127-131) : `"deleted"`.

---

#### 6. `synoptic/canvas-data` : `P/synoptic/canvas-data/route.ts` (500 LOC). **Route inutilisée**

(Le front appelle `racks/[rackId]/canvas-data`, une autre route : `app/(fullscreen)/project/[id]/rack/rack-tab-client.tsx:475,530`.)

##### GET (l. 25-500)
- Session : 26-28. Projet : 33-46 → 404, avec `include rigConfigs.rigRacks(position asc).rack`. Le `rack: true` (40) est chargé mais seul `rackId` sert : include mort.
- `rackIds` = tous les `RigRack.rackId` des régies du projet (48-50).
- Lectures parallèles (52-188) :
  - `ProjectSynopticLayout` (sans `rack`), `ProjectConnection`, `ProjectSynopticAdapter`, `ProjectCableBundle`, `ProjectSynopticZone`, `ProjectSynopticLabel` : tous `projectId`, tri `createdAt asc` ;
  - `Rack.findMany({ id in rackIds })` avec `slots` top-level (`parentSlotId null`, tri `startU asc`) et un select explicite (96-145) ;
  - `RackConnection`, `SynopticAdapter`, `RackZone`, `RackLabel` des racks ;
  - `mainDb.catalogConnectorType` (`id, name, versions, iconId, color, functions{functionId}`) ;
  - `mainDb.catalogSignalType` (`id, name, color, cablePrefix, cableSuffix, functionId, isIp`).
- Puis :
  - `loadProjectSnapshotMap` (193) ;
  - composants imbriqués `RackInventoryItem where hostItemId in …` (200-221) ;
  - équipements main (248-254) puis repli `TenantEquipment` (259-281) ;
  - marques main puis repli `TenantBrand` (284-310) ;
  - adaptateurs projet main puis repli tenant (320-346) ;
  - adaptateurs intra-rack main puis repli tenant (350-376).
- Réponse 200 (476-499) :
  - `layout` : `ProjectSynopticLayout[]` bruts ;
  - `connections` : `ProjectConnection[]` bruts ;
  - `adapters` : `ProjectSynopticAdapter[]` + `adapter` (`resolveAdapterData` : données du snapshot, sinon ligne catalogue complète, sinon null) ;
  - `bundles` : `ProjectCableBundle[]` bruts, sans `cables` ;
  - `zones`, `labels` : lignes brutes ;
  - `racks` : `Rack` (tous les scalaires) + `slots[]`, chaque slot portant :
    - `{ id, rackId, catalogEquipmentId, snapshotId, panelId, view, startU, heightU, widthFraction, column, label, synopticX, synopticY, inventoryItemId }` ;
    - `equipment` : `{ id, name, reference, category, heightU, weight, powerW, depthMm, imageUrl, widthFraction, connectors, rackSymbolUrl, brandId, componentSlotSpan, brand: { id, name } | null } | null` ;
    - `components` : `[{ itemId, slotIndex, slotSpan, equipment }]` (`slotSpan` = `componentSlotSpan` sinon 1) ;
    - `panel` : `{ id, name, heightU, slotsPerU, slots: [{ id, position, sizeSlots, label, catalogConnectorTypeId, mountD, connectorTypeId, connectorType: { id, name, versions, iconId, color, functions: [{ functionId }] } | null }] } | null` ;
    - `children` : `[{ id, catalogEquipmentId, snapshotId, synopticX, synopticY, heightU, widthFraction, inventoryItemId, equipment, components }]` ;
  - `intraConnections` : `RackConnection[]` bruts ;
  - `intraAdapters` : `SynopticAdapter[]` + `adapter` ;
  - `intraZones` : `RackZone[]` ;
  - `intraLabels` : `RackLabel[]` ;
  - `connectorTypes` : `[{ id, name, versions, functionId (= functions[0]), iconId, color }]`. La couleur est **brute** : pas de repli sur la couleur de fonction, contrairement à general/focus ;
  - `signals` : lignes brutes ;
  - `signalCategories` : `[]` constant (498).
- Erreurs : 401 et 404 seulement. Événement, audit : aucun.
- **Ce qui disparaît sans snapshots** :
  - import l. 5-11 réduit (plus de `loadProjectSnapshotMap` ni de `SnapshotData`) ;
  - l. 193 (`snapshotMap`) supprimée ;
  - l. 289-292 (marques extraites des snapshots) supprimées ;
  - `resolveEquipmentData` / `resolveAdapterData` (398, 423, 446, 466, 472) deviennent de simples `map.get(catalogId)` ;
  - les clés `snapshotId` restent dans le select (102, 135, 218), valant toujours `null`, pour la forme JSON.
- **SaaS** : chaque paire main puis repli tenant (équipements, marques, adaptateurs ×2) devient **une seule** requête `Tenant*`. `catalogConnectorType.functions[0].functionId` correspond à `TenantConnectorType.functionIds[0]` (JSON). `category` (champ legacy de `CatalogEquipment`) n'existe pas dans `TenantEquipment` : clé absente, comme déjà pour les équipements perso dans arkyo.

---

#### 7. `synoptic/connections` : `P/synoptic/connections/route.ts` (167 LOC)

##### GET (l. 41-58). **Inutilisé**
- Session : 42-44. Projet : 49-50 → 404.
- Réponse 200 : `ProjectConnection[]` complets, tri `createdAt asc` :
  `{ id, projectId, fromRackId, fromSlotId, fromConnectorIndex, fromAdapterId, fromAdapterPortIndex, fromAdapterSide, toRackId, toSlotId, toConnectorIndex, toAdapterId, toAdapterPortIndex, toAdapterSide, label, color, waypoints, cableStyle, notes, tags, catalogCableModelId, wired, wiredAt, wiredNotes, bundleId, createdAt }`.

##### POST (l. 62-167)
- Session : 63-65. Ghost : 67-73. clientId : 77.
- Corps :
  - `endpointSchema` (13-25) :
    - `rackId` : `string.min(1)`, requis (15) ;
    - `slotId` : `string`, optionnel (16) ;
    - `connectorIndex` : `int`, optionnel (17) ;
    - `adapterId` : `string`, optionnel (18) ;
    - `adapterPortIndex` : `int`, optionnel (19) ;
    - `adapterSide` : `enum["left","right"]`, optionnel (20) ;
    - `.refine(!(slotId && adapterId))` (22-25), message « Endpoint ne peut pas avoir à la fois slotId et adapterId » (issue au chemin `["from"]` ou `["to"]`).
  - `createSchema` (27-37) :
    - `from`, `to` : `endpointSchema`, requis ;
    - `label` : `string`, optionnel ;
    - `color` : `string`, optionnel ;
    - `waypoints` : `unknown`, optionnel (`{x,y}[]`) ;
    - `cableStyle` : `enum["ortho","rounded","arrow"]`, optionnel ;
    - `notes` : `string`, optionnel ;
    - `tags` : `unknown`, optionnel (`[{color,text}]`) ;
    - `bundleId` : `string`, optionnel.
    
    `catalogCableModelId` n'est **pas** accepté à la création.
- Erreurs, dans l'ordre :
  1. 400 « Validation invalide » (80-85) ;
  2. 404 « Not found » pour le projet (87-88) ;
  3. **404 `{ "error": "Un rack n'appartient pas à ce projet" }`** (99-101) si `racks.length < 2`. Le test d'appartenance est `rigs.some.rigConfig.projectId` (91-98). **Particularité** : `from.rackId === to.rackId` ne renvoie qu'une ligne, donc ce 404 tombe toujours (câble intra-rack refusé) ;
  4. **400 `{ "error": "Les deux extrémités sont dans le même emplacement — tirez un câble direct dans la vue de l'emplacement." }`** (106-117) si les deux `locationId` sont non nuls et égaux.
- Écriture : `ProjectConnection.create` (121-144). Champs absents → `null`. `waypoints` et `tags` absents → SQL NULL (`Prisma.DbNull`), sinon JSON. `wired` = false par défaut.
- Aucun contrôle que `slotId`, `adapterId` ou `bundleId` appartiennent au projet ou au rack. Un `bundleId` inexistant viole la FK, d'où un **500** non géré.
- Réponse **201** (166) : la ligne complète.
- Audit (146-157) : `"create_project_connection"`, `entityType "ProjectConnection"`, `after { fromRackId, toRackId }`.
- Événement (159-164) : `("project_synoptic_connection", "created", connection.id, { projectId, rackId: from.rackId, itemId, clientId })`.
- Appelants POST : `app/(fullscreen)/project/[id]/synoptique/_components/general-canvas.tsx:536`, `…/synoptique/_components/location-canvas.tsx:657`.
- Snapshots, mainDb : sans objet.

---

#### 8. `synoptic/connections/[connectionId]` : `P/synoptic/connections/[connectionId]/route.ts` (160 LOC)

Helper d'appartenance : 25-34.

##### PATCH (l. 38-115)
- Session : 39-41. Ghost : 43-49. clientId : 53. Appartenance : 55-56 → 404.
- Corps (12-21), tous optionnels et nullables :
  - `label` : `string` ;
  - `color` : `string` ;
  - `waypoints` : `unknown` ;
  - `cableStyle` : `enum[ortho, rounded, arrow]` ;
  - `notes` : `string` ;
  - `tags` : `unknown` ;
  - `bundleId` : `string` ;
  - `catalogCableModelId` : `string`.
- Validation : 60-64 → 400.
- Mise à jour (66-93), clé présente uniquement :
  - `waypoints` / `tags` : `null` → SQL NULL ;
  - `bundleId` : via relation (80-85). Un id inexistant donne P2025, donc **500**. Pas de contrôle que le faisceau appartient au même projet.
- Réponse 200 (114) : la ligne complète.
- Audit (95-106) : `"update_project_connection"`, `after = parsed.data`.
- Événement (108-112) : `("project_synoptic_connection", "updated", connectionId, { projectId, itemId, clientId })`. Pas de `rackId`.
- Appelants PATCH :
  - `general-canvas.tsx:579`, `:617`, `:627` (les deux derniers avec `{ label: null }` avant renumérotation) ;
  - `location-canvas.tsx:753`, `:822` (`{ label: null }`).
- `catalogCableModelId` est une soft-FK vers `CableModel` (main), qui devient `TenantCableModel` en local. Elle n'est pas vérifiée.

##### DELETE (l. 119-160)
- Session : 120-122. Ghost : 124-130. clientId : 134. Appartenance : 136-137.
- Écriture : delete (139). Cascade `CartoCablePath.connectionId` (`onDelete: Cascade`, `schema.prisma:1182`). Table de la phase cartographie : prévoir la FK quand elle arrivera.
- Réponse 200 : `{ ok: true }` (159).
- Audit (141-151) : `"delete_project_connection"`.
- Événement (153-157) : `"deleted"`.
- Appelants DELETE : `general-canvas.tsx:590`, `:598` ; `location-canvas.tsx:774`, `:805` ; `synoptique-tab-client.tsx:1122`.

---

#### 9. `synoptic/connections/renumber` : `P/synoptic/connections/renumber/route.ts` (316 LOC)

##### POST (l. 78-316)
- Session : 79-81. Ghost : 83-89. clientId : 93. Projet : 95-96 → 404.
- Corps : **aucun** (le front envoie `"{}"`). Query : aucune.
- Algorithme (pur une fois les données chargées) :
  1. `ProjectConnection` du projet, tri `createdAt asc` (99-112). Si vide → **`{ ok: true, count: 0 }`** (114-116), sans audit ni événement.
  2. Chargement parallèle (128-151) :
     - `RackSlot { id, catalogEquipmentId }` des slots référencés ;
     - `Rack { id, name, cableCode, numberingOverride }` ;
     - `AppConfig` pour les clés `ADMIN_CONFIG_KEYS` (38-47) : `cable_pad`, `cable_sep1`, `cable_sep2`, `cable_separator`, `cable_suffix_separator`, `cable_include_rack`, `cable_template`, `cable_template_enabled` ;
     - `mainDb.catalogSignalType { id, name, cablePrefix, cableSuffix, function{cablePrefix,cableSuffix} }`.
  3. `connectors` des équipements : main (157-163) puis repli `TenantEquipment` (168-176).
  4. Configuration par défaut (194-203) :
     - `pad = clamp(3, 10, Number(cable_pad ?? 5))` ;
     - `sep1 = cable_sep1 ?? cable_separator ?? "-"` ;
     - `sep2 = cable_sep2 ?? cable_suffix_separator ?? ""` ;
     - `includeRack = cable_include_rack !== "false"` ;
     - `template = cable_template ?? ""` ;
     - `templateEnabled = cable_template_enabled === "true"`.
     
     Elle est surchargée par `Rack.numberingOverride` (JSON partiel) **du rack source** (254-258).
  5. Par connexion (230-287) :
     - `getConnectorInfo(connectors, index)` (58-76) : index aplati par `quantity` ;
     - `signalName = from ?? to` ;
     - préfixe et suffixe du signal, sinon de sa fonction, sinon `""` (206-223) ;
     - `dirDigit` : `"3"` si BIDI ou BIDIR d'un côté, `"1"` si from IN, sinon `"2"` (248-251) ;
     - `rackCode = normCode(cableCode, 5) ?? normCode(name, 4)` (49-56 : majuscules, `[^A-Z0-9]` retirés, tronqué) ;
     - compteur **global au projet** par clé `${prefix || "__nosig__"}:${dirDigit}` (263) ;
     - `computeCableLabel({ zoneCode: null, … })` (`lib/services/cable-numbering.ts:541`) ;
     - en cas de collision avec un label déjà produit dans ce passage, `num++` (garde 10 000, 266-284).
  6. **Transaction** : `UPDATE ProjectConnection SET label` pour chaque connexion (290-296).
- Réponse 200 (315) : `{ ok: true, count: <n> }`. Erreurs : 401 et 404 seulement.
- Audit (298-308) : `action "project_connection.renumber"`, `entityType "Project"`, `entityId projectId`, sans `after`.
- Événement (310-313) : `("project_synoptic_connection", "renumbered", projectId, { projectId, clientId })`. L'id est le projectId, sans itemId.
- Appelants : `general-canvas.tsx:636`, `location-canvas.tsx:883` (précédés de PATCH `{ label: null }` et suivis d'un GET general ou location).
- **SaaS** : `mainDb.catalogSignalType` + `function` (140-150) deviennent `TenantSignalType` joint à `TenantFunction` (`functionId`). Le double lookup d'équipements (157-176) se réduit à `TenantEquipment`. Pas de snapshot dans cette route : les connecteurs viennent toujours du catalogue live, **même si le slot a un `snapshotId`** dans arkyo.

---

#### 10. `synoptic/focus/[rackId]` : `P/synoptic/focus/[rackId]/route.ts` (113 LOC). **Route inutilisée**

(Seule mention : un commentaire, `components/synoptique/types/synoptic.ts:248`.)

##### GET (l. 39-113)
- Session : 40-42. Appartenance du rack (`rigs.some.rigConfig.projectId`, 16-28) : 47-48 → 404. `loadRackForPayload` null : 74 → 404.
- Construction : entièrement dans `lib/services/synoptic-focus-payload.ts` :
  - `loadRackForPayload` (33-104) ;
  - `loadCableAppConfig` (132-139) ;
  - `ProjectConnection` touchant le rack (56-71, select `ProjectConnectionForTargetLabel`) ;
  - `buildCatalogLookups(db, mainDb, projectId, [rack])` (145-442) ;
  - `enrichRackPayload` (450-592) ;
  - `enrichExternalPortsTargetLabel` (616-762).
- Réponse 200 (97-112) :
  - `rack` : `rackMeta` = tous les scalaires `Rack` (`id, name, totalU, depthMm, …, cableId, cableNextNum, cableCode, numberingOverride, rackType, …, canvasX, canvasY, locationId, isVirtual, createdAt, updatedAt`), sans les tableaux de relations ;
  - `slots` : slots top-level (tri `synopticY asc nulls last`), chacun avec :
    - tous les scalaires `RackSlot` ;
    - `panel` : `{ id, name, heightU, slotsPerU, rearCableDepthMm, slots: [{ id, position, sizeSlots, label, notes, catalogConnectorTypeId, mountD, connectorTypeId, connectorType }] } | null` ;
    - `panelRows` : `RackSlotPanelRow[]` bruts ;
    - `attachedAdapters` : `[SynopticAdapter + adapter]` ;
    - `equipment` : ligne catalogue **complète** (`CatalogEquipment` ou `TenantEquipment`) `+ brand { id, name } | null`, ou null ;
    - `components` : `[{ itemId, slotIndex, slotSpan, equipment }]` ;
    - `children` : même enrichissement, avec `panel`, `panelRows`, `attachedAdapters` ;
  - `connections` : `RackConnection[] + bundle { id, name, color }`, tri `createdAt` ;
  - `zones` : `RackZone[]` ;
  - `labels` : `RackLabel[]` ;
  - `adapters` : `SynopticAdapter[] + adapter` ;
  - `bundles` : `CableBundle[]` (faisceaux du rack) ;
  - `externalPorts` : `ExternalPort { id, rackId, slotId, portIndex, labelX, labelY, label, kind, createdAt, updatedAt }` + `targetLabel` (`"RACK · Équipement · Port"`, ou null). **`targetCableLabel` n'est présent que si une ProjectConnection correspond** : clé **absente** sinon (624, 705 contre 760) ;
  - `panelRows` : `[{ id, slotId, rowIndex, synopticX, synopticY }]` à plat ;
  - `connectorTypes` : tous, `{ id, name, versions, iconId, color, functions, functionId }`, couleur résolue (propre si différente de `#6b7280`, sinon couleur de la fonction, sinon `#a3a3a3`) ;
  - `signals` : `[{ id, name, color (résolue), cablePrefix, cableSuffix, category (libellé de fonction), categoryRef: { name, cablePrefix, cableSuffix } | null }]` ;
  - `signalCategories` : `[{ name, cablePrefix, cableSuffix }]` (fonctions utilisées par les signaux) ;
  - `equipmentCategories` : `[{ id, name, color, children: [{ id, name, color }] }]` (parents de premier niveau) ;
  - `appConfig` : `Record<string,string>`, 15 clés `CABLE_APP_CONFIG_KEYS` (`synoptic-focus-payload.ts:114-130`).
- Événement, audit : aucun.
- **Ce qui disparaît sans snapshots** (dans le service) :
  - `loadProjectSnapshotMap` (`synoptic-focus-payload.ts:152`) ;
  - marques extraites des snapshots (321-324) ;
  - champ `snapshotMap` des lookups (431, 451) ;
  - `resolveEquipmentData` / `resolveAdapterData` (458, 481, 505, 509, 534, 546) deviennent des `map.get`.
- **SaaS** :
  - `mainDb` + repli tenant (222-231, 301-311, 325-342, 353-358) deviennent `Tenant*` ;
  - `catalogEquipmentCategory` → `TenantEquipmentCategory` ;
  - `catalogFunction` → `TenantFunction` ;
  - `functions[0].functionId` → `functionIds[0]`.
  - `enrichExternalPortsTargetLabel` ne lit que `mainDb.catalogEquipment` (668-672) et `catalogConnectorType` (686-690), **sans repli perso**. En local, tout est résolu, ce qui s'écarte d'arkyo pour les équipements perso (en mieux).

---

#### 11. `synoptic/general` : `P/synoptic/general/route.ts` (615 LOC)

##### GET (l. 20-615)
- Session : 21-23. Projet `{ id, name }` : 28-32 → 404.
- Lectures (tri, select) :
  - `Location` du projet, tri `sortOrder` (35-39) ;
  - racks du projet via les régies (43-58) : `{ id, name, rackType, totalU, canvasX, canvasY, emptyWeightKg, isVirtual, locationId }`.
- **Retour anticipé** si aucun rack (67-84) :
  `{ locations: [], racks: [], connections: [], bundles: [], connectorTypes: [], signals: [], signalCategories: [], appConfig: {}, project, stats: { rackCount: 0, totalWeightKg: 0, totalPowerW: 0 } }`.
  **Particularité** : `locations` est vide même si des lieux existent, contrairement au commentaire l. 34.
- Puis, dans l'ordre :
  - `ExternalPort` des racks (87-90) ;
  - `RackSlot` ciblés avec panel et ports (95-124) ;
  - `loadProjectSnapshotMap` (127) ;
  - chargement parallèle (142-231) :
    - main : `catalogEquipment { id, name, reference, connectors }` ;
    - `panelConnectorTypes`, **calculé mais jamais utilisé** : requête morte (144, 163-175) ;
    - tous les `catalogConnectorType`, `catalogSignalType`, `catalogFunction` ;
    - tenant : `ProjectConnection`, `ProjectCableBundle`, `AppConfig` (8 clés, 215-230) ;
  - repli `TenantEquipment` (238-246).
- Logique pure, en ligne :
  - `resolveSlotEqData` (256-267) : snapshot, sinon live ;
  - `eqMap` (269-277) ;
  - résolution des couleurs (292-319), identique au service focus ;
  - `resolvePortInfo(slotId, portIndex)` (335-400) :
    - panel : 2 ports par position occupée, pair = right, impair = left, direction `"BIDIR"` ;
    - équipement : index aplati par `quantity`, `side` = IN → left, sinon right, label `label || nom du type || "—"`, suffixé ` n` si quantité > 1 ;
  - `buildExternalConnectors` (428-471), avec repli de label `ep.label || info.label || slot.label || "Port n"` et `equipmentName = slot.label || panel.name || eq.name` ;
  - `sortExternalConnectors` (476-486) : left d'abord, puis `equipmentId ?? slotId`, `slotId`, `portIndex`. **Utilise `localeCompare`** : sur des cuid (minuscules et chiffres), l'ordre est équivalent à l'ordre octet, à vérifier par fixture ;
  - ports `kind = "MONDE"` exclus (420-426) ;
  - connexions inter-emplacements (553-558) : exclut celles dont les deux lieux sont non nuls et égaux ;
  - statistiques (569-597) : `RackSlot` de tous les racks, poids et puissance depuis **`mainDb.catalogEquipment` uniquement**.
- Réponse 200 (599-614) :
  - `locations` : `[{ id, name, cableCode, canvasX, canvasY, externalConnectors }]`, où chaque connecteur vaut `{ externalId, slotId, portIndex, label, direction, signalName, connectorTypeId, side: "left"|"right", equipmentId, equipmentName, rackId, rackName }` ;
  - `racks` : contenants non virtuels **sans lieu**, `[{ id, name, rackType, totalU, canvasX, canvasY, externalConnectors }]` (même forme, sans `rackId` ni `rackName`) ;
  - `connections` : `ProjectConnection[]` bruts inter-lieux ;
  - `bundles` : `ProjectCableBundle[]` bruts ;
  - `connectorTypes` : enrichis (`functions` + `functionId` + couleur résolue) ;
  - `signals` : enrichis (forme focus) ;
  - `signalCategories` ;
  - `appConfig` : 8 clés ;
  - `project` : `{ id, name }` ;
  - `stats` : `{ rackCount (racks non virtuels), totalWeightKg (arrondi à 0,1), totalPowerW (arrondi) }`.
- Erreurs : 401 et 404. Événement, audit : aucun.
- Appelants :
  - `app/(fullscreen)/project/[id]/synoptique/synoptique-tab-client.tsx:381` ;
  - `…/synoptique/_components/general-canvas.tsx:644` (rechargement après renumérotation) ;
  - `app/(fullscreen)/project/[id]/_components/dossier-synoptic.tsx:366` (dossier imprimable).
- **Ce qui disparaît sans snapshots** :
  - import l. 5 (`loadProjectSnapshotMap`) ;
  - l. 126-127 ;
  - branche snapshot de `resolveSlotEqData` (259-262) : la fonction devient `catalogEqMapLive.get(catalogEquipmentId)` ;
  - `snapshotId` du select (102) ne sert plus.
- **SaaS** :
  - les lookups main deviennent `Tenant*`, et la requête morte `panelConnectorTypes` est à supprimer ;
  - **statistiques** : arkyo ignore le poids et la puissance des équipements **perso** (580-584, pas de repli tenant). En local, tout passe par `TenantEquipment`, donc les totaux peuvent différer d'arkyo. C'est un écart assumé : le catalogue est unique.

---

#### 12. `synoptic/labels` : `P/synoptic/labels/route.ts` (102 LOC). **Route inutilisée**

##### GET (l. 22-39)
- Session : 23-25. Projet : 30-31.
- Réponse : `ProjectSynopticLabel[]` `{ id, projectId, x, y, text, color, fontSize, createdAt, updatedAt }`, tri `createdAt`.

##### POST (l. 43-102)
- Session : 44-46. Ghost : 48-54. clientId : 58.
- Corps (12-18) :
  - `x` : `number`, requis ;
  - `y` : `number`, requis ;
  - `text` : `string.min(1)`, requis ;
  - `color` : `string`, optionnel, défaut null ;
  - `fontSize` : `int().positive()`, optionnel, défaut null.
- Validation : 61-66 → 400. Projet : 68-69 → 404. Create : 71-80.
- Réponse **201** (101).
- Audit (82-93) : `"create_project_synoptic_label"`, `after { text }`.
- Événement (95-99) : `("project_synoptic_label", "created", label.id, { projectId, itemId, clientId })`.

#### 13. `synoptic/labels/[labelId]` : `P/synoptic/labels/[labelId]/route.ts` (140 LOC). **Route inutilisée**

##### PATCH (l. 35-95)
- Session : 36-38. Ghost : 40-46. clientId : 50. Appartenance (22-31) : 52-53 → 404.
- Corps (12-18) :
  - `x` : `number`, optionnel ;
  - `y` : `number`, optionnel ;
  - `text` : `string.min(1)`, optionnel ;
  - `color` : `string`, optionnel, nullable ;
  - `fontSize` : `int().positive()`, optionnel, nullable.
- Validation : 56-61 → 400. Update : 63-73.
- Réponse 200 (94).
- Audit (75-86) : `"update_project_synoptic_label"`, `after = parsed.data`.
- Événement (88-92) : `"updated"`.

##### DELETE (l. 99-140)
- Session : 100-102. Ghost : 104-110. clientId : 114. Appartenance : 116-117.
- Delete : 119. Réponse : `{ ok: true }` (139).
- Audit (121-131) : `"delete_project_synoptic_label"`.
- Événement (133-137) : `"deleted"`.

---

#### 14. `synoptic/layout` : `P/synoptic/layout/route.ts` (28 LOC). **Route inutilisée**

##### GET (l. 10-28)
- Session : 11-13. Projet : 18-19 → 404.
- Réponse 200 : `[{ id, projectId, rackId, x, y, isExpanded, createdAt, updatedAt, rack: { id, name } }]`, tri `createdAt`.

#### 15. `synoptic/layout/[rackId]` : `P/synoptic/layout/[rackId]/route.ts` (99 LOC). **Route inutilisée**

##### PATCH (l. 21-99), un upsert
- Session : 22-24. Ghost : 26-32. clientId : 36.
- Corps (12-16) :
  - `x` : `number`, optionnel ;
  - `y` : `number`, optionnel ;
  - `isExpanded` : `boolean`, optionnel.
- Validation : 39-44 → 400. Projet : 47-48 → 404.
- Rack via les régies (51-57) : **404 `{ "error": "Rack non trouvé dans ce projet" }`** (58-59).
- Écriture : `upsert` sur `@@unique([projectId, rackId])` (62-76). À la création, défauts `x 0`, `y 0`, `isExpanded true`. À la mise à jour, clés présentes uniquement. En SQLite : `INSERT … ON CONFLICT("projectId","rackId") DO UPDATE`, avec un index unique à créer.
- Réponse 200 (98) : la ligne complète.
- Audit (78-89) : `"update_project_synoptic_layout"`, `entityType "ProjectSynopticLayout"`, `entityId layout.id`, `after { rackId, ...parsed.data }`.
- Événement (91-96) : `("project_synoptic_layout", "updated", layout.id, { projectId, rackId, itemId: layout.id, clientId })`.

---

#### 16. `synoptic/location/[locationId]` : `P/synoptic/location/[locationId]/route.ts` (218 LOC)

##### GET (l. 27-218)
- Session : 28-30.
- Projet `{ id, name }` et `Location.findFirst({ id, projectId }, include racks { id, isVirtual })` en parallèle (35-41) :
  - projet absent → 404 (42) ;
  - lieu absent → 404 (43) ;
  - tous les racks sont null après chargement → 404 (109).
  
  L'ordre de `location.racks` n'est pas spécifié (pas d'`orderBy`). Fixer un ordre déterministe en Rust (rowid ou createdAt) et le documenter.
- Retour anticipé si aucun rack (48-73) : même forme, tableaux vides, `appConfig: {}`.
- Chargement :
  - `loadRackForPayload` × N (76) ;
  - `loadCableAppConfig` ;
  - `ProjectConnection` touchant au moins un rack du lieu (81-96) ;
  - `ProjectConnection` dont les deux extrémités sont dans le lieu, lignes brutes (99-105) ;
  - `buildCatalogLookups(…, racks)` (111) ;
  - boucle `enrichRackPayload` (134-156) ;
  - `enrichExternalPortsTargetLabel` **par rack** (161-173), soit N fois 2 à 4 requêtes.
- **Filtre de résorption** (180-192) : un port `kind != MONDE` dont la clé `${rackId}:${slotId}:${portIndex}` est une extrémité d'une ProjectConnection interne au lieu est masqué. Logique pure.
- Réponse 200 (194-217) :
  - `location` : `{ id, name, cableCode, virtualRackId }` ;
  - `racks` : `[{ id, name, cableCode, cableId, numberingOverride, isVirtual, totalU, rackType }]` ;
  - `slots` : slots enrichis de tous les racks (forme focus, `rackId` natif) ;
  - `connections` : `RackConnection + bundle` ;
  - `projectConnections` : `ProjectConnection[]` bruts internes au lieu ;
  - `zones`, `labels`, `adapters` : forme focus ;
  - `externalPorts` : forme focus, filtrés ;
  - `panelRows` : forme focus `+ rackId` ;
  - `bundles` ;
  - `connectorTypes`, `signals`, `signalCategories`, `equipmentCategories` ;
  - `appConfig` : 15 clés ;
  - `project` : `{ id, name }`.
- Événement, audit : aucun.
- Appelants :
  - `synoptique-tab-client.tsx:418` ;
  - `location-canvas.tsx:604` (URL construite) et `:891` (GET après renumérotation) ;
  - `_components/dossier-synoptic.tsx:361`.
- **Ce qui disparaît sans snapshots, SaaS** : identique au § 10 (tout passe par `synoptic-focus-payload.ts`). La route elle-même ne contient aucun code snapshot, seulement `mainDb` passé en paramètre (111, 167).

---

#### 17. `synoptic/zones` : `P/synoptic/zones/route.ts` (104 LOC). **Route inutilisée**

##### GET (l. 23-40)
- Session : 24-26. Projet : 31-32.
- Réponse : `ProjectSynopticZone[]` `{ id, projectId, x, y, w, h, color, label, createdAt, updatedAt }`.

##### POST (l. 44-104)
- Session : 45-47. Ghost : 49-55. clientId : 59.
- Corps (12-19) :
  - `x` : `number`, requis ;
  - `y` : `number`, requis ;
  - `w` : `number.positive`, requis ;
  - `h` : `number.positive`, requis ;
  - `color` : `string.min(1)`, requis ;
  - `label` : `string`, optionnel, défaut null.
- Validation : 62-67 → 400. Projet : 69-70 → 404. Create : 72-82.
- Réponse **201** (103).
- Audit (84-95) : `"create_project_synoptic_zone"`, `after { color, label }`.
- Événement (97-101) : `("project_synoptic_zone", "created", zone.id, { projectId, itemId, clientId })`.

#### 18. `synoptic/zones/[zoneId]` : `P/synoptic/zones/[zoneId]/route.ts` (142 LOC). **Route inutilisée**

##### PATCH (l. 36-97)
- Session : 37-39. Ghost : 41-47. clientId : 51. Appartenance (23-32) : 53-54.
- Corps (12-19) :
  - `x` : `number`, optionnel ;
  - `y` : `number`, optionnel ;
  - `w` : `number.positive`, optionnel ;
  - `h` : `number.positive`, optionnel ;
  - `color` : `string`, optionnel (non nullable, sans min) ;
  - `label` : `string`, optionnel, nullable.
- Validation : 57-62 → 400. Update : 64-75.
- Réponse 200 (96).
- Audit (77-88) : `"update_project_synoptic_zone"`, `after = parsed.data`.
- Événement (90-94) : `"updated"`.

##### DELETE (l. 101-142)
- Session : 102-104. Ghost : 106-112. clientId : 116. Appartenance : 118-119.
- Delete : 121. Réponse : `{ ok: true }` (141).
- Audit (123-133) : `"delete_project_synoptic_zone"`.
- Événement (135-139) : `"deleted"`.

---

#### 19. Appelants front : synthèse

Recherche dans `app/`, `components/`, `lib/` et `hooks/`, hors `app/api` :

| Route | Appelants |
|---|---|
| `synoptic/connections` POST | `app/(fullscreen)/project/[id]/synoptique/_components/general-canvas.tsx:536`, `…/location-canvas.tsx:657` |
| `synoptic/connections/[id]` PATCH | `general-canvas.tsx:579,617,627`, `location-canvas.tsx:753,822` |
| `synoptic/connections/[id]` DELETE | `general-canvas.tsx:590,598`, `location-canvas.tsx:774,805`, `synoptique-tab-client.tsx:1122` |
| `synoptic/connections/renumber` POST | `general-canvas.tsx:636`, `location-canvas.tsx:883` |
| `synoptic/general` GET | `synoptique-tab-client.tsx:381`, `general-canvas.tsx:644`, `app/(fullscreen)/project/[id]/_components/dossier-synoptic.tsx:366` |
| `synoptic/location/[locationId]` GET | `synoptique-tab-client.tsx:418`, `location-canvas.tsx:604/891`, `dossier-synoptic.tsx:361` |
| **Inutilisées** | `synoptic-guides` (GET, POST), `synoptic/connections` **GET**, `adapters` (×2 fichiers), `bundles` (×2), `canvas-data`, `focus/[rackId]`, `labels` (×2), `layout` (×2), `zones` (×2) |

On compte **13 fichiers de route sur 18 sans aucun appelant**, plus le GET de `connections`. Le synoptique actuel ne passe que par `general`, `location`, `connections` (POST/PATCH/DELETE) et `renumber`. Les zones, étiquettes et adaptateurs de la vue lieu passent par les routes `racks/*` (rack virtuel ou réel), hors de ce lot. Aucun test arkyo n'appelle ces routes : seul `cable-numbering` est testé (`lib/services/cable-numbering.test.ts`, `tests/unit/cable-numbering.test.ts`).

---

#### 20. Services `lib/` importés (transitivement, dans `lib/`)

| Module | LOC | Importé par (routes de ce lot) | Nature | Import hors `app/api` | Verdict pour arkyo-server |
|---|---|---|---|---|---|
| `lib/services/synoptic-focus-payload.ts` | 762 | focus, location | **Mixte**. DB : `loadRackForPayload` (33-104), `loadCableAppConfig` (132-139), `buildCatalogLookups` (145-442 : requêtes, puis maps et couleurs pures 287-441). **Pur** : `enrichRackPayload` (450-592) et la partie mise en correspondance / composition de `enrichExternalPortsTargetLabel` (696-761) | non | Porter en Rust en séparant chargement SQL et fonctions pures. Les fonctions pures se testent avec des fixtures JSON (entrée : rack chargé + lookups ; sortie : payload). |
| `lib/services/project-snapshot-resolve.ts` | 113 | canvas-data, general, focus et location (via le précédent) | `loadProjectSnapshotMap` lié à la base ; `resolveEquipmentData`, `resolveAdapterData`, `extractBrandId` purs | `lib/services/synoptic-focus-payload.ts` seulement (côté serveur) | **SaaS (snapshots)**, à ne pas porter. Les résolutions deviennent `map.get(catalogId)`. `extractBrandId` reste un trivial `data.brandId`. |
| `lib/services/snapshot-placement.ts` | 133 | adapters POST | Lié à la base (tenant + `mainDb`) | non | **SaaS, à supprimer**. `snapshotId` reste NULL (décision 5 de la phase 3, `migrations/0003_projets.sql:19-20`). |
| `lib/services/project-snapshot.ts` (transitif via `snapshot-placement`) | 311 | (adapters POST) | Pur (`extractArkyoData`, diff, dérive) | non (3 routes `app/api` + `snapshot-placement`) | **SaaS, à supprimer**. |
| `lib/services/cable-numbering.ts` | 580 | renumber (`computeCableLabel`, types) | **Pur**, sans E/S (en-tête l. 1-7) | **oui** : `app/(app)/admin/_components/numbering-tab.tsx:22`, `components/synoptique/components/synoptic-renumber-dialog.tsx:16-19`, `components/synoptique/synoptic-view.tsx:18` (types) | Déjà copié côté front (`web/src/lib/services/cable-numbering.ts` + `.test.ts`). **À porter en Rust** (au minimum `computeCableLabel` l. 541-580, plus `normCode` et `getConnectorInfo` de la route), avec **fixtures JSON partagées** TS↔Rust, puisque le front calcule les mêmes labels en aperçu. Rust n'a aujourd'hui que la config (`http/parametres/numbering.rs`). |
| `lib/app-events.ts` | 163 | toutes les écritures | Infrastructure ; `next/headers` pour le tag tenant | `lib/presence.ts` | Déjà en Rust (`events.rs`). Retirer `tenantSlug` (SaaS). |
| `lib/event-bus.ts` (transitif) | 233 | | Infrastructure (Redis optionnel) | | Rust : diffusion en mémoire. |
| `lib/client-id.ts` | 98 | toutes les écritures | `readClientIdFromRequest` côté serveur ; `getClientId` / `apiFetch` côté client | **oui**, 14 fichiers front (par exemple `general-canvas.tsx`, `location-canvas.tsx`, `synoptique-tab-client.tsx`, `use-project-sync.ts`, `synoptic-view.tsx`) | Rust : `http/client_id.rs` existe. |
| `lib/form-errors.ts` | 145 | toutes sauf guides, renumber et les GET | `zodIssuesFromError` côté serveur ; `mapApiErrorToForm` côté client | **oui**, 8 fichiers front | Rust : `zod_issues` / `invalid` existent. |
| `lib/api-client.ts` (transitif via form-errors) | 298 | | Client | oui | Déjà dans `web/src/lib/api-client.ts`. |
| `lib/tenant-context.ts` | 163 | toutes | **SaaS** (`requireTenantDb`, `assertNotGhost` no-op) | | Remplacé par l'extracteur de session ; ghost supprimé. |
| `lib/db-tenant.ts` (transitif) | 130 | | SaaS | | Pool SQLite unique. |
| `lib/db-main.ts` | 12 | adapters, adapters/[id], canvas-data, renumber, focus, general, location | **SaaS** (catalogue central) | | Remplacé par les tables `Tenant*` (`migrations/0002_catalogue.sql`). |
| `lib/auth.ts` | 271 | toutes | Session NextAuth | | Extracteur `CurrentUser` existant. |

LOC des services métier : 762 + 113 + 133 + 311 + 580 = **1 899**, dont **557 SaaS à supprimer** (snapshot-resolve, snapshot-placement, project-snapshot). LOC d'infrastructure : 163 + 233 + 98 + 145 + 298 + 163 + 130 + 12 + 271 = **1 513**, déjà couverte ou à remplacer côté Rust.

##### Correspondances `mainDb` → tables locales à prévoir

| arkyo (main) | local | Remarque |
|---|---|---|
| `CatalogEquipment` | `TenantEquipment` | Pas de champ `category` (legacy). |
| `CatalogAdapter` | `TenantAdapter` | |
| `CatalogBrand` | `TenantBrand` | |
| `CatalogConnectorType` | `TenantConnectorType` | `.functions[0].functionId` correspond à `functionIds[0]` (JSON). |
| `CatalogSignalType` | `TenantSignalType` | `function` correspond à une jointure `TenantFunction` sur `functionId`. |
| `CatalogFunction` | `TenantFunction` | |
| `CatalogEquipmentCategory` | `TenantEquipmentCategory` | |

##### Tables à créer en phase 4 (consommées par ce lot)

- `ProjectConnection`, `ProjectSynopticAdapter` (avec `snapshotId` nullable, toujours NULL), `ProjectCableBundle`, `ProjectSynopticZone`, `ProjectSynopticLabel`, `ProjectSynopticLayout` (unique `projectId, rackId`), `SynopticGuide`.
- Pour focus et location : `RackConnection`, `SynopticAdapter`, `RackZone`, `RackLabel`, `CableBundle`, `ExternalPort` (enum `INTER_LIEU|MONDE`, `schema.prisma:694-697`), `RackSlotPanelRow`.
- FK à poser :
  - `ProjectConnection.from/toAdapterId` en `ON DELETE CASCADE` ;
  - `bundleId` en `SET NULL` ;
  - `from/toRackId` et `from/toSlotId` en `CASCADE` ;
  - `CartoCablePath.connectionId` en `CASCADE`, quand la table existera.

---

#### 21. Tableau récapitulatif

Colonnes : Perm = permission (« session » : authentification seule, pas de permission métier) ; Évts = événements temps réel émis ; SaaS ? = code SaaS à retirer au portage.

| Chemin (`/api/tenant/projects/{id}/…`) | Méthodes | LOC | Perm | Évts (entité / action) | Audit (action) | SaaS ? | Appelants |
|---|---|---|---|---|---|---|---|
| `synoptic-guides` | GET, POST | 94 | session | `synoptic_guide` / created (id = projectId, sans clientId) | `add_synoptic_guide` | ghost (mort) | **aucun** |
| `synoptic/adapters` | GET, POST | 176 | session | `project_synoptic_adapter` / created | `create_project_synoptic_adapter` | ghost, **mainDb**, **snapshot (getOrCreateSnapshot)** | **aucun** |
| `synoptic/adapters/[adapterInstanceId]` | PATCH, DELETE | 145 | session | idem / updated, deleted | `update_…` / `delete_project_synoptic_adapter` | ghost, **mainDb** (PATCH) | **aucun** |
| `synoptic/bundles` | GET, POST | 97 | session | `project_synoptic_bundle` / created | `create_project_cable_bundle` | ghost | **aucun** |
| `synoptic/bundles/[bundleId]` | PATCH, DELETE | 134 | session | idem / updated, deleted | `update_…` / `delete_project_cable_bundle` | ghost | **aucun** |
| `synoptic/canvas-data` | GET | 500 | session | non | non | **mainDb**, **snapshots** (loadProjectSnapshotMap, resolve*) | **aucun** |
| `synoptic/connections` | GET, POST | 167 | session | `project_synoptic_connection` / created (+ rackId) | `create_project_connection` | ghost | POST : 2 (GET : aucun) |
| `synoptic/connections/[connectionId]` | PATCH, DELETE | 160 | session | idem / updated, deleted | `update_…` / `delete_project_connection` | ghost | PATCH : 5, DELETE : 5 |
| `synoptic/connections/renumber` | POST | 316 | session | idem / renumbered (id = projectId) | `project_connection.renumber` | ghost, **mainDb** | 2 |
| `synoptic/focus/[rackId]` | GET | 113 | session | non | non | **mainDb**, **snapshots** (via service) | **aucun** |
| `synoptic/general` | GET | 615 | session | non | non | **mainDb**, **snapshots** | 3 |
| `synoptic/labels` | GET, POST | 102 | session | `project_synoptic_label` / created | `create_project_synoptic_label` | ghost | **aucun** |
| `synoptic/labels/[labelId]` | PATCH, DELETE | 140 | session | idem / updated, deleted | `update_…` / `delete_project_synoptic_label` | ghost | **aucun** |
| `synoptic/layout` | GET | 28 | session | non | non | non | **aucun** |
| `synoptic/layout/[rackId]` | PATCH (upsert) | 99 | session | `project_synoptic_layout` / updated (+ rackId) | `update_project_synoptic_layout` | ghost | **aucun** |
| `synoptic/location/[locationId]` | GET | 218 | session | non | non | **mainDb**, **snapshots** (via service) | 3 |
| `synoptic/zones` | GET, POST | 104 | session | `project_synoptic_zone` / created | `create_project_synoptic_zone` | ghost | **aucun** |
| `synoptic/zones/[zoneId]` | PATCH, DELETE | 142 | session | idem / updated, deleted | `update_…` / `delete_project_synoptic_zone` | ghost | **aucun** |
| **Total** | **29 handlers** | **3 350** | | 18 écritures publient (les 11 GET non) | les 18 mêmes écritures auditent | | |

**Volume global** : 3 350 LOC de routes, plus 1 899 LOC de services métier (dont 557 SaaS à supprimer), plus 1 513 LOC d'infrastructure déjà couverte côté Rust.

##### Points de parité à trancher

1. Les GET `general` et `location` sont les seules lectures réellement utilisées. Les GET focus et canvas-data sont morts mais partagent le service (focus).
2. `targetCableLabel` est absent (et non `null`) quand aucune connexion ne correspond.
3. `general` renvoie `locations: []` quand le projet n'a aucun rack.
4. POST connections refuse en 404 un câble dont les deux extrémités sont sur le même rack.
5. Les statistiques de `general`, `enrichExternalPortsTargetLabel` et le PATCH adapters ignorent le catalogue perso dans arkyo. Le catalogue unique local donnera des valeurs plus complètes.
6. La validation `synoptic-guides` utilise la forme `flatten()` ; toutes les autres utilisent `issues`.
7. Les messages Zod sont en anglais par défaut.

---

# Annexe D : modèles Prisma et services `lib/`

### Phase 4 : modèles Prisma et services `lib/` à reprendre

Référence : arkyo@88b2e4b (`.ref/arkyo`). Les citations `fichier:ligne` sont relatives à `.ref/arkyo`, sauf celles préfixées `arkyo-server:`. Les nombres de lignes viennent de `wc -l`.
Périmètre des routes analysées (65 fichiers `route.ts`) :
- `app/api/racks/**` ;
- `app/api/tenant/{racks,synoptic-guides,inventaire}/**` ;
- `app/api/tenant/projects/[id]/{racks,synoptic,cabling,equipments,rack-slots,inventaire,synoptic-guides,locations,audit}/**`.

L'inventaire des accès Prisma a été fait par grep de `db.<modèle>.` / `tx.<modèle>.` (et `mainDb.<modèle>.`) dans ces routes et dans les services qu'elles importent.

---

#### 0. À retenir

1. **15 tables à créer en 0004**, aucune de plus :
   - `ProjectEquipment` ;
   - `RackZone`, `RackLabel`, `ExternalPort`, `RackConnection`, `CableBundle`, `RackSlotPanelRow`, `SynopticAdapter` ;
   - `ProjectConnection`, `ProjectSynopticAdapter`, `ProjectCableBundle`, `ProjectSynopticZone`, `ProjectSynopticLabel`, `SynopticGuide`, `ProjectSynopticLayout`.

   Un seul nouvel enum : `ExternalPortKind`.
2. **Aucune table de préparation n'est touchée** par ces routes. Le grep de `cablePrep|adapterPrep|panelPrep|accessoryPrep|equipmentPrepUnit|recetteItem|cartoMap|projectPortAssignment|project2110Source|…` ne donne rien. `prepStatus` / `sourcing` ne sont écrits que par `tenant/projects/[id]/preparation/**` (phase 6).
3. **Deux tables hors périmètre sont lues indirectement** :
   - `CartoCablePath` : `include: { cartoCablePath: { select: { routeLengthMm } } }` sur `ProjectConnection` (`app/api/tenant/projects/[id]/cabling/route.ts:79`, lu en `:342`). C'est une table de la phase 5 : en phase 4, `routeMm` vaut `null`.
   - `ProjectCatalogueSnapshot` (SaaS, décision 5) :
     - lu par `lib/services/project-snapshot-resolve.ts:36-45`, appelé par 4 routes ;
     - écrit par `lib/services/snapshot-placement.ts:41`, appelé par 2 routes.

     Avec un catalogue uniquement personnel, `getOrCreateSnapshot` renvoie `null` (`snapshot-placement.ts:30-35`, commentaire « cas NORMAL d'un item du catalogue personnel ») et la carte des snapshots est vide. On ne crée pas la table : les colonnes `snapshotId` restent `NULL`, comme en phase 3.
4. **Aucune nouvelle colonne n'est nécessaire sur les tables de la phase 3.** Toutes les colonnes que les routes de la phase 4 commencent à écrire existent déjà dans `0003_projets.sql` (§1.4).
5. **Piège de parité, `constructionChecks`.** La route écrit `Prisma.JsonNull` quand la liste devient vide (`app/api/racks/[id]/construction-checks/route.ts:75-80`). En base, on obtient donc le JSON `null`, et non `[]`, dans une colonne pourtant `NOT NULL DEFAULT '[]'`.
   - En SQLite, il faut stocker le texte `'null'`.
   - La réponse de la route renvoie `[]` (`:97-100`).
   - En revanche, un `GET` du rack renverra `constructionChecks: null`, comme arkyo.
   - `DELETE /api/racks/:id/slots`, lui, écrit `[]` (`app/api/racks/[id]/slots/route.ts:102`).
6. **`catalogCableModelId` est ambigu dans arkyo.**
   - Le schéma le dit soft FK vers `main.CableModel` (`schema.prisma:737-740`). Le sélecteur du synoptique propose des `/api/tenant/parametres/cable-models` (`components/synoptique/components/synoptic-cable-model-picker.tsx:48`), soit `TenantCableModel` en local. La route câblage résout via `mainDb.cableModel` (`cabling/route.ts:173`, `assign-model/route.ts:126`), soit `TenantCableModel`.
   - Mais `assertCableNotInUse` compte des **`TenantCable.id`** dans cette colonne (`lib/services/tenant-catalogue.ts:189-213`, commentaire « on stocke aussi les TenantCable.id ici pour le MVP »). `arkyo-server:crates/arkyo-server/src/catalogue/in_use.rs:268-281` reproduit ce comportement.
   - À l'inverse, supprimer un `TenantCableModel` ne vérifie jamais `RackConnection` / `ProjectConnection` (`in_use.rs:229-241`, `cable_model`).
   - Il faut trancher : la colonne contient un `TenantCableModel.id`, et la garde d'usage devrait être déplacée du câble vers le modèle de câble.
7. **Un test de la phase 2 cassera avec 0004.** `arkyo-server:crates/arkyo-server/tests/catalogue_cables.rs:517-532` (`use_in`) crée des tables factices avec `CREATE TABLE IF NOT EXISTS "{table}" ("id", "{col}")`, puis y insère seulement `id` et `col`. Une fois les vraies tables créées par 0004, l'`INSERT` échouera : colonnes `NOT NULL` (`rackId`, `x`, `y`, `createdAt`…) et clés étrangères. Ce test devra insérer une ligne complète.
8. **La route `audit` du projet lit `RackConnection` et `ProjectConnection`** (`app/api/tenant/projects/[id]/audit/route.ts:50-62`), celle du rack lit `RackConnection` (`app/api/racks/[id]/audit/route.ts:21`). Les deux lisent aussi `AuditLog` (table déjà créée en 0002).

---

#### PARTIE 1 : modèles Prisma

##### 1.1 Accès Prisma des routes du périmètre

Comptage des appels `db.|tx.<modèle>.` dans les 65 routes (aucun `$queryRaw` ni `$executeRaw`) :

| Modèle | Appels | Table existante ? |
|---|---|---|
| rackInventoryItem | 53 | 0003 |
| rack | 42 | 0003 |
| rackConnection | 28 | **0004** |
| project | 28 | 0003 |
| rackSlot | 27 | 0003 |
| projectConnection | 18 | **0004** |
| rigRack | 12 | 0003 |
| location | 11 | 0003 |
| tenantEquipment | 9 | 0002 |
| synopticAdapter | 9 | **0004** |
| synopticGuide | 8 | **0004** |
| projectCableBundle | 7 | **0004** |
| rigConfig | 6 | 0003 |
| rackZone, rackLabel | 6 chacun | **0004** |
| projectSynopticZone, projectSynopticLabel, projectSynopticAdapter | 6 chacun | **0004** |
| externalPort, cableBundle | 6 chacun | **0004** |
| tenantBrand, tenantAdapter, rackSlotPanelRow, projectEquipment | 5 chacun | 0002 / **0004** |
| panel | 4 | 0003 |
| appConfig | 4 | 0001 |
| tenantEquipmentCategory | 3 | 0002 |
| projectSynopticLayout | 3 | **0004** |
| auditLog | 2 (+ écritures `auditLog.create` en `.catch`) | 0002 |

Accès `mainDb.*`, à lire dans le catalogue local de 0002 :

| Accès | Appels | Table locale |
|---|---|---|
| `catalogEquipment` | 15 | `TenantEquipment` |
| `catalogBrand` | 7 | `TenantBrand` |
| `catalogAdapter` | 6 | `TenantAdapter` |
| `catalogSignalType` | 6 | `TenantSignalType` |
| `catalogConnectorType` | 5 | `TenantConnectorType` |
| `catalogFunction` | 4 | `TenantFunction` |
| `catalogEquipmentCategory` | 3 | `TenantEquipmentCategory` |
| `cableModel` | 2 | `TenantCableModel` |

Accès supplémentaires des services importés (§2) :
- `rack-clone.ts` écrit `cableBundle`, `externalPort`, `rackConnection`, `rackLabel`, `rackSlotPanelRow`, `rackZone`, `synopticAdapter` et `synopticGuide`. Cela confirme que `SynopticGuide` (portée rack) fait partie de 0004.
- `snapshot-placement.ts` lit aussi `mainDb.cable` (→ `TenantCable`).

##### 1.2 Correspondance des soft FK vers le catalogue de 0002

| Colonne (phase 4) | Cible arkyo (main) | Table locale (0002) |
|---|---|---|
| `SynopticAdapter.catalogAdapterId`, `ProjectSynopticAdapter.catalogAdapterId` | `CatalogAdapter` | `TenantAdapter` |
| `RackConnection.catalogCableModelId`, `ProjectConnection.catalogCableModelId` | `CableModel` (et `TenantCable.id` « MVP », voir §0.6) | `TenantCableModel` (voire `TenantCable`) |
| `ProjectEquipment.catalogEquipmentId` | `CatalogEquipment` | `TenantEquipment` |
| `SynopticAdapter.snapshotId`, `ProjectSynopticAdapter.snapshotId`, `RackConnection.snapshotId` | `ProjectCatalogueSnapshot` (SaaS) | aucune : toujours `NULL` |

Toutes restent du `TEXT` sans contrainte, comme en 0002 et 0003. Le diagnostic d'usage (`in_use.rs`) les compte par égalité de valeur.

##### 1.3 Modèles à créer (0004)

Conventions de 0002/0003 :
- `String` → `TEXT`, `Int` → `INTEGER`, `Float` → `REAL`, `Boolean` → `INTEGER` 0/1, `DateTime` → `TEXT`, `Json` → `TEXT` ;
- un enum devient `TEXT CHECK` ;
- `createdAt` / `updatedAt` sont posés par le handler (pas de `DEFAULT`) ;
- `ON UPDATE CASCADE` sur toutes les FK.

Toutes les relations de ces 15 modèles ont un `onDelete` **explicite** dans le schéma : aucun défaut Prisma n'intervient. Les clés étrangères des migrations SQL d'arkyo (`database/tenant/migrations/*/migration.sql`) le confirment, au détail près des anciennes FK `Equipment` / `Adapter`, supprimées depuis.

###### `ProjectEquipment`, `schema.prisma:156-169`

| Champ | Prisma | SQLite | Null | Défaut / attribut |
|---|---|---|---|---|
| id | String @id | TEXT PK | non | cuid |
| projectId | String | TEXT | non | FK |
| catalogEquipmentId | String? | TEXT | oui | soft FK → `TenantEquipment` |
| ipAddress | String? | TEXT | oui | |
| notes | String? | TEXT | oui | |
| position | String? | TEXT | oui | |
| quantity | Int | INTEGER | non | 1 |

- Relation : `project` → `Project`, `onDelete: Cascade` (:166).
- Contraintes : `@@unique([projectId, catalogEquipmentId])` (:168), `@@index([projectId])` (:169).
- **Pas de `createdAt` ni d'`updatedAt`.**
- Écrit par `tenant/projects/[id]/equipments/route.ts` (schéma `:110-119`) et lu par `equipments/[equipmentId]/route.ts`.

###### `RackZone`, `schema.prisma:612-634`

Colonnes, dans l'ordre :

| Champ | SQLite | Null | Défaut |
|---|---|---|---|
| id | TEXT PK | non | |
| rackId | TEXT | non | FK |
| label | TEXT | non | `'Zone'` |
| labelPosition | TEXT | non | `'top-left'` |
| color | TEXT | non | `'#6366f1'` |
| x, y, w, h | REAL | non | aucun |
| borderRadius | INTEGER | non | 8 |
| borderWidth | INTEGER | non | 2 |
| borderStyle | TEXT | non | `'solid'` |
| opacity | REAL | non | 0.12 |
| labelFontSize | INTEGER | non | 12 |
| labelFontWeight | TEXT | non | `'normal'` |
| labelFontStyle | TEXT | non | `'normal'` |
| labelTextDecoration | TEXT | non | `'none'` |
| labelFontFamily | TEXT | oui | |
| createdAt | TEXT | non | |
| updatedAt | TEXT | non | @updatedAt |

- Relation : `rack` → `Rack`, Cascade (:615).
- Aucun index ni unique.
- `color` est une couleur choisie par l'utilisateur : couleur métier, à ne pas habiller.

###### `RackLabel`, `schema.prisma:636-655`

Colonnes :

| Champ | SQLite | Null | Défaut |
|---|---|---|---|
| id | TEXT PK | non | |
| rackId | TEXT | non | FK |
| text | TEXT | non | `'Libellé'` |
| x, y | REAL | non | |
| fontSize | INTEGER | non | 14 |
| width | REAL | oui | |
| color | TEXT | non | `'#111827'` |
| fontWeight | TEXT | non | `'normal'` |
| fontFamily | TEXT | oui | |
| fontStyle | TEXT | non | `'normal'` |
| textDecoration | TEXT | non | `'none'` |
| pill | INTEGER | non | 0 |
| pillBg | TEXT | oui | |
| pillRadius | INTEGER | non | 12 |
| createdAt, updatedAt | TEXT | non | |

- Relation : `rack` → `Rack`, Cascade (:639).
- Aucun index.

###### `ExternalPort`, `schema.prisma:662-692` (+ enum `ExternalPortKind`, `:694-697`)

| Champ | Prisma | SQLite | Null | Défaut |
|---|---|---|---|---|
| id | String | TEXT PK | non | |
| rackId | String | TEXT | non | FK Rack Cascade (:666) |
| slotId | String | TEXT | non | FK RackSlot Cascade (:669) |
| portIndex | Int | INTEGER | non | |
| labelX, labelY | Float? | REAL | oui | |
| label | String? | TEXT | oui | |
| kind | ExternalPortKind | TEXT CHECK (`'INTER_LIEU'`, `'MONDE'`) | non | `'INTER_LIEU'` |
| createdAt, updatedAt | DateTime | TEXT | non | |

Contraintes : `@@unique([slotId, portIndex])` (:690), `@@index([rackId])` (:691).

###### `RackConnection`, `schema.prisma:699-757`

| Champ | SQLite | Null | Remarque |
|---|---|---|---|
| id | TEXT PK | non | |
| rackId | TEXT | non | FK Rack Cascade (:702) |
| fromSlotId | TEXT | oui | FK RackSlot Cascade (:706) |
| fromConnectorIndex | INTEGER | oui | |
| fromAdapterId | TEXT | oui | FK SynopticAdapter Cascade (:709) |
| fromAdapterSide | TEXT | oui | `"left"`/`"right"`, String : pas de CHECK |
| fromAdapterPortIndex | INTEGER | oui | |
| fromComponentItemId | TEXT | oui | FK RackInventoryItem Cascade (:718) |
| toSlotId | TEXT | oui | FK RackSlot Cascade (:721) |
| toConnectorIndex | INTEGER | oui | |
| toAdapterId | TEXT | oui | FK SynopticAdapter Cascade (:724) |
| toAdapterSide | TEXT | oui | |
| toAdapterPortIndex | INTEGER | oui | |
| toComponentItemId | TEXT | oui | FK RackInventoryItem Cascade (:728) |
| label | TEXT | oui | numéro de câble (écrit par `renumber`) |
| color | TEXT | oui | |
| waypoints | TEXT (JSON) | oui | `{x,y}[]` |
| cableStyle | TEXT | oui | `"ortho"`, `"rounded"` ou `"arrow"` |
| notes | TEXT | oui | |
| tags | TEXT (JSON) | oui | `Array<{color,text}>` |
| catalogCableModelId | TEXT | oui | soft FK (§0.6) (:740) |
| snapshotId | TEXT | oui | soft FK SaaS, toujours NULL (:744) |
| wired | INTEGER | non | défaut 0 (:747) |
| wiredAt | TEXT | oui | (:748) |
| wiredNotes | TEXT | oui | (:749) |
| bundleId | TEXT | oui | FK CableBundle **SetNull** (:752) |
| createdAt | TEXT | non | |

- **Pas d'`updatedAt`.**
- Index : `@@index([snapshotId])` (:756) seulement. Aucun index sur `rackId`, `fromSlotId` ni `toSlotId` : voir les suggestions en §1.5.

###### `CableBundle`, `schema.prisma:759-768`

Colonnes : `id`, `rackId` (FK Rack Cascade, :762), `name` (TEXT non null), `color` (TEXT, défaut `'#6366f1'`), `createdAt`, `updatedAt`. Aucun index.

###### `RackSlotPanelRow`, `schema.prisma:770-781`

Colonnes : `id`, `slotId` (FK RackSlot Cascade, :773), `rowIndex` (INTEGER), `synopticX` (REAL non null), `synopticY` (REAL non null), `createdAt`, `updatedAt`.

- Contrainte : `@@unique([slotId, rowIndex])` (:780).
- Écrit en upsert par `app/api/racks/[id]/panel-rows/route.ts:84-85`.

###### `SynopticAdapter`, `schema.prisma:838-863`

| Champ | SQLite | Null | Remarque |
|---|---|---|---|
| id | TEXT PK | non | |
| rackId | TEXT | non | FK Rack Cascade (:841) |
| catalogAdapterId | TEXT | oui | soft FK → `TenantAdapter` |
| snapshotId | TEXT | oui | SaaS, NULL |
| x, y | REAL | non | |
| attachedSlotId | TEXT | oui | FK RackSlot **SetNull** (:852) |
| attachedSide | TEXT | oui | |
| attachedPortIndex | INTEGER | oui | |
| label, notes | TEXT | oui | |
| createdAt, updatedAt | TEXT | non | |

Index : `@@index([snapshotId])` (:862).

###### `ProjectConnection`, `schema.prisma:938-990`

| Champ | SQLite | Null | Remarque |
|---|---|---|---|
| id | TEXT PK | non | |
| projectId | TEXT | non | FK Project Cascade (:941) |
| fromRackId | TEXT | **non** | FK Rack Cascade (:945) |
| fromSlotId | TEXT | oui | FK RackSlot Cascade (:947) |
| fromConnectorIndex | INTEGER | oui | |
| fromAdapterId | TEXT | oui | FK ProjectSynopticAdapter Cascade (:950) |
| fromAdapterPortIndex | INTEGER | oui | |
| fromAdapterSide | TEXT | oui | |
| toRackId | TEXT | **non** | FK Rack Cascade (:956) |
| toSlotId | TEXT | oui | FK RackSlot Cascade (:958) |
| toConnectorIndex | INTEGER | oui | |
| toAdapterId | TEXT | oui | FK ProjectSynopticAdapter Cascade (:961) |
| toAdapterPortIndex | INTEGER | oui | |
| toAdapterSide | TEXT | oui | |
| label, color | TEXT | oui | |
| waypoints | TEXT (JSON) | oui | |
| cableStyle, notes | TEXT | oui | |
| tags | TEXT (JSON) | oui | |
| catalogCableModelId | TEXT | oui | soft FK (:973) |
| wired | INTEGER | non | défaut 0 (:976) |
| wiredAt, wiredNotes | TEXT | oui | |
| bundleId | TEXT | oui | FK ProjectCableBundle **SetNull** (:981) |
| createdAt | TEXT | non | |

- **Pas d'`updatedAt` ni de `snapshotId`.**
- Index : `projectId` (:987), `fromSlotId` (:988), `toSlotId` (:989).
- Relation inverse `cartoCablePath CartoCablePath?` (:985) : table de la phase 5.

###### `ProjectSynopticAdapter`, `schema.prisma:994-1019`

Colonnes : `id`, `projectId` (FK Project Cascade, :997), `catalogAdapterId` (TEXT nullable, soft FK → `TenantAdapter`), `snapshotId` (TEXT nullable, SaaS), `x` / `y` (REAL non null), `notes` / `color` (TEXT nullable), `createdAt`, `updatedAt`.

Index : `projectId` (:1017), `snapshotId` (:1018).

###### `ProjectCableBundle`, `schema.prisma:1022-1033`

Colonnes : `id`, `projectId` (FK Project Cascade, :1025), `name` (TEXT non null), `color` (défaut `'#6366f1'`), `createdAt`, `updatedAt`.

Index : `projectId` (:1032).

###### `ProjectSynopticZone`, `schema.prisma:1036-1050`

Colonnes : `id`, `projectId` (FK Cascade, :1039), `x` / `y` / `w` / `h` (REAL non null), `color` (TEXT **non null, sans défaut**), `label` (TEXT nullable), `createdAt`, `updatedAt`.

Index : `projectId` (:1049).

###### `ProjectSynopticLabel`, `schema.prisma:1053-1066`

Colonnes : `id`, `projectId` (FK Cascade, :1056), `x` / `y` (REAL), `text` (TEXT non null), `color` (TEXT nullable), `fontSize` (INTEGER nullable), `createdAt`, `updatedAt`.

Index : `projectId` (:1065).

###### `SynopticGuide`, `schema.prisma:1070-1085`

Colonnes :
- `id` ;
- `rackId` (TEXT nullable, FK Rack **Cascade** explicite, :1073) ;
- `projectId` (TEXT nullable, FK Project **Cascade** explicite, :1075) ;
- `axis` (TEXT non null, `"h"` ou `"v"`) ;
- `position` (REAL non null) ;
- `color` (défaut `'#06b6d4'`) ;
- `label` (TEXT nullable) ;
- `createdAt`, `updatedAt`.

Index : `rackId` (:1083), `projectId` (:1084).

Règle « `rackId` XOR `projectId` » : elle n'est validée que par l'API (:1069). Pour la parité, pas de `CHECK`.

###### `ProjectSynopticLayout`, `schema.prisma:1088-1102`

Colonnes : `id`, `projectId` (FK Project Cascade, :1091), `rackId` (FK Rack Cascade, :1093), `x` / `y` (REAL), `isExpanded` (INTEGER, défaut 1), `createdAt`, `updatedAt`.

- Contraintes : `@@unique([projectId, rackId])` (:1100), `@@index([projectId])` (:1101).
- Écrit en upsert par `tenant/projects/[id]/synoptic/layout/[rackId]/route.ts:15,69-74`.

###### Enums

| Enum | Ligne | Valeurs | Statut |
|---|---|---|---|
| `ExternalPortKind` | 694 | `INTER_LIEU`, `MONDE` | **nouveau** |
| `RackType` | 783 | | déjà en CHECK dans 0003 |
| `RackPrepStatus` | 792 | | déjà en CHECK dans 0003 |
| `RackSourcing` | 801 | | déjà en CHECK dans 0003 |
| `RackTemplateStatus` | 811 | | déjà en CHECK dans 0003 |
| `RackView` | 817 | | déjà en CHECK dans 0003 |
| `WidthFraction` | 824 | | déjà en CHECK dans 0003 |

Les autres « énumérations » des nouveaux modèles sont des `String` Prisma : `borderStyle`, `axis`, `*Side`, `cableStyle`, `labelPosition`. Elles n'ont donc pas de `CHECK`, comme `Panel.panelType` en 0003.

###### Modèles référencés mais à **ne pas** créer en 0004

| Modèle | Ligne | Pourquoi |
|---|---|---|
| `ProjectCatalogueSnapshot` | 1785 | SaaS (décision 5). `loadProjectSnapshotMap` peut renvoyer une carte vide et `getOrCreateSnapshot` renvoie `null` pour tout item personnel. |
| `CartoCablePath` | 1172 | Phase 5. Seulement lu via `include` dans `cabling/route.ts:79`. `routeLengthMm` vaut `null` jusque-là. |
| `CablePrep`, `AdapterPrep`, `PanelPrep`, `AccessoryPrep`, `EquipmentPrepUnit` | 232, 190, 206, 248, 174 | Non touchés par ces routes (phase 6). |
| `ProjectPortAssignment`, `Project2110Source`, `CartoPlacement` | | Relations inverses de `RackSlot` / `Rack`, jamais incluses par ces routes. |

##### 1.4 Colonnes des tables de la phase 3 que la phase 4 commence à écrire

Toutes existent déjà dans `0003_projets.sql` : aucun `ALTER TABLE` n'est nécessaire.

| Table.colonne | Route écrivante (citation) |
|---|---|
| `Rack.constructionChecks` | `app/api/racks/[id]/construction-checks/route.ts:75-80` (toggle / set / clear ; JSON `null` si vide, §0.5) ; `app/api/racks/[id]/slots/route.ts:102` (`[]`) |
| `Rack.canvasX`, `canvasY` | `app/api/racks/[id]/canvas-position/route.ts:51` (arrondis `Math.round`) ; `app/api/tenant/projects/[id]/racks/[rackId]/route.ts:36-37,128` |
| `Rack.locationId`, `name`, `rackType`, `isRackable`, `totalU`, `depthMm`, `widthMm`, `heightMm`, `hasWheels`, `emptyWeightKg`, `rearInteriorGapMm` | `app/api/tenant/projects/[id]/racks/[rackId]/route.ts:34-55` (schéma), `:128` (update) |
| `Rack.name`, `cableCode` (rack virtuel du lieu) | `app/api/tenant/projects/[id]/locations/[locationId]/route.ts:91-96` |
| `Rack.cableNextNum` | **Jamais écrit** par une route : seulement copié par `lib/services/rack-clone.ts` et lu par `lib/services/cable-numbering.ts` (doc). |
| `Rack.numberingOverride` | `app/api/racks/[id]/route.ts:76-80` (route déjà portée en phase 3), lu par `racks/[id]/renumber/route.ts:168,201` |
| `RackSlot.synopticX`, `synopticY`, `panelLabels`, `label`, `notes`, `startU`, `view`, `widthFraction`, `column` | `app/api/racks/[id]/slots/[slotId]/route.ts:11-20` (schéma), `:65-75` (update ; `panelLabels: null` → `DbNull`) |
| `RackSlot.patchNotes` | **Uniquement remis à `NULL`** : `app/api/racks/[id]/slots/route.ts:94` (vidage) et `slots/[slotId]/route.ts:204` (dé-placement). Aucune route n'y écrit de valeur. |
| `RackSlot.*` (création / placement) | `app/api/racks/[id]/slots/route.ts:239-248` ; `app/api/tenant/projects/[id]/rack-slots/route.ts:154-176` ; fantômes : `lib/services/rack-inventory-sync.ts` |
| `RackInventoryItem.*`, dont `hostItemId` / `hostSlotIndex` (composants) | `app/api/racks/[id]/inventory/route.ts:45,154,242,260,443-461,535` ; `…/inventory/[itemId]/route.ts:93,170` ; `app/api/tenant/projects/[id]/racks/[rackId]/inventory/route.ts:768,899,916,1156-1174` ; `…/[itemId]/route.ts:139,193,255` ; transfert vers un autre rack : `…/[itemId]/transfer/route.ts:129-136` |
| `Location.name`, `cableCode`, `sortOrder`, `canvasX`, `canvasY`, `canvasW`, `canvasH` | `app/api/tenant/projects/[id]/locations/[locationId]/route.ts:29-36` (schéma), `:69-78`, `:85` (update) ; suppression : `:170-172` |
| `RigRack.position` | `app/api/tenant/projects/[id]/racks/reorder/route.ts:63-65` |
| `RigConfig` (création de la régie de projet ou de modèle) | `tenant/projects/[id]/racks/clone-from-template/route.ts:100` ; `…/[rackId]/save-as-template/route.ts:64` |
| `Project.*` | **Rien n'est écrit par ces routes** (lectures seulement). `Project.ipMapPositions` n'est écrit que par `tenant/projects/[id]/network/ipmap-positions/route.ts:91,125` (phase 5 ; la colonne existe déjà). |

Routes du périmètre **déjà portées en phase 3**, d'après `arkyo-server:crates/arkyo-server/src/http/{racks.rs:31-32, projects/mod.rs:31-42}` :
- `GET|POST /api/racks` ;
- `PATCH|DELETE /api/racks/:id` ;
- `GET|POST /api/tenant/projects/:id/locations` ;
- `POST /api/tenant/projects/:id/racks`. Son clonage `fromTemplateId` est la version en ligne de la route (`route.ts:150-218`) et non `rack-clone.ts` (`arkyo-server:…/http/projects/racks.rs:305-330`).

##### 1.5 Ce qu'attend `catalogue/in_use.rs`

`arkyo-server:crates/arkyo-server/src/catalogue/in_use.rs:204-297` ne compte une table que si elle existe dans `sqlite_master` (`references`, :210-255). Dès 0004, les comptages deviennent réels sans changement de code :

| Fonction | Table et colonne comptées | Clé du `breakdown` |
|---|---|---|
| `equipment` (:257-266) | `RackInventoryItem.catalogEquipmentId`, `RackSlot.catalogEquipmentId` (0003) | `inventory`, `slots` |
| `cable` (:268-281) | `RackConnection.catalogCableModelId` | `rackConnections` |
| | `ProjectConnection.catalogCableModelId` | `projectConnections` |
| `adapter` (:283-297) | `SynopticAdapter.catalogAdapterId` | `synoptic` |
| | `ProjectSynopticAdapter.catalogAdapterId` | `projectSynoptic` |

Les commentaires « EXTENSION POINT (phase 3) » (:12-15, :207-209) sont périmés : à mettre à jour. `ProjectEquipment.catalogEquipmentId` n'est pas compté par arkyo (`lib/services/tenant-catalogue.ts:173-187`) : on garde ce comportement pour la parité.

##### 1.6 Ordre proposé pour `0004_editeur.sql`

Ordre de dépendance des FK. SQLite tolérerait l'ordre inverse, mais celui-ci reste lisible :

```
1.  ProjectEquipment        (Project)
2.  RackZone                (Rack)
3.  RackLabel               (Rack)
4.  CableBundle             (Rack)
5.  RackSlotPanelRow        (RackSlot)
6.  SynopticAdapter         (Rack, RackSlot)
7.  ExternalPort            (Rack, RackSlot)
8.  RackConnection          (Rack, RackSlot, SynopticAdapter, RackInventoryItem, CableBundle)
9.  ProjectSynopticAdapter  (Project)
10. ProjectCableBundle      (Project)
11. ProjectConnection       (Project, Rack, RackSlot, ProjectSynopticAdapter, ProjectCableBundle)
12. ProjectSynopticZone     (Project)
13. ProjectSynopticLabel    (Project)
14. SynopticGuide           (Rack, Project)
15. ProjectSynopticLayout   (Project, Rack)
```

Ébauche des points délicats ; le reste se transcrit mécaniquement des tableaux du §1.3 :

```sql
CREATE TABLE "ExternalPort" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "rackId"    TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "slotId"    TEXT NOT NULL REFERENCES "RackSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "portIndex" INTEGER NOT NULL,
    "labelX"    REAL,
    "labelY"    REAL,
    "label"     TEXT,
    "kind"      TEXT NOT NULL DEFAULT 'INTER_LIEU' CHECK ("kind" IN ('INTER_LIEU', 'MONDE')),
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX "ExternalPort_slotId_portIndex_key" ON "ExternalPort" ("slotId", "portIndex");
CREATE INDEX "ExternalPort_rackId_idx" ON "ExternalPort" ("rackId");

CREATE TABLE "RackConnection" (
    "id"                   TEXT NOT NULL PRIMARY KEY,
    "rackId"               TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fromSlotId"           TEXT REFERENCES "RackSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fromConnectorIndex"   INTEGER,
    "fromAdapterId"        TEXT REFERENCES "SynopticAdapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fromAdapterSide"      TEXT,
    "fromAdapterPortIndex" INTEGER,
    "fromComponentItemId"  TEXT REFERENCES "RackInventoryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "toSlotId"             TEXT REFERENCES "RackSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "toConnectorIndex"     INTEGER,
    "toAdapterId"          TEXT REFERENCES "SynopticAdapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "toAdapterSide"        TEXT,
    "toAdapterPortIndex"   INTEGER,
    "toComponentItemId"    TEXT REFERENCES "RackInventoryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "label"                TEXT,
    "color"                TEXT,
    "waypoints"            TEXT,
    "cableStyle"           TEXT,
    "notes"                TEXT,
    "tags"                 TEXT,
    "catalogCableModelId"  TEXT,
    "snapshotId"           TEXT,
    "wired"                INTEGER NOT NULL DEFAULT 0,
    "wiredAt"              TEXT,
    "wiredNotes"           TEXT,
    "bundleId"             TEXT REFERENCES "CableBundle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "createdAt"            TEXT NOT NULL
);
CREATE INDEX "RackConnection_snapshotId_idx" ON "RackConnection" ("snapshotId");

CREATE TABLE "ProjectConnection" (
    "id"                   TEXT NOT NULL PRIMARY KEY,
    "projectId"            TEXT NOT NULL REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fromRackId"           TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fromSlotId"           TEXT REFERENCES "RackSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fromConnectorIndex"   INTEGER,
    "fromAdapterId"        TEXT REFERENCES "ProjectSynopticAdapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fromAdapterPortIndex" INTEGER,
    "fromAdapterSide"      TEXT,
    "toRackId"             TEXT NOT NULL REFERENCES "Rack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "toSlotId"             TEXT REFERENCES "RackSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "toConnectorIndex"     INTEGER,
    "toAdapterId"          TEXT REFERENCES "ProjectSynopticAdapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "toAdapterPortIndex"   INTEGER,
    "toAdapterSide"        TEXT,
    "label"                TEXT,
    "color"                TEXT,
    "waypoints"            TEXT,
    "cableStyle"           TEXT,
    "notes"                TEXT,
    "tags"                 TEXT,
    "catalogCableModelId"  TEXT,
    "wired"                INTEGER NOT NULL DEFAULT 0,
    "wiredAt"              TEXT,
    "wiredNotes"           TEXT,
    "bundleId"             TEXT REFERENCES "ProjectCableBundle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "createdAt"            TEXT NOT NULL
);
CREATE INDEX "ProjectConnection_projectId_idx"  ON "ProjectConnection" ("projectId");
CREATE INDEX "ProjectConnection_fromSlotId_idx" ON "ProjectConnection" ("fromSlotId");
CREATE INDEX "ProjectConnection_toSlotId_idx"   ON "ProjectConnection" ("toSlotId");

CREATE TABLE "ProjectEquipment" (
    "id"                 TEXT NOT NULL PRIMARY KEY,
    "projectId"          TEXT NOT NULL REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "catalogEquipmentId" TEXT,
    "ipAddress"          TEXT,
    "notes"              TEXT,
    "position"           TEXT,
    "quantity"           INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX "ProjectEquipment_projectId_catalogEquipmentId_key"
    ON "ProjectEquipment" ("projectId", "catalogEquipmentId");
CREATE INDEX "ProjectEquipment_projectId_idx" ON "ProjectEquipment" ("projectId");
```

Index Prisma à reprendre à l'identique :
- `ExternalPort` (2 index, ci-dessus) ;
- `RackConnection_snapshotId_idx`, `SynopticAdapter_snapshotId_idx` ;
- `RackSlotPanelRow_slotId_rowIndex_key` (unique) ;
- les trois index de `ProjectConnection` ;
- `ProjectSynopticAdapter_projectId_idx` / `_snapshotId_idx` ;
- `ProjectCableBundle_projectId_idx`, `ProjectSynopticZone_projectId_idx`, `ProjectSynopticLabel_projectId_idx` ;
- `SynopticGuide_rackId_idx` / `_projectId_idx` ;
- `ProjectSynopticLayout_projectId_rackId_key` (unique) et `_projectId_idx` ;
- les deux index de `ProjectEquipment`.

**Écart optionnel, à décider.** arkyo n'a aucun index sur `RackConnection.rackId`, `fromSlotId` et `toSlotId`, ni sur `SynopticAdapter.rackId`, `RackZone.rackId`, `RackLabel.rackId` et `CableBundle.rackId`. Toutes les lectures du synoptique filtrent pourtant par `rackId`, et les suppressions en cascade depuis `RackSlot` parcourent `fromSlotId` / `toSlotId`. Ajouter ces index est additif et sans effet sur le JSON. À documenter en écart dans l'en-tête de la migration, si on le retient.

Autres points :
- Ordre des colonnes = ordre du schéma Prisma. Les routes doivent sélectionner des listes explicites, comme `RACK_COLS` (`arkyo-server:…/projects/enrich.rs:26-30`), pour qu'une base plus récente n'ajoute pas de clés au JSON.
- Pas de `CHECK` sur les booléens, comme en 0003.

---

#### PARTIE 2 : services `lib/`

Légende :
- **Pur** : aucun accès base ni I/O.
- **DB** : passe par Prisma (tenant et/ou `mainDb`).
- « Routes » : importateurs sous `app/api`.
- « Front » : importateurs hors `app/api`, tests exclus.
- « Porté TS » : le fichier existe sous `web/src/<même chemin>`, avec le résultat de `diff`.
- « Rust » : équivalent dans `crates/`.

##### 2.1 Fichiers demandés et dépendances des routes

Fichiers absents du dépôt arkyo :
- `construction-checks*`, `cable-naming*`, `numbering-*` et `rack-naming` sous un autre nom : rien sous `lib/`.
- La logique des cases de construction vit dans la route `app/api/racks/[id]/construction-checks/route.ts` (102 l.) et côté client dans `app/(app)/rigs/[id]/rack/[rackId]/_hooks/use-construction-checks.ts` (106 l.) et `construction-checks-context.tsx` (36 l.).
- La renumérotation est en ligne dans `app/api/racks/[id]/renumber/route.ts` (472 l.) et `app/api/tenant/projects/[id]/synoptic/connections/renumber/route.ts` (316 l.). Les deux importent seulement `computeCableLabel` et des types de `cable-numbering.ts`. La fusion de configuration (« body.override > rack.numberingOverride > admin defaults », `racks/[id]/renumber/route.ts:189-201`) et `getConnectorInfo` (`…/connections/renumber/route.ts:58`) sont en ligne.
- `connection-*` : seulement `components/synoptique/lib/connection-devirt.ts` (229 l., client).

Imports `@/lib/*` des 65 routes du périmètre (hors `next/server`, `zod`, `auth`, `tenant-context` et `prisma/tenant-client`) :

| Module | Routes importatrices |
|---|---|
| `app-events` | 51 |
| `client-id` | 32 |
| `form-errors` | 23 |
| `rack-events` | 17 |
| `db-main` | 17 |
| `services/rack-inventory-sync` | 6 |
| `services/rack-inventory-api` | 5 |
| `services/catalog-enrich` | 5 |
| `services/rack-naming` | 4 |
| `services/project-snapshot-resolve` | 4 |
| `services/synoptic-focus-payload` | 2 |
| `services/snapshot-placement` | 2 |
| `services/rack-inventory` | 2 |
| `services/rack-clone` | 2 |
| `services/catalog-merge` | 2 |
| `services/cable-numbering` | 2 |
| `services/cable-length` | 1 |

Import de type seulement : `@/app/(fullscreen)/project/[id]/inventaire/inventaire-client` (`clone-from-template/route.ts:17`, `InventaireBomItem`).

Dépendances transitives côté serveur :
- `services/auto-label.ts`, via `rack-inventory-sync` ;
- `services/tenant-catalogue.ts`, via `catalog-merge` ;
- `app/api/_lib/connector-dtype.ts`, via `catalog-enrich` ;
- `services/project-snapshot.ts`, via `snapshot-placement`.

##### 2.2 Fiche par fichier

| Fichier | LOC | Exports | Nature | Routes (phase 4) | Front | Test Vitest | Porté TS | Rust |
|---|---|---|---|---|---|---|---|---|
| `lib/services/rack-inventory.ts` | 385 | `deriveBomFromSlots`, `validateInventoryRef`, `computeBomRemaining` + types (`SlotInput`, `BomItem`, `InventoryRef`, `SlotRefForCount`, `AccessoryType`…) | **Pur** | `racks/[id]/inventory`, `tenant/projects/[id]/racks/[rackId]/inventory` → **`validateInventoryRef`** | `app/(app)/rigs/[id]/rack/[rackId]/_hooks/use-rack-bom.ts` → **`computeBomRemaining`** + types | `tests/unit/rack-inventory.test.ts` (506 l. ; 24 cas `validateInventoryRef`, 9 `computeBomRemaining`, 7 `deriveBomFromSlots`) | non | non |
| `lib/services/rack-inventory-api.ts` | 567 | `formatAccessoryName`, `enrichRowsForTemplate`, `inventorySelectFields`, `resolveComponentEquipmentFields`, `resolveComponentSpansBatch`, `resolveIsComponentHost` + types `BomItemDto`, `BareInventoryRow` | **DB**. L'en-tête dit « Pure TS » (:13), mais le module importe `db-main` et lit `tenantEquipment`, `tenantAdapter`, `tenantBrand`, `tenantEquipmentCategory`, `rackInventoryItem` et `mainDb.catalog*`. | 5 routes : `racks/[id]/inventory{,/[itemId]}`, `tenant/projects/[id]/racks/[rackId]/inventory{,/[itemId]}`, `clone-from-template` (+ `recette` en phase 6) | `app/(app)/racks/[rackId]/page.tsx`. C'est une page RSC, donc côté serveur. | aucun | non | non |
| `lib/services/rack-inventory-sync.ts` | 345 | `syncInventorySlots`, `findClaimableGhostSlot`, `ensureGhostSlotForRef`, `ensureGhostSlotForEquipment`, `ensureGhostSlotForPanel` | **DB** (`rackSlot`, `rackInventoryItem`) | 6 : `racks/[id]/inventory{,/[itemId]}`, `racks/[id]/slots`, `tenant/projects/[id]/rack-slots`, `…/racks/[rackId]/inventory{,/[itemId]}` | aucun | aucun | non | non |
| `lib/services/auto-label.ts` | 28 | `generateUniqueLabel` (`#XXXX`, alphabet de 32 caractères sans O/0/I/1, repli horodaté) | Pur mais **aléatoire** | via `rack-inventory-sync.ts:121` | aucun (le commentaire parle d'un réexport client qui n'existe plus) | aucun | non | non |
| `lib/services/rack-clone.ts` | 352 | `cloneRackInto` (copie profonde avec remappage des id : BOM, slots, étagères, adaptateurs, faisceaux, connexions, `panelRows`, ports externes, zones, libellés, guides ; exclut `cableId`, `constructionChecks` et `templateStatus`, :11-16) | **DB** | `clone-from-template`, `save-as-template` | aucun | aucun | non | **non**. `clone_rack` (`arkyo-server:…/http/projects/racks.rs:310`) est la copie partielle en ligne de `tenant/projects/[id]/racks/route.ts:150-218`, pas ce service. |
| `lib/services/cable-numbering.ts` | 580 | `formatCableNumber`, `parseCableNumber`, `validateCableNumber`, `nextCableNumber`, **`computeCableLabel`** + types `CableNumberingConfig`, `CableDirDigit`, `CableLabelInput`… | **Pur** | `racks/[id]/renumber`, `…/synoptic/connections/renumber` → `computeCableLabel` seulement | `computeCableLabel` : `admin/_components/numbering-tab.tsx`, `synoptic-renumber-dialog.tsx` ; types : `synoptic-view.tsx`. Les 4 autres fonctions ne sont utilisées par **aucun** code, seulement par les tests. | `lib/services/cable-numbering.test.ts` (920 l., dont 10 cas `computeCableLabel`) ; `tests/unit/cable-numbering.test.ts` (259 l., dont 7 cas `computeCableLabel`) | **oui, identique**, avec ses deux tests (`web/src/lib/services/cable-numbering{,.test}.ts`, `web/src/tests/unit/cable-numbering.test.ts`) | non (seulement les clés `cable_numbering_*` dans `http/parametres/numbering.rs`) |
| `lib/services/rack-validation.ts` | 524 | `validateRack` + types `ValidationIssue`, `ValidationReport`… | **Pur** | **aucune** | `editor-shell/topbar-actions-context.tsx`, `synoptique/components/validation-panel.tsx`, `synoptique/hooks/use-validation-report.ts`, `synoptic-view.tsx` | `tests/unit/rack-validation.test.ts` (408 l., 16 cas) | **oui, identique** (amené en phase 3 par `topbar-actions-context`) ; test non copié | non |
| `lib/services/synoptic-focus-payload.ts` | 762 | `loadRackForPayload`, `loadCableAppConfig`, `buildCatalogLookups`, `enrichRackPayload`, `enrichExternalPortsTargetLabel` + types | **DB**. Lit `rack`, `rackSlot`, `rackInventoryItem`, `appConfig`, `tenant*` et `mainDb` (`catalogEquipment`, `catalogAdapter`, `catalogBrand`, `catalogConnectorType`, `catalogFunction`, `catalogSignalType`, `catalogEquipmentCategory`). `enrichRackPayload` est pur. | `tenant/projects/[id]/synoptic/focus/[rackId]`, `…/synoptic/location/[locationId]` | aucun | aucun | non | non |
| `lib/services/audit-format.ts` | 79 | `formatAuditAction`, `groupByDay` + types | **Pur** | aucune | `components/synoptique/components/audit-panel.tsx` | `tests/unit/audit-format.test.ts` (59 l., 9 cas) | non | `arkyo-server:src/audit.rs` écrit l'audit mais ne le formate pas (pas d'équivalent nécessaire) |
| `lib/services/cable-length.ts` | 158 | `CONNECTOR_DEPTHS`, `estimateCableLength`, `formatCableLength` + types | **Pur** | `tenant/projects/[id]/cabling` | `synoptic-view.tsx`, `rigs/[id]/rack/[rackId]/_components/resume-rail.tsx`, `…/_lib/construction-export-data.ts` | **aucun** | non | non |
| `lib/services/cable-route-length.ts` | 195 | `computeRouteLength`, `applyCableMargins`, `computeRouteLengthWithMargins` | Pur | **hors périmètre** : routes carto (`carto/maps/[mapId]/cable-paths`, `carto/cable-paths/[pathId]`), phase 5 | aucun | `tests/unit/cable-route-length.test.ts` (242 l.) | non | non |
| `lib/services/rack-naming.ts` | 71 | `ensureUniqueRackName` | **DB** (`rigRack`) | `tenant/projects/[id]/racks{,/[rackId]}`, `clone-from-template`, `save-as-template` | aucun | aucun | — | **oui** : `arkyo-server:src/projects/naming.rs` (90 l., `ensure_unique_rack_name{,_excluding}`) |
| `lib/services/catalog-enrich.ts` | 314 | `fetchCatalogEquipmentMap`, `fetchCatalogAdapterMap`, `fetchCatalogConnectorTypeMap` | **DB** | 5 dans le périmètre : `racks/[id]/adapters{,/[adapterId]}`, `clone-from-template`, plus `racks/[id]`. Les autres importateurs (`racks`, `rigs/**`, `panels/**`) sont de la phase 3. | 8 pages RSC (côté serveur) | aucun | — | **partiel** : `projects/enrich.rs:338` (équipements) et `:385` (types de connecteurs). **`fetchCatalogAdapterMap` n'est pas porté.** |
| `lib/services/catalog-merge.ts` | 353 | `fetchMergedInventaireEquipments`, `fetchMergedInventaireAdapters` + types | **DB**. Fusionne ARKYO et PERSONAL : en local, une seule source PERSONAL. | `tenant/inventaire/catalog`, `tenant/projects/[id]/inventaire/catalog` | aucun | aucun | non | non (à rapprocher de `catalogue/enrich.rs`, qui porte `enrichWithSource` de `tenant-catalogue.ts`) |
| `lib/services/tenant-catalogue.ts` | 238 | (`enrichWithSource`, `assert*NotInUse`…) | DB | via `catalog-merge` | — | — | — | oui : `catalogue/enrich.rs`, `catalogue/in_use.rs` |
| `lib/services/project-snapshot-resolve.ts` | 113 | `loadProjectSnapshotMap` (DB), `resolveEquipmentData`, `resolveAdapterData`, `extractBrandId` (purs) | DB + pur | 4 : `synoptic/general`, `synoptic/canvas-data`, `racks/[rackId]/canvas-data`, `racks/[rackId]/inventory` ; via `synoptic-focus-payload` | aucun | aucun | non | non. **SaaS** : à porter comme repli direct sur le catalogue (carte de snapshots vide). |
| `lib/services/snapshot-placement.ts` | 133 | `getOrCreateSnapshot` | DB (`projectCatalogueSnapshot`, `mainDb.catalogEquipment`, `cable` et `catalogAdapter`) | `synoptic/adapters` (POST), `racks/[rackId]/inventory` (POST) | aucun | aucun | non | non. **SaaS** : toujours `null` en catalogue personnel, donc `snapshotId = NULL`. Ne pas porter. |
| `lib/services/project-snapshot.ts` | 311 | `computeDrift`, `computeSnapshotDiff`, `healBuggySnapshotData`, `extractArkyoData` | Pur | hors périmètre (`catalogue-drift`, `snapshots/**`) | via `snapshot-placement` | aucun | non | **SaaS**, ne pas porter |
| `lib/services/rack-geometry.ts` | 264 | `maxColumnsFor`, `columnsOccupied`, `uIntervalsOverlap`, `slotsCollide`, `detectCollision` | Pur | **aucune** | **aucun** (code mort, seul son test l'importe) | `lib/services/rack-geometry.test.ts` (1083 l.) | non | non |
| `lib/services/dimensions.ts` | 21 | `formatDimensionLabel` | Pur | aucune | panneaux de dimensions (admin) | `tests/unit/dimensions.test.ts` (32 l.) | oui (phase 2) | — |
| `lib/client-id.ts` | 98 | `getClientId`, `apiFetch` (client), `readClientIdFromRequest` (serveur) | Pur (en-tête HTTP, `sessionStorage`) | 32 routes du périmètre (55 au total) | 14 fichiers : `rack-editor.tsx`, `rack-config-inline.tsx`, `use-construction-checks.ts`, `synoptic-view.tsx`, `synoptique/lib/cabling-api.ts`, `snapshot-sync.ts`, `slot-properties-panel.tsx`, `synoptic-node-properties-panel.tsx`, `use-project-sync.ts`, `rack-placement-canvas.tsx`, `general-canvas.tsx`, `location-canvas.tsx`, `synoptique-tab-client.tsx`, `ipmap-section.tsx` | aucun | **non** : aucun `getClientId` / `x-client-id` dans `web/src`. À copier en phase 4. | **oui, côté serveur** : `arkyo-server:src/http/client_id.rs` (`read`, bornée à 128 caractères) |
| `lib/rack-events.ts` | 24 | `subscribeRack`, `publishRackUpdate` | bus mémoire ou Redis | 17 routes. Types d'évènement : `adapter_*`, `bundle_*`, `connection_*`, `external_port_*`, `label_*`, `zone_*`, `panelrow_updated`, `slot_updated`, `slot_removed`, `rack_cleared`, `construction_checks_updated`. Flux SSE : `app/api/racks/[id]/events/route.ts` (58 l.). | aucun | via `event-bus.test.ts` | — | **non** : `events.rs` ne gère que le canal applicatif. Le SSE par rack était déjà reporté à la phase 4 (`phase-3-suivi.md:11`). |
| `lib/event-bus.ts` | 233 | `shouldPublishApp`, `shouldPublishRack`, `subscribe{App,Rack}Event`, `publish{App,Rack}Event` | transport mémoire ou `ioredis` (SaaS multi-instance) | via `app-events` et `rack-events` | — | `tests/unit/event-bus.test.ts` (91 l., 6 cas en mémoire) | — | partiel : `arkyo-server:src/events.rs` (`tokio::broadcast`, sans Redis). Il manque le canal par rack. |
| `lib/app-events.ts` | 163 | `subscribeApp`, `publishAppUpdate`, type `AppUpdateMeta` | serveur | 51 routes du périmètre | (`lib/presence.ts`, `catalog-sync.ts`) | via `event-bus.test.ts` | — | **oui** : `arkyo-server:src/events.rs` (`EventMeta`) |
| `lib/app-events-client.ts` | 66 | `subscribeAppEvents` | client | — | 18 fichiers, dont `use-rack-bom.ts`, `rack-editor.tsx`, `bom-panel.tsx`, `synoptique-tab-client.tsx` | aucun | **oui, identique** | — |
| `lib/form-errors.ts` | 145 | `mapApiErrorToForm` (client), `zodIssuesFromError` (serveur) | pur | 23 routes du périmètre (`{ error, issues }`) | formulaires | `tests/unit/form-errors.test.ts` (273 l.) | **oui, identique** (+ test) | forme des `issues` reproduite au cas par cas (ex. `arkyo-server:…/http/projects/racks.rs:61-63`) |
| `app/api/_lib/connector-dtype.ts` | 101 | `loadConnectorDTypeSymbols`, `deriveHasNeutrikD`, `deriveDTypeSvgUrl`, `withDerivedHasNeutrikD` | DB et pur | via `catalog-enrich` | — | — | — | **oui** : `http::parametres::connectors::has_neutrik_d` |

Fichiers clients liés au synoptique, hors `lib/services`, pour mémoire (à copier avec l'éditeur, sans équivalent serveur) :
- `components/synoptique/lib/connection-devirt.ts` (229 l.) ;
- `lib/pdf/synoptic-cards.ts` (650 l.), `synoptic-export.ts` (236 l.), `synoptic-vector.ts` (252 l.) ;
- `lib/export/synoptic-capture.ts` (206 l.).

##### 2.3 Conclusion : où va chaque service

###### À porter en Rust (utilisés par les routes de la phase 4)

Selon le §4.2 de la spec, dans `arkyo-core` pour la logique pure, sinon dans `arkyo-server`.

| Service | Ce qu'il faut porter | Tests |
|---|---|---|
| `rack-inventory.ts` | **`validateInventoryRef` seulement** (pur, côté serveur) | Porter les 24 cas Vitest en tests Rust. |
| `rack-inventory-api.ts` | Totalité (lecture du catalogue local à la place de `mainDb`) | |
| `rack-inventory-sync.ts` + `auto-label.ts` | Créations et suppressions de slots fantômes. `generateUniqueLabel` : même alphabet, même format `#XXXX`, même repli. Aléatoire : à tester par propriétés, pas par valeur. | |
| `rack-clone.ts` | Copie profonde avec remappage des id ; dépend de toutes les tables de 0004. | |
| `cable-numbering.ts` | **`computeCableLabel` seulement**, plus la fusion de configuration et l'ordre de renumérotation en ligne dans les deux routes `renumber` | |
| `cable-length.ts` | `estimateCableLength` et `CONNECTOR_DEPTHS` | |
| `synoptic-focus-payload.ts` | Totalité (`buildCatalogLookups` sur les tables `Tenant*`) | |
| `catalog-enrich.ts` | Compléter avec `fetchCatalogAdapterMap` (équipements et connecteurs déjà portés) | |
| `catalog-merge.ts` | Version mono-source : seulement des items PERSONAL | |
| `project-snapshot-resolve.ts` | Réduit à « catalogue direct » : `resolve*Data` sans carte de snapshots | |
| `rack-events.ts` / `event-bus.ts` | Canal SSE par rack (`GET /api/racks/:id/events`, `: connected`, `data: <json>`) dans `events.rs` | |
| Logique en ligne des routes | `construction-checks` (toggle / set / clear, JSON `null` si vide), deux `renumber`, validation des connexions composant (`racks/[id]/connections/route.ts:51-68`) | |

Déjà portés : `rack-naming.ts` (`projects/naming.rs`), `app-events.ts` (`events.rs`), `client-id.ts` côté serveur (`http/client_id.rs`), `connector-dtype.ts` (`has_neutrik_d`).

**Ne pas porter (SaaS)** : `snapshot-placement.ts` et `project-snapshot.ts`. Les colonnes `snapshotId` restent `NULL`.

###### Restent côté client uniquement (copie TS dans `web/src/<même chemin>`, pas de Rust)

| Fichier | État |
|---|---|
| `rack-validation.ts` | déjà copié ; copier aussi `tests/unit/rack-validation.test.ts` |
| `audit-format.ts` | à copier, avec `tests/unit/audit-format.test.ts` |
| `rack-inventory.ts` | à copier en entier, pour `computeBomRemaining` et les types de `use-rack-bom.ts` ; copier aussi `tests/unit/rack-inventory.test.ts` |
| `client-id.ts` | à copier pour `getClientId` / `apiFetch` |
| `app-events-client.ts` | déjà copié |
| `connection-devirt.ts`, `lib/pdf/synoptic-*`, `lib/export/synoptic-capture.ts` | à copier |
| `rack-geometry.ts` | code mort (aucun importateur) : ne pas porter |
| `cable-route-length.ts` | phase 5 |

###### Fixtures JSON partagées (Vitest + `cargo test`)

Elles s'imposent pour les fonctions utilisées des deux côtés, et seulement pour celles-là :

| Fonction | Usage serveur | Usage client | Source des cas | Point d'attention |
|---|---|---|---|---|
| `computeCableLabel` (`cable-numbering.ts:541`) | routes `renumber` | aperçus de `numbering-tab.tsx` et `synoptic-renumber-dialog.tsx` | les 10 + 7 cas existants | `formatCableNumber`, `parseCableNumber`, `validateCableNumber` et `nextCableNumber` ne sont utilisés par aucun code de production : pas de port Rust, leurs tests restent en TS. |
| `estimateCableLength` + `CONNECTOR_DEPTHS` (`cable-length.ts:20,88`) | route `cabling` | `synoptic-view.tsx`, `resume-rail.tsx`, `construction-export-data.ts` | **aucun test n'existe** : fixtures à créer | Résultat flottant, à comparer avec une tolérance ou après arrondi identique. `formatCableLength` est client seulement. |
| `validateInventoryRef` / `computeBomRemaining` | `validateInventoryRef` | `computeBomRemaining` | `rack-inventory.test.ts` | Pas de fonction commune aux deux côtés, donc pas de fixture obligatoire. Mettre les 24 cas de `validateInventoryRef` en JSON permettrait toutefois de les faire tourner des deux côtés à moindre coût. |

---

# Annexe E : fermetures d'imports du front de la phase 4, fichier par fichier

Incréments successifs (un fichier partagé n'apparaît qu'au premier groupe qui l'utilise). « porté » = déjà sous `web/src` ; « serveur » = Server Component ou module serveur, remplacé par un chargeur client et une route d'API.

#### Coquille (sans onglets) : 31 fichiers, 6582 l., dont 4547 à porter

| Fichier | l. | État |
|---|---:|---|
| `app/(fullscreen)/project/[id]/_components/project-editor.tsx` | 2283 | à porter |
| `app/(fullscreen)/project/[id]/_editor/project-characteristics-dialog.tsx` | 237 | à porter |
| `app/(fullscreen)/project/[id]/_editor/project-contextual-topbar.tsx` | 102 | à porter |
| `app/(fullscreen)/project/[id]/_editor/project-global-topbar.tsx` | 245 | à porter |
| `app/(fullscreen)/project/[id]/_editor/project-header-block.tsx` | 229 | à porter |
| `app/(fullscreen)/project/[id]/_editor/project-info-panel.tsx` | 40 | à porter |
| `app/(fullscreen)/project/[id]/_editor/project-tabs-pill.tsx` | 182 | à porter |
| `app/(fullscreen)/project/[id]/_editor/tab-bar.tsx` | 38 | à porter |
| `app/(fullscreen)/project/[id]/_editor/ui.tsx` | 102 | à porter |
| `app/(fullscreen)/project/[id]/fiche/fiche-client.tsx` | 504 | à porter |
| `components/editor-shell/editor-shell.tsx` | 82 | à porter |
| `components/editor-shell/hooks/use-workspace.ts` | 18 | à porter |
| `components/editor-shell/tool-registry.ts` | 66 | à porter |
| `components/editor-shell/tool-topbar-ui.tsx` | 46 | à porter |
| `components/editor-shell/workspace-context.tsx` | 30 | à porter |
| `components/editor-shell/workspace-store.ts` | 68 | à porter |
| `components/synoptique/lib/colors.ts` | 43 | à porter |
| `components/synoptique/lib/constants.ts` | 96 | à porter |
| `components/synoptique/lib/types.ts` | 136 | à porter |
| `components/ui/button.tsx` | 52 | porté |
| `components/ui/confirm-dialog.tsx` | 170 | porté |
| `components/ui/dialog.tsx` | 96 | porté |
| `components/ui/empty-state.tsx` | 90 | porté |
| `components/ui/form-dialog.tsx` | 376 | porté |
| `components/ui/form-field.tsx` | 258 | porté |
| `components/ui/icons.tsx` | 313 | porté |
| `lib/api-client.ts` | 298 | porté |
| `lib/form-errors.ts` | 145 | porté |
| `lib/hooks/use-local-storage-state.ts` | 77 | porté |
| `lib/types/catalog.ts` | 133 | porté |
| `lib/utils.ts` | 27 | porté |

#### Inventaire (incrément) : 51 fichiers, 20575 l., dont 17402 à porter

| Fichier | l. | État |
|---|---:|---|
| `app/(fullscreen)/project/[id]/_components/export-menu.tsx` | 927 | à porter |
| `app/(fullscreen)/project/[id]/_hooks/use-project-sync.ts` | 163 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/add-container-wizard.tsx` | 2645 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/catalog-panel.tsx` | 1490 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/component-config-modal.tsx` | 463 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/container-properties-panel.tsx` | 675 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/container-sheet-card.tsx` | 223 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/inventaire-contextual-topbar.tsx` | 469 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/inventaire-export.tsx` | 625 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/inventaire-help-modal.tsx` | 150 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/inventaire-info-panel.tsx` | 112 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/inventaire-left-toolbar.tsx` | 205 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/inventaire-scope.tsx` | 1769 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/inventaire-shortcuts-modal.tsx` | 115 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/inventaire-side-panel.tsx` | 86 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/item-properties-panel.tsx` | 277 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/location-properties-panel.tsx` | 193 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/location-selector-dropdown.tsx` | 304 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/location-sheet.tsx` | 323 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/rack-card-canvas.tsx` | 926 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/rack-mini-svg.tsx` | 155 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/slot-ruler.tsx` | 260 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/template-selector.tsx` | 209 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/update-snapshot-modal.tsx` | 493 | SaaS, non porté |
| `app/(fullscreen)/project/[id]/inventaire/_components/use-catalogue-drift.ts` | 116 | SaaS, non porté |
| `app/(fullscreen)/project/[id]/inventaire/_lib/bom-pdf.ts` | 560 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_lib/bom-table.ts` | 513 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/inventaire-client.tsx` | 435 | à porter |
| `app/(fullscreen)/project/[id]/reseau/_components/shared/export-capture.ts` | 490 | à porter |
| `app/(fullscreen)/project/[id]/reseau/_components/shared/export-pdf.ts` | 331 | à porter |
| `components/editor-shell/topbar-actions-context.tsx` | 727 | porté |
| `components/synoptique/components/accessory-face.tsx` | 305 | à porter |
| `components/synoptique/components/property-patterns.tsx` | 129 | porté |
| `components/synoptique/components/synoptic-general-panel.tsx` | 544 | porté |
| `components/synoptique/components/synoptic-help-modal.tsx` | 175 | porté |
| `components/synoptique/components/synoptic-shortcuts-modal.tsx` | 128 | porté |
| `components/ui/input.tsx` | 23 | porté |
| `components/ui/loading-state.tsx` | 44 | porté |
| `components/ui/toast.tsx` | 202 | porté |
| `components/wizard/range-input.tsx` | 270 | porté |
| `components/wizard/wizard-backdrop.tsx` | 193 | porté |
| `lib/app-events-client.ts` | 66 | porté |
| `lib/client-id.ts` | 98 | à porter |
| `lib/export/download-blob.ts` | 46 | à porter |
| `lib/export/synoptic-capture.ts` | 206 | à porter |
| `lib/export/table-xlsx.ts` | 148 | porté |
| `lib/export/technical-table-pdf.ts` | 471 | à porter |
| `lib/pdf/load-jspdf.ts` | 55 | à porter |
| `lib/print/technical-frame.ts` | 484 | à porter |
| `lib/services/export/csv.ts` | 35 | à porter |
| `lib/services/rack-validation.ts` | 524 | porté |

#### Rack / élévations (incrément) : 50 fichiers, 18925 l., dont 16696 à porter

| Fichier | l. | État |
|---|---:|---|
| `app/(app)/rigs/[id]/rack/[rackId]/_components/draggable-bom-item.tsx` | 251 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/draggable-items.tsx` | 337 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/draggable-slot.tsx` | 645 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/panel-rack-visual.tsx` | 239 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/port-label-editor.tsx` | 572 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/projected-slot.tsx` | 72 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/rack-editor-confirm-dialog.tsx` | 8 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/rack-visual.tsx` | 418 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/side-rack-visual.tsx` | 828 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/toast-stack.tsx` | 43 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_hooks/use-rack-bom.ts` | 370 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_shell/slot-context-menu.tsx` | 54 | à porter |
| `app/(fullscreen)/project/[id]/_components/export-cartouche-options.tsx` | 486 | à porter |
| `app/(fullscreen)/project/[id]/_components/export-pdf-model-options.tsx` | 404 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/category-legend.tsx` | 46 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/location-placement-canvas.tsx` | 687 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/rack-drag-eligibility.tsx` | 39 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/rack-export-capture.ts` | 153 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/rack-export-composer.tsx` | 1439 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/rack-export-layout.ts` | 615 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/rack-export-object-panel.tsx` | 367 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/rack-export-stage.tsx` | 531 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/rack-export-views-panel.tsx` | 156 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/rack-export.tsx` | 667 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/rack-info-panel.tsx` | 162 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/rack-location-info-panel.tsx` | 132 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/rack-location-selector-dropdown.tsx` | 117 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/rack-placement-canvas.tsx` | 2503 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/rack-tab-left-toolbar.tsx` | 400 | à porter |
| `app/(fullscreen)/project/[id]/rack/_components/rack-tab-side-panel.tsx` | 535 | à porter |
| `app/(fullscreen)/project/[id]/rack/rack-tab-client.tsx` | 710 | à porter |
| `components/editor-shell/canvas-context-menu.tsx` | 55 | à porter |
| `components/presence/presence-provider.tsx` | 260 | porté |
| `components/synoptique/components/rack-editor-confirm-dialog.tsx` | 64 | à porter |
| `components/synoptique/components/remote-cursors-overlay.tsx` | 164 | porté |
| `components/synoptique/components/slot-properties-panel.tsx` | 453 | à porter |
| `components/synoptique/hooks/use-confirm.ts` | 48 | à porter |
| `components/synoptique/hooks/use-live-cursors.ts` | 392 | porté |
| `components/synoptique/hooks/use-rack-sync.ts` | 159 | à porter |
| `components/synoptique/hooks/use-toasts.ts` | 33 | à porter |
| `components/synoptique/lib/collision.ts` | 165 | à porter |
| `components/synoptique/lib/panel-labels.ts` | 50 | à porter |
| `components/ui/connector-icon.tsx` | 652 | porté |
| `components/ui/floating-legend.tsx` | 80 | porté |
| `lib/hooks/use-catalog-lookup.ts` | 192 | à porter |
| `lib/pdf/synoptic-export.ts` | 236 | à porter |
| `lib/print/export-with-cartouche.ts` | 594 | à porter |
| `lib/print/render-print-layout.ts` | 276 | à porter |
| `lib/services/print-layout.ts` | 681 | porté |
| `lib/services/rack-inventory.ts` | 385 | à porter |

#### Synoptique (incrément) : 70 fichiers, 33433 l., dont 31246 à porter

| Fichier | l. | État |
|---|---:|---|
| `app/(fullscreen)/project/[id]/_components/export-live-page.tsx` | 552 | à porter |
| `app/(fullscreen)/project/[id]/_components/pending-export-store.ts` | 65 | à porter |
| `app/(fullscreen)/project/[id]/_components/project-view-export.tsx` | 829 | à porter |
| `app/(fullscreen)/project/[id]/synoptique/_components/general-canvas.tsx` | 901 | à porter |
| `app/(fullscreen)/project/[id]/synoptique/_components/general-info-panel.tsx` | 419 | à porter |
| `app/(fullscreen)/project/[id]/synoptique/_components/general-properties-panels.tsx` | 281 | à porter |
| `app/(fullscreen)/project/[id]/synoptique/_components/location-canvas.tsx` | 986 | à porter |
| `app/(fullscreen)/project/[id]/synoptique/_components/synoptique-rack-selector.tsx` | 158 | à porter |
| `app/(fullscreen)/project/[id]/synoptique/synoptique-tab-client.tsx` | 1465 | à porter |
| `components/editor-shell/contextual-topbar.tsx` | 44 | à porter |
| `components/editor-shell/cursor-hint.tsx` | 168 | à porter |
| `components/editor-shell/floating-context-menu.tsx` | 103 | à porter |
| `components/editor-shell/hooks/use-cursor-hint.ts` | 20 | à porter |
| `components/editor-shell/hooks/use-keyboard-shortcuts.ts` | 26 | à porter |
| `components/editor-shell/hooks/use-layers.ts` | 54 | à porter |
| `components/editor-shell/left-toolbar.tsx` | 250 | à porter |
| `components/editor-shell/right-panel.tsx` | 157 | à porter |
| `components/editor-shell/slide-over-panel.tsx` | 34 | à porter |
| `components/editor-shell/synoptic-actions-bar.tsx` | 135 | à porter |
| `components/editor-shell/tools-synoptic.tsx` | 602 | à porter |
| `components/synoptique/components/audit-panel.tsx` | 167 | à porter |
| `components/synoptique/components/port-adapter-picker.tsx` | 224 | à porter |
| `components/synoptique/components/synoptic-adapter-node.tsx` | 540 | à porter |
| `components/synoptique/components/synoptic-adapter-picker.tsx` | 186 | à porter |
| `components/synoptique/components/synoptic-adapter-properties-panel.tsx` | 165 | à porter |
| `components/synoptique/components/synoptic-bundles-section.tsx` | 130 | à porter |
| `components/synoptique/components/synoptic-cable-model-dialog.tsx` | 479 | à porter |
| `components/synoptique/components/synoptic-cable-model-picker.tsx` | 292 | à porter |
| `components/synoptique/components/synoptic-cable-properties-panel.tsx` | 190 | à porter |
| `components/synoptique/components/synoptic-clear-labels-dialog.tsx` | 63 | à porter |
| `components/synoptique/components/synoptic-decable-dialog.tsx` | 69 | à porter |
| `components/synoptique/components/synoptic-drawing-hint.tsx` | 83 | à porter |
| `components/synoptique/components/synoptic-empty-info-dialog.tsx` | 57 | à porter |
| `components/synoptique/components/synoptic-external-properties-panel.tsx` | 151 | à porter |
| `components/synoptique/components/synoptic-incompat-tooltip.tsx` | 106 | à porter |
| `components/synoptique/components/synoptic-label-input.tsx` | 79 | à porter |
| `components/synoptique/components/synoptic-label-properties-panel.tsx` | 291 | à porter |
| `components/synoptique/components/synoptic-label-toolbar.tsx` | 106 | à porter |
| `components/synoptique/components/synoptic-layers-panel.tsx` | 726 | à porter |
| `components/synoptique/components/synoptic-mini-map.tsx` | 207 | à porter |
| `components/synoptique/components/synoptic-multi-cable-properties-panel.tsx` | 177 | à porter |
| `components/synoptique/components/synoptic-multi-external-properties-panel.tsx` | 84 | à porter |
| `components/synoptique/components/synoptic-multi-node-properties-panel.tsx` | 86 | à porter |
| `components/synoptique/components/synoptic-node-properties-panel.tsx` | 230 | à porter |
| `components/synoptique/components/synoptic-node.tsx` | 1149 | porté |
| `components/synoptique/components/synoptic-renumber-dialog.tsx` | 777 | à porter |
| `components/synoptique/components/synoptic-rulers.tsx` | 241 | à porter |
| `components/synoptique/components/synoptic-toasts.tsx` | 45 | à porter |
| `components/synoptique/components/synoptic-zone-color-picker.tsx` | 80 | à porter |
| `components/synoptique/components/synoptic-zone-properties-panel.tsx` | 292 | à porter |
| `components/synoptique/components/validation-panel.tsx` | 303 | à porter |
| `components/synoptique/hooks/use-cable-lane-offsets.ts` | 87 | à porter |
| `components/synoptique/hooks/use-synoptic-history.ts` | 95 | à porter |
| `components/synoptique/hooks/use-validation-report.ts` | 208 | à porter |
| `components/synoptique/lib/cable-paths.ts` | 266 | à porter |
| `components/synoptique/lib/cabling-api.ts` | 198 | à porter |
| `components/synoptique/lib/connection-devirt.ts` | 229 | à porter |
| `components/synoptique/lib/external-ports.ts` | 71 | à porter |
| `components/synoptique/lib/fit-all.ts` | 127 | à porter |
| `components/synoptique/lib/grid.ts` | 22 | à porter |
| `components/synoptique/lib/scene-descriptor.ts` | 472 | à porter |
| `components/synoptique/lib/snapshot-sync.ts` | 216 | à porter |
| `components/synoptique/synoptic-view.tsx` | 14023 | à porter |
| `components/synoptique/types/synoptic.ts` | 458 | porté |
| `lib/export/svg-inline-styles.ts` | 218 | à porter |
| `lib/pdf/synoptic-cards.ts` | 650 | à porter |
| `lib/pdf/synoptic-vector.ts` | 252 | à porter |
| `lib/services/audit-format.ts` | 79 | à porter |
| `lib/services/cable-length.ts` | 158 | à porter |
| `lib/services/cable-numbering.ts` | 580 | porté |

#### Éditeur de rack et sous-routes projet (incrément) : 46 fichiers, 15855 l., dont 15545 à porter

| Fichier | l. | État |
|---|---:|---|
| `app/(app)/racks/[rackId]/page.tsx` | 517 | serveur, devient chargeur/API |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/construction-export-panel.tsx` | 159 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/construction-print-panel.tsx` | 477 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/construction-progress-panel.tsx` | 182 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/depth-prompt-dialog.tsx` | 139 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/design-export-panel.tsx` | 209 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/editor-theme-toggle.tsx` | 50 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/rack-config-inline.tsx` | 411 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/rack-editor-clear-confirm-dialog.tsx` | 62 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/rack-editor-orphan-slots-dialog.tsx` | 84 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/resume-rail.tsx` | 2019 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/template-inventory-properties.tsx` | 173 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/template-inventory-shell.tsx` | 160 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/template-rack-canvas.tsx` | 205 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_components/trash-zone.tsx` | 37 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_hooks/construction-checks-context.tsx` | 36 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_hooks/use-construction-checks.ts` | 106 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_lib/construction-export-data.ts` | 574 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_lib/construction-export-docx.ts` | 358 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_lib/construction-export-pdf.ts` | 384 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_lib/construction-export-xlsx.ts` | 219 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_lib/design-export.ts` | 248 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_shell/construction-actions-bar.tsx` | 51 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_shell/design-actions-bar.tsx` | 22 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_shell/global-topbar.tsx` | 354 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_shell/tools-construction.tsx` | 39 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/_shell/tools-design.tsx` | 426 | à porter |
| `app/(app)/rigs/[id]/rack/[rackId]/page.tsx` | 436 | serveur, devient chargeur/API |
| `app/(app)/rigs/[id]/rack/[rackId]/rack-editor.tsx` | 4392 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/_components/equipment-card.tsx` | 179 | à porter |
| `app/(fullscreen)/project/[id]/inventaire/rack/[rackId]/page.tsx` | 436 | serveur, devient chargeur/API |
| `app/(fullscreen)/project/[id]/inventaire/synoptique/page.tsx` | 437 | serveur, devient chargeur/API |
| `components/editor-shell/layer-panel.tsx` | 26 | à porter |
| `components/editor-shell/layer-row.tsx` | 86 | à porter |
| `components/presence/presence-avatars.tsx` | 64 | porté |
| `components/synoptique/components/cable-spread-toggle.tsx` | 37 | à porter |
| `components/synoptique/components/cable-tag-add-button.tsx` | 85 | à porter |
| `components/synoptique/components/remote-selection-halos.tsx` | 124 | à porter |
| `components/synoptique/components/synoptic-pdf-export-dialog.tsx` | 149 | à porter |
| `lib/auth.ts` | 271 | serveur, devient chargeur/API |
| `lib/db-main.ts` | 12 | serveur, devient chargeur/API |
| `lib/db-tenant.ts` | 130 | serveur, devient chargeur/API |
| `lib/services/catalog-enrich.ts` | 314 | serveur, devient chargeur/API |
| `lib/services/rack-inventory-api.ts` | 567 | serveur, devient chargeur/API |
| `lib/tenant-context.ts` | 163 | serveur, devient chargeur/API |
| `lib/tenant-permissions.ts` | 246 | porté |
