# Phase 3 : inventaire de ce qu'il faut reprendre d'arkyo

Référence : arkyo@88b2e4b (`.ref/arkyo`). Toutes les citations `fichier:ligne` sont relatives à `.ref/arkyo` sauf mention contraire.
Les nombres de lignes viennent de `wc -l`. « Porté » = le fichier existe déjà sous `web/src/<même chemin>` (phases 1-2).
Les fermetures transitives d'imports ont été calculées par script (imports statiques et `import()`, alias `@/`, limités à `app/`, `components/`, `lib/` et `hooks/`).

---

## 0. Surprises (à lire d'abord)

1. **Tâches et messages n'existent pas dans arkyo.** Il n'y a aucune route ni aucun écran. Les modèles `Task` et `Message` (`database/tenant/schema.prisma:273`, `:310`) ne sont lus qu'en comptage :
   - `app/(app)/dashboard/page.tsx:79,82` ;
   - `app/api/tenant/projects/[id]/route.ts:33` ;
   - `app/api/projects/route.ts:25` ;
   - `app/(fullscreen)/project/[id]/page.tsx:48`.

   La fiche affiche seulement un `MessagesPlaceholder` (`app/(fullscreen)/project/[id]/fiche/fiche-client.tsx:458,496`), et son en-tête dit « Tâches est masqué (pas implémenté) » (`:14-15`). Rien n'écrit jamais dans `Task` ni dans `Message`.
2. **La bibliothèque de documents a été retirée d'arkyo.** Les routes `app/api/tenant/projects/[id]/documents/route.ts` (164 l.) et `…/documents/[docId]/route.ts` (51 l.) existent encore, mais **aucun écran ne les appelle** :
   - aucun `fetch` ni `api.*` vers `/documents` hors de `app/api` ;
   - `app/(fullscreen)/project/[id]/_components/export-menu.tsx:18,394,897` le dit : « la bibliothèque de documents a été retirée ».

   Les documents ne sont plus que comptés : `documentsCount` dans la liste des projets (`app/(app)/projects/page.tsx:34,56`).
3. **La « fiche projet » fait partie de l'éditeur de la phase 4.**
   - `/projects/[id]` redirige vers `/project/[id]?tab=fiche` (`app/(app)/projects/[id]/page.tsx:16`) ;
   - `?tab=fiche` est ensuite remplacé par `inventaire` (`app/(fullscreen)/project/[id]/_components/project-editor.tsx:196-203`) ;
   - la fiche se trouve dans le panneau droit et dans `_editor/project-characteristics-dialog.tsx` (237 l.), qui appelle `PATCH /api/tenant/projects/:id` (`:106`) ;
   - `FicheClient` n'est jamais rendu : seul son type est importé (`project-editor.tsx:42`).

   En phase 3, côté projets, il n'y a donc que **la liste des projets et l'assistant de création**.
4. **L'audit n'a pas d'écran en phase 3.** Les deux lecteurs sont lus par `components/synoptique/components/audit-panel.tsx:45-46`, qui n'est monté que par le synoptique et l'éditeur de rack (phase 4) :
   - `GET /api/tenant/projects/:id/audit` (84 l.) ;
   - `GET /api/racks/:id/audit` (41 l.).

   Les deux lisent aussi `RackConnection` et `ProjectConnection`, des tables de la phase 4 (`app/api/tenant/projects/[id]/audit/route.ts:50-62`, `app/api/racks/[id]/audit/route.ts:21`).
5. **L'éditeur de rack est énorme et constitue le cœur de la phase 4.** Sa fermeture d'imports compte 181 fichiers et 66 935 lignes, dont 60 679 à porter :
   - `components/synoptique/synoptic-view.tsx` (14 024 l.) ;
   - 23 fichiers d'inventaire projet `app/(fullscreen)/project/[id]/inventaire/**` (12 345 l.) ;
   - le reste de `components/synoptique/**` (25 828 l.).

   Les pages d'arkyo qui l'ouvrent passent par le même composant : `app/(app)/racks/[rackId]/page.tsx` (contenant modèle) et `app/(app)/rigs/[id]/rack/[rackId]/page.tsx`. La première importe même un type de `inventaire-client` (`:19`).
6. **L'éditeur de panel est petit et autonome** : 7 176 lignes au total, dont 5 632 à porter. Voir §6.
7. **L'onglet « Dossiers » de `/templates` dépend de la phase 6.** `dossier-models-client.tsx` tire `dossier-wizard/compose-step`, `dossier-registry`, `lib/print/*` et `lib/pdf/*`, soit 5 441 lignes à porter.
8. **`RigsClient` (515 l.) est du code mort.**
   - Rien ne l'importe : `/rigs` redirige vers `/templates?tab=rigs` (`app/(app)/rigs/page.tsx:7`), un onglet que `templates-client.tsx:28-29` ne connaît pas et remplace par `racks`.
   - `/rigs/:id` (détail de régie) n'est atteint que par l'URL directe ou par le bouton « Fermer » de l'éditeur de rack (`rack-editor.tsx:991`).
9. **Les routes projets, racks, rigs et panels n'ont aucun contrôle de permission dans arkyo**, seulement la session. Seules les pages ont une garde (`requireTenantPermissionPage`) et les boutons sont filtrés par `IfTenantPerm` (détail en §2.4). La seule route du périmètre avec garde est `dossier-models` (`design:write`). → **Décision à prendre** (§2.4).
10. **Bug de parité dans arkyo : un projet supprimé laisse ses contenants dans les modèles.**
    - `RigConfig.projectId` est en `onDelete: SetNull` (`schema.prisma:456`) et `Rack.locationId` aussi (`:505`). Après suppression d'un projet, ses racks, y compris les racks virtuels des lieux (`isVirtual`), ne sont plus rattachés à un projet.
    - Ils réapparaissent dans `/templates?tab=racks`, dont le filtre est `rigs: { none: { rigConfig: { projectId: { not: null } } } }` (`app/(app)/templates/page.tsx:30`). Ce filtre n'exclut pas `isVirtual`.
    - À reproduire tel quel, ou à corriger avec un commentaire `// arkyo-server:` : décision de Damien.
11. **Le bus d'évènements Rust ne transporte pas les métadonnées.** `crates/arkyo-server/src/events.rs:32` publie `{type, entity, action, id}` seulement, alors qu'arkyo ajoute `projectId`, `rackId`, `itemId`, `clientId` et `data` (`lib/app-events.ts:47-60,120-134`).
    - Les routes de la phase 3 publient `projectId`, et `rackId` + `clientId` pour `PATCH`/`DELETE` `/api/racks/:id` (`app/api/racks/[id]/route.ts:155,186`).
    - Il faut ajouter une variante `publish_meta`. `clientId` vient de l'en-tête lu par `lib/client-id.ts` (98 l.).
12. **Erreurs de validation au format `flatten()` de Zod** (`{ error: { formErrors, fieldErrors } }`, 400) et non `"Validation invalide"` pour :
    - `POST /api/racks` (`route.ts:144`) et `PATCH /api/racks/:id` ;
    - `/api/rigs/**` ;
    - `/api/panels/:id/slots/**` ;
    - `POST /api/projects`.

    Les routes `tenant/projects/**` répondent `{ error: "Validation invalide", issues }`.
13. `zustand` (^5.0.12 dans `arkyo:package.json:79`) est une nouvelle dépendance npm : `components/editor-shell/topbar-actions-context.tsx:2-3`, requis par l'éditeur de panel.

---

## 1. Pages

Garde de page dans arkyo → équivalent dans arkyo-server : `ClientPage` avec `permission` (modèle : `web/src/app/(app)/admin/espace/page.tsx`). Les Server Components deviennent un chargement client via l'API.

### 1.1 Tableau de récapitulation

| Route | page.tsx | Garde | Requêtes Prisma / données | Phase |
|---|---|---|---|---|
| `/dashboard` | `app/(app)/dashboard/page.tsx` (475 l., Server Component **entièrement serveur**, sans fichier client) | session seule (`auth()` :71) | `project.findMany({orderBy shootingDate, include technicalSheet.completionPercent, _count.tasks})` :75-80 ; `task.groupBy(status)` :82 ; `project.findMany({orderBy updatedAt desc, take 5})` :83-86 ; prénom depuis la session :122 | **3** |
| `/projects` | `app/(app)/projects/page.tsx` (65 l., SC) | `projects:read` :10 | `project.findMany({orderBy updatedAt desc, select …, _count {documents, rigConfigs}})` :15-36 | **3** |
| `/projects/:id` | `app/(app)/projects/[id]/page.tsx` (17 l.) | `projects:read` :14 | redirect `/project/:id?tab=fiche` :16 | **3** (redirect seul) |
| `/templates` (`?tab=racks\|panels\|dossiers`) | `app/(app)/templates/page.tsx` (95 l., SC) | `design:read` :18 | `rack.findMany({where rigs none rigConfig.projectId != null, include slots, rigs.rigConfig{id,name}, orderBy updatedAt desc})` :27-37 ; `panel.findMany({where private:false, include slots, orderBy createdAt desc})` :38-50 ; enrichissement `fetchCatalogEquipmentMap` / `fetchCatalogConnectorTypeMap` :67-87 | **3** (racks, panels) ; dossiers → **6** |
| `/racks` | `app/(app)/racks/page.tsx` (8 l.) | `design:read` :6 | redirect `/templates?tab=racks` | **3** |
| `/racks/:rackId` | `app/(app)/racks/[rackId]/page.tsx` (517 l., SC) | `design:write` :29 | rack + slots + panels + connexions, zones, panel-rows, adaptateurs, ports externes, AppConfig, connecteurs, signaux, catégories, inventaire (:43-330) → `<RackEditor>` | **4** (éditeur de rack) |
| `/rigs` | `app/(app)/rigs/page.tsx` (8 l.) | `design:read` :6 | redirect `/templates?tab=rigs` (→ onglet racks) | **3** |
| `/rigs/:id` | `app/(app)/rigs/[id]/page.tsx` (79 l., SC) | `design:read` :10 | `rigConfig.findUnique({include rigRacks(position asc).rack.slots(startU asc), project{id,name}})` :14-31 ; `mainDb.catalogEquipment.findMany({isActive})` :59-62 ; `rack.findMany({where rigs none rigConfigId=id, select id,name,totalU,depthMm})` :65-69 | **3** (orphelin, voir §0.8) |
| `/rigs/:id/rack/:rackId` | `app/(app)/rigs/[id]/rack/[rackId]/page.tsx` (436 l., SC) | `design:write` :22 | idem éditeur de rack | **4** |
| `/panels` | `app/(app)/panels/page.tsx` (8 l.) | `design:read` :6 | redirect `/templates?tab=panels` | **3** |
| `/panels/:id` (plein écran) | `app/(fullscreen)/panels/[id]/page.tsx` (107 l., SC) | `design:write` :11 | nom du tenant `mainDb.tenant` :16-22 ; `panel.findUnique({include slots(position asc)})` :25-32 ; `catalogConnectorType.findMany({include functions.function{key,label,color,sortOrder}})` :35-42 ; `catalogFunction.findMany(sortOrder,label)` :44-47 ; `withDerivedHasNeutrikD` :79 ; calcul de `category`/`categories` :80-89 | **3** |

Le routeur actuel (`web/src/router.tsx:79-84,110`) a `soon()` pour `dashboard`, `projects/*`, `racks/*`, `rigs/*`, `panels`, `templates`, ainsi que `project/:id/*` et `panels/:id` en plein écran.

Après la phase 3, ces routes restent `ComingSoon` :
- `/racks/:rackId` et `/rigs/:id/rack/:rackId` (phase 4) ;
- `/project/:id/*` (phase 4) ;
- `/templates?tab=dossiers` (phase 6).

### 1.2 Composants client par page (fermeture transitive ; P = déjà porté)

**`/projects`**, entrée `app/(app)/projects/projects-client.tsx`, 24 fichiers, 3 465 l. à porter :

| Fichier | l. | État |
|---|---|---|
| `app/(app)/projects/projects-client.tsx` | 846 | à porter |
| `components/projects/new-project-dialog.tsx` | 1 750 | à porter |
| `components/racks/rack-wizard-steps.tsx` | 869 | à porter (partagé avec `new-rack-wizard`) |

Déjà portés :
- `app/(app)/admin/_components/admin-list-toolbar.tsx` (236), `admin-tab-layout.tsx` (135), `list-toolbar-helpers.tsx` (312) ;
- `components/tenant-permissions-context.tsx` ;
- dans `components/ui/` : `button`, `confirm-dialog`, `date-range-picker`, `dialog`, `empty-state`, `form-field`, `icons`, `input`, `sheet`, `tenant-perm-button`, `toast` ;
- `components/wizard/range-input.tsx`, `wizard-backdrop.tsx` ;
- `lib/api-client.ts`, `lib/form-errors.ts`, `lib/hooks/use-local-storage-state.ts`, `lib/utils.ts`.

Dépendances npm : `date-fns`, `react-hook-form`, `zod` (déjà dans `web/package.json`).

**`/dashboard`**, `app/(app)/dashboard/page.tsx` (475). Déjà portés : `components/ui/badge`, `empty-state`, `icons`, `progress`, `lib/utils`. Le reste est serveur : `lib/auth`, `lib/tenant-context`, `lib/db-*`.

**`/templates`**, entrée `templates-client.tsx`. Sans l'onglet dossiers : 5 274 l. à porter.

| Fichier | l. | État |
|---|---|---|
| `app/(app)/templates/templates-client.tsx` | 41 | à porter |
| `app/(app)/racks/racks-client.tsx` | 1 985 | à porter |
| `components/racks/new-rack-wizard.tsx` | 793 | à porter |
| `components/racks/rack-wizard-steps.tsx` | 869 | (déjà compté avec `/projects`) |
| `app/(app)/panels/panels-client.tsx` | 541 | à porter |
| `components/panels/new-panel-wizard.tsx` | 1 107 | à porter |
| `app/(app)/templates/_components/dossier-models-client.tsx` | 484 | **phase 6** (+ 4 957 l. de fermeture : `dossier-wizard/{column-picker,compose-step,segmented,use-dossier-models}`, `dossier-registry.ts`, `reseau/_components/shared/export-{capture,pdf,types}.ts`, `lib/export/{download-blob,synoptic-capture,technical-table-pdf}.ts`, `lib/pdf/{load-jspdf,synoptic-export}.ts`, `lib/print/{export-with-cartouche,render-print-layout,technical-frame}.ts`) |

Déjà portés : admin toolbars, `components/ui/*` (y compris `loading-state`), `wizard/*`, `lib/catalog-broadcast.ts`, `lib/services/print-layout.ts`.

**`/rigs/:id`**, `app/(app)/rigs/[id]/rig-detail-client.tsx` (520, à porter). Déjà portés : `components/ui/{badge,button,card,confirm-dialog,dialog,empty-state,icons}`, `lib/api-client`, `lib/utils`. Dépendances : `@dnd-kit/core` et `@dnd-kit/utilities` (déjà dans `web/package.json`).

**`/panels/:id`**, `app/(fullscreen)/panels/[id]/panel-editor.tsx`, 15 fichiers, 5 632 l. à porter :

| Fichier | l. | État |
|---|---|---|
| `app/(fullscreen)/panels/[id]/panel-editor.tsx` | 2 970 | à porter |
| `components/editor-shell/topbar-actions-context.tsx` | 727 | à porter (zustand) |
| `components/synoptique/components/synoptic-general-panel.tsx` | 544 | à porter (`NameInput`) |
| `components/synoptique/components/synoptic-help-modal.tsx` | 175 | à porter |
| `components/synoptique/components/synoptic-shortcuts-modal.tsx` | 128 | à porter |
| `components/synoptique/components/remote-cursors-overlay.tsx` | 164 | à porter |
| `components/synoptique/hooks/use-live-cursors.ts` | 392 | à porter (WebSocket `/realtime` + `POST /api/realtime/ticket` ; « tout est silencieux si le service WS est absent », `panel-editor.tsx:1508`) |
| `lib/services/rack-validation.ts` | 524 | type seulement (`import("…").ValidationReport` dans `topbar-actions-context.tsx:303-309`), mais requis par `tsc` |

Déjà portés : `components/presence/presence-provider.tsx`, `components/synoptique/components/property-patterns.tsx`, `components/ui/{connector-icon,empty-state,icons}`, `lib/app-events-client.ts`, `lib/utils.ts`. La page plein écran passe par le `FullscreenLayout` déjà porté (`web/src/app/(fullscreen)/fullscreen-layout.tsx`).

**Hors phase 3 :** `app/(app)/rigs/rigs-client.tsx` (515), qui n'est importé nulle part.

### 1.3 Liens vers l'éditeur de la phase 4 (`/project/[id]`) ou vers l'éditeur de rack

Liens vers l'éditeur projet :

| Lien | Cible | Où |
|---|---|---|
| clic sur une carte de projet | `/project/${p.id}?tab=fiche` | `app/(app)/projects/projects-client.tsx:329` |
| fin de l'assistant « Nouveau projet » | `/project/${project.id}?tab=inventaire` | `components/projects/new-project-dialog.tsx:518` |
| cartes du tableau de bord (×3) | `/projects/${project.id}`, qui redirige vers `/project/:id?tab=fiche` | `app/(app)/dashboard/page.tsx:222,320,367` (redirection : `app/(app)/projects/[id]/page.tsx:16`) |
| projet d'une régie | `/projects/${rig.project.id}` | `app/(app)/rigs/[id]/rig-detail-client.tsx:447` |

Liens vers l'éditeur de rack (phase 4) :

| Lien | Cible | Où |
|---|---|---|
| ouverture d'un contenant (×2) | `/racks/${rack.id}` | `app/(app)/racks/racks-client.tsx:1650,1773` |
| après création d'un contenant | `/racks/${newRack.id}` | `app/(app)/racks/racks-client.tsx:1915` |
| rack d'une régie | `/rigs/${rigId}/rack/${rack.id}` | `app/(app)/rigs/[id]/rig-detail-client.tsx:256` |

Liens qui restent en phase 3 :
- `/panels/${id}` : `panels-client.tsx:166,402,475` ;
- `/templates?tab=rigs` : `dashboard/page.tsx:434`, `rig-detail-client.tsx:419` ;
- `/dashboard` : `panel-editor.tsx:1833`.

Le menu latéral est déjà porté (`web/src/components/layout/sidebar.tsx:46,54,65,76,84`) : `/projects?tab=prestation|integration` et `/templates?tab=racks|panels|dossiers`.

---

## 2. Routes d'API

Notation : **S** = session seule. Toutes les routes d'écriture appellent `assertNotGhost()`, qui renvoie « Mode lecture seule » en 403 ; cet appel disparaît (SaaS).

### 2.1 Routes nécessaires aux pages de la phase 3

| Méthode + chemin | Fichier (l.) | Perm. | Corps Zod | Réponse | Évènement | Audit |
|---|---|---|---|---|---|---|
| GET `/api/tenant/projects` | `app/api/tenant/projects/route.ts` (144) :10 | S | – | `{ projects: [{id,name,status,interventionType,rigType,clientName,shootingDate,shootingEndDate,planningStart,planningEnd,commissioningDate,location,prestationType,updatedAt,createdAt}] }` :17-38 | – | – |
| POST `/api/tenant/projects` | idem :57 | S | `createSchema` :43-55 : name min1, interventionType PRESTATION\|INTEGRATION, rigType? FLIGHT_CASE\|CAR\|FIXED_INSTALL\|MIXED, clientName?, shootingDate?, shootingEndDate?, planningStart?, planningEnd?, commissioningDate?, location?, description? | Project, 201 :143. Erreurs : 400 `{error:"Validation invalide", issues}` :74-77 ; nom vide 400 :87-95 ; doublon (insensible à la casse) **409** `issues:[{path:["name"],message:"Un projet porte déjà ce nom dans cet espace."}]` :96-112. Crée `technicalSheet: {}` :126, status EN_PREPARATION :125 | `project created id {projectId}` :142 | `create` / `Project` / projectId :130-140 |
| GET `/api/tenant/projects/:id` | `app/api/tenant/projects/[id]/route.ts` (164) :13 | S | – | Project + `documents`(uploadedAt desc) + `rigConfigs.rigRacks(position).rack` + `_count{tasks,messages,documents}` ; 404 `"Not found"` | – | – |
| PATCH `/api/tenant/projects/:id` | idem :58 | S | `patchSchema` :43-56 : name?, clientName?/dates?/location?/prestationType?/description? (nullable), status? (5 valeurs), rigType? nullable | Project mis à jour | `project updated` :123 | `update`/`Project`, before/after :109-121 |
| DELETE `/api/tenant/projects/:id` | idem :129 | S (UI : `projects:admin`, `projects-client.tsx:752`) | – | `{ok:true}` | `project deleted` :162 | `delete`/`Project`, before, **sans projectId** :150-160 |
| POST `/api/tenant/projects/:id/locations` | `…/[id]/locations/route.ts` (185) :78 | S | `postSchema` :23-26 : name min1, cableCode? max5 | 201 `{...location, virtualRackId, containerCount:0}` :181-184. Crée le RigConfig du projet s'il manque (« ${name} — Régie principale ») :113-122, puis en transaction le Location + un **Rack virtuel** (`isVirtual:true`) relié par RigRack :139-160 ; `cableCode` dérivé du nom par `deriveCableCode` :13-16 | `location created {projectId}` :179 | `create_location`/`Location`, after{name,cableCode} :166-176 |
| GET `/api/tenant/projects/:id/locations` | idem :34 | S | – | `[{...location, virtualRackId, containerCount}]` | – | – |
| POST `/api/tenant/projects/:id/racks` | `…/[id]/racks/route.ts` (281) :38 | S | `bodySchema {racks: rackItemSchema[] min1}` :12-35 ; item : name, locationId (requis), rackType (défaut STANDARD), isRackable?, totalU 1-56?, depthMm?, widthMm?, heightMm?, hasWheels?, emptyWeightKg?, rearInteriorGapMm?, fromTemplateId? | 201 `{rigConfigId, racks:[{id,name,rackType}]}` :280. Erreurs : 400 `"Emplacement introuvable"` :74, 404 `` `Template introuvable : ${id}` `` :145. Branche `fromTemplateId` (RigConfig `isTemplate`) : clone le rack et ses `RackSlot`, crée les `RackInventoryItem` et les relie :118-218. `ensureUniqueRackName` | `rig updated rigConfigId {projectId}` :278 | `add_rack`/`Project`, after{racks} :265-276 |
| GET `/api/projects` | `app/api/projects/route.ts` (76) :16 | S | – | `Project[]` + `technicalSheet{completionPercent}` + `_count{tasks}`, triés par updatedAt desc. **Seule route qui donne les données du tableau de bord** | – | – |
| POST `/api/projects` | idem :32 | S | name, clientName?, shootingDate?, location?, description?, prestationType? | 201 projet + technicalSheet ; 400 `{error: flatten}` | `project created` :74 | `project.create`/`Project` :62-72 |
| GET `/api/racks` (`?unassigned=true&rigConfigId=`) | `app/api/racks/route.ts` (193) :108 | S | – | `Rack[]` + slots(+`equipmentId`, `equipment`, `panel{…, slots[{position,mountD,connectorTypeId,connectorType}]}`) + `rigs.rigConfig{id,name}` (`enrichRacks` :66-106) | – | – |
| POST `/api/racks` | idem :130 | S (UI `design:write`) | `createSchema` :11-27 : name, totalU 1-56 (défaut 42), depthMm (défaut 600), rearInteriorGapMm?, maxWeightKg?, maxPowerW?, emptyWeightKg?, notes?, rackType?, hasWheels?, isRackable?, widthMm?, heightMm? | 201, rack enrichi. **`cableId`** = 1er libre parmi [1..9,0] :146-149 | `rack created` :191 | `rack.create`/`Rack` :180-189 |
| PATCH `/api/racks/:id` | `app/api/racks/[id]/route.ts` (188) :46 | S | `updateSchema` :28-44 (+ `numberingOverrideSchema` :13-26) : name?, totalU?, depthMm?, maxWeightKg?/maxPowerW?/emptyWeightKg? nullable, notes?, rearInteriorGapMm?, rackType?, hasWheels?, cableCode? max5 (normalisé en A-Z0-9 :67-76), numberingOverride? nullable, templateStatus? BROUILLON\|INACTIF\|ACTIF | rack enrichi | `rack updated id {rackId, clientId}` :155 | `rack.update`/`Rack` :145-153 |
| DELETE `/api/racks/:id` | idem :159 | S (UI `design:admin`) | – | `{ok:true}` | `rack deleted {rackId, clientId}` :186 | `rack.delete`/`Rack` :176-184 |
| GET `/api/rigs` (`?projectId=&templates=true`) | `app/api/rigs/route.ts` (143) :20 | S | – | `RigConfig[]` + rigRacks.rack.slots enrichis | – | – |
| POST `/api/rigs` | idem :118 | S | name, type FLIGHT_CASE\|CAR\|MIXED (défaut FLIGHT_CASE), prestationType?, isTemplate (défaut false), notes?, projectId? :11-18 | 201 | `rig created` :141 | – |
| GET `/api/rigs/:id` | `app/api/rigs/[id]/route.ts` (127) :17 | S | – | rig + rigRacks(position).rack.slots(startU) enrichis `equipment` + `project{id,name}` ; 404 `"Not found"` | – | – |
| PATCH `/api/rigs/:id` | idem :68 | S | name?, type?, prestationType?, isTemplate?, notes?, projectId? nullable :8-15. 400 `"Un objet lié à un projet ne peut pas devenir un template. Utilisez « Sauver comme template » pour cloner."` :90-103 | rig | `rig updated` :107 | – |
| DELETE `/api/rigs/:id` | idem :111 | S | – | `{ok:true}` | `rig deleted` :125 | – |
| POST `/api/rigs/:id/racks` | `app/api/rigs/[id]/racks/route.ts` (180) :63 | S | soit `{rackId}` (lier) :52, soit `createSchema` (name, totalU, depthMm, maxWeightKg?, maxPowerW?, notes?) :54-61 | 201 RigRack (+rack enrichi). 404 `"Rig not found"` :80, `"Rack not found"` :96 ; 409 `"Rack already linked to this rig"` :103 | `rack linked rackId` :136 / `rack created` :178 | – |
| DELETE `/api/rigs/:id/racks/:rackId` | `…/racks/[rackId]/route.ts` (35) :8 | S | – | `{ok:true}` ; 404 `"Link not found"` | `rack unlinked` :33 | – |
| GET `/api/panels` (`?scope=inventaire`) | `app/api/panels/route.ts` (98) :8 | **aucune** (pas d'`auth()`) | – | `Panel[]` (private=false sauf si scope=inventaire), slots + `connectorTypeId`, `connectorType` | – | – |
| POST `/api/panels` | idem :39 | S | pas de Zod : `body.name` requis (400 `"Nom requis"` :52), panelType, accessoryType, plateType, heightU, slotsPerU, depthMm, rearCableDepthMm, notes, private | 201 panel enrichi. `createdById` via `mainDb.user`, 401 `"Session expirée, reconnectez-vous"` :55-61 | `panel create` :96 | – |
| GET `/api/panels/:id` | `app/api/panels/[id]/route.ts` (102) :26 | **aucune** | – | panel + slots(position asc) enrichis ; 404 `"Not found"` | – | – |
| PATCH `/api/panels/:id` | idem :40 | S | pas de Zod : name, heightU, slotsPerU, rearCableDepthMm, notes. **Si heightU ou slotsPerU change → `panelSlot.deleteMany`** :55-65 | panel enrichi | `panel update` :82 | – |
| DELETE `/api/panels/:id` | idem :86 | S (UI `design:admin`) | – | `{ok:true}` | `panel delete` :100 | – |
| POST `/api/panels/:id/slots` | `app/api/panels/[id]/slots/route.ts` (124) :56 | S | `createSlotSchema` :10-20 : position int ≥1, sizeSlots?, label?, notes?, connectorTypeId?, mountD?, familyLabel? | 201 slot enrichi. `checkMountDAllowed` :30-55 : 400 `"Panneau trop dense pour un module Neutrik D (max 16 par U)."` / `"Ce connecteur n'existe pas en version Neutrik D."` | `panel_slot create panelId` :104 | – |
| DELETE `/api/panels/:id/slots` | idem :108 | S | – | `{ok:true}` (vide le panel) | `panel update` :122 | – |
| PATCH `/api/panels/:id/slots/:slotId` | `…/slots/[slotId]/route.ts` (156) :55 | S | `updateSlotSchema` :10-20 (label, notes, connectorTypeId, position, sizeSlots, mountD, familyLabel). 404 `"Slot introuvable"` :79 | slot enrichi | `panel_slot update slotId` :133 | – |
| DELETE `/api/panels/:id/slots/:slotId` | idem :137 | S | – | `{ok:true}` | `panel_slot delete slotId` :154 | – |

Déjà en place depuis la phase 2 :
- `GET /api/admin/config` (`crates/arkyo-server/src/http/admin.rs:19`), appelé par `racks-client.tsx:1409` et `panels-client.tsx:144` ;
- `GET /api/tenant/catalogue/connectors` avec `functions`, `hasNeutrikD` et `dTypeSvgUrl` (`http/catalogue/connectors.rs`) ;
- l'enrichissement du catalogue (`src/catalogue/enrich.rs`) ;
- `/api/site` (nom du site).

**Données de page sans route arkyo équivalente (Server Components)** : il faut une source côté API. Choix proposés, chacun commenté `// arkyo-server:` :
- **liste des projets** : ajouter à `GET /api/tenant/projects` des clés en plus (`description`, `documentsCount`, `rigConfigsCount`), ou un paramètre ;
- **tableau de bord** : `GET /api/projects` (route arkyo existante). `taskStats` vaut `[]` sans table `Task` ;
- **modèles de contenants** : il n'existe aucune route avec le filtre « pas dans un projet » sans filtre `ACTIF`. `GET /api/tenant/racks?templates=true` filtre `ACTIF` (`app/api/tenant/racks/route.ts`). Ajouter par exemple `GET /api/racks?templates=true` ;
- **panels** : `GET /api/panels`, qui correspond exactement ;
- **détail de régie** : `GET /api/rigs/:id` + `GET /api/racks?unassigned=true&rigConfigId=:id` + catalogue d'équipements ;
- **éditeur de panel** : `GET /api/panels/:id` + `GET /api/tenant/catalogue/connectors` + liste des fonctions (route de la phase 2) + `/api/site`.

### 2.2 Routes en sommeil ou à arbitrer

| Route | Fichier (l.) | Recommandation |
|---|---|---|
| GET/POST `/api/tenant/projects/:id/documents` | `…/documents/route.ts` (164) | **Ne pas porter** : aucun appelant (§0.2). Si on la porte : multipart `file` (×N), types de `ALLOWED_TYPES` :12-25, 20 Mo max :27 ; écrit `public/uploads/documents/<uuid><ext>` :108-115 ; un document de même nom est remplacé et l'ancien fichier supprimé :117-145 ; audit `add_document`/`Project` :149-160 ; évènement `project_document created` :162 |
| DELETE `/api/tenant/projects/:id/documents/:docId` | `…/[docId]/route.ts` (51) | idem (audit `remove_document`, évènement `project_document deleted`) |
| GET `/api/tenant/projects/:id/audit?limit=` | `…/[id]/audit/route.ts` (84) | **phase 4**, avec `audit-panel` et les tables `RackConnection` / `ProjectConnection` (union Project / Rack / RackConnection / ProjectConnection, limit 150 par défaut et ≤ 500 ; 404 `"Project not found"`) |
| GET `/api/racks/:id/audit?limit=` | `app/api/racks/[id]/audit/route.ts` (41) | **phase 4** (limit 100 par défaut ; lit `RackConnection`) |
| GET/POST `/api/tenant/dossier-models`, PATCH/DELETE `…/:id` | (86 + 88) | **phase 6** (`design:write` :52, :31, :76 ; 409 `"Un modèle porte déjà ce nom."` ; évènement `dossier-models update`) |

### 2.3 Routes utilisées seulement par l'éditeur (phase 4 et suivantes)

Seuls appelants : l'éditeur de rack, l'inventaire, le synoptique et les autres onglets de `/project/:id`.

- `app/api/racks/[id]/**` hors audit : 3 415 l. Contient `adapters`, `adapters/[adapterId]`, `bundles`, `bundles/[bundleId]`, `canvas-position`, `connections`, `connections/[connId]`, `construction-checks`, `events` (SSE par rack, 58 l.), `external-ports`, `external-ports/[externalId]`, `inventory` (556, utilise `project-snapshot`), `inventory/[itemId]`, `labels`, `labels/[labelId]`, `panel-rows`, `renumber` (472), `slots` (308), `slots/[slotId]` (253), `zones`, `zones/[zoneId]`.
- `app/api/tenant/racks/route.ts` (91, `?templates=true`, utilisé par `add-container-wizard` et l'éditeur de rack).
- `app/api/tenant/racks/[rackId]/synoptic-guides` (102), `app/api/tenant/synoptic-guides/[guideId]` (151), `app/api/tenant/inventaire/catalog` (51).
- Sous `app/api/tenant/projects/[id]/` :

  | Groupe | l. |
  |---|---|
  | `racks/**` hors `racks/route.ts` | 3 240 − 281 = 2 959 |
  | `locations/[locationId]` | 191 |
  | `synoptic/**` | 3 256 |
  | `carto/**` | 3 234 |
  | `network/**` | 2 685 |
  | `preparation/**` | 1 676 |
  | `recette/**` | 1 056 |
  | `lighting-fixtures/**` | 731 |
  | `cabling/**` | 711 |
  | `snapshots/**` | 481 (SaaS, à ne pas porter) |
  | `drawings/**` | 464 |
  | `equipments/**` | 308 |
  | `rack-slots` | 210 |
  | `catalogue-drift` | 149 (SaaS) |
  | `synoptic-guides` | 94 |
  | `inventaire/catalog` | 59 |

### 2.4 Permissions (décision)

Dans arkyo, seules les pages ont une garde ; les routes vérifient seulement la session. Gardes des boutons (`IfTenantPerm`) :

| Écran | Créer | Supprimer |
|---|---|---|
| Projets | `projects:write` (`projects-client.tsx:405,434`) | `projects:admin` (`:752`) |
| Contenants | `design:write` (`racks-client.tsx:1547,1598,1737,1852`) | `design:admin` (`:1749,1864`) |
| Panels | `design:write` (`panels-client.tsx:292,341`) | `design:admin` (`:442,509`) |

Deux options :
- **(a) parité stricte** : session seule ;
- **(b)** côté serveur, les mêmes gardes que l'UI : `projects:write` pour POST/PATCH projets, lieux et racks de projet, `projects:admin` pour DELETE projet, `design:write` / `design:admin` pour racks, rigs et panels.

Recommandation : (b), avec un commentaire `// arkyo-server:`. Une régie locale sans garde serveur ouvre l'écriture au rôle « consultation ».

---

## 3. Modèles Prisma (`database/tenant/schema.prisma`)

Conventions (`0002_catalogue.sql:1-8`) :
- types : String → TEXT, Int → INTEGER, Float → REAL, Boolean → INTEGER 0/1, DateTime → TEXT ISO ms, Json → TEXT, enum → TEXT CHECK ;
- `@updatedAt` est posé par le handler ;
- action par défaut de Prisma sans `onDelete` : relation optionnelle → **SetNull**, relation obligatoire → **Restrict**.

### 3.1 À créer en phase 3 (migration `0003_projets.sql`)

**Project** (:15)
- Champs : `id` cuid, `name`, `clientName?`, `shootingDate?`, `shootingEndDate?`, `planningStart?`, `planningEnd?`, `commissioningDate?`, `location?`, `description?`.
- Enums et défauts : `status ProjectStatus = EN_PREPARATION` (:129 : EN_PREPARATION, PRET, EN_COURS, TERMINE, ANNULE), `prestationType?`, `interventionType InterventionType = PRESTATION` (:100 : PRESTATION, INTEGRATION), `rigType RigType?` (:466 : FLIGHT_CASE, CAR, FIXED_INSTALL, MIXED).
- Dates : `createdAt now`, `updatedAt`.
- Autres : `createdById` (TEXT, sans FK), `ipMapPositions Json?` (phase 5, nullable, peut être ajouté plus tard).

**TechnicalSheet** (:141)
- `id`, `projectId` **unique** → Project **Cascade**.
- `blocks Json = "[]"`, `completionPercent Float = 0`, `createdAt`, `updatedAt`.
- Créée à chaque création de projet (`tenant/projects/route.ts:126`) et lue par le tableau de bord.

**Location** (:421)
- `id`, `projectId` → Project **Cascade**, `name`, `cableCode?`, `sortOrder Int = 0`, `canvasX?`, `canvasY?`, `canvasW?`, `canvasH?`, `createdAt`, `updatedAt`.
- Index `projectId`.

**RigConfig** (:446)
- `id`, `name`, `type RigType = FLIGHT_CASE`, `prestationType?`, `isTemplate Boolean = false`, `notes?`.
- `projectId?` → Project **SetNull**.
- `createdById`, `createdAt`, `updatedAt`.

**Rack** (:474)
- Dimensions et limites : `id`, `name`, `totalU = 42`, `depthMm = 600`, `maxWeightKg?` Float, `maxPowerW?` Float, `emptyWeightKg?` Float, `notes?`, `rearInteriorGapMm?`.
- Numérotation : `cableId Int?`, `cableNextNum = 1`, `cableCode?`, `numberingOverride Json?`.
- Type et forme :
  - `rackType RackType = STANDARD` (:783 : STANDARD, FLIGHT_CASE_CLASSIC, FLIGHT_CASE_SKB, PELICAN, CAP) ;
  - `isRackable = true`, `widthMm?`, `heightMm?`, `hasWheels = false`.
- Statuts :
  - `constructionChecks Json = "[]"` ;
  - `templateStatus RackTemplateStatus = BROUILLON` (:811 : BROUILLON, INACTIF, ACTIF) ;
  - `prepStatus RackPrepStatus = TO_PREPARE` (:792 : TO_PREPARE, TO_ORDER, ORDERED, RECEIVED, READY) ;
  - `sourcing RackSourcing = STOCK` (:801 : STOCK, PURCHASE, RENTAL).
- Lieu et position : `canvasX?`, `canvasY?`, `locationId?` → Location **SetNull**, `isVirtual = false`.
- Dates : `createdAt`, `updatedAt`. Index `locationId`.

**RigRack** (:536)
- `id`, `rigConfigId` → RigConfig **Cascade**, `rackId` → Rack **Cascade**, `position Int = 0`.
- Unique (`rigConfigId`, `rackId`).

**RackSlot** (:549)
- Références :
  - `id`, `rackId` → Rack **Cascade**, **`catalogEquipmentId?`** (soft FK, sans contrainte) ;
  - `snapshotId?` (SaaS : à omettre, ou à garder toujours à null) ;
  - `panelId?` → Panel (SetNull par défaut) ;
  - `parentSlotId?` → RackSlot **Cascade** ;
  - `inventoryItemId?` → RackInventoryItem **SetNull**.
- Position :
  - `view RackView = FRONT` (:817 : FRONT, REAR, REAR_INTERIOR, SIDE) ;
  - `startU Int?`, `heightU Float?` ;
  - `widthFraction WidthFraction = FULL` (:824 : FULL, HALF, THIRD, QUARTER) ;
  - `column = 0`.
- Contenu : `label?`, `notes?` (chaîne JSON, §5 de la spec), `patchNotes?`, `panelLabels Json?`, `synopticX?` Float, `synopticY?` Float.
- Dates : `createdAt`, `updatedAt`. Index `inventoryItemId` (et `snapshotId`).
- Écrite en phase 3 par la branche `fromTemplateId` ; lue par `/api/racks`, `/templates`, `/api/rigs/**`.

**RackInventoryItem** (:871)
- Référence catalogue (une seule des quatre est renseignée) : `id`, `rackId` → Rack **Cascade**, **`catalogEquipmentId?`**, `panelId?` → Panel (SetNull), `catalogAdapterId?`, `snapshotId?` (SaaS).
- Accessoire : `accessoryType?`, `accessoryHeightU?`, `accessoryVariant?`, `accessoryDepthMm?`.
- Quantité et imbrication : `quantity = 1`, `notes?`, `hostItemId?` → RackInventoryItem **Cascade**, `hostSlotIndex?`.
- Dates : `createdAt`, `updatedAt`.
- Index : `rackId`, `catalogEquipmentId`, `panelId`, `catalogAdapterId`, `hostItemId`.
- Écrite en phase 3 par la branche `fromTemplateId` (`tenant/projects/[id]/racks/route.ts:186-215`) ; nécessaire à la clé étrangère de `RackSlot.inventoryItemId`.

**Panel** (:360)
- `id`, `name`, `panelType String = "PATCH"`, `accessoryType?`, `plateType?`, `heightU = 1`, `slotsPerU = 8`, `depthMm?`, `rearCableDepthMm = 80`, `notes?`, `private Boolean = false`, `createdById`, `createdAt`, `updatedAt`.
- Index `private`.

**PanelSlot** (:390)
- `id`, `panelId` → Panel **Cascade**, `position Int`, `sizeSlots = 1`, `label?`, `notes?`, `catalogConnectorTypeId?` (soft FK), `mountD Boolean = false`, `familyLabel?`.
- Ni `createdAt` ni `updatedAt`.

**AuditLog** existe déjà (`0002_catalogue.sql:414`, `projectId` sans FK). Arkyo déclare `project Project?` (`schema.prisma:346`) sans `onDelete`, donc SetNull. La suppression d'un projet doit donc faire `UPDATE "AuditLog" SET "projectId" = NULL WHERE "projectId" = ?` pour garder la parité, ou rien si on l'accepte (le lecteur d'audit filtre par `entityType`/`entityId`).

### 3.2 Arbitrage : Task, Message, ProjectDocument

**Task** (:273)
- Champs : `id`, `projectId` → Project Cascade, `title`, `description?`, `status TaskStatus = A_FAIRE` (A_FAIRE, EN_COURS, TERMINE, VALIDE), `priority Priority = NORMALE` (BASSE, NORMALE, HAUTE, URGENTE), `dueDate?`, `completedAt?`, `order = 0`, `fromTemplate = false`, `assignedToId?`, `createdAt`, `updatedAt`.

**Message** (:310)
- Champs : `id`, `projectId` → Project Cascade, `authorId`, `content`, `status MessageStatus = OUVERTE` (OUVERTE, REPONDUE, VALIDEE, CLOTUREE), `blockRef?`, `attachments Json?`, `createdAt`, `updatedAt`.

**ProjectDocument** (:115)
- Champs : `id`, `projectId` → Project Cascade, `name`, `url`, `mimeType?`, `sizeBytes Int?`, `uploadedAt = now`, `uploadedById?`.
- Index `projectId`.

Personne n'écrit dans ces trois tables (§0.1, §0.2). Recommandation : **ne pas les créer**, et renvoyer les compteurs à 0 (`taskStats = []`, `_count.tasks/messages/documents = 0`), avec un commentaire `// arkyo-server:`. Autre option bon marché : les créer vides pour que les requêtes SQL soient identiques.

### 3.3 Créés par les phases suivantes

Tables créées en phase 4 :
- côté rack : `RackZone` (:612), `RackLabel` (:636), `ExternalPort` (:662), **`RackConnection`** (:699), `CableBundle` (:759), `RackSlotPanelRow` (:770), **`SynopticAdapter`** (:838) ;
- côté projet : **`ProjectConnection`** (:938), **`ProjectSynopticAdapter`** (:994), `ProjectCableBundle` (:1022), `ProjectSynopticZone` (:1036), `ProjectSynopticLabel` (:1053), `SynopticGuide` (:1070), `ProjectSynopticLayout` (:1088), `ProjectEquipment` (:156).

Tables créées en phase 5 : `Carto*` (:1109-1295), `ProjectNetworkVlan`, `ProjectPortAssignment`, `Project2110Config`, `Project2110Source`, `ProjectLightingFixture`, `ProjectDrawing`.

Tables créées en phase 6 : `EquipmentPrepUnit`, `AdapterPrep`, `PanelPrep` (FK Panel **Cascade**), `CablePrep`, `AccessoryPrep`, `RecetteItem`, `RecetteLogEntry`, `TenantDossierModel` (:2078 : `id`, `name` **unique**, `description?`, `composition Json`, `createdAt`, `updatedAt`).

Table jamais créée : `ProjectCatalogueSnapshot` (SaaS).

### 3.4 Colonnes attendues par `in_use` (phase 2)

Source : `crates/arkyo-server/src/catalogue/in_use.rs:258-296`. Les tables sont lues seulement si elles existent :

| Fonction | Table | Colonne | Création |
|---|---|---|---|
| `equipment` | `"RackInventoryItem"` | `"catalogEquipmentId"` (schema :879) | phase 3 |
| `equipment` | `"RackSlot"` | `"catalogEquipmentId"` (schema :555) | phase 3 |
| `cable` | `"RackConnection"` | `"catalogCableModelId"` (schema :740) | phase 4 |
| `cable` | `"ProjectConnection"` | `"catalogCableModelId"` (schema :973) | phase 4 |
| `adapter` | `"SynopticAdapter"` | `"catalogAdapterId"` (schema :843) | phase 4 |
| `adapter` | `"ProjectSynopticAdapter"` | `"catalogAdapterId"` (schema :999) | phase 4 |

Ces colonnes correspondent à `arkyo:lib/services/tenant-catalogue.ts:173-238`. Après la phase 3, le refus de supprimer un équipement utilisé devient actif : ajouter un test.

---

## 4. Parties SaaS à retirer

- **`assertNotGhost` / `GhostModeError`**, avec le 403 « Mode lecture seule » : toutes les routes d'écriture de §2.1.
- **`mainDb`**, à remplacer par les tables locales :
  - `POST /api/panels` recherche l'utilisateur dans `mainDb.user` (`app/api/panels/route.ts:55-61`) : prendre `CurrentUser` ;
  - `checkMountDAllowed` lit `mainDb.catalogConnectorType` (`panels/[id]/slots/route.ts:42`, `[slotId]/route.ts:41`) : lire `TenantConnectorType`, avec la dérivation D déjà portée (`http/parametres/connectors.rs`) ;
  - pages : `rigs/[id]/page.tsx:59` (`mainDb.catalogEquipment`), `panels/[id]/page.tsx:18,35,44`.
- **Nom du tenant** (`getTenantSlug` + `mainDb.tenant`, `panels/[id]/page.tsx:16-22`) : utiliser `AppConfig site.name` (`/api/site`).
  - Lockup « arkyo.io | Tenant » de la topbar (`panel-editor.tsx:1831-1880`) : `StrataBrand`, habillage Strata.
  - `--impersonation-banner-height` / `--dev-banner-height` (`panel-editor.tsx:1826`) : déjà à `0px` dans `web/src/app/globals.css:133,136`, à laisser tel quel.
- **Plan** (`useTenantPlan().canAccess`) : **aucun usage** dans les fichiers de la phase 3. Seuls les onglets admin s'en servent, et ils sont déjà traités.
- **Snapshots** (`project-snapshot*`, `snapshot-placement`, `ProjectCatalogueSnapshot`) : **aucun usage** dans les routes de la phase 3.
  - Ils n'apparaissent que dans les routes de la phase 4 : `api/racks/[id]/inventory`, `tenant/projects/[id]/{catalogue-drift, racks/[rackId]/canvas-data, racks/[rackId]/inventory, snapshots/**, synoptic/adapters, synoptic/canvas-data, synoptic/general}`, et dans `lib/services/{rack-inventory-api, synoptic-focus-payload}.ts`.
  - Colonnes `snapshotId` de `RackSlot` / `RackInventoryItem` : à omettre ou à garder nulles (décision).
- **Supervisor, crédits, propositions, support** : aucun usage dans les fichiers de la phase 3 (vérifié par grep).
- **Widget de rapport de bug** : layout plein écran, `app/(fullscreen)/layout.tsx:5,23`, déjà porté et retiré.
- **Emails** : aucun envoi dans les routes de la phase 3.
- **Temps réel WS** : `use-live-cursors.ts` appelle `POST /api/realtime/ticket` puis le WebSocket `/realtime`. À porter tel quel : c'est silencieux sans service (phase 7). Sinon, neutraliser avec un commentaire `// arkyo-server: phase 7`.
- **Marque** : commentaires « mockups Arkyo » dans `new-project-dialog.tsx:797,818,820` (commentaires seulement, à vérifier visuellement) ; lockup de l'éditeur de panel.

---

## 5. Services `lib/` utilisés par ces routes

| Service | l. | Usage | État |
|---|---|---|---|
| `lib/services/catalog-enrich.ts` | 314 | `fetchCatalogEquipmentMap` / `fetchCatalogConnectorTypeMap` (9 routes) | équivalent Rust en phase 2 (`src/catalogue/enrich.rs`, `Refs`, `lookup`) |
| `app/api/_lib/connector-dtype.ts` | 101 | `deriveHasNeutrikD`, `loadConnectorDTypeSymbols` (slots de panel) | porté (`http/parametres/connectors.rs` : `has_neutrik_d`, `load_symbols`) |
| `lib/services/rack-naming.ts` | 71 | `ensureUniqueRackName(db, projectId, base)` : suffixe « 2 », « 3 »… par projet (POST racks de projet) | **à porter** |
| `deriveCableCode` (local) | – | `tenant/projects/[id]/locations/route.ts:13-16` | à porter |
| allocation de `cableId` (local) | – | `api/racks/route.ts:146-149` | à porter |
| normalisation de `cableCode` + `numberingOverrideSchema` (local) | – | `api/racks/[id]/route.ts:13-26,67-82` | à porter |
| `lib/client-id.ts` | 98 | `readClientIdFromRequest` (PATCH/DELETE rack) | à porter (en-tête) |
| `lib/app-events.ts` / `lib/event-bus.ts` / `lib/rack-events.ts` | 163 / 233 / 24 | bus | Rust `events.rs` à étendre (métadonnées) ; SSE par rack en phase 4 |
| `lib/services/tenant-catalogue.ts` | 238 | `assert*NotInUse` | porté (`in_use.rs`) |
| `lib/services/rack-clone.ts` | 352 | `save-as-template`, `clone-from-template` | **phase 4** |
| `lib/services/rack-inventory*.ts` | 385 + 567 + 345 | inventaire | **phase 4** |
| `lib/services/audit-format.ts` | 79 | `audit-panel` | **phase 4** |
| `lib/services/rack-validation.ts` | 524 | type seulement en phase 3 | copier tel quel (front) |

Pas de service de duplication de projet ni de création de projet à partir d'un modèle :
- l'assistant crée un projet vide, puis un lieu, puis un contenant ;
- la branche `fromTemplateId` (RigConfig `isTemplate`) n'est envoyée par aucun écran de la phase 3 (`buildRackPayload`, `components/racks/rack-wizard-steps.tsx:141-158`) ;
- la création depuis un contenant modèle passe par `clone-from-template` (phase 4).

---

## 6. Taille et découpage

### 6.1 Volume

**Front à copier puis adapter** : ≈ **14 950 l.**

| Groupe | Contenu | l. |
|---|---|---|
| projets | client 846 + assistant 1 750 + étapes de contenant 869 + pages 82 | 3 547 |
| tableau de bord | page | 475 |
| `/templates` | page 95 + client 41 + racks 1 985 + assistant 793 + panels 541 + assistant 1 107 + 3 redirections 24 | 4 586 |
| détail de régie | client + page | 599 |
| éditeur de panel | fermeture 5 624 + page 107 | 5 731 |

**API (TypeScript → Rust)** : ≈ **2 390 l.**

| Groupe | l. |
|---|---|
| projets (`tenant/projects` 144, `[id]` 164, `api/projects` 76) | 384 |
| lieux | 185 |
| racks de projet | 281 |
| racks (193 + 188) | 381 |
| rigs (4 routes) | 485 |
| panels (4 routes) | 480 |
| `rack-naming` | 71 |

Plus les extensions arkyo-server : liste des projets, filtre des modèles de contenants, métadonnées d'évènement, gardes de permission.

**Reporté** :
- éditeur de rack : 60 679 l. de fermeture + 2 pages (953 l.) + 3 415 l. d'API `racks/[id]/**` ;
- onglet Dossiers : 5 441 l. (front) + 174 l. (API) ;
- audit : 125 l. (API) ;
- documents : 215 l. (API, mort) ;
- `rigs-client` : 515 l. (mort).

### 6.2 Éditeur de rack : **à reporter en phase 4**

- Il embarque `components/synoptique/synoptic-view.tsx` (14 024 l.), qui est le synoptique de la phase 4, ainsi que `inventaire-scope`, `catalog-panel`, `rack-card-canvas`, `add-container-wizard` et `update-snapshot-modal` de l'inventaire projet.
- Il appelle 21 sous-routes de `/api/racks/:id/**`, les SSE par rack et les tables de la phase 4 (`RackConnection`, `SynopticAdapter`, `RackZone`, `RackLabel`, `ExternalPort`, `CableBundle`, `RackSlotPanelRow`, `SynopticGuide`).
- Dans arkyo, la page `/racks/[rackId]` importe directement des types de l'inventaire projet (`page.tsx:18-19,367`).

Le porter en phase 3 reviendrait à faire la phase 4.

### 6.3 Éditeur de panel : **à garder en phase 3**

- Fermeture de 5,6 k lignes et 4 routes d'API (480 l.).
- Une seule table en plus (`PanelSlot`).
- Aucune dépendance au rendu des élévations ni à l'inventaire. Les seules dépendances sont des modules partagés légers : `topbar-actions-context`, `synoptic-general-panel` (`NameInput`), les fenêtres d'aide et les curseurs live.
- Nouvelle dépendance npm : `zustand`.

### 6.4 Tâches proposées (14, chacune = un implémenteur + un relecteur)

1. **Migration `0003_projets.sql` et socle serveur.**
   - Tables de §3.1 : Project, TechnicalSheet, Location, RigConfig, RigRack, Rack, RackSlot, RackInventoryItem, Panel, PanelSlot, avec CHECK et index.
   - Événements : `publish` avec métadonnées (`projectId`, `rackId`, `clientId`) et lecture de `clientId`.
   - Utilitaire de réponse 400 au format `flatten()`.
   - Test `in_use` : un équipement utilisé dans un rack refuse la suppression.
2. **API projets** : `tenant/projects` (GET avec les champs de la liste, POST avec 409 sur doublon et TechnicalSheet), `tenant/projects/:id` (GET, PATCH, DELETE, avec `projectId` remis à null dans l'audit), `api/projects` (GET/POST pour le tableau de bord). Audit et évènements.
3. **API création dans un projet** : `locations` GET/POST (RigConfig implicite, rack virtuel, `deriveCableCode`), POST `projects/:id/racks` (`ensureUniqueRackName`, branche `fromTemplateId` qui clone `RackSlot` et `RackInventoryItem`).
4. **API racks et rigs** : `/api/racks` (GET avec `unassigned` / `rigConfigId` et filtre « modèles », POST avec `cableId`), `/api/racks/:id` (PATCH avec `cableCode` et `numberingOverride`, DELETE), `/api/rigs/**` (4 routes, invariant `isTemplate`), enrichissement des slots.
5. **API panels** : `/api/panels/**` (4 routes : GET sans session, POST sans Zod, suppression des slots si les dimensions changent, `checkMountDAllowed` sur `TenantConnectorType`).
6. **Front, socle de la phase** :
   - routeur : `dashboard`, `projects`, `projects/:id` (redirection), `racks` / `rigs` / `panels` (redirections), `rigs/:id`, `panels/:id` ;
   - routes qui restent en `ComingSoon` : `racks/:rackId`, `rigs/:id/rack/:rackId`, `project/:id/*` ;
   - page `/dashboard` (ClientPage + `GET /api/projects`, prénom par `useSession`, `taskStats` vide).
7. **Front, liste des projets** : `projects/page.tsx` et `projects-client.tsx` (onglets prestation / intégration, filtres, suppression).
8. **Front, assistant « Nouveau projet »** : `new-project-dialog.tsx` et `racks/rack-wizard-steps.tsx` (flux en 3 appels, habillage des mini-maquettes).
9. **Front, `/templates` onglet Contenants** : `templates/page.tsx`, `templates-client.tsx` (onglet `dossiers` → `ComingSoon` avec `// arkyo-server: phase 6`), `racks-client.tsx`, `new-rack-wizard.tsx`.
10. **Front, `/templates` onglet Panels** : `panels-client.tsx`, `panels/new-panel-wizard.tsx`.
11. **Front, détail de régie** : `rigs/[id]/page.tsx` et `rig-detail-client.tsx` (glisser-déposer, lier / délier). Tâche petite, qu'on peut fusionner avec la 10.
12. **Front, éditeur de panel (1/2), dépendances** :
    - ajout de `zustand` ;
    - copie de `editor-shell/topbar-actions-context`, `synoptique/components/{synoptic-general-panel, synoptic-help-modal, synoptic-shortcuts-modal, remote-cursors-overlay}`, `synoptique/hooks/use-live-cursors`, `lib/services/rack-validation` ;
    - chargeur de `panels/[id]/page.tsx` (panel, connecteurs avec catégories, fonctions, nom du site).
13. **Front, éditeur de panel (2/2)** : `panel-editor.tsx` (2 970 l.), topbar en habillage Strata, synchronisation SSE, glisser-déposer des connecteurs, Neutrik D.
14. **Clôture** : parité écran par écran, docs (`README`, `ARCHITECTURE`, état de `CLAUDE.md`, liste de ce qui est reporté), CI verte.

### 6.5 Décisions à faire valider par Damien

1. Permissions serveur : parité (session seule) ou gardes reprises de l'UI (§2.4).
2. Tables `Task`, `Message` et `ProjectDocument`, et routes documents : ne rien créer (compteurs à 0) ou créer les tables vides (§3.2).
3. Colonnes `snapshotId` de `RackSlot` / `RackInventoryItem` : omises ou gardées nulles.
4. Contenants d'un projet supprimé qui réapparaissent dans `/templates` : parité ou correction (§0.10).
5. Audit (deux GET) reporté en phase 4 avec `audit-panel` (§0.4).
6. `RigsClient` mort : non porté.
