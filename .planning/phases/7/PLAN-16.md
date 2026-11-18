---
phase: 7
plan: 16
requirements: []
depends_on: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
files:
  - .jscpd.json
---

# Phase 7: One time base - Plan 16: The duplication budget

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- `scripts/gate.sh npx jscpd` reports at most 43 clones, every one of a justified kind, and the `threshold` in `.jscpd.json` equals the duplication percentage that run prints.
- `scripts/gate.sh make check` reports no failing test that was passing at commit `503ddec8`, and the phase 8 tables are byte-identical to that commit.
- Every acceptance criterion of the phase holds on the tree as it stands.

## Context

- D-03 and D-09 bind this plan: the threshold drops from 2.3 to what the repository measures after the phase. Lowering it tightens a gate; it needs no exemption.
- `make jscpd` runs jscpd once per format in `.jscpd.json` and judges each against the one threshold, while AC1 reads one run over every format. The two can disagree if one format's figure is above the combined one.
- `make check` runs every gate and both full suites with coverage: several cores for minutes. Name it before it runs (`~/dev/CLAUDE.md` 3.1).

## Tasks

### Task 1: The jscpd threshold is what the repository measures

- **Files:** .jscpd.json
- **Reads:** .jscpd.json, Makefile
- **Decisions:** D-03, D-09
- **Action:** Run `scripts/gate.sh npx jscpd` over every format at once and read from its log the clone count and the duplication percentage, taking the figure jscpd compares `threshold` against (read in the installed jscpd which of lines or tokens that is; the 2.3 now set matches the JavaScript tokens figure, 2.29%). Read every clone it still lists: each must be of a justified kind (an import list or module docstring repeated across split test files, a type declaration that cannot share a field list, a per-script entry point, the `blockstats.py` mirror). If the count is above 43, or any listed clone is of no justified kind, stop: report the clones over the bound to the owner as a blocking question, each with its two sites, and change nothing. Otherwise set `threshold` to the printed figure, as printed. Then run `scripts/gate.sh make jscpd`; if a single format's figure is above the threshold so set, the per-format gate and AC1 collide: stop and put both figures to the owner as a blocking question instead of choosing one. `.jscpd.json` changes in `threshold` alone.
- **Verify:** Testing scope: the gates and suites are the check; no new test; testing stops there. (1) `scripts/gate.sh npx jscpd` prints a clone count of at most 43, and `node -p "require('./.jscpd.json').threshold"` prints the same figure as that run's duplication percentage. (2) `scripts/gate.sh make jscpd` passes. (3) `grep -rnE "(MS|US)_PER_S\s*=" hqptuner/static tests/js` prints hits in one file only, `hqptuner/static/lib/timebase.js`. (4) `grep -rn "MS_PER_S" hqptuner/static/components hqptuner/static/model/gauges/meter` prints nothing, and `grep -nE "^const [A-Z_]+_S\b" hqptuner/static/model/gauges/meter/steps.js` prints nothing. (5) `grep -rn "SAME_MS" tests/js` prints nothing and `grep -n "EPS" tests/js/contracts/trace-probes.js` prints nothing. (6) `grep -n "lib/timebase.js" docs/spec/timing.md` prints a line. (7) `scripts/gate.sh make check` reports no failing test that passed at commit `503ddec8` (compare against a `scripts/gate.sh make check` log taken at that commit in a scratch worktree, or the phase's recorded baseline), and `git diff 503ddec8 -- tests/js/model/gauges/playhead-lag.test.js tests/js/model/gauges/playhead-motion.test.js tests/js/model/gauges/playhead-scroll.test.js` prints nothing. (8) The six-rate contiguity case from Plan 1 passes in `tests/js/store/meter/feed.test.js`.
