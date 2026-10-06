#!/usr/bin/env bash
# Freeze the Windows bundle for the interpreter's architecture, or pack the installer from both bundles.
# usage: scripts/package-windows.sh             freeze into dist/windows/<x64|arm64>/HQPTuner
#        scripts/package-windows.sh installer   pack both bundles into dist/HQPTuner-<version>-setup.exe
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

say()  { echo; echo "== $* =="; }
die()  { echo "FAIL: $*" >&2; exit 1; }

case "$(uname -s)" in
  MINGW*|MSYS*) ;;
  *) die "this script runs on Windows, in Git Bash." ;;
esac
[ $# -eq 0 ] || [ "$*" = installer ] || die "usage: package-windows.sh [installer]"

VERSION=$(grep -m1 '^version = ' pyproject.toml | cut -d'"' -f2)
[ -n "$VERSION" ] || die "no version in pyproject.toml."

if [ $# -eq 1 ]; then
  ISCC="${ISCC:-/c/Program Files (x86)/Inno Setup 6/ISCC.exe}"
  SETUP="dist/HQPTuner-${VERSION}-setup.exe"
  [ -x "$ISCC" ] || die "Inno Setup compiler not found at $ISCC."
  for arch in x64 arm64; do
    [ -f "dist/windows/$arch/HQPTuner/HQPTuner.exe" ] || die "no $arch bundle under dist/windows/$arch."
  done

  say "[1/2] Inno Setup"
  # The version travels in the environment because Git Bash rewrites an
  # argument that starts with a slash into a path, and /DVersion is one.
  HQPTUNER_VERSION="$VERSION" "$ISCC" packaging/windows/hqptuner.iss

  say "[2/2] package"
  [ -f "$SETUP" ] || die "Inno Setup did not write $SETUP."
  echo "  $SETUP"
  exit 0
fi

PYTHON="${PYTHON:-.venv/Scripts/python.exe}"

# The interpreter's architecture, not the machine's: the bundle takes the one it
# is frozen with, and an x64 Python runs under emulation on Arm64 Windows.
MACHINE=$("$PYTHON" -c 'import platform; print(platform.machine())')
case "$MACHINE" in
  AMD64) ARCH=x64 ;;
  ARM64) ARCH=arm64 ;;
  *) die "unsupported architecture '$MACHINE'." ;;
esac

BUNDLE="dist/windows/$ARCH/HQPTuner"

say "[1/2] PyInstaller"
"$PYTHON" -m PyInstaller --noconfirm --distpath "dist/windows/$ARCH" --workpath build/pyinstaller hqptuner.spec

say "[2/2] bundle"
[ -f "$BUNDLE/HQPTuner.exe" ] || die "PyInstaller did not write $BUNDLE/HQPTuner.exe."
echo "  $BUNDLE"
