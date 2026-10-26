#!/bin/sh
# Removes Arkyo (service, menu bar app, uninstaller, command line tool).
# Data in /Library/Application Support/Arkyo is kept unless --purge.
set -u
[ "$(id -u)" -eq 0 ] || { echo "Please run as root: sudo $0 $*" >&2; exit 1; }

/usr/local/arkyo/arkyo-server service uninstall 2>/dev/null || launchctl bootout system/com.arkyo.server 2>/dev/null || true
rm -f /Library/LaunchDaemons/com.arkyo.server.plist

USER_ID=$(stat -f %u /dev/console 2>/dev/null || echo 0)
[ "$USER_ID" != "0" ] && launchctl bootout "gui/$USER_ID/com.arkyo.tray" 2>/dev/null
pkill -x arkyo-tray 2>/dev/null
rm -f /Library/LaunchAgents/com.arkyo.tray.plist

/usr/libexec/ApplicationFirewall/socketfilterfw --remove /usr/local/arkyo/arkyo-server >/dev/null 2>&1
rm -rf /Applications/Arkyo.app "/Applications/Uninstall Arkyo.app"
rm -f /usr/local/bin/arkyo-server
rm -f /etc/sudoers.d/arkyo
rm -rf /usr/local/arkyo
pkgutil --forget com.arkyo.server >/dev/null 2>&1

if [ "${1:-}" = "--purge" ]; then
  rm -rf "/Library/Application Support/Arkyo" /Library/Logs/Arkyo
  echo "Arkyo and its data have been removed."
else
  echo "Arkyo removed. Data kept in /Library/Application Support/Arkyo."
fi
exit 0
