#!/usr/bin/env bash
# task-check — HQPTuner definition-of-done gate for dev work.
#
#   1. make check         full quality gate (ruff/black/xenon/mypy/pytest +
#                         eslint/prettier/tsc/knip/node tests)
#   2. rebuild            hqptuner:dev container from the working tree
#                         (docker-compose.yaml — NOT the prod compose.yaml)
#   3. health check       poll :8090 until it serves, so the user is never
#                         handed a container that failed to come up
#
# The gate runs FIRST and hard-gates the rebuild: the user never loads a
# container built from a tree that failed the gate. The docker step is
# sudo-gated; that is expected and intended.
#
# Dev-only tooling: references docker-compose.yaml, which is gitignored (the
# dev stack is per-host). Not shipped in the wheel.
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root (.claude/.. )

COMPOSE="docker-compose.yaml"
URL="http://127.0.0.1:8090/"

echo "== [1/3] make check =="
make check || { echo "FAIL: make check is red — fix before any rebuild." >&2; exit 1; }

echo
echo "== [2/3] rebuild hqptuner:dev from the working tree =="
sudo docker compose -f "$COMPOSE" up -d --build

echo
echo "== [3/3] health check $URL =="
code=""
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
if [ "$code" != "200" ]; then
  echo "FAIL: :8090 did not serve 200 after rebuild (last=$code). Recent logs:" >&2
  sudo docker compose -f "$COMPOSE" logs --tail=40 hqptuner >&2 || true
  exit 1
fi

# LAN address resolved at runtime — never hardcode a host's address in the repo.
LAN=$(hostname -I 2>/dev/null | awk '{print $1}')

echo
echo "PASS — gate green, hqptuner:dev rebuilt from the working tree and serving."
echo "View + test:  http://127.0.0.1:8090  (local)${LAN:+   ·   http://$LAN:8090  (LAN)}"
