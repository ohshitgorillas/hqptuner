---
phase: 7
plan: 3
requirements: []
depends_on: [1, 2]
files:
  - hqptuner/static/model/gauges/playhead.js
  - hqptuner/static/store/meter/loop.js
  - tests/js/model/gauges/playhead-start.test.js
  - tests/js/model/gauges/playhead.test.js
  - tests/js/store/meter/loop.test.js
---

# Phase 7: Visuals stay in sync after a track starts - Plan 3: The one playhead holds its lag through a start

## Goal

After a track starts, the visuals keep the same lag behind the sound that they hold for the rest of the track, whatever the track's sample rate.

## Must be true when done

- Replaying a captured track start, the playhead's lag behind the sound after the opening stretch is within one metering frame of its lag later in the same track (AC3).
- Replays of captured starts at two sample rates give lags within one metering frame of each other (AC4).
- Replays where the reader connects at different points in the opening stretch give lags within one metering frame of each other (AC5).
- At the hand-back URL, with tracks at two sample rates, the meters, spectrum and spectrogram hold the same lag behind the sound right after a track starts as later in the track (AC6, owner's eyes and ears).
- `scripts/gate.sh make check` prints `exit=0` (AC7).

## Context

- Two rules bind every task. `docs/spec/timing.md` holds the owner's ruling as Plan 2 wrote it, and that ruling is the spec. D-02 requires one shared playhead, with no per-rate delay offset and no per-view correction for the meters, spectrum, spectrogram or apodizing strip.
- Timing rules 5, 6 and 10: the decision lives in the pure `pacePaint` in `hqptuner/static/model/gauges/playhead.js`, which reads no clock and takes `dt` from its caller. The loop in `hqptuner/static/store/meter/loop.js` applies the decision, and nothing else decides time. Every view already reads the one `playhead` signal (`store/meter/playhead.js`, `store/meter/spectrogram.js` `drawnRange`, `stripEnd`). So a fix there reaches every view, and no view file is touched.
- D-06: a fix that moves the anchor or adds a correction rewrites the tests pinning today's anchor. These are in `tests/js/model/gauges/playhead.test.js` (the seek-restart playhead test and the movement breaches) and the after-a-burst wall-time test in `tests/js/store/meter/loop.test.js`. Each rewrite goes to the ruled behavior and is seen red against the old code. A test is never edited to pass.
- D-07: nothing closes lag today. The v2.0.0 UAT line "playhead closes lag after a long burst gap" tested the target-tracking design that `c89ed07a` deleted with `CATCH_UP_MS`. It is no evidence for or against this fix, and that design is not revived unless the ruling says so.
- Fixture: `tests/support/fixtures/meter_start_capture.json` (Plan 1). The replays read it the way `capture()` in `tests/js/model/gauges/playhead.test.js` reads `meter_feed_capture.json`: each event's `at`/`n` converted at its geometry's rate, and arrivals at their recorded wall times.

## Tasks

### Task 1: The playhead's lag after a start equals its lag later in the track

- **Files:** tests/js/model/gauges/playhead-start.test.js, hqptuner/static/model/gauges/playhead.js, hqptuner/static/store/meter/loop.js, tests/js/model/gauges/playhead.test.js, tests/js/store/meter/loop.test.js
- **Reads:** docs/spec/timing.md#The two clocks, hqptuner/static/model/gauges/playhead.js#pacePaint, hqptuner/static/model/gauges/playhead.js#restartAt, hqptuner/static/store/meter/loop.js#paint, tests/js/model/gauges/playhead.test.js#capture, .planning/phases/7/CAPTURE.md
- **Decisions:** D-01, D-02, D-04, D-06, D-07
- **Pins:** tests/js/model/gauges/playhead.test.js, tests/js/store/meter/loop.test.js, tests/js/store/meter/loop-painters.test.js, tests/js/store/meter/spectrum-motion.test.js, tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py
- **Action:**
  - **The behavior the owner wants.** On every captured track start, the playhead's lag behind the sound right after the opening stretch matches its lag later in the same track. Lag is measured against what `timing.md` now names.
  - **Tests first, then bite.** Read `docs/spec/testing.md` first. Write the replay tests first in a new model-lane suite beside `playhead.test.js`. A new file is used because `playhead.test.js` already carries the generated-feed suite at length. The suite replays each captured start in the held run through `pacePaint`, at the page's effective delay (the captured `output_delay` plus the captured `owner_spectrum_offset_s`, never below zero, as `effectiveDelay` in `hqptuner/static/store/meter/delay.js` computes it) and at paint schedules the suite chooses. Run the new tests against HEAD, before any code change, and record them red as the bite proof (rule 8). The unit, lane, assertion and values are the test writer's within `docs/spec/testing.md` and timing rule 11. The expectation must come from the capture and the ruling's definition of lag, never from `pacePaint`'s own arithmetic (testing rule 10).
  - **The change.** Change `pacePaint`, and the loop's call to it only if the ruling needs an input the loop holds, so the replays pass. Keep the change exactly to what the ruling states, no more and no less: no margin, buffer, window or tuning constant the ruling does not name. `pacePaint` stays pure and `dt` stays its only time input.
  - **Comments.** Update the header comments of `playhead.js` and `loop.js`, and the doc comments the change makes false, to state the ruled rule. They are the design record.
  - **Pinned tests (D-06).** Rewrite the existing tests that pinned the old anchor so they state the ruled behavior, each rewrite seen red against the old code. Change no other assertion. A rewritten or new test that is red after the change has two outcomes: fix the code, or take the plan back to the owner.
  - **Scope.** If the ruling needs a file this task does not lease, stop and return the plan for revision rather than write it. If Plan 2's ruling made no anchor change because the capture refuted the rush, this task's code change is empty. Then the new suite asserts the captured starts already hold the lag, and the bite proof is recorded as not applicable, with the ruling cited.
  - **filepawl.** Run `filepawl accept` whenever filepawl prints it.
- **Verify:** `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead-start.test.js` prints `exit=0`. The executor's record shows the same file red against the pre-change `playhead.js` and `loop.js`, together with each D-06 rewrite red against them. `scripts/gate.sh make check` prints `exit=0`.

  Testing scope:
  - **Outcome:** lag after the opening stretch is within one metering frame of the later lag, for every captured start kind (from stopped, same-rate change, rate change).
  - **Already covered:** contiguity, wall-speed motion, the newest-end cap and delay jumps, by `playhead.test.js`. Those stay unless the ruling changes them.
  - **New checks:** one per captured start kind.
  - **Stops when:** those pass and the gate is green.

### Task 2: The lag after a start is the same at both captured sample rates

- **Files:** tests/js/model/gauges/playhead-start.test.js, hqptuner/static/model/gauges/playhead.js
- **Reads:** tests/support/fixtures/meter_start_capture.json, docs/spec/timing.md#The two clocks
- **Decisions:** D-02
- **Pins:** tests/js/model/gauges/playhead-start.test.js
- **Action:**
  - **The behavior the owner wants.** Replays of captured starts at the two captured sample rates give lags within one metering frame of each other (AC4). The lag comes from the one shared playhead. No per-rate delay offset and no per-view correction is allowed (D-02).
  - **Tests and bite.** Add the cross-rate replay tests to the start suite. Their bite proof is a red run against `playhead.js` and `loop.js` as they stood at the commit Plan 3 Task 1 started from, the pre-change code for this behavior, with the new tests kept.
  - **If red.** A test red against the current code means the Task 1 change left a per-rate residue, which is the flagged `output_delay` assumption. Fix it in `pacePaint` within the ruling, or take the plan back to the owner with the measured residue. Never fix it with a per-rate offset.
  - **If green at the pre-Task-1 code.** The tests then constrain nothing new (rule 8). Do not edit them until they turn red. Record the bite proof as not applicable, with the green run and the ruling or capture figure that explains it, and keep the tests as the regression check for AC4.
- **Verify:** `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead-start.test.js` prints `exit=0`. The executor's record shows the cross-rate tests red at the pre-Task-1 code, or the not-applicable record the task describes. `scripts/gate.sh make check` prints `exit=0`.

  Testing scope:
  - **Outcome:** equal lag across the two captured rates.
  - **Already covered:** each rate's own start-versus-later lag, by Task 1.
  - **New checks:** the smallest cross-rate comparison over the captured starts.
  - **Stops when:** it passes.

### Task 3: The lag after a start does not depend on where the reader connected

- **Files:** tests/js/model/gauges/playhead-start.test.js, hqptuner/static/model/gauges/playhead.js, hqptuner/static/store/meter/loop.js
- **Reads:** tests/support/fixtures/meter_start_capture.json, .planning/phases/7/CAPTURE.md, docs/spec/timing.md#The two clocks, hqptuner/static/store/meter/loop.js#initMeterLoop
- **Decisions:** D-02, D-04
- **Pins:** tests/js/model/gauges/playhead-start.test.js, tests/js/store/meter/loop.test.js
- **Action:**
  - **The behavior the owner wants.** Replays where the reader connects at different points in the opening stretch give lags within one metering frame of each other (AC5). The same holds when the browser loop starts at different points. D-02 makes this the second candidate cause, fixed through the same one playhead.
  - **Tests and bite.** Add replay tests over the captured late-connect runs, and over the held run with the loop starting at different wall points, to the start suite. Their bite proof is a red run against the pre-Task-1 code, as in Task 2.
  - **If red.** Where a test is red against the current code, change `pacePaint`, and the loop only where the ruling needs an input it holds, within the ruling. Otherwise take the plan back to the owner. No per-view correction.
  - **If green at the pre-Task-1 code.** Handle it as Task 2 does: do not edit the tests until they turn red, record the bite proof as not applicable with the green run and its explanation, and keep the tests as the regression check for AC5.
  - **Hand-back.** After the suite and gate are green, run `/task-check` (`bash .claude/task-check.sh`), which runs `make check`, rebuilds `hqptuner:dev` and health-checks `:8090`. Load the `hand-back` and host skills, and put the hand-back URL in front of the owner for AC6.
- **Verify:** `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead-start.test.js` prints `exit=0`. The executor's record shows the connect-point tests red at the pre-Task-1 code, or the not-applicable record the task describes. `bash .claude/task-check.sh` ends with the hand-back URL and a 200 from `:8090`. human-verify (AC6): at the hand-back URL, with the owner playing tracks at two sample rates, the owner sees and hears the meters, spectrum and spectrogram hold the same lag behind the sound right after a track starts as later in the track.

  Testing scope:
  - **Outcome:** equal lag across connect points and loop-start points.
  - **New checks:** one comparison over the late-connect runs and one over loop-start points in the held run.
  - **Stops when:** those pass, with the owner's ears as the final check.

## Notes

- The pin rewrites (D-06) land in Task 1, not in a separate last plan, because they must land with the fix. The fix turns them red, and a red commit is outside the owner's override, which covers only the v2 restructure work.
- Task 1 stays one task. A tests-only task would commit red tests, and a red commit is outside the owner's override, which covers only the v2 restructure. The bite proof is the recorded red run inside the task, before the change.
- This plan names behaviors. The mechanism is the ruling's, in `docs/spec/timing.md` after Plan 2. If the ruling needs a lease beyond the five files above, `lease-check` stops the task, and the plan goes back for revision. Examples would be `store/meter/feed.js`, `store/signals.js` or `hqptuner/engine/meterfeed.py`.
- Recalled prior art: `.planning/_archive-v2.0.0/5/CONTEXT.md` D-01 (v2.0.0 phase 5) is the wall-speed law this phase's ruling amends. `.planning/_archive-v2.0.0/5/UAT.md` (phase 5) holds the stale "closes lag" line that D-07 retires as evidence.
