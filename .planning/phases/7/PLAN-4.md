---
phase: 7
plan: 4
depends_on: [2, 3]
requirements: []
files:
  - .planning/phases/7/DESIGN.md
  - docs/spec/timing.md
  - tests/js/contracts/streams.js
  - tests/js/contracts/steady-lag.test.js
  - tests/js/contracts/smooth-probes.js
  - tests/js/contracts/schedules.js
---

# Phase 7: Visuals stay in sync after a track starts - Plan 4: The playhead's design, approved by the owner

## Goal

After a track starts, the visuals keep the same lag behind the sound that they hold for the rest of the track, whatever the track's sample rate. This plan turns the red tests of Plans 2 and 3 into a diagnosis and a proposed playhead rule. The owner approves its spec text verbatim, and the text lands in `docs/spec/timing.md` before any code changes.

## Must be true when done

- A design record names, for each smoothness test that is red, the property of today's playhead rule the failure shows. It is read from the red run, not guessed.
- The record proposes one playhead rule that holds steady lag, steady motion and steady spectrogram on every replay of Plans 2 and 3. If no single rule can, it says so and puts the choices to the owner.
- The owner approved the spec text character for character, and `docs/spec/timing.md` holds exactly that text.
- No code under `hqptuner/` changed. The only test change is Task 2's, which D-12 ordered, and the design record's section 3 reads its result.

## Context

- D-08: the fix is general, never aimed at the start rush alone, and any spec change it needs goes to the owner verbatim. D-01: a correction after the anchor changes the owner's v2.0.0 rule ("wall speed, arrivals do not steer it; drift and stall handling only if a measurement shows them needed"). The Plan 1 capture and the second capture Plan 2 commits (`tests/support/fixtures/meter_start_capture_2.json`), as Plan 2's Task 3 measures them (`scripts/probes/meter/arrival_patterns.py`, its output in that commit's message and cited in `tests/js/contracts/streams.js`), are that measurement. The rule lives in `docs/spec/timing.md` "The two clocks" and Rule 1, with the decision in the commit.
- D-02: one shared playhead, the same lag at every rate and wherever the reader or loop connected. No per-rate offsets and no per-view correction. D-07: nothing closes lag today, and the PROJECT.md key decision row is stale.
- Binding spec: `docs/spec/timing.md` Rules 1 (positions from stamps), 3 (a break restarts and nothing smooths across one), 4 (one playhead), 5 (one pacing decision a paint; skip and catch-up live there), 6 and 10 (decisions pure, no clock in model code), and 9 (a late paint costs no more than an on-time one). Also `docs/spec/testing.md` rule 17.
- The probing rule: frame timing, stamps and Status fields are wire behavior and fair to read; nothing about HQPlayer's filter design is measured or inferred.

## Tasks

### Task 1: Propose the playhead rule from the red tests

- **Files:** .planning/phases/7/DESIGN.md
- **Reads:** hqptuner/static/model/gauges/playhead.js#pacePaint, hqptuner/static/store/meter/loop.js#paint, hqptuner/static/store/meter/feed.js#decode, hqptuner/static/store/meter/delay.js#effectiveDelay, hqptuner/static/store/meter/spectrogram.js#drawnRange, docs/spec/timing.md#The two clocks, docs/spec/timing.md#Rules, .planning/phases/7/CAPTURE.md, tests/support/fixtures/meter_start_capture_2.json, scripts/probes/meter/arrival_patterns.py, tests/js/contracts/streams.js, .planning/_archive-v2.0.0/5/CONTEXT.md, tests/js/contracts/steady-lag.test.js, tests/js/contracts/steady-motion.test.js, tests/js/contracts/steady-spectrogram.test.js
- **Decisions:** D-01, D-02, D-07, D-08, D-09, D-10
- **Action:** Write the design record with `Write`, soft-wrapped, with no em dashes. It holds:
  - **Diagnosis.** Re-run the suites of Plans 2 and 3 at HEAD. For each failing case, cited by its exact test name, state the property of today's rule the failure shows, quoting the shortest decisive line of its output. The lag is read against each stream's own heard clock, as D-10 decided, not against Status `position`. Today's rule has four parts: the anchor set once at the first paint after a restart, at the newest frame end less the delay; a move on wall `dt` only; standing at the newest end; and no correction after the anchor. A cause the readings do not show is marked as unconfirmed, never stated as found.
  - **The proposed rule.** One playhead rule that holds all three behaviors on every replay of Plans 2 and 3. The record shows how it treats an opening stretch, a gap between arrivals, stamps that drift against wall time, and a break. It stays inside the binding rules in Context. It uses only inputs that reach the page: stamps, the wall time a paint takes arrivals at, the effective delay, and Status fields the page already reads.
    - The capture's Status also holds `output_fill`, `display_position` and `process_speed`. Before the design relies on any of them, look them up in HQPlayer's docs through the hqpdoc tools (`hqp_find` first). A field the docs leave undocumented is relied on only as measured wire behavior, never with a meaning given to it.
    - The rule is not fitted to the tests' tolerances or streams. For that reason the record is not checked by running a prototype of the rule against the suites of Plans 2 and 3: that check is deliberately left to Plan 5, whose fix runs them unedited and takes the plan back to the owner if one stays red.
  - **If no single rule holds all three behaviors,** for example through an opening stretch, the record says where they conflict, with the readings, and lays the choices out for the owner. It picks none.
  - **The split (rule 17).** Each decision the rule makes, the one pure function under `hqptuner/static/model/` that returns it, the one value its test asserts, and, for a decision that does not exist today, the null stub its tests are red against (the export named, returning the zero value of its result type; `docs/spec/testing.md` rule 8), with that zero value differing from every value its tests expect. If the rule extracts or splits a decision out of `pacePaint`, state the caller-side delta: how many call sites change, in which files.
  - **What changes where.** The modules whose code and header comments change. The existing tests that pin today's rule and are rewritten under it: the D-06 list (`tests/js/model/gauges/playhead.test.js`, `tests/js/store/meter/loop.test.js`), contract 1 in `tests/js/contracts/trace-and-meters.test.js` with `wallProbe` in `trace-probes.js`, and the wall-time scroll cap in `tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py`, plus any other pin the rule breaks. Also the PROJECT.md key decision row the rule replaces (D-07), named for the orchestrator to update, not edited here.
  - **The spec text.** The exact replacement for each passage of `docs/spec/timing.md` the rule changes: at least "The two clocks" playhead sentences and Rule 1, and Rule 5 if skip or catch-up changes. Give each as before-and-after text, soft-wrapped.
  - Hand the record to the owner. Record the owner's approval, or the owner's changes and the re-approved text, in it character for character.
- **Verify:**
  - **Every failure cited.** Run `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test --test-reporter=tap tests/js/contracts/steady-lag.test.js tests/js/contracts/steady-motion.test.js tests/js/contracts/steady-spectrogram.test.js` at HEAD; it prints a non-zero exit and a log path. Then, reading that log, `perl -ne 'print "$1\n" if /^\s*not ok \d+ - (.+?)\s*$/' <log> | sort -u | while IFS= read -r n; do grep -qF -- "$n" .planning/phases/7/DESIGN.md || echo "uncited: $n"; done` prints nothing: every failing test name in the run appears in the record.
  - **Format.** `.venv/bin/python .claude/hooks/md-softwrap.py --check .planning/phases/7/DESIGN.md` exits 0, and `grep -cP '\x{2014}' .planning/phases/7/DESIGN.md` prints 0 (no em dash).
  - **human-verify.** The owner reads `.planning/phases/7/DESIGN.md` and approves its spec text verbatim. The record shows the approval and the approved text.
  - Testing scope: none; this is a design record, and the suites of Plans 2 and 3 already state the behavior it must deliver. Whether the proposed rule passes them is Plan 5's check, by the choice stated in Action.

### Task 2: The cross-rate check split in two (D-12)

- **Files:** tests/js/contracts/streams.js, tests/js/contracts/steady-lag.test.js, tests/js/contracts/smooth-probes.js, tests/js/contracts/schedules.js, .planning/phases/7/DESIGN.md
- **Reads:** .planning/phases/7/CONTEXT.md#D-12, .planning/phases/7/DESIGN.md, tests/js/contracts/streams.js, tests/js/contracts/steady-lag.test.js, tests/js/contracts/world.js, docs/spec/testing.md
- **Decisions:** D-09, D-10, D-11, D-12
- **Action:** D-12 splits the one exact cross-rate check of Plan 3's Task 4 into two contracts. Write the first tests-first, change the second's tolerance, then read the result into the design record.
  - **Rate-agnostic, exact.** Paired streams that are identical in everything but the source rate. Within a pair, the arrival wall times, the playback ms each burst carries, the lead and the delay are the same, and so is Status apart from its rate. The page then holds the same information at both rates. The behavior: the lag is the same at both rates, within floating-point error, at every paint the suite reads. Any difference is the rate's alone. Cover 44100 against 192000, as the owner asked, plus a start from stopped, a rate change both ways, a rush and a drift. Bursts must end on playback boundaries that both rates' frames share. A 44100 frame is 23.22 ms and a 192000 frame is 5.33 ms, so frame ends coincide only every 147 frames at 44100 (3.41 s); integer-ratio pairs (48000 against 192000, 44100 against 176400) share every frame end of the lower rate. The test writer chooses the pairs and states, in the `streams.js` header, how each one holds the same information at both rates.
  - **Each start's true lag.** The comparisons across the captured starts, including Plan 3's 192000 capture streams, hold within the resolution the stream's own paints and arrivals allow. The tolerance is computed from that stream's known timing (paint interval, arrival grain, jitter) and stated with its arithmetic in the header. It is never a round figure, and it replaces `FLOAT_MS` for these comparisons.
  - **Paints at 60 Hz.** The replay streams paint at 60 Hz, as a browser does, not every 50 ms.
  - **A green result is a finding.** If the paired check is green against today's code, the rate is not the cause, and that is reported, not reshaped. Commit it green; D-09 (b) still covers what stays red. Never reshape a stream or a tolerance to turn a case red or green.
  - **Read the result into the record.** Rewrite section 3 of `.planning/phases/7/DESIGN.md` with the paired check's result and what it says about the cause. Record D-12 in section 7 as the D-11 choice, replacing options (a) to (d). Change no spec text in section 6, except where the result proves a sentence of it wrong; then mark that sentence for the owner.
- **Verify:** Run `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/steady-lag.test.js tests/js/contracts/steady-motion.test.js tests/js/contracts/steady-spectrogram.test.js` against today's code. Every failure is an `AssertionError` naming a replay. The log's test names include a paired 44100 against 192000 case. `git diff --quiet <pre-plan HEAD> HEAD -- hqptuner/` exits 0. `scripts/gate.sh make lint-js` prints `exit=0`. `.venv/bin/python .claude/hooks/md-softwrap.py --check .planning/phases/7/DESIGN.md` exits 0.
  - Testing scope. Outcomes: the lag does not depend on the source rate, exactly, when the information is the same; each captured start's lag holds within its stream's resolution.
  - Already covered: steadiness within a track, across starts, and across joins (Plans 2 and 3).
  - Testing stops at the run and the record.

### Task 3: The approved rule lands in the timing spec

- **Files:** docs/spec/timing.md
- **Reads:** .planning/phases/7/DESIGN.md, docs/spec/timing.md#The two clocks, docs/spec/timing.md#Rules
- **Decisions:** D-01, D-08
- **Action:** Replace each passage the design record names with its approved text, character for character, using `Edit`. Change no other passage. The commit message records the owner's decision, cites `.planning/phases/7/CAPTURE.md` and the red run of Plans 2 and 3, and names the v2.0.0 rule it replaces. This is a `docs/` edit, so it runs its own gate only: no rebuild and no hand-back URL.
- **Verify:** `git diff -- docs/spec/timing.md` changes only the passages the design record names, and each new passage equals its approved text. `.venv/bin/pre-commit run --files docs/spec/timing.md` exits 0. `.venv/bin/python .claude/hooks/md-softwrap.py --check docs/spec/timing.md` exits 0. Testing scope: none; a spec edit.

## Notes

- **Revision, 2026-11-16, on D-12.** Task 1's record found that no rule can meet D-11's float-error clause on the captured starts. The owner split the check in two (D-12). Task 2 is new and changes Plan 3's committed tests by that decision. It runs before the spec text is approved, because its result is part of the diagnosis. The old Task 2 is now Task 3, unchanged.

- **Revision, 2026-11-16, on D-10.** The plan review's two HIGH findings were on Plan 2's old Task 3: its `position` fit assumed independent Status residuals, which are autocorrelated (lag-1 0.57 to 0.61), so it cannot carry one-frame comparisons; and no task compared lag across join points (AC5). The owner ruled (D-10) that the fit is dropped as the tests' clock. This plan changes only where it cited that: the diagnosis reads lag against each stream's heard clock, not Status `position`; the measurement it rests on is Plan 2's Task 3; Task 1 reads `streams.js` and the measurement script and lists D-10.
- Plan 5 is revised against `.planning/phases/7/DESIGN.md` once the owner approves this plan's spec text, before Plan 5 is dispatched. Its leases and task boundaries then follow the design's split and its list of pins. Plan 5's current file list assumes the decision stays in `hqptuner/static/model/gauges/playhead.js` and is applied in `hqptuner/static/store/meter/loop.js`; a decision or an input anywhere else (a new model module, or arrival times stamped in `hqptuner/static/store/meter/feed.js`) is added to its leases in that revision.
