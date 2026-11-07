# Phase 4b — points reportés

Ce fichier liste ce que la phase 4b (onglet Rack de l'éditeur projet : élévations, placement, vue par emplacement, contrôles de construction et exports Rack) a laissé en suspens : les décisions à prendre, les défauts d'arkyo à corriger et les remarques des revues. Aucun point ne bloque la phase. Les décisions de la phase sont dans `2026-11-07-phase-4b-rack.md`.

## Défauts d'arkyo corrigés par la vague de correctifs de la 4b

- **Enfant d'étagère déplacé vers une autre étagère** (`df19ba1`). `reorderShelfChild` (`rack-placement-canvas.tsx`) envoie `PATCH {parentSlotId, startU, view}`, mais `parentSlotId` ne figure pas dans l'`updateSchema` d'arkyo : l'enfant restait rattaché à son ancienne étagère et y revenait au rechargement. Le PATCH accepte désormais `parentSlotId`, vérifié comme à la création (`check_shelf` : étagère du même rack, moins de 10 enfants sans compter le slot déplacé). Il refuse en 400 un slot de premier niveau (il deviendrait un enfant supprimé par la cascade de son étagère, et sa ligne perdrait un fantôme) et le slot lui-même comme parent. Test : `move_shelf_child_to_another_shelf`.
- **Première ouverture du composeur d'export** (`0d3ca3c`). Sans composition mémorisée, l'effet « la composition suit la feuille » partait du `layout` du rendu, antérieur à l'amorce posée dans le même commit par l'effet `seed`, et sa publication l'écrasait : la feuille restait vide. « Partir de `layoutRef.current` » ne suffisait pas seul, car `addItem` n'écrivait pas le ref. Correctif : `addItem` et `commitLayout` écrivent `layoutRef.current = next` avec l'état, et l'effet de la feuille lit `layoutRef.current` (`layout` reste en dépendance pour le déclencher). Test : l'étape 1 de `composer_builds_pages_from_views` vérifie l'amorce (Baie 1, placée dans la zone utile), puis la supprime.

## Corrigés depuis la 4a

- **Panel supprimé (4a M-1)** (`99bf7f3`). `DELETE /api/panels/:id` répond 409 « Utilisé dans N contenant(s) — suppression impossible » (avec `usageCount`, N = contenants distincts) tant qu'un `RackSlot` ou une `RackInventoryItem` le référence, sur le modèle de la garde de l'adaptateur (4a I-4). Écart assumé avec arkyo, qui laissait un slot « — » ineffaçable dans l'élévation. Test : `delete_panel_in_use_refused`.
- **Transfert sans resynchronisation des fantômes (4a M-2)** (`bf09608`). Le transfert appelle `sync_inventory_slots` sur la ligne déplacée, avec la règle de la création (équipement ou panel ; un composant n'a pas de fantôme). Sans cela, la première pose dans l'onglet Rack augmentait la quantité de un. Test : `transfer_resyncs_ghosts_then_placement_claims_one`. La **fusion** avec une ligne existante de la cible reste absente, comme arkyo (deux lignes X ; le `POST` suivant fusionne dans la plus ancienne).

## À trancher par Damien

- **Pas de garde de collision côté serveur (parité).** Les routes de slots acceptent un chevauchement, un dépassement de `totalU` ou une colonne qui déborde compte tenu de `widthFraction` (par exemple `HALF` en colonne 3 ; `column` lui-même est validé dans 0..3), comme arkyo : seul le canvas refuse (`handleDragEnd`, `placeEquipment`, `findFreeColForWf`). Un durcissement possible, à condition d'exempter les enfants d'étagère (ils partagent les U de leur étagère). Tests : `overlap_is_left_to_the_canvas_like_arkyo` et l'étape 4 de `phase4b_smoke.rs`.
- **Écarts assumés avec arkyo (serveur).**
  - `NoGhost` répond 500 avec le message d'arkyo (la 4a avait mis 409 provisoirement).
  - Un échec d'audit annule l'écriture et répond 500 (slots, contrôles de construction) ; arkyo l'ignorait (`.catch(console.warn)`).
  - `canvas-data` demande `projects:read`, alors que `GET …/inventory` ne demande qu'une session : incohérence sans effet, tous les appelants ont déjà `projects:read`.
- **Contrastes de couleurs métier gardés.** Badge « Libre » en `amber-600` (≈ 3:1, 10 px) ; badge de type de `rack-info-panel.tsx:96` (≈ 2:1 en clair sur l'ambre). `DRAG_OVERLAY_ON_CATEGORY` (`text-zinc-400` sur la teinte claire de catégorie, ≈ 2,5:1). « Vue côté » (`rack-placement-canvas.tsx:2441`) est à 4,52:1, au ras du seuil : passer à `--accent-strong` si `--accent` ou `--background` change.
- **Interface héritée d'arkyo.** Texte brut « Chargement des modèles… » dans `CartouchePicker` et `PdfModelPicker` (règle `LoadingState`). Infobulles `bg-black/80` de `draggable-slot.tsx`, comme en 4a.
- **Cartouche « Standard » amorcé.** Il imprime `{client.nom}` et « Jean Dupont » (seed d'arkyo).
- **« Standard » deux fois dans la liste « Modèle » de l'export Rack (parité).** La première entrée est le cartouche intégré (`TemplateChip` « Standard », `STANDARD_MODEL_ID`, dans `rack-export.tsx`, copie identique d'arkyo) ; la seconde est le modèle d'impression amorcé de clé `STANDARD` (`seeds/print-templates.json`, gelé depuis `arkyo:app/api/supervisor/dev/seed-print-templates/route.ts`, qu'arkyo copie dans chaque espace). Le serveur ne duplique rien (une ligne par clé, ids fixes, `ON CONFLICT DO NOTHING`) : arkyo affiche la même chose avec ses données. Gardé ; `rack-export.test.tsx` vérifie les deux puces. À trancher : renommer le modèle amorcé ou masquer le doublon.
- **Réponse de `catalogue/lookup` (défaut d'arkyo, sans effet).** `use-catalog-lookup.ts` lit `res.equipment`/`adapter`/`connectorType`, alors que la route (arkyo comme arkyo-server) renvoie `{kind, items}` : le complément d'équipements de `rack-tab-side-panel.tsx` reste toujours vide. `canvas-data` porte déjà tout le catalogue actif et les équipements placés ; seul un équipement inactif non placé du BOM resterait non résolu.

## Toujours ouverts depuis la 4a

- **Transfert sans fusion (reste de M-2)** : voir « Corrigés depuis la 4a ».
- `use-rack-sync.ts` ne rattrape pas les évènements perdus pendant une reconnexion (le bus déconnecte un abonné en retard) : la liste des slots reste périmée jusqu'au prochain rafraîchissement.

## Qualité, sans urgence

- **Serveur.**
  - `rack_slots.rs` : le nom `collision_and_out_of_bounds_rejected_nothing_written` trompe (aucun refus de collision n'existe ; un commentaire de tête renvoie désormais à `overlap_is_left_to_the_canvas_like_arkyo`) ; `NoGhost` répond 500 sans `tracing::error!` ; `startU` et `heightU` n'ont pas de plafond (jusqu'à 2^53), alors que `canvas-position` borne à i32 ; un `inventoryItemId` envoyé au POST n'est pas vérifié comme appartenant au rack (le front ne l'envoie jamais) ; le module `http::projects::inventory` passe en `pub(crate)` pour deux éléments ; un `inventoryItemId` envoyé au POST écrase celui du fantôme (parité stricte).
  - `canvas_data.rs` : recherche de marque écrite deux fois ; lectures sans transaction de lecture (instantané possiblement incohérent, comme le `Promise.all` d'arkyo) ; tris par nom binaires, pas selon la collation de Postgres.
  - Tests manquants : `updatedAt` inchangé après un PATCH `{}` de position ; équipement inactif placé portant des `functionIds`.
  - Évènements `slot` sans `projectId` : chaque onglet Rack ouvert recharge `canvas-data` pour un évènement de n'importe quel projet (parité, debounce de 150 ms).
  - `heightU` sort `2.0` au lieu de `2` (colonne `REAL`).
- **Front (tests).**
  - `rack-tab.test.tsx` : branche `includeOwn` non prouvée ; flux « Vider la baie » vérifié en présence seulement ; `/Baie 1/` accepterait « Baie 10 ».
  - `rack-placement-canvas.test.tsx` : assertion `slotNode("g1")` possiblement vacuitaire ; `console.error` vérifié dans le seul test de fumée ; mock couplé aux classes Tailwind de `RackVisual`.
  - `theme-sweep.test.ts` : l'exemption `ALLOW_HEX` de `synoptic-export.ts` couvre tout hex à 6 chiffres. `rack-export.test.tsx` : la garde de marque d'`export-capture.ts` ne suit pas les fonctions appelées, et la garde de marque au niveau du source ne couvre que les 3 fichiers du composeur (la fermeture d'imports est propre aujourd'hui).
  - Corrigés par la vague (`0d3ca3c`, `20c5f3f`) : comparaison `toEqual` de nœuds DOM (`rack-export.test.tsx`, désormais `toBe` nœud par nœud) ; commentaire périmé des bouchons 4b et raison de l'ombre de la feuille (`theme-sweep.test.ts`) ; délai de 5 s d'`auth-page.test.tsx` qui échouait sous charge (le tableau de bord est chargé à la demande), porté à 15 s.
- **Front (code).** `export-with-cartouche.ts:118` parle encore de « loader CDN » (copie fidèle). Le « + » d'`equipment-card.tsx` n'est pas plafonné à 999, mais n'a pas d'appelant.
