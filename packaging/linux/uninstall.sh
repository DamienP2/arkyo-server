#!/bin/sh
# Removes the service and binaries. Data in /var/lib/arkyo is kept unless --purge.
set -eu
[ "$(id -u)" -eq 0 ] || { echo "Please run as root: sudo $0 $*" >&2; exit 1; }
/opt/arkyo/arkyo-server service uninstall || true
rm -f /usr/local/bin/arkyo-server
rm -rf /opt/arkyo
if [ "${1:-}" = "--purge" ]; then
  rm -rf /var/lib/arkyo
  userdel arkyo 2>/dev/null || true
fi
echo "Arkyo removed."
