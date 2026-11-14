#!/usr/bin/env bash
# Freeze the macOS app, or sign it and pack, sign and notarize the dmg.
# usage: scripts/package-macos.sh         both stages, one after the other
#        scripts/package-macos.sh freeze  PyInstaller into dist/HQPTuner.app, ad-hoc signed
#        scripts/package-macos.sh sign    sign the dist/HQPTuner.app a freeze left, then pack, sign
#                                         and notarize dist/HQPTuner-<version>-<arch>.dmg;
#                                         starts no Python and no PyInstaller
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

say()  { echo; echo "== $* =="; }
die()  { echo "FAIL: $*" >&2; exit 1; }

# stapler exits 68 when it cannot reach Apple's ticket service, which some
# hosted runners drop often; any other exit is a verdict on the dmg.
stapler() {
  local rc try
  for try in 1 2 3 4 5; do
    rc=0
    xcrun stapler "$@" || rc=$?
    [ "$rc" -eq 68 ] || return "$rc"
    echo "  stapler $1: Apple's ticket service unreachable (68), try $try of 5"
    [ "$try" -eq 5 ] || sleep 15
  done
  return 68
}

[ "$(uname -s)" = Darwin ] || die "this script runs on macOS."
[ $# -le 1 ] || die "usage: package-macos.sh [freeze|sign]"
STAGES="${1:-both}"
case "$STAGES" in
  both|freeze|sign) ;;
  *) die "usage: package-macos.sh [freeze|sign]" ;;
esac

VERSION=$(grep -m1 '^version = ' pyproject.toml | cut -d'"' -f2)
[ -n "$VERSION" ] || die "no version in pyproject.toml."

APP="dist/HQPTuner.app"
STAGE="build/dmg"

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

mkdir -p build

# The freeze runs the project's Python and holds no credential. PyInstaller
# ad-hoc signs what it writes; the Developer ID signature is the sign stage's.
freeze() {
  local python="${PYTHON:-.venv/bin/python}"
  say "[freeze] PyInstaller"
  "$python" -m PyInstaller --noconfirm --distpath dist --workpath build/pyinstaller hqptuner.spec || die "PyInstaller failed."
  [ -d "$APP" ] || die "PyInstaller did not write $APP."
}

# A Developer ID identity in HQPTUNER_CODESIGN_IDENTITY signs the app and the
# dmg, and the dmg is then notarized: with the keychain profile named in
# HQPTUNER_NOTARY_PROFILE, or with the App Store Connect API key in
# HQPTUNER_NOTARY_KEY, HQPTUNER_NOTARY_KEY_ID and HQPTUNER_NOTARY_ISSUER.
# Without an identity the app keeps its ad-hoc signature and the dmg is not signed.
sign() {
  local identity="${HQPTUNER_CODESIGN_IDENTITY:-}" machine mac dmg path submission status polls failed
  local notary=()
  # One status request every 30 seconds, for at most five hours.
  local poll_seconds=30 max_polls=600
  [ -d "$APP" ] || die "no $APP: run the freeze stage first."

  # The architecture the app was frozen for, read from its executable.
  machine=$(lipo -archs "$APP/Contents/MacOS/HQPTuner")
  case "$machine" in
    arm64) mac=apple-silicon ;;
    x86_64) mac=intel ;;
    *) die "unsupported architecture '$machine'." ;;
  esac
  dmg="dist/HQPTuner-${VERSION}-${mac}.dmg"

  if [ -n "$identity" ]; then
    if [ -n "${HQPTUNER_NOTARY_PROFILE:-}" ]; then
      notary=(--keychain-profile "$HQPTUNER_NOTARY_PROFILE")
    elif [ -n "${HQPTUNER_NOTARY_KEY:-}" ] && [ -n "${HQPTUNER_NOTARY_KEY_ID:-}" ] && [ -n "${HQPTUNER_NOTARY_ISSUER:-}" ]; then
      notary=(--key "$HQPTUNER_NOTARY_KEY" --key-id "$HQPTUNER_NOTARY_KEY_ID" --issuer "$HQPTUNER_NOTARY_ISSUER")
    else
      die "HQPTUNER_CODESIGN_IDENTITY is set with no notary credential."
    fi
  fi
  # The notary service answers in JSON; plutil ships with macOS.
  json_field() { plutil -extract "$1" raw -o - -; }

  say "[sign 1/4] the app"
  if [ -n "$identity" ]; then
    # Every Mach-O file inside the app, deepest first, then the app: a signature
    # seals what sits inside it, so the contents are signed before their container.
    while IFS= read -r -u 3 path; do
      retry_on "$TIMESTAMP_ERROR" codesign --sign "$identity" --force --timestamp --options runtime \
        --entitlements packaging/macos/entitlements.plist "$path" || die "codesign failed on $path."
    done 3< <(
      while IFS= read -r path; do
        case "$(file -b "$path")" in *Mach-O*) echo "$path" ;; esac
      done < <(find "$APP" -type f) | awk -F/ '{ print NF "\t" $0 }' | sort -t$'\t' -k1,1nr | cut -f2-
    )
    retry_on "$TIMESTAMP_ERROR" codesign --sign "$identity" --force --timestamp --options runtime \
      --entitlements packaging/macos/entitlements.plist "$APP" || die "codesign failed on $APP."
  else
    echo "  skipped: HQPTUNER_CODESIGN_IDENTITY is not set."
  fi

  say "[sign 2/4] hdiutil"
  rm -rf "$STAGE"
  mkdir -p "$STAGE"
  ditto "$APP" "$STAGE/HQPTuner.app"
  ln -s /Applications "$STAGE/Applications"
  retry_on "$BUSY_ERROR" hdiutil create -volname HQPTuner -srcfolder "$STAGE" -fs APFS -format UDZO -ov "$dmg" || die "hdiutil create failed."

  say "[sign 3/4] sign and notarize"
  if [ -n "$identity" ]; then
    retry_on "$TIMESTAMP_ERROR" codesign --sign "$identity" --timestamp "$dmg" || die "codesign failed on $dmg."
    submission=$(xcrun notarytool submit "$dmg" "${notary[@]}" --output-format json | json_field id)
    [ -n "$submission" ] || die "the notary service returned no submission id."
    echo "  submission $submission"
    # The notary service can hold a submission for longer than a connection to
    # it lasts, so the status is polled and a failed poll is not a verdict.
    status="In Progress"
    polls=0
    failed=0
    while [ "$status" = "In Progress" ]; do
      polls=$((polls + 1))
      [ "$polls" -le "$max_polls" ] || die "notary submission $submission is still in progress after $max_polls polls."
      sleep "$poll_seconds"
      if status=$(xcrun notarytool info "$submission" "${notary[@]}" --output-format json | json_field status); then
        failed=0
      else
        failed=$((failed + 1))
        [ "$failed" -lt 10 ] || die "10 status requests in a row failed for notary submission $submission."
        status="In Progress"
      fi
    done
    [ "$status" = Accepted ] || die "notary submission $submission is '$status'; xcrun notarytool log $submission has the reason."
    stapler staple "$dmg" || die "stapling $dmg failed."
  else
    echo "  skipped: HQPTUNER_CODESIGN_IDENTITY is not set."
  fi

  say "[sign 4/4] package"
  [ -f "$dmg" ] || die "hdiutil did not write $dmg."
  echo "  $dmg"
}

case "$STAGES" in
  freeze) freeze ;;
  sign) sign ;;
  both) freeze; sign ;;
esac
