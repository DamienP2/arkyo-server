# Interface Strata v2 : « Concevoir / Gérer »

> Date : 2026-11-09 · Statut : à valider par Damien · Réalignée sur la livraison (tâche 9, 2026-11-10) : les écarts décidés en cours de route sont notés « Ruling N » à leur place ; la liste complète est dans `docs/superpowers/plans/2026-11-09-interface-strata-v2-suivi.md`
> Branche : `ui-strata-v2` (worktree séparé), rebasée régulièrement sur `main`
> Maquette de référence : « Strata Arkyo, synthèse Toile et Gérer » (https://claude.ai/artifact/M2TE3HREorjMmWpBUFwika), issue des dix pistes du 9 novembre (pistes 10 « Toile » et 7 « Simple / Expert » retenues, enrichies des pistes 1, 2, 3, 4, 6, 8, 9)
> Remplace : l'interface Strata v1 de `docs/superpowers/specs/2026-11-07-interface-strata-design.md` (§6 et §7), dont le reste (réglage, contexte, règle « deux interfaces ») est conservé

## 1. Intention

Damien juge l'interface Strata v1 « très complexe et illisible… il y en a partout ». Il demande : « tu laisseras toujours le design Classique (arkyo) mais tu remplaceras la version Strata par ce nouveau modèle ».

**Classique ne change pas.** Le réglage Classique / Strata de Système, la clé `ui.interface`, l'API et la règle « deux interfaces » de `CLAUDE.md` sont conservés. Seule la présentation **Strata** change.

## 2. Objectifs, non-objectifs, anti-objectifs

### Objectifs
- **Hors projet :** des pages simples. Topbar `Projets` · `Catalogue` · `Administration`, palette ⌘K, présence, notifications, thème. Le catalogue en liste + détail, et un éditeur d'équipement pleine page.
- **Dans un projet : deux espaces**, `Concevoir` et `Gérer`, au lieu de la barre d'onglets et des docks.
  - **Concevoir** : le synoptique (et les racks) en plein écran. Barre d'outils flottante, tiroir de l'objet sélectionné, bandeau de validation.
  - **Gérer** : des pages liste + détail (Vue d'ensemble, Fiche, Matériel, Câbles, Réseau, Livraison, Dossier).
- **Champs rares** regroupés dans des sections « Avancé » repliées (mémorisées par type d'écran), dans les écrans que l'interface Strata dessine elle-même.
- **Palette ⌘K** sur toutes les pages qui ont une topbar Strata (site et projet) : objets et actions. L'éditeur de panel plein écran (`/panels/:id`), page d'arkyo sans coquille Strata, ne l'a pas.
- Aucune fonction perdue par rapport à Classique (table du §7).

### Non-objectifs
- Réécrire les éditeurs copiés d'arkyo : synoptique, canevas de rack, formulaire d'équipement. On change leur **disposition**, pas leur code (option B, comme en v1).
- Porter des fonctions des phases 5 et 6 : réseau, plan, lumière, préparation, recette, dossier. Leurs pages Gérer et modes Concevoir affichent `ComingSoon` tant que la phase ne les a pas portées, comme en Classique.
- Ajouter des routes d'API, sauf une si elle est vraiment nécessaire (§5.4).

### Anti-objectifs
- Une fonction atteignable en Classique et introuvable en Strata.
- Un changement visible en Classique.
- Des panneaux permanents empilés : c'est le défaut de la v1 qu'on corrige.
- Un rendu « enfantin » : aplats, couleurs vives, courbes épaisses.

## 3. Ce qu'on retire de la v1, ce qu'on garde

### Retiré (code supprimé)
- La coquille éditeur v1 : `strata-editor-shell.tsx` (docks), `bottom-dock.tsx`, `rack-bottom-dock.tsx` et ses onglets, la barre de lentilles et la topbar projet `Conception · Inventaire · Livraison`.
- La lentille Connectique (`lenses/`).
- Les grilles de cartes du catalogue (`strata-*-grid.tsx`, `strata-card.tsx`) : le catalogue devient liste + détail.
- La barre latérale de bibliothèque v1 (`strata-side-nav.tsx`) : remplacée par la navigation propre à chaque page.
- Ruling 1 : les accroches v1 de `project-editor.tsx` (`withStrataRack`, `withStrataInventaireFace`) ont d'abord été réduites à des enveloppes neutres, puis remplacées par `strata.drawerTop` ; elles n'existent plus.

### Conservé et réutilisé
- `interface-context.tsx`, `interface-switch.tsx`, le réglage Système et la route serveur.
- `drawings/` : faces, schéma de principe, élévation, câble, adaptateur, jauge.
- `catalogue-model.ts`.
- `library/` : placement depuis le catalogue, déplacé dans le tiroir du mode Racks.
- `inspector/equipment-face-card.tsx` : devient le contenu « Faces » du tiroir.
- `rack-model.ts` et `rack-validation-input.ts` : bilan et validation du rack.
- `faces-panel.tsx` : bandeau des faces de l'éditeur pleine page.
- `save-status.tsx`.
- L'accueil v1 (`strata-home.tsx`) : refondu en page « Projets » liste + détail.

## 4. Les espaces dans un projet

### 4.1 Concevoir
Mode par défaut : **Synoptique**. Un sélecteur discret dans la barre flottante donne `Synoptique` · `Racks` · `Plan` · `Lumière` · `Schémas`. Les trois derniers sont des bouchons jusqu'à la phase 5.

**Disposition** (`StrataCanvasShell`, nouvelle mise en page des mêmes emplacements `EditorShellSlots`) :
- **Topbar projet 46 px** : lockup, « PROJET / nom », sélecteur `Concevoir` · `Gérer`, état d'enregistrement, présence, ⌘K, statut du projet, Fermer.
- **Canevas sur toute la surface.**
- **Barre d'outils flottante** : le `leftToolbar` existant, posé en surimpression en haut au centre. La barre contextuelle existante (sélecteur de vue, etc.) est repliée dans un menu « Options de la vue ».
- **Tiroir à droite** : le `rightPanel` existant (propriétés, calques, actions), posé en tiroir de 360 à 420 px. Il **s'ouvre seul quand un objet est sélectionné** (détails remontés par `onNodeDetailsChange` / `onCableDetailsChange` / …) et se ferme par Échap ou une croix ; un bouton le rouvre. Une sélection multiple est reconnue par le nombre de nœuds et de racks et le dernier nœud cliqué (Ruling 8 : le synoptique ne transmet que des comptes). Au-dessus du contenu arkyo, pour un équipement, une carte « Faces » (avant / arrière, ports reliés), avec « Voir dans le rack » qui passe en mode Racks sur ce rack, sans y sélectionner l'emplacement (Ruling 7 : `RackTabClient` n'expose aucune sélection externe).
- **Bandeau de validation** discret sous la topbar : compteurs erreurs / avertissements tirés de `useTopbarActions().validationReport`. Il ouvre la liste des contrôles (celle du synoptique arkyo, groupée par contrôle) dans un volet flottant à gauche, et non dans le tiroir, qui reste à l'objet sélectionné (Ruling 4) ; un clic sur un contrôle appelle `onSelectValidationIssue` (la sélection et le cerclage sur le canevas sont ceux du synoptique arkyo). « Valider » de la palette ⌘K ouvre cette liste.
- **Mini-carte et zoom** : ceux du synoptique s'ils existent, sinon les commandes de zoom du `SynopticViewHandle`.

**Mode Racks** : l'onglet Rack existant (élévations, placement, DnD), avec la même disposition (canevas plein, outils flottants, tiroir). Le tiroir porte la bibliothèque v1 (glisser sur un U libre) et la carte de face de l'emplacement sélectionné, en deux onglets « Bibliothèque » et « Équipement » plutôt qu'empilés (Ruling 6).

Les onglets Inventaire, Préparation, Réseau et Recette sont des pages et non des canevas : leurs outils sont posés en bande au-dessus du contenu, sans barre flottante (`strata.mode = "page"`, Ruling 3). Vidéo et Audio n'ont pas de mode dans le sélecteur : ils restent dans le menu « Vues » de la topbar projet.

### 4.2 Gérer
Une colonne de navigation fine, puis une liste filtrable, puis le détail (modèle unique, piste 8). En Gérer, le canevas de Concevoir est démonté, et remonté au retour : ses raccourcis globaux (⌘Z, ⌘X, ⌘V) n'agissent jamais sur une vue invisible (Ruling 5).
- **Vue d'ensemble** : une ligne par domaine (Matériel : n équipements / emplacements ; Racks : U et puissance ; Câblage : n câbles, erreurs ; Validation : compteurs ; Fiche : complétion) et la liste **« Ce qu'il reste à faire »**, calculée sur les données disponibles (contrôles de validation, équipements non placés, champs de fiche manquants). Pas de « longueurs manquantes » : arkyo n'a aucune longueur de câble (Ruling 9). Le rapport de validation est le dernier que le synoptique a publié pour ce projet, avec le lieu qu'il couvre. Chaque ligne mène à l'objet, dans Concevoir ou dans Gérer.
- **Fiche** : la fiche existante (`fiche-client.tsx`) et le dialogue des caractéristiques, dans la zone de détail. Tâches, messages et documents restent ce qu'ils sont en Classique (comptes et liste de documents en lecture ; pas de route de modification à ce jour).
- **Matériel** : liste des équipements du projet groupés par emplacement et contenant (données `/editor` et `racks/{rack}/inventory`), détail avec faces, position et « Avancé ». « Ajouter du catalogue » ouvre le parcours d'ajout existant de l'inventaire. La nomenclature est un second onglet de la liste.
- **Câbles** : liste agrégée de tous les câbles du projet, par lecture des routes existantes (`synoptic/location/{id}` par lieu, `/racks/{id}/connections` pour les contenants sans lieu, et `synoptic/general`). Détail : deux extrémités dessinées, type. Un **mode tableau** permet de saisir numéros, couleurs et notes en série (édition en cellule, remplissage vers le bas), enregistrés par les routes existantes de modification de connexion. Ruling 9 : arkyo n'a aucune longueur de câble (`RackConnection` : label, color, notes, tags, waypoints, cableStyle, bundleId) ; en ajouter une demande une colonne et une route, question reportée par Damien.
- **Réseau, Livraison (préparation, recette), Dossier** : `ComingSoon` jusqu'aux phases 5 et 6, avec la même phrase qu'en Classique.

### 4.3 Hors projet
- **Projets** (accueil) : liste des projets (avancement, date de captation, statut, équipe) et détail (résumé, alertes connues, ouvrir dans Concevoir ou Gérer). Prestation / Intégration sont des filtres.
- **Catalogue** : liste + détail (Équipements, Cordons, Adaptateurs, Modèles). Toute fonction des panneaux de liste d'arkyo y est reprise : tri, filtres (à choix multiples, mémorisés par sorte), Dupliquer, Supprimer, suppression groupée (Ruling 10). Détail en lecture : faces, schéma de principe, ports, essentiel et « Avancé ». « Modifier » ouvre l'**éditeur pleine page** pour un équipement ; les éditeurs de cordons et d'adaptateurs restent les pages d'arkyo, dans la coquille Strata (Ruling 11) :
  - bandeau des faces en direct (`faces-panel`) ;
  - colonne principale avec le formulaire arkyo existant (ses onglets Généralités et Connectique) ;
  - colonne d'aperçu à droite (schéma de principe, ports par famille, totaux, « Utilisé dans », lu sur les régies et les contenants hors régie ; un composant de châssis modulaire n'y figure pas, d'où « Aucun emplacement connu » plutôt que « Non utilisé ») ;
  - barre d'actions (état d'enregistrement de l'autosave arkyo, Annuler et Rétablir de `useEditorHistory`, Dupliquer, Supprimer).
  
  Le formulaire arkyo n'est pas découpé en sections (non-objectif) ; « Avancé » ne s'y applique donc pas.
- **Administration** : les pages existantes (Utilisateurs, Paramètres, Espace, Système avec Sauvegardes), dans la coquille Strata. Leur navigation de section est le menu « Administration ▾ » de la topbar et les onglets de page existants, sans rail de plus (Ruling 2).

### 4.4 Palette ⌘K
Montée dans la topbar du site et dans la topbar projet : elle est sur toutes les pages qui en ont une. L'éditeur de panel plein écran (`/panels/:id`) n'a aucune coquille Strata où la monter sans nouvelle accroche dans un fichier copié : il n'a pas de palette.

Projets, équipements et câbles du projet ouvert, fiches du catalogue, utilisateurs, et actions (Nouveau projet, Ajouter du matériel, Valider, aller à Concevoir / Gérer, Modifier une fiche). Navigation au clavier.

Livré (tâche 9) : les sources du projet ouvert viennent en tête (Matériel, Câbles, Projet). Une fiche du catalogue ouvre le catalogue Strata sur `?tab=<sorte>&id=<id>` ; « Modifier » (bouton de la ligne ou ⌘Entrée) ouvre son éditeur. Les sources Catalogue et Utilisateurs suivent les permissions de leurs pages (`catalog:admin`, `members:admin`). Les navigations passent par la garde des saisies non enregistrées. « Valider » mène au synoptique de Concevoir et ouvre la liste des contrôles dès que le rapport est publié ; « Ajouter du matériel » mène à Gérer › Matériel, qui ouvre l'outil Équipements de l'Inventaire comme « Ajouter du catalogue ».

## 5. Architecture

### 5.1 Points d'accroche dans les fichiers copiés
Ce sont ceux de la v1, liste fermée, inchangée sauf ce qui suit :
- `editor-shell.tsx` : en Strata, rend `StrataCanvasShell` au lieu de `StrataEditorShell`. Le champ `strata?` d'`EditorShellSlots` change de forme : `{ drawerTop?: ReactNode; mode?: "canvas" | "page" }` (`mode = "page"` : Ruling 3).
- `project-global-topbar.tsx` : rend la topbar v2.
- `project-editor.tsx` (`getEditorSlots`) : les accroches v1 (`withStrataRack`, `withStrataInventaireFace`) sont remplacées par l'alimentation de `strata.drawerTop` (carte Faces) et le passage en mode Gérer.
- `synoptique-tab-client.tsx` : **ajout à la liste fermée**. Une accroche passe la carte Faces de l'objet sélectionné dans `strata.drawerTop` et ouvre le tiroir à la sélection, à partir des détails qu'il tient déjà (`:484-507`).
- `equipment-editor.tsx` : l'accroche `StrataConnectivityLayout` v1 est remplacée par la mise en page pleine page (bandeau, aperçu, barre d'actions) autour du contenu existant.
- Les trois list panels du catalogue : leur accroche v1 (grilles) est retirée ; le catalogue Strata est une page à part (§5.2).
- `app-layout.tsx` : la topbar v2 remplace `StrataTopbar` et `StrataSideNav`.

### 5.2 Code neuf (`web/src/strata/`)
`shell/` (topbar v2, `StrataCanvasShell`, sélecteur Concevoir / Gérer, bandeau de validation, tiroir), `manage/` (pages Gérer), `pages/` (Projets, catalogue liste + détail, éditeur pleine page), `palette/` (⌘K), `advanced/` (section « Avancé » et sa mémoire). Routes Strata : `/project/:id?space=gerer&page=…` pour Gérer ; Concevoir garde `?tab=synoptique|rack` (même stockage local qu'arkyo).

### 5.3 Routage
Classique ne change pas. En Strata, `/dashboard` et `/projects` rendent la page Projets v2 ; `/admin/catalogue` rend le catalogue liste + détail ; `/admin/catalogue/equipment/:id` rend l'éditeur pleine page. Les autres URL sont inchangées.

### 5.4 API
Aucune route nouvelle n'est prévue. Si la liste agrégée des câbles s'avère trop lente par lecture rack par rack sur un gros projet (plus de 1 000 câbles), on ajoutera `GET /api/tenant/projects/{id}/connections` (lecture seule), après accord de Damien.

## 6. Lots

1. **Coquille hors projet** : topbar v2 et ⌘K (première version : projets, fiches catalogue, utilisateurs, actions), page Projets, administration dans la coquille.
2. **Concevoir** : `StrataCanvasShell` (canevas plein, outils flottants, tiroir, bandeau de validation) pour Synoptique et Racks, carte Faces dans le tiroir, bibliothèque dans le tiroir Racks, sélecteur Concevoir / Gérer. Retrait des docks v1.
3. **Gérer** : Vue d'ensemble avec « Ce qu'il reste à faire », Fiche, Matériel, Câbles (mode tableau), bouchons des phases 5 et 6, sections « Avancé ».
4. **Catalogue** : liste + détail, éditeur pleine page, ⌘K étendu (objets du projet). Retrait des grilles v1.
5. **Nettoyage et documentation** : suppression du code v1 mort, table « Où vit chaque fonction » mise à jour dans la spec v1, `ARCHITECTURE.md`, fichier de suivi.

Chaque lot se termine branche à jour de `main`, avec les trois jeux de commandes au vert et des captures en clair et en sombre. Rien n'est fusionné ni poussé sans l'accord de Damien.

## 7. Où vit chaque fonction (Strata v2)

Table réalignée sur ce qui a été livré (tâche 9). Elle remplace la table « Où vit chaque fonction » de la spec v1 et fait foi pour l'interface Strata. Chaque ligne a son test de routeur (`web/src/strata/shell/function-map.test.tsx`), qui relit cette table : une ligne ajoutée ici sans test fait échouer la suite.

| Fonction | Strata v2 |
| --- | --- |
| Tableau de bord | Projets (liste + détail), filtres Prestation / Intégration |
| Création de projet | Projets › Nouveau projet (assistant existant) ; ⌘K › Nouveau projet |
| Fiche, caractéristiques | Gérer › Fiche (fiche d'arkyo, dialogue des caractéristiques) ; menu Vues › Caractéristiques du projet |
| Inventaire, nomenclature | Gérer › Matériel (liste groupée, onglet Nomenclature) ; « Ajouter du catalogue » ouvre l'Inventaire d'arkyo sur l'outil Équipements |
| Rack (4 faces, placement) | Concevoir › Racks (tiroir en onglets Bibliothèque et Équipement, Ruling 6) |
| Synoptique, validation 11 contrôles | Concevoir › Synoptique : bandeau de validation et volet des contrôles à gauche (Ruling 4), action « Validation synoptique » d'arkyo dans le tiroir ; ⌘K › Valider |
| Câblage, numérotation | Concevoir (outil câble et numérotation d'arkyo) ; Gérer › Câbles (liste, mode tableau : numéro, couleur, notes ; pas de longueur, Ruling 9) |
| Plan, Lumière, Schémas | Concevoir › modes (bouchons phase 5) |
| Vidéo, Audio | Menu Vues de la topbar projet (bouchons phase 5, sans mode du sélecteur) |
| Réseau | Gérer › Réseau (bouchon phase 5) |
| Préparation, Recette, Dossier | Gérer › Livraison, Dossier (bouchons phase 6) ; export du dossier : menu Vues › Exporter un dossier |
| Exports par vue | Tiroir de la vue (actions arkyo existantes) |
| Modèles (contenants, régies, panels, éditeur de panel) | Catalogue › Modèles (onglet du catalogue, puis les pages d'arkyo et leur navigation Contenants · Panels · Dossiers dans la topbar) |
| Catalogue (équipements, cordons, adaptateurs) | Catalogue : liste + détail, tri, filtres multiples mémorisés, Dupliquer, Supprimer, suppression groupée (Ruling 10) ; ⌘K › fiches |
| Éditeurs du catalogue | Équipement : éditeur pleine page ; cordons et adaptateurs : pages d'arkyo dans la coquille Strata (Ruling 11) |
| Paramètres, Utilisateurs, Espace, Système (dont Sauvegardes, Interface) | Administration (menu Administration ▾ et onglets des pages, Ruling 2) |
| Profil, notifications, langue, thème, présence | Topbar |
| Recherche et actions | Palette ⌘K, sur les pages à topbar Strata (site et projet ouvert) ; pas sur l'éditeur de panel plein écran |

## 8. Vérification
- **Classique** : tous les tests existants passent sans modification.
- **Strata** : chaque lien de la table du §7 a son test de routeur. Tests des pages Gérer (Vue d'ensemble calculée, Matériel, Câbles et mode tableau) et du tiroir (ouverture sur sélection, Échap). Test de la palette.
- **Captures** clair et sombre : Projets, Concevoir (synoptique, racks, tiroir ouvert, bandeau), Gérer (Vue d'ensemble, Matériel, Câbles), catalogue et éditeur pleine page, administration.
- **Relecture** de chaque tâche, puis relecture finale de la branche.

## 9. Laissé au builder
- Largeurs exactes du tiroir et de l'aperçu.
- Place de la mini-carte.
- Libellés des lignes « Ce qu'il reste à faire ».
- Découpe interne de `web/src/strata/`.
