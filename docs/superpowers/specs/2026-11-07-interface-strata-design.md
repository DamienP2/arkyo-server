# Strata Arkyo : interface Strata activable

> Date : 2026-11-07 · Statut : à valider par Damien
> Branche : `ui-strata` (worktree séparé), rebasée régulièrement sur `main`
> Maquette de référence : « Strata Arkyo Plateau-Atelier » (https://claude.ai/artifact/P6UbrhCa5WZqiGGugjvBSV), issue des quatre propositions UI/UX du 7 novembre (concepts Plateau et Atelier retenus)

## 1. Intention

Damien veut la nouvelle interface dans l'application, sans perdre l'ancienne : « intègre la nouvelle maquette en gardant dans système la possibilité de revenir à l'ancienne (en gros des thèmes qu'on peut activer ou non) ».

L'application a donc **deux interfaces** sur les mêmes pages, les mêmes éditeurs, les mêmes URL et la même API :

- **Classique (arkyo)** : l'application actuelle, inchangée (recodage fidèle d'arkyo avec l'habillage Strata).
- **Strata** : la présentation de la maquette Plateau-Atelier. Elle reprend la coquille de Strata Graphics : topbar à onglets segmentés, barre latérale de bibliothèque, éditeur projet en docks. Elle ajoute des représentations graphiques (faces d'équipement, schémas de principe, câbles et adaptateurs dessinés) et le glisser-déposer depuis une bibliothèque.

C'est l'option B du comparatif : une nouvelle coquille qui **loge les éditeurs d'arkyo sans les réécrire**.

## 2. Objectifs, non-objectifs, anti-objectifs

### Objectifs
- Un réglage **« Interface »** dans Administration › Système : `Classique (arkyo)` / `Strata`. Le basculement est immédiat pour toutes les sessions ouvertes.
- En Strata, **toutes les fonctions** de la version Classique restent atteignables (§7). Aucune route n'est retirée.
- Les éditeurs (inventaire, rack, synoptique et les suivants) s'affichent en Strata **sans copie ni réécriture** : seule leur disposition change.
- Style professionnel et sobre : dessins techniques à traits fins, couleur de signal en simple repère, accent réservé à la sélection. Pas d'illustration décorative.

### Non-objectifs
- Changer l'API, les formes JSON ou les messages d'erreur d'arkyo. La seule exception est le réglage d'interface (§4).
- Un choix d'interface par utilisateur. Il n'est pas prévu dans cette version, mais le stockage le permet plus tard (§4.3).
- Réécrire les pages d'administration (paramètres, utilisateurs, espace) : en Strata, elles s'affichent telles quelles dans la nouvelle coquille.
- Porter des fonctions pas encore reprises (cartographie, dessins, réseau, livraison, dossier) : elles restent des bouchons dans les deux interfaces, jusqu'à leur phase.

### Anti-objectifs (échec même si « ça marche »)
- Une fonction atteignable en Classique et introuvable en Strata, ou l'inverse.
- Un changement visible en Classique : disposition, comportement ou test modifiés.
- Un fichier copié d'arkyo réécrit pour Strata, au lieu d'un point d'accroche minimal.
- Un rendu « enfantin » : aplats colorés, icônes en couleur vive, courbes épaisses, tuiles arrondies partout.

## 3. Règle de projet : amendement proposé de `CLAUDE.md`

Texte proposé, à ajouter sous « Global Constraints » et dans l'introduction (à valider mot pour mot) :

> **Deux interfaces.** Strata Arkyo a deux interfaces, choisies dans Administration › Système.
>
> - **Classique** : recodage fidèle d'arkyo. Toutes les règles de ce fichier s'y appliquent sans changement. Une différence de disposition avec arkyo reste un défaut.
> - **Strata** : refonte de la présentation, **pas des fonctions**. Elle vit dans `web/src/strata/`, en code neuf (pas de copie d'arkyo). Elle loge les pages et les éditeurs copiés d'arkyo sans les réécrire. Un fichier copié n'est modifié que par un point d'accroche minimal, commenté `// arkyo-server: interface Strata`, sans aucun effet en Classique.
> - Aucune fonction ne doit manquer dans l'une ou l'autre. La table « Où vit chaque fonction » de `docs/superpowers/specs/2026-11-07-interface-strata-design.md` fait foi et se met à jour à chaque phase.
> - L'API reste celle d'arkyo. Seul le réglage d'interface s'y ajoute.
>
> La phase qui porte une page la rend dans les deux interfaces. En Strata, elle y ajoute au besoin sa présentation.

L'introduction (« Il s'agit d'un recodage, pas d'une refonte ») devient : « Il s'agit d'un recodage, pas d'une refonte, pour l'interface Classique ; l'interface Strata, activable, refond la présentation sans toucher aux fonctions. »

## 4. Réglage d'interface

### 4.1 Stockage
- Clé `ui.interface` dans la table `AppConfig` existante, avec la valeur `classique` ou `strata`. Une clé absente vaut `classique`.
- Pas de migration. La clé fait partie de la base : elle survit aux sauvegardes et restaurations de la base entière. Comme `site.*`, elle n'entre pas dans l'export de sauvegarde au format arkyo (catalogue et numérotation), dont le format reste identique à arkyo. Une version plus ancienne ignore la clé, conformément à la règle des migrations additives.

### 4.2 API (seul ajout côté serveur)
- `GET /api/site` renvoie en plus `"interface": "classique" | "strata"`. La route reste authentifiée et n'exige aucune permission ; la coquille la lit déjà au démarrage (`loadShell()`).
- `PUT /api/system/interface` avec `{ "interface": "strata" }` :
  - garde `settings:admin`, comme les autres routes `/api/system` ;
  - écrit `ui.interface` en upsert et publie l'évènement `("config", "updated")` ;
  - répond `204` ;
  - une valeur inconnue renvoie `400 { "error": "Interface inconnue." }`.
- Les sessions ouvertes basculent sans rechargement. `AppSync` appelle `router.refresh()` à chaque évènement, et `useShellGate` relit alors `/api/site`.

### 4.3 Pourquoi par site
- Damien place le réglage « dans Système » : c'est un choix d'administrateur.
- Une équipe en prestation voit la même application que son chef de projet : captures, consignes et dossier restent cohérents.
- Un réglage par utilisateur pourra s'ajouter plus tard (clé dans `UserProfile` ou dans les préférences, prioritaire sur le site) sans rien casser.

### 4.4 Page Système
- Nouvelle section « Interface » en tête de la page, avec un contrôle segmenté `Classique (arkyo)` / `Strata` et un texte d'une ligne qui décrit chaque choix.
- Un changement passe par `useConfirm()`. Le toast de confirmation indique que l'interface change pour tous les utilisateurs.

## 5. Architecture front

### 5.1 Contexte d'interface
- `web/src/strata/interface-context.tsx` fournit `InterfaceProvider` et `useInterface()`, qui renvoie `"classique"` ou `"strata"` (`"classique"` hors provider).
- La valeur vient de `ShellGate`, enrichi d'un champ `interface` lu dans `/api/site`. Le provider pose `data-interface` sur `<html>`.
- Les deux layouts (`app-layout.tsx`, `fullscreen-layout.tsx`) enveloppent leur contenu dans ce provider.

### 5.2 Points d'accroche dans les fichiers copiés (liste fermée)
Chacun est commenté `// arkyo-server: interface Strata` et n'a aucun effet en Classique.

| Fichier | Accroche |
| --- | --- |
| `app/(app)/app-layout.tsx` | `interface === "strata"` → `StrataTopbar` et `StrataSideNav` à la place de `Topbar` et `Sidebar`, dans la même coquille : `<main id="main-content"><Outlet/></main>` garde sa place, une bascule en direct ne remonte pas la page ; un échec passager de `/api/site` garde la dernière interface connue |
| `app/(fullscreen)/fullscreen-layout.tsx` | `InterfaceProvider` seulement |
| `components/editor-shell/editor-shell.tsx` | en Strata, délègue la disposition à `<StrataEditorShell {...slots}/>` (mêmes slots) |
| `_editor/project-global-topbar.tsx` | en Strata, rend `<StrataProjectTopbar>` avec les mêmes props |
| `components/layout/topbar.tsx` | `export` des menus internes (notifications, langue, profil, badge de rôle) pour que la topbar Strata les réutilise |
| `admin/systeme/systeme-page.tsx` | section « Interface » (§4.4) |
| `admin/equipment/[id]/equipment-editor.tsx` | en Strata, panneau « Faces et schéma » au-dessus de l'onglet Connectique |
| `project-editor.tsx` (`getEditorSlots`) | en Strata : onglet Bibliothèque du dock gauche (rack), face de l'équipement dans l'inspecteur (rack et inventaire), dock bas (§6.3), vue Connectique ; état d'enregistrement transmis à la topbar Strata (enrobage de `globalTopbar`) |
| `app/globals.css` | bloc `[data-interface="strata"]` (`--rail-width`, `--topbar-height`) et variables `--strata-face-*` |
| `admin/catalogue/_components/{equipment,cables,adapters}-list-panel.tsx` | en Strata et en vue grille, rendu des grilles dessinées |
| `components/editor-shell/editor-shell.tsx` (type) | champ optionnel `strata?: { leftDockTabs; bottomDock }` dans `EditorShellSlots` |

Toute autre modification d'un fichier copié est refusée en relecture.

### 5.3 Code neuf (`web/src/strata/`)
- `shell/` : `StrataTopbar`, `StrataSideNav`, `StrataProjectTopbar`, `StrataEditorShell`, `BottomDock`.
- `drawings/` : composants React des dessins techniques, portés de la maquette (`catalogue.js`) et alimentés par les vraies données du catalogue :
  - `EquipmentFace` (face avant/arrière à l'échelle, ports groupés par entrée de connectique, pictogrammes de `ConnectorIcon`, ports reliés, survol, sélection) ;
  - `BlockDiagram` (schéma de principe) ;
  - `CableDrawing` ;
  - `AdapterDrawing` ;
  - `RackElevation` (élévation avec repères nommés, réutilisée pour la vue Connectique et les vignettes).
- `pages/` : `StrataHome` (accueil) et `StrataCatalogue` (vues graphiques du catalogue).
- `library/` : `LibraryDock`, la bibliothèque glissable.
- Couleurs : uniquement des variables de `globals.css`. Les nouvelles variables `--strata-face-*` (châssis, encre, trait) sont définies en clair et en sombre. Les couleurs métier (signaux, statuts) sont inchangées.

## 6. Ce que montre l'interface Strata

### 6.1 Coquille générale (lot 1)
- **Topbar 46 px** façon Strata Graphics, de gauche à droite :
  - lockup, puis nom du site ;
  - onglets segmentés : `Projets` · `Modèles` · `Catalogue` · `Administration ▾`, filtrés par les mêmes permissions que le rail ;
  - les onglets de page (`useTopbarTabs`) dans un second groupe segmenté ;
  - à droite : présence, thème, notifications, langue, badge de rôle, profil.
- **Barre latérale de bibliothèque**, 240 px, à la place du rail. Elle montre les sections de l'onglet actif :
  - Projets → Tableau de bord, Prestation, Intégration ;
  - Modèles → Contenants, Panels, Dossiers ;
  - Catalogue → une entrée Catalogue, puis Référentiels (renvoi vers Paramètres) ; les onglets Équipements, Cordons et Adaptateurs restent ceux de la page, dans la topbar (`useTopbarTabs`) ;
  - Administration → Espace, Utilisateurs, Paramètres, Système.
- Les pages existantes s'affichent dans la zone principale. `--rail-width` vaut 240 px et `--topbar-height` 46 px dans la coquille Strata, pour que les en-têtes fixes (`AdminTabLayout`) restent à leur place.

### 6.2 Éditeur projet (lot 1, puis lot 3)
- **`StrataProjectTopbar`** :
  - lockup, « PROJET / nom », onglets `Conception` · `Inventaire` · `Livraison` ;
  - boutons `Fiche` (dialogue des caractéristiques et panneau d'informations existants) et `Dossier` (export existant) ;
  - présence, état d'enregistrement.
  - Les mêmes `ProjectTabId` sont utilisés, avec le même `?tab=` et le même stockage local :
    - `Conception` ouvre la barre de lentilles : Rack, Synoptique, Schémas, Plan, Vidéo, Audio, Lumière, Réseau (avec leurs sous-onglets existants) et, en Strata seulement, Connectique ;
    - `Livraison` regroupe Préparation et Recette.
- **`StrataEditorShell`**, avec les mêmes slots que `EditorShell` :
  - dock gauche : barre d'outils + panneau latéral existant, avec un onglet « Bibliothèque » en rack ;
  - canevas au centre, sous la barre contextuelle existante ;
  - inspecteur à droite (le `rightPanel` existant, largeur du store) ;
  - dock bas repliable.
- **Lot 3 :**
  - *Bibliothèque* (onglet Rack) : catalogue filtrable par recherche et par catégorie et signal, chaque élément avec sa face arrière en miniature.
    - On le glisse sur un U libre. On réutilise le `DndContext` de `RackTabDndProvider` et le même placement `POST /api/racks/{rackId}/slots`. Le serveur ajoute la ligne de nomenclature comme pour un dépôt depuis la nomenclature ; c'est à vérifier par un test (§9).
    - Le bouton « Placer » propose les premiers U libres (alternative au clavier).
  - *Inspecteur* :
    - au-dessus du panneau existant, la face (avant/arrière) de l'équipement sélectionné, avec ses ports reliés, puis la liste des entrées de connectique et leur occupation ;
    - un clic sur un port montre son câble et l'autre extrémité.
  - *Dock bas* :
    - **Contrôles** : `validateRack()` existe dans `lib/services/rack-validation.ts` mais n'est appelé nulle part. On le branche sur les données du rack courant. Dans le synoptique, le dock lit `useTopbarActions().validationReport` dès que la phase 4c le fournit. Un clic sur un contrôle sélectionne l'objet en cause.
    - **Câbles** : liste numérotée du rack courant.
    - **Bilan** : U occupés, puissance face à la capacité des PDU, poids et BTU/h, ports par famille de signal.
  - *Vue Connectique* (lentille propre à Strata) : faces arrière de chaque équipement du rack, avec la liste des câbles de chaque face.

### 6.3 Accueil et catalogue (lot 2)
- **Accueil** (`/dashboard` en Strata) :
  - bandeau en trois cartes : captations à venir, à traiter, activité ;
  - grille de projets façon Strata Graphics avec les boutons « Concevoir » et « Livrer ». Données : `GET /api/projects` et `GET /api/tenant/projects`, déjà utilisés.
  - Les compteurs du tableau de bord Classique (projets actifs, tâches, complétion, prochaine captation) sont conservés dans le bandeau.
- **Catalogue** (`/admin/catalogue` en Strata) :
  - équipements en cartes avec la face dessinée à partir de la connectique, les caractéristiques (U, poids, puissance, ports, double alimentation, ST 2110) et la barre des ports par famille de signal ;
  - la vue tableau existante reste disponible ;
  - câbles en cartes avec leur dessin et les données du modèle ; adaptateurs avec leur dessin entrées → sorties.
  - La création et l'édition ouvrent les éditeurs existants. Dans la fiche équipement, un panneau « Faces et schéma » s'ajoute au-dessus de l'onglet Connectique ; il est mis à jour en direct pendant la saisie.

## 7. Où vit chaque fonction

| Fonction | Classique | Strata |
| --- | --- | --- |
| Tableau de bord | rail › Dashboard | Projets › Tableau de bord (accueil) |
| Projets Prestation / Intégration, création | rail › Projets | Projets › Prestation / Intégration (page existante) |
| Fiche projet, caractéristiques | éditeur, panneau d'informations | bouton Fiche de l'éditeur |
| Inventaire | onglet Inventaire | onglet Inventaire |
| Rack (4 faces, placement) | onglet Rack | Conception › Rack (+ bibliothèque, inspecteur, dock bas) |
| Synoptique, validation | onglet Synoptique | Conception › Synoptique (+ dock Contrôles) |
| Schémas, Plan, Vidéo, Audio, Lumière, Réseau | onglets | Conception › lentilles |
| Préparation, Recette | Livraison ▾ | onglet Livraison |
| Exports, dossier | menus d'export, dossier | mêmes menus, bouton Dossier |
| Modèles (contenants, régies, panels, dossiers), éditeur de panel | rail › Modèle | Modèles |
| Catalogue (équipements, câbles, adaptateurs, éditeurs) | rail › Catalogue | Catalogue (cartes dessinées + éditeurs existants) |
| Paramètres, Utilisateurs, Espace, Système | rail › Admin | Administration ▾ |
| Profil, notifications, langue, thème, présence | topbar | topbar Strata |
| Interface (nouveau) | Système › Interface | Système › Interface |

## 8. Lots et ordre

1. **Lot 1, socle** : réglage (serveur et Système), contexte, coquille générale, topbar et docks de l'éditeur (sans les ajouts du lot 3).
2. **Lot 2** : bibliothèque de dessins, accueil, catalogue, panneau « Faces et schéma ».
3. **Lot 3** : bibliothèque glissable, faces dans l'inspecteur, dock bas, vue Connectique.
   - La partie synoptique du dock Contrôles se branche quand la phase 4c est sur `main` : on rebase, puis on câble `validationReport`.

Chaque lot se termine branche à jour de `main`, avec les trois jeux de commandes au vert (`cargo test`, `cargo clippy`, `npm test && tsc && build`). Rien n'est poussé sans l'accord de Damien.

## 9. Vérification
- **Classique** : tous les tests existants passent sans modification. Le mode par défaut ne change rien, et une capture avant/après de chaque écran de la coquille le confirme.
- **Strata** :
  - tests de routeur : coquille Strata, permissions de la navigation, aucune route perdue (les URL de `router.tsx` sont toutes atteignables depuis la navigation Strata) ;
  - test de la page Système : bascule, confirmation, `PUT` envoyé ;
  - tests des dessins : rendu d'une face depuis une connectique donnée, nombre de ports, ports reliés.
- **Serveur** : test `GET /api/site` (champ `interface`), `PUT /api/system/interface` (garde, 400, upsert, évènement), sauvegarde et restauration de la clé.
- **Glisser-déposer** : un test d'intégration serveur vérifie qu'un `POST /api/racks/{id}/slots` avec un `catalogEquipmentId` absent de la nomenclature crée bien la ligne de nomenclature. Si ce n'est pas le cas, on s'arrête et on demande à Damien avant de continuer.
- **Captures** Strata en clair et en sombre : accueil, catalogue, fiche équipement, éditeur (inventaire, rack avec bibliothèque, synoptique), Système.

## 10. Laissé au builder
- Les libellés exacts des textes d'aide d'une ligne dans Système.
- La largeur par défaut des docks (gauche 280 px, inspecteur selon le store, dock bas 220 px repliable) et leur mémorisation dans `localStorage`.
- La découpe interne de `web/src/strata/`.
