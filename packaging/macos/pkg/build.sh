#!/bin/sh
# Builds the macOS installer package from universal binaries.
# Usage: packaging/macos/pkg/build.sh <arkyo-server> <arkyo-tray> <version> <output.pkg>
# Optional signing: MACOS_APP_IDENTITY ("Developer ID Application: …") for the
# apps and binaries, MACOS_INSTALLER_IDENTITY ("Developer ID Installer: …")
# for the package.
set -eu
BIN=$1 TRAY=$2 VERSION=$3 OUT=$4
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# 1024 px artwork -> .icns with every size macOS asks for.
make_icns() { # source.png dest.icns
  set_dir="$WORK/icon.iconset"
  rm -rf "$set_dir" && mkdir -p "$set_dir"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$1" --out "$set_dir/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$1" --out "$set_dir/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$set_dir" -o "$2"
}

# App bundle: name, executable source, executable name, Info.plist dir, icon png
make_app() {
  app="$APPS/$1.app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  cp "$2" "$app/Contents/MacOS/$3"
  chmod 0755 "$app/Contents/MacOS/$3"
  sed "s/__VERSION__/$VERSION/g" "$4/Info.plist" > "$app/Contents/Info.plist"
  for lproj in "$4"/*.lproj; do
    if [ -d "$lproj" ]; then cp -R "$lproj" "$app/Contents/Resources/"; fi
  done
  make_icns "$5" "$app/Contents/Resources/AppIcon.icns"
  printf 'APPL????' > "$app/Contents/PkgInfo"
}

# --- payload -----------------------------------------------------------------
PAYLOAD="$WORK/root/usr/local/arkyo"
mkdir -p "$PAYLOAD"
cp "$BIN" "$PAYLOAD/arkyo-server"
chmod 0755 "$PAYLOAD/arkyo-server"
cp "$ROOT/packaging/macos/uninstall.sh" "$PAYLOAD/"
chmod 0755 "$PAYLOAD/uninstall.sh"
if [ -f "$ROOT/docs/INSTALL.md" ]; then cp "$ROOT/docs/INSTALL.md" "$PAYLOAD/"; fi

# The menu bar app and the uninstaller, straight in /Applications.
APPS="$WORK/root/Applications"
mkdir -p "$APPS"
make_app "Strata Arkyo" "$TRAY" arkyo-tray "$HERE/app" "$ROOT/assets/icons/arkyo-macos-1024.png"
make_app "Uninstall Strata Arkyo" "$HERE/uninstaller/uninstall" uninstall "$HERE/uninstaller" "$ROOT/assets/icons/uninstall-macos-1024.png"

mkdir -p "$WORK/root/Library/LaunchAgents"
cp "$HERE/com.arkyo.tray.plist" "$WORK/root/Library/LaunchAgents/"

# --- signing (optional) --------------------------------------------------------
if [ -n "${MACOS_APP_IDENTITY:-}" ]; then
  sign() { codesign --force --options runtime --timestamp --sign "$MACOS_APP_IDENTITY" "$@"; }
  sign "$PAYLOAD/arkyo-server"
  sign "$APPS/Strata Arkyo.app"
  sign "$APPS/Uninstall Strata Arkyo.app"
fi

# --- package ---------------------------------------------------------------------
# Always install the apps where we put them, even if a copy exists elsewhere.
pkgbuild --analyze --root "$WORK/root" "$WORK/component.plist"
i=0
while /usr/libexec/PlistBuddy -c "Print :$i" "$WORK/component.plist" >/dev/null 2>&1; do
  /usr/libexec/PlistBuddy -c "Set :$i:BundleIsRelocatable false" "$WORK/component.plist"
  i=$((i + 1))
done

pkgbuild --root "$WORK/root" --component-plist "$WORK/component.plist" --scripts "$HERE/scripts" \
  --identifier com.arkyo.server --version "$VERSION" --install-location / \
  "$WORK/component.pkg"
sed "s/__VERSION__/$VERSION/" "$HERE/Distribution.xml" > "$WORK/Distribution.xml"

# Installer pages, with the background drawn for the installer.
cp -R "$HERE/resources" "$WORK/resources"
cp "$ROOT/assets/icons/installer-background.png" "$WORK/resources/background.png"

SIGN=""
if [ -n "${MACOS_INSTALLER_IDENTITY:-}" ]; then SIGN="--sign"; fi
productbuild --distribution "$WORK/Distribution.xml" --resources "$WORK/resources" \
  --package-path "$WORK" ${SIGN:+$SIGN "$MACOS_INSTALLER_IDENTITY"} "$OUT"
echo "built $OUT"
exit 0
