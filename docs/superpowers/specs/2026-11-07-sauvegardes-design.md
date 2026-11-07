# Sauvegardes, import et export : conception

Ajout propre à Strata Arkyo (arkyo n'a ni export de projet ni sauvegarde du site : son backup ne couvre que le catalogue). Demande de Damien : « dans Système, je veux pouvoir sauvegarder des projets pour pouvoir les réimporter en cas de problème ; le projet doit pouvoir être remis à tout moment », contre **les deux** risques : une erreur humaine (projet abîmé ou supprimé) et la perte du serveur. Il veut aussi exporter et importer panels et modèles. Damien a demandé d'arrêter les questions : tout ce qui suit marqué *(choix)* est une décision du concepteur.

## 1. Objectifs

1. **Points de restauration de projet** sur le serveur : automatiques et manuels ; un projet (même supprimé) se remet en deux clics à l'état d'un point.
2. **Export / import d'objets** en fichier `.arkyo` : projet, contenant (rack de la bibliothèque), régie modèle, panel. Le fichier se réimporte sur le même serveur ou sur une autre installation.
3. **Sauvegarde complète du site** (base, fichiers envoyés, réglages) : manuelle, téléchargeable, et automatique quotidienne dans un dossier réglable ; restauration sur une nouvelle installation.
4. Le format d'objet sert aussi plus tard à l'import d'un tenant arkyo (§8 de la spec principale) : l'outil de reprise produira des objets dans ce même format.

Non-objectifs : synchronisation entre serveurs, versionnage fin (diff, historique par champ), sauvegarde vers un service en ligne, chiffrement des fichiers.

Anti-objectifs : une restauration qui écrase sans filet (toute restauration en place prend d'abord un point de l'état courant) ; un import qui modifie le catalogue existant (il n'ajoute que ce qui manque) ; un fichier qui ne se relit plus après une mise à jour (les colonnes inconnues sont ignorées, les manquantes prennent leur valeur par défaut, comme la règle des migrations additives).

## 2. Où ça vit

- Serveur : module `crates/arkyo-server/src/transfer/` (code neuf, pas de copie d'arkyo), routes sous `/api/system/backups/…` et `/api/system/transfer/…`, garde `settings:admin` (comme la page Système). CLI : `arkyo-server backup` et `arkyo-server restore <fichier>`.
- Front : nouvelle section **« Sauvegardes »** dans `web/src/app/(app)/admin/systeme/` (page propre à arkyo-server), rendue dans les deux interfaces (la page est déjà partagée). Composants partagés : `EmptyState`, `LoadingState`, `useConfirm`, `useToast`, `ActionButton`, `InfoCard`. *(choix)* Pas d'action d'export dans les listes copiées d'arkyo (projets, panels, modèles) : tout passe par Système, aucun fichier copié n'est touché.

## 3. Format `.arkyo` (objets)

Archive zip :

- `manifest.json` : `{ "format": "arkyo-server-transfer", "version": 1, "appVersion", "createdAt", "createdBy": {id,name,email}, "roots": [{ "kind": "project"|"rack"|"rig"|"panel", "id", "name" }], "counts": { "<Table>": n } }` ;
- `data.json` : `{ "<Table>": [ { <colonne>: <valeur SQLite brute> } ] }`, noms de tables et de colonnes de la base (ceux de Prisma), valeurs telles que stockées (TEXT, INTEGER, REAL, NULL ; JSON en texte) ;
- `uploads/<chemin>` : les fichiers de `<data>/uploads` référencés par une valeur `"/uploads/…"` d'une ligne exportée.

Un fichier peut contenir plusieurs racines (export groupé).

### 3.1 Graphe de chaque racine

Déclaré une seule fois dans `transfer/graph.rs` (table → requête de sélection à partir des ids parents). Un test parcourt `sqlite_master` et exige que **chaque table** soit classée : *possédée* (par projet, contenant, régie ou panel), *catalogue*, *système* (exclue) ; une phase qui ajoute une table doit la classer.

- **Projet** : `Project`, `TechnicalSheet`, `ProjectDocument`, `Task`, `Message`, `Location`, `RigConfig` (projectId), `RigRack`, `ProjectEquipment`, `ProjectSynopticAdapter`, `ProjectCableBundle`, `ProjectConnection`, `ProjectSynopticZone`, `ProjectSynopticLabel`, `SynopticGuide` (projectId), `ProjectSynopticLayout`, les lignes `AuditLog` du projet (même périmètre que `GET /api/tenant/projects/:id/audit`), et le graphe **contenant** de chaque rack du projet (racks de ses régies et racks rattachés à ses lieux).
- **Contenant** : `Rack`, `RackSlot`, `RackInventoryItem`, `RackSlotPanelRow`, `RackZone`, `RackLabel`, `CableBundle`, `SynopticAdapter`, `ExternalPort`, `RackConnection`, `SynopticGuide` (rackId), `AuditLog` du rack.
- **Régie** : `RigConfig`, `RigRack` et le graphe contenant de ses racks.
- **Panel** : `Panel`, `PanelSlot`.
- **Dépendances** ajoutées à toute racine : les `Panel` (+ `PanelSlot`) référencés par `RackSlot.panelId` / `RackInventoryItem.panelId` ; le catalogue référencé (§3.2) ; les utilisateurs auteurs (en `manifest`, pas en lignes).

### 3.2 Catalogue

*(choix)* Les référentiels (`TenantBrand`, `TenantConnectorType`, `TenantSignalType`, `TenantEquipmentCategory`, `TenantFunction`, `TenantType`, `TenantPhase`, `TenantDimensionPreset`, `TenantCableModel`) sont petits : ils partent en entier. Les équipements, adaptateurs et câbles ne partent que s'ils sont référencés (`catalogEquipmentId`, `catalogAdapterId`, `catalogCableModelId`, `catalogConnectorTypeId`, et les `TenantEquipmentComponent` des équipements exportés, avec les équipements qu'ils désignent). À l'import, une ligne de catalogue n'est **insérée que si son id manque** ; une ligne existante n'est jamais modifiée.

## 4. Import

`POST /api/system/transfer/inspect` (fichier) → aperçu : racines, comptes, conflits (racine dont l'id existe déjà ici). Puis `POST /api/system/transfer/import` avec, par racine, le mode :

- **absente ici** → insertion avec les mêmes ids ;
- **présente** → au choix *Remplacer* (point de restauration automatique de l'état courant, suppression du graphe actuel, insertion du fichier, mêmes ids) ou *Copie* (tous les ids possédés sont renouvelés, nom suffixé « (copie) »).

Règles communes :

- une seule transaction (`db::begin_immediate`) pour tout l'import ; en cas d'erreur, rien n'est écrit ;
- insertion colonne par colonne avec les seules colonnes qui existent ici (fichier plus récent toléré) ; une colonne absente du fichier prend sa valeur par défaut ;
- *(choix)* renouvellement des ids en mode Copie par remplacement textuel de chaque ancien id par le nouveau dans **toutes** les valeurs texte du graphe possédé (colonnes et JSON) : les ids sont des cuid uniques, ce qui couvre aussi les ids rangés dans du JSON ;
- auteurs (`createdById`, `assignedToId`, `userId`…) inconnus ici → l'utilisateur qui importe (comme la restauration du catalogue) ;
- `Rack.cableId` (unique par site) : conservé s'il est libre, sinon réattribué au prochain libre ;
- fichiers `uploads/` copiés s'ils manquent (jamais d'écrasement) ;
- `AuditLog` : une ligne `IMPORT` par racine ; évènements temps réel `project`/`rack`/`panel`/`rig` `created` ou `updated` pour rafraîchir les listes ouvertes ;
- rapport renvoyé : par racine, mode, comptes insérés, éléments de catalogue ajoutés, fichiers copiés, avertissements.

## 5. Points de restauration de projet

- Stockés en fichiers `.arkyo` (une racine projet) dans `<data>/backups/projects/<projectId>/<horodatage>-<auto|manuel|avant-restauration>.arkyo`, avec un index `points.json` par projet (date, type, auteur, nom du projet, empreinte, taille). Ils survivent à la suppression du projet.
- *(choix)* **Automatique** : une tâche de fond toutes les heures exporte chaque projet ; si l'empreinte SHA-256 de `data.json` est identique au dernier point, rien n'est écrit. Rétention : les 48 derniers points automatiques par projet ; les points manuels sont gardés jusqu'à suppression ; les points « avant restauration » suivent la règle des automatiques.
- **Manuel** : « Créer un point » sur un projet (avec un libellé facultatif).
- **Restaurer** un point = import en mode *Remplacer* (ou insertion si le projet a été supprimé), donc point « avant restauration » d'abord. **Télécharger** un point = le fichier `.arkyo`. **Supprimer** un point (confirmation).
- Réglages (AppConfig `backups.projects`) : activé (oui), intervalle (1 h ; 1 h, 6 h, 24 h), rétention (48).

## 6. Sauvegarde complète du site

- Archive `Arkyo-site-<horodatage>.zip` : `arkyo.db` (copie cohérente par `VACUUM INTO`), `uploads/`, `config.json`, `backups/projects/` *(choix : inclus, pour retrouver les points après une perte du serveur)*, `manifest.json` (`format: "arkyo-server-site"`, version, appVersion, createdAt, numéro de la dernière migration).
- **Manuelle** : « Sauvegarder le site maintenant », puis téléchargement. **Automatique** : *(choix)* chaque jour à 3 h (heure locale du serveur), dossier de destination réglable (défaut `<data>/backups/site`, idéalement un disque ou un partage réseau), rétention 7. Réglages (AppConfig `backups.site`).
- **Restauration** : depuis Système (envoi du `.zip`) ou `arkyo-server restore <fichier>`. Le fichier est vérifié (manifest, base lisible, migration pas plus récente que le binaire… une base plus récente est tolérée selon la règle additive, mais signalée), déposé en `<data>/restore-pending.zip`, puis appliqué **au démarrage** suivant : les données actuelles partent dans `<data>/before-restore-<horodatage>/`, l'archive est dépliée, les migrations s'appliquent. Depuis Système, le serveur redémarre comme après une mise à jour.
- `arkyo-server backup [--out <dossier>]` produit la même archive (service arrêté ou non).

## 7. Écran « Sauvegardes » (Système)

Trois blocs, dans l'ordre :

1. **Points de restauration** : liste des projets (y compris supprimés ayant des points), recherche ; par projet, ses points (date, type, auteur, taille) avec Restaurer, Télécharger, Supprimer ; bouton « Créer un point ». Réglages automatiques repliés.
2. **Exporter / importer** : choix des objets (onglets Projets, Contenants, Régies, Panels ; cases à cocher), « Exporter » → `.arkyo` ; « Importer un fichier » → aperçu (racines, comptes, conflits avec le choix Remplacer / Copie), « Importer » → rapport.
3. **Sauvegarde du site** : dernière sauvegarde, « Sauvegarder maintenant », liste des archives avec Télécharger, réglages automatiques (heure, dossier, rétention) ; « Restaurer une sauvegarde du site » (envoi, vérification, confirmation, redémarrage).

Sobriété, composants partagés, textes en français, couleurs d'interface en variables.

## 8. Laissé au builder

Découpage interne des modules, noms des routes sous `/api/system/`, forme exacte des JSON de l'aperçu et du rapport, détail de la présentation dans les blocs.
