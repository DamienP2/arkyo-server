# arkyo-server — conception

> Date : 2026-10-26 · Statut : à valider
> Source fonctionnelle : [DamienP2/arkyo](https://github.com/DamienP2/arkyo), **figée** au commit `88b2e4b` (2026-08-28, « Update 28082026 »). Arkyo n'évolue plus pendant le recodage : aucune resynchronisation n'est à prévoir.
> Modèle d'architecture et de distribution : [DamienP2/CG](https://github.com/DamienP2/CG) (Strata Graphics)

## 1. Intention

Arkyo est aujourd'hui un SaaS multi-tenant (Next.js 16, Prisma, Postgres, Redis, serveur WS séparé) de conception, câblage et recette pour l'intégration broadcast et la prestation événementielle.

`arkyo-server` le refait en **application autonome mono-site**, installée et distribuée comme Strata Graphics (CG) : **un seul exécutable par plateforme**, un serveur en **Rust**, l'interface web embarquée, un service natif, une app dans la barre des menus ou la zone de notification, et une mise à jour intégrée depuis les releases GitHub.

**Il s'agit d'un recodage, pas d'une refonte.** L'utilisateur doit retrouver **exactement les mêmes écrans, le même design et les mêmes fonctions** qu'arkyo. Seul ce qui relève du SaaS disparaît.

**Pourquoi.** Pour un usage sur site : une installation sur une machine du site, sans dépendre d'une plateforme centrale, d'un abonnement ou d'une infrastructure Docker/Postgres/Redis.

## 2. Objectifs, non-objectifs, anti-objectifs

### Objectifs
- Parité fonctionnelle et visuelle avec toutes les surfaces **tenant** d'arkyo : `app/(app)/**`, `app/(fullscreen)/**` et les routes `app/api/**` qui les servent (liste au §6).
- Backend entièrement en Rust : plus de Node.js à l'exécution.
- Une seule base **SQLite** embarquée et des fichiers dans un dossier de données.
- Comptes locaux par mot de passe.
- Distribution identique à CG : `.pkg` + `.dmg` universels pour macOS, `.msi` pour Windows x64, `.tar.gz` + `install.sh` (systemd) pour Ubuntu x64, CLI de service, app tray, mise à jour en ligne ou hors ligne avec retour arrière.
- Import d'un tenant existant d'arkyo.

### Non-objectifs
- Multi-tenant, sous-domaines, `proxy.ts`/`lib/subdomain.ts`.
- Supervisor (`app/supervisor`, `app/api/supervisor`), plateforme (`app/platform`, `app/api/platform`), site vitrine (`app/site`).
- Plans, abonnements, paiements, crédits premium, `CreditRule`, downgrade, codes d'adhésion, notes de courtoisie.
- Impersonation, ghost mode, OTP par email.
- Catalogue Arkyo central : propositions, mises à jour en attente (`CatalogPendingUpdate`), `settings/catalog-updates`, synchro, snapshots, visibilité, badge « Arkyo » vs « perso ».
- *(choix du concepteur)* Tickets de support (`app/(app)/support`), propositions et votes de fonctionnalités (`app/(app)/proposals`, `FeatureProposal/Vote/Comment`). Sans plateforme centrale, ils n'ont plus de destinataire.
- *(choix du concepteur)* Pages de développement (`app/dev/**`, `(fullscreen)/dev`, `shell-demo`, mock mailbox, routes `api/dev`).
- Ce qu'arkyo n'a pas encore : IA embarquée, Rentman, Stripe réel.

### Anti-objectifs (échec même si « ça marche »)
- Un écran qui ne ressemble plus à l'original : autre espacement, autre composant, autre libellé, interaction simplifiée.
- Une fonction tenant d'arkyo absente sans être listée dans les non-objectifs.
- Une dépendance d'exécution externe : Node, Postgres, Redis, Docker, ou un service en ligne obligatoire.
- Une logique métier qui diverge entre le front et le serveur (numérotation, validation, longueurs…).

## 3. Contraintes

- Repo : `DamienP2/arkyo-server`, **public**, créé vide. Branche par défaut `main`.
- Nom de l'exécutable : `arkyo-server`. Paquets : `Arkyo-<version>-<plateforme>` (même nommage que `Strata-…` dans CG).
- Le front reste en **React 19 + TypeScript + Tailwind v4 + Radix**, avec les mêmes bibliothèques d'UI qu'arkyo (`@dnd-kit`, `three`/`@react-three/*`, `jspdf`, `exceljs`, `docx`, `pdf-lib` et `html-to-image` via CDN, `react-easy-crop`, `zustand`, `react-hook-form`, `zod`, `lucide-react`, `@phosphor-icons/react`, `next-themes` ou équivalent pour le thème).
- Langues de l'interface : celles d'arkyo (`messages/{fr,en,de,es,it}.json`), avec le même comportement.

## 4. Architecture (décidée)

Calquée sur CG (voir `CG/Cargo.toml`, `CG/crates/cg-server`, `CG/web`, `CG/packaging`, `CG/.github/workflows`).

```
arkyo-server/
  Cargo.toml               # workspace : version unique, profil release (lto thin, strip) comme CG
  crates/
    arkyo-core/            # logique métier pure (port de lib/services) + modèles serde
    arkyo-server/          # binaire `arkyo-server` : axum + tokio, SQLite, auth, API, temps réel, CLI, service, mise à jour
    arkyo-tray/            # app barre des menus / zone de notification (comme cg-tray)
  web/                     # app React (Vite) : port du front d'arkyo
  packaging/               # macos/ windows/ linux/ stamp-version.sh (comme CG)
  .github/workflows/       # ci.yml + release.yml (comme CG)
  docs/                    # INSTALL.md, ARCHITECTURE.md, specs
```

### 4.1 Serveur (`arkyo-server`)
- **axum + tokio**, comme CG. Le front compilé (`web/dist`) est embarqué avec `rust-embed`, avec une copie gzip produite par `build.rs`. Fallback SPA sur `index.html`.
- **SQLite** via `sqlx` (migrations embarquées, mode WAL). Un fichier `arkyo.db` dans le dossier de données.
- **Dossier de données** : même logique que `CG/crates/cg-server/src/paths.rs` (dossier système pour le service, dossier utilisateur sinon), sous le nom « Arkyo ». Il contient `arkyo.db`, `uploads/`, `config.json` et les journaux.
- **Uploads** : `uploads/<folder>/<uuid>.<ext>`, servis sous **les mêmes URL qu'aujourd'hui** (`/uploads/...`), pour que les URL déjà stockées (et importées) restent valides.
- **Port HTTP** par défaut : **8090** *(choix du concepteur : différent de CG, 8080, pour pouvoir installer les deux sur la même machine)*, réglable dans `config.json` et en CLI.
- **CLI** (clap), comme `strata-server` : `arkyo-server [run]`, `service install|uninstall|start|stop|status`, `user add|passwd|list|remove`, `import …` (§8).
- **Mise à jour intégrée** : reprise de `CG/crates/cg-server/src/update.rs` (releases GitHub via `ureq`, vérification sha256, dépôt d'un paquet hors ligne, extraction des `.pkg`/`.msi`/`.tar.gz`, retour automatique à la version précédente si la nouvelle ne démarre pas).

### 4.2 Contrat d'API
- *(choix du concepteur)* **Les chemins et les formats JSON des routes conservées restent identiques** à ceux d'arkyo (`/api/tenant/...`, `/api/projects/...`, `/api/racks/...`, etc.), ainsi que les codes d'erreur et la forme `{ error }`. Le front d'arkyo est donc repris presque sans retouche de ses appels. Le préfixe `tenant` est gardé tel quel pour la parité. On pourra le renommer plus tard.
- Chaque handler suit le même schéma qu'arkyo : vérification de session et de permission → validation du corps (équivalent des schémas Zod, avec `serde` + validation) → écriture SQLite → `AuditLog` → publication d'évènement temps réel → JSON.
- Les **règles métier serveur** (validation de rack, numérotation, longueurs de câble, recette, inventaire, taxonomie, géométrie…) sont portées de `lib/services/*.ts` dans `arkyo-core`. Les **tests Vitest existants de ces services** sont portés en tests Rust avec les mêmes cas.
- Quand un service est utilisé **à la fois** par le front et par le serveur, la version TypeScript reste dans `web/` et la version Rust doit produire les mêmes résultats. Des **fixtures JSON partagées** (entrée → sortie attendue) sont exécutées par Vitest et par `cargo test`, comme CG le fait entre `cg-core` et `web/src/engine`.

### 4.3 Front (`web/`)
- Port du code d'`app/(app)`, `app/(fullscreen)`, `components/`, `lib/` (partie client), `hooks/`, `messages/`, `public/`, `app/globals.css` vers une **SPA Vite**.
- Remplacements imposés par la sortie de Next.js, et rien d'autre :
  - routage App Router → `react-router` avec **les mêmes URL** (`/dashboard`, `/projects/:id`, `/project/:id/inventaire/...`, `/admin/...`, etc.) et les mêmes layouts (`(app)` avec sidebar, `(fullscreen)` sans) ;
  - `next/navigation` (105 imports), `next/link` (20), `next/image` (2), `next/font` (1) → équivalents React Router, `<a>`/`<img>` et police auto-hébergée ;
  - Server Components qui chargent des données → chargement côté client via `lib/api-client.ts` ;
  - `next-auth/react` (session) → hook de session sur `/api/auth/session` ;
  - `next-intl` (3 fichiers) → bibliothèque i18n client lisant les mêmes fichiers `messages/*.json`.
- Composants, styles, classes Tailwind, textes et icônes sont repris **à l'identique**. Les règles de `UI_PATTERNS.md` et du résumé de `CLAUDE.md` d'arkyo s'appliquent (et sont copiées dans le repo).
- Ce qui est propre au SaaS est retiré du front : sélecteur et bannière de tenant, impersonation, ghost mode, bandeau dev, crédits, plan, badges et filtres « Arkyo/perso », bouton de proposition au catalogue, liens vers support et propositions.

### 4.4 Authentification et rôles
- Comptes locaux : identifiant ou email + mot de passe haché en **Argon2** (comme CG). Session par cookie `HttpOnly` stockée en base, qui survit aux redémarrages.
- **Premier lancement** : si aucun utilisateur n'existe, la page d'accueil propose de créer l'administrateur **uniquement si on y accède depuis la machine elle-même** (comme CG). À distance, on passe par `arkyo-server user add`.
- **Rôles** : le modèle RBAC du tenant est conservé tel quel (`TenantRole` : `key`, `label`, `color`, `isOwner`, `isBuiltin`, `permissions` JSON), avec les rôles intégrés `owner`, `chef-projet`, `technicien`, `consultation` et les rôles personnalisés. Les écrans `admin/users` (membres, invitations, rôles) sont conservés. Une invitation devient **la création d'un compte par un admin**, avec un mot de passe temporaire saisi par l'admin (dans l'UI ou `arkyo-server user add`), que l'utilisateur doit changer à sa première connexion. Un admin peut aussi réinitialiser le mot de passe d'un utilisateur de la même façon. Rien ne dépend d'un SMTP *(choix du concepteur)*.
- Profil utilisateur (`app/(app)/profile`) : conservé, avec changement de mot de passe à la place du changement d'email par OTP.

### 4.5 Temps réel
- Dans le même processus axum, sans Redis ni serveur WS séparé :
  - **SSE** `/api/events` (global) et `/api/racks/:id/events` (par rack), mêmes évènements qu'aujourd'hui (`lib/event-bus.ts`, `app-events.ts`, `rack-events.ts`) ;
  - **WebSocket** de présence, curseurs et sélections distantes (protocole de `realtime/server.ts` : rooms, heartbeat 30 s, messages ≤ 4 Ko), authentifié par le cookie de session. Le ticket signé et le port 3001 disparaissent.
- Le panneau **Notifications** in-app est conservé.

### 4.6 Emails
- *(choix du concepteur)* Conservés **seulement si un SMTP est configuré** dans les paramètres (`lettre`). Les templates d'emails d'arkyo (`lib/services/email-template*`) sont repris pour les envois qui ont encore un sens en mono-site (notification d'assignation, etc.). Sans SMTP, aucune fonction ne doit être bloquée.

### 4.7 Catalogue : un seul catalogue local
- Les familles `Catalog*` (base main) et `Tenant*` (base tenant) **fusionnent en un seul jeu de tables** : équipements et composants, câbles et modèles de câble, adaptateurs, marques, connecteurs, signaux, taxonomie Fonction > Type > Sous-type, phases, catégories, symboles, préréglages de dimensions, gabarits d'impression, stocks d'étiquettes, modèles d'export d'impression.
- Tout est éditable par l'admin du site (selon les permissions), avec les écrans actuels de `admin/catalogue`, `admin/parametres`, `admin/equipment`.
- Les catégories système « sanctuarisées » de la taxonomie restent protégées comme aujourd'hui.
- **Données initiales** : **le catalogue est livré vide** (décision de Damien). Seules les structures nécessaires au fonctionnement sont créées à l'initialisation de la base : rôles intégrés, catégories système « sanctuarisées » de la taxonomie, et réglages par défaut (convention de numérotation, etc.), tels que le code d'arkyo les suppose *(choix du concepteur sur le contenu exact)*.
- Sauvegarde/restauration du catalogue (`arkyo-backup` v1, `lib/services/backup.ts`) et import CSV/XLSX (`parametres/import`) conservés. Lecture XLSX côté serveur avec `calamine`.
- **Comportement des projets** *(choix du concepteur, aligné sur arkyo)* : dans arkyo, seuls les éléments du catalogue *Arkyo* sont figés par projet (snapshots). Les éléments du catalogue *perso* sont référencés en direct (`catalogEquipmentId` tenant + `snapshotId` nul). Le catalogue local unique se comporte donc **exactement comme le catalogue perso d'arkyo** : un projet référence l'élément en direct, et une modification du catalogue se répercute sur les projets qui l'utilisent. La logique de snapshot, fusion et visibilité (`catalog-sync-engine`, `catalog-merge`, `catalog-visibility`, `project-snapshot*`, `ProjectCatalogueSnapshot`, `CatalogDefaultSnapshot`, `shadowsArkyo`, `clonedFromArkyo*`) n'est pas portée. Le chemin « main-first puis fallback tenant » devient une lecture directe du catalogue local.
- Aucune mise à jour de catalogue n'est distribuée avec les releases : pas de champs de provenance ni de moteur de fusion.

### 4.8 Exports
- Les exports déjà faits dans le navigateur (PDF jsPDF/pdf-lib, PNG, XLSX, DOCX, CSV, dossier assemblé, PV de recette, cartouche) restent côté client, à l'identique.
- Ceux qui sont faits côté serveur dans arkyo sont portés en Rust avec le même résultat.

## 5. Modèle de données

- Source : `database/tenant/schema.prisma` (70 modèles), plus les tables de `database/main/schema.prisma` qui restent utiles en mono-site : `User`, `UserProfile`, `TenantRole` (renommé à la discrétion du builder), `Notification`, `AuditLog`, la configuration du site, et les familles catalogue fusionnées (§4.7).
- Tables supprimées : `Tenant*` de plateforme (`Tenant`, `TenantJoinCode`, `TenantNote`, `Membership` remplacé par un rôle sur l'utilisateur), `Plan`, `Feature`, `PlanFeature`, `Subscription`, `Payment`, `PaymentSettings`, `ScheduledPlanChange`, `PlanChangeRequest`, `CourtesyExpirationSnapshot`, `UserBilling`, `PremiumCredit`, `CreditRule`, `OtpCode`, `EmailChangeRequest`, `Account`, `VerificationToken`, `Session` NextAuth (remplacé), `UserSession`, `UserNote`, `PlatformEvent`, `PlatformConfig` (les réglages utiles passent dans la config du site), `Collaborator`, `RoleConfig`, `CatalogProposal`, `CatalogPendingUpdate`, `CatalogDefaultSnapshot`, `ProjectCatalogueSnapshot`, `SupportTicket`, `SupportMessage`, `FeatureProposal`, `FeatureVote`, `FeatureComment`.
- Conventions : identifiants `cuid` conservés (texte) pour que l'import garde les ID. Les champs `Json` deviennent du `TEXT` JSON. Les enums deviennent du `TEXT` avec `CHECK`. Les dates sont en ISO 8601. Mêmes règles `ON DELETE CASCADE`/`SET NULL`. Pas de soft delete.
- Les champs JSON sérialisés en chaîne dans arkyo (ex. `RackSlot.notes`) gardent ce format, puisque le front les parse déjà.

## 6. Périmètre fonctionnel à reproduire

Toutes les pages et fonctions tenant d'arkyo, en particulier :
- **Tableau de bord**, **Projets** (liste, création, fiche, tâches, messages, documents, journal d'audit).
- **Éditeur projet plein écran** `/project/:id` et tous ses onglets : fiche, inventaire (emplacements, contenants, accessoires, composants modulaires, assistant d'ajout), élévations de rack (FRONT/REAR/REAR_INTERIOR/SIDE), câblage et numérotation, **synoptique** complet (validation 11 checks, undo/redo, multi-sélection, zones, labels, adaptateurs, bundles, guides, export PNG/PDF), **cartographie 2D/3D**, **dessins** (schémas, implantations vidéo/audio, plan de feu), **réseau** (IP/VLAN, SMPTE 2110, DMX), **préparation/livraison**, **recette** (checklist, statuts, PV PDF), **export dossier** (wizard, modèles de dossier, reprise de la dernière exportation).
- **Racks**, **Rigs/Régies** (éditeur de rack), **Panels** (éditeur plein écran PATCH/ACCESSORY), **Templates**.
- **Admin** : catalogue (équipements, câbles, adaptateurs, nouveaux/édition), taxonomie, connecteurs, signaux, numérotation (standard et personnalisée), paramètres (import, backup, export templates, impression), utilisateurs et rôles. La page **espace** perd tout ce qui concerne l'abonnement et garde le reste (nom, logo, réglages du site).
- **Profil**, **paramètres** utilisateur, **notifications**, sélecteur de langue, thème clair/sombre.
- **Collaboration temps réel** : présence, curseurs, sélections distantes, mises à jour en direct.
- **Système** *(ajout nécessaire à la distribution, dans le style d'arkyo)* : un écran admin « Mises à jour » (version, recherche en ligne, dépôt d'un paquet) et l'adresse d'accès du serveur.

La référence de parité est le code d'arkyo lui-même. En cas de doute, c'est le comportement d'arkyo qui fait foi.

Le verrouillage par plan (`useTenantPlan().canAccess`, FREE/PRO/ENTERPRISE) disparaît : **tout est accessible**, et seules les permissions de rôle s'appliquent.

## 7. Distribution

Reprise de CG, adaptée au nom Arkyo :
- `ci.yml` : clippy + tests Rust sur macOS, Windows et Ubuntu ; build et tests du front.
- `release.yml` sur tag `v*` : build du front, puis binaires `x86_64-unknown-linux-gnu` (Ubuntu 22.04), `x86_64-pc-windows-msvc`, macOS universel (arm64 + x86_64) ; `.msi` WiX avec règle de pare-feu, `.pkg` + `.dmg` avec l'app tray, `.tar.gz` Ubuntu avec `install.sh`/`uninstall.sh` systemd, paquets de mise à jour `Arkyo-<version>-<plateforme>` ; publication en release GitHub avec notes générées. Signature et notarisation macOS si les secrets sont présents (comme CG).
- `packaging/stamp-version.sh` : la version vient du tag.
- Pas de ffmpeg, NDI, DeckLink ni panneau Premiere : ce sont des besoins propres à CG.

## 8. Import d'un tenant arkyo

- `arkyo-server import --tenant-db <postgres-url> --main-db <postgres-url> --uploads <dossier>` *(choix du concepteur : lecture directe des bases, parce que le backup actuel d'arkyo ne contient que le catalogue)*. La commande s'exécute sur une base vide, ou sur demande explicite avec `--replace`.
- La commande reprend toutes les données du tenant (projets et tout leur contenu, racks, rigs, panels, templates, catalogue perso, modèles d'export, recette, audit), les utilisateurs membres du tenant avec leur rôle, et les fichiers uploadés. Comme l'OTP disparaît, chaque utilisateur importé reçoit un **mot de passe temporaire**, affiché une seule fois dans le rapport d'import, et doit le changer à sa première connexion *(choix du concepteur)*.
- Les éléments du catalogue Arkyo **référencés** par les données du tenant sont copiés dans le catalogue local, en conservant leur ID, et les références sont réécrites vers ces copies. Pour un projet, c'est **la version figée du snapshot** qui est copiée, pour que le projet garde l'apparence qu'il avait. Si deux projets figent des versions différentes d'un même élément, chaque version distincte devient un élément local *(choix du concepteur)*.
- Cible : le schéma Postgres d'arkyo au commit `88b2e4b` uniquement.
- Priorité : il n'existe aujourd'hui ni projet ni catalogue à reprendre. Cette phase passe donc en dernier et peut être abandonnée si elle ne sert plus.
- Elle produit un rapport : nombre d'éléments par table, références non résolues.

## 9. Découpage en phases (livrables)

Chaque phase se termine par une release installable et une vérification de parité écran par écran avec arkyo.

**Environnement de référence** *(choix du concepteur)* : arkyo au commit `88b2e4b` tourne en local (son `docker-compose.yml` Postgres + Redis, un tenant de test créé avec ses scripts de seed et un jeu de données de démonstration). La vérification se fait manuellement dans le navigateur, avec des captures avant/après des mêmes écrans sur les mêmes données. Pas de comparaison de captures automatisée en CI.

1. **Socle** : workspace, serveur axum, SQLite et migrations du schéma complet, auth et rôles, coquille du front (layouts, design system, navigation, thème, i18n), embarquement, CLI, service, tray, mise à jour, CI et release.
2. **Catalogue et administration** : catalogue complet, taxonomie, connecteurs, signaux, numérotation, import/backup, impression, utilisateurs et rôles, données initiales.
3. **Projets et bibliothèques** : projets (liste, fiche, tâches, messages, documents, audit), racks, rigs, panels, templates.
4. **Éditeur projet, cœur** : inventaire, élévations rack, câblage et numérotation, synoptique.
5. **Éditeur projet, plans** : cartographie 2D/3D, dessins, réseau.
6. **Livraison** : préparation, recette, exports, dossier, modèles d'export.
7. **Collaboration** : présence, curseurs, sélections, notifications, emails SMTP.
8. **Import d'un tenant**.

## 10. Laissé au builder / à préciser

- Choix précis des crates (`sqlx` vs `rusqlite`, bibliothèque i18n front, etc.), découpage interne des modules, conventions de nommage des tables.
- Le découpage des très gros fichiers (`synoptic-view.tsx` ~14 000 lignes, `carto-plan-canvas.tsx` ~8 000) n'est **pas** requis : on porte d'abord, on refactorise ensuite.
