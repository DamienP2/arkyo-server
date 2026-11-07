# Phase 4b — points reportés

Ce fichier liste ce que la phase 4b (onglet Rack de l'éditeur projet : élévations, placement, vue par emplacement, contrôles de construction et exports Rack) a laissé en suspens : les décisions à prendre, les défauts d'arkyo à corriger et les remarques des revues. Aucun point ne bloque la phase. Les décisions de la phase sont dans `2026-11-07-phase-4b-rack.md`.

## Défauts d'arkyo corrigés par la vague de correctifs de la 4b

- **Enfant d'étagère déplacé vers une autre étagère.** `reorderShelfChild` (`rack-placement-canvas.tsx`) envoie `PATCH {parentSlotId, startU, view}`, mais `parentSlotId` ne figure pas dans l'`updateSchema` d'arkyo : l'enfant reste rattaché à son ancienne étagère, et seuls les `childOrder` changent. Le serveur acceptera `parentSlotId` (commentaire `arkyo-server:` et test).
- **Première ouverture du composeur d'export.** Sans composition mémorisée, l'effet « la composition suit la feuille » estampille la composition d'avant l'amorçage et écrase le contenant posé par l'effet `seed`. Correctif : partir de `layoutRef.current` (hunk commenté et test).

## À trancher par Damien

- **Pas de garde de collision côté serveur (parité).** Les routes de slots acceptent un chevauchement, un dépassement de `totalU` ou une colonne hors bornes, comme arkyo : seul le canvas refuse (`handleDragEnd`, `placeEquipment`, `findFreeColForWf`). Un durcissement possible, à condition d'exempter les enfants d'étagère (ils partagent les U de leur étagère). Tests : `overlap_is_left_to_the_canvas_like_arkyo` et l'étape 4 de `phase4b_smoke.rs`.
- **Écarts assumés avec arkyo (serveur).**
  - `NoGhost` répond 500 avec le message d'arkyo (la 4a avait mis 409 provisoirement).
  - Un échec d'audit annule l'écriture et répond 500 (slots, contrôles de construction) ; arkyo l'ignorait (`.catch(console.warn)`).
  - `canvas-data` demande `projects:read`, alors que `GET …/inventory` ne demande qu'une session : incohérence sans effet, tous les appelants ont déjà `projects:read`.
- **Contrastes de couleurs métier gardés.** Badge « Libre » en `amber-600` (≈ 3:1, 10 px) ; badge de type de `rack-info-panel.tsx:96` (≈ 2:1 en clair sur l'ambre). « Vue côté » (`rack-placement-canvas.tsx:2441`) est à 4,52:1, au ras du seuil : passer à `--accent-strong` si `--accent` ou `--background` change.
- **Interface héritée d'arkyo.** Texte brut « Chargement des modèles… » dans `CartouchePicker` et `PdfModelPicker` (règle `LoadingState`). Infobulles `bg-black/80` de `draggable-slot.tsx`, comme en 4a.
- **Cartouche « Standard » amorcé.** Il imprime `{client.nom}` et « Jean Dupont » (seed d'arkyo).

## Toujours ouverts depuis la 4a

- **Panel supprimé (M-1)** et **transfert sans fusion ni resynchronisation des fantômes (M-2)** : non traités en 4b (voir `2026-11-06-phase-4a-suivi.md`).
- `use-rack-sync.ts` ne rattrape pas les évènements perdus pendant une reconnexion (le bus déconnecte un abonné en retard) : la liste des slots reste périmée jusqu'au prochain rafraîchissement.

## Qualité, sans urgence

- **Serveur.**
  - `rack_slots.rs` : le nom `collision_and_out_of_bounds_rejected_nothing_written` trompe (aucun refus de collision n'existe) ; le module `http::projects::inventory` passe en `pub(crate)` pour deux éléments ; un `inventoryItemId` envoyé au POST écrase celui du fantôme (parité stricte).
  - `canvas_data.rs` : recherche de marque écrite deux fois ; lectures sans transaction de lecture (instantané possiblement incohérent, comme le `Promise.all` d'arkyo) ; tris par nom binaires, pas selon la collation de Postgres.
  - Tests manquants : `updatedAt` inchangé après un PATCH `{}` de position ; équipement inactif placé portant des `functionIds`.
  - `heightU` sort `2.0` au lieu de `2` (colonne `REAL`).
- **Front (tests).**
  - `rack-tab.test.tsx` : branche `includeOwn` non prouvée ; flux « Vider la baie » vérifié en présence seulement ; `/Baie 1/` accepterait « Baie 10 ».
  - `rack-placement-canvas.test.tsx` : assertion `slotNode("g1")` possiblement vacuitaire ; `console.error` vérifié dans le seul test de fumée ; mock couplé aux classes Tailwind de `RackVisual`.
  - `theme-sweep.test.ts` : l'exemption `ALLOW_HEX` de `synoptic-export.ts` couvre tout hex à 6 chiffres. `rack-export.test.tsx` : la garde de marque d'`export-capture.ts` ne suit pas les fonctions appelées.
- **Front (code).** `export-with-cartouche.ts:118` parle encore de « loader CDN » (copie fidèle). Le « + » d'`equipment-card.tsx` n'est pas plafonné à 999, mais n'a pas d'appelant.
