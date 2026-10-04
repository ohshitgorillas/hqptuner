#!/usr/bin/env bash
# Install a built package in a container with no systemd, run its binary once, then remove it.
# usage: packaging/linux/smoke.sh <package.deb|package.rpm>
set -euo pipefail

die() { echo "FAIL: $*" >&2; exit 1; }

[ $# -eq 1 ] || die "usage: smoke.sh <package.deb|package.rpm>"
[ -f "$1" ] || die "step 1: package not found: $1"
PKG=$(readlink -f "$1")
HEALTH_URL="http://127.0.0.1:8090/api/health"
PID=""
DATA=""

cleanup() {
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; fi
  if [ -n "$DATA" ]; then rm -rf "$DATA"; fi
}
trap cleanup EXIT

# ---- 1. install by file extension -------------------------------------------
case "$PKG" in
  *.deb) DEBIAN_FRONTEND=noninteractive apt-get install -y "$PKG" || die "step 1: apt-get install failed" ;;
  *.rpm) dnf install -y "$PKG" || die "step 1: dnf install failed" ;;
  *) die "step 1: not a .deb or .rpm: $PKG" ;;
esac

# ---- 2. installed files -----------------------------------------------------
[ -x /opt/hqptuner/HQPTuner ] || die "step 2: /opt/hqptuner/HQPTuner missing or not executable"
[ -f /usr/lib/systemd/system/hqptuner.service ] || die "step 2: /usr/lib/systemd/system/hqptuner.service missing"

# ---- 3. start the binary ----------------------------------------------------
DATA=$(mktemp -d)
XDG_DATA_HOME="$DATA" HQPTUNER_HQP_HOST=127.0.0.2 /opt/hqptuner/HQPTuner &
PID=$!

# ---- 4. health, at most 30 tries --------------------------------------------
CODE=000
for _ in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null --max-time 2 -w '%{http_code}' "$HEALTH_URL" || true)
  if [ "$CODE" = 200 ]; then break; fi
  kill -0 "$PID" 2>/dev/null || die "step 4: binary exited before GET /api/health answered"
  sleep 1
done
[ "$CODE" = 200 ] || die "step 4: GET /api/health answered $CODE after 30 tries"

# ---- 5. stop, remove, check -------------------------------------------------
kill "$PID"
for _ in $(seq 1 10); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 1
done
if kill -0 "$PID" 2>/dev/null; then die "step 5: binary PID $PID still running 10 s after kill"; fi
wait "$PID" || true
PID=""
case "$PKG" in
  *.deb) DEBIAN_FRONTEND=noninteractive apt-get remove -y hqptuner || die "step 5: apt-get remove failed" ;;
  *.rpm) dnf remove -y hqptuner || die "step 5: dnf remove failed" ;;
esac
[ ! -e /opt/hqptuner ] || die "step 5: /opt/hqptuner still present after remove"

echo "smoke: OK"
