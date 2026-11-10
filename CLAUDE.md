# CLAUDE.md : règles de travail pour arkyo-server

`arkyo-server` (nom affiché : **Strata Arkyo**) est le recodage d'arkyo (SaaS) en application autonome mono-site : serveur Rust (axum) + front React embarqué, distribué comme Strata Graphics (CG). Il s'agit d'un **recodage, pas d'une refonte**, pour l'interface Classique ; l'interface Strata, activable, refond la présentation sans toucher aux fonctions. L'interface Classique reprend les mêmes écrans, la même ergonomie et les mêmes fonctions qu'arkyo, avec l'habillage Strata (palette, police, logotype). Tout est en français (code commenté en anglais ou français selon le fichier existant, UI, docs, commits).

Documents : `README.md`, `docs/INSTALL.md`, `docs/ARCHITECTURE.md`, `UI_PATTERNS.md`, spec `docs/superpowers/specs/2026-10-26-arkyo-server-design.md`, plan de la phase en cours dans `docs/superpowers/plans/`.

## Global Constraints

> **Deux interfaces.** Strata Arkyo a deux interfaces, choisies dans Administration › Système.
>
> - **Classique** : recodage fidèle d'arkyo. Toutes les règles de ce fichier s'y appliquent sans changement. Une différence de disposition avec arkyo reste un défaut.
> - **Strata** : refonte de la présentation, **pas des fonctions**. Elle vit dans `web/src/strata/`, en code neuf (pas de copie d'arkyo). Elle loge les pages et les éditeurs copiés d'arkyo sans les réécrire. Un fichier copié n'est modifié que par un point d'accroche minimal, commenté `// arkyo-server: interface Strata`, sans aucun effet en Classique.
> - Aucune fonction ne doit manquer dans l'une ou l'autre. La table « Où vit chaque fonction » de `docs/superpowers/specs/2026-11-07-interface-strata-design.md` fait foi et se met à jour à chaque phase.
> - L'API reste celle d'arkyo. Seul le réglage d'interface s'y ajoute.
>
> La phase qui porte une page la rend dans les deux interfaces. En Strata, elle y ajoute au besoin sa présentation.

- Référence fonctionnelle : arkyo au commit `88b2e4b245b3c11bb8e4a8989c83fe98b063582d`. Référence d'architecture : CG au commit `8ad8b56`. Clonés dans `.ref/arkyo` et `.ref/cg` (`scripts/fetch-refs.sh`). `arkyo:<chemin>` / `cg:<chemin>` = fichiers de ces clones.
- Exécutable `arkyo-server`, app tray `arkyo-tray`, service `arkyo-server`, repo de mise à jour `DamienP2/arkyo-server`.
- Paquets : `Arkyo-<version>-macos-universal.pkg|.dmg`, `Arkyo-<version>-windows-x64.msi`, `Arkyo-<version>-ubuntu-x64.tar.gz`. Paquets de mise à jour : `Arkyo-<version>-{macos-arm64,macos-x86_64,windows-x86_64,linux-x86_64}` (`.tar.gz`, `.zip` pour Windows).
- Port HTTP par défaut 8090, bind par défaut `0.0.0.0`.
- Dossier de données : interactif = `directories::ProjectDirs::from("com", "Arkyo", "Arkyo").data_dir()` ; service = `%ProgramData%\Arkyo` (Windows), `/Library/Application Support/Arkyo` (macOS), `/var/lib/arkyo` (Linux). Variable d'environnement `ARKYO_DATA_DIR`.
- Contenu du dossier de données : `arkyo.db` (SQLite, WAL), `config.json`, `uploads/`.
- API : chemins, formes JSON et messages d'erreur identiques à arkyo pour toute route reprise. Erreur = `{ "error": "<message FR>" }` avec le même code HTTP qu'arkyo.
- Base : tables = noms des modèles Prisma (PascalCase), colonnes = noms des champs Prisma (camelCase, entre guillemets). ID = cuid v1 (`cuid::cuid1()`), dates = TEXT ISO 8601 UTC avec millisecondes (`2026-10-26T10:00:00.000Z`), booléens = INTEGER 0/1, JSON = TEXT. Pas de macros `sqlx::query!`.
- Front : les fichiers repris d'arkyo sont copiés au même chemin relatif sous `web/src/` (alias `@/*` → `web/src/*`), puis on retire le SaaS et on applique l'habillage Strata. Chaque modification est commentée `// arkyo-server: <raison>` (retrait) ou `// arkyo-server: habillage Strata` (`/* … */` en CSS).
- Versions npm : celles de `arkyo:package.json` pour toute dépendance reprise.
- Textes UI en français, comme arkyo.
- La phase 1 ne crée que les tables `User`, `UserProfile`, `Role`, `AuthSession`, `Notification`, `AppConfig`. (Chaque phase suivante ajoute, dans une nouvelle migration, uniquement les tables qu'elle consomme.)
- Toute nouvelle table est classée dans `crates/arkyo-server/src/transfer/graph.rs` (un test l'exige).
- Migrations **additives uniquement** : une version plus ancienne (retour arrière, restauration automatique) doit rouvrir la base d'une version plus récente et tolérer ses nouvelles tables et colonnes. Jamais de renommage ni de suppression de table ou de colonne, jamais de colonne `NOT NULL` sans valeur par défaut (voir `docs/ARCHITECTURE.md`).

## Reprendre un fichier d'arkyo

1. **Copier** `arkyo:<chemin>` vers `web/src/<chemin>` (même chemin relatif).
2. **Retirer ensuite le SaaS** (tenant, plan, crédits, impersonation, ghost mode, support, propositions, badges « Arkyo/perso », etc., voir les non-objectifs du §2 de la spec), avec un commentaire `// arkyo-server: <raison>` à chaque retrait.
3. **Appliquer l'habillage Strata** (règles ci-dessous), chaque modification commentée `// arkyo-server: habillage Strata`. Aucune modification de structure, d'ordre, de navigation ni de comportement : seulement couleurs, police, tailles et rayons des contrôles, et textes de marque.
4. **Ne jamais reformater** un fichier copié : pas de prettier, pas de réordonnancement d'imports, pas de renommage « pour faire propre ». Le diff avec arkyo doit ne montrer que les retraits et modifications d'habillage commentés.
5. Les imports Next.js (`next/navigation`, `next/link`, `next/image`, `next-auth/react`, `next-intl`) ne se réécrivent pas : ils passent par les shims de `web/src/shims` (alias Vite et `tsconfig.json`). Compléter un shim plutôt que modifier le fichier copié.
6. Côté serveur, une route reprise garde le chemin, le JSON et les erreurs d'arkyo. Même schéma de handler : session et permission, validation du corps, écriture SQLite, évènement temps réel, JSON.

## Habillage Strata

Spec : `docs/superpowers/specs/2026-10-26-strata-arkyo-design.md`.

- **Nom affiché « Strata Arkyo »** (titres, tray, macOS, MSI). Ne jamais renommer l'exécutable, le service, les dossiers de données, les identifiants de bundle, l'`UpgradeCode`, les paquets `Arkyo-<version>-…` ni les fichiers `assets/icons/arkyo.*`.
- **Palette** : variables CSS de `web/src/app/globals.css` (clair `:root`, sombre `.dark`, `@custom-variant dark` lié à `.dark`). Variables disponibles : `--text-tertiary`, `--border-strong`, `--accent-soft`, `--accent-strong`, `--success[-text]`, `--warning[-text]`, `--danger[-text]`, plus les variables existantes. Texte d'accent sur fond `--muted` : `--accent-strong` (le `--accent` clair y fait ≈ 4,3:1). Contraste ≥ 4,5:1 pour le texte, ≥ 3:1 pour grands textes et icônes, dans les deux thèmes.
- **Couleur d'interface** (fonds, textes, bordures, survols, focus, sélection, liens, types de notification) = variable, jamais en dur ; **couleur métier** (signaux `--arkyo-signal-*`, connecteurs, câbles, rôles `--role-*`, statuts, couleurs de calques/annotations, rendu des plans, PDF et exports, avatars de présence, couleurs choisies par l'utilisateur) = inchangée ; en cas de doute, on la laisse : une couleur métier modifiée à tort est pire qu'un bleu Arkyo résiduel. Chaque modification dans un fichier copié est commentée `// arkyo-server: habillage Strata`.
- **Police** : Inter, embarquée. Logotype : composant `StrataBrand` (`web/src/components/brand`). Icônes « SA » : `tools/make-icons`.
- Un écran habillé garde la disposition d'arkyo : toute différence de disposition avant/après est un défaut.

## Règles d'interface non négociables (arkyo)

Détail dans `UI_PATTERNS.md`. Les règles qui ne se discutent pas :

- Bouton « Ajouter » : **toujours** en pointillés (`border-2 border-dashed`), jamais plein accent/bleu.
- Liste vide : **toujours** le composant partagé `<EmptyState>`, jamais une variante.
- Attente de zone : **toujours** le composant partagé `<LoadingState>`, jamais un texte brut « Chargement… ».
- Brand / Function / Type / Phase : **toujours** un picker modal, jamais un `<select>` déroulant.
- Genre d'un connecteur : **jamais** `♂` / `♀`, écrire `M` / `F` / `N`.
- Pas de hint d'interface inutile (« Auto-rempli, modifiable », « Cliquez pour… »).
- La direction artistique d'arkyo est un vocabulaire disponible, pas un modèle à appliquer : sobriété toujours.

## Commandes de test et de build

```bash
source "$HOME/.cargo/env"
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

cd web && npm test && npx tsc --noEmit && npm run build
```

- Le serveur embarque `web/dist` : lancer `npm run build` avant `cargo build`/`cargo test` pour tester avec le vrai front (sans `web/dist`, une page d'attente est servie et le test gzip est ignoré).
- Développement : `cargo run -p arkyo-server` (http://localhost:8090) et, dans `web/`, `npm run dev` (Vite proxifie `/api` et `/uploads` vers le port 8090).
- Une phase est terminée quand ces trois jeux de commandes passent, que la CI est verte et que la parité écran par écran avec arkyo est vérifiée.

## État actuel

Les **phases 1 (socle)**, **2 (catalogue, paramètres, utilisateurs, espace et profil)**, **3 (tableau de bord, projets et assistant, modèles de contenants et de panels, détail de régie, éditeur de panel)**, **4a (éditeur projet `/project/:id` : coquille, fiche et onglet Inventaire complet)** **4b (onglet Rack : élévations, placement, vue par emplacement, contrôles de construction et exports Rack)** et **4c (onglet Synoptique : vues générale et par lieu, câblage, zones, étiquettes, faisceaux, adaptateurs, ports externes, validation, annuler/rétablir, numérotation et renumérotation, audit, exports)** sont livrées. Les pages d'arkyo non encore reprises affichent le composant `ComingSoon` (`web/src/components/coming-soon.tsx`, branché dans `web/src/router.tsx`) : l'éditeur de rack (`/racks/:rackId`, `/rigs/:id/rack/:rackId`) et les sous-routes `/project/:id/inventaire/{rack/:rackId,synoptique}` jusqu'à la phase 4d, la sous-route `/project/:id/cartographie` (et toute autre sous-route de `/project/:id`) jusqu'à la phase 5, l'onglet « Dossiers » de `/templates` et les éditeurs visuels d'impression jusqu'à la phase 6, ainsi que, sous `admin/*`, la page `/admin` d'arkyo (redirection des anciens liens `?s=…`, non reprise) et toute autre URL `/admin/…` hors des pages d'administration reprises. Dans l'éditeur projet, les onglets des phases 5 et 6 sont des bouchons (en-tête `// arkyo-server: bouchon phase N`). Une phase qui porte une page remplace son `ComingSoon` (ou son bouchon) par la page reprise. Points reportés : `docs/superpowers/plans/2026-11-06-phase-3-suivi.md`, `docs/superpowers/plans/2026-11-06-phase-4a-suivi.md` `docs/superpowers/plans/2026-11-07-phase-4b-suivi.md` et `docs/superpowers/plans/2026-11-08-phase-4c-suivi.md`. L'**interface Strata v2 « Concevoir / Gérer »** (activable dans Administration › Système, réglage par site `ui.interface` ; spec `docs/superpowers/specs/2026-11-09-interface-strata-v2-design.md`, dont le §7 « Où vit chaque fonction » fait foi) est livrée et remplace la v1 à docks : topbar `Projets` · `Catalogue` · `Administration ▾` sans rail, palette ⌘K (objets du site et du projet ouvert, actions), page Projets et catalogue en liste + détail, éditeur d'équipement pleine page ; dans un projet, Concevoir (canevas plein, outils flottants, tiroir de l'objet sélectionné, bandeau de validation, modes Synoptique · Racks · Plan · Lumière · Schémas) et Gérer (Vue d'ensemble, Fiche, Matériel, Câbles et mode tableau, bouchons Réseau · Livraison · Dossier) ; points reportés dans `docs/superpowers/plans/2026-11-09-interface-strata-v2-suivi.md`. Les **sauvegardes** (points de restauration de projet, export / import `.arkyo`, sauvegarde complète du site, CLI `arkyo-server backup` / `restore`) sont livrées dans Administration › Système. Phases suivantes : voir le §9 de la spec.

## Git

- On commite sur `main`, par petits commits, message en français (`feat:`, `fix:`, `docs:`, `build:`…). Ne jamais pousser ni créer de tag sans accord explicite de Damien (la release `v0.1.0` se fait uniquement sur son accord).
- `.gitignore` : `target/`, `web/node_modules/`, `web/dist/`, `.ref/`, `.superpowers/`.
