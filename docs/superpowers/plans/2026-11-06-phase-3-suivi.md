# Phase 3 — points reportés

Ce fichier liste ce que la phase 3 (tableau de bord, projets et assistant, modèles de contenants et de panels, détail de régie, éditeur de panel) a laissé en suspens : écrans reportés, décisions à reprendre plus tard et remarques des revues. Aucun point ne bloque la phase, sauf mention contraire. Les décisions de la phase sont dans `2026-11-06-phase-3-projets.md`.

## Reporté à la phase 4

- **Éditeur de rack.** `/racks/:rackId` et `/rigs/:id/rack/:rackId` restent `ComingSoon`, comme `/project/:id/*`. Il dépend de 21 routes `/api/racks/:id/**` (inventaire §6.2).
  - Les liens qui y mènent (cartes de contenant, fin d'assistant, cartes de projet) ouvrent l'écran `ComingSoon`.
  - Aucune route n'écrit encore `RackSlot` ni `RackInventoryItem`. Le parcours de bout en bout (`tests/phase3_smoke.rs`) les insère en SQL.
- **Fiche projet.** Elle fait partie de l'éditeur projet ; `/projects/:id` redirige comme arkyo.
- **Audit.** Les deux `GET …/audit` (projet, rack) et `audit-panel` arrivent avec l'éditeur.
- **SSE par rack.** Le flux temps réel par rack reste à faire.
- **Suppression d'une régie de projet.** `DELETE /api/rigs/:id` sur une régie de projet laisse ses racks (virtuels et propres) sans projet : ils réapparaissent dans `/templates` et `?unassigned=true`. arkyo fait de même. C'est le même défaut que celui corrigé à la suppression d'un projet (décision 7) ; à trancher.
- **Snapshots.** Les colonnes `snapshotId` de `RackSlot` et `RackInventoryItem` existent mais restent `NULL` ; la logique de snapshot n'est pas portée.

## Pour les phases suivantes

- **Documents.** Les routes `documents` d'arkyo ne sont pas portées : aucun écran ne les appelle encore. La table `ProjectDocument` existe, vide.
- **Tâches et messages.** Les tables `Task` et `Message` existent, vides, pour que les compteurs (`_count`, `taskStats`) soient de vraies requêtes. arkyo n'a aucune route qui les écrit.
- **Onglet « Dossiers »** de `/templates` : `ComingSoon` jusqu'à la phase 6 (`RigsClient` d'arkyo, code mort, n'est pas porté).
- **Curseurs live.** `use-live-cursors.ts` est copié, sa connexion est neutralisée jusqu'à la phase 7.
- **Transactions d'écriture.** `sqlx` ouvre en `BEGIN DEFERRED` : deux premiers `POST …/locations` simultanés sur un même projet peuvent finir en 500 (`SQLITE_BUSY`). Passer les écritures en `BEGIN IMMEDIATE`.

## À trancher par Damien

- **Écarts assumés avec arkyo.**
  - Noms de projet en double : refusés sans tenir compte des accents (arkyo : casse seulement).
  - Date invalide : 400 « Date invalide », rack, régie ou panel inconnu : 404 / 400, là où arkyo répondait 500.
  - Gardes serveur reprises de l'UI (`projects:*`, `design:*`), là où arkyo ne vérifiait que la session.
- **Face du panel en sombre.** Les traits `rgba(0,0,0,α)` de l'éditeur de panel (découpes vides, numéros) sont quasi invisibles en sombre et à ≈ 2,4:1 en clair. Couleur de rendu gardée comme arkyo ; une exception d'interface reste possible, car la découpe vide sert aussi de cible de dépôt.
- **Contrastes hérités.** Icônes vertes et ambre sous 3:1 en clair (tableau de bord), texte de survol de la palette à 4,49 / 4,41:1, `--danger-text` sur `--secondary` en sombre à 4,49:1, pouce blanc des interrupteurs sur `--accent` sombre à ≈ 2:1 (`ActionSwitch` aussi). Un correctif se fait au niveau des variables.
- **Redimensionner un panel** vide ses slots sans confirmation, comme arkyo.

## Qualité, sans urgence

- **Serveur.**
  - `?unassigned=true&rigConfigId=` (vide) renvoie tous les racks ; arkyo retombe sur « aucune régie ».
  - `GET /api/panels` lit panels puis slots sans transaction de lecture.
  - Petites duplications dans `racks.rs` / `rigs.rs` (`with_defaults`, construction des `INSERT`).
  - `projects/enrich.rs` dépend de la couche HTTP (`http::projects` en `pub(crate)`).
  - L'en-tête de `0003_projets.sql` parle de CASCADE pour les relations obligatoires (formulation).
- **Tests manquants.** Chemin « Référence introuvable. » (régie avec `projectId` inconnu), cascade du DELETE de rack, SET NULL de `RackSlot.panelId` à la suppression d'un panel, `rearCableDepthMm: null` sur PATCH panel, échec partiel de l'assistant. `racks_rigs.rs:474` (`updatedAt` différent) peut être instable.
- **Front.**
  - Détail de régie : retrait et glisser-déposer affichés aux utilisateurs `design:read`, alors que le serveur demande `design:write`.
  - Le chargeur de `rigs/[id]` lit le catalogue d'équipements sans s'en servir.
  - L'éditeur de panel ne charge que les connecteurs actifs : un slot dont le connecteur est désactivé perd sa couleur de famille.
  - react-router journalise encore chaque redirection en console ; le filtre `onCaughtError` couvre aussi `notFound()`.
  - `/templates` affiche le vrai taux d'occupation des panels (arkyo affichait 0/N) sans commentaire `// arkyo-server:`.
  - `theme-sweep.test.ts` : exemptions `RACK_MOCKUP` / `CONTAINER_MOCKUP` plus larges que nécessaire.
  - Délais de test portés à 15-20 s (`panel-editor.test.tsx`, `router.test.tsx`).
