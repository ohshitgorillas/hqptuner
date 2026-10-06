#!/usr/bin/env bash
# Install a built installer silently, run the app once, stop it, then uninstall.
# Given a bundle directory instead, run the app from it with no install around it.
# With --signed, Windows must also accept the signature on the installer, the
# executable and the uninstaller, each with a timestamp.
# usage: packaging/windows/smoke.sh <setup.exe|bundle-dir> <x64|arm64> [--signed]
set -euo pipefail

die() { echo "FAIL: $*" >&2; exit 1; }

USAGE="usage: smoke.sh <setup.exe|bundle-dir> <x64|arm64> [--signed]"
[ $# -eq 2 ] || [ $# -eq 3 ] || die "$USAGE"
[ "${3:---signed}" = --signed ] || die "$USAGE"
[ -e "$1" ] || die "step 1: target not found: $1"
TARGET=$1
case "$2" in
  x64)   MACHINE=8664 ;;
  arm64) MACHINE=aa64 ;;
  *) die "$USAGE" ;;
esac
SIGNED=${3:-}
BASE_URL="http://127.0.0.1:8090"
SHORTCUT="$APPDATA/Microsoft/Windows/Start Menu/Programs/HQPTuner.lnk"
PID=""
WORK=$(mktemp -d)

cleanup() {
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; fi
  rm -rf "$WORK" || true
}
trap cleanup EXIT

status() { curl -s -o /dev/null --max-time "${2:-2}" -w '%{http_code}' "$1" || true; }

# The machine field of a PE file's header, as four hex digits.
machine() {
  local at
  at=$(od -An -tu4 -j60 -N4 "$1" | tr -d ' ')
  od -An -tx2 -j"$((at + 4))" -N2 "$1" | tr -d ' '
}

# Under --signed, a file passes with a signature Windows accepts that carries a
# timestamp. The path travels in the environment because PowerShell reads
# everything after -Command as script text.
signed() {
  [ -n "$SIGNED" ] || return 0
  local verdict
  verdict=$(SIGNED_FILE="$(cygpath -w "$1")" powershell -NoProfile -Command \
    '$s = Get-AuthenticodeSignature -LiteralPath $env:SIGNED_FILE; "$($s.Status) $($null -ne $s.TimeStamperCertificate)"' | tr -d '\r') || true
  [ "$verdict" = "Valid True" ] || die "$2: the signature on $1 is '$verdict', not 'Valid True'"
}

# ---- 1. install, unless the target is a bundle ------------------------------
# Git Bash rewrites an argument that starts with a slash into a path, and every
# Inno Setup switch is one, so the conversion is off for those calls.
if [ -d "$TARGET" ]; then
  APP=$TARGET
else
  signed "$TARGET" "step 1"
  APP="$WORK/app"
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$TARGET" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART \
    "/DIR=$(cygpath -w "$APP")" || die "step 1: the installer failed"
  [ -f "$SHORTCUT" ] || die "step 1: no Start Menu shortcut at $SHORTCUT"
fi
BIN="$APP/HQPTuner.exe"

# ---- 2. the executable ------------------------------------------------------
[ -f "$BIN" ] || die "step 2: $BIN missing"
FOUND=$(machine "$BIN")
[ "$FOUND" = "$MACHINE" ] || die "step 2: the executable's machine type is $FOUND, not $MACHINE"
signed "$BIN" "step 2"
if [ ! -d "$TARGET" ]; then signed "$APP/unins000.exe" "step 2"; fi

# ---- 3. start the binary ----------------------------------------------------
# The stores go under LOCALAPPDATA, so the run gets its own. BROWSER keeps the
# launch from opening a real browser.
[ "$(status "$BASE_URL/api/health")" = 000 ] || die "step 3: something already answers on $BASE_URL"
mkdir "$WORK/data"
LOCALAPPDATA="$(cygpath -w "$WORK/data")" BROWSER="$(cygpath -w /usr/bin/true)" HQPTUNER_HQP_HOST=127.0.0.2 "$BIN" &
PID=$!

# ---- 4. health, at most 30 tries --------------------------------------------
CODE=000
for _ in $(seq 1 30); do
  CODE=$(status "$BASE_URL/api/health")
  if [ "$CODE" = 200 ]; then break; fi
  kill -0 "$PID" 2>/dev/null || die "step 4: binary exited before GET /api/health answered"
  sleep 1
done
[ "$CODE" = 200 ] || die "step 4: GET /api/health answered $CODE after 30 tries"
CODE=$(status "$BASE_URL/")
[ "$CODE" = 200 ] || die "step 4: GET / answered $CODE"
# A sweep nobody answers is still an answer: this is discovery's socket calls
# on the Windows event loop.
CODE=$(status "$BASE_URL/api/discover" 30)
[ "$CODE" = 200 ] || die "step 4: GET /api/discover answered $CODE"

# ---- 5. still running -------------------------------------------------------
# The tray icon is built after the server answers, and a launch that cannot
# build it exits.
for _ in $(seq 1 5); do
  kill -0 "$PID" 2>/dev/null || die "step 5: binary exited within 5 s of answering"
  sleep 1
done

# ---- 6. stop ----------------------------------------------------------------
kill "$PID"
for _ in $(seq 1 10); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 1
done
if kill -0 "$PID" 2>/dev/null; then die "step 6: binary PID $PID still running 10 s after kill"; fi
wait "$PID" || true
PID=""

# ---- 7. uninstall, unless the target is a bundle ----------------------------
if [ ! -d "$TARGET" ]; then
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$APP/unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART \
    || die "step 7: the uninstaller failed"
  for _ in $(seq 1 10); do
    [ -e "$BIN" ] || break
    sleep 1
  done
  [ ! -e "$BIN" ] || die "step 7: $BIN still present 10 s after uninstall"
  [ ! -e "$SHORTCUT" ] || die "step 7: the Start Menu shortcut is still present"
fi

echo "smoke: OK"
