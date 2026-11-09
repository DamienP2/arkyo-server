# Interface Strata v2 « Concevoir / Gérer » : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** remplacer la présentation Strata v1 (docks) par le modèle « Concevoir / Gérer » de la maquette de synthèse, sans rien changer à Classique ni à l'API.

**Architecture :**
- Mêmes points d'accroche commentés que la v1. `synoptique-tab-client.tsx` s'y ajoute.
- Une nouvelle mise en page `StrataCanvasShell` dispose les emplacements `EditorShellSlots` existants du synoptique et du rack : canevas plein, outils flottants, tiroir, bandeau de validation.
- Les pages « Gérer », Projets et Catalogue sont du code neuf dans `web/src/strata/`, branché sur les routes existantes.
- Le code v1 qui ne sert plus est supprimé.

**Tech Stack :** React 19 + react-router + Tailwind v4, vitest + happy-dom. Rust sans changement, sauf si §5.4 de la spec s'applique.

**Spec :** `docs/superpowers/specs/2026-11-09-interface-strata-v2-design.md`
**Maquette de référence :** https://claude.ai/artifact/M2TE3HREorjMmWpBUFwika. Copie locale : `.superpowers/sdd/2026-11-09-interface-strata-v2/maquette/synthese-toile-gerer.html` (+ `strata.css`, `kit.js`, `catalogue.js`).

## Global Constraints

- Classique : aucun rendu ni test existant modifié.
- Code neuf dans `web/src/strata/`. Fichiers copiés : liste fermée de la spec v1 §5.2, amendée par la spec v2 §5.1 (ajout de `synoptique-tab-client.tsx`). Chaque modification porte `// arkyo-server: interface Strata` ; un bloc ajouté d'un seul tenant porte un seul commentaire en tête. Jamais de reformatage.
- Couleurs d'interface : variables de `globals.css` uniquement. Couleurs métier inchangées.
- Règles arkyo : « Ajouter » en pointillés, `<EmptyState>`, `<LoadingState>`, pickers modaux, genres `M` / `F` / `N`, aucun hint inutile.
- Style : sobre et professionnel, pas de panneaux permanents empilés. Accent réservé à la sélection.
- API : aucune route nouvelle sans accord de Damien (spec §5.4).
- Worktree `/Users/dperpignan/arkyo-server-ui-strata-v2`, branche `ui-strata-v2`. `git rebase main` en début de tâche. Jamais de push, de tag ni de fusion sans accord.
- Fin de chaque tâche : `cd web && npm test && npx tsc --noEmit && npm run build`, puis, en fin de lot, `source "$HOME/.cargo/env" && cargo test --workspace --no-fail-fast && cargo clippy --workspace --all-targets -- -D warnings`. Ne jamais lancer le build web en même temps que les tests cargo.

## Review Focus

1. **Bascule Classique ↔ Strata pendant qu'un projet est ouvert.** Le synoptique ne perd pas sa vue ni son état serveur. Test : tâche 3, `bascule-canvas-shell`.
2. **Sélection puis désélection rapide sur le synoptique.** Le tiroir s'ouvre et se ferme sans scintiller ; Échap le ferme ; il ne se rouvre pas tout seul sur la même sélection après une fermeture manuelle. Test : tâche 4.
3. **Projet sans contenant rackable.** Concevoir › Racks montre l'`EmptyState` existant. Gérer › Matériel et Câbles montrent leur `EmptyState`. Vue d'ensemble reste juste. Test : tâches 5 et 6.
4. **Gros projet (plus de 1 000 câbles).** La liste agrégée des câbles reste utilisable : rendu virtualisé ou paginé, chargement indiqué par `<LoadingState>`, pas de rafale de requêtes à chaque évènement. Test : tâche 6.
5. **Utilisateur en lecture seule.** Le mode tableau des câbles et l'éditeur pleine page n'offrent pas l'édition, comme en Classique. Test : tâches 6 et 8.

---

### Task 1 : topbar v2 et page Projets (lot 1)

**Files :**
- Create : `web/src/strata/shell/topbar-v2.tsx`, `web/src/strata/pages/projects-page.tsx`
- Modify : `app/(app)/app-layout.tsx` (la topbar v2 remplace `StrataTopbar` et `StrataSideNav`), `router.tsx` (`/dashboard` et `/projects` en Strata → `ProjectsPage` via `InterfaceSwitch`)
- Delete : `strata/shell/strata-side-nav.tsx`, `strata/pages/strata-home.tsx`, et leurs tests, après bascule
- Test : `web/src/strata/pages/projects-page.test.tsx`, `web/src/strata/shell/topbar-v2.test.tsx`

**Interfaces :**
- Produces : `TopbarV2` (onglets `Projets` · `Catalogue` · `Administration ▾`, emplacement ⌘K, présence, notifications, langue, thème, profil, badge de rôle — mêmes menus exportés de `topbar.tsx`). `ProjectsPage` : liste (avancement, date, statut, équipe, filtres Prestation / Intégration, recherche, tri) + détail (résumé, compteurs, « Ouvrir dans Concevoir » → `/project/:id?tab=synoptique`, « Ouvrir dans Gérer » → `/project/:id?space=gerer&page=ensemble`), « Nouveau projet » (assistant existant, pointillés).

- [ ] Tests :
  - `topbar v2 : onglets et menus filtrés par permission` ;
  - `toutes les entrées du rail Classique atteignables` (même garde-fou que la v1, par lecture de `sidebar.tsx`) ;
  - `Projets : filtre Prestation/Intégration, ouverture Concevoir et Gérer` ;
  - `compteurs identiques au tableau de bord Classique`.
- [ ] RED → implémenter → GREEN. Suite complète + tsc + build.
- [ ] Commit `feat(web): Strata v2, topbar et page Projets`.

### Task 2 : palette ⌘K (lot 1)

**Files :**
- Create : `web/src/strata/palette/command-palette.tsx`, `palette-sources.ts`
- Modify : `topbar-v2.tsx` (déclencheur)
- Test : `web/src/strata/palette/command-palette.test.tsx`

**Interfaces :**
- Produces : `CommandPalette` avec des sources enfichables. Signature : `registerPaletteSource(id, (q) => PaletteItem[] | Promise<PaletteItem[]>)`, avec `PaletteItem = { group; label; sub?; icon?; run(): void }`. Sources du lot 1 : projets, fiches catalogue, utilisateurs, actions (Nouveau projet, aller à Catalogue / Administration). Clavier : ⌘K ou Ctrl+K, `/`, flèches, Entrée, Échap.

- [ ] Tests : ouverture au clavier, filtrage, Entrée exécute, Échap ferme, source asynchrone avec `<LoadingState>`.
- [ ] RED → GREEN → suite. Commit `feat(web): Strata v2, palette ⌘K`.

### Task 3 : `StrataCanvasShell` et sélecteur Concevoir / Gérer (lot 2)

**Files :**
- Create : `web/src/strata/shell/canvas-shell.tsx`, `space-switch.tsx`, `validation-banner.tsx`, `project-topbar-v2.tsx`
- Modify : `components/editor-shell/editor-shell.tsx` (en Strata : `<StrataCanvasShell {...slots}/>` ; le champ `strata?` devient `{ drawerTop?: ReactNode; mode?: "canvas" | "page" }`), `project-global-topbar.tsx` (topbar v2)
- Delete : `strata/shell/strata-editor-shell.tsx`, `strata-project-topbar.tsx`, `bottom-dock.tsx`, `strata/bottom/rack-bottom-dock.tsx` et ses onglets, `strata/lenses/*` et les accroches v1 correspondantes dans `project-editor.tsx`
- Test : `web/src/strata/shell/canvas-shell.test.tsx`

**Interfaces :**
- Consumes : `EditorShellSlots` ; `useTopbarActions().validationReport` / `onSelectValidationIssue`.
- Produces :
  - `StrataCanvasShell` : canevas plein, `leftToolbar` en barre flottante centrée en haut, `contextualTopbar` replié dans un menu « Options de la vue », `rightPanel` en tiroir (360-420 px) avec `strata.drawerTop` au-dessus, bandeau de validation sous la topbar, `slideOver` conservé.
  - `useStrataDrawer()` : `{ open; setOpen; requestOpen(key) }`. Ouvre sur une nouvelle sélection ; ne rouvre pas après une fermeture manuelle tant que la clé ne change pas.
  - Sélecteur `Concevoir` · `Gérer` dans la topbar projet. `Gérer` → `?space=gerer`.

- [ ] Tests :
  - `canevas plein, outils flottants, tiroir fermé par défaut` ;
  - `bandeau : compteurs du validationReport, clic → liste, clic ligne → onSelectValidationIssue` ;
  - `bascule-canvas-shell` (Review Focus 1) ;
  - `classique : EditorShell inchangé (DOM exact)`.
- [ ] RED → GREEN → suite. Commit `feat(web): Strata v2, Concevoir (coquille canevas)`.

### Task 4 : tiroir du synoptique et du rack, carte Faces, bibliothèque (lot 2)

**Files :**
- Modify : `project/[id]/synoptique/synoptique-tab-client.tsx` (ajout à la liste fermée : alimente `strata.drawerTop` avec la carte Faces de l'équipement sélectionné et appelle `requestOpen` à partir des détails qu'il tient, `:484-507`), `project-editor.tsx` (`getEditorSlots` rack : `strata.drawerTop` = bibliothèque v1 + carte de face de l'emplacement sélectionné ; retrait de `withStrataRack` / `withStrataInventaireFace`)
- Reuse : `strata/inspector/equipment-face-card.tsx`, `strata/library/*`
- Test : `web/src/strata/editor/canvas-drawer.test.tsx`

**Interfaces :**
- Produces : carte Faces avec bouton « Voir dans le rack ». Elle passe en `?tab=rack` sur le rack de l'équipement, via la même logique que `handleTabChange`.

- [ ] Tests :
  - `sélection d'un nœud → tiroir ouvert avec Faces` ;
  - `Échap ferme ; même sélection ne rouvre pas` (Review Focus 2) ;
  - `Voir dans le rack` ;
  - `mode Racks : bibliothèque dans le tiroir, dépôt sur un U libre (charge utile v1 inchangée)` ;
  - `projet sans contenant rackable : EmptyState identique` (Review Focus 3).
- [ ] RED → GREEN → suite, puis cargo (fin de lot 2). Captures Concevoir clair et sombre.
- [ ] Commit `feat(web): Strata v2, tiroir du synoptique et du rack`.

### Task 5 : Gérer › Vue d'ensemble, Fiche, Matériel, bouchons (lot 3)

**Files :**
- Create : `web/src/strata/manage/manage-shell.tsx` (navigation fine + liste + détail), `overview.tsx`, `todo-model.ts`, `fiche-page.tsx`, `materiel-page.tsx`, `stub-page.tsx`, `web/src/strata/advanced/advanced-section.tsx`
- Modify : `project-editor.tsx` (en Strata, quand `space=gerer`, rendre `ManageShell` dans l'éditeur ; commentaire d'accroche)
- Test : `web/src/strata/manage/*.test.tsx`, `todo-model.test.ts`

**Interfaces :**
- Produces :
  - `computeTodo(data): TodoItem[]`, avec `TodoItem = { id; label; detail; severity: "danger" | "warn" | "info"; target: { space: "concevoir" | "gerer"; tab?; page?; objectId? } }`. Sources : `validationReport` s'il existe, équipements sans U (`RackSlot.inventoryItemId` absent), longueurs manquantes (connexions), champs de fiche requis manquants.
  - `AdvancedSection({ kind, summary, children })` : repliée par défaut, mémoire par `kind` (localStorage `strata-advanced-<kind>`), préférence de profil « Toujours afficher » (localStorage `strata-advanced-always`).
  - Pages Réseau, Livraison et Dossier : `ComingSoon` avec le texte de la phase.

- [ ] Tests :
  - `computeTodo` sur une fixture : équipement non placé, longueur manquante, fiche incomplète, rapport de validation ;
  - `Vue d'ensemble : une ligne par domaine, clic → cible` ;
  - `Matériel : groupé par emplacement/contenant, détail avec faces et Avancé replié, Ajouter → assistant existant` ;
  - `AdvancedSection mémorise par kind` ;
  - `sans contenant rackable` (Review Focus 3).
- [ ] RED → GREEN → suite. Commit `feat(web): Strata v2, Gérer (vue d'ensemble, fiche, matériel)`.

### Task 6 : Gérer › Câbles et mode tableau (lot 3)

**Files :**
- Create : `web/src/strata/manage/cables-page.tsx`, `cables-model.ts`, `table-editor.tsx`
- Test : `cables-model.test.ts`, `cables-page.test.tsx`, `table-editor.test.tsx`

**Interfaces :**
- Consumes : `GET /api/racks/{id}/connections` par rack, `GET /api/tenant/projects/{id}/synoptic/general`, la route existante de modification d'une connexion (longueur, numéro). Vérifier son chemin exact dans `rack_connections.rs`.
- Produces : `loadProjectCables(projectId, racks): Promise<CableRow[]>`. Dédoublonne les connexions vues des deux côtés ; un seul rechargement groupé par salve d'évènements (anti-rebond 300 ms).

- [ ] Tests :
  - `agrégation sans doublons` ;
  - `liste virtualisée ou paginée au-delà de 500 lignes` (Review Focus 4) ;
  - `mode tableau : édition d'une longueur, remplissage vers le bas, PATCH envoyé par ligne modifiée` ;
  - `lecture seule : pas d'édition` (Review Focus 5) ;
  - `EmptyState sans câbles`.
- [ ] Mesure : sur une fixture de 1 200 câbles, temps de chargement noté dans le rapport. S'il dépasse 2 s, **stop et question à Damien** (spec §5.4) avant toute route nouvelle.
- [ ] RED → GREEN → suite, puis cargo (fin de lot 3). Captures Gérer clair et sombre.
- [ ] Commit `feat(web): Strata v2, Gérer › Câbles et mode tableau`.

### Task 7 : catalogue liste + détail (lot 4)

**Files :**
- Create : `web/src/strata/pages/catalogue-page.tsx` (onglets Équipements · Câbles · Adaptateurs · Modèles ; liste filtrable + détail en lecture avec faces, schéma, ports, essentiel et `AdvancedSection`)
- Modify : `router.tsx` (en Strata, `/admin/catalogue` → `CataloguePage`) ; les trois list panels (retrait des accroches de grilles v1)
- Delete : `strata/pages/strata-*-grid.tsx`, `strata-card.tsx`
- Test : `catalogue-page.test.tsx`

- [ ] Tests :
  - `liste + détail, filtres, recherche` ;
  - `Modifier → /admin/catalogue/equipment/:id` ;
  - `Nouveau → assistant existant` ;
  - `Modèles : contenants, panels, dossiers atteignables`.
- [ ] RED → GREEN → suite. Commit `feat(web): Strata v2, catalogue liste et détail`.

### Task 8 : éditeur d'équipement pleine page (lot 4)

**Files :**
- Create : `web/src/strata/pages/equipment-editor-layout.tsx` (bandeau des faces `faces-panel`, colonne principale = contenu arkyo existant, colonne d'aperçu : schéma de principe, ports par famille, totaux U / W / kg, « Utilisé dans » ; barre d'actions branchée sur l'autosave et l'historique existants)
- Modify : `admin/equipment/[id]/equipment-editor.tsx` (l'accroche v1 `StrataConnectivityLayout` est remplacée par `EquipmentEditorLayout` autour du contenu ; état d'autosave, `undo` / `redo` et `forceSave` exposés aux props de la mise en page)
- Test : `equipment-editor-layout.test.tsx`

- [ ] Tests :
  - `faces et aperçu suivent form.connectorEntries` ;
  - `barre : état d'enregistrement de useEditorAutosave, Annuler/Rétablir, ⌘S → forceSave` ;
  - `lecture seule : barre sans édition` (Review Focus 5) ;
  - `classique : éditeur inchangé (DOM exact)`.
- [ ] RED → GREEN → suite, puis cargo (fin de lot 4). Captures.
- [ ] Commit `feat(web): Strata v2, éditeur d'équipement pleine page`.

### Task 9 : ⌘K étendu, nettoyage, documentation (lot 5)

**Files :**
- Modify : `palette-sources.ts` (sources du projet ouvert : équipements, câbles, actions Valider / Ajouter du matériel / aller à Concevoir / Gérer)
- Delete : tout fichier v1 resté sans importateur (vérifier avec `tsc` et une recherche d'imports)
- Modify : spec v1 (§6 et §7 marqués « remplacés par la spec v2 »), `docs/ARCHITECTURE.md` (section Deux interfaces), `CLAUDE.md` (« État actuel »)
- Create : `docs/superpowers/plans/2026-11-09-interface-strata-v2-suivi.md`

- [ ] Tests : `palette : sources du projet ouvert` ; tests de routeur couvrant chaque ligne du §7 de la spec v2.
- [ ] Suite complète, cargo, clippy, build. Captures finales clair et sombre (spec §8).
- [ ] Commit `docs: interface Strata v2`. Rapport à Damien ; pas de fusion ni de push sans son accord.
