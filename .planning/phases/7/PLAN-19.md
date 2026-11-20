---
phase: 7
plan: 19
requirements: []
depends_on: [17, 18]
files:
  - .jscpd.json
---

# Phase 7: One time base - Plan 19: The phase in front of the owner

## Goal

The app keeps time on one time base and duplicated code is not allowed anywhere. Every surface the phase reshaped has been seen on the rebuilt dev build by the owner. This plan closes UAT items 8, 9 and 10 at the hand-back and holds AC1 after Plans 17 and 18.

## Must be true when done

- `scripts/gate.sh make check` fails on the 12 phase 8 playhead tables and nothing else. The full browser suite, `make test-e2e`, which never ran in this phase, passes.
- `.jscpd.json`'s `threshold` is still the lowest two-decimal value at which every per-format run of `scripts/gate.sh make jscpd` passes, with at most 43 clones (AC1).
- At the hand-back URL, the owner has seen that the Source page meters, every spectrum style and the aurora move and look as before (item 8). The owner has seen that the Source drawer's spectrogram scrolls and paints with no seam or gap between slices (item 9). The owner has seen that each popover parks where it did, and that the Visual settings drawer and the matrix plot look and behave as before (item 10).

## Context

- D-09 binds Task 1: the threshold follows what the repository measures. Lowering it tightens a gate. Raising it is a gate exemption and needs the owner's approval first (repo `CLAUDE.md`, gate exemptions).
- UAT item 13 is the owner's open item for phase 8: the 12 baseline-red tables in `tests/js/model/gauges/playhead-lag.test.js`, `playhead-motion.test.js` and `playhead-scroll.test.js`. Nothing here edits them or works around them.
- `.claude/task-check.sh` rebuilds `hqptuner:dev` only after a green `make check` (its header, and the `hand-back` skill: "green only"). That is why no dev build ran in this phase (SUMMARY deviation, phase 7). The recalled UAT and SUMMARY items for phase 7 name the same three owed hand-backs.
- `make check` and `make test-e2e` each hold several cores for minutes, the second with headless chromium. Name each before it runs (`~/dev/CLAUDE.md` 3.1).

## Tasks

### Task 1: Every gate and suite stands where the phase leaves it, the browser suite included

- **Files:** .jscpd.json
- **Reads:** .jscpd.json, Makefile
- **Decisions:** D-03, D-09
- **Action:** First run `scripts/gate.sh make check` and read its log. Then run `scripts/gate.sh make jscpd`. Then run `scripts/gate.sh make test-e2e`. A failure in any of them that is not one of the 12 phase 8 table tests is evidence. Stop and report it with its shortest decisive line; never absorb it (`~/dev/CLAUDE.md` 6.3). Re-measure the jscpd floor on this tree: find the lowest two-decimal `threshold` at which every per-format run passes. If that value is below the current one, set it; `.jscpd.json` changes in `threshold` alone. If that value is above the current one, stop and put both figures to the owner as a blocking question, changing nothing. If it is unchanged, commit nothing.
- **Verify:** Testing scope: the gates and suites are the check; no new test; testing stops there. (1) The `make check` log shows pytest with no failure, and the JS suite's only `not ok` lines are the 12 tests in the three phase 8 table files. `git diff 503ddec8 -- tests/js/model/gauges/playhead-lag.test.js tests/js/model/gauges/playhead-motion.test.js tests/js/model/gauges/playhead-scroll.test.js` prints nothing. (2) `scripts/gate.sh make jscpd` passes at the `threshold` in `.jscpd.json` and fails at 0.01 below it, and `scripts/gate.sh npx jscpd` reports at most 43 clones. (3) `scripts/gate.sh make test-e2e` exits 0, `test_spectrogram_scrolls_smoothly_through_bursty_feeds.py`, `test_popovers_fit_every_format.py` and Plan 18's popover file included. (4) `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-source-paint-blank.test.js` passes.

### Task 2: The owner sees the reshaped surfaces on the rebuilt dev build

- **Files:** none (verification only)
- **Action:** Load the `hand-back` skill and the host skill before quoting any URL or touching host state. Run `bash .claude/task-check.sh`. It stops at its `make check` step on the 12 phase 8 tables, as it did all phase. Do not write the rebuild trigger by hand without the owner's ruling: skipping the gate's hard stop is the owner's call. Put the owner a blocking question (`~/dev/CLAUDE.md` 6.1). Cause: the 12 phase 8 tables. Evidence: Task 1's log path and its 12 `not ok` lines. Confidence. The question: may `hqptuner:dev` be rebuilt from this tree through the trigger and health check `task-check.sh` runs after its gate, or will the owner rebuild it. Once the dev build serves on `:8090`, take your own `scripts/snap.py` captures and read each one element by element, as the `hand-back` skill says. Then hand the owner the URL with the surfaces to look at. For plan 3: the Source page meters, every spectrum style and the aurora, while music plays. For plan 2: the Source drawer's spectrogram scrolling. For plan 6: each of the nine popovers, the Visual settings drawer and the matrix plot. Probe read-only. Never click Apply, Apply & Save, Discard or Save as New, since the staging buffer is the owner's (`live-daemon` skill). Dispatch no reviewer agent; only the owner commissions one.
- **Verify:** human-verify: the owner, at the hand-back URL on the rebuilt `hqptuner:dev`, reports for each of UAT items 8, 9 and 10 that the surface looks and moves as it did before the phase. The report quotes the owner's ruling on the rebuild. A surface the owner says differs is a defect report and goes back to planning, never a pass.
