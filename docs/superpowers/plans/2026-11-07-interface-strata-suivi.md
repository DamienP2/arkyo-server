# Interface Strata — points reportés

Ce fichier liste ce que l'interface Strata activable a laissé en suspens : limites connues, branchements à faire dans les phases suivantes et décisions à connaître. Aucun point ne bloque la livraison. La spec est `../specs/2026-11-07-interface-strata-design.md`, le plan `2026-11-07-interface-strata.md`.

## À brancher dans les phases suivantes

- **Dock Contrôles du synoptique (4c).** Le dock bas lit `useTopbarActions().validationReport`. Quand la phase 4c publiera ce rapport pour le synoptique, brancher l'onglet Contrôles du dock du synoptique (aujourd'hui seul le rack l'alimente).
- **État d'enregistrement dans la topbar.** Il n'y remonte que pour les onglets rendus par `getEditorSlots`. Les autres onglets le gardent dans la barre contextuelle de la colonne centrale.

## Limites connues

- **Bilan.** La puissance est comparée à `Rack.maxPowerW` : le catalogue ne porte pas de capacité de PDU.
- **Sélection sans surbrillance.** Sélectionner depuis le dock ou la vue Connectique ne met pas l'élément en évidence sur le canevas (fichier copié, hors liste d'accroches).
- **Pictogrammes remplacés par l'admin.** Les dessins ignorent les icônes de connecteur remplacées dans l'administration et utilisent les pictogrammes par défaut.
- **Détection de l'énergie.** Elle repose sur la clé de fonction `ENERGIE` (renommable) pour distinguer les ports d'alimentation.
- **Catalogue du dock.** Le catalogue de la bibliothèque est lu une fois et n'est pas resynchronisé.
- **Vue Connectique.** `?lens=connectique` peut survivre à certaines navigations d'arkyo. Les ports ne sont pas atteignables au clavier dans les dessins (la liste de la vue Connectique sert d'alternative).
- **Faces latérales.** Leurs ports sont comptés mais non dessinés.
- **« À traiter » de l'accueil.** Il liste les fiches techniques incomplètes : le serveur n'expose pas d'alertes de validation.
- **Évènements sans `rackId`.** `onAppEvent` les ignore ; tous les publieurs n'ont pas été vérifiés.

## À trancher par Damien

- **Règle `* { border-color }` de `globals.css`.** Hors des couches Tailwind, elle écrase les classes `border-[var(--…)]`. Le défaut est antérieur à Strata et touche aussi Classique ; le corriger changerait des rendus existants.
- **Carte catalogue.** Elle montre la face qui porte le plus de ports (la maquette prenait l'avant dès qu'il avait un port), et la grille Strata est plate (pas de regroupement par fonction ; les filtres restent).
- **Export de sauvegarde.** `ui.interface` n'y entre pas (format arkyo inchangé) : restaurer un export catalogue ne change pas l'interface.
- **Liste fermée étendue.** `globals.css` et les trois list panels du catalogue portent des accroches, absents de la liste d'origine de la spec (le §5.2 est à jour).

## Reliquats mineurs

- Lecture de `ui.interface` : une erreur SQL est avalée (retour à Classique) ; les écrivains génériques de config ne valident pas la valeur.
- Accessibilité : menu Administration de la nav (flèches, retour du focus) et onglets de dock.
- Doublons : `toTitleCase`, `StatusMenu` (commentaire vers la source), calculs et libellés copiés du tableau de bord (`STATUS_*`, `RIG_TYPE_LABEL`) ; `strata-home.tsx` fait ~680 lignes.
- Bibliothèque : double message sur un dépôt refusé ; portée « lieu » sans contenant affiche « Catalogue vide » ; pas de test de la portée lieu.
