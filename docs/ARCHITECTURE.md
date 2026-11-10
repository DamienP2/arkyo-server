# Architecture

`arkyo-server` (affiché « Strata Arkyo ») est le recodage d'arkyo (SaaS Next.js / Prisma / Postgres) en application autonome mono-site. Ce document décrit l'organisation du repo ; la conception complète est dans `docs/superpowers/specs/2026-10-26-arkyo-server-design.md`.

```
arkyo-server/
  Cargo.toml          workspace : version unique, profil release
  crates/
    arkyo-core/       logique métier pure (sans E/S)
    arkyo-server/     binaire `arkyo-server` : axum, SQLite, CLI, service, mise à jour
    arkyo-tray/       application barre des menus / zone de notification
  web/                SPA React 19 + Vite + Tailwind v4 (port du front d'arkyo, habillage Strata)
  packaging/          macos/ windows/ linux/ stamp-version.sh
  .github/workflows/  ci.yml, release.yml
  scripts/            fetch-refs.sh, make-icons.sh
  docs/               INSTALL.md, ARCHITECTURE.md, specs et plans
  .ref/               clones de référence (non versionnés)
```

## Les crates

- **`arkyo-core`** : règles métier pures et testables, sans base ni réseau. Phase 1 : hachage et validation des mots de passe (`password`, Argon2), permissions par rôle (`permissions`). Les phases suivantes y portent `lib/services/*.ts` d'arkyo (numérotation, validation de rack, longueurs de câble…).
- **`arkyo-server`** : le binaire. `main.rs` (CLI clap : `run`, `service`, `user`), `config.rs` (`config.json`), `paths.rs` (dossiers de données), `db.rs` (SQLite via `sqlx`, migrations), `users.rs` et `sessions.rs` (comptes, sessions par cookie en base), `http/` (routes axum : auth, profil, notifications, évènements SSE, présence, système), `web.rs` (service de la web app embarquée), `service.rs` (systemd, launchd, Windows SCM), `update.rs` (mises à jour). Tests d'intégration dans `crates/arkyo-server/tests/`.
- **`arkyo-tray`** : icône de statut (démarrer, arrêter, ouvrir, quitter). Elle interroge le serveur par HTTP et démarre ou arrête le service (sur macOS via `sudo -n`, grâce à la règle sudoers du paquet).

## Contrat d'API

Les chemins, les formes JSON, les codes HTTP et les messages d'erreur des routes reprises sont **identiques à ceux d'arkyo**, y compris le préfixe `/api/tenant/...` conservé pour la parité. Une erreur est toujours `{ "error": "<message en français>" }` avec le code HTTP d'arkyo. C'est ce qui permet de reprendre le front d'arkyo presque sans retouche de ses appels (`web/src/lib/api-client.ts`). Une route d'arkyo n'est jamais « améliorée » : si elle est reprise, elle se comporte pareil.

## Le front : copie fidèle et shims Next.js

Les fichiers d'arkyo sont copiés **au même chemin relatif sous `web/src/`** (alias `@/*` → `web/src/*`). On ne modifie un fichier copié que pour retirer ce qui relève du SaaS (tenant, plan, impersonation, support…) ou pour l'habillage Strata ; chaque modification est commentée (`// arkyo-server: <raison>` ou `// arkyo-server: habillage Strata`, `/* … */` en CSS). On ne reformate jamais un fichier copié (pas de prettier) : le diff avec arkyo doit rester lisible.

Arkyo étant en Next.js, ses imports `next/navigation`, `next/link`, `next/image`, `next-auth/react` et `next-intl` sont **redirigés vers des shims** plutôt que réécrits :

- `web/src/shims/next/navigation.ts`, `link.tsx`, `image.tsx`
- `web/src/shims/next-auth-react.tsx`, `next-intl.tsx`

La redirection est faite par les alias de `web/vite.config.ts` (et `web/tsconfig.json` pour TypeScript). Le routage App Router est remplacé par `react-router` avec les mêmes URL (`web/src/router.tsx`). Les pages d'arkyo pas encore reprises affichent `ComingSoon` (`web/src/components/coming-soon.tsx`).

## Base de données et migrations

SQLite (`arkyo.db`, mode WAL) via `sqlx`, sans macros `query!`. Les migrations sont dans `crates/arkyo-server/migrations/` et embarquées dans le binaire (`sqlx::migrate!`) ; elles s'appliquent à l'ouverture de la base.

- Tables = noms des modèles Prisma d'arkyo (PascalCase), colonnes = noms des champs (camelCase, entre guillemets).
- ID = cuid v1, dates = TEXT ISO 8601 UTC avec millisecondes (`2026-10-26T10:00:00.000Z`), booléens = INTEGER 0/1, JSON = TEXT.
- **Règle : chaque phase ajoute ses propres tables**, dans une nouvelle migration (`000N_<phase>.sql`), et seulement celles qu'elle consomme. On ne modifie jamais une migration déjà livrée. La phase 1 crée `User`, `UserProfile`, `Role`, `AuthSession`, `Notification` et `AppConfig` (`0001_socle.sql`).
- **Règle : migrations additives uniquement.** Une version plus ancienne doit pouvoir rouvrir une base migrée par une version plus récente (retour arrière depuis la web app, restauration automatique après trois démarrages ratés, installation d'un paquet plus ancien) : `db::open` ignore les migrations appliquées qu'il ne connaît pas (`set_ignore_missing`). Donc on ajoute des tables et des colonnes (avec valeur par défaut ou NULL), on n'en renomme ni n'en supprime, et le code ne suppose jamais qu'une table ou une colonne inconnue est absente.
- **Règle : toute transaction d'écriture passe par `db::begin_immediate`** (`BEGIN IMMEDIATE` ; côté HTTP, `http::parametres::begin`, qui l'enveloppe). Le verrou d'écriture est pris avant les lectures de garde, et un écrivain concurrent attend jusqu'au `busy_timeout` de 5 s au lieu d'échouer. Jamais `pool.begin()` (`BEGIN DEFERRED`) : le test `write_transactions_use_begin_immediate` (`tests/db.rs`) l'interdit dans `src/`. Seul risque restant : une écriture qui attend plus de 5 s derrière une longue transaction (restauration de sauvegarde, gros import) répond 500 « database is locked ».
- La phase 2 (`0002_catalogue.sql`) crée le catalogue unique (tables `Tenant*`, `CatalogSymbol`, `PrintSettings`, `ExportTemplate`, `AuditLog`) ; l'en-tête de la migration documente l'écart de chaque table avec les modèles `Catalog*` d'arkyo.
- **Référentiels de départ** : `crates/arkyo-server/seeds/*.json`, extraits une seule fois des seeds d'arkyo par `tools/extract-seeds/extract.mjs` (outil non livré, à ne plus relancer : il régénère les ID). `seeds::apply`, appelé par `db::open`, insère une famille jamais seedée dans sa table vide et la note dans `AppConfig` `seeds.applied` : une suppression par l'utilisateur est respectée au démarrage suivant. Seuls `restore-arkyo` et la purge réinsèrent les lignes seedées.

## Sauvegardes, export et import (`transfer`)

Module `crates/arkyo-server/src/transfer/`, routes sous `/api/system/backups/*` et `/api/system/transfer/*` (`http/backups.rs`). Spec : `docs/superpowers/specs/2026-11-07-sauvegardes-design.md`.

- `graph.rs` : le graphe des tables. Chaque table est **classée** (possédée par une racine, référentiel de catalogue, ou exclue) ; `collect` rassemble les lignes d'une racine (projet, contenant, régie ou panel) et de ses dépendances.
- `archive.rs` : le format **`.arkyo`**, un zip (`manifest.json` `format: "arkyo-server-transfer"`, `data.json`, `uploads/<chemin>`), avec contrôle des chemins et de la taille décompressée.
- `import.rs` et `remap.rs` : inspection, puis insertion, remplacement ou copie ; en copie, les identifiants sont régénérés et toutes les références remappées.
- `rows.rs` : lecture et écriture générique des lignes.
- `points.rs` : points de restauration de projet, fichiers `.arkyo` dans `<données>/backups/projects/<projet>/` avec un index `points.json`. Un point ne contient que les lignes (le manifeste liste les fichiers référencés, `uploads`) ; `GET …/download` le reconditionne avec les fichiers actuels de `uploads/` (`archive::repack_with_uploads`). L'empreinte qui évite un point automatique inutile (`state_digest`) ne couvre que les tables possédées et les panels, pas le catalogue.
- **Import** : le point « avant restauration » (projet) ou la copie de sécurité (contenant, régie, panel : `backups/objects/<type>-<id>/`, 10 gardées) est écrit avant `begin_immediate`, pour ne pas bloquer les autres écrivains. Après l'import : évènement de la racine (avec `projectId` pour un projet) puis `rack` `updated` (`rackId`, `projectId`) pour chaque contenant du graphe, ce qu'écoutent les onglets Rack et Synoptique.
- Dernier échec des mécanismes automatiques : `AppConfig` `backups.projects.lastError` et `backups.site.lastError` (`{ at, message }`), effacés au succès suivant, exposés par `GET …/settings/projects` et `GET …/site`.
- `site.rs` : sauvegarde complète du site (`Arkyo-site-<horodatage>.zip`, `format: "arkyo-server-site"`, base copiée par `VACUUM INTO`), planification quotidienne, restauration.
- **Restauration du site** : l'archive vérifiée est déposée en `<données>/restore-pending.zip` ; au démarrage suivant, avant l'ouverture de la base, `apply_pending_restore` déplace les données actuelles dans `before-restore-<horodatage>/`, déplie l'archive et la renomme `restore-applied-<horodatage>.zip`. `restore-in-progress.json` marque l'opération en cours (reprise après un arrêt brutal), `restore-status.json` garde le résultat affiché par l'écran (`restore-failed-<horodatage>.zip` en cas d'échec). `GET …/site` expose la restauration en attente (`pending`), `DELETE …/site/pending` l'annule. Après une restauration réussie seulement, les restes sont purgés (2 `before-restore-*`, 1 `restore-applied-*`, 1 `restore-failed-*`). Une restauration ratée dont les données d'origine ne sont pas toutes revenues écrit `restore-stranded.json` (`{ at, beforeRestore, error }`) : `site::check_not_stranded` (appelé par `apply_pending_restore` au démarrage et par les commandes `backup`, `restore`, `user`) refuse alors toute ouverture de la base (`TransferError::Stranded`) jusqu'à ce que l'administrateur supprime le fichier, et la purge épargne le dossier qu'il nomme.
- Dossier `backups/` : `projects/` (points), `objects/` (copies de sécurité d'import) et `site/` (sauvegardes du site, dossier réglable).
- **Règle : toute nouvelle table est classée dans `transfer/graph.rs`.** Un test l'exige : une table de migration absente de la classification fait échouer `cargo test`.

## Embarquement de `web/dist`

`npm run build` produit `web/dist`. `crates/arkyo-server/build.rs` en fait des copies gzip (dans `OUT_DIR`) et `src/web.rs` embarque le tout dans l'exécutable ; il sert `index.html` en repli SPA pour les chemins hors API. Sans `web/dist`, le serveur compile quand même et sert une page d'explication. Conséquence : **construire le front avant le serveur** pour une release (la CI le fait : job `web`, puis `engine` / `build` qui téléchargent l'artefact `web-dist`).

## Service, tray et mise à jour

- `service.rs` installe le service natif : systemd (`arkyo-server`, compte `arkyo`), launchd (`com.arkyo.server`), service Windows (lancé avec `run --service`, journal dans `<données>/logs/arkyo-server.log`). L'unité systemd et le plist launchd posent `ARKYO_SUPERVISED=1`, qui dit au serveur qu'un gestionnaire de services le relance (sinon : heuristiques `INVOCATION_ID` / `XPC_SERVICE_NAME` pour les installations antérieures).
- `firewall.rs` : sur macOS, autorise le programme dans le pare-feu applicatif (`socketfilterfw --add` / `--unblockapp`, en root, si le pare-feu est actif) ; appelé par `update.rs` sur le nouveau fichier après chaque mise à jour ou retour arrière.
- `update.rs` : vérifie les releases GitHub (`DamienP2/arkyo-server`), extrait `arkyo-server` du paquet, contrôle le SHA-256 et `--version`, garde `arkyo-server.previous`, et revient en arrière si le nouveau programme échoue trois démarrages de suite. Routes sous `/api/system/update`.
- Packaging : `packaging/macos/pkg` (`.pkg`, `.dmg`), `packaging/windows/msi` (WiX 5), `packaging/linux` (`install.sh`, `uninstall.sh`). La version vient du tag (`packaging/stamp-version.sh`).
- CI (`ci.yml`) : web (tests, tsc, build) puis clippy et tests sur Ubuntu, macOS et Windows. Release (`release.yml`) : `cargo test --workspace`, puis paquets des trois plateformes et paquets de mise à jour ; publication sur tag `v*`.

## Clones de référence : `.ref/`

`scripts/fetch-refs.sh` clone (idempotent) les deux dépôts de référence aux commits fixés, dans `.ref/` (ignoré par git) :

- `.ref/arkyo` : référence fonctionnelle, commit `88b2e4b245b3c11bb8e4a8989c83fe98b063582d`. Source des fichiers à copier, de `CLAUDE.md` et de `UI_PATTERNS.md`.
- `.ref/cg` : référence d'architecture (Strata Graphics), commit `8ad8b56`. Source du serveur, du packaging et des workflows.

Arkyo est figé : il n'y a rien à resynchroniser.

## Habillage Strata

Le produit s'affiche « Strata Arkyo » ; seuls les noms affichés changent, jamais les identifiants techniques.

- **Palette** : variables CSS de `web/src/app/globals.css` (clair dans `:root`, sombre dans `.dark`), dont `--text-tertiary`, `--border-strong`, `--accent-soft`, `--accent-strong`, `--success[-text]`, `--warning[-text]`, `--danger[-text]`. `@custom-variant dark` est lié à la classe `.dark`. Les couleurs métier (`--arkyo-signal-*`, `--role-*`, avatars de présence, connecteurs, câbles, couleurs choisies par l'utilisateur) ne bougent pas.
- **Police** : Inter, embarquée (pas de requête externe).
- **Marque** : composant `StrataBrand` (`web/src/components/brand`), titres « Strata Arkyo ».
- **Icônes** : « SA » (Inter ExtraBold, licence OFL) générées par `tools/make-icons` dans `assets/icons/` (les fichiers gardent leurs noms `arkyo.*`).
- **Paquets** : application macOS `/Applications/Strata Arkyo.app` et `Uninstall Strata Arkyo.app` ; MSI Windows (dossier du menu Démarrer « Strata Arkyo », service affiché « Strata Arkyo Server », même affichage via `arkyo-server service install` et dans les métadonnées des exécutables). Le nom du service, la règle de pare-feu, les dossiers et les `UpgradeCode` restent inchangés.

## Deux interfaces (Classique / Strata)

Le site choisit son interface dans Administration › Système. **Classique** est le recodage fidèle d'arkyo ; **Strata** refond la présentation sans toucher aux fonctions ni à l'API. L'interface Strata en place est la **v2 « Concevoir / Gérer »** : spec `docs/superpowers/specs/2026-11-09-interface-strata-v2-design.md`, dont la table « Où vit chaque fonction » (§7) fait foi. La spec v1 (`2026-11-07-interface-strata-design.md`) reste valable pour le réglage, le contexte et la liste fermée des accroches ; ses §6 et §7 (docks, lentilles, grilles) sont remplacés. Suivi : `docs/superpowers/plans/2026-11-09-interface-strata-v2-suivi.md`.

- **Réglage.** Clé `ui.interface` de `AppConfig` (`classique`, défaut quand la clé est absente, ou `strata`). Pas de migration. Comme `site.*`, elle n'entre pas dans l'export de sauvegarde au format arkyo.
  - `GET /api/site` renvoie `{ name, logoUrl, interface }`.
  - `PUT /api/system/interface` `{ "interface": "strata" }` : garde `settings:admin`, évènement `("config", "updated")`, `204`. Toute autre valeur donne `400 { "error": "Interface inconnue." }`.
  - Les sessions ouvertes basculent sans rechargement : `AppSync` rafraîchit à chaque évènement et la coquille relit `/api/site`. Une bascule ne remonte ni la page ouverte ni le canevas de l'éditeur.
- **Contexte.** `web/src/strata/interface-context.tsx` fournit `InterfaceProvider` et `useInterface()` (`"classique"` hors provider) ; le provider pose `data-interface` sur `<html>`, ce qui active le bloc `[data-interface="strata"]` de `globals.css`.
- **Ce que montre Strata v2.**
  - *Hors projet* : topbar 46 px `Projets` · `Catalogue` · `Administration ▾` (mêmes routes et permissions que le rail, pas de barre latérale), palette ⌘K, présence, notifications, langue, thème, profil. Page Projets en liste + détail ; catalogue en liste + détail (équipements, cordons, adaptateurs, modèles) ; éditeur d'équipement pleine page ; pages d'administration d'arkyo dans la coquille.
  - *Dans un projet, deux espaces* portés par l'URL : **Concevoir** (`?tab=synoptique|rack|…`, même stockage local qu'arkyo) pose le canevas sur toute la surface, avec la barre d'outils d'arkyo flottante, un sélecteur de mode (Synoptique, Racks, Plan, Lumière, Schémas), un tiroir à droite pour l'objet sélectionné (carte Faces, bibliothèque en mode Racks) et un bandeau de validation ; **Gérer** (`?space=gerer&page=…&sel=…`) donne des pages liste + détail : Vue d'ensemble (« Ce qu'il reste à faire »), Fiche, Matériel, Câbles (mode tableau), et les bouchons Réseau, Livraison, Dossier. En Gérer, le canevas de Concevoir est démonté.
- **Points d'accroche dans les fichiers copiés.** Liste fermée (spec v1 §5.2, amendée par la spec v2 §5.1), chacun commenté `// arkyo-server: interface Strata` et sans effet en Classique. Toute autre modification d'un fichier copié est refusée en relecture.

| Fichier | Accroche |
| --- | --- |
| `app/(app)/app-layout.tsx` | provider ; en Strata, `TopbarV2` à la place de `Topbar` et pas de `Sidebar`, `<Outlet/>` à la même place (une bascule ne remonte pas la page) ; dernière interface connue si `/api/site` échoue |
| `app/(fullscreen)/fullscreen-layout.tsx` | provider seulement |
| `components/editor-shell/editor-shell.tsx` | canevas monté une fois dans un hôte stable (`useCanvasStage`) ; en Strata, `StrataCanvasShell` avec les mêmes slots ; type `EditorShellSlots` : champ optionnel `strata?: { drawerTop?; mode?: "canvas" \| "page" }` |
| `_editor/project-global-topbar.tsx` | en Strata, `ProjectTopbarV2` (Concevoir · Gérer, menu Vues, ⌘K) avec les mêmes props |
| `project-editor.tsx` | espace Gérer (`ManageShell`) quand `?space=gerer` ; tiroir du mode Racks (`strata.drawerTop`) ; `strata.mode = "page"` pour Inventaire, Préparation, Réseau, Recette ; état d'enregistrement transmis à la topbar ; raccourcis de l'Inventaire coupés en Gérer |
| `synoptique/synoptique-tab-client.tsx` | carte Faces de l'objet sélectionné dans `strata.drawerTop`, ouverture du tiroir à la sélection |
| `components/layout/topbar.tsx` | exports des menus internes (notifications, langue, profil, rôle) |
| `admin/systeme/systeme-page.tsx` | section « Interface » |
| `admin/equipment/[id]/equipment-editor.tsx` | en Strata, `EquipmentEditorLayout` (éditeur pleine page : barre d'actions, bandeau des faces, aperçu, « Utilisé dans ») autour du contenu, en-tête d'arkyo remplacé par la barre |
| `app/globals.css` | bloc `[data-interface="strata"]` et variables `--strata-face-*` (clair et sombre) |

- **Code neuf, `web/src/strata/`.**
  - `shell/` : `TopbarV2` et son modèle de navigation (`nav-model.ts`), `ProjectTopbarV2`, `StrataCanvasShell` (canevas plein, outils flottants, tiroir, `useStrataDrawer`), sélecteurs d'espace et de mode, bandeau de validation, navigation vers les onglets (`tab-nav.ts`), demandes de la palette à l'éditeur (`project-requests.ts`), état d'enregistrement.
  - `manage/` : pages de Gérer, données partagées (`use-manage.ts` : éditeur, `canvas-data`, inventaires, câbles du projet lus une fois par `ManageShell`, rapport de validation noté par projet) et mode tableau des câbles.
  - `pages/` : page Projets, catalogue liste + détail, mise en page de l'éditeur pleine page.
  - `catalogue/` : onglets du catalogue, filtres mémorisés, actions (Dupliquer, Supprimer, suppression groupée) sur les routes d'arkyo.
  - `palette/` : palette ⌘K et ses sources enfichables (`registerPaletteSource`) ; sources du site et du projet ouvert (`project-sources.tsx`).
  - `editor/` : tiroirs du synoptique et du mode Racks ; `library/` : bibliothèque glissable ; `inspector/` : carte de face ; `drawings/` : dessins (faces, schéma de principe, élévation, câble, adaptateur, jauge) ; `bottom/` : modèle et données vivantes d'un contenant (`use-rack-live`) ; `advanced/` : sections « Avancé » et leur mémoire.
  - Couleurs : variables de `globals.css` uniquement ; couleurs métier inchangées.
- **Palette ⌘K.** Montée dans les deux topbars (site et projet). Elle ne lit les données qu'à l'ouverture, par les routes existantes, et seulement quand la page correspondante est permise. Ses navigations passent par la garde des saisies non enregistrées. Dans un projet, les actions qui demandent l'état de l'éditeur (« Valider », « Ajouter du matériel ») posent une demande (`project-requests.ts`) que le bandeau de validation ou l'espace Gérer servent une fois montés : aucune accroche de plus dans les fichiers copiés.
- **Règle de phase.** Une phase qui porte une page la rend dans les deux interfaces, et ajoute au besoin sa présentation Strata. La table §7 de la spec v2 se met à jour à chaque phase ; `web/src/strata/shell/function-map.test.tsx` la relit et vérifie chaque ligne dans l'application.
