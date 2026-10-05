#!/usr/bin/env bash
# Mount a built dmg, copy the app out, run it once, then stop it.
# usage: packaging/macos/smoke.sh <package.dmg>
set -euo pipefail

die() { echo "FAIL: $*" >&2; exit 1; }

[ $# -eq 1 ] || die "usage: smoke.sh <package.dmg>"
[ -f "$1" ] || die "step 1: package not found: $1"
DMG=$1
BASE_URL="http://127.0.0.1:8090"
PID=""
WORK=$(mktemp -d)
MOUNT="$WORK/mount"
APP="$WORK/HQPTuner.app"
BIN="$APP/Contents/MacOS/HQPTuner"

cleanup() {
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; fi
  hdiutil detach "$MOUNT" -force >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

status() { curl -s -o /dev/null --max-time 2 -w '%{http_code}' "$1" || true; }

# ---- 1. mount, copy the app out, unmount ------------------------------------
mkdir "$MOUNT"
hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT" || die "step 1: hdiutil attach failed"
[ -L "$MOUNT/Applications" ] || die "step 1: no Applications link in the dmg"
ditto "$MOUNT/HQPTuner.app" "$APP" || die "step 1: no HQPTuner.app in the dmg"
hdiutil detach "$MOUNT" || die "step 1: hdiutil detach failed"

# ---- 2. the bundle ----------------------------------------------------------
[ -x "$BIN" ] || die "step 2: $BIN missing or not executable"
UI_ELEMENT=$(plutil -extract LSUIElement raw "$APP/Contents/Info.plist") || die "step 2: no LSUIElement in Info.plist"
[ "$UI_ELEMENT" = true ] || die "step 2: LSUIElement is '$UI_ELEMENT'"
codesign --verify --deep --strict "$APP" || die "step 2: the signature does not verify"
ARCHS=$(lipo -archs "$BIN")
[ "$ARCHS" = "$(uname -m)" ] || die "step 2: the executable is '$ARCHS' on a $(uname -m) machine"

# ---- 3. start the binary ----------------------------------------------------
# The stores go under HOME, so the run gets its own. BROWSER keeps the launch
# from opening a real browser.
[ "$(status "$BASE_URL/api/health")" = 000 ] || die "step 3: something already answers on $BASE_URL"
mkdir "$WORK/home"
HOME="$WORK/home" BROWSER=/usr/bin/true HQPTUNER_HQP_HOST=127.0.0.2 "$BIN" &
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

echo "smoke: OK"
