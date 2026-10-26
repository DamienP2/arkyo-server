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

Les fichiers d'arkyo sont copiés **à l'identique, au même chemin relatif sous `web/src/`** (alias `@/*` → `web/src/*`). On ne modifie un fichier copié que pour retirer ce qui relève du SaaS (tenant, plan, impersonation, support…) ou pour l'habillage Strata ; chaque modification est commentée (`// arkyo-server: <raison>` ou `// arkyo-server: habillage Strata`, `/* … */` en CSS). On ne reformate jamais un fichier copié (pas de prettier) : le diff avec arkyo doit rester lisible.

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
