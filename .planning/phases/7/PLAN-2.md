---
phase: 7
plan: 2
requirements: []
depends_on: [1]
files:
  - hqptuner/static/model/gauges/playhead.js
  - hqptuner/static/store/meter/spectrogram.js
  - hqptuner/static/model/gauges/slicerange.js
  - hqptuner/static/lib/spectroraster.js
  - hqptuner/static/components/faceplate/drawers/source/paint.js
  - tests/js/store/meter/spectrogram.test.js
  - tests/js/model/gauges/slicerange.test.js
  - tests/js/lib/spectroraster.test.js
  - tests/js/model/gauges/playhead.test.js
---

# Phase 7: One time base - Plan 2: The playback model and the history read the time base

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- The pacing decision, the spectrogram history, the slice range and the raster read a frame's or a slice's start and end only through `hqptuner/static/lib/timebase.js`; none keeps a start or end helper of its own.
- A spectrogram slice ends exactly where its last frame ends, so contiguous slices join with no gap and no overlap, compared with `===`.
- At an unchanged delay a paint leaves the playhead exactly where the paint before it left it plus the paint's wall time, unless it stands at the newest end; a changed delay moves it by exactly the change on top of that.
- The phase 8 tables give the same result on every case as before this plan.

## Context

- D-02, D-06 and D-07 bind this plan; Plan 1 made the time base and the frames' converted end.
- `COLUMN_EPS` in `lib/spectroraster.js` is pixel arithmetic and stays (D-07).
- Owner ruling 2026-11-18: a test tolerance that absorbs float drift marks slop in the code, and the code is fixed so it can be tested exactly. Task 3 is that fix for the playhead's move; Plans 3, 4 and 15 remove the allowances that leaned on it.
- The phase 8 tables (`playhead-lag`, `playhead-motion`, `playhead-scroll` under `tests/js/model/gauges/`) stay byte-identical (AC7).
- Testing policy: `docs/spec/testing.md` rules 8, 13, 15 and 18; the test writer picks the unit, lane, assertion and values.

## Tasks

### Task 1: The pacing decision reads frame start and end through the time base

- **Files:** hqptuner/static/model/gauges/playhead.js
- **Reads:** hqptuner/static/model/gauges/playhead.js#startOf, hqptuner/static/model/gauges/playhead.js#endOf, hqptuner/static/model/gauges/playhead.js#coverage, hqptuner/static/lib/timebase.js
- **Decisions:** D-06
- **Pins:** tests/js/model/gauges/playhead.test.js, tests/js/model/gauges/playhead-line.test.js, tests/js/model/gauges/playhead-lag.test.js, tests/js/model/gauges/playhead-motion.test.js, tests/js/model/gauges/playhead-scroll.test.js
- **Action:** `playhead.js` drops its own `startOf` and `endOf` and reads every frame's start and end through the time base, so a frame the feed stamped ends at its converted end and the `?? NaN` guard lives in the structure only (D-06). `coverage`, `pacePaint` and `walk` decide exactly as before. No other file changes: the model imports from `lib/`, which the layering allows.
- **Verify:** Testing scope: no behavior changes for hand-built frames, and feed-stamped frames now end where their stamps say; the playhead suites already pin the decision; no new test; testing stops there. (1) `grep -nE "const (startOf|endOf)" hqptuner/static/model/gauges/playhead.js` prints nothing. (2) `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead.test.js tests/js/model/gauges/playhead-line.test.js tests/js/model/gauges/playhead-lag.test.js tests/js/model/gauges/playhead-motion.test.js tests/js/model/gauges/playhead-scroll.test.js` gives the same pass and fail outcome per test as at commit `503ddec8`. (3) `bash .claude/task-check.sh` passes.

### Task 2: Spectrogram slices end exactly where their last frame ends

- **Files:** hqptuner/static/store/meter/spectrogram.js, hqptuner/static/model/gauges/slicerange.js, hqptuner/static/lib/spectroraster.js, hqptuner/static/components/faceplate/drawers/source/paint.js, tests/js/store/meter/spectrogram.test.js, tests/js/model/gauges/slicerange.test.js, tests/js/lib/spectroraster.test.js
- **Reads:** hqptuner/static/store/meter/spectrogram.js#addSpectrumFrame, hqptuner/static/store/meter/spectrogram.js#closeSlice, hqptuner/static/store/meter/spectrogram.js, hqptuner/static/model/gauges/slicerange.js#sliceRange, hqptuner/static/lib/spectroraster.js#endOf, hqptuner/static/components/faceplate/drawers/source/paint.js, docs/spec/timing.md#Rules
- **Decisions:** D-02, D-06, D-07
- **Pins:** tests/js/store/meter/spectrogram.test.js, tests/js/store/meter/spectrogram-bands.test.js, tests/js/model/gauges/slicerange.test.js, tests/js/lib/spectroraster.test.js, tests/js/components/faceplate-drawers/drawers-source-paint.test.js, tests/js/components/faceplate-drawers/drawers-source-paint-blank.test.js, tests/js/contracts/spectrogram-columns.test.js, tests/js/contracts/spectrogram-picture.test.js
- **Action:** The behavior the owner wants (D-02, timing rule 1, "positions come from stamps"): a slice starts at its first frame's start and ends at its last frame's converted end, so a closed slice's end equals the next contiguous slice's start exactly. `addSpectrumFrame` takes the frame's end from the time base, never `at + ms`. A slice carries its end, and everything that reads a slice's end, `sliceRange`, the raster's column walk and `source/paint.js`, reads it through the time base; the raster's exported `endOf` goes and its importers move to the structure. Slices built by hand in a test as `{ at, ms }` keep working through the structure's start-plus-length branch from Plan 1. The test helpers that re-derive a start or end (`startOf` and `endOf` in `slicerange.test.js`, the end helper in `spectrogram.test.js`) go and the suites read through the time base (D-06). `COLUMN_EPS` stays. Tests first: the exact join of contiguous slices at a rate where the current `at + ms` misses, red against the current `spectrogram.js`.
- **Verify:** Testing scope: the outcome is exact slice joins; already covered are the history's clearing, the window range and the raster columns; the smallest new check is one exact-join case at the history's store lane; testing stops there. (1) Red run: the new join case in `tests/js/store/meter/spectrogram.test.js` fails by `AssertionError` against `spectrogram.js` as at HEAD. (2) After the change, `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test` over every file in this task's Pins gives the same outcome per test as at commit `503ddec8`, the new case passing. (3) `grep -nE "(endOf|startOf|end) = " hqptuner/static/lib/spectroraster.js tests/js/model/gauges/slicerange.test.js tests/js/store/meter/spectrogram.test.js` and `grep -nE "\.at \+ [a-z.]*\.?ms\b|at \+ ms\b" hqptuner/static/store/meter/spectrogram.js hqptuner/static/model/gauges/slicerange.js hqptuner/static/lib/spectroraster.js` print nothing, and `grep -n "COLUMN_EPS" hqptuner/static/lib/spectroraster.js` still prints its definition. (4) `scripts/gate.sh npx tsc -p jsconfig.json` and `scripts/gate.sh npx tsc -p tsconfig.node.json` pass. (5) `bash .claude/task-check.sh` passes and the hand-back URL shows the Source drawer's spectrogram drawing as before; the owner looks at it there.

### Task 3: The playhead moves by exactly the paint's wall time

- **Files:** hqptuner/static/model/gauges/playhead.js, tests/js/model/gauges/playhead.test.js
- **Reads:** hqptuner/static/model/gauges/playhead.js#pacePaint, hqptuner/static/model/gauges/playhead.js#followLine, tests/js/model/gauges/playhead.test.js#BREACHES, tests/js/model/gauges/playhead.test.js#jumpsOf
- **Decisions:** D-01, D-07
- **Pins:** tests/js/model/gauges/playhead.test.js, tests/js/model/gauges/playhead-line.test.js, tests/js/model/gauges/playhead-lag.test.js, tests/js/model/gauges/playhead-motion.test.js, tests/js/model/gauges/playhead-scroll.test.js, tests/js/store/meter/loop.test.js, tests/js/store/meter/loop-painters.test.js, tests/js/contracts/trace-and-meters.test.js
- **Action:** The behavior the owner wants, as the module's own header states it: the playhead moves at wall speed, each paint moving it by its `dt`, and when the delay changes it jumps by the change. In the owner's terms, a paint at an unchanged delay leaves the playhead exactly where the paint before it left it plus the wall time the paint was handed, nothing added and taken back; a paint at a changed delay moves it by that wall time and by exactly the change; the newest queued end still caps it, and a restart still stands it one delay behind that end. The cause today, read in `pacePaint`: the carried-on position is worked out as the last playhead plus `dt` plus the delay the last paint ran at, less the delay now, so at an unchanged delay the delay is added and taken away again and the sum rounds twice; measured on 2026-11-18, 58 of 1,000 steady paints at `dt` 1000/60 and a 250 ms delay land off where the playhead stood plus `dt`. The fix works the delay change out first, as one difference of the two delays, which is exactly zero when the delay has not changed, and moves the playhead by `dt` and that change. Nothing else in the decision changes: `walk`, the restart and the clamp to the newest end stay as they are, and `followLine` and `settledLead` are not touched. Tests first, red against `playhead.js` as it stands: at the pacing decision's own lane (rule 15), a paint at an unchanged delay on inputs where adding and taking back the delay rounds, so the expected position, where the playhead stood plus `dt`, is exactly known; the test writer picks the unit, the assertion and the values (rule 18: exact, no allowance). A difference of two playheads in ms rounds at the playhead's magnitude and cannot equal `dt` in doubles whatever the code does, so the behavior is stated by the position the paint leaves.
- **Verify:** Testing scope: the outcome is the exact move at an unchanged delay; the delay-change jumps, the clamp, the restarts and every pacing breach are already pinned by `playhead.test.js` and the phase 8 tables; the smallest new check is the one exact-move case at the model lane; evidence is a red run and a green run; testing stops there. (1) Red run: with the new case in place and `hqptuner/static/model/gauges/playhead.js` as Plan 2 Task 1 left it, `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead.test.js` fails by `AssertionError` on that case. (2) After the change the same command passes it, and every file in Pins gives the same pass and fail outcome per test as at commit `503ddec8` (measured on a scratch copy on 2026-11-18: the model, store-meter and contract suites gave the same 12 failing cases, the same ones, with and without this fix). (3) `bash .claude/task-check.sh` passes and the owner sees the Source page's meters and the Source drawer's spectrogram move as before at the hand-back URL.
