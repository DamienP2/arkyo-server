# Phase 4a — points reportés

Ce fichier liste ce que la phase 4a (éditeur projet `/project/:id` : coquille, fiche et onglet Inventaire) a laissé en suspens. Il regroupe les chemins de code encore sans appelant, les décisions à reprendre et les remarques des revues. Aucun point ne bloque la phase. Les décisions de la phase sont dans `2026-11-06-phase-4a-editeur.md`, l'inventaire dans `2026-11-06-phase-4-inventaire.md`.

## Inaccessible avant les phases 4b à 4d

- **Routes de slots (4b).** `project-editor.tsx` appelle `PATCH` et `DELETE /api/racks/:id/slots/:slotId` (étiquettes de panel, retrait d'un slot). Ces routes n'existent pas encore et l'onglet Rack qui les déclenche est un bouchon.
  - Aucun écran n'écrit `RackConnection` ni `SynopticAdapter`. Les gardes d'usage du câble et de l'adaptateur (409) ne sont exercées que par des lignes insérées en SQL (`tests/phase4a_smoke.rs`, `tests/editor_schema.rs`).
  - La réponse 409 de `NoGhost` (inventaire) est provisoire : à confronter à la route des slots en 4b.
- **Inventaire d'un modèle (4d).** En mode modèle (`projectId` nul), `inventaire-scope.tsx` appelle `/api/racks/:id/inventory`, qui arrive avec l'éditeur de rack. De même, les sous-routes `/project/:id/inventaire/{rack/:rackId,synoptique}` restent `ComingSoon` (décision 8).
- **Modèle enregistré depuis un projet.** `save-as-template` crée un modèle `BROUILLON`, comme arkyo. Or l'assistant « Ajouter un contenant » ne propose que les modèles `ACTIF` (`GET /api/tenant/racks?templates=true`), et le seul écran qui change ce statut est le menu de l'éditeur de rack (4d). Jusqu'en 4d, aucun modèle ne peut donc être cloné depuis l'interface. La route `PATCH /api/racks/:id { templateStatus }` existe déjà.
- **Routes sans appelant** (≈ 2 645 l., inventaire §0.7, décision 3) : non portées. Cela concerne les guides, les routes `adapters`, `bundles`, `labels`, `zones`, `layout`, `canvas-data` et `focus` du synoptique projet, ainsi que `equipments` et `rack-slots`. Les 15 tables existent.
- **Phase 5.** L'en-tête des PDF de capture Réseau (`reseau/_components/shared/export-capture.ts`) dessine encore le monogramme « A » d'arkyo à côté de « Strata Arkyo ». À remplacer par `StrataBrand` quand l'onglet sera porté, en retirant aussi l'exemption de `theme-sweep.test.ts` (`EXPORT_RENDER_HEX`).

## À trancher par Damien

- **Écarts assumés avec arkyo (serveur).**
  - Un ajout d'équipement hors châssis ne fusionne plus avec un composant (`hostItemId IS NULL`). Dans arkyo, l'ajout fusionnait la ligne dans une carte.
  - Supprimer un contenant détache un modèle partagé au lieu de le supprimer. Supprimer un item retire aussi les slots de ses composants. Supprimer un lieu gère les racks virtuels partagés.
  - Le clonage copie `ExternalPort.kind` (arkyo le perdait, et un port `MONDE` devenait `INTER_LIEU`).
- **Parité gardée, discutable.**
  - Un transfert peut détacher un composant de son châssis, et sa purge des slots supprime en silence les `ProjectConnection` liées.
  - Un équipement inactif du catalogue s'ajoute à l'inventaire, comme dans arkyo.
  - Un adaptateur présent seulement dans un inventaire n'est pas « utilisé » (`assertAdapterNotInUse` ne compte que les synoptiques) : sa suppression laisse une ligne d'inventaire orpheline, que l'éditeur ignore.
  - Le clonage `fromTemplateId` reste partiel, et l'hôte d'un composant imbriqué est perdu.
- **Interface héritée d'arkyo, contraire aux règles de `CLAUDE.md`.**
  - Le filtre Marque du popover de filtres de l'inventaire est un `<select>` natif, pas un picker modal.
  - Dans `add-container-wizard.tsx`, les boutons « Ajouter » ont une bordure pointillée de 1 px (au lieu de `border-2`), et les listes vides sont un simple `<p>` au lieu d'`<EmptyState>`. On y trouve aussi le hint « Cliquez sur une ligne pour la modifier. ».
- **Contrastes.**
  - Badge de statut du projet : texte blanc sur la couleur de statut (≈ 2,1:1 sur l'ambre). C'est une couleur métier, gardée.
  - Texte d'erreur en `--destructive` à ≈ 4,0:1 : correctif transverse, par variable ou avec `--danger-text`.
  - Texte de succès de `CheckBadge` à 4,53:1, juste au-dessus du seuil.
  - Numéro de slot de `slot-ruler.tsx` au survol, sous 4,5:1.
- **Dépendance.** jsPDF 2.5.1 (version du CDN d'arkyo) entraîne `dompurify`, qui fait l'objet d'une alerte « high ». Seul `jsPDF.html()` s'en sert, et aucun export ne l'appelle.

## Qualité, sans urgence

- **Serveur.**
  - Bus d'évènements : borner la file de chaque abonné (`events.rs:116`, `mpsc` 4096 + `try_send`).
  - Tester le retrait de l'entrée par rack à la dernière désinscription. Corriger aussi le commentaire faux de `rack_events.rs:440`.
  - Inventaire : plafonner `quantity` (le maximum de l'UI) et faire une addition vérifiée (`inventory.rs`), car une quantité énorme verrouille la base pendant la synchro des slots. Documenter dans l'en-tête de `inventory.rs` l'écart « échec de synchro → 500 ».
  - Faire un rollback étiqueté dans `inventory_item.rs:311`, et supprimer le prédicat dupliqué de `locations_item.rs:303`. La parité du 400 de `reorder` reste à vérifier.
  - `hasConnectors` de `racks_template.rs` accepte aussi un tableau JSON en chaîne, sans commentaire. Toutes les lignes d'une copie (`clone.rs`) ont le même `createdAt`.
  - La route `editor` fait une requête d'inventaire par rack (51 ms pour 500 items) : regrouper si un projet compte des centaines de contenants.
- **Tests.**
  - Index en trop non détectés (`editor_schema.rs`). Le test de retour arrière ne fige pas 0001 à 0003.
  - Il manque le cas `hasConnectors` venant d'un seul slot fantôme. Le corps de la 401 de l'inventaire n'est pas vérifié.
  - `inventaire.test.tsx:330` attend 250 ms réels. `strip` de `inventaire-proprietes.test.tsx:397` ignore les chaînes.
- **Front.**
  - Il reste des imports et des états morts après le retrait des snapshots (`rack-card-canvas.tsx`, `item-properties-panel.tsx`), acceptés pour garder un diff minimal.
  - Commentaire périmé dans `theme-sweep.test.ts:283-285`. En-têtes de bouchons à harmoniser.
  - Le build avertit `INEFFECTIVE_DYNAMIC_IMPORT` pour `bom-table` et `bom-pdf` (bénin).
  - Un échec de `/api/site` fait échouer tout l'éditeur, comme pour l'éditeur de panel.
