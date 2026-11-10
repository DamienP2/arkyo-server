# Interface Strata v2 « Concevoir / Gérer » : points reportés

Ce fichier liste ce que la v2 de l'interface Strata laisse en suspens : questions reportées par Damien, limites connues, décisions prises en cours de route (« Rulings ») et reliquats. Aucun point ne bloque la livraison. La spec est `../specs/2026-11-09-interface-strata-v2-design.md` (son §7 « Où vit chaque fonction » fait foi), le plan `2026-11-09-interface-strata-v2.md`. Le suivi de la v1 (`2026-11-07-interface-strata-suivi.md`) ne vaut plus que pour le réglage d'interface et ce qui n'a pas changé.

## Questions reportées par Damien

- **Longueur de câble.** arkyo n'a aucune longueur de câble : `RackConnection` porte `label`, `color`, `notes`, `tags`, `waypoints`, `cableStyle` et `bundleId` (`schema.prisma:655-688`). Gérer › Câbles et son mode tableau saisissent donc le numéro, la couleur et les notes ; « Ce qu'il reste à faire » ne cite pas de longueur (Ruling 9). En ajouter une demande une migration additive, une colonne et une route.
- **Route dédiée « Utilisé dans ».** L'aperçu de l'éditeur d'équipement lit `GET /api/rigs`, `GET /api/racks?unassigned=true` et `GET /api/tenant/projects`, faute de route d'usage. Sur un gros site, `GET /api/rigs` est lourd (toutes les baies enrichies). Une route `GET …/equipment/{id}/usage` (lecture seule) le remplacerait.

## Limites connues

- **Rapport de validation de Gérer.** C'est le dernier rapport publié par le synoptique pour ce projet (vue d'un lieu), noté pendant que Concevoir était ouvert (`validation-record.tsx`). Il peut dater et ne couvre que ce lieu ; sans passage par le synoptique, la ligne Validation affiche « Aucun rapport ».
- **Clé de multi-sélection du tiroir.** Le nombre de nœuds et de racks et le dernier nœud cliqué, pas les ids (Ruling 8) : une seconde sélection de même taille sur le même dernier nœud ne rouvre pas un tiroir fermé à la main.
- **« Voir dans le rack ».** Il ouvre le mode Racks sur le contenant de l'équipement sans sélectionner l'emplacement (Ruling 7).
- **Vidéo et Audio.** Ils n'ont pas de mode dans le sélecteur de Concevoir (Synoptique, Racks, Plan, Lumière, Schémas) ; ils restent dans le menu « Vues » de la topbar projet. Ce sont des bouchons de la phase 5.
- **Adaptateurs des racks sans lieu.** Dans Gérer › Câbles, une extrémité sur un adaptateur d'un contenant sans lieu (lu par `/racks/{id}/connections`) est nommée « Adaptateur », sans son nom.
- **Composant de châssis modulaire.** Il n'a pas d'emplacement : « Utilisé dans » ne le voit pas. La liste vide dit donc « Aucun emplacement connu » (et non « Non utilisé »), sans « 0 exemplaire », car le serveur peut encore refuser la suppression (409).
- **Bouton retour du navigateur.** Il n'est pas gardé : une saisie en cours du mode tableau des câbles est perdue sans dialogue (la garde d'arkyo ne couvre que les liens et la navigation par programme).
- **Éditeurs de cordons et d'adaptateurs.** Ils restent les pages d'arkyo dans la coquille Strata (Ruling 11) ; seul l'éditeur d'équipement a la mise en page pleine page.
- **« Modifications non enregistrées » à l'ouverture.** Une fiche créée par l'API (sans passer par l'éditeur) s'ouvre marquée modifiée. Le défaut est antérieur à Strata et existe aussi en Classique.
- **Icônes des onglets de la topbar.** Masquées sous 1 536 px, pour que la topbar tienne à 1 280 px.
- **Équipe d'un projet.** La page Projets montre le créateur du projet : arkyo n'a pas d'équipe par projet.
- **« Ajouter du matériel » de la palette.** Depuis Concevoir, la palette passe par Gérer › Matériel, qui ouvre aussitôt l'outil Équipements de l'Inventaire (seul Gérer tient le rappel de l'éditeur, `onOpenCatalogue`) : on voit Gérer un instant.
- **« Valider » de la palette.** Sur la vue Générale du synoptique, qui ne publie pas de rapport (arkyo valide par lieu), c'est l'action « Validation synoptique » d'arkyo qui répond, avec son volet.
- **« Valider » sur la vue Générale.** La palette appelle alors l'action « Validation synoptique » d'arkyo (`onValidateRack`), qui est une bascule : si son volet est déjà ouvert, « Valider » le referme.
- **Palette absente de l'éditeur de panel.** L'éditeur plein écran `/panels/:id` est une page d'arkyo sans coquille Strata : la monter demanderait une accroche hors de la liste fermée. La palette est sur toutes les pages à topbar Strata (site et projet).
- **Lectures en double.** La palette relit `/editor` et les routes des câbles (`synoptic/general`, `synoptic/location/{id}`, contenants sans lieu) à chaque ouverture dans un projet, même quand Gérer les tient déjà ; et, dans Gérer, le `canvas-data` d'un contenant rackable sans lieu est lu deux fois (par `useRacksLive` et par `loadProjectCables`).
- **Historique dans le projet.** Les navigations de la palette dans un projet remplacent l'entrée d'historique (comme la navigation de Gérer) ; celles qui sortent du projet en ajoutent une.

## Rulings (décisions prises en cours de route)

1. **Retrait des accroches v1.** La tâche 3 a réduit `withStrataRack` et `withStrataInventaireFace` à des enveloppes neutres, que la tâche 4 a remplacées par `strata.drawerTop` ; elles n'existent plus.
2. **Navigation de l'Administration.** Le menu « Administration ▾ » de la topbar et les onglets de page existants, sans rail de plus.
3. **Pages et canevas.** `strata.mode = "page"` sur Inventaire, Préparation, Réseau et Recette : outils en bande au-dessus du contenu, pas de barre flottante.
4. **Liste des contrôles.** Volet flottant à gauche, près du bandeau ; le tiroir de droite reste à l'objet sélectionné.
5. **Canevas en Gérer.** Démonté en Gérer, remonté au retour : ses raccourcis globaux n'agissent jamais sur une vue invisible.
6. **Tiroir du mode Racks.** Deux onglets, Bibliothèque et Équipement, plutôt qu'empilés.
7. **« Voir dans le rack ».** Ouvre le rack sans sélectionner l'emplacement : `RackTabClient` (copié) n'expose aucune sélection externe.
8. **Clé de multi-sélection.** Nombre de nœuds et de racks et dernier nœud cliqué : le synoptique ne transmet que des comptes.
9. **Longueur de câble.** Absente d'arkyo : ni dans Câbles, ni dans « Ce qu'il reste à faire » ; le mode tableau saisit numéro, couleur et notes.
10. **Catalogue complet.** Toute fonction des panneaux de liste d'arkyo est reprise dans le catalogue Strata, suppression groupée comprise.
11. **Éditeurs de cordons et d'adaptateurs.** Ils gardent la page d'arkyo ; « éditeurs → pleine page » vise l'éditeur d'équipement.

## Reliquats

- **Modules sans importateur hors tests.** `strata/drawings/gauge.tsx`, `strata/drawings/rack-elevation.tsx` et `strata/bottom/rack-validation-input.ts` ne sont plus importés que par leurs tests (ils servaient le dock bas et la vue Connectique de la v1). La spec v2 §3 les range dans « Conservé et réutilisé » : ils sont gardés, à retirer si Damien le confirme.
- **Règle du projet.** La contrainte « Deux interfaces » de `CLAUDE.md` désigne encore la table de la spec v1 comme celle qui fait foi ; la spec v1 renvoie désormais au §7 de la spec v2. Changer ce renvoi dans `CLAUDE.md` revient à Damien.
- **Vérification du §7.** `web/src/strata/shell/function-map.test.tsx` relit la table du §7 et vérifie chaque ligne dans l'application. Une phase qui déplace une fonction met à jour la table et ce test.
