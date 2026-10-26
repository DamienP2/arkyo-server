# Phase 1 — points reportés

Ce fichier liste ce que les revues de la phase 1 ont laissé en suspens. Aucun point ne bloque la v0.1.0, sauf mention contraire.

## Avant de taguer v0.1.0

- **CI et Release jamais exécutées.** Pousser, obtenir la CI verte sur macOS, Windows et Ubuntu, puis lancer Release en `workflow_dispatch`. C'est le premier vrai test de compilation du code propre à Windows, du `.msi` (WiX) et du paquet Ubuntu.
- **Test d'installation réel.** Installer le `.pkg` sur un Mac avec le pare-feu macOS actif, faire une mise à jour par dépôt de paquet puis un retour arrière, et vérifier l'accès depuis une autre machine. Si possible, faire de même avec le `.msi` et le `.tar.gz` Ubuntu.

## Sécurité et robustesse, à traiter rapidement

- **CLI lancée en root sous Linux.** Elle doit abandonner ses privilèges au profit du propriétaire du dossier de données (`setgroups`, `setgid`, `setuid`) avant d'ouvrir la base. Il reste aujourd'hui une course sur `arkyo.db` avant l'ouverture SQLite. Elle suppose que le compte `arkyo` soit déjà compromis, et ne peut produire qu'un déni de service ou une atteinte à l'intégrité.
- **Windows.** Les ACL de `%ProgramData%\Arkyo` ne sont pas resserrées (WiX `PermissionEx`).
- **Mises à jour.** Aucune exclusion mutuelle entre install, upload et rollback. Le corps d'un upload (512 Mo) est lu avant la vérification des droits. Les erreurs survenant avant le téléchargement ne remontent pas dans l'interface. Le bouton « Installer » envoie toujours `?version=`, ce qui autorise une version plus ancienne.
- **Uploads (bloquant pour la phase 2).** Il manque `X-Content-Type-Options: nosniff` et un mode sandbox pour le HTML et le SVG. Les fichiers sont lus entièrement en mémoire, sans streaming.
- **Linux.** Le compte `arkyo` possède `/opt/arkyo`, ce qui est nécessaire à la mise à jour intégrée. Conséquence : un admin web peut devenir root via `sudo arkyo-server …`. C'est documenté ; à réévaluer.
- **Reverse proxy sur le même hôte.** Tous les clients y paraissent en loopback, et la création du premier admin à distance devient possible. Il faut au moins le documenter.
- **Flux SSE.** Ils ne revérifient pas la session. À corriger avant de publier de vrais évènements (phases 3 et 7).

## Qualité, sans urgence

- **Authentification.** Course sur la création du premier admin. Loopback IPv4-mappé (`to_canonical()`). Durée de connexion qui révèle si un identifiant existe. `CurrentUser` n'est valable que dans `/api`.
- **Erreurs avalées.** Erreurs de base ignorées dans `count_of`, `site` et dans `get`/`list`/`count` des utilisateurs.
- **Tests manquants.** `require()`, `set_role` avec `UnknownRole`, garde du dernier propriétaire avec deux pools, test de clé étrangère trop faible. Côté front : confirmations d'upload et de rollback.
- **Front.** Les dépendances du `useEffect` du shim next-auth. `redirect()` ignore son type. La page `/auth/setup` reste blanche si `/api/auth/state` échoue. Helpers croisés entre les pages auth. Port 8090 codé en dur sur la page setup. Bundle à 500 kB, à découper avec `lazy()` en phase 2.
- **Divers.**
  - Les options globales sont ignorées quand `run` est précisé.
  - L'erreur de `bind` ne donne pas son contexte.
  - Le fallback SPA répond à toutes les méthodes HTTP.
  - Le corps de la 401 de `/api/events` diffère d'arkyo.
  - Les tests du tray ne tournent pas sous Linux.
  - Le dialogue du désinstalleur macOS pointe vers une icône supprimée.
  - Le journal Windows n'a pas de rotation.
  - Le tray suppose `localhost` même quand le serveur écoute sur une IP précise.
  - Bug v0.1.0 : la page Système liste les adresses d'accès avec le port 8090 même quand le serveur tourne avec un autre `--port` (les URL sont construites depuis le défaut de la configuration au lieu du port réellement lié).

## Habillage Strata Arkyo — points reportés

- **Badges sur fond `--muted`.** Le contraste n'a été vérifié que sur `--surface`. Le badge succès tombe à environ 4,0:1 sur `--muted` en clair. Il faut étendre le test avant d'utiliser des badges sur des lignes grisées (phase 2).
- **`catalog-badges.tsx`.** L'étiquette de plan « fantôme » en violet est à environ 2,7:1 en clair. À revoir quand le catalogue arrivera (phase 2).
- **Marges minces.** Badge de rôle CONSULTATION en clair (4,55:1), badges succès et alerte (4,59 et 4,61:1).
- **macOS.** Le `preinstall` supprime `/Applications/Arkyo.app` sans vérifier l'identifiant de bundle (`com.arkyo.app`).
- **Tests.**
  - Pas de test sur la couleur de bordure des toasts.
  - Le test du commentaire d'habillage ne couvre pas quatre fichiers.
  - Le compositing rgba n'est pas exercé dans `theme.test.ts`.
- **Divers.**
  - En-tête et pied des dialogues seulement en partie au style `.modal` de Strata.
  - Opacité désactivée à 0,5 au lieu de 0,4.
  - Piste d'interrupteur inactif peu visible (comme dans Strata).
  - État partagé `thread_local` dans `tools/make-icons`.
