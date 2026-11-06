# Phase 2 — points reportés

Ce fichier liste ce que les revues de la phase 2 (catalogue, paramètres, utilisateurs, espace, profil) ont laissé en suspens. Aucun point ne bloque la phase, sauf mention contraire.

## À trancher par Damien

- **Plafond d'import.** Un tableur de plus de 200 colonnes est désormais refusé : « Trop de colonnes (max 200) ». C'est la protection contre un fichier piégé qui faisait planter le serveur. arkyo n'avait pas de limite.
- **Logos des fabricants.** Les fabricants de départ gardent les URL `cdn.simpleicons.org` d'arkyo. Hors ligne, les logos ne s'affichent pas, et quelques URL renvoient déjà une 404. Option : les embarquer.
- **Couleurs des niveaux de droits** (`permissions-panel.tsx`, `LEVEL_STYLES`). Ce sont des couleurs métier, gardées telles qu'arkyo les a. 5 couples sur 6 sont sous 4,5:1, en clair comme en sombre.
- **Bulles « Cliquez pour… »** du profil et du panneau des droits. Elles sont gardées par parité, alors que les règles d'interface les excluent.
- **Boutons « Nouvel équipement » / « Nouveau fabricant ».** Pointillé de 1 px comme dans arkyo, au lieu du `border-2` de la règle.
- **Espace, zone dangereuse.** Il ne reste que la carte de purge, donc la colonne de droite est vide.
- **Textes « Arkyo ».** « Fichier Arkyo », « Restaurer Arkyo » : texte d'arkyo gardé.
- **800 px.** Les onglets des Paramètres chevauchent le logotype dans la barre du haut (disposition d'arkyo).

## Pour les phases suivantes

- **Évènements temps réel.** Leur charge ne porte ni `projectId`, ni `rackId`, ni `itemId`, ni `clientId`. C'est nécessaire en phase 3.
- **Contrôle « en usage ».** `in_use` attend les tables `RackInventoryItem` / `RackSlot` (`catalogEquipmentId`), `RackConnection` / `ProjectConnection` (`catalogCableModelId`) et `SynopticAdapter` / `ProjectSynopticAdapter` (`catalogAdapterId`), avec ces noms exacts.
- **Éditeurs d'impression.** Créer un modèle d'impression ou d'export ouvre `ComingSoonEditor` jusqu'à la phase 6.
- **Réinvitation.** Les écritures sont ordonnées, mais ne forment pas une seule transaction. Une erreur de base en cours de route peut laisser le nouveau nom ou identifiant seul écrit.

## Qualité, sans urgence

- **Import et sauvegarde.**
  - Le `.xlsx` est décompressé deux fois (contrôle de taille, puis lecture).
  - Il y a un clone inutile de `matrix` dans `read_matrix`.
  - La sauvegarde n'est pas lue dans un seul instantané (transaction de lecture).
  - Des id en double dans un fichier de fusion deviennent des mises à jour.
  - L'échec de `record()` masque l'erreur de section.
- **Membres.**
  - Course sur l'index unique, qui donne une 500.
  - L'email n'est pas normalisé NFC.
  - `espace::read` avale les erreurs de base.
  - `updatedAt` n'est pas touché par certaines mises à jour.
  - La branche « dernier propriétaire » du DELETE n'est pas testée.
- **Divergences avec arkyo.**
  - 401 « Non authentifié » au lieu de « Unauthorized » sur les longueurs.
  - Le corps des 403 est `{error}` sans `code`, alors qu'aucun front ne lit `code`.
  - La recherche du catalogue filtre `isActive = 1`.
- **Front.**
  - `ComingSoonEditor` n'a ni `role=dialog` ni gestion du focus.
  - Un échec du chargement des droits ressemble à un manque de droits (redirection).
  - La suppression d'un membre n'a pas de `catch` (comme arkyo).
  - L'envoi du logo de l'espace reste actif pour un non-propriétaire.
  - Il reste des imports et états morts gardés par fidélité à la copie.
- **Seeds.**
  - Un marqueur `seeds.applied` illisible est traité comme vide.
  - Le JSON est analysé à chaque démarrage.
  - Les restes de surcharges de l'extracteur ne sont pas vérifiés.
- **Tests.**
  - Le délai de `phase2-imports.test.ts` a été porté à 30 s (import à froid lent).
  - Pas de test qui garde `SEED_AUTHOR` aligné sur les seeds.
- **Bundle.** Le chunk d'entrée fait encore 524 kB.
- **Uploads.** Les fichiers sont toujours lus entièrement en mémoire.
