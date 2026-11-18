---
phase: 7
plan: 1
requirements: []
files:
  - tests/js/contracts/streams.js
  - tests/js/contracts/smooth-probes.js
  - tests/js/contracts/steady-lag.test.js
  - tests/js/contracts/steady-motion.test.js
  - tests/js/contracts/steady-spectrogram.test.js
  - tests/js/contracts/schedules.js
  - tests/js/model/gauges/playhead-lag.test.js
  - tests/js/model/gauges/playhead-motion.test.js
  - tests/js/model/gauges/playhead-scroll.test.js
  - tests/js/store/meter/feed.test.js
---

# Phase 7: Visuals stay in sync after a track starts - Plan 1: The smoothness tables

## Goal

After a track starts, the visuals keep the same lag behind the sound that they hold for the rest of the track, whatever the track's sample rate. This plan writes the tests of that goal the way D-16 orders: the replay suites go, and the playhead's decision is called with inputs the test writes, each case beside the one exact answer the test writes for it, red against today's playhead before the fix (Plan 2) lands.

## Must be true when done

- No test replays a browser for smoothness: the steady-lag, steady-motion and steady-spectrogram replay suites and the streams they ran on are gone from the tree.
- A table of cases says yes or no, by exact equality, to steady lag: after a start the playhead stands one delay behind the line on the paint that restarts and on every paint of the opening, as it does on a paint later in the track, whatever the wait between the newest arrival and the paint and whatever stamp the reader counted from.
- A table says yes or no to each promise of the approved rule: never backward outside a break or a raised delay, never past the newest queued frame's end, and at a break a restart one delay behind the newest frame's end, carried on at wall speed from the time that frame arrived, with nothing from before the break followed.
- The spectrogram's edge is held to its three words, constant rate, no stall, no catch-up burst, each by a named test.
- Two inputs identical but for the source rate give the playhead identical input.
- Every new case's inputs and answers are written in its own file, in whole ms and whole samples, and each case red against today's code fails by `AssertionError`.

## Context

- D-16 binds every task: no test runs a paint schedule, at 60 Hz or any cadence, and no expected value comes from a generator's logic (`docs/spec/testing.md` rule 13). Each behavior is tested at the lowest lane that observes it (rule 15), each case asserting the one exact answer written beside it in a table (rules 17 and 18). D-14 sets what the tests assert; D-15 limits what they feed in.
- D-15's limits on every table: no opening lead above the line the start settles to, and no arrival ahead of its line; no loss of music without a break; no stamps falling against wall time. Only the rising drift the captures measured is fed.
- The approved rule is `docs/spec/timing.md`, "The two clocks" and Rules 1 and 5, with `.planning/phases/7/DESIGN.md` section 2. `settledLead` and `followLine` are in the tree, pinned by `tests/js/model/gauges/playhead-line.test.js`, and `pacePaint` does not call them yet, so "today's code" is the old rule with arrivals stamped (`arrivedAt`, landed in `df826b14`).
- D-09 (b) authorizes committing the smoothness tests red until the fix makes them pass. This plan reads that grant as carrying to the tables that replace the replay suites (D-16 "replaced"), and to nothing else: no other file may be red at any commit here.
- Out of scope: everything under `hqptuner/`, `CHANGELOG.md` (the owner's alone) and user-facing text. `tests/js/contracts/world.js`, `picture.js` and `picture-probes.js` stay: `trace-and-meters.test.js`, `spectrogram-columns.test.js` and `spectrogram-picture.test.js` run on them. The capture fixtures `tests/support/fixtures/meter_start_capture*.json` stay as AC1's record.

## Tasks

### Task 1: Retire the replay suites and the streams they ran on

- **Files:** tests/js/contracts/streams.js, tests/js/contracts/smooth-probes.js, tests/js/contracts/steady-lag.test.js, tests/js/contracts/steady-motion.test.js, tests/js/contracts/steady-spectrogram.test.js, tests/js/contracts/schedules.js
- **Reads:** tests/js/contracts/schedules.js, tests/js/contracts/streams.js, .planning/phases/7/CONTEXT.md#Durable decisions
- **Decisions:** D-16
- **Pins:** tests/js/contracts/steady-lag.test.js, tests/js/contracts/steady-motion.test.js, tests/js/contracts/steady-spectrogram.test.js
- **Action:**
  - **What becomes true.** D-16 replaces the three replay suites and their streams; they are deleted, not rewritten. Delete `streams.js`, `smooth-probes.js`, `steady-lag.test.js`, `steady-motion.test.js` and `steady-spectrogram.test.js`.
  - **What their deletion leaves dead.** `streams.js` was the only importer of `gridLengths`, `lengths`, `paintsEvery` and `random` from `schedules.js`. Each export knip then reports as unused loses its `export`, or goes whole where nothing in `schedules.js` calls it. A sentence in the `schedules.js` header that names the deleted streams goes with them. `SCHEDULES` and everything the other three contract suites read stays unchanged.
  - **What stays.** `world.js`, `picture.js`, `picture-probes.js` and the three capture fixtures. No other test changes.
- **Verify:**
  - `ls tests/js/contracts/streams.js tests/js/contracts/smooth-probes.js tests/js/contracts/steady-lag.test.js tests/js/contracts/steady-motion.test.js tests/js/contracts/steady-spectrogram.test.js` finds none of them.
  - `scripts/gate.sh make check` prints `exit=0`. At the base commit it stops at `test-js` on the 156 steady-lag cases, so this run proves the tree green with the replay suites gone and knip clean of the exports they used.
  - **Testing scope.** Outcome: the tree runs no replay suite. Already covered: the other contract suites, unchanged. Smallest check: the listing and the gate. Testing stops there.

### Task 2: Steady lag, as a table on the paint decision

- **Files:** tests/js/model/gauges/playhead-lag.test.js
- **Reads:** hqptuner/static/model/gauges/playhead.js#pacePaint, hqptuner/static/model/gauges/playhead.js#settledLead, hqptuner/static/model/gauges/playhead.js#followLine, hqptuner/static/model/gauges/meter/meter.js, docs/spec/timing.md#The two clocks, .planning/phases/7/DESIGN.md#2. The proposed rule, docs/spec/testing.md#Core rules
- **Decisions:** D-02, D-08, D-14, D-15, D-16
- **Action:**
  - **The behavior,** in the owner's terms (D-14, D-08 (1)). After a start the playhead stands one delay behind the line on every paint, as it does later in the track. The line is the stamps' lead over wall time, a frame's end less its `arrivedAt`, held as `settledLead` holds it. One delay behind the line is the paint's wall time plus the line's lead less the delay. It holds on the paint that restarts, at a break frame or at the first paint since the queue began. It holds on each paint of the opening span while the line rises to where it settles. It holds later in the track on a line that holds, on a paint that took no arrival, and on the rising drift the captures measured.
  - **Where the reader connected** (D-02). The lag after a start does not depend on the wait between the newest frame's arrival and the paint that restarts, which is the browser loop's connect and paint phase. It does not depend on the stamp the server's reader counted from, which is its connect. Both are inputs of the table.
  - **The lane** is `pacePaint` (rule 15): the one decision a paint makes, composed of `settledLead` and `followLine`. A case is one call. Every input, the frames, the paint's wall time and what earlier paints left (`end`, `playhead`, `delayed`, `started` and the line's carried state), is written by the table, never made by running earlier paints (D-16). The answer is written beside it, never computed by the test (rules 10 and 13).
  - **The new inputs.** The approved rule reads three things `PaintInput` does not name yet. They take the names `.planning/phases/7/DESIGN.md` section 4 and `settledLead` give them: `now`, the paint's wall time in ms; `arrived`, whether the paint took arrivals; and `line`, the carried `LeadState` or null. Plan 2 widens `PaintInput` to these names and types. Until then `tsc -p tsconfig.node.json` stays clean without a cast, a `@ts-ignore` or any exemption: the test types its own input as `PaintInput` plus these three fields, and hands it in as a typed value, which TypeScript checks structurally.
  - **Tests first.** The unit, the names, the table and every value are the test writer's, within `docs/spec/testing.md` (rules 2, 6, 10, 12, 17, 18) and D-15's limits. Run the file against `hqptuner/` as it stands. Today's restart stands the playhead the delay behind the newest end with no wait since the arrival, and today's paint moves on `dt` alone. So a restart after a wait, a rise in the opening and a drift fail by `AssertionError`. A case green there, such as a paint on a line that holds, is reported as a guard and never reshaped.
- **Verify:**
  - **Red run.** The record lists each case failing by `AssertionError` against `hqptuner/` as it stands, with the restart after a nonzero wait, a rise in the opening span and the rising drift among them, and lists every case green there. An import or type error is no red run.
  - **Table, not replay.** `grep -nE "contracts/|requestAnimationFrame|1e-|Math\.abs|EPS|SLACK" tests/js/model/gauges/playhead-lag.test.js` prints nothing.
  - **Gates.** `scripts/gate.sh make check` stops only at `test-js`, and every failing test is in this plan's new table files. `tsc`, eslint and knip pass.
  - **Testing scope.** Outcomes: the lag on each paint kind after a start and later in the track, and its independence of the paint's wait and the stamps' origin. Already covered: `settledLead` and `followLine` alone, in `playhead-line.test.js`. Smallest set: one case per paint kind and per join input, the test writer's to shape. Sufficient evidence: the red run. Testing stops there.

### Task 3: The approved rule's promises, as a table on the paint decision

- **Files:** tests/js/model/gauges/playhead-motion.test.js
- **Reads:** hqptuner/static/model/gauges/playhead.js#pacePaint, hqptuner/static/model/gauges/playhead.js#restartAt, tests/js/model/gauges/playhead-lag.test.js, docs/spec/timing.md#The two clocks, docs/spec/timing.md#Rules, .planning/phases/7/DESIGN.md#The four cases the brief names
- **Decisions:** D-08, D-14, D-15, D-16
- **Action:**
  - **The behavior** (D-14, D-08 (2), the approved text). Each paint shows the moment of playback its own time calls for, with no freeze, jump ahead or step back except at a real break. Each promise holds or not:
    - The playhead never moves backward outside a break or a raised delay. That includes when the line falls after the opening span, and on a late paint that stands far above its aim.
    - It never passes the newest queued frame's end, even where the aim stands past it, the opening span's rise included. Having reached that end, it stands there until the next arrival.
    - At a break it restarts one delay behind the newest frame's end, carried on at wall speed from the time that frame arrived. Nothing carried from before the break is followed: a restart handed a line far from the new one lands on the new one.
  - **The lane, the inputs and the types** are Task 2's: `pacePaint`, one call a case, every input and answer written in the table, the three new inputs typed by the test.
  - **What Task 2 already holds.** The restart's own position after a wait, and a paint on a line that holds moving its wall time, are Task 2's cases. A case here that cannot fail unless one of those fails is one test with it (rule 12), so it is not written twice, and the record names which test holds it.
  - **Tests first,** as Task 2. The never-backward and never-past cases are expected green against today's code, as guards of promises the fix must keep. Each green case is reported and never reshaped.
- **Verify:**
  - **Red run.** The record lists each case failing by `AssertionError` against `hqptuner/` as it stands and each green one, with the promise each states.
  - **Table, not replay.** `grep -nE "contracts/|requestAnimationFrame|1e-|Math\.abs|EPS|SLACK|BREAK_MS" tests/js/model/gauges/playhead-motion.test.js` prints nothing.
  - **Gates.** As Task 2.
  - **Testing scope.** Outcomes: the three promises. Already covered: the restart's position and the on-line move, by Task 2; never backward and the cap under today's rule, by `playhead.test.js`'s breach table. Smallest set: one case per promise and per input that strains it (a falling line, a late paint, an aim past the newest end, a restart from a far line). Sufficient evidence: the red run. Testing stops there.

### Task 4: Steady spectrogram: constant rate, no stall, no catch-up burst

- **Files:** tests/js/model/gauges/playhead-scroll.test.js
- **Reads:** hqptuner/static/store/meter/spectrogram.js#drawnRange, hqptuner/static/components/faceplate/drawers/source/paint.js, hqptuner/static/lib/spectroraster.js#scrollPlan, tests/js/lib/spectroraster.test.js, tests/js/model/gauges/playhead-lag.test.js, tests/js/model/gauges/playhead-motion.test.js, .planning/phases/7/DESIGN.md#2. The proposed rule
- **Decisions:** D-08, D-14, D-15, D-16
- **Action:**
  - **The behavior** (D-08 (3)). The spectrogram scrolls at a constant rate in playback time, with no stalls and no catch-up bursts. Its right edge is the playhead (`spectrogramRange`, `stripEnd`), and its scroll is the edge's move through `scrollPlan`, which `tests/js/lib/spectroraster.test.js` already pins for a given move. So at the lowest lane (rule 15) each word is a fact of the playhead's move at a paint:
    - **Constant rate:** on a line that holds, the edge moves by the music heard over the paint.
    - **No stall:** while music is queued past the playhead, the edge moves.
    - **No catch-up burst:** after the playhead stood at the newest end, the paint that takes the next arrival after the opening span does not move the edge at once to the line. It follows the line as the approved rule's bounded share allows.
  - **What is written here.** Only the cases that Tasks 2 and 3 and the `scrollPlan` pins leave alive (rule 12), on `pacePaint`, with Task 2's lane, inputs and types. The record names, for each of the three words, the test that holds it. If every word is held elsewhere, this file is not created, and the record says so.
  - **Tests first,** as Task 2. Today's paint after a stand moves its wall time with no return to the line, so an exact answer under the approved rule is red there. Green cases are reported and never reshaped.
- **Verify:**
  - **Held by name.** The record lists constant rate, no stall and no catch-up burst, each with the exact name of the test that holds it, and each case here red by `AssertionError` or green against `hqptuner/` as it stands.
  - **Table, not replay.** If the file exists, `grep -nE "contracts/|requestAnimationFrame|1e-|Math\.abs|COLUMN_ROOM|SLACK" tests/js/model/gauges/playhead-scroll.test.js` prints nothing.
  - **Gates.** As Task 2.
  - **Testing scope.** Outcome: the edge's move per paint. Already covered: `scrollPlan` for a given move, and the on-line move in Task 2. Smallest addition: the burst after a stand, and whatever else the record finds unheld. Sufficient evidence: the named list and the red run. Testing stops there.

### Task 5: The same input at every source rate, at the feed store

- **Files:** tests/js/store/meter/feed.test.js
- **Reads:** tests/js/store/meter/feed.test.js, hqptuner/static/store/meter/feed.js#decode, tests/js/support/meterfeed.js, tests/js/support/eventsource.js, hqptuner/static/model/gauges/playhead.js#pacePaint
- **Decisions:** D-02, D-12, D-14, D-16
- **Action:**
  - **The behavior** (D-14, D-12 (1)). Two streams identical but for the source rate give identical playheads at every paint. `pacePaint` takes no rate: it reads frames in playback ms and their arrival times. So the lowest lane that sees the rate (rule 15) is the feed store, the one site that turns samples into ms. Two event tables identical but for the source rate queue frames identical in every field the playhead reads: `at`, `ms`, `arrivedAt` and `break`. The tables are the same arrival wall times and the same playback ms per frame, each frame a whole number of samples at both rates. Any difference is the rate's alone.
  - **What it kills.** The existing cases `test_events_one_second_of_samples_apart_start_one_second_of_playback_apart` and `test_after_a_reconnect_at_another_rate_one_second_of_samples_is_one_second_of_playback` compare differences at one rate. A per-rate offset on `at`, or a rate reaching `arrivedAt`, survives them. Add only the cases that kill those (rule 12), following the file's harness, header and reset pattern. The header gains the sentence the new cases state.
  - **Tests first.** Today's store reads no rate into these fields, so the cases are expected green, as the D-12 record found. That is a guard the fix must keep, exempt from bite under `docs/spec/testing.md` rule 8 as characterization. The record states the exemption.
- **Verify:**
  - **Kill check.** A scratch edit, not committed, that adds a per-rate offset to `at` in `decode` turns a new case red by `AssertionError`. The record quotes that line, and the edit is reverted: `git diff --quiet -- hqptuner/` exits 0.
  - **Gates.** `scripts/gate.sh make check` stops only at `test-js`, with every failure in this plan's table files, and `feed.test.js` passes.
  - **Testing scope.** Outcome: the playhead's input is the same at both rates. Already covered: the ms conversion at each rate, by differences. Smallest addition: the absolute cross-rate cases. Sufficient evidence: the kill check and the green run. Testing stops there.

## Notes

- **The red grant.** D-09 (b) authorizes red commits for "the D-08 tests". D-16 replaces those suites with Tasks 2 to 4's tables, and this plan reads the grant as passing to them. If the owner reads it otherwise, Tasks 2 to 4 are written and run red but held uncommitted until Plan 2's fix lands with them.
- **Which plan writes the names.** Tasks 2 to 4 hand `pacePaint` three inputs it does not take yet, `now`, `arrived` and `line`. The names are taken from DESIGN section 4 and `settledLead`'s parameter, so Plan 2 does not have to read them back out of a report. Plan 2 makes `PaintInput` take them unchanged.
- **Superseded wording.** AC3 to AC5 of `CONTEXT.md` still read "within one metering frame", and AC8 still reads "replay". D-14 and D-16 supersede both, and these tables state the criteria exactly.
- **Recalled decisions used** (all `.planning/phases/7/CONTEXT.md`, phase 7): D-02, for the join inputs of Task 2 and the rate of Task 5. D-08, for the three behaviors, Tasks 2 to 4. D-14, for exact answers throughout. D-10's replay design is superseded by D-16 and is not used.
