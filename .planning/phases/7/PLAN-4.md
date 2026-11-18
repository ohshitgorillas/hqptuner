---
phase: 7
plan: 4
requirements: []
depends_on: [1, 2]
files:
  - tests/js/contracts/world.js
  - tests/js/contracts/schedules.js
  - tests/js/contracts/spectrogram-columns.test.js
  - tests/js/contracts/trace-probes.js
  - tests/js/model/gauges/playhead.test.js
---

# Phase 7: One time base - Plan 4: The test contracts on the time base

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- The replay harness (`world.js`, `schedules.js`), the trace probes and `playhead.test.js` define no seconds-to-ms or µs-to-ms constant and convert no stamp themselves; where plumbing needs a conversion it calls `hqptuner/static/lib/timebase.js`.
- No contract re-derives break detection: a break mark a test feeds is written in its table or comes from the code under test.
- `tests/js/contracts/trace-probes.js` contains no `EPS` and no allowance under another name, and every judgement it makes (the playhead's speed, never past the newest end, never backward, the trace's lead and the RMS) compares exactly.
- `tests/js/model/gauges/playhead.test.js` and the column suite's schedule hold no float allowance on a time and convert no time themselves.
- Every contract suite that passed at commit `503ddec8` still passes.

## Context

- D-10, D-11 and D-07 bind this plan. D-11: the harness is migrated, not retired (phase 8 owns that call). D-10: expected values are hand-written; only harness plumbing calls the structure.
- `docs/spec/testing.md` rule 13 (fakes answer from tables) and rule 18 (exact, no tolerance; slack only for closed-form rounding such as decibels).
- Owner ruling 2026-11-18 on the probes' `EPS`: a tolerance that absorbs float drift is a sign of slop in the code, and the code is fixed so it can be tested exactly. Plan 2 Task 3 makes the playhead's move exact in `pacePaint`; this plan removes the allowances that move needed, and no task here ends at a stop path for a cause the plan can already see.
- Out: the phase 8 red tables, any change to what a contract suite asserts, and retiring the harness.
- The `random` clone between `schedules.js` and `playhead.test.js` is Plan 15's.

## Tasks

### Task 1: The replay world stamps its delivered frames through the time base

- **Files:** tests/js/contracts/world.js
- **Reads:** tests/js/contracts/world.js#handler, tests/js/contracts/world.js#MS_PER_S, hqptuner/static/lib/timebase.js
- **Decisions:** D-10, D-11
- **Pins:** tests/js/contracts/trace-and-meters.test.js, tests/js/contracts/spectrogram-columns.test.js, tests/js/contracts/spectrogram-picture.test.js
- **Action:** `handler` records each delivered frame's start and end in playback ms through the time base, from the same whole samples it emits on the wire, so the world's frames carry exactly the stamps the feed store makes; its own `(at * MS_PER_S) / rate` conversions and `MS_PER_S` go, and the window's span in ms comes from the time base too. A frame the schedule gives no `at` still follows the one before it in samples: that is plumbing, as `follow` is in `tests/js/support/meterfeed.js`. Nothing the suites assert changes.
- **Verify:** Testing scope: plumbing only; the three contract suites already exercise the world; no new test; testing stops there. (1) `grep -nE "MS_PER_S|\* 1000|/ rate" tests/js/contracts/world.js` prints nothing. (2) `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/trace-and-meters.test.js tests/js/contracts/spectrogram-columns.test.js tests/js/contracts/spectrogram-picture.test.js` gives the same outcome per test as at commit `503ddec8`.

### Task 2: The schedules convert through the time base

- **Files:** tests/js/contracts/schedules.js, tests/js/contracts/spectrogram-columns.test.js
- **Reads:** tests/js/contracts/schedules.js#lengths, tests/js/contracts/schedules.js#bursts, tests/js/contracts/schedules.js#PAINT_MS, tests/js/contracts/schedules.js#safari, tests/js/contracts/spectrogram-columns.test.js#stoodBehind
- **Decisions:** D-10, D-11
- **Pins:** tests/js/contracts/trace-and-meters.test.js, tests/js/contracts/spectrogram-columns.test.js, tests/js/contracts/spectrogram-picture.test.js
- **Action:** `schedules.js` keeps no `MS_PER_S`. Where it turns samples into music time, `lengths` and `bursts`, it calls the time base. Where it turns a length in ms into samples, that is a conversion production never makes, so the time base gains nothing for it: the pools are written in whole samples at the schedule's rate, by hand, or the conversion reads the time base's seconds-to-ms value, the test writer's choice. The paint interval reads the time base's value too. Every schedule the suites run keeps its rate, its frame lengths and its arrivals. The column suite's split schedule stands the playhead half a slice behind: that delay is the user's offset, in seconds, and it is written in seconds by hand (D-10), not worked out from `SLICE_MS` with a division by 1000 of the suite's own; it names the same delay as before.
- **Verify:** Testing scope: plumbing only; the three contract suites already exercise every schedule; no new test; testing stops there. (1) `grep -nE "MS_PER_S\s*=|\* 1000|1000 /" tests/js/contracts/schedules.js` and `grep -nE "/ *1000\b" tests/js/contracts/spectrogram-columns.test.js` print nothing. (2) The three contract suites give the same outcome per test as at commit `503ddec8`.

### Task 3: The trace probes judge exactly, with no float allowance

- **Files:** tests/js/contracts/trace-probes.js
- **Reads:** tests/js/contracts/trace-probes.js#EPS, tests/js/contracts/trace-probes.js#covers, tests/js/contracts/trace-probes.js#newestEnd, tests/js/contracts/trace-probes.js#wallProbe, tests/js/contracts/trace-probes.js#traceProbe, tests/js/contracts/trace-probes.js#judgeCovered, hqptuner/static/model/gauges/playhead.js#pacePaint, hqptuner/static/model/gauges/meter/meter.js#foldFrames, hqptuner/static/lib/timebase.js
- **Decisions:** D-06, D-07, D-10
- **Pins:** tests/js/contracts/trace-and-meters.test.js
- **Action:** `covers`, `newestEnd` and `coveredBy` read a frame's start and end through the time base, never `at + ms` (D-06). `EPS` leaves the file entirely (D-07, owner ruling 2026-11-18), with no allowance under another name, and the doc comments that describe a float allowance (the trace probe's "within a float's rounding" sentence among them) stop describing one. Each judgement compares exactly, because the code under it is exact: the playhead advances by exactly the wall time handed to it at an unchanged delay (Plan 2 Task 3), it stands exactly at the newest end when it reaches it and never passes it (`pacePaint` clamps to that end, and the world's frames carry exactly the feed store's stamps after Task 1), it never moves backward, the trace is the frame the decision named by the same coverage of the same stamps, and the meters' RMS is the power mean the loop folds by the same arithmetic in the same frame order (`foldFrames`). One fact binds how the speed judgement is stated: a playhead in ms is a double, and the difference of two playheads rounds at the playhead's magnitude, so it cannot equal `dt` exactly whatever the code does (measured 2026-11-18 with Plan 2 Task 3's fix applied: paint 9 of `steady_paints` moved 16.66666666666663 against a `dt` of 16.666666666666657). The exact statement of "moved its wall time" is the position the paint leaves, where the paint before it left the playhead plus `dt`; the test writer states it so. Measured on a scratch copy of this tree on 2026-11-18, with the probe exact and Plan 2 Task 3's fix in `pacePaint`: every `trace-and-meters.test.js` case passes, 91 of 91; with the probe exact and `pacePaint` as it stands at `503ddec8`, the speed case fails in 7 of the 9 schedules and no other case fails.
- **Verify:** Testing scope: the probe's findings on the same replays; already covered by `trace-and-meters.test.js`, whose cases stay as they are; the bite for the code change is Plan 2 Task 3's; no new test; testing stops there. (1) `grep -nE "EPS|1e-[0-9]" tests/js/contracts/trace-probes.js` prints nothing, and `grep -nE "\.at \+ [a-z\[\]\.]*\.ms" tests/js/contracts/trace-probes.js` prints nothing. (2) `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/trace-and-meters.test.js` passes every case, the same outcome per test as at commit `503ddec8`.

### Task 4: The playhead suite feeds tables and converts nothing itself

- **Files:** tests/js/model/gauges/playhead.test.js
- **Reads:** tests/js/model/gauges/playhead.test.js#frames, tests/js/model/gauges/playhead.test.js#endOf, tests/js/model/gauges/playhead.test.js#capture, tests/js/model/gauges/playhead.test.js#safari
- **Decisions:** D-06, D-10
- **Pins:** tests/js/model/gauges/playhead.test.js
- **Action:** The suite's `endOf` helper goes and its readers use the time base (D-06). `MS_PER_S` and `US_PER_MS` go: the capture's stamps are converted through the time base, and the capture's engine delay and the owner's offset through the time base's µs and seconds conversions. The capture's 60 Hz paint interval, `CAPTURE_PAINT_MS`, takes the time base's seconds-to-ms value, as the schedules' paint interval does (Task 2), not a bare 1000 of the suite's own. `capture()` no longer works out a break by comparing `at` with the previous end: its break marks come from a hand-written list of the capture rows that begin one, or from the capture's own data, never from a comparison the test computes (D-10). Every case keeps what it asserts.
- **Verify:** Testing scope: plumbing only; the suite's own cases are the check; no new test; testing stops there. (1) `grep -nE "MS_PER_S|US_PER_MS|const endOf|at !== ends|1000 /" tests/js/model/gauges/playhead.test.js` prints nothing. (2) `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead.test.js` gives the same outcome per test as at commit `503ddec8`. (3) `scripts/gate.sh npx tsc -p tsconfig.node.json` passes.

### Task 5: The playhead suite judges the playhead's moves exactly, with no float allowance

- **Files:** tests/js/model/gauges/playhead.test.js
- **Reads:** tests/js/model/gauges/playhead.test.js#EPS, tests/js/model/gauges/playhead.test.js#BREACHES, tests/js/model/gauges/playhead.test.js#movesOf, tests/js/model/gauges/playhead.test.js#standing, hqptuner/static/model/gauges/playhead.js#pacePaint
- **Decisions:** D-07
- **Pins:** tests/js/model/gauges/playhead.test.js
- **Action:** `EPS` goes from the suite (D-07, owner ruling 2026-11-18), and so does the `1e-9` allowance in the case comparing two 60 Hz paints with one 30 Hz paint; no allowance returns under another name. The cases that judge a move at an unchanged delay (the breaches `moves_other_than_its_wall_time...` and `jumps_further_than_its_wall_time...`, and the "moves exactly its wall time while the feed lands" cases), the burst-landing case that compares two runs' playheads, and the two-paints-against-one case compare exactly. The same fact as Task 3 binds them: a difference of two playheads cannot equal `dt` in doubles, so a move is stated by the position it leaves, where the playhead stood plus `dt`. Measured on a scratch copy on 2026-11-18: every one of these cases passes compared exactly in that form, 304 of 304, against `pacePaint` both as it stands at `503ddec8` and with Plan 2 Task 3's fix; compared as a difference against `dt`, 17 fail against either. The `SLOWER_PAINT_MS` bound in the paint-rate case is a bound the behavior holds to, not a float allowance, and it stays. Every case keeps what it asserts.
- **Verify:** Testing scope: the same cases at exact comparison; no new test; testing stops there. (1) `grep -nE "\bEPS\b|1e-[0-9]" tests/js/model/gauges/playhead.test.js` prints nothing. (2) `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead.test.js` gives the same outcome per test as at commit `503ddec8`. (3) `scripts/gate.sh npx tsc -p tsconfig.node.json` passes.
