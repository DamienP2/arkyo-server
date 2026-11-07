# Interface Strata activable : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** ajouter une seconde interface, « Strata » (maquette Plateau-Atelier), activable dans Administration › Système, sans rien changer à l'interface Classique ni perdre aucune fonction.

**Architecture :**
- Une clé `AppConfig` `ui.interface` est exposée par `GET /api/site` et écrite par `PUT /api/system/interface`.
- Côté front, un contexte `useInterface()` fait choisir à quelques points d'accroche commentés (layouts, `EditorShell`, topbar projet, fiche équipement, `getEditorSlots`) une coquille et des docks écrits en code neuf dans `web/src/strata/`. Les pages et éditeurs copiés d'arkyo y sont logés tels quels.

**Tech Stack :** Rust axum + SQLite (sqlx), React 19 + react-router + Tailwind v4, @dnd-kit, vitest + happy-dom.

**Spec :** `docs/superpowers/specs/2026-11-07-interface-strata-design.md`

## Global Constraints

- Valeurs de `ui.interface` : `classique` (défaut, clé absente) ou `strata`. Tout autre corps de `PUT` répond `400 { "error": "Interface inconnue." }`.
- `PUT /api/system/interface` : garde `require(&u, &st.pool, Domain::Settings, Level::Admin)` (403 `{"error":"Accès refusé"}`), évènement `("config", "updated")`, réponse `204`.
- `GET /api/site` renvoie `{ name, logoUrl, interface }`.
- Commentaire obligatoire sur chaque ligne modifiée d'un fichier copié : `// arkyo-server: interface Strata`. La liste fermée des fichiers est au §5.2 de la spec ; toute autre modification de fichier copié est interdite.
- Code neuf dans `web/src/strata/` uniquement. Couleurs d'interface : variables de `globals.css` uniquement. Nouvelles variables `--strata-face-bg`, `--strata-face-line`, `--strata-face-ink`, `--strata-face-ink-2`, `--strata-face-ink-3`, définies dans `:root` et `.dark`. Couleurs métier inchangées (`--arkyo-signal-*`, couleurs des signaux du catalogue).
- Règles arkyo : « Ajouter » en pointillés, `<EmptyState>`, `<LoadingState>`, pickers modaux, genres `M`/`F`/`N`, aucun hint inutile.
- En Classique : aucun test existant modifié, aucun rendu modifié.
- Travail dans `/Users/dperpignan/arkyo-server-ui-strata` (branche `ui-strata`). `git rebase main` en début de chaque tâche. Ne jamais pousser ni taguer.
- Fin de chaque lot : `source "$HOME/.cargo/env" && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`, puis `cd web && npm test && npx tsc --noEmit && npm run build`.

## Review Focus

1. **Bascule pendant qu'un éditeur est ouvert avec des modifications en cours.** L'éditeur doit être reconstruit sans perdre l'état serveur, et `UnsavedChangesProvider` doit continuer d'avertir. Test : tâche 3, `bascule-pendant-edition`.
2. **Utilisateur sans permission `settings:admin`.** Il ne voit pas la section Interface de Système et ne peut pas appeler la route (403). Il voit pourtant l'interface choisie par l'admin. Tests : tâches 1 et 3.
3. **Équipement sans connectique, ou entrée dont le `connectorTypeId` est inconnu, ou `quantity` à 0.** La face s'affiche (façade neutre, pictogramme générique) sans planter. Test : tâche 6.
4. **Dépôt depuis la bibliothèque d'un équipement absent de la nomenclature, ou sur un U occupé ou trop court.** Dans le premier cas, la ligne de nomenclature est créée côté serveur. Dans les deux autres, le dépôt est refusé avec un message, sans requête. Tests : tâche 9.
5. **Projet sans contenant rackable.** En Strata, l'onglet Rack et la vue Connectique affichent le même `EmptyState` qu'en Classique, et le dock bas reste vide. Test : tâche 10.

---

## Lot 1 : socle

### Task 1 : réglage d'interface côté serveur

**Files :**
- Modify : `crates/arkyo-server/src/http/me.rs` (`site`)
- Modify : `crates/arkyo-server/src/http/system.rs` (nouveau handler `set_interface`)
- Modify : `crates/arkyo-server/src/http/mod.rs` (route `PUT /system/interface`, à côté des routes `/system`)
- Test : `crates/arkyo-server/tests/http_system.rs`

**Interfaces :**
- Produces : `pub async fn interface(pool: &SqlitePool) -> &'static str` dans `http/system.rs` (`"classique"` | `"strata"`) ; route `PUT /api/system/interface` ; champ `interface` dans `GET /api/site`.

- [ ] **Step 1 : écrire les tests qui échouent**, dans `http_system.rs` :
  - `site_exposes_interface_classique_by_default` : `GET /api/site` (technicien connecté) → `body["interface"] == "classique"`.
  - `interface_requires_settings_admin` : `PUT /api/system/interface {"interface":"strata"}` → 403 `"Accès refusé"` pour le technicien, 401 sans session.
  - `interface_put_switches_and_publishes` : en tant que propriétaire, `PUT {"interface":"strata"}` → 204, puis `GET /api/site` → `"strata"`. Retour à `"classique"` → 204, puis `"classique"`.
  - `interface_rejects_unknown` : `PUT {"interface":"rose"}` → 400, `body["error"] == "Interface inconnue."`. Corps absent → 400.
  - `interface_survives_backup_restore` : régler `strata`, sauvegarder puis restaurer comme dans `tests/backup.rs`, puis `GET /api/site` → `"strata"`.
- [ ] **Step 2 :** `cargo test -p arkyo-server --test http_system interface` → FAIL (route absente, champ absent).
- [ ] **Step 3 : implémenter.**
  - Lecture : `SELECT "value" FROM "AppConfig" WHERE "key"='ui.interface'`. Toute valeur autre que `strata` vaut `classique`.
  - Écriture : upsert sur le modèle d'`espace.rs:84-92`, avec `cuid::cuid1()` et la date ISO à millisecondes.
  - Évènement : le même `publish` que `parametres/application.rs` (`"config","updated"`).
- [ ] **Step 4 :** `cargo test -p arkyo-server --test http_system` → PASS. Puis `cargo clippy --workspace --all-targets -- -D warnings` → OK.
- [ ] **Step 5 :** commit `feat: réglage d'interface (ui.interface) et PUT /api/system/interface`.

### Task 2 : contexte d'interface

**Files :**
- Create : `web/src/strata/interface-context.tsx`
- Modify : `web/src/app/(app)/app-layout.tsx` (`ShellGate.ok` + `interface`, `loadShell()` lit `site.interface`, provider)
- Modify : `web/src/app/(fullscreen)/fullscreen-layout.tsx` (provider)
- Modify : `web/src/tests/app-harness.tsx` (`signedInApi(perms, siteName, iface = "classique")` ajoute `interface` au mock `/api/site`). C'est un fichier de test du projet, pas une copie.
- Test : `web/src/strata/interface-context.test.tsx`

**Interfaces :**
- Produces : `export type UiInterface = "classique" | "strata"` ; `export function InterfaceProvider({ value, children })` ; `export function useInterface(): UiInterface` (`"classique"` hors provider) ; le provider pose `document.documentElement.dataset.interface`.

- [ ] **Step 1 : tests.**
  - `useInterface vaut classique hors provider`.
  - `pose data-interface sur html`.
  - `la coquille lit interface dans /api/site` : `renderApp("/dashboard", signedInApi(OWNER_PERMS, "Régie A", "strata"))` → `document.documentElement.dataset.interface === "strata"`.
- [ ] **Step 2 :** `cd web && npx vitest run src/strata/interface-context.test.tsx` → FAIL.
- [ ] **Step 3 : implémenter.** Commenter chaque ligne touchée de `app-layout.tsx` et `fullscreen-layout.tsx` par `// arkyo-server: interface Strata`.
- [ ] **Step 4 :** `npx vitest run` (toute la suite) → PASS, sans test existant modifié.
- [ ] **Step 5 :** commit `feat(web): contexte d'interface Classique/Strata`.

### Task 3 : section Interface de la page Système

**Files :**
- Modify : `web/src/app/(app)/admin/systeme/systeme-page.tsx` (nouvelle `Section` « Interface » en tête)
- Test : `web/src/app/(app)/admin/systeme/systeme-page.test.tsx` (ajouts seulement)

**Interfaces :**
- Consumes : `useInterface()` (tâche 2), `PUT /api/system/interface` (tâche 1).

- [ ] **Step 1 : tests ajoutés.**
  - `affiche le choix d'interface courant` : contrôle segmenté avec `Classique (arkyo)` actif et `Strata`.
  - `bascule vers Strata après confirmation` : clic sur `Strata`, confirmation → `sentBody(fetchSpy, "PUT", "/api/system/interface")` vaut `{ interface: "strata" }`, puis toast « Interface Strata activée pour tous les utilisateurs ».
  - `annuler la confirmation n'envoie rien`.
  - `bascule-pendant-edition` (Review Focus 1) : avec `emitAppEvent` après la bascule, la coquille se relit (`/api/site` appelé une seconde fois) et `data-interface` passe à `strata` sans rechargement.
- [ ] **Step 2 :** `npx vitest run src/app/\(app\)/admin/systeme` → FAIL.
- [ ] **Step 3 : implémenter.**
  - Libellés : `Classique (arkyo)` / `Strata`, avec une ligne de description chacun : « L'interface d'arkyo, inchangée. » / « Topbar et docks façon Strata Graphics, dessins techniques. ».
  - `useConfirm()` avec le titre « Changer l'interface ? » et le message « L'interface change pour tous les utilisateurs connectés. ».
  - Ensuite `router.refresh()`.
- [ ] **Step 4 :** suite complète → PASS.
- [ ] **Step 5 :** commit `feat(web): choix de l'interface dans Système`.

### Task 4 : coquille générale Strata

**Files :**
- Create : `web/src/strata/shell/strata-app-shell.tsx`, `strata-topbar.tsx`, `strata-side-nav.tsx`, `nav-model.ts`
- Modify : `web/src/components/layout/topbar.tsx` (ajout de `export` sur `NotificationsMenu`, `LanguageMenu`, `ProfileMenu`, `ROLE_BADGE` seulement)
- Modify : `web/src/app/(app)/app-layout.tsx` (en Strata, `<StrataAppShell>` à la place de `Topbar` + `Sidebar` + `main`, dans les mêmes providers)
- Modify : `web/src/app/globals.css` (bloc `[data-interface="strata"]` : `--rail-width: 240px; --topbar-height: 46px;`, et variables `--strata-face-*` dans `:root` et `.dark`)
- Test : `web/src/strata/shell/strata-app-shell.test.tsx`

**Interfaces :**
- Produces :
  - `nav-model.ts` : `export const STRATA_NAV: StrataSection[]`, avec `StrataSection = { id: "projets"|"modeles"|"catalogue"|"administration"; label; items: { href; label; perm?: { domain; level } }[] }`. Les entrées et permissions sont exactement celles de `components/layout/sidebar.tsx`.
  - `export function sectionOf(pathname: string): StrataSection["id"]`.
  - La coquille garde `header`, `aside` et `main#main-content`, pour la compatibilité des sélecteurs.

- [ ] **Step 1 : tests.**
  - `toutes les routes du rail sont dans la navigation Strata` : pour chaque `href` de `sidebar.tsx`, il existe un item de `STRATA_NAV` de même `href` et de même `perm`.
  - `coquille strata : header avec onglets Projets, Modèles, Catalogue, Administration`.
  - `filtre par permission` : avec TECH_PERMS, ni `Système` ni `Utilisateurs`.
  - `onglets de page rendus dans la topbar` : sur `/admin/catalogue`, les onglets équipements, câbles et adaptateurs sont visibles dans `header`.
  - `classique inchangé` : `router.test.tsx` passe sans modification.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 : implémenter.**
  - La topbar suit la maquette : lockup `StrataBrand`, nom du site, `.tabs` segmentés, groupe des onglets de page (`useTopbarTabs`), puis à droite `PresenceAvatars`, thème, menus exportés.
  - La barre latérale suit la maquette : `section-label` en capitales, items avec icône et compteur facultatif, item actif sur fond `--accent-soft`.
  - Le menu Administration ▾ liste Espace, Utilisateurs, Catalogue, Paramètres, Système.
- [ ] **Step 4 :** suite complète, puis `npx tsc --noEmit` → PASS.
- [ ] **Step 5 :** captures `/dashboard`, `/admin/catalogue` et `/admin/systeme` en Strata, clair et sombre. Contrôle que `AdminTabLayout` reste aligné.
- [ ] **Step 6 :** commit `feat(web): coquille Strata (topbar et navigation)`.

### Task 5 : éditeur projet en docks

**Files :**
- Create : `web/src/strata/shell/strata-editor-shell.tsx`, `strata-project-topbar.tsx`, `bottom-dock.tsx` (cadre vide, repliable)
- Modify : `web/src/components/editor-shell/editor-shell.tsx` (en Strata : `return <StrataEditorShell {...slots} />`)
- Modify : `web/src/app/(fullscreen)/project/[id]/_editor/project-global-topbar.tsx` (en Strata : `return <StrataProjectTopbar {...props} />`)
- Test : `web/src/strata/shell/strata-editor-shell.test.tsx`

**Interfaces :**
- Consumes : `EditorShellSlots` (`components/editor-shell/editor-shell.tsx:12-26`) ; les props de `ProjectGlobalTopbar` (`project-global-topbar.tsx:73-82`), dont `tabs` (le `ProjectTabsPill`, qu'on ne rend pas en Strata). La topbar Strata reçoit `activeTab` et `onTabChange` par les mêmes props ; s'ils n'y sont pas, on lit `?tab=` via `useSearchParams` et on écrit avec la même logique que `handleTabChange` (`project-editor.tsx:334-339`).
- Produces :
  - `StrataEditorShell(props: EditorShellSlots & { bottomDock?: ReactNode; leftDockTabs?: { id: string; label: string; node: ReactNode }[] })` ;
  - `CONCEPTION_LENSES: ProjectTabId[] = ["rack","synoptique","schema","cartographie","video","audio","lumiere","reseau"]`.

- [ ] **Step 1 : tests.**
  - `en strata, l'éditeur rend topbar, dock gauche, canevas, inspecteur` : rôles et `data-dock` attendus.
  - `Conception affiche les huit lentilles et garde ?tab=` : clic sur `Synoptique` → URL `?tab=synoptique`.
  - `Livraison regroupe Préparation et Recette`.
  - `Fiche ouvre le dialogue des caractéristiques`.
  - `Dossier ouvre le menu d'export existant`.
  - `un slot null ne réserve pas de largeur`.
  - `en classique, EditorShell est inchangé` : snapshot du DOM classique identique à `main`.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 : implémenter.**
  - Grille : dock gauche (280 px : `leftToolbar` 48 px, puis onglets `leftDockTabs` ou `leftSidePanel`) | colonne centre (`contextualTopbar`, canevas, `bottomDock`) | `rightPanel` à la largeur du store `useWorkspace(s=>s.rightPanelWidth)` | `slideOver`.
  - La position `fixed` et l'offset haut sont ceux d'`EditorShell`.
- [ ] **Step 4 :** suite complète → PASS. Captures des onglets Inventaire et Rack en Strata.
- [ ] **Step 5 :** commit `feat(web): éditeur projet Strata en docks`. Fin du lot 1 : jeux de commandes complets, rapport à Damien avec captures.

## Lot 2 : dessins, accueil, catalogue

### Task 6 : bibliothèque de dessins techniques

**Files :**
- Create : `web/src/strata/drawings/equipment-face.tsx`, `block-diagram.tsx`, `cable-drawing.tsx`, `adapter-drawing.tsx`, `rack-elevation.tsx`, `face-layout.ts`
- Test : `web/src/strata/drawings/face-layout.test.ts`, `equipment-face.test.tsx`

**Interfaces :**
- Consumes :
  - `ConnectorEntry` (`app/(app)/admin/equipment/[id]/_editor/types.ts:42-65`) ;
  - `ConnectorIcon({ iconId, color, size })` (`components/ui/connector-icon.tsx:589`) ;
  - les types de connecteur `{ id, name, iconId }` et les signaux `{ name, color }` de `GET /api/tenant/catalogue/lookup`.
- Produces :
  - `layoutFace(entries: ConnectorEntry[], face: "FRONT"|"REAR", heightU: number, connectorWidthMm: (typeId: string) => number): FaceGroup[]`, avec `FaceGroup = { entryIndex; label; count; rows; cols; x; width; pitch; size }`. C'est l'algorithme de la maquette : pas de grille à 1,18 × la taille, réduction par pas de 0,04 jusqu'à tenir dans 434,6 mm, groupes espacés de 9 mm.
  - `<EquipmentFace equipment={{ name; brand; heightU; isRackable; dims; connectors }} face links?: Record<string,string> selectedPort? hoverEntry? onPortClick? />`, avec une clé de port `"<entryIndex>:<n>"` ;
  - `<BlockDiagram connectors signals hoverEntry? />`, `<CableDrawing cable />`, `<AdapterDrawing adapter />` ;
  - `<RackElevation units slots face labels selectedSlotId? onSlotClick? />`.
- Table de largeurs `CONNECTOR_MM`, en mm par `iconId` : bnc 11, din102 7, smpte/lemo 17, hdmi 15, xlr3/xlr4/xlr5 19, rj45 12, ethercon 19, sfp 14, qsfp 18, lc 12, sc 13, dsub 19, sma 7, usbc 9, iec13 24, iec19 27, true1 26, powercon 26, cee16 40, défaut 14.

- [ ] **Step 1 : tests.**
  - `layoutFace : 40 BNC en 2U tiennent sur 4 rangées` : `rows === 4`, `cols === 10`.
  - `réduit l'échelle quand la face déborde` : la somme des `width` + espaces ≤ 434,6.
  - `ignore les entrées d'une autre face`.
  - `quantity 0 et connectorTypeId inconnu ne plantent pas` (Review Focus 3) : la largeur par défaut est utilisée, aucune exception.
  - `EquipmentFace sans connectique rend une façade neutre` : texte « Pose libre » si non rackable.
  - `port relié marqué` : `links["0:1"]="V-0101"` → l'élément `[data-port="0:1"]` porte `data-linked`.
  - `title du port` : « SDI IN 3 · BNC F · 12G-SDI · entrée · libre ». Genre `MALE`→`M`, `FEMALE`→`F`, absent→`N`.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 : implémenter.** Style sobre de la maquette (traits fins, pictogrammes dans `--strata-face-ink-2`, filet de couleur du signal sous le libellé de groupe), couleurs uniquement en variables.
- [ ] **Step 4 :** PASS.
- [ ] **Step 5 :** commit `feat(web): dessins techniques Strata (faces, schéma, câbles, adaptateurs, élévation)`.

### Task 7 : accueil Strata

**Files :**
- Create : `web/src/strata/pages/strata-home.tsx`
- Modify : `web/src/router.tsx`. `dashboard` rend `<InterfaceSwitch classique={<DashboardPage/>} strata={<StrataHome/>} />`, avec `InterfaceSwitch` dans `web/src/strata/interface-switch.tsx` (fichier du projet, pas une copie).
- Test : `web/src/strata/pages/strata-home.test.tsx`

**Interfaces :**
- Consumes : `GET /api/projects` et `?stats=tasks` (forme `DashboardProject`, `dashboard/page.tsx:488-498`), `GET /api/tenant/projects` (`ProjectListItem`), `GET /api/notifications?limit=15`.

- [ ] **Step 1 : tests.**
  - `bandeau : projets actifs, tâches complétées, complétion moyenne, prochaine captation` : mêmes valeurs que le tableau de bord Classique pour le même jeu de données.
  - `grille de projets avec Concevoir et Livrer` : `Concevoir` → `/project/{id}?tab=rack`, `Livrer` → `?tab=preparation`.
  - `aucun projet → EmptyState`.
  - `heading « Tous les projets actifs » conservé`.
- [ ] **Step 2 → Step 4 :** FAIL, implémenter selon la maquette, puis PASS.
- [ ] **Step 5 :** commit `feat(web): accueil Strata`.

### Task 8 : catalogue Strata et panneau « Faces et schéma »

**Files :**
- Create : `web/src/strata/pages/strata-catalogue-grid.tsx`, `strata-cables-grid.tsx`, `strata-adapters-grid.tsx`, `web/src/strata/faces-panel.tsx`
- Modify :
  - `web/src/app/(app)/admin/catalogue/_components/equipment-list-panel.tsx`, `cables-list-panel.tsx`, `adapters-list-panel.tsx` : en Strata et en vue grille, rendu des grilles Strata. La vue liste et `CatalogueTable` sont inchangées.
  - `web/src/app/(app)/admin/equipment/[id]/equipment-editor.tsx` : en Strata, `<FacesPanel form={form} lookup={…} />` au-dessus de l'onglet Connectique.
- Test : `web/src/strata/pages/strata-catalogue-grid.test.tsx`, `web/src/strata/faces-panel.test.tsx`

**Interfaces :**
- Consumes : tâche 6 ; les données déjà chargées par les panneaux de liste (`/api/tenant/catalogue/equipment?scope=all`, `/lookup`).

- [ ] **Step 1 : tests.**
  - `carte équipement : face dessinée, U, poids, puissance, ports, double alim., ST 2110`.
  - `clic sur la carte ouvre l'éditeur existant`.
  - `la recherche et les filtres existants s'appliquent à la grille Strata`.
  - `FacesPanel se met à jour pendant la saisie` : on ajoute une entrée de connectique dans le formulaire → un groupe de plus sur la face arrière et une ligne de plus dans le schéma de principe.
  - `câble : dessin et modèle` (impédance, diamètre, longueurs) ; `adaptateur : entrées et sorties`.
- [ ] **Step 2 → Step 4 :** FAIL, implémenter, puis PASS.
- [ ] **Step 5 :** commit `feat(web): catalogue Strata dessiné et panneau Faces et schéma`. Fin du lot 2 : jeux de commandes complets, captures, rapport à Damien.

## Lot 3 : docks de l'éditeur

### Task 9 : bibliothèque glissable (onglet Rack)

**Files :**
- Create : `web/src/strata/library/library-dock.tsx`, `library-item.tsx`, `free-slots.ts`
- Modify : `project-editor.tsx` (`getEditorSlots`, branche rack). En Strata, passer `leftDockTabs=[{id:"outils", label:"Outils", node: leftSidePanel}, {id:"bibliotheque", label:"Bibliothèque", node:<LibraryDock rackId …/>}]`.
- Test :
  - `crates/arkyo-server/tests/rack_slots_catalogue_drop.rs` (nouveau) ;
  - `web/src/strata/library/free-slots.test.ts` ;
  - `web/src/strata/library/library-dock.test.tsx`.

**Interfaces :**
- Consumes :
  - `RackTabDndProvider` et son `DndContext` (`rack/rack-tab-client.tsx:174-322`) ;
  - la charge utile de glissement `{ type: "equipment", equipment, widthFraction }` attendue par `rack-placement-canvas.tsx` `handleDragEnd` (1725) et `placeEquipment` (1128-1166) ;
  - `POST /api/racks/{rackId}/slots { equipmentId, view, startU, heightU, widthFraction, column }`.
- Produces : `freeStartUs(slots, units, heightU, view): number[]`.

- [ ] **Step 1 : test serveur d'abord.** `drop_catalogue_equipment_not_in_bom_creates_bom_line` : `POST /api/racks/{id}/slots` avec un équipement du catalogue absent de la nomenclature du projet → 201, et `GET` de l'inventaire montre la ligne avec quantité 1.
  - **Si le test échoue faute de support serveur : arrêt, et question à Damien** (la spec, §9, l'exige) avant tout changement serveur.
- [ ] **Step 2 : tests front.**
  - `freeStartUs` : rack 42U occupé de U2 à U3 et de U38 à U39, `heightU` 2 → ni U1, ni U2, ni U37, ni U38 ; U4 inclus.
  - `déposer sur un U occupé n'envoie aucune requête et affiche « Pas assez d'U libres à partir de U12 »` (Review Focus 4).
  - `Placer propose les trois premiers U libres` ; choisir → `POST` envoyé avec `startU`.
  - `filtre par recherche, catégorie, signal`.
- [ ] **Step 3 :** FAIL.
- [ ] **Step 4 : implémenter.** Les éléments sont des `useDraggable` dans le `DndContext` existant ; l'aperçu vert ou rouge s'affiche sur les cellules droppables existantes (`rack-visual.tsx:48-53`).
- [ ] **Step 5 :** PASS.
- [ ] **Step 6 :** commit `feat(web): bibliothèque glissable dans l'onglet Rack (Strata)`.

### Task 10 : inspecteur avec face, dock bas, vue Connectique

**Files :**
- Create : `web/src/strata/inspector/equipment-face-card.tsx`, `web/src/strata/bottom/{checks-tab,cables-tab,bilan-tab}.tsx`, `web/src/strata/bottom/rack-validation-input.ts`, `web/src/strata/lenses/connectique-view.tsx`
- Modify : `project-editor.tsx` (`getEditorSlots`). En Strata :
  - `rightPanel` = `<EquipmentFaceCard slot={rackSelectedSlot} canvasData={rackCanvasData} />` au-dessus du panneau existant (rack), et de même pour l'élément sélectionné de l'inventaire via `useInventaireScopeOptional()` ;
  - `bottomDock` = `<BottomDock tabs={[checks, cables, bilan]} />` ;
  - tab Strata `connectique` rendue avec `ConnectiqueView`.
- Note : `_editor/tab-bar.tsx` n'est pas modifié. On n'ajoute pas `"connectique"` à `ProjectTabId` (fichier copié) : la lentille Connectique est un état local Strata (`?lens=connectique` sur l'onglet `rack`), sans nouvel identifiant d'onglet.
- Test : `web/src/strata/bottom/rack-validation-input.test.ts`, `web/src/strata/inspector/equipment-face-card.test.tsx`, `web/src/strata/lenses/connectique-view.test.tsx`

**Interfaces :**
- Consumes :
  - `validateRack(input: ValidationInput): ValidationReport` (`lib/services/rack-validation.ts:123`) ;
  - les données `GET /api/tenant/projects/{id}/racks/{rackId}/canvas-data` (`rack-tab-client.tsx:475`) ;
  - `useTopbarActions().validationReport` et `onSelectValidationIssue` (`topbar-actions-context.tsx:296-310`), pour le synoptique.
- Produces : `toValidationInput(canvasData): ValidationInput`.

- [ ] **Step 1 : tests.**
  - `toValidationInput` : sur un jeu de données de canvas réel (fixture tirée des tests de 4b), `validateRack` renvoie les mêmes `counts` que le jeu attendu.
  - `onglet Contrôles : un clic sur un problème sélectionne le slot en cause` (`refs.slotIds[0]`).
  - `dans le synoptique, le dock lit validationReport du store`.
  - `EquipmentFaceCard : face avec ports reliés, liste des entrées et occupation n/q, clic sur un port → câble et autre extrémité`.
  - `ConnectiqueView : une ligne par équipement, du haut vers le bas, câbles de la face affichée`.
  - `projet sans contenant rackable → EmptyState identique, dock vide` (Review Focus 5).
  - `Bilan : U occupés, puissance face à la capacité des PDU, poids, BTU/h`.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 :** PASS.
- [ ] **Step 5 :** commit `feat(web): inspecteur, dock bas et vue Connectique (Strata)`.

### Task 11 : documentation et règle de projet

**Files :**
- Modify : `CLAUDE.md` (amendement du §3 de la spec, mot pour mot, une fois validé par Damien)
- Modify : `docs/ARCHITECTURE.md` (section « Deux interfaces » : contexte, points d'accroche, `web/src/strata/`)
- Create : `docs/superpowers/plans/2026-11-07-interface-strata-suivi.md` (points reportés, en particulier le branchement du dock Contrôles sur le synoptique de la phase 4c)

- [ ] **Step 1 :** `git rebase main`. Jeux de commandes complets → PASS.
- [ ] **Step 2 :** captures finales en clair et en sombre (spec §9).
- [ ] **Step 3 :** commit `docs: deux interfaces (Classique / Strata)`.
- [ ] **Step 4 :** rapport à Damien. Pas de push sans son accord.
