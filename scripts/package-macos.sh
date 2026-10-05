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

# A Developer ID identity in HQPTUNER_CODESIGN_IDENTITY signs the app, through
# hqptuner.spec, and the dmg, and the dmg is then notarized: with the keychain
# profile named in HQPTUNER_NOTARY_PROFILE, or with the App Store Connect API
# key in HQPTUNER_NOTARY_KEY, HQPTUNER_NOTARY_KEY_ID and HQPTUNER_NOTARY_ISSUER.
# Without an identity the app is ad-hoc signed and the dmg is not signed.
IDENTITY="${HQPTUNER_CODESIGN_IDENTITY:-}"
NOTARY=()
if [ -n "$IDENTITY" ]; then
  if [ -n "${HQPTUNER_NOTARY_PROFILE:-}" ]; then
    NOTARY=(--keychain-profile "$HQPTUNER_NOTARY_PROFILE")
  elif [ -n "${HQPTUNER_NOTARY_KEY:-}" ] && [ -n "${HQPTUNER_NOTARY_KEY_ID:-}" ] && [ -n "${HQPTUNER_NOTARY_ISSUER:-}" ]; then
    NOTARY=(--key "$HQPTUNER_NOTARY_KEY" --key-id "$HQPTUNER_NOTARY_KEY_ID" --issuer "$HQPTUNER_NOTARY_ISSUER")
  else
    die "HQPTUNER_CODESIGN_IDENTITY is set with no notary credential."
  fi
fi

say "[1/4] PyInstaller"
"$PYTHON" -m PyInstaller --noconfirm --distpath dist --workpath build/pyinstaller hqptuner.spec
[ -d "$APP" ] || die "PyInstaller did not write $APP."

say "[2/4] hdiutil"
rm -rf "$STAGE"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/HQPTuner.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname HQPTuner -srcfolder "$STAGE" -fs APFS -format UDZO -ov "$DMG"

say "[3/4] sign and notarize"
if [ -n "$IDENTITY" ]; then
  codesign --sign "$IDENTITY" --timestamp "$DMG"
  xcrun notarytool submit "$DMG" "${NOTARY[@]}" --wait
  xcrun stapler staple "$DMG" || die "no notarization ticket for $DMG; xcrun notarytool log has the reason."
else
  echo "  skipped: HQPTUNER_CODESIGN_IDENTITY is not set."
fi

say "[4/4] package"
[ -f "$DMG" ] || die "hdiutil did not write $DMG."
echo "  $DMG"
