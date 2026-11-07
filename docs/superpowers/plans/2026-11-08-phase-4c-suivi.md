# Phase 4c — points reportés

Ce fichier liste ce que la phase 4c (onglet Synoptique de l'éditeur projet : vues générale et par lieu, objets du synoptique, connexions de rack et de projet, renumérotation, audit, validation et exports) a laissé en suspens. Aucun point ne bloque la phase. Les décisions sont dans `2026-11-08-phase-4c-synoptique.md`. Le parcours de bout en bout est `crates/arkyo-server/tests/phase4c_smoke.rs`.

## Défauts corrigés par la vague de correctifs

Revue finale : `.superpowers/sdd/2026-11-08-phase-4c-synoptique/final-review.md`. Chaque correction d'un défaut d'arkyo est commentée `arkyo-server: correction d'un défaut d'arkyo`.

- **C-1. Câble entre deux contenants d'un même lieu.** Dans la vue par lieu, `location-canvas.tsx` envoyait ce câble à `POST …/synoptic/connections`, qui refuse deux contenants du même lieu (400 « même emplacement ») : tout câble entre contenants, ou entre un contenant et un équipement libre, échouait. Il devient une `RackConnection` du rack virtuel du lieu (pivot), comme le veut la garde de la phase 3 d'arkyo. Le serveur accepte les composants des racks du lieu pour un rack hôte virtuel (`rack_connections.rs`, `LOCATION_RACKS`), et la renumérotation lit les slots d'un autre rack visés par les câbles du rack (signal et préfixe). La garde de la route projet est inchangée. **Conséquence pour Damien** : ces câbles sont numérotés au code du lieu (segment du pivot, « PLATE-20001 » dans le parcours), comme les équipements libres, et non au code du contenant d'origine. Étape 3 du parcours.
- **I-1. Faisceau créé dans la vue par lieu.** Le faisceau du pivot ne prenait que les câbles du pivot (`updateMany where {rackId}`) : ceux des contenants étaient perdus au rechargement. Pour un rack hôte virtuel, `set_members` prend les câbles de tous les racks du lieu, jamais ceux d'un autre lieu. Étape 2bis du parcours.
- **I-2. Libellés en double entre rack et projet.** La renumérotation projet ne lisait pas les libellés des câbles de rack (« R2-20001 » deux fois dans le parcours). Elle les compte désormais comme pris ; le parcours vérifie qu'aucun libellé du projet n'apparaît deux fois.
- **I-3. Renumérotation complète relancée** (`onlyUnlabelled: false`). Les libellés actuels des câbles renumérotés ne comptent plus comme pris : une seconde passe donne les mêmes libellés (`full_rerun_is_stable`). La renumérotation projet n'avait pas ce défaut.
- **I-4. Touche V dans la vue par lieu** : la boucle de mise à jour infinie est corrigée (la vue suit le shell, « Sélection », quand le parent pilote l'outil) ; le `test.fails` est un test normal.
- **M-1. Placeholder « Libellé… »** : il s'affiche sans ses séquences d'échappement.
- **M-2. Audit « Utilisateur inconnu »** : chaque ligne d'audit porte `user: {id, name, email} | null`, lu dans la table `User` locale (arkyo ne pouvait pas le fournir, base séparée).

## À trancher par Damien

- **Clés `cable_numbering_*` des paramètres** : la renumérotation ne les lit pas, elle lit les clés `cable_*` (parité).
- **Extrémités inter-projets acceptées sur les connexions de rack** (parité, le client fait foi). Un durcissement reste possible.
- **Outils zone et libellé en vue générale** : `POST /api/racks/general:<id>/…` répond 404 (arkyo : 500), parité.
- **Undo de la vue par lieu** local seulement (parité).
- **Interface héritée d'arkyo** : textes bruts de chargement et de liste vide (`audit-panel.tsx`, `synoptic-cable-model-dialog.tsx`, `port-adapter-picker.tsx`, `synoptic-adapter-picker.tsx`, panneau des calques), contre les règles `LoadingState` / `EmptyState`. Spinners `Loader2`. Infobulle « Double-clic pour renommer ». Repli `/api/admin/config` de `synoptic-renumber-dialog.tsx`, qui itère un objet et retombe toujours sur `FALLBACK_DEFAULTS`.

## Qualité, sans urgence

- **Serveur.**
  - `panel-rows` : chaque `GET` prend le verrou d'écriture (purge).
  - Un `PATCH {}` d'adaptateur ou de port externe touche `updatedAt` et audite le port. À l'inverse, celui d'une zone ou d'un libellé n'écrit rien, sans commentaire.
  - Connexions projet : `waypoints` / `tags` scalaires stockés bruts ; `bundleId: ""` donne 404 (arkyo : déconnexion) ; `limit` invalide testé avant le projet (400 au lieu de 404).
  - PATCH de connexion de rack : 404 avant le contrôle des composants (ordre des erreurs) ; un `PATCH` peut laisser un slot et un adaptateur sur la même extrémité (`null` garde l'ancienne valeur, parité) : le synoptique doit résoudre ce câble comme le client d'arkyo.
  - `check_endpoints` : jusqu'à 4 requêtes par connexion, soit 2 000 pour un lot de 500 (acceptable dans une transaction SQLite ; un `IN (…)` par table si l'annulation de grandes sélections devient lente).
  - Doublon transitoire de libellé : une passe de rack seule, lancée après une passe projet, peut redonner le libellé d'une `ProjectConnection` ; la passe projet suivante le corrige, et la vue par lieu finit toujours par elle. Correctif possible : amorcer les libellés pris de `rack_renumber` avec ceux des `ProjectConnection` dont `fromRackId` est le rack.
  - Renumérotation : une `quantity` en chaîne est additionnée (arkyo concatène) ; forme de l'erreur d'un `override.pad` non sûr ; troisième analyseur JS `Number()` à regrouper ; pas de test du signal pris sur l'extrémité `to`.
  - Lectures des vues générale et par lieu hors transaction (même fenêtre qu'arkyo). `SELECT *` des tables du catalogue. `Table` partagées depuis les handlers HTTP. `js_round` diffère de `Math.round` aux bornes.
  - Vue par lieu : le contrôle `loaded.is_empty()` vient après les requêtes `app_config` / `touching` / `internal` (parité du `Promise.all` d'arkyo, coût négligeable).
  - `StrLen` compte les scalaires Unicode, pas les unités UTF-16.
  - `in_use::cable` est mort.
  - Pas de test sans `X-Client-Id` pour `rack_objects2`.
- **Front (tests).**
  - `synoptique-tab.test.tsx` : `ADAPTER_UPDATE` (Rust : `ADAPTER_PATCH`) ; schémas recopiés à la main ; corps de zone partiel ; regex des entités admin incomplète.
  - `synoptic-view.test.tsx` : miroir `LABEL_UPDATE` qui accepte `line-through` ; fenêtre de l'espion `console.error`.
  - `synoptic-components.test.tsx` : filtres de validation sans assertion.
  - `property-panels.test.tsx` : curseurs choisis par index.
  - `use-validation-report.test.ts` : cas `publish: false` superficiel.
  - `theme-sweep.test.ts` : motifs `ALLOW_HEX` trop larges (`tools-synoptic.tsx`, panneaux de libellé et de zone, `synoptic-view.tsx`) ; raison faible pour la couleur d'aperçu de zone ; l'entrée `project-view-export` couvre aussi les fonds de capture (`project-view-export.tsx`, couleur de rendu documentée).
  - `synoptique-export.test.tsx` : la regex `IMPORT` ne suit que les chemins `@/` et relatifs (les imports npm nus ne sont pas parcourus, voulu).
- **Front (code).**
  - Anneau `borderColor: "white"` de `synoptic-zone-color-picker.tsx`.
  - `ring-black/10` dans la légende des signaux, presque invisible en sombre.
  - Commentaire d'habillage mal placé dans `validation-panel.tsx:76`.
  - Avertissements `INEFFECTIVE_DYNAMIC_IMPORT` du build, dont `synoptic-vector.ts`.
