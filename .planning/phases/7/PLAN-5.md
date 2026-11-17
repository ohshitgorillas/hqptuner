---
phase: 7
plan: 5
depends_on: [1, 2, 3, 4]
requirements: []
files:
  - hqptuner/static/store/meter/feed.js
  - hqptuner/static/model/gauges/meter/meter.js
  - tests/js/store/meter/feed.test.js
  - hqptuner/static/model/gauges/playhead.js
  - tests/js/model/gauges/playhead-line.test.js
  - hqptuner/static/store/meter/loop.js
  - tests/js/model/gauges/playhead.test.js
  - tests/js/store/meter/loop.test.js
  - tests/js/store/meter/loop-painters.test.js
  - tests/js/store/meter/spectrum-motion.test.js
  - tests/js/contracts/trace-and-meters.test.js
  - tests/js/contracts/trace-probes.js
  - tests/js/contracts/spectrogram-columns.test.js
  - tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py
---

# Phase 7: Visuals stay in sync after a track starts - Plan 5: The one playhead follows the stamps' line

## Goal

After a track starts, the visuals keep the same lag behind the sound that they hold for the rest of the track, whatever the track's sample rate. This plan is the fix: the one playhead follows the rule the owner approved, as `docs/spec/timing.md` ("The two clocks", Rules 1 and 5, the Feed store row) and `.planning/phases/7/DESIGN.md` (sections 2, 4 and 5) state it. The smoothness suites of Plans 2 to 4 pass unedited (AC9), and the gate is green (AC7).

## Must be true when done

- With music playing at the hand-back URL, after a start from stopped, a same-rate track change and a rate change, at two sample rates, the owner sees the meters, the spectrum and the spectrogram hold the same lag behind the sound right after the start as later in the track (AC6).
- The three smoothness suites (`steady-lag`, `steady-motion`, `steady-spectrogram`) pass, the 156 lag cases red in Plan 4's report among them and the 15 paired 44100 against 192000 cases still green, and none of the eight test-side files they run on (named in Task 4's Verify) changed since HEAD `2b6797e1` (AC3, AC4, AC5, AC9). The production files they run on are the ones this plan changes.
- Every metering frame the page queues carries the wall time the page received it, and the playhead reads each arrival's lead at that time, not at the paint that first sees it (D-13).
- The playhead keeps every promise of the approved text: it moves at wall speed and follows the line by a bounded share of it, up or down; it takes each rise of the line at once only through the opening span after a break; it jumps by a changed delay; it never passes the newest queued frame's end and never moves backward outside a break or a raised delay; at a break it restarts one delay behind the newest frame's end, carried on at wall speed from the time that frame arrived.
- Every existing test rewritten here states a sentence of the approved text in place of the old rule's, and was red against the pre-change code by assertion; no other test changed except to hand the decision the new inputs truthfully.
- `scripts/gate.sh make check` prints `exit=0`, and the e2e suite passes (AC7).

## Context

- The rule is the approved text in `docs/spec/timing.md` and the design record's sections 2 (the decision paint by paint, the constants), 4 (the split, the null stubs, the caller-side delta) and 5 (what changes where). Nothing beyond it is built: one playhead, no per-rate offset, no per-view correction (D-02), and no rush-only patch (D-08).
- D-06: a fix that moves the anchor or adds a correction rewrites the pins that hold today's rule, each rewrite red against the old code. D-09 (b): the red suites of Plans 2 to 4 are authorized red only until this plan's fix makes them pass. Every commit here is green on every other test and gate, `make test-e2e` included.
- Binding spec rules: 1 (positions from stamps; the playhead is the one allowance), 2 (constants are display targets, each defined once in model code), 3 (a break restarts and nothing is followed across one), 4 (one playhead), 5 (one pacing decision a paint, contiguous), 6 and 10 (decisions pure under `static/model/`, no clock in model code), 8 (every time read through a `Clock`), 9 (a late paint costs no more than an on-time one). Tests follow `docs/spec/testing.md`, rules 8, 10 and 17 above all.
- Out of scope: `CHANGELOG.md` (the owner's alone) and any user-facing text; the design names none and this plan writes none. Comments in code and test headers are not user-facing text. `hqptuner/static/store/meter/delay.js` and `hqptuner/static/store/meter/spectrogram.js` stay unchanged (design section 5).

## Tasks

### Task 1: The feed store stamps each frame with the wall time it arrived

- **Files:** hqptuner/static/store/meter/feed.js, hqptuner/static/model/gauges/meter/meter.js, tests/js/store/meter/feed.test.js
- **Reads:** hqptuner/static/store/meter/feed.js#openMeterFeed, hqptuner/static/store/meter/feed.js#decode, hqptuner/static/model/gauges/meter/meter.js#MeterFrame, hqptuner/static/lib/clock.js#Clock, docs/spec/timing.md#The two clocks, .planning/phases/7/DESIGN.md#The caller-side delta
- **Decisions:** D-13
- **Pins:** tests/js/store/meter/feed.test.js
- **Action:**
  - **The behavior.** A frame the page queues carries the wall time at which the page received its `frame` event, read from the `Clock` the feed was opened with, on the timeline `requestAnimationFrame` stamps its frames with. The approved Feed store row names this as the store's job, and the playhead of Task 4 reads it.
  - **Tests first.** Write the case in `feed.test.js`. The unit, the assertion and the values are the test writer's; receiving frames at two different nonzero clock times keeps the zero value and a constant from passing (rule 10). Run it against the pre-change `feed.js`, tests kept: it fails by `AssertionError`, since today's frame has no arrival time. A case green there is reported, never reshaped. The suite header says no case advances the clock; correct that sentence if the new case does.
  - **Then the code.** `openMeterFeed` keeps the `Clock` it is handed beyond the quiet window, and one site stamps each decoded frame with `arrivedAt`, wall ms, read once per event while the handler runs (design section 4: the `frame` handler's call into `decode`). The `MeterFrame` typedef in `meter.js` gains `arrivedAt` as an optional field, as `at` and `break` are, its doc comment naming its clock and unit. The folded frames `hqptuner/static/model/gauges/meter/steps.js` builds are not arrivals and get no stamp. The header comment's paragraph on what a queued frame carries gains its arrival time.
  - **Constraints.** No `performance.now` or `Date.now` outside `lib/clock.js` (Rule 8, gated). Nothing reads `arrivedAt` yet, so no other behavior moves. Caller-side delta: `openMeterFeed` and the `frame` handler in one file, and one typedef; no call site of `initMeterFeed` or `openMeterFeed` changes.
- **Verify:**
  - **Red run.** The executor's record shows the new case failing by `AssertionError` against the pre-change `feed.js` with the test kept. An import or type error is no red run.
  - **Green.** `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/feed.test.js` prints `exit=0`.
  - **Nothing else moved.** `scripts/gate.sh make check` stops only at `test-js`, and its failing tests are exactly the 156 `test_the_lag_` cases of `tests/js/contracts/steady-lag.test.js` that Plan 4's report names.
  - **Testing scope.** Outcome: each queued frame carries its own arrival time. Already covered: the stamps, breaks and geometry of a queued frame. Smallest check: the one case at two arrival times. Sufficient evidence: its red and green runs. Testing stops there.

### Task 2: The line's lead from the leads the paints have seen

- **Files:** hqptuner/static/model/gauges/playhead.js, tests/js/model/gauges/playhead-line.test.js
- **Reads:** .planning/phases/7/DESIGN.md#2. The proposed rule, .planning/phases/7/DESIGN.md#The constants, .planning/phases/7/DESIGN.md#4. The split (testing rule 17), docs/spec/timing.md#The two clocks, hqptuner/static/model/gauges/playhead.js#pacePaint
- **Decisions:** D-01, D-08, D-13
- **Pins:** tests/js/model/gauges/playhead-line.test.js
- **Action:**
  - **The behavior** (design section 2, steps 2 and 3; section 4, first row). The line's lead is the greatest lead seen over a short fixed span of recent wall time, so a lead seen late does not lower it and one seen early raises it by no more than it was early. A paint that saw no lead leaves it where it was. The span is held in two half-spans, so a rush's overshoot leaves it one span after it was seen. A paint that restarts discards what came before, and the lead it saw is the line's lead.
  - **Tests first,** in the new file `tests/js/model/gauges/playhead-line.test.js`, which holds the cases of both new decisions: `playhead.test.js` stands at 749 of its 800-line cap. The unit, the assertion and the values are the test writer's; the design says leads of hundreds of milliseconds, so the zero value differs from every expected value. The red run is against the null stub design section 4 names: `settledLead` exported from `playhead.js`, returning `{ peak: 0, prior: 0, age: 0, since: 0, ceiling: 0 }` and nothing more. Each case fails against it by `AssertionError`; a case green against the stub asserts what the absent decision returns (rule 10), and is reported, never reshaped. The stub is replaced by the real function in this task.
  - **Then the code.** `settledLead` is a pure function in `playhead.js`, taking the inputs design section 4 lists and returning the `LeadState` it names, with `ceiling` the one value its tests assert. Design section 4 asks for one of the two uses of the name `lead` to be renamed: `PaintDecision.lead`, the frame index `loop.js` `show` and the tests already read, keeps its name, and the parameter that carries the last paint's state takes another name, the executor's choice, stated in the record.
  - **The window span** is one constant in `playhead.js`, at the design's provisional 500 ms: above the 262 ms longest wait between bursts of the steady feed, so a span holds an arrival. A different value is not this task's to choose: it goes to the owner (design section 2, "The constants").
  - **Constraints.** It reads no clock (Rules 6 and 10). Per call it holds two numbers and two ages and does work that does not grow with the queue or with lateness (Rule 9, design section 2). `pacePaint` is unchanged and does not call it yet, so the loop still runs today's rule and every store and contract test stays as it was.
  - Run `filepawl accept` whenever filepawl prints it.
- **Verify:**
  - **Red run.** The executor's record names the stub and shows each new case failing by `AssertionError` against the pre-change `playhead.js` plus that stub, tests kept. An import, missing-export, collection or type error is no red run: the case is run again against the stub, and if it then passes it is reported green, never reshaped.
  - **Green.** `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead-line.test.js` prints `exit=0`. `git diff --quiet -- hqptuner/static/store/` exits 0. `scripts/gate.sh make check` fails only in the same 156 `steady-lag` cases as before.
  - **Testing scope.** Outcomes: a lead seen early raises the line by no more than it was early, one seen late leaves it, a paint with no arrivals leaves it, an overshoot leaves it one span later, a restart starts it again from the paint's own lead. Already covered: nothing, the decision is new. Smallest check: one case per outcome. Sufficient evidence: the red and green runs. Testing stops there.

### Task 3: Where the playhead stands after following the line

- **Files:** hqptuner/static/model/gauges/playhead.js, tests/js/model/gauges/playhead-line.test.js
- **Reads:** .planning/phases/7/DESIGN.md#2. The proposed rule, .planning/phases/7/DESIGN.md#The four cases the brief names, .planning/phases/7/DESIGN.md#The constants, .planning/phases/7/DESIGN.md#4. The split (testing rule 17), docs/spec/timing.md#The two clocks
- **Decisions:** D-01, D-02, D-08
- **Pins:** tests/js/model/gauges/playhead-line.test.js
- **Action:**
  - **The behavior** (design section 2, step 4; section 4, second row). The playhead moves at wall speed, its `dt`, and moves toward its aim by no more than a bounded share of that speed, up or down, so it never moves backward. Through the opening span after a restart, measured by the wall time since it, a rise of the aim above where wall speed carries the playhead is taken at once; after the opening span every gap to the aim is closed at the share. The cap at the newest frame's end and the jump by a changed delay are not this decision's: `pacePaint` keeps them (Task 4).
  - **Tests first,** in `playhead-line.test.js` beside Task 2's. The unit, the assertion and the values are the test writer's; positions away from 0. The red run is against the null stub design section 4 names: `followLine` exported, returning `0`. Each case fails against it by `AssertionError`; one green there is reported, never reshaped.
  - **Then the code.** `followLine` is a pure function in `playhead.js` with the inputs design section 4 lists, returning the playhead's next position, playback ms. The choice between taking a rise at once and following at the share is made inside it from the wall time since the restart; no boolean input carries it (design section 4).
  - **The constants,** each defined once in `playhead.js`: the opening span at the design's provisional 1000 ms, above the 572 ms the rush can last after a serial change (217 ms until frames resume plus 355 ms to settle); the follow share at the design's provisional 0.2, above the measured drift of 0.3 percent and below the quarter of wall speed the steady-motion suite lets a move stray by. A different value goes to the owner.
  - **Constraints.** As Task 2: pure, no clock, bounded work; `pacePaint` unchanged and not calling it yet.
  - Run `filepawl accept` whenever filepawl prints it.
- **Verify:**
  - **Red run.** As Task 2, against `followLine`'s stub.
  - **Green.** `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead-line.test.js` prints `exit=0`. `git diff --quiet -- hqptuner/static/store/` exits 0. `scripts/gate.sh make check` fails only in the same 156 `steady-lag` cases.
  - **Testing scope.** Outcomes: with the aim where wall speed carries it, the playhead moves its wall time; above or below the aim after the opening span it closes the gap at no more than the share and never moves backward; a rise inside the opening span is taken at once, and the same rise after it is not. Already covered: Task 2's decision. Smallest check: one case per outcome. Sufficient evidence: the red and green runs. Testing stops there.

### Task 4: The one paint decision follows the line, with every pin of the old rule restated

- **Files:** hqptuner/static/model/gauges/playhead.js, hqptuner/static/store/meter/loop.js, tests/js/model/gauges/playhead.test.js, tests/js/model/gauges/playhead-line.test.js, tests/js/store/meter/loop.test.js, tests/js/store/meter/loop-painters.test.js, tests/js/store/meter/spectrum-motion.test.js, tests/js/contracts/trace-and-meters.test.js, tests/js/contracts/trace-probes.js, tests/js/contracts/spectrogram-columns.test.js, tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py
- **Reads:** .planning/phases/7/DESIGN.md#2. The proposed rule, .planning/phases/7/DESIGN.md#The caller-side delta, .planning/phases/7/DESIGN.md#Tests that pin today's rule and are rewritten under the new one, docs/spec/timing.md#The two clocks, docs/spec/timing.md#Rules, hqptuner/static/model/gauges/playhead.js#pacePaint, hqptuner/static/store/meter/loop.js#paint, hqptuner/static/store/meter/loop.js#reset, hqptuner/static/store/meter/loop.js#takeArrivals, tests/js/model/gauges/playhead.test.js#play, tests/js/contracts/trace-probes.js#wallProbe
- **Decisions:** D-01, D-02, D-06, D-08, D-09, D-12, D-13
- **Pins:** tests/js/model/gauges/playhead.test.js, tests/js/store/meter/loop.test.js, tests/js/store/meter/loop-painters.test.js, tests/js/store/meter/spectrum-motion.test.js, tests/js/contracts/trace-and-meters.test.js, tests/js/contracts/spectrogram-columns.test.js, tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py, tests/js/contracts/steady-lag.test.js, tests/js/contracts/steady-motion.test.js, tests/js/contracts/steady-spectrogram.test.js
- **Action:**
  - **The behavior** is the approved text: the decision of design section 2, steps 1 to 6, and its four cases. A paint that took arrivals sees the lead of its newest frame, that frame's end less its `arrivedAt`. The line's lead comes from `settledLead`, the aim is the paint's wall time plus that lead less the delay, and the playhead moves by `followLine`. A changed delay first jumps it by the change, back for a raise and forward for a drop. It never passes the newest queued frame's end, and having stood there it returns to the line at the share. At a break the carried state is discarded and the playhead is placed on the aim: the newest end less the delay, carried on at wall speed from that frame's arrival.
  - **First, prove the constants on the real loop, uncommitted.** Before any pin is touched, wire the new `pacePaint` and `loop.js` and run only `steady-lag.test.js`, `steady-motion.test.js` and `steady-spectrogram.test.js` through `scripts/gate.sh`. If a steady case is still red at the provisional constants, stop here and take it to the owner with the failing line; no pin is rewritten and nothing is committed. Only when all three suites are green does the pin work below begin.
  - **Which existing tests are rewritten.** A test is rewritten only where its assertion or its stated premise contradicts a sentence of the approved text, and it then states that sentence in place of the old one; the commit message names each rewritten test and the approved sentence it now states. The candidates, read by the planner, each with the old rule it holds:
    - `playhead.test.js`: the D-06 list by name (design section 5), meaning the playhead stands the delay behind the newest end after a seek, the breach table's two wall-time breaches, it moves exactly its wall time while the feed lands, a burst landing early or late leaves it where it was, plus the paint-rate cases after them if they turn red; the header's statement of the old rule.
    - `loop.test.js`: after a burst each paint moves the playhead its wall time; the header's "moves on the paint's wall time at every paint after that".
    - `loop-painters.test.js`: moves the playhead exactly its wall time at every paint, and never hands a paint more music than its wall time and one frame cover, where the opening span's rises contradict it; the header sentence that states both.
    - `spectrum-motion.test.js`: every frame passed is shown on one or two consecutive paints, only if the opening span's rises turn it red.
    - Contract 1 in `trace-and-meters.test.js` and `wallProbe` in `trace-probes.js`: a paint moves the playhead its wall time unless it stands at the newest end. The never-backward and never-past-the-newest-end findings state approved sentences and stay as they are.
    - `spectrogram-columns.test.js`: its premise that the first paint stands the playhead the delay behind the newest end, though its frames arrived 10 ms before that paint.
    - The e2e file: the wall-time scroll cap on the capture, and its two other cases only if the opening span's rises turn them red.
  - **A rewrite narrows nothing beyond its approved sentence.** It allows the bounded share where the old rule said wall time, the opening span's rises where it said no step, the wait since arrival where it said the delay behind the newest end, and no more. Each rewritten case asserts something the approved rule does and the old rule does not, so it is red against the old code (D-06). A rewrite that cannot be made red there, because the approved sentence only loosens the old one, is neither loosened nor deleted: stop and take it to the owner, naming the test and the sentence.
  - **The new inputs reach every caller truthfully.** The `play` harness of `playhead.test.js` hands `pacePaint` the paint's wall time, whether the paint took arrivals and each frame's `arrivedAt`, and hands back the carried state as it hands back `end`, `playhead` and `delayed`. Today's `Step` list carries no arrival wall time: `scheduled` drops `arrivals[next].wall`, `bursts` drops `next * GAP_MS + ARRIVE_MS`, and the hand-written lists (such as the case built from `FEED.slice(0, BURST)`) carry none. So the `arrive` step gains its wall time (`{ arrive, at }`), `scheduled` and `bursts` fill it from the time they already compute, and each hand-written list states it. `play` stamps `arrivedAt` on copies of the frames it queues, never on the shared constants (`FEED`, `FEEDS`), so no stamp leaks from one run into the next. These are helper edits inside `playhead.test.js`; the caller-side delta of `pacePaint` is unchanged. No assertion of a case that is not a rewritten pin changes. If `playhead.test.js` would cross its 800-line cap, the rewritten line-following cases go in `playhead-line.test.js` instead; no production call site moves.
  - **Tests first.** Make every rewrite and harness change, then run the leased suites against `playhead.js` and `loop.js` as Task 3 left them: each rewritten case fails by `AssertionError`, and every other case passes.
  - **Then the code.** `pacePaint` takes the paint's wall time `now`, whether it took arrivals (`arrived`) and the carried state, reads `arrivedAt` off the newest frame, calls `settledLead` and `followLine` once each, and returns the carried state in `PaintDecision` under a name other than `lead`. Today's head computation and restart anchor are retired, with no forwarder left. `PaintInput` and `PaintDecision` doc comments name each new field's clock and unit. `loop.js` `paint` passes the `now` it is already handed and whether `takeArrivals` moved any frame, keeps the carried state beside `end`, `started` and `delayed` and hands it back, and `reset` clears it. Caller-side delta (design section 4): one production call site, `paint` in `loop.js`, and one test call site, `play` in `playhead.test.js`; `settledLead` and `followLine` gain exactly one production caller each, `pacePaint`.
  - **Header comments.** The headers of `playhead.js` and `loop.js` describe the approved rule; leave no sentence of the old rule standing ("Arrivals do not steer it", "no catch-up for the time it stood", a restart "one delay behind the newest frame's end" with no wait since the arrival).
  - **One commit.** The code change and every rewrite land together: the old pins fail the moment the loop applies the new rule, and the rewritten ones fail before it, so either half alone commits a red gate D-09 (b) does not cover.
  - **What stays unedited.** `steady-lag.test.js`, `steady-motion.test.js`, `steady-spectrogram.test.js`, `streams.js`, `smooth-probes.js`, `world.js`, `schedules.js` and `picture.js`. A steady case still red after the code has two outcomes: fix the code within the design, or stop and take it to the owner with the failing line. Moving a constant off its provisional value is a choice that goes to the owner, never a repair (design section 2).
  - **What stops the task.** A test outside this lease that turns red is not edited: stop and report it as a planning gap. A test in the lease that turns red where the approved text does not contradict it is not edited: the code is wrong. Run `filepawl accept` whenever filepawl prints it.
- **Verify:**
  - **Red run.** The executor's record lists each rewritten case failing by `AssertionError` against `playhead.js` and `loop.js` as Task 3 left them, tests kept, and every case that is not a rewritten pin passing in that same run.
  - **Suites of Plans 2 to 4 unedited.** `git diff --quiet 2b6797e1 HEAD -- tests/js/contracts/streams.js tests/js/contracts/smooth-probes.js tests/js/contracts/world.js tests/js/contracts/schedules.js tests/js/contracts/picture.js tests/js/contracts/steady-lag.test.js tests/js/contracts/steady-motion.test.js tests/js/contracts/steady-spectrogram.test.js` exits 0 (AC9).
  - **Gates.** `scripts/gate.sh make check` prints `exit=0` (AC7), so the 156 lag cases, the 15 paired cases, and the motion and spectrogram suites all pass. `grep -rn "do not steer\|no catch-up for the time it stood\|no arrival changes its speed" hqptuner/static tests/js tests/e2e` prints nothing.
  - **e2e.** The browser is named by `HQPTUNER_CHROMIUM` in `hqpcreds`; playwright's cache on this host holds no chromium. Run `set -a; source hqpcreds; set +a` first, then probe that the binary exists. Name the run first (it can hold a full core for more than 10 s, `~/dev/CLAUDE.md` 3.1). The rewritten e2e pin's red run against the old code and `scripts/gate.sh make test-e2e` printing `exit=0` against the new code are both required before the commit. No CI job runs before the commit, since nothing is pushed (`~/dev/CLAUDE.md` 11.2), so a missing browser stops the task and goes to the owner; it is never a skipped step.
  - **The constants.** The record names each constant's value and the bound from design section 2 it sits inside.
  - **Rebuild.** `bash .claude/task-check.sh` passes: make check, a rebuilt `hqptuner:dev` and a healthy `:8090`. The rebuild can hold a full core for more than 10 s, so name it before it runs.
  - **Testing scope.** Outcomes: steady lag, steady motion and steady spectrogram on every replay, already written in Plans 2 to 4, and the new decisions, pinned in Tasks 2 and 3. Smallest addition: the rewritten pins, each stating its approved sentence. Sufficient evidence: the red run, the unedited suites passing, `make check` green, the e2e run. Testing stops there.
  - **human-verify (AC6).** At the hand-back URL from the host skill, the owner plays tracks at two sample rates, with a start from stopped, a same-rate track change and a rate change. The owner sees the meters, the spectrum and the spectrogram hold the same lag behind the sound right after each start as later in the track, and move smoothly after the opening jump.

## Notes

- **Revision against the approved design (2026-11-16).** Where the earlier PLAN-5.md differed from `docs/spec/timing.md` and `DESIGN.md`, the design won:
  - The lease gains `feed.js`, `meter.js` and `feed.test.js`: the approved Feed store row and design sections 4 and 5 have the feed store stamp each arrival (D-13). That is its own task (Task 1), since it changes nothing the loop reads until Task 4.
  - The earlier Task 1 held "each new decision" in one task; the design names two, `settledLead` and `followLine`, each with its own null stub, so they are Tasks 2 and 3. The earlier fallback for a design that adds no decision is dropped.
  - Their cases go in a new file, `tests/js/model/gauges/playhead-line.test.js`, because `playhead.test.js` is at 749 of its 800-line cap. This is a new test file, not a split: no existing case moves unless Task 4 would cross the cap, and no production call site changes.
  - The name clash design section 4 leaves to this plan: `PaintDecision.lead` keeps its name, so `loop.js` `show` and the tests reading it do not change, and the carried state takes another name.
  - The constants take the design's provisional values (opening span 1000 ms, window span 500 ms, follow share 0.2), each inside its bound in design section 2. Moving one is the owner's choice, per the design.
  - The earlier lease had the design's list of pins only. Reading the tests that run the real loop added `loop-painters.test.js` (two wall-time cases), `spectrum-motion.test.js` (every frame shown, which the opening span's rises may break) and `spectrogram-columns.test.js` (a restart premise with a 10 ms wait since arrival). Design section 5 leaves such pins to "Plan 5's run"; they are leased here so the run does not stop on them.
  - The check that the suites are unedited now runs from HEAD `2b6797e1`, because Plan 4 changed `streams.js`, `steady-lag.test.js`, `smooth-probes.js`, `world.js` and `schedules.js` by D-12 and D-13. It also covers `world.js`, `schedules.js` and `picture.js`, which the suites run on.
  - The per-call allocation constraint follows design section 2's Rule 9 wording (bounded state, one decision a paint) in place of the earlier "allocates nothing per call", which a pure function returning a state cannot meet any more than `pacePaint` does today.
  - The earlier sentence that the plan "is revised before it is dispatched" is dropped: this is that revision.
- **Why Task 4 is one task of eleven files.** The rewritten pins are red against the old code (D-06) and the old pins are red against the new code, so the switch and every pin it breaks are one commit, and D-09 (b) authorizes no red test outside the steady suites. The pins are one concern with the switch: they restate the same rule.
- **Blockers that go to the owner, not into a test.** A steady case red at the provisional constants. A pin whose approved sentence only loosens it, so no rewrite can be red against the old code. A test outside the lease turning red.
- **Recalled decisions used** (all `.planning/phases/7/CONTEXT.md`, phase 7): D-02 (one shared playhead, no per-rate offset) in Context and Task 4; D-08 (no rush-only patch) in Context; D-10 and D-12 (each stream's own heard clock, the paired check at float error) in the steady suites this plan leaves unedited; D-13 (arrivals stamped as they land) in Tasks 1 and 4.
- Late-connect timing (D-02) is covered by the join replays of the steady suites, on their stated assumption, and by AC6 at the hand-back. No live late-connect run exists.
