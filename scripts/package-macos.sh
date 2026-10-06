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
  arm64) MAC=apple-silicon ;;
  x86_64) MAC=intel ;;
  *) die "unsupported architecture '$MACHINE'." ;;
esac

APP="dist/HQPTuner.app"
DMG="dist/HQPTuner-${VERSION}-${MAC}.dmg"
STAGE="build/dmg"

# A Developer ID identity in HQPTUNER_CODESIGN_IDENTITY signs the app, through
# hqptuner.spec, and the dmg, and the dmg is then notarized: with the keychain
# profile named in HQPTUNER_NOTARY_PROFILE, or with the App Store Connect API
# key in HQPTUNER_NOTARY_KEY, HQPTUNER_NOTARY_KEY_ID and HQPTUNER_NOTARY_ISSUER.
# Without an identity the app is ad-hoc signed and the dmg is not signed.
IDENTITY="${HQPTUNER_CODESIGN_IDENTITY:-}"
# One status request every 30 seconds, for at most five hours.
NOTARY_POLL_SECONDS=30
NOTARY_MAX_POLLS=600
json_field() { "$PYTHON" -c 'import json, sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$1"; }
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

# Two failures come and go on a hosted runner: Apple's timestamp service drops
# a request, so a signing gets no timestamp, and hdiutil finds the folder it is
# given busy. A command that fails with the error named for it is tried again;
# any other failure is final.
TIMESTAMP_ERROR="A timestamp was expected but was not found"
BUSY_ERROR="Resource busy"
RETRY_ATTEMPTS=3
RETRY_SECONDS=20
RETRY_LOG="build/retry.log"
retry_on() {
  local error=$1 attempt=1
  shift
  until "$@" 2>&1 | tee "$RETRY_LOG"; do
    grep -q "$error" "$RETRY_LOG" || return 1
    [ "$attempt" -lt "$RETRY_ATTEMPTS" ] || die "'$error' on $attempt attempts in a row."
    attempt=$((attempt + 1))
    sleep "$RETRY_SECONDS"
  done
}

say "[1/4] PyInstaller"
mkdir -p build
retry_on "$TIMESTAMP_ERROR" "$PYTHON" -m PyInstaller --noconfirm --distpath dist --workpath build/pyinstaller hqptuner.spec || die "PyInstaller failed."
[ -d "$APP" ] || die "PyInstaller did not write $APP."

say "[2/4] hdiutil"
rm -rf "$STAGE"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/HQPTuner.app"
ln -s /Applications "$STAGE/Applications"
retry_on "$BUSY_ERROR" hdiutil create -volname HQPTuner -srcfolder "$STAGE" -fs APFS -format UDZO -ov "$DMG" || die "hdiutil create failed."

say "[3/4] sign and notarize"
if [ -n "$IDENTITY" ]; then
  retry_on "$TIMESTAMP_ERROR" codesign --sign "$IDENTITY" --timestamp "$DMG" || die "codesign failed on $DMG."
  SUBMISSION=$(xcrun notarytool submit "$DMG" "${NOTARY[@]}" --output-format json | json_field id)
  [ -n "$SUBMISSION" ] || die "the notary service returned no submission id."
  echo "  submission $SUBMISSION"
  # The notary service can hold a submission for longer than a connection to
  # it lasts, so the status is polled and a failed poll is not a verdict.
  STATUS="In Progress"
  POLLS=0
  FAILED=0
  while [ "$STATUS" = "In Progress" ]; do
    POLLS=$((POLLS + 1))
    [ "$POLLS" -le "$NOTARY_MAX_POLLS" ] || die "notary submission $SUBMISSION is still in progress after $NOTARY_MAX_POLLS polls."
    sleep "$NOTARY_POLL_SECONDS"
    if STATUS=$(xcrun notarytool info "$SUBMISSION" "${NOTARY[@]}" --output-format json | json_field status); then
      FAILED=0
    else
      FAILED=$((FAILED + 1))
      [ "$FAILED" -lt 10 ] || die "10 status requests in a row failed for notary submission $SUBMISSION."
      STATUS="In Progress"
    fi
  done
  [ "$STATUS" = Accepted ] || die "notary submission $SUBMISSION is '$STATUS'; xcrun notarytool log $SUBMISSION has the reason."
  xcrun stapler staple "$DMG"
else
  echo "  skipped: HQPTUNER_CODESIGN_IDENTITY is not set."
fi

say "[4/4] package"
[ -f "$DMG" ] || die "hdiutil did not write $DMG."
echo "  $DMG"
