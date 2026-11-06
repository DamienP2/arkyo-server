# Phase 4a — points reportés

Ce fichier liste ce que la phase 4a (éditeur projet `/project/:id` : coquille, fiche et onglet Inventaire) a laissé en suspens. Il regroupe les chemins de code encore sans appelant, les décisions à reprendre et les remarques des revues. Aucun point ne bloque la phase. Les décisions de la phase sont dans `2026-11-06-phase-4a-editeur.md`, l'inventaire dans `2026-11-06-phase-4-inventaire.md`.

## Inaccessible avant les phases 4b à 4d

- **Routes de slots (4b).** `project-editor.tsx` appelle `PATCH` et `DELETE /api/racks/:id/slots/:slotId` (étiquettes de panel, retrait d'un slot). Ces routes n'existent pas encore et l'onglet Rack qui les déclenche est un bouchon.
  - Aucun écran n'écrit `RackConnection` ni `SynopticAdapter`. Les gardes d'usage du câble et de l'adaptateur (409) ne sont exercées que par des lignes insérées en SQL (`tests/phase4a_smoke.rs`, `tests/editor_schema.rs`).
  - La réponse 409 de `NoGhost` (inventaire) est provisoire : à confronter à la route des slots en 4b.
- **Inventaire d'un modèle (4d).** En mode modèle (`projectId` nul), `inventaire-scope.tsx` appelle `/api/racks/:id/inventory`, qui arrive avec l'éditeur de rack. De même, les sous-routes `/project/:id/inventaire/{rack/:rackId,synoptique}` restent `ComingSoon` (décision 8).
- **Modèle enregistré depuis un projet.** `save-as-template` crée un modèle `BROUILLON`, comme arkyo. Or l'assistant « Ajouter un contenant » ne propose que les modèles `ACTIF` (`GET /api/tenant/racks?templates=true`), et le seul écran qui change ce statut est le menu de l'éditeur de rack (4d). Jusqu'en 4d, aucun modèle ne peut donc être cloné depuis l'interface. La route `PATCH /api/racks/:id { templateStatus }` existe déjà.
- **Routes sans appelant** (≈ 2 645 l., inventaire §0.7, décision 3) : non portées. Cela concerne les guides, les routes `adapters`, `bundles`, `labels`, `zones`, `layout`, `canvas-data` et `focus` du synoptique projet, ainsi que `equipments` et `rack-slots`. Les 15 tables existent.
- **Phase 5.** L'en-tête des PDF de capture Réseau (`reseau/_components/shared/export-capture.ts`) dessine encore le monogramme « A » d'arkyo à côté de « Strata Arkyo ». Le défaut est **masqué** par l'exemption `EXPORT_RENDER_HEX` de `theme-sweep.test.ts` : le balayage ne le signalera pas. Il faut remplacer ce monogramme par `StrataBrand` dès que l'onglet Réseau devient accessible, et retirer l'exemption au même moment.
- **Panel supprimé (M-1, 4b).** `RackInventoryItem.panelId` et `RackSlot.panelId` sont en `ON DELETE SET NULL`, et `DELETE /api/panels/:id` (`http/panels.rs:519`) supprime sans garde d'usage (parité). La ligne d'inventaire perd toute référence et `enrich_rows` l'ignore. Ses slots fantômes gardent `inventoryItemId`, mais `sync_inventory_slots` sort tout de suite sur `(None, None)` (`sync.rs:131-138`) : ils ne sont jamais nettoyés, comptent dans `slotsCount` et réapparaîtront en 4b et 4c comme fantômes sans équipement. En 4b : garde d'usage du panel, ou purge des slots dont l'item n'a plus de référence.
- **Transfert (M-2, 4b).** Le transfert (`inventory_item.rs:452-470`) ne fusionne pas dans la cible et ne resynchronise pas les fantômes (parité). Transférer 3 × X vers un contenant qui a déjà X donne deux lignes X (le `POST` suivant fusionnera dans la plus ancienne), et la ligne transférée a `quantity` = 3 mais 0 slot, ce qui casse l'invariant « quantity slots par ligne » jusqu'au prochain PATCH de quantité. À revoir quand 4b consommera les fantômes.
- **Contenant partagé détaché (M-3, plan 4c).** Seul `RigRack` est supprimé (`racks_item.rs:224-245`). En 4c, les `ProjectConnection`, `ProjectSynopticLayout`, etc. du projet qui visent ce rack resteraient et désigneraient un rack hors du projet : les purger dans la branche « partagé ».

## À trancher par Damien

- **Écarts assumés avec arkyo (serveur).**
  - Un ajout d'équipement hors châssis ne fusionne plus avec un composant (`hostItemId IS NULL`). Dans arkyo, l'ajout fusionnait la ligne dans une carte.
  - Supprimer un contenant détache un modèle partagé au lieu de le supprimer. Supprimer un item retire aussi les slots de ses composants. Supprimer un lieu gère les racks virtuels partagés.
  - Le clonage copie `ExternalPort.kind` (arkyo le perdait, et un port `MONDE` devenait `INTER_LIEU`).
  - `quantity` d'une ligne d'inventaire plafonnée à 999 (POST, PATCH, fusion) ; le dialogue de quantité a le même maximum. arkyo n'avait pas de plafond, mais une transaction SQLite verrouille toute la base pendant la création des slots fantômes.
  - Un adaptateur présent dans un inventaire n'est plus supprimable : la garde compte aussi `RackInventoryItem` (arkyo ne comptait que les synoptiques, et la ligne disparaissait en silence du BOM et des exports). Le 409 dit « Utilisé dans N synoptique(s) ou inventaire(s) ».
  - Bus d'évènements : un abonné en retard de 4096 évènements (flux `/api/events` ou par rack) est déconnecté, et son `EventSource` se reconnecte. arkyo empilait sans limite ; le front ne resynchronise pas à la reconnexion.
  - Un échec de synchronisation des slots fantômes donne 500 et annule la requête (arkyo l'ignorait).- **Parité gardée, discutable.**
  - Un transfert peut détacher un composant de son châssis, et sa purge des slots supprime en silence les `ProjectConnection` liées.
  - Un équipement inactif du catalogue s'ajoute à l'inventaire, comme dans arkyo.
  - Le clonage `fromTemplateId` reste partiel, et l'hôte d'un composant imbriqué est perdu.
- **Interface héritée d'arkyo, contraire aux règles de `CLAUDE.md`.**
  - Le filtre Marque du popover de filtres de l'inventaire est un `<select>` natif, pas un picker modal.
  - Dans `add-container-wizard.tsx`, les boutons « Ajouter » ont une bordure pointillée de 1 px (au lieu de `border-2`), et les listes vides sont un simple `<p>` au lieu d'`<EmptyState>`. On y trouve aussi le hint « Cliquez sur une ligne pour la modifier. ».
- **Garde d'écriture côté serveur seulement (M-4, parité).** Le layout `project/[id]/layout.tsx:27` ne garde que `projects:read`, et aucun composant de l'éditeur ne masque ses contrôles d'écriture. Un utilisateur « consultation » voit « Ajouter », le glisser-déposer, etc., et reçoit un toast 403 « Accès refusé » à chaque action. Comportement assumé (décision 4 : garde serveur plus stricte qu'arkyo).
- **Contrastes.**
  - Badge de statut du projet : texte blanc sur la couleur de statut (≈ 2,1:1 sur l'ambre). C'est une couleur métier, gardée.
  - Texte d'erreur : corrigé. Les usages texte de `--destructive` sont passés sur `--danger-text` (`#ff4d6a` en sombre), et `theme-sweep.test.ts` interdit d'en réintroduire.
  - Texte de succès de `CheckBadge` à 4,53:1, juste au-dessus du seuil.
  - Numéro de slot de `slot-ruler.tsx` au survol, sous 4,5:1.
- **Dépendance.** jsPDF 2.5.1 (version du CDN d'arkyo) entraîne `dompurify`, qui fait l'objet d'une alerte « high ». Seul `jsPDF.html()` s'en sert, et aucun export ne l'appelle.

## Qualité, sans urgence

- **Serveur.**
  - Ordre des clés JSON différent de `JSON.stringify` (T2-5) : sans effet pour un client qui parse le JSON.
  - `RefError::Db` dit « Erreur interne » (T3-1) ; la route le remappe déjà en 500 journalisé (`inventory.rs`, `ref_error`).
  - `weightKg` sort `4.0` au lieu de `4` pour un entier (T3-2).
  - Branche morte `racks.rs:112` (T6-3). Toutes les lignes d'une copie (`clone.rs`) ont le même `createdAt`.
  - La route `editor` fait une requête d'inventaire par rack (51 ms pour 500 items) : regrouper si un projet compte des centaines de contenants. Sa trace `eprintln!` de durée (test `large_project_under_2s`) s'affiche avec `--nocapture`.
  - La parité du 400 de `reorder` est vérifiée (revue finale) : clos.
- **Tests.**
  - Index en trop non détectés (`editor_schema.rs`). Le test de retour arrière ne fige pas 0001 à 0003.
  - `inventaire.test.tsx:330` attend 250 ms réels.
  - Le mock de dépôt du glisser-déposer ignore les coordonnées (T11-2).
- **Historique.** Le commit brut `9f5e11f` ne compile pas seul (T11-3) : à sauter lors d'un `git bisect`.
- **Front.**
  - Il reste des imports et des états morts après le retrait des snapshots (`rack-card-canvas.tsx`, `item-properties-panel.tsx`), acceptés pour garder un diff minimal.
  - Le build avertit `INEFFECTIVE_DYNAMIC_IMPORT` pour `bom-table` et `bom-pdf` (bénin).
  - Un échec de `/api/site` fait échouer tout l'éditeur, comme pour l'éditeur de panel.

## Corrigé par la vague de correctifs finale

- Attentes de premier montage portées à 15 s dans les cinq suites web de 4a ; `router.test.tsx` importe d'avance ses pages lazy (I-1).
- Plafond de `quantity` (I-2), texte d'erreur sur `--danger-text` (I-3), garde d'usage de l'adaptateur (I-4), files SSE bornées (T2-1) et test du retrait de l'entrée par rack (T2-2).
- En-têtes et commentaires : écart « échec de synchro → 500 » (`inventory.rs`, `inventory_item.rs`), renvoi à `rack_shared_outside` (`locations_item.rs`), branche « JSON en chaîne » de `hasConnectors`, `rack_events.rs`, `inventory_services.rs`, `theme-sweep.test.ts`.
- Tests : corps de la 401 de l'inventaire, 409 « Slot occupé » du parcours, `hasConnectors` venant d'un seul slot fantôme, redirection intermédiaire `?tab=fiche` (T9-1), `strip` limité aux commentaires de début de ligne.
