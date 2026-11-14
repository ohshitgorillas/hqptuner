#!/usr/bin/env bash
# Freeze the Linux bundle, or pack it into the deb and the rpm.
# usage: scripts/package-linux.sh           both stages, one after the other
#        scripts/package-linux.sh freeze    PyInstaller into dist/HQPTuner
#        scripts/package-linux.sh package   pack the dist/HQPTuner a freeze left into dist/*.deb and dist/*.rpm;
#                                           starts no Python and no PyInstaller
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

say()  { echo; echo "== $* =="; }
die()  { echo "FAIL: $*" >&2; exit 1; }

[ $# -le 1 ] || die "usage: package-linux.sh [freeze|package]"
STAGES="${1:-both}"
case "$STAGES" in
  both|freeze|package) ;;
  *) die "usage: package-linux.sh [freeze|package]" ;;
esac

BUNDLE="dist/HQPTuner"

freeze() {
  say "[freeze] PyInstaller"
  "${PYTHON:-.venv/bin/python}" -m PyInstaller --noconfirm --distpath dist --workpath build/pyinstaller hqptuner.spec || die "PyInstaller failed."
  [ -d "$BUNDLE" ] || die "PyInstaller did not write $BUNDLE."
}

package() {
  local version machine arch deb rpm pkg
  command -v nfpm >/dev/null || die "nfpm is not on PATH."
  [ -d "$BUNDLE" ] || die "no $BUNDLE: run the freeze stage first."

  version=$(grep -m1 '^version = ' pyproject.toml | cut -d'"' -f2)
  [ -n "$version" ] || die "no version in pyproject.toml."

  machine=$(uname -m)
  case "$machine" in
    x86_64)  arch=amd64 ;;
    aarch64) arch=arm64 ;;
    *) die "unsupported architecture '$machine'." ;;
  esac
  export VERSION="$version" ARCH="$arch"       # read by packaging/linux/nfpm.yaml

  deb="dist/hqptuner_${version}_${arch}.deb"
  rpm="dist/hqptuner-${version}-1.${machine}.rpm"

  say "[package 1/2] nfpm"
  nfpm package --config packaging/linux/nfpm.yaml --packager deb --target dist/
  nfpm package --config packaging/linux/nfpm.yaml --packager rpm --target dist/

  say "[package 2/2] packages"
  for pkg in "$deb" "$rpm"; do
    [ -f "$pkg" ] || die "nfpm did not write $pkg."
    echo "  $pkg"
  done
}

case "$STAGES" in
  freeze) freeze ;;
  package) package ;;
  both) freeze; package ;;
esac
