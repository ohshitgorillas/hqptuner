#!/usr/bin/env bash
# Install, upgrade, remove and (deb) purge a built package on a throwaway systemd machine.
# usage: packaging/linux/lifecycle.sh <package.deb|package.rpm>
set -euo pipefail

die() { echo "FAIL: $*" >&2; exit 1; }

[ "${GITHUB_ACTIONS:-}" = true ] || die "refused: lifecycle.sh runs only with GITHUB_ACTIONS=true"
[ $# -eq 1 ] || die "usage: lifecycle.sh <package.deb|package.rpm>"
[ -f "$1" ] || die "step 1: package not found: $1"
PKG=$(readlink -f "$1")
case "$PKG" in
  *.deb) KIND=deb ;;
  *.rpm) KIND=rpm ;;
  *) die "step 1: not a .deb or .rpm: $PKG" ;;
esac
UNIT=hqptuner.service
API="http://127.0.0.1:8090/api"
DATA=/var/lib/hqptuner
FAVORITE=lifecycle-check
TRIES=30

# Run "$@" once a second until it succeeds, at most $TRIES times.
retry() {
  local i
  for ((i = 0; i < TRIES; i++)); do
    if "$@"; then return 0; fi
    sleep 1
  done
  return 1
}

healthy() { [ "$(curl -s -o /dev/null --max-time 2 -w '%{http_code}' "$API/health")" = 200 ]; }
inactive() { ! systemctl is-active --quiet "$UNIT"; }
has_data() { [ -n "$(find -L "$DATA" -type f -print -quit 2>/dev/null)" ]; }
no_data() { [ ! -e "$DATA" ] && [ ! -e /var/lib/private/hqptuner ]; }
favorite_listed() { curl -s --max-time 2 "$API/favorites" | grep -qF "\"$FAVORITE\""; }

# ---- 1. install, active, enabled, healthy -----------------------------------
case "$KIND" in
  deb) DEBIAN_FRONTEND=noninteractive apt-get install -y "$PKG" || die "step 1: apt-get install failed" ;;
  rpm) dnf install -y "$PKG" || die "step 1: dnf install failed" ;;
esac
retry systemctl is-active --quiet "$UNIT" || die "step 1: $UNIT not active after install"
systemctl is-enabled --quiet "$UNIT" || die "step 1: $UNIT not enabled after install"
retry healthy || die "step 1: GET /api/health not 200 after $TRIES tries"

# ---- 2. one favorite lands on disk ------------------------------------------
curl -sf --max-time 5 -X PUT -H 'Content-Type: application/json' \
  -d "{\"filters\": [\"$FAVORITE\"]}" "$API/favorites" >/dev/null || die "step 2: PUT /api/favorites failed"
retry has_data || die "step 2: no file under $DATA after PUT /api/favorites"

# ---- 3. upgrade path: install the same package again ------------------------
case "$KIND" in
  deb) DEBIAN_FRONTEND=noninteractive apt-get install -y --reinstall "$PKG" || die "step 3: apt-get reinstall failed" ;;
  rpm) dnf reinstall -y "$PKG" || die "step 3: dnf reinstall failed" ;;
esac
retry systemctl is-active --quiet "$UNIT" || die "step 3: $UNIT not active after reinstall"
retry healthy || die "step 3: GET /api/health not 200 after reinstall"
favorite_listed || die "step 3: GET /api/favorites lost $FAVORITE after reinstall"

# ---- 4. remove keeps the data -----------------------------------------------
case "$KIND" in
  deb) DEBIAN_FRONTEND=noninteractive apt-get remove -y hqptuner || die "step 4: apt-get remove failed" ;;
  rpm) dnf remove -y hqptuner || die "step 4: dnf remove failed" ;;
esac
retry inactive || die "step 4: $UNIT still active after remove"
has_data || die "step 4: $DATA lost its files on remove"

# ---- 5. deb only: purge keeps the data unless the question says delete ------
if [ "$KIND" = deb ]; then
  DEBIAN_FRONTEND=noninteractive apt-get purge -y hqptuner || die "step 5: first apt-get purge failed"
  has_data || die "step 5: $DATA lost its files on purge with no answer"
  DEBIAN_FRONTEND=noninteractive apt-get install -y "$PKG" || die "step 5: apt-get install before second purge failed"
  echo "hqptuner hqptuner/purge-data boolean true" | debconf-set-selections || die "step 5: debconf-set-selections failed"
  DEBIAN_FRONTEND=noninteractive apt-get purge -y hqptuner || die "step 5: second apt-get purge failed"
  no_data || die "step 5: $DATA still present after purge answered true"
fi

echo "lifecycle: OK ($KIND)"
