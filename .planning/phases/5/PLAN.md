---
phase: 5
plan: 1
requirements: [METER-01]
files:
  - docs/spec/timing.md
  - hqptuner/static/model/gauges/playhead.js
  - hqptuner/static/store/meter/loop.js
  - tests/js/model/gauges/playhead.test.js
  - tests/js/store/meter/loop.test.js
  - tests/js/store/meter/loop-painters.test.js
  - .filepawl.toml
---

# Phase 5: Meter playhead on the loop's dt - Plan 1: Playhead advances on dt

## Goal

The meters, the spectrum and the spectrogram move smoothly in step with the music while frames reach the metering reader in bursts, with the stamps still the only authority for where the music is (owner approval, 2026-11-07).

## Must be true when done

- While frames arrive in bursts, the playhead moves the same distance over the same stretch of wall time whatever the paint rate, and never stands still for a paint while a frame it has not shown is queued and behind the newest queued frame's end less the delay.
- The playhead never moves past the newest queued frame's end less the delay, and never moves backward except at a break.
- At a break the playhead restarts at the break frame and every view of playback starts again, as today.
- Each paint still starts where the last one ended: no gap and no overlap.
- `pacePaint` reads no clock; the meter loop's `Clock` is the only source of `dt`.
- `docs/spec/timing.md` states the rule the code follows, and `scripts/gate.sh make check` prints `exit=0`.
- On the hand-back URL with music playing, the owner sees the meters, the spectrum and the spectrogram move without the freeze-and-jump.

## Context

- No `phases/5/CONTEXT.md` exists. The binding decisions are the ROADMAP Phase 5 entry: its Approach (owner-approved) and its six Success Criteria, and the PROJECT.md Key Decisions row of 2026-11-07. No CHANGELOG entry is written: the v2 changelog is the owner's alone.
- `pacePaint` (`hqptuner/static/model/gauges/playhead.js`) has exactly one production caller, `paint()` in `hqptuner/static/store/meter/loop.js`, which already computes `painted.dt` (wall ms since the last paint, 0 on the first paint since the loop started) from the `now` its `Clock`'s `requestAnimationFrame` hands it. Caller-side delta: one call site in one file.
- Today `PaintDecision.playhead` is the newest queued frame's end less the delay, so it moves only at a paint after an arrival; `to` is `max(from, playhead)`. The spectrogram's edge and the apodizing strip read the `playhead` signal the loop writes, so moving that signal on `dt` is what makes all three views smooth; no reader of the signal changes.
- `effectiveDelay` (`store/meter/delay.js`) changes whenever the user types an offset or the engine's reported `output_delay` changes, so the newest end less the delay can fall behind where the playhead already stands without any break.
- Built by the `pacer` agent, tests first (`docs/spec/testing.md` rule 8). Read `docs/spec/testing.md` and `docs/spec/timing.md` before writing a test. Every file this plan touches is edited in place under the normal rules: no file here is rebuilt from spec or restored from history, so no history read is needed or allowed beyond `git diff`/`git show HEAD` of the plan's own edits.
- Out of scope: the daemon and the network are neither probed nor blamed (owner's standing ruling); no catch-up or skip rule beyond the approved one; the "Feed arrival" row and every timing.md rule other than the three named sites stay as they are.

## Tasks

### Task 1: Reword the timing spec to allow the playhead to move on dt between stamps

- **Files:** docs/spec/timing.md (sections "The two clocks", "Rules" item 1, "Measured facts" row "Feed event length")
- **Action:** Make the spec state the rule Task 2 builds, at exactly the three sites the Approach names, and nowhere else. The two-clocks line ("Playback time never measures waiting. Wall time never says where the music is.") must keep both prohibitions and allow one thing: between two stamps the meter loop already holds, the playhead moves on the loop's `dt`, never past the newest queued frame's end less the delay, and it restarts at a break. Rule 1 must keep "positions come from stamps" as the rule and state the same single allowance: the playhead's advance by `dt` is bounded by a stamp, so the stamps stay the only authority for where the music is, while a running total of event `ms` stays a defect. The "Feed event length" row loses its "always shorter than a paint" claim; its value range and its "Measured by" cell stay. Write with `Edit`, soft-wrapped (one paragraph or list item per logical line), no em dashes, no project trivia or decision archaeology (the triviajudge refuses both; the owner approval date belongs in the commit message, not the doc). Do not touch rules 2 to 12, the pipeline table, the "Feed arrival" row or the examples: the Approach licenses three edits, and widening it is scope invention.
- **Verify:** `python3 .claude/hooks/md-softwrap.py --check docs/spec/timing.md` exits 0; `grep -n "always shorter than a paint" docs/spec/timing.md` prints nothing; `git diff --stat` shows only `docs/spec/timing.md`, and `git diff docs/spec/timing.md` changes only the two-clocks section, rule 1 and the "Feed event length" row; `scripts/gate.sh make trivia` prints `exit=0`. A reader of the reworded rule 1 can tell that the playhead advancing by `dt` up to the newest end less the delay is allowed and that summing event lengths into a position is not.

### Task 2: The playhead advances on the loop's dt between frames

- **Files:** hqptuner/static/model/gauges/playhead.js (`pacePaint`, `PaintInput`, `PaintDecision`, header comment), hqptuner/static/store/meter/loop.js (`paint`, `apply`, header comment), tests/js/model/gauges/playhead.test.js (`play` harness, header comment), tests/js/store/meter/loop.test.js, tests/js/store/meter/loop-painters.test.js (`test_a_scene_folds_the_frames_a_paint_shows_alike_whatever_order_they_arrived_in`, `test_a_paint_that_shows_no_frame_hands_the_scene_as_it_stood`), .filepawl.toml (only if `filepawl accept` is printed)
- **Action:** Tests first, then code, one green commit. The behavior the owner wants, in the owner's terms:
  - `pacePaint` stays pure and takes the paint's `dt`, wall time since the last paint, as a required input with no default (timing rule 7). Its doc comment names its clock and unit (wall time, ms, as `painted.dt` is). One wall ms advances the playhead one playback ms.
  - Between frames the playhead advances by `dt` from where the last paint left it, never past the newest queued frame's end less the delay. It never stands still at a paint with `dt` above 0 while it is behind that bound and a frame it has not shown is queued.
  - The playhead never moves backward except at a break. When the delay grows mid-feed and the bound falls behind where the playhead stands, the playhead holds where it is, neither back nor forward, until the bound passes it (planner's reading of criteria 2 together; see Notes).
  - A restart (a break no paint has started in, or the first paint since the queue began) paints as today: the span starts at the restarting frame's `at`, `restart` is set, every frame before it is consumed, and the playhead stands at the newest queued frame's end less the delay. The advance on `dt` applies from the paint after it.
  - The span stays contiguous: each paint's `from` is the last paint's `to` unless it restarts, `to` is the playhead or `from` when the playhead has not passed it, and a frame leaves the queue once a paint has shown all of it, as `walk` decides today.
  - With nothing queued the playhead stands where it stood.
  - The decision cannot advance from `end` alone. After a restart under a delay deeper than the queue holds, the last playhead stands behind `end`. Advancing from `end` would carry the playhead forward past the bound at the next paint. So the decision advances from the last paint's playhead, which the loop hands back the way it hands back `to` as `end`. The pacer names that input.
  - `paint()` in `loop.js` hands `pacePaint` its `painted.dt`. That is the only `dt` source, and no other code reads time for the decision. The loop keeps handing painters `painted.dt / MS_PER_S` as now. Work per paint stays bounded and allocation-free (timing rule 9): one walk of the queue, no loop over elapsed time.
  - Rewrite the header comments of `playhead.js` and `loop.js` and the two test files' headers where they state the retired rule. The retired rule is "moves only when a frame arrives", "stands still between arrivals", "no wall time enters the decision" and "Pure and clockless: no wall time". The new comments state the new rule; keep every other comment as it stands.
  - Existing tests that state the retired rule are behavior the owner changed. They are restated tests-first, before the code changes, never edited after implementation to pass:
    - In `playhead.test.js`, `test_the_playhead_at_a_*_ms_delay_moves_at_each_paint_after_an_arrival_and_at_no_other` asserts the retired rule and goes.
    - In `loop.test.js`, the two `test_at_every_paint_the_playhead_stands_at_the_feed_edge_less_a_*_s_delay` cases assert the retired rule and are replaced by the new rule at the store lane.
    - In `loop.test.js`, `test_closing_the_feed_leaves_the_playhead_null`, `test_a_feed_opened_after_one_closed_moves_the_playhead_again` and `test_when_the_engine_stops_playing_the_playhead_goes_null` keep their claims. Their pin of the playhead to `feedEdge()` less the delay is setup that encoded the retired rule and is repaired.
    - In `loop-painters.test.js`, the two named cases keep their claims. Their setups assume one paint shows a whole arrival at once, and are repaired. This is a valid claim with broken setup, kept and repaired, as Plan 6 task 1 did in phase 2 (`phases/2/SUMMARY.md`).
    - Every other case in `playhead.test.js` keeps its claim; its `play` harness gains a `dt` per paint.
  - A throwaway prototype of this rule in a /tmp copy failed exactly these cases. It passed `slicerange`, every other `tests/js/store/meter/*` suite, `meter-painters` and `drawers-source-paint` unchanged (see Notes). A case outside this list that turns red is a finding to report, not a test to edit.
  - Make the gates pass by making the code right: no exemption, no raised threshold. Run `filepawl accept` without asking if filepawl prints it.
- **Verify:**
  - `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead.test.js tests/js/store/meter/loop.test.js tests/js/store/meter/loop-painters.test.js` prints `exit=0`.
  - The same run with `hqptuner/static/model/gauges/playhead.js` and `hqptuner/static/store/meter/loop.js` reverted to HEAD (tests kept) is red on every new or restated case, recorded in the task report (rule 8).
  - `grep -nE "performance|Date\.|\.now\(|requestAnimationFrame|setTimeout" hqptuner/static/model/gauges/playhead.js` prints nothing.
  - `grep -rn "pacePaint(" hqptuner/static` shows one call, in `loop.js` `paint()`, passing `painted.dt`.
  - `scripts/gate.sh npm test` prints `exit=0`.
  - Testing scope:
    - Outcomes to establish at the model lane, on a schedule of bursts and quiet paints the test writes: equal playhead motion over equal wall time at two paint rates, wherever the bound does not hold the playhead back; no paint with `dt` above 0 stands still while the playhead is behind the bound; the playhead never passes the bound and never moves backward outside a break, a mid-feed delay increase included; the restart paint as today.
    - Outcomes to establish at the store lane, through the fake `Clock`: the `playhead` signal moves at a paint with no arrival while it is behind `feedEdge()` less the delay, and never passes it.
    - Already covered and kept: contiguity, each passed frame shown once for its own length, the queue holding exactly the frames ending past the playhead, the playhead the delay behind the newest end once it has caught up, restart exactly at a break, history order, idle and null-on-stop.
    - Testing stops there. There are no further paint-rate or delay permutations, and no per-paint cost test, which is not observable through the public surface, as both store suites already note.
    - Effort: a `dt` column in the existing harnesses and a second paint schedule, no new support module.

### Task 3: The offline gate is green

- **Files:** none (verification only)
- **Action:** Run the whole offline gate on the tree after Tasks 1 and 2, through `scripts/gate.sh`, never piped. A failure is fixed in the code that caused it, within Task 2's files and under Task 2's rules. A failure outside those files, or one only an exemption or threshold change would clear, stops the plan as a blocking question quoting the failing line. Coverage below the JS floor (lines 95, branches 90, functions 85) or a file under the Python 90% floor is measured and closed with meaningful cases, never by lowering a threshold.
- **Verify:** `scripts/gate.sh make check` prints `exit=0`; the task report quotes that line and the log path.

### Task 4: The browser meter tests pass on the new pacing

- **Files:** none (verification only)
- **Action:** Run the e2e tests that drive the meters and the spectrogram in a real browser against the fake engine stack. These are `tests/e2e/test_playing_readings_keep_flowing.py` (whose meter case waits for the level bar to follow each passage) and `tests/e2e/test_spectrogram_header_no_scroll_bar_at_quarter_span.py`. They are the browser-lane consumers of the playhead and belong to the required `e2e` job, which gets no CI run on `v2` without a pull request. Disclose before running: the run starts headless chromium and the app, which can hold a full core for over 10 s. Record every PID started, and confirm by `ps -p` afterwards that none is left. A red case is a finding about Task 2's code, fixed there, never by editing the e2e test.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m e2e --no-cov -q tests/e2e/test_playing_readings_keep_flowing.py tests/e2e/test_spectrogram_header_no_scroll_bar_at_quarter_span.py` prints `exit=0`; `ps -p <each recorded PID>` shows none left running.

### Task 5: The owner sees the meters move smoothly at the hand-back URL

- **Files:** none (verification only)
- **Action:** Load the `opal-hqptuner` host skill and the `hand-back` skill, then run `bash .claude/task-check.sh`. It runs `make check`, rebuilds `hqptuner:dev` from the working tree and health-checks `:8090`. Disclose the container rebuild before it runs, since it can hold cores for over 10 s. Hand the owner the host skill's hand-back URL. Write nothing against hqplayerd: this task only serves the page.
- **Verify:** `bash .claude/task-check.sh` exits 0 and `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8090/` prints `200`. human-verify (browser at the hand-back URL, music playing in hqplayerd): the owner sees the level meters, the spectrum and the spectrogram's edge move continuously in step with the music, with no freeze followed by a jump at each burst. A seek still restarts every view at once.

## Notes

- Interpretation, criterion 2: "never past the bound" and "never backward except at a break" meet when the delay grows mid-feed, because the user raises the offset or the engine's `output_delay` rises. Today the playhead jumps back on such a growth. This plan holds it still until the bound passes it. If the owner wants the jump back, Task 2's third bullet flips, and nothing else changes.
- Interpretation, criterion 3: the restart paint keeps today's playhead, the newest queued end less the delay, with its span from the break frame's `at`. The other reading puts the playhead at the break frame's start, which would add a lag of up to one burst whenever the delay is shorter than a burst. That lag would last until the next break.
- Consequence of the approved rule, not planned for change: the rule has no catch-up. Any lag the playhead gains on the bound is kept until the next break. That lag comes from a pin at the bound during a burst gap longer than the queued slack, or from a lowered delay. So in steady state the meters run behind the configured delay by up to the worst burst gap the feed has shown, and a lowered offset takes effect only at the next break. Changing that needs an owner decision on a catch-up rule, which timing rule 5 would place inside `pacePaint`.
- Prototype evidence: the planner patched a copy of `hqptuner/static` and `tests/js` in `/tmp/ph5proto-2047286`. In that copy, the playhead advanced by `painted.dt` up to the bound and held on a bound behind it. The run failed 16 of 31 `playhead.test.js` cases, its harness handing no `dt`. It failed 5 `loop.test.js` cases and the 2 named `loop-painters.test.js` cases. It passed `slicerange`, `apodlamp`, `apodstamp`, `apodstrip`, `delay`, `feed`, `loop-boot`, `spectrogram`, `spectrogram-bands`, `spectrum-delay`, `meter-painters` and `drawers-source-paint`. The copy is left in place, about 8 MB, because the host blocks `rm -rf` for agents.
- `.filepawl.toml` is leased only for a `filepawl accept` that filepawl prints; `loop-painters.test.js` is at 468 lines against a tests cap of 800.
- The required `e2e` job is not run in CI for `v2` without a pull request; Task 4 runs the meter-facing e2e files locally, not the whole 589 s suite.
