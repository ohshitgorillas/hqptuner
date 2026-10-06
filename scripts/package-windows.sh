#!/usr/bin/env bash
# Freeze the Windows bundle for the interpreter's architecture, or pack the installer from both bundles.
# usage: scripts/package-windows.sh             freeze into dist/windows/<x64|arm64>/HQPTuner
#        scripts/package-windows.sh installer   pack both bundles into dist/HQPTuner-<version>-setup.exe,
#                                               signed when HQPTUNER_SIGN_THUMBPRINT is set
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

  # A certificate thumbprint in HQPTUNER_SIGN_THUMBPRINT signs both executables
  # here, and the installer and its uninstaller through Inno Setup, each with a
  # timestamp. HQPTUNER_SIGNTOOL names the signtool; without it the one on PATH
  # is used. Without a thumbprint nothing is signed.
  THUMBPRINT="${HQPTUNER_SIGN_THUMBPRINT:-}"
  SIGNTOOL="${HQPTUNER_SIGNTOOL:-signtool}"
  SIGN_ARGS=(sign /sha1 "$THUMBPRINT" /fd SHA256 /tr http://time.certum.pl /td SHA256)
  # Every signtool and Inno Setup switch starts with a slash, and Git Bash
  # rewrites such an argument into a path, so the conversion is off for those
  # calls.
  unconverted() { MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$@"; }

  say "[1/3] sign the executables"
  if [ -n "$THUMBPRINT" ]; then
    for arch in x64 arm64; do
      unconverted "$SIGNTOOL" "${SIGN_ARGS[@]}" "$(cygpath -w "dist/windows/$arch/HQPTuner/HQPTuner.exe")" \
        || die "signtool failed on the $arch executable."
    done
    # Inno Setup runs this command on the uninstaller and on the installer; $q
    # is its quote and $f the file.
    ISCC_SIGN=("/Shqptuner=\$q$(cygpath -w "$SIGNTOOL")\$q ${SIGN_ARGS[*]} \$f")
  else
    echo "  skipped: HQPTUNER_SIGN_THUMBPRINT is not set."
    ISCC_SIGN=()
  fi

  say "[2/3] Inno Setup"
  # The version and the thumbprint travel in the environment, where
  # hqptuner.iss reads them.
  HQPTUNER_VERSION="$VERSION" HQPTUNER_SIGN_THUMBPRINT="$THUMBPRINT" unconverted "$ISCC" "${ISCC_SIGN[@]}" packaging/windows/hqptuner.iss

  say "[3/3] package"
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
