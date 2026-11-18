---
phase: 7
plan: 3
requirements: []
depends_on: [1, 2]
files:
  - hqptuner/static/model/gauges/meter/vu.js
  - tests/js/model/gauges/meter/vu.test.js
  - tests/js/model/gauges/meter/vu-motion.test.js
  - hqptuner/static/components/faceplate/page/sourcepaint.js
  - hqptuner/static/model/gauges/meter/steps.js
  - hqptuner/static/model/gauges/meter/fire.js
  - tests/js/model/gauges/meter/steps.test.js
  - tests/js/model/gauges/meter/fire.test.js
  - tests/js/model/gauges/meter/meter-math.test.js
  - hqptuner/static/components/faceplate/page/spectrumfx.js
  - hqptuner/static/components/faceplate/page/aurora.js
  - hqptuner/static/components/faceplate/page/SourceMeter.js
  - tests/js/components/faceplate-page/sourcepaint-motion.test.js
  - tests/js/components/faceplate-page/sourcepaint-section.test.js
  - tests/js/components/faceplate-page/spectrumfx-fx.test.js
  - tests/js/components/faceplate-page/aurora-glsl.test.js
  - tests/js/support/rendered/sourcesection.js
  - hqptuner/static/store/meter/loop.js
  - tests/js/store/meter/loop-boot.test.js
  - tests/js/store/meter/loop-painters.test.js
  - tests/js/store/meter/loop.test.js
  - tests/js/store/meter/spectrum-motion.test.js
---

# Phase 7: One time base - Plan 3: Wall time in ms through the painters

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- The meter loop hands every painter `dt` in ms, and every painter and every step under `model/gauges/meter/` takes `dt` in ms.
- A meter, needle, spectrum, flame, cap, ridge, halo or aurora moves exactly as far over the same stretch of wall time as before this plan: no ballistic, hold or fall time a user sees changes.
- `grep -rn "MS_PER_S" hqptuner/static/components hqptuner/static/model/gauges/meter` prints nothing, and no constant in `model/gauges/meter/steps.js` has a name ending in `_S`.
- No meter test rounds wall times with `same()`.

## Context

- D-01 binds this plan: ms everywhere, seconds behind one conversion in the drawing code rejected. D-07: `same()` goes, `STEP_SLACK` stays.
- The order is bottom-up, the model steps first. Until Task 4 lands, the seam above each moved layer converts once, through the time base's functions, never a local constant; Task 3 and Task 4 remove each such seam as the layer above moves.
- The aurora's shader is vendor code (`hqptuner/static/vendor/cava/northern_lights.js`) whose `time` uniform counts seconds. It is an outside interface like the wire, so `aurora.js` converts once at that uniform, through the time base (planner's choice).
- Copy rule: two thrown messages, in `spectrumfx.js` and `aurora.js`, say "seconds". Once `dt` is ms they state a falsehood, so their corrected wording ships only as the owner approves it, verbatim (`CLAUDE.md`, "Factual errors in owner copy").
- Testing policy: `docs/spec/testing.md` rules 8, 11, 13 and 18, and `docs/spec/timing.md` rule 7. Expected values in moved tests are written in ms by hand; the test writer chooses them.
- No suite this plan moves keeps or gains a seconds-to-ms factor of its own (D-10): a time the suite writes is written in ms, and where plumbing needs a rate's period or a conversion it takes the time base's value. A moved suite's `dt * SECOND_MS` and `/ 1000` go with its move.
- Plan 2 comes first (`depends_on`): Task 4's exact comparisons read playback values that Plan 1's stamps and Plan 2 Task 3's exact playhead move make exact.

## Tasks

### Task 1: The VU needle moves on `dt` in ms

- **Files:** hqptuner/static/model/gauges/meter/vu.js, tests/js/model/gauges/meter/vu.test.js, tests/js/model/gauges/meter/vu-motion.test.js, hqptuner/static/components/faceplate/page/sourcepaint.js
- **Reads:** hqptuner/static/model/gauges/meter/vu.js#stepVu, hqptuner/static/model/gauges/meter/vu.js#moveNeedle, hqptuner/static/model/gauges/meter/vu.js#NATURAL, hqptuner/static/components/faceplate/page/sourcepaint.js#stepAll
- **Decisions:** D-01
- **Pins:** tests/js/model/gauges/meter/vu.test.js, tests/js/model/gauges/meter/vu-motion.test.js, tests/js/model/gauges/meter/vu-scale.test.js, tests/js/components/faceplate-page/meter-vu.test.js, tests/js/components/faceplate-page/vumeter.test.js
- **Action:** `stepVu` and the needle's closed-form motion take `dt` in ms, with the damping, natural frequency and every derived time constant expressed per ms, so the needle rises, rings and settles over the same wall time as before. `sourcepaint.js`, still handed seconds by its paint, converts once through the time base where it calls `stepVu`; Task 3 removes that. Doc comments name `dt` as wall time, ms. Tests first: the VU suites state their times in ms, red against the current `vu.js`; the ms-to-seconds divisions `vu.test.js` makes itself to count frames in a stretch (`readingAfter`, `SETTLE_FRAMES`, the settle case) go with the move, and its `_S` frame lengths are written in ms.
- **Verify:** Testing scope: the outcome is the same needle motion on ms; already covered by the VU suites, whose time inputs move to ms; no new case; testing stops there. (1) Red run: the updated `vu.test.js` and `vu-motion.test.js` fail by `AssertionError` against `vu.js` as at HEAD. (2) After the change every file in Pins passes. (3) `grep -nE "@param \{number\} dt" hqptuner/static/model/gauges/meter/vu.js | grep -v "ms"` prints nothing, and `grep -nE "/ *1000\b|\* *1000\b" tests/js/model/gauges/meter/vu.test.js tests/js/model/gauges/meter/vu-motion.test.js` prints nothing. (4) `bash .claude/task-check.sh` passes.

### Task 2: The meter steps and the flames move on `dt` in ms

- **Files:** hqptuner/static/model/gauges/meter/steps.js, hqptuner/static/model/gauges/meter/fire.js, tests/js/model/gauges/meter/steps.test.js, tests/js/model/gauges/meter/fire.test.js, tests/js/model/gauges/meter/meter-math.test.js, hqptuner/static/components/faceplate/page/sourcepaint.js, hqptuner/static/components/faceplate/page/spectrumfx.js, hqptuner/static/components/faceplate/page/aurora.js
- **Reads:** hqptuner/static/model/gauges/meter/steps.js#stepPace, hqptuner/static/model/gauges/meter/steps.js#stepLevel, hqptuner/static/model/gauges/meter/steps.js#stepCaps, hqptuner/static/model/gauges/meter/steps.js#stepGravity, hqptuner/static/model/gauges/meter/fire.js#stepFlames
- **Decisions:** D-01, D-07
- **Pins:** tests/js/model/gauges/meter/steps.test.js, tests/js/model/gauges/meter/fire.test.js, tests/js/model/gauges/meter/meter-math.test.js, tests/js/components/faceplate-page/spectrumfx-fx.test.js, tests/js/components/faceplate-page/aurora-glsl.test.js, tests/js/components/faceplate-page/sourcepaint-motion.test.js
- **Action:** Every step in `steps.js` and `stepFlames` take `dt` in ms. The step rate, each fall and gravity rate, and each time constant and hold (`RMS_TAU_S`, `HOLD_S`, `SHOWN_TAU_S`, `GHOST_TAU_S`, `CAP_HOLD_S`, `HALO_TAU_S`, `STEP_HZ`, `PEAK_FALL_DBPS`, `HOLD_FALL_DBPS`, `CAP_GRAVITY`, `AURORA_GRAVITY`) are restated per ms under names that say so, none ending in `_S`, with the same physical value, so each motion covers the same distance over the same wall time. The step rate stays defined once (timing rule 7). `STEP_SLACK` stays as it is (D-07). The three painters that call these steps, still handed seconds, convert once through the time base at each call; Task 3 removes those conversions. Tests first: the step and flame suites state their times in ms, red against the current `steps.js` and `fire.js`.
- **Verify:** Testing scope: the outcome is the same motion on ms; already covered by the step, flame and math suites, whose time inputs move to ms; no new case; testing stops there. (1) Red run: the updated `steps.test.js`, `fire.test.js` and `meter-math.test.js` fail by `AssertionError` against `steps.js` and `fire.js` as at HEAD. (2) After the change every file in Pins passes. (3) `grep -nE "^const [A-Z_]+_S\b" hqptuner/static/model/gauges/meter/steps.js` prints nothing and `grep -n "STEP_SLACK = 1e-9" hqptuner/static/model/gauges/meter/steps.js` prints its line. (4) `bash .claude/task-check.sh` passes.

### Task 3: The painters take `dt` in ms

- **Files:** hqptuner/static/components/faceplate/page/sourcepaint.js, hqptuner/static/components/faceplate/page/spectrumfx.js, hqptuner/static/components/faceplate/page/aurora.js, hqptuner/static/components/faceplate/page/SourceMeter.js, tests/js/components/faceplate-page/sourcepaint-motion.test.js, tests/js/components/faceplate-page/sourcepaint-section.test.js, tests/js/components/faceplate-page/spectrumfx-fx.test.js, tests/js/components/faceplate-page/aurora-glsl.test.js, tests/js/support/rendered/sourcesection.js
- **Reads:** hqptuner/static/components/faceplate/page/sourcepaint.js#lookNow, hqptuner/static/components/faceplate/page/spectrumfx.js#timed, hqptuner/static/components/faceplate/page/aurora.js, hqptuner/static/components/faceplate/page/SourceMeter.js
- **Decisions:** D-01
- **Pins:** tests/js/components/faceplate-page/sourcepaint-motion.test.js, tests/js/components/faceplate-page/sourcepaint-section.test.js, tests/js/components/faceplate-page/spectrumfx-fx.test.js, tests/js/components/faceplate-page/aurora-glsl.test.js, tests/js/components/faceplate-page/meter-painters.test.js
- **Action:** `sourcePainter`, `fxPainter` and the aurora painter take the paint's `dt` in ms and hand it to the model steps as they get it; the per-call conversions Tasks 1 and 2 added go. The aurora's sway sums ms and converts once to the vendor shader's seconds at its `time` uniform, through the time base. `SourceMeter.js`, still handed seconds by the loop, converts once through the time base where it calls `painter.paint`; Task 4 removes that. Every `dt` doc comment says wall time, ms. The two thrown messages that say "seconds" (`timed` in `spectrumfx.js`, the `dt` check in `aurora.js`) stay character for character in this task; Task 5 owns their wording. Tests first: the painter suites hand `dt` in ms, red against the current painters.
- **Verify:** Testing scope: the outcome is the same painted motion on ms; already covered by the painter suites, whose `dt` inputs move to ms; no new case; testing stops there. (1) Red run: the updated painter suites fail by `AssertionError` against the painters as at HEAD. (2) After the change every file in Pins passes. (3) `grep -rn "MS_PER_S" hqptuner/static/components` prints nothing. (4) `git diff` over `spectrumfx.js` and `aurora.js` shows neither thrown message's text changed. (5) `bash .claude/task-check.sh` passes; the owner watches the Source page's meters, spectrum styles and aurora at the hand-back URL and sees them move as before.

### Task 4: The meter loop hands painters `dt` in ms

- **Files:** hqptuner/static/store/meter/loop.js, hqptuner/static/components/faceplate/page/SourceMeter.js, tests/js/store/meter/loop-boot.test.js, tests/js/store/meter/loop-painters.test.js, tests/js/store/meter/loop.test.js, tests/js/store/meter/spectrum-motion.test.js
- **Reads:** hqptuner/static/store/meter/loop.js#paint, hqptuner/static/store/meter/loop.js#hand, hqptuner/static/store/meter/loop.js
- **Decisions:** D-01, D-07
- **Pins:** tests/js/store/meter/loop-boot.test.js, tests/js/store/meter/loop-painters.test.js, tests/js/store/meter/loop.test.js, tests/js/store/meter/spectrum-motion.test.js
- **Action:** `paint` hands each painter `painted.dt`, the wall time since the last paint in ms, as it measured it, and the loop's `MS_PER_S` goes. `MeterPainter`'s doc and the file's header comment say ms. `SourceMeter.js` passes the loop's `dt` straight to its painter. The `same()` rounding goes from `loop-boot.test.js`, `loop-painters.test.js` and `loop.test.js` (D-07): wall times on the fake clock are now handed through unchanged, and the playback values Plans 1 and 2 made exact compare with exact equality on values the test writer picks to be exact. The suites' `dt * SECOND_MS` products go with the move, since the `dt` a painter is handed is already ms, and `loop-boot.test.js` keeps no `SECOND_MS`; the other seconds-to-ms and samples-to-ms conversions these suites make are Plan 15 Task 4's. Tests first: the loop suites state the handed `dt` in ms, red against the current `loop.js`.
- **Verify:** Testing scope: the outcome is `dt` handed in ms, 0 on the first paint and on the clearing call; already covered by the loop suites; no new case; testing stops there. (1) Red run: the updated loop suites fail by `AssertionError` against `loop.js` as at HEAD. (2) After the change every file in Pins passes. (3) `grep -n "MS_PER_S" hqptuner/static/store/meter/loop.js` prints nothing; `grep -rn "const same = " tests/js` prints nothing; `grep -rnE "dt \* SECOND_MS" tests/js/store/meter` and `grep -n "SECOND_MS" tests/js/store/meter/loop-boot.test.js` print nothing; `grep -rn "MS_PER_S" hqptuner/static/components hqptuner/static/model/gauges/meter` prints nothing. (4) `scripts/gate.sh npx tsc -p jsconfig.json` and `scripts/gate.sh npx tsc -p tsconfig.node.json` pass. (5) `bash .claude/task-check.sh` passes and the owner sees the meters move as before at the hand-back URL.

### Task 5: The two `dt` error messages say ms, in the owner's wording

- **Files:** hqptuner/static/components/faceplate/page/spectrumfx.js, hqptuner/static/components/faceplate/page/aurora.js
- **Reads:** hqptuner/static/components/faceplate/page/spectrumfx.js#timed, hqptuner/static/components/faceplate/page/aurora.js
- **Decisions:** D-01
- **Pins:** tests/js/components/faceplate-page/spectrumfx-fx.test.js, tests/js/components/faceplate-page/aurora-glsl.test.js
- **Action:** The two thrown messages that say "seconds" (`timed` in `spectrumfx.js`, the `dt` check in `aurora.js`) are false once `dt` is ms, and they are user-facing text under `CLAUDE.md`: propose corrected wording to the owner and land only the wording the owner approves, character for character, no em dash; until then this task is not done. It is the plan's last task so that Tasks 3 and 4 land and are verified without waiting on the approval. Nothing but the two strings changes.
- **Verify:** Testing scope: error copy only, no behavior changes; no new test; testing stops there. (1) human-verify: the owner has approved the two messages' wording, and the landed strings match it exactly. (2) Every file in Pins passes. (3) `scripts/gate.sh make lint-js` passes.
