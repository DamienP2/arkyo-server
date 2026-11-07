# Phase 4c — points reportés

Ce fichier liste ce que la phase 4c (onglet Synoptique de l'éditeur projet : vues générale et par lieu, objets du synoptique, connexions de rack et de projet, renumérotation, audit, validation et exports) a laissé en suspens. Aucun point ne bloque la phase. Les décisions sont dans `2026-11-08-phase-4c-synoptique.md`. Le parcours de bout en bout est `crates/arkyo-server/tests/phase4c_smoke.rs`.

## Défauts d'arkyo à corriger par la vague de correctifs

- **Renumérotation complète relancée** (`onlyUnlabelled: false`, sélection ou décochage). Les libellés actuels des câbles renumérotés comptent comme pris : une seconde passe décale tout. Correctif : retirer ces libellés de l'ensemble « pris », avec un commentaire, puis inverser le test `full_rerun_skips_labels_already_taken`. Le mode par défaut (`onlyUnlabelled: true`) est stable : étape 4 du parcours.
- **Touche V dans la vue par lieu** : boucle de mise à jour infinie. Passer le `test.fails` de `synoptique-tab.test.tsx` en test normal.
- **Placeholder « Libellé… »** : les séquences d'échappement s'affichent telles quelles.

## À trancher par Damien

- **Câble entre deux contenants d'un même lieu (parité).** Dans la vue par lieu, `location-canvas.tsx` envoie tout câble entre deux contenants différents à `POST …/synoptic/connections`. Or cette route refuse deux contenants du même lieu (400 « Les deux extrémités sont dans le même emplacement… »). Le rack virtuel du lieu porte le `locationId`, donc tout câble entre contenants, ou entre un contenant et un équipement libre, échoue (toast « Échec de la pose du câble »). Même chose dans arkyo, côté front comme côté serveur. Pour corriger, il faudrait créer une `RackConnection` (les extrémités peuvent être dans un autre rack, parité de la Task 3). Ce cas est vérifié par l'étape 3 du parcours.
- **Faisceau créé dans la vue par lieu (parité).** « Créer un faisceau » poste les câbles choisis vers le pivot (rack virtuel). Seuls les câbles du pivot y entrent (`updateMany where {rackId}`). Les câbles des contenants sont marqués côté client puis perdus au rechargement. Ce cas est vérifié par l'étape 2bis du parcours.
- **Libellés en double entre rack et projet (parité).** La renumérotation projet ne lit pas les libellés des câbles de rack. Un câble inter-lieux peut donc recevoir le libellé d'un câble de contenant (« R2-20001 » deux fois dans le parcours).
- **Clés `cable_numbering_*` des paramètres** : la renumérotation ne les lit pas, elle lit les clés `cable_*` (parité).
- **Extrémités inter-projets acceptées sur les connexions de rack** (parité, le client fait foi). Un durcissement reste possible.
- **Outils zone et libellé en vue générale** : `POST /api/racks/general:<id>/…` répond 404 (arkyo : 500), parité.
- **Undo de la vue par lieu** local seulement (parité).
- **Audit « Utilisateur inconnu »** (parité) : les lignes d'audit n'ont pas d'utilisateur. Pour afficher le nom, il faudrait joindre `User` dans `audit_read.rs` (écart volontaire de forme).
- **Interface héritée d'arkyo** : textes bruts de chargement et de liste vide (`audit-panel.tsx`, `synoptic-cable-model-dialog.tsx`, `port-adapter-picker.tsx`, `synoptic-adapter-picker.tsx`, panneau des calques), contre les règles `LoadingState` / `EmptyState`. Spinners `Loader2`. Infobulle « Double-clic pour renommer ». Repli `/api/admin/config` de `synoptic-renumber-dialog.tsx`, qui itère un objet et retombe toujours sur `FALLBACK_DEFAULTS`.

## Qualité, sans urgence

- **Serveur.**
  - `panel-rows` : chaque `GET` prend le verrou d'écriture (purge).
  - Un `PATCH {}` d'adaptateur ou de port externe touche `updatedAt` et audite le port. À l'inverse, celui d'une zone ou d'un libellé n'écrit rien, sans commentaire.
  - Connexions projet : `waypoints` / `tags` scalaires stockés bruts ; `bundleId: ""` donne 404 (arkyo : déconnexion) ; `limit` invalide testé avant le projet (400 au lieu de 404).
  - PATCH de connexion de rack : 404 avant le contrôle des composants (ordre des erreurs).
  - Renumérotation : une `quantity` en chaîne est additionnée (arkyo concatène) ; forme de l'erreur d'un `override.pad` non sûr ; troisième analyseur JS `Number()` à regrouper ; pas de test du signal pris sur l'extrémité `to`.
  - Lectures des vues générale et par lieu hors transaction (même fenêtre qu'arkyo). `SELECT *` des tables du catalogue. `Table` partagées depuis les handlers HTTP. `js_round` diffère de `Math.round` aux bornes.
  - `StrLen` compte les scalaires Unicode, pas les unités UTF-16.
  - `in_use::cable` est mort.
  - Pas de test sans `X-Client-Id` pour `rack_objects2`.
- **Front (tests).**
  - `synoptique-tab.test.tsx` : `ADAPTER_UPDATE` (Rust : `ADAPTER_PATCH`) ; schémas recopiés à la main ; corps de zone partiel ; regex des entités admin incomplète ; `test.fails` trop large.
  - `synoptic-view.test.tsx` : miroir `LABEL_UPDATE` qui accepte `line-through` ; fenêtre de l'espion `console.error`.
  - `synoptic-components.test.tsx` : filtres de validation sans assertion.
  - `property-panels.test.tsx` : curseurs choisis par index.
  - `use-validation-report.test.ts` : cas `publish: false` superficiel.
  - `theme-sweep.test.ts` : motifs `ALLOW_HEX` trop larges (`tools-synoptic.tsx`, panneaux de libellé et de zone, `synoptic-view.tsx`) ; raison faible pour la couleur d'aperçu de zone.
- **Front (code).**
  - Anneau `borderColor: "white"` de `synoptic-zone-color-picker.tsx`.
  - `ring-black/10` dans la légende des signaux, presque invisible en sombre.
  - Commentaire d'habillage mal placé dans `validation-panel.tsx:76`.
  - Avertissements `INEFFECTIVE_DYNAMIC_IMPORT` du build, dont `synoptic-vector.ts`.
