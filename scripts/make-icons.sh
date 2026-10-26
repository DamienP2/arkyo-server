#!/bin/sh
# Regenerates assets/icons/* from web/public/favicon.svg.
# Needs cargo and (for arkyo.icns) macOS `iconutil`. The generated files are
# committed; run this only when the artwork changes.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/assets/icons"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cargo run --quiet --manifest-path "$root/tools/make-icons/Cargo.toml" -- \
  "$root/web/public/favicon.svg" "$tmp"

mkdir -p "$out"
for f in arkyo.ico arkyo-1024.png arkyo-macos-1024.png uninstall-macos-1024.png \
         installer-background.png tray-template-44.rgba tray-color-64.rgba; do
  cp "$tmp/$f" "$out/$f"
done
if command -v iconutil >/dev/null 2>&1; then
  iconutil -c icns "$tmp/arkyo.iconset" -o "$out/arkyo.icns"
else
  echo "iconutil not found: arkyo.icns not regenerated" >&2
fi
