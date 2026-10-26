# CLAUDE.md : règles de travail pour arkyo-server

`arkyo-server` est le recodage d'arkyo (SaaS) en application autonome mono-site : serveur Rust (axum) + front React embarqué, distribué comme Strata Graphics (CG). Il s'agit d'un **recodage, pas d'une refonte** : mêmes écrans, même design, mêmes fonctions qu'arkyo. Tout est en français (code commenté en anglais ou français selon le fichier existant, UI, docs, commits).

Documents : `README.md`, `docs/INSTALL.md`, `docs/ARCHITECTURE.md`, `UI_PATTERNS.md`, spec `docs/superpowers/specs/2026-10-26-arkyo-server-design.md`, plan de la phase en cours dans `docs/superpowers/plans/`.

## Global Constraints

- Référence fonctionnelle : arkyo au commit `88b2e4b245b3c11bb8e4a8989c83fe98b063582d`. Référence d'architecture : CG au commit `8ad8b56`. Clonés dans `.ref/arkyo` et `.ref/cg` (`scripts/fetch-refs.sh`). `arkyo:<chemin>` / `cg:<chemin>` = fichiers de ces clones.
- Exécutable `arkyo-server`, app tray `arkyo-tray`, service `arkyo-server`, repo de mise à jour `DamienP2/arkyo-server`.
- Paquets : `Arkyo-<version>-macos-universal.pkg|.dmg`, `Arkyo-<version>-windows-x64.msi`, `Arkyo-<version>-ubuntu-x64.tar.gz`. Paquets de mise à jour : `Arkyo-<version>-{macos-arm64,macos-x86_64,windows-x86_64,linux-x86_64}` (`.tar.gz`, `.zip` pour Windows).
- Port HTTP par défaut 8090, bind par défaut `0.0.0.0`.
- Dossier de données : interactif = `directories::ProjectDirs::from("com", "Arkyo", "Arkyo").data_dir()` ; service = `%ProgramData%\Arkyo` (Windows), `/Library/Application Support/Arkyo` (macOS), `/var/lib/arkyo` (Linux). Variable d'environnement `ARKYO_DATA_DIR`.
- Contenu du dossier de données : `arkyo.db` (SQLite, WAL), `config.json`, `uploads/`.
- API : chemins, formes JSON et messages d'erreur identiques à arkyo pour toute route reprise. Erreur = `{ "error": "<message FR>" }` avec le même code HTTP qu'arkyo.
- Base : tables = noms des modèles Prisma (PascalCase), colonnes = noms des champs Prisma (camelCase, entre guillemets). ID = cuid v1 (`cuid::cuid1()`), dates = TEXT ISO 8601 UTC avec millisecondes (`2026-10-26T10:00:00.000Z`), booléens = INTEGER 0/1, JSON = TEXT. Pas de macros `sqlx::query!`.
- Front : les fichiers repris d'arkyo sont copiés à l'identique au même chemin relatif sous `web/src/` (alias `@/*` → `web/src/*`). On ne modifie un fichier copié que pour retirer ce qui relève du SaaS, et chaque retrait est commenté `// arkyo-server: <raison>`.
- Versions npm : celles de `arkyo:package.json` pour toute dépendance reprise.
- Textes UI en français, comme arkyo.
- La phase 1 ne crée que les tables `User`, `UserProfile`, `Role`, `AuthSession`, `Notification`, `AppConfig`. (Chaque phase suivante ajoute, dans une nouvelle migration, uniquement les tables qu'elle consomme.)

## Reprendre un fichier d'arkyo

1. **Copier verbatim** `arkyo:<chemin>` vers `web/src/<chemin>` (même chemin relatif).
2. **Retirer ensuite le SaaS** (tenant, plan, crédits, impersonation, ghost mode, support, propositions, badges « Arkyo/perso », etc., voir les non-objectifs du §2 de la spec), avec un commentaire `// arkyo-server: <raison>` à chaque retrait.
3. **Ne jamais reformater** un fichier copié : pas de prettier, pas de réordonnancement d'imports, pas de renommage « pour faire propre ». Le diff avec arkyo doit ne montrer que les retraits commentés.
4. Les imports Next.js (`next/navigation`, `next/link`, `next/image`, `next-auth/react`, `next-intl`) ne se réécrivent pas : ils passent par les shims de `web/src/shims` (alias Vite et `tsconfig.json`). Compléter un shim plutôt que modifier le fichier copié.
5. Côté serveur, une route reprise garde le chemin, le JSON et les erreurs d'arkyo. Même schéma de handler : session et permission, validation du corps, écriture SQLite, évènement temps réel, JSON.

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

La **phase 1 (socle)** est livrée : les pages d'arkyo non encore reprises affichent le composant `ComingSoon` (`web/src/components/coming-soon.tsx`, branché dans `web/src/router.tsx`). Une phase qui porte une page remplace son `ComingSoon` par la page reprise. Phases suivantes : voir le §9 de la spec.

## Git

- On commite sur `main`, par petits commits, message en français (`feat:`, `fix:`, `docs:`, `build:`…). Ne jamais pousser ni créer de tag sans accord explicite de Damien (la release `v0.1.0` se fait uniquement sur son accord).
- `.gitignore` : `target/`, `web/node_modules/`, `web/dist/`, `.ref/`, `.superpowers/`.
