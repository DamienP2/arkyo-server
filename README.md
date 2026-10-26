# Strata Arkyo

> Conception, câblage et recette pour l'intégration broadcast et la prestation événementielle, en application autonome installée sur votre site.

**Strata Arkyo** (exécutable `arkyo-server`) est le recodage d'[arkyo](https://github.com/DamienP2/arkyo) en application **mono-site** : **un seul exécutable** (`arkyo-server`) qui embarque l'API, la base SQLite et l'interface web. Pas de Node, de Postgres, de Redis ni de Docker à installer ; pas de multi-tenant, d'abonnement ni de plateforme centrale. Il se distribue et se met à jour comme Strata Graphics (CG) : paquet natif, service système, application dans la barre des menus ou la zone de notification, mise à jour intégrée.

Strata Arkyo couvre le cycle d'une installation broadcast : **conception → câblage → configuration → recette → documentation**. Les écrans et les fonctions sont ceux d'arkyo, seul ce qui relevait du SaaS disparaît ; l'habillage est celui de Strata (palette Strata en clair et en sombre, police Inter embarquée, logotype Strata Arkyo). Seuls les noms affichés changent : exécutable, service, dossiers de données et paquets gardent leurs noms `arkyo-server` / `Arkyo-<version>-…`.

## État : phase 1 (socle)

Le socle est livré : serveur, base SQLite, comptes et rôles, coquille de l'interface (mise en page, design system, navigation, thème, langues), notifications, temps réel (SSE), CLI, service natif, application tray, mise à jour en ligne et hors ligne, CI et release. Les pages d'arkyo qui ne sont pas encore reprises affichent un écran « bientôt disponible » (`ComingSoon`). Elles arrivent phase par phase (voir `docs/superpowers/specs/2026-10-26-arkyo-server-design.md`, §9).

## Installation

Les paquets sont publiés dans les [releases](https://github.com/DamienP2/arkyo-server/releases) du dépôt.

| OS | Paquet |
| --- | --- |
| macOS 11 ou plus récent (Apple Silicon / Intel) | `Arkyo-<version>-macos-universal.dmg` (ou le `.pkg` seul) |
| Windows 10+ / Server 2016+ x64 | `Arkyo-<version>-windows-x64.msi` |
| Ubuntu 22.04+ x86_64 (serveur) | `Arkyo-<version>-ubuntu-x64.tar.gz`, puis `sudo ./install.sh` |

Le détail par plateforme (dossiers, pare-feu, mises à jour, désinstallation) est dans [`docs/INSTALL.md`](docs/INSTALL.md).

## Premier lancement

1. Ouvrez **http://localhost:8090** **sur le serveur lui-même** et créez le compte administrateur.
2. Sur un serveur sans écran, créez-le plutôt en ligne de commande : `sudo arkyo-server user add vous@exemple.fr` (macOS), `sudo -u arkyo arkyo-server user add vous@exemple.fr` (Ubuntu) ou dans un terminal administrateur (Windows).
3. Les autres machines du site accèdent à `http://<adresse-du-serveur>:8090`.

Le port (8090 par défaut) et l'adresse d'écoute (`0.0.0.0`) se règlent dans `config.json`, dans le dossier de données.

## Commandes

```
arkyo-server [run]                      lance le serveur au premier plan
    --port <PORT>  --bind <ADRESSE>  --data-dir <DOSSIER>
    (variables ARKYO_PORT, ARKYO_BIND, ARKYO_DATA_DIR)

arkyo-server service install|uninstall|start|stop|status
arkyo-server service install --port 8090 --bind 0.0.0.0 --data-dir <DOSSIER>

arkyo-server user add <email> [--name N] [--username U] [--role owner] [--temporary]
arkyo-server user passwd <email|identifiant> [--temporary]
arkyo-server user list
arkyo-server user remove|disable|enable <email|identifiant>

arkyo-server --version
```

`service` demande `sudo` (macOS, Linux) ou un terminal administrateur (Windows). Les commandes `user` agissent sur le dossier de données du service s'il est installé, sinon sur celui de l'utilisateur ; `--data-dir` (ou `ARKYO_DATA_DIR`) force un autre dossier.

## Développement

Pré-requis : Rust stable, Node 22.

```bash
bash scripts/fetch-refs.sh              # clone arkyo et CG dans .ref/ (références)
cd web && npm ci && npm run build       # le serveur embarque web/dist
cd .. && cargo run -p arkyo-server      # http://localhost:8090
cd web && npm run dev                   # Vite, proxy /api vers :8090
```

Tests : `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, `cd web && npm test && npx tsc --noEmit && npm run build`.

Pour contribuer : [`CLAUDE.md`](CLAUDE.md) (règles de travail), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (architecture) et [`UI_PATTERNS.md`](UI_PATTERNS.md) (conventions d'interface, reprises d'arkyo).
