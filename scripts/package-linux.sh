#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

say()  { echo; echo "== $* =="; }
die()  { echo "FAIL: $*" >&2; exit 1; }

command -v nfpm >/dev/null || die "nfpm is not on PATH."

VERSION=$(grep -m1 '^version = ' pyproject.toml | cut -d'"' -f2)
[ -n "$VERSION" ] || die "no version in pyproject.toml."

MACHINE=$(uname -m)
case "$MACHINE" in
  x86_64)  ARCH=amd64 ;;
  aarch64) ARCH=arm64 ;;
  *) die "unsupported architecture '$MACHINE'." ;;
esac
export VERSION ARCH       # read by packaging/linux/nfpm.yaml

DEB="dist/hqptuner_${VERSION}_${ARCH}.deb"
RPM="dist/hqptuner-${VERSION}-1.${MACHINE}.rpm"

say "[1/3] PyInstaller"
"${PYTHON:-.venv/bin/python}" -m PyInstaller --noconfirm --distpath dist --workpath build/pyinstaller hqptuner.spec

say "[2/3] nfpm"
mkdir -p dist
nfpm package --config packaging/linux/nfpm.yaml --packager deb --target dist/
nfpm package --config packaging/linux/nfpm.yaml --packager rpm --target dist/

say "[3/3] packages"
for pkg in "$DEB" "$RPM"; do
  [ -f "$pkg" ] || die "nfpm did not write $pkg."
  echo "  $pkg"
done
