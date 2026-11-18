---
phase: 7
plan: 5
requirements: []
depends_on: [1]
files:
  - docs/spec/timing.md
---

# Phase 7: One time base - Plan 5: The timing spec names the time base

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- `docs/spec/timing.md` names `hqptuner/static/lib/timebase.js` as the owner of the samples-to-ms conversion, and still names the feed store as the one call site that converts wire stamps.
- Every word added or changed in `docs/spec/timing.md` is the owner's, approved verbatim before it landed.

## Context

- D-05 binds this plan: the amended text is the owner's. An agent's draft is a proposal; the owner's wording is the spec.
- Sites D-05 names: the two-clocks table, the pipeline table's "Feed store" row, and rule 2.
- Markdown is written with `Write`/`Edit`, soft-wrapped one paragraph per line (`.claude/hooks/md-softwrap.py`); em dashes are forbidden.
- Out: any other change to the spec. Two places in it disagree with D-02 (the "Positions come from stamps" example `slice.end = last.at + last.ms`, and the two-clocks row's "converts both to ms"); they are named to the owner with the proposal, and change only in the words the owner approves.

## Tasks

### Task 1: The spec names the time base as the owner of the conversion

- **Files:** docs/spec/timing.md
- **Reads:** docs/spec/timing.md#The two clocks, docs/spec/timing.md#The meter pipeline, docs/spec/timing.md#Rules
- **Decisions:** D-05
- **Action:** Put a proposed amendment to the owner, as text in the reply, covering the sites D-05 names: `hqptuner/static/lib/timebase.js` owns the conversion of whole samples to ms and the reading of a frame's start and end, and the feed store stays the one call site that converts wire stamps and calls it to do so. Name the two spots that disagree with D-02 beside it. Land only what the owner approves, character for character, through `Edit`. Write nothing into the file before that approval.
- **Verify:** (1) human-verify: the owner has approved the amendment's wording, and `git diff -- docs/spec/timing.md` shows exactly that wording and nothing else. (2) `grep -n "lib/timebase.js" docs/spec/timing.md` prints at least one line. (3) `scripts/gate.sh .venv/bin/python .claude/hooks/md-softwrap.py --check docs/spec/timing.md` and `scripts/gate.sh .venv/bin/python scripts/gates/check_docs.py .` pass, and `grep -n "—" docs/spec/timing.md` prints nothing.
