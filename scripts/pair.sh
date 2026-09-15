#!/usr/bin/env bash
#
# The pair driver. Its name is a literal in `docs/agents.md`, in the five agent
# definitions, in `tests-lane.py`, in `verdicts-lane.py` and in the `bwrap`
# carve-out `pair-passthrough.py` matches end to end, so the name stays here
# and the work lives beside it in `scripts/pair/`.
#
# `exec`, so the driver is this process: an exit status, a signal and a
# terminal all reach it unchanged, and stdout stays the contract stream
# `docs/agents.md` documents.
exec python3 "$(dirname "$0")/pair/cli.py" "$@"
