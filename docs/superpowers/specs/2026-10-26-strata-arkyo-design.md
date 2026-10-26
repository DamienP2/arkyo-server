# Strata Arkyo — habillage Strata

> Date : 2026-10-26 · Statut : à valider
> S'applique à : `arkyo-server` à partir de la v0.1.0 (phase 1 livrée)
> Référence visuelle : Strata Graphics, `DamienP2/CG` au commit `8ad8b56` (`.ref/cg/web/src/styles.css`, `.ref/cg/web/src/ui/Brand.tsx`, `.ref/cg/assets/icons/`)
> Maquettes validées : `.superpowers/brainstorm/90870-1793020595/content/strata-theme.html` (variante « Clair A ») et `strata-icon-login.html` (icône A)

## 1. Intention

L'application devient **Strata Arkyo**, un module de la famille Strata, au même titre que Strata Graphics. Elle doit **ressembler à un produit Strata** (couleurs, police, contrôles, marque), tout en gardant **exactement l'ergonomie d'Arkyo** : mêmes écrans, mêmes dispositions, mêmes entrées de navigation, mêmes interactions.

Cette décision remplace la règle « même design qu'Arkyo » de la conception initiale (`2026-10-26-arkyo-server-design.md`, §1 et anti-objectifs) **pour l'habillage uniquement**. La règle de parité fonctionnelle et ergonomique reste entière.

## 2. Objectifs, non-objectifs, anti-objectifs

### Objectifs
- **Thème sombre.** Il reprend exactement la palette de Strata Graphics.
- **Thème clair.** Il est dérivé de cette palette (variante « Clair A » : topbar et rail clairs). Le basculement clair/sombre d'Arkyo est conservé.
- **Police et contrôles.** Police **Inter**, embarquée et utilisable hors ligne. Contrôles (boutons, champs, sélecteurs, onglets, badges, cartes, menus, dialogues, infobulles) dessinés selon les règles de Strata.
- **Topbar et rail.** Ils prennent l'allure de Strata, avec les mêmes entrées aux mêmes places qu'Arkyo.
- **Nom affiché « Strata Arkyo ».** Lockup Strata, titre d'onglet, pages d'authentification, app tray, noms affichés des installateurs et de l'app macOS.
- **Icône d'application « SA ».** S blanc et A pervenche, tous deux en Inter 800, sur fond sombre arrondi, dans le style de l'icône S de Strata Graphics.

### Non-objectifs
- Changer l'ergonomie : disposition, navigation, contenu des écrans, comportements.
- Renommer le binaire (`arkyo-server`, `arkyo-tray`), le service (`arkyo-server`, `com.arkyo.server`), les dossiers de données, les noms de fichiers des paquets (`Arkyo-<version>-…`) ou le repo. La v0.1.0 déjà installée doit pouvoir se mettre à jour sans migration.
- La signature « F AudioVisuel » de Strata Graphics : **pas de signature**.
- Les couleurs **métier**, qui gardent leur sens et leurs valeurs : signaux (vidéo `#3654ff`, audio `#7c3aed`, data `#10b981`, distribution `#f59e0b`, alimentation `#ef4444`), rôles, statuts de recette, couleurs de connecteurs et de câbles, couleurs choisies par l'utilisateur.

### Anti-objectifs
- Un écran dont la structure, l'ordre des éléments ou le comportement diffère d'arkyo.
- Un mélange visible des deux styles : composant resté au bleu Arkyo `#3b82f6`/`#3654ff` comme couleur d'interface, police DM Sans résiduelle, lockup « arkyo.io » restant.
- Un thème clair illisible : tout couple texte/fond d'interface doit atteindre un contraste ≥ 4,5:1 (≥ 3:1 pour les grands textes et les icônes).

## 3. Palette

### 3.1 Sombre (Strata Graphics exact)

| Rôle | Valeur |
| --- | --- |
| fond (`bg`) | `#0b0c12` |
| panneau 1 / 2 / 3 | `#12141d` / `#181b26` / `#1f2331` |
| bordure / bordure forte | `#262a3a` / `#323750` |
| texte / secondaire / tertiaire | `#e6e8f2` / `#a3a8bf` / `#8a90ad` |
| accent / accent clair / accent doux | `#8fa3ff` / `#bfcaff` / `rgba(143,163,255,.16)` |
| texte sur accent | `#0b1236` |
| succès / alerte / danger (pastilles) / danger (boutons pleins) | `#22c55e` / `#f5a524` / `#ff3b5c` / `#e11d48` |

### 3.2 Clair (dérivé, validé en maquette)

| Rôle | Valeur |
| --- | --- |
| fond | `#f4f5f9` |
| panneau 1 / 2 / 3 | `#ffffff` / `#f7f8fb` / `#eef0f6` |
| bordure / bordure forte | `#e1e4ee` / `#cdd2e1` |
| texte / secondaire / tertiaire | `#141726` / `#4b5170` / `#6b7190` |
| accent / accent foncé / accent doux | `#4f63e6` / `#3346c9` / `rgba(79,99,230,.10)` |
| texte sur accent | `#ffffff` |
| succès / alerte / danger | `#16a34a` / `#d97706` / `#e11d48` |
| topbar / rail | `#ffffff`, bordure `#e1e4ee` ; icône active `#3346c9` sur accent doux |

### 3.3 Correspondance avec les variables d'Arkyo

L'habillage se fait d'abord en redéfinissant les variables de `web/src/app/globals.css` (`:root` pour le clair, `.dark` pour le sombre) :

| Variable Arkyo | Sombre | Clair |
| --- | --- | --- |
| `--background` | bg | fond |
| `--surface`, `--card` | panneau 1 | panneau 1 |
| `--surface-raised`, `--popover` | panneau 2 | panneau 1 (avec ombre) |
| `--canvas-bg` (synoptique, carto) | panneau 1 | panneau 2 |
| `--muted`, `--secondary`, `--input` | panneau 3 | panneau 3 |
| `--foreground`, `--card-foreground`, `--popover-foreground` | texte | texte |
| `--muted-foreground` | texte secondaire | texte secondaire |
| `--border` | bordure | bordure |
| `--accent`, `--ring` | accent | accent |
| `--accent-foreground` | texte sur accent | texte sur accent |
| `--primary` / `--primary-foreground` | accent / texte sur accent | accent / texte sur accent |
| `--destructive` / `--destructive-foreground` | `#e11d48` / blanc | `#e11d48` / blanc |
| `--rail-bg`, `--rail-icon`, `--rail-icon-active`, `--rail-active-bg` | bg, tertiaire, texte, accent doux | blanc, tertiaire, accent foncé, accent doux |
| `--arkyo-blue*` (accent de marque) | accent | accent |

Les variables métier (`--arkyo-signal-*`, `--role-*`) ne changent pas.

## 4. Typographie et formes

- **Police.** Inter (SIL OFL 1.1), auto-hébergée comme dans Strata. On reprend les fichiers `woff2` sous-ensemble de `.ref/cg/web/src/fonts/` (400, 500, 600, 700, 800) et leur `@font-face`, y compris le second jeu `unicode-range` pour le reste d'Inter si Strata l'utilise. `--font-sans` pointe sur Inter. La police mono suit celle de Strata (`ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, …`). La police serif (Instrument Serif), utilisée comme police de contenu dans les éditeurs, est conservée.
- **Taille de base.** 13 px pour l'interface, avec l'échelle de Strata (11, 12, 13, 15, 20 px), sans texte sous 11 px. Les tailles exprimées dans les composants Arkyo restent celles d'Arkyo quand elles relèvent de la mise en page. On ne change que la taille de base et les styles de contrôles.
- **Formes.** Rayon 8 px pour les panneaux, cartes et boutons, 6 px pour les champs. Contrôles de 32 px (28 px en mode dense). Zones cliquables d'au moins 28 px. Bordure de 1 px et focus en bordure accent, comme dans Strata.
- **Boutons.**
  - Le primaire est plein accent, avec le texte sur accent.
  - Le secondaire a un fond panneau 2 et une bordure forte.
  - Le danger est plein `#e11d48`.
  - Le bouton « Ajouter » en pointillés d'Arkyo est conservé (règle UI d'Arkyo), aux couleurs Strata : bordure forte en pointillés, texte secondaire.

## 5. Marque

- **Lockup** (composant à porter depuis `.ref/cg/web/src/ui/Brand.tsx` et ses styles `.brand*`), sans signature :
  - « **Strata** » en Inter 800, 16 px, interlettrage −0,035 em, couleur texte (blanc en sombre, `#141726` en clair) ;
  - « **Arkyo** » en Inter 400, interlettrage −0,02 em, couleur accent ;
  - en version « empilée » sur les pages d'authentification : 40 px, centré.
- **Topbar.** Le lockup remplace « monogramme + arkyo.io ». Le nom du site (`/api/site`) reste affiché après un séparateur, comme aujourd'hui.
- **Titre d'onglet.** « Strata Arkyo » ou « Strata Arkyo | <page> » (`index.html`, `usePageTitle`).
- **Icône « SA »** (variante A validée) : fond `#141724` arrondi comme l'icône de Strata, S blanc et A `#8fa3ff`, tous deux Inter 800, interlettrage serré. Elle est déclinée en :
  - `assets/icons/arkyo.ico`, `arkyo.icns`, `arkyo-1024.png`, `arkyo-macos-1024.png` et `uninstall-macos-1024.png` (badge de désinstallation comme aujourd'hui) ;
  - `installer-background.png` aux couleurs Strata ;
  - favicon `web/public/favicon.svg` ;
  - icônes de barre des menus : `tray-template-44.rgba` (« SA » noir sur transparent, image gabarit macOS) et `tray-color-64.rgba`.

  Les fichiers d'icônes **gardent leurs noms** pour ne pas toucher au packaging. L'outil `tools/make-icons` est adapté pour dessiner « SA » à partir d'Inter 800.

## 6. Nom affiché

« Strata Arkyo » remplace « Arkyo » et « arkyo.io » partout où c'est **affiché** :

- **Front** : lockup, titres, pages `/auth*`, textes qui citent le produit (« Ouvrir Strata Arkyo », etc.).
- **App tray** : titre, entrées de menu (« Ouvrir Strata Arkyo »), alertes.
- **Packaging macOS** : `Info.plist` (`CFBundleName` et `CFBundleDisplayName` = « Strata Arkyo »), titre du `Distribution.xml`, nom de l'app installée (`/Applications/Strata Arkyo.app` et « Désinstaller Strata Arkyo »), textes de l'installateur.
- **Packaging Windows** : `Package Name`, `Manufacturer` (« Strata »), description (à corriger : la description actuelle « serveur de gestion de projets et d'équipes » est fausse), raccourcis du menu Démarrer.
- **Documentation** : README, INSTALL et ARCHITECTURE (titres et textes, pas les noms de commandes).

Le changement du nom de l'app macOS (`Arkyo.app` → `Strata Arkyo.app`) impose que le `preinstall` et le désinstalleur retirent aussi l'ancien `/Applications/Arkyo.app`. Le chemin du serveur (`/usr/local/arkyo/arkyo-server`) et la règle sudoers ne changent pas.

## 7. Couleurs écrites en dur dans les composants copiés

Les composants copiés d'arkyo contiennent environ 1 700 classes Tailwind de couleur (`bg-blue-500`, `text-zinc-400`…) et 1 100 couleurs hexadécimales. Règle :

- **Couleur d'interface** (fond, texte, bordure, survol, focus, accent de sélection) : remplacée par la variable correspondante, avec le commentaire `// arkyo-server: habillage Strata`.
- **Couleur métier** (signaux, connecteurs, câbles, rôles, statuts, couleurs de calques ou d'annotations, rendu des plans, des PDF et des exports) : **inchangée**.
- En cas de doute, on la laisse : une couleur métier modifiée à tort est pire qu'un bleu Arkyo résiduel.

Cette règle étend celle de `CLAUDE.md` : un fichier copié peut désormais être modifié pour l'habillage Strata, chaque modification étant commentée. `CLAUDE.md` et `docs/ARCHITECTURE.md` sont mis à jour en ce sens, et les phases suivantes appliquent l'habillage au moment où elles copient leurs fichiers.

En phase 1, seuls les fichiers déjà copiés sont concernés : design system, layout, auth, Système, présence, notifications.

## 8. Vérification

- Captures avant/après, en clair et en sombre, de : connexion, premier lancement, changement de mot de passe, coquille avec « Bientôt disponible », panneau de notifications, sélecteur de langue, page Système.
- Comparaison à côté de Strata Graphics (`.ref/cg/docs/screenshots/home.png`) pour la topbar, les boutons et les champs.
- Contrastes du thème clair vérifiés (≥ 4,5:1 pour le texte).
- Le `.pkg` et le `.msi` construits par la CI affichent « Strata Arkyo » et la nouvelle icône.

## 9. Décisions du concepteur (après relecture)

1. **Police des icônes.** `tools/make-icons` dessine « SA » avec `Inter-ExtraBold.otf`, copié de `.ref/cg/assets/fonts/` vers `tools/make-icons/fonts/` avec `OFL.txt`. Le woff2 ne convient pas : resvg/fontdb lisent l'OTF.
2. **Périmètre du balayage de la phase 1** : les fichiers déjà copiés uniquement, soit 87 classes Tailwind de couleur dans 13 fichiers et 5 couleurs hexadécimales (mesuré sur `web/src`, hors shims). « Fini » veut dire qu'aucune couleur d'interface Arkyo ne reste dans ces fichiers. Les couleurs métier restantes sont listées dans le rapport.
3. **Cas ambigus.**
   - **Couleurs métier conservées** : rôles (`--role-*`), palette d'avatars de présence, couleurs de signaux.
   - **Couleurs d'interface, à faire suivre la palette** :
     - types de notification : info → accent, succès → succès, alerte → alerte, erreur → danger ;
     - sélection, focus et survol → accent ou accent doux ;
     - liens → accent.
4. **Contraste du thème clair.** La palette du §3.2 est ajustée là où elle échoue à 4,5:1. Le rendu reste celui de la maquette validée :
   - texte tertiaire `#5f6584` au lieu de `#6b7190` (5,0:1 sur panneau 3) ;
   - succès `#15803d` et alerte `#b45309` quand ils servent de texte (5,0:1 sur blanc) ;
   - `#16a34a` et `#d97706` restent pour les pastilles et les fonds doux.

   Le sombre est conforme tel quel : l'accent sur panneau 3 atteint 6,6:1, et le texte sur accent 7,7:1.
5. **Autorité pour les contrôles non détaillés au §4** (dialogues, menus, infobulles, onglets, badges) : `.ref/cg/web/src/styles.css`.
   - Les onglets d'Arkyo prennent l'allure des `.tabs` et segmentés de Strata.
   - Les badges prennent l'allure des pastilles de Strata (fond doux, texte de la couleur).
   - Le mode dense (28 px) de Strata n'est **pas** exposé.
6. **Taille de base.** Seule la taille du `body` passe à 13 px, avec la hauteur et le rayon des contrôles. L'échelle Tailwind (`text-sm`, `text-base`…) n'est **pas** remappée, pour ne pas déplacer la mise en page. Les captures avant/après tolèrent un décalage de quelques pixels dû à la police, pas un changement de disposition.
7. **Packaging, sans migration.**
   - **Windows** : `UpgradeCode` inchangé, dossier d'installation `Arkyo` inchangé. Seuls `Package Name`, `Manufacturer`, la description et les libellés changent. Une installation v0.1.0 se met donc à jour par-dessus.
   - **macOS** : les identifiants de bundle (`com.arkyo.*`), le label launchd et le LaunchAgent du tray ne changent pas. Le `preinstall` quitte le tray et supprime l'ancien `/Applications/Arkyo.app` et l'ancien désinstalleur. Le désinstalleur gère les deux noms.
   - **Mise à jour intégrée** : elle ne remplace que le binaire serveur (chemin inchangé). Elle n'est pas concernée.
8. **Icônes de barre des menus.** `tray-template-44.rgba` : « SA » en noir sur transparent, Inter 800, sans fond (image gabarit). `tray-color-64.rgba` : la tuile complète de l'icône d'application (fond sombre arrondi, S blanc, A pervenche).
9. **Vérification.**
   - **Captures « avant »** : prises sur le `main` actuel (v0.1.0), avec une base neuve pour les pages `/auth*`.
   - **Captures « après »** : prises sur le résultat.
   - **Contrôle des paquets** : nécessite un push et la CI (Release en `workflow_dispatch`), à lancer sur accord de Damien.

## 10. Données de départ fournies (à traiter en phase 2, hors de ce chantier)

Damien a fourni trois fichiers exportés du SaaS (`~/Downloads`) :
- `arkyo-sauvegarde-2026-10-26.json` (`arkyo-backup` v1, catalogue perso : 68 équipements et les réglages) ;
- `catalogue-equipements-2026-10-26.csv` ;
- `connectique-2026-10-26.csv`.

Ils **remplacent la décision « catalogue livré vide »** (conception initiale §4.7) : ils serviront de catalogue de départ. La sauvegarde référence par identifiant des éléments du catalogue central d'Arkyo (connecteurs, fonctions, marques, catégories) qu'elle ne contient pas. Les CSV portent ces noms en clair, et le catalogue local sera reconstruit en combinant les deux. Les images référencées ne sont pas incluses. Ce travail relève de la phase 2 et de son propre plan.
