#!/bin/sh
# Arkyo — Linux installer (systemd).
# Usage: sudo ./install.sh [--port 8090] [--bind 0.0.0.0] [--data-dir DIR]
set -eu
[ "$(id -u)" -eq 0 ] || { echo "Please run as root: sudo $0 $*" >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd is required (run 'arkyo-server run' under your own init system otherwise)" >&2; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
PREFIX=/opt/arkyo

# Re-install / upgrade: stop the running service first, keep the data.
if [ -f /etc/systemd/system/arkyo-server.service ]; then
  "$PREFIX/arkyo-server" service uninstall >/dev/null 2>&1 || true
fi
install -d "$PREFIX"
install -m 0755 "$HERE/arkyo-server" "$PREFIX/arkyo-server"
cp "$HERE"/*.md "$PREFIX/" 2>/dev/null || true
ln -sf "$PREFIX/arkyo-server" /usr/local/bin/arkyo-server

# Creates the `arkyo` service account and /var/lib/arkyo, then starts the service.
"$PREFIX/arkyo-server" service install "$@"
# Web updates (Système > Mise à jour) replace the program in place: let the
# service account write its own folder (and nothing else on the system).
chown -R arkyo:arkyo "$PREFIX"
echo "Logs: journalctl -u arkyo-server -f"
