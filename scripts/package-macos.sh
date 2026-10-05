#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

say()  { echo; echo "== $* =="; }
die()  { echo "FAIL: $*" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || die "this script runs on macOS."

PYTHON="${PYTHON:-.venv/bin/python}"

VERSION=$(grep -m1 '^version = ' pyproject.toml | cut -d'"' -f2)
[ -n "$VERSION" ] || die "no version in pyproject.toml."

# The interpreter's architecture, not the shell's: the bundle takes the one it
# is frozen with, and an x86_64 Python runs under Rosetta in an arm64 shell.
MACHINE=$("$PYTHON" -c 'import platform; print(platform.machine())')
case "$MACHINE" in
  arm64|x86_64) ;;
  *) die "unsupported architecture '$MACHINE'." ;;
esac

APP="dist/HQPTuner.app"
DMG="dist/HQPTuner-${VERSION}-${MACHINE}.dmg"
STAGE="build/dmg"

say "[1/3] PyInstaller"
"$PYTHON" -m PyInstaller --noconfirm --distpath dist --workpath build/pyinstaller hqptuner.spec
[ -d "$APP" ] || die "PyInstaller did not write $APP."

say "[2/3] hdiutil"
rm -rf "$STAGE"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/HQPTuner.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname HQPTuner -srcfolder "$STAGE" -fs APFS -format UDZO -ov "$DMG"

say "[3/3] package"
[ -f "$DMG" ] || die "hdiutil did not write $DMG."
echo "  $DMG"
