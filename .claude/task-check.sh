#!/usr/bin/env bash
# task-check — HQPTuner definition-of-done gate for dev work.
#
#   1. make check         full quality gate (ruff/black/xenon/mypy/pytest +
#                         eslint/prettier/tsc/knip/node tests)
#   2. rebuild            hqptuner:dev container from the working tree, via a
#                         trigger file a root-owned systemd path unit watches
#                         (no sudo: agent shells run inside bwrap)
#   3. health check       poll :8090 until it serves, so the user is never
#                         handed a container that failed to come up
#
# The gate runs FIRST and hard-gates the rebuild: the user never loads a
# container built from a tree that failed the gate.
#
# Dev-only tooling. The trigger and result paths are per-host, so they come
# from $HQPTUNER_REBUILD_TRIGGER and $HQPTUNER_REBUILD_RESULT. Set them in a
# per-machine surface (.claude/settings.local.json env, or export them for a
# hand run) and record the host's values in that host's skill — never here.
# Not shipped in the wheel.
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root (.claude/.. )

# No apostrophes in these messages: bash honours quotes inside ${var:?word},
# so one would swallow everything up to the next apostrophe.
TRIGGER="${HQPTUNER_REBUILD_TRIGGER:?set HQPTUNER_REBUILD_TRIGGER to the rebuild trigger path for this host}"
RESULT="${HQPTUNER_REBUILD_RESULT:?set HQPTUNER_REBUILD_RESULT to the rebuild result path for this host}"
URL="http://127.0.0.1:8090/"
REBUILD_TIMEOUT=600

echo "== [1/3] make check =="
make check || { echo "FAIL: make check is red — fix before any rebuild." >&2; exit 1; }

echo
echo "== [2/3] request rebuild of hqptuner:dev from the working tree =="
nonce=$(date +%s%N)
mkdir -p "$(dirname "$TRIGGER")"
printf '%s\n' "$nonce" >"$TRIGGER"
echo "trigger written ($TRIGGER, nonce $nonce); waiting up to ${REBUILD_TIMEOUT}s for $RESULT"

matched=0
for _ in $(seq 1 "$REBUILD_TIMEOUT"); do
  if [ -r "$RESULT" ] && grep -qx "nonce=$nonce" "$RESULT" && grep -q '^status=' "$RESULT"; then
    matched=1
    break
  fi
  sleep 1
done
if [ "$matched" -ne 1 ]; then
  echo "FAIL: no rebuild result for nonce $nonce after ${REBUILD_TIMEOUT}s." >&2
  if [ -e "$TRIGGER" ]; then
    echo "The trigger file is still present, so the path unit never fired (is hqptuner-rebuild.path enabled?)." >&2
  fi
  exit 1
fi
status=$(grep '^status=' "$RESULT" | tail -1 | cut -d= -f2)
if [ "$status" != "0" ]; then
  echo "FAIL: rebuild exited $status. Result:" >&2
  cat "$RESULT" >&2
  exit 1
fi

echo
echo "== [3/3] health check $URL =="
code=""
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
if [ "$code" != "200" ]; then
  echo "FAIL: :8090 did not serve 200 after rebuild (last=$code). Rebuild result:" >&2
  cat "$RESULT" >&2
  exit 1
fi

# LAN address resolved at runtime — never hardcode a host's address in the repo.
LAN=$(hostname -I 2>/dev/null | awk '{print $1}')

echo
echo "PASS — gate green, hqptuner:dev rebuilt from the working tree and serving."
echo "View + test:  http://127.0.0.1:8090  (local)${LAN:+   ·   http://$LAN:8090  (LAN)}"
