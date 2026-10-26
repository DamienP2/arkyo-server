# Installer le serveur Strata Arkyo

Le serveur Strata Arkyo tient dans **un seul exécutable**, `arkyo-server` (le nom affiché change, pas les noms techniques : exécutable, service, dossiers de données, paquets `Arkyo-<version>-…`). Il contient l'API, la base SQLite et la web app. Il n'a besoin ni de Node, ni de Postgres, ni de Redis, ni de navigateur sur le serveur.

| OS | Paquet | Service | Données | Journaux |
| --- | --- | --- | --- | --- |
| Ubuntu 22.04 ou plus récent x86_64 (serveur) | **`Arkyo-<version>-ubuntu-x64.tar.gz`** | systemd `arkyo-server` (compte système `arkyo`) | `/var/lib/arkyo` | `journalctl -u arkyo-server -f` |
| macOS 11 ou plus récent (Apple Silicon / Intel) | **`Arkyo-<version>-macos-universal.dmg`** (ou le `.pkg` seul) | launchd `com.arkyo.server` | `/Library/Application Support/Arkyo` | `/Library/Logs/Arkyo/arkyo-server.log` |
| Windows 10+ / Server 2016+ x64 | **`Arkyo-<version>-windows-x64.msi`** | service Windows `arkyo-server` (démarrage auto, redémarrage sur échec) | `C:\ProgramData\Arkyo` | `C:\ProgramData\Arkyo\logs\arkyo-server.log` |

Les paquets sont produits par la CI (`.github/workflows/release.yml`) à chaque tag `v*`, avec les paquets de mise à jour (`Arkyo-<version>-<plateforme>`, le serveur seul) que les serveurs installés téléchargent.

Le port par défaut est **8090** et le serveur écoute sur `0.0.0.0` (toutes les interfaces). Ces deux réglages sont dans `config.json`, dans le dossier de données.

## Windows : installateur MSI

Double-cliquez sur **`Arkyo-<version>-windows-x64.msi`**. Le MSI :
- copie le serveur et l'application de la zone de notification dans `C:\Program Files\Arkyo` et ajoute le dossier au `PATH` ;
- crée le service `arkyo-server` (démarrage automatique, redémarrage en cas d'échec) et le démarre ;
- ajoute la règle de pare-feu **« Arkyo Server (TCP 8090) »** ;
- ajoute au menu Démarrer le dossier *Strata Arkyo* : *Strata Arkyo*, *Strata Arkyo (navigateur)* et *Désinstaller Strata Arkyo*. Le service s'affiche « Strata Arkyo Server » dans la console Services (son nom technique reste `arkyo-server`) ; le dossier d'installation reste `C:\Program Files\Arkyo`.

> **Pare-feu : la règle est fixée au port TCP 8090.** Si vous changez le port dans `config.json`, adaptez la règle à la main (Pare-feu Windows Defender avec fonctions avancées de sécurité, règle entrante « Arkyo Server (TCP 8090) »), sinon les autres machines n'atteindront plus le serveur.

Une version plus récente s'installe par-dessus (données conservées). Désinstallation : *Paramètres → Applications*, ou le raccourci *Désinstaller Strata Arkyo* du menu Démarrer. Les données de `C:\ProgramData\Arkyo` sont conservées.

## macOS : image disque .dmg

1. Ouvrez **`Arkyo-<version>-macos-universal.dmg`**.
2. Double-cliquez sur le `.pkg` et suivez l'assistant.

L'installateur place :
- le serveur dans `/usr/local/arkyo/arkyo-server` (lien `/usr/local/bin/arkyo-server`), lancé comme service launchd `com.arkyo.server` au démarrage du Mac ;
- **Strata Arkyo.app** (icône de la barre des menus, lancée à l'ouverture de session) et **Uninstall Strata Arkyo.app** (affichée « Désinstaller Strata Arkyo » dans un Finder en français) dans `/Applications`. Une mise à jour depuis la v0.1.0 supprime l'ancienne `/Applications/Arkyo.app` ;
- une règle du pare-feu macOS pour le serveur, quand le pare-feu est actif ;
- une règle `sudoers` (`/etc/sudoers.d/arkyo`) qui permet aux administrateurs de démarrer et d'arrêter le service depuis l'icône **sans mot de passe**. Elle ne couvre que `arkyo-server service start` et `service stop`.

> Tant que le paquet n'est pas signé et notarisé, macOS affiche « développeur non identifié » : *Réglages Système → Confidentialité et sécurité → Ouvrir quand même*. La CI signe et notarise dès que les secrets Apple (`MACOS_CERTS_P12`, `MACOS_CERTS_PASSWORD`, `MACOS_APP_IDENTITY`, `MACOS_INSTALLER_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`) sont configurés dans le dépôt.

Désinstallation : **Uninstall Strata Arkyo.app** (dans `/Applications`), ou `sudo /usr/local/arkyo/uninstall.sh` (`--purge` pour effacer aussi les données).

## Ubuntu (serveur)

```bash
tar xzf Arkyo-*-ubuntu-x64.tar.gz && cd Arkyo-*/
sudo ./install.sh                      # options : --port 8090 --bind 0.0.0.0 --data-dir /srv/arkyo
```
Le binaire est copié dans `/opt/arkyo` (lien `/usr/local/bin/arkyo-server`) ; le service systemd `arkyo-server` tourne sous le compte système `arkyo`, qui stocke ses données dans `/var/lib/arkyo`.

> **Compromis de sécurité.** Pour que la mise à jour depuis la web app fonctionne, `install.sh` donne la propriété de **`/opt/arkyo`** au compte `arkyo` (`chown -R arkyo:arkyo /opt/arkyo`) : le serveur peut donc remplacer son propre programme. Rien d'autre sur le système ne lui est donné. Une faille du serveur permettrait en revanche de modifier ce programme.

Désinstallation : `sudo ./uninstall.sh` (`--purge` pour supprimer aussi `/var/lib/arkyo` et le compte `arkyo`).

## Après l'installation

1. Ouvrez `http://localhost:8090` **sur le serveur lui-même** et créez le compte administrateur : cette page n'est proposée que depuis la machine du serveur. À distance ou sans écran, utilisez la ligne de commande :
   ```bash
   sudo arkyo-server user add admin@exemple.fr --name "Admin"              # macOS
   sudo -u arkyo arkyo-server user add admin@exemple.fr --name "Admin"     # Ubuntu
   ```
   (dans un terminal administrateur sous Windows). Le mot de passe est demandé deux fois. Sous Ubuntu, `-u arkyo` est la forme recommandée ; lancée avec `sudo` seul, la commande rend ensuite les fichiers de base au propriétaire du dossier (`arkyo`), pour que le service puisse toujours les ouvrir. Par sécurité, elle refuse alors de s'exécuter si `arkyo.db`, `arkyo.db-wal` ou `arkyo.db-shm` n'est pas un fichier ordinaire (lien symbolique ou physique), et ne touche jamais à un tel fichier.
2. Créez ensuite les autres comptes (rôles `owner`, `chef-projet`, `technicien`, `consultation` ou rôle personnalisé) : `arkyo-server user add <email> --role technicien`.
3. Un compte créé avec **`--temporary`** (`user add` ou `user passwd`) doit **changer son mot de passe à sa première connexion**. À utiliser quand l'administrateur choisit le mot de passe d'un tiers.
4. Les autres machines utilisent `http://<serveur>:8090/`. L'écran **Système** (administrateurs) affiche la version, le dossier de données et les adresses d'accès.

## Gérer les comptes

```
arkyo-server user list
arkyo-server user passwd <email|identifiant> [--temporary]
arkyo-server user disable <email|identifiant>
arkyo-server user enable  <email|identifiant>
arkyo-server user remove  <email|identifiant>
```

Ces commandes (à lancer comme ci-dessus : `sudo` sur macOS, `sudo -u arkyo` sous Ubuntu) agissent sur le dossier de données du service s'il est installé (il contient un `config.json`), sinon sur celui de l'utilisateur courant. `--data-dir <dossier>` (ou `ARKYO_DATA_DIR`) cible un autre dossier. Si le dossier du service existe mais n'est pas lisible par le compte courant (sous Ubuntu, sans `sudo`), la commande s'arrête avec une erreur au lieu de viser le dossier personnel. `user passwd` ferme aussi toutes les sessions ouvertes du compte.

## Gérer le service

Les mêmes commandes sur les trois OS (avec `sudo`, ou dans un terminal administrateur sous Windows) :

```
arkyo-server service status
arkyo-server service stop
arkyo-server service start
arkyo-server service uninstall            # les données sont conservées
arkyo-server service install --port 8090 --bind 0.0.0.0 --data-dir <dossier>
```

`--port` et `--bind` sont enregistrés dans `config.json` avant le premier démarrage. Pour les changer plus tard, modifiez `config.json` puis redémarrez le service (`service stop`, `service start`).

## Dossiers de données

| Contexte | Dossier |
| --- | --- |
| Service Windows | `C:\ProgramData\Arkyo` |
| Service macOS | `/Library/Application Support/Arkyo` |
| Service Linux | `/var/lib/arkyo` |
| Lancement au premier plan (`arkyo-server run`) | dossier de données de l'utilisateur (`~/Library/Application Support/com.Arkyo.Arkyo` sur macOS, `~/.local/share/arkyo` sur Linux, `%APPDATA%\Arkyo\Arkyo\data` sur Windows) |

`ARKYO_DATA_DIR` (ou `--data-dir`) remplace le dossier dans tous les cas. Il contient :

- `arkyo.db` : la base SQLite (mode WAL : `arkyo.db-wal` et `arkyo.db-shm` à côté sont normaux) ;
- `config.json` : `port` et `bind` ;
- `uploads/` : les fichiers déposés ;
- `update/` : réglages de mise à jour, paquets téléchargés.
- `logs/` (service Windows) : `arkyo-server.log`, le journal du service.

La base contient les empreintes des mots de passe : `arkyo.db` est créé en `0600` (lisible par le seul compte du service) et l'installation du service restreint le dossier (`0700` sous Linux, avec `UMask=0077` dans l'unité systemd ; `0711` sous macOS, où l'application de la barre des menus lit `config.json`).

**Sauvegarde** : arrêtez le service (`service stop`) puis copiez le dossier entier.

## Mettre à jour sans désinstaller

La carte **Mises à jour** de l'écran **Système** (administrateurs) met le serveur à jour sur place : données, comptes et réglages ne bougent pas.

- **En ligne** : *Vérifier* interroge les releases GitHub du dépôt `DamienP2/arkyo-server` (modifiable dans les réglages de mise à jour, avec un token en lecture seule si le dépôt est privé ; le token reste dans `<données>/update/`). La vérification automatique ne fait que signaler une nouvelle version : l'installation reste toujours manuelle.
- **Hors ligne** : téléchargez le paquet de mise à jour de votre plateforme depuis la page de la release (`Arkyo-<version>-macos-arm64.tar.gz`, `-macos-x86_64.tar.gz`, `-windows-x86_64.zip` ou `-linux-x86_64.tar.gz` : le serveur seul), puis déposez-le avec *Importer un paquet*. Les installateurs (`.pkg`, `.msi`) et le paquet Ubuntu sont acceptés aussi : le serveur en extrait le programme (`pkgutil` sur macOS, installation administrative de `msiexec` sur Windows) sans rien installer d'autre.

Le serveur :

1. vérifie l'empreinte SHA-256 publiée par GitHub quand elle existe ;
2. lance le nouveau programme avec `--version` pour s'assurer qu'il fonctionne sur cette machine ;
3. garde l'ancien programme à côté (`arkyo-server.previous`) ;
4. redémarre (le service manager relance le nouveau programme).

Si la nouvelle version ne démarre pas trois fois de suite, l'ancienne est **restaurée automatiquement** ; un retour arrière manuel est aussi possible. L'application tray se met à jour avec l'installateur `.pkg` / `.msi` (la mise à jour web ne remplace que le serveur).

API : `GET /api/system/update`, `PUT /api/system/update/settings`, `POST /api/system/update/check`, `POST /api/system/update/install`, `POST /api/system/update/upload`, `POST /api/system/update/rollback`.

## L'application « Strata Arkyo » (macOS et Windows)

Les installateurs ajoutent une icône dans la barre des menus (macOS) ou la zone de notification (Windows), lancée à l'ouverture de session. Son menu affiche l'état du serveur (*En marche* / *Arrêté*) et propose **Ouvrir Strata Arkyo** (la page web), **Démarrer** / **Arrêter le service** et **Quitter**.

## Désinstallation, en résumé

| OS | Commande | Données |
| --- | --- | --- |
| Windows | *Paramètres → Applications*, ou *Désinstaller Strata Arkyo* (menu Démarrer) | conservées |
| macOS | `Uninstall Strata Arkyo.app`, ou `sudo /usr/local/arkyo/uninstall.sh [--purge]` | conservées sauf `--purge` |
| Ubuntu | `sudo ./uninstall.sh [--purge]` | conservées sauf `--purge` |
