---
phase: 7
plan: 5
depends_on: [1, 2, 3, 4]
requirements: []
files:
  - hqptuner/static/model/gauges/playhead.js
  - hqptuner/static/store/meter/loop.js
  - tests/js/model/gauges/playhead.test.js
  - tests/js/store/meter/loop.test.js
  - tests/js/contracts/trace-and-meters.test.js
  - tests/js/contracts/trace-probes.js
  - tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py
---

# Phase 7: Visuals stay in sync after a track starts - Plan 5: The one playhead follows the approved rule

## Goal

After a track starts, the visuals keep the same lag behind the sound that they hold for the rest of the track, whatever the track's sample rate. This plan is the fix: the one playhead follows the rule the owner approved in Plan 4. The smoothness tests of Plans 2 and 3 pass with no edit (AC9), and the gate is green (AC7).

## Must be true when done

- With music playing at the hand-back URL, after a start from stopped, a same-rate track change and a rate change, at two sample rates, the owner sees the meters, the spectrum and the spectrogram hold the same lag behind the sound right after the start as later in the track (AC6).
- The three smoothness suites of Plans 2 and 3 pass, and none of their files, nor `streams.js` or `smooth-probes.js`, changed since the commits of Plans 2 and 3.
- Every rewritten test that pins the old rule was red against the pre-change code by assertion, and states the approved rule.
- `scripts/gate.sh make check` prints `exit=0`.

## Context

- **This plan is revised against `.planning/phases/7/DESIGN.md` before it is dispatched,** once the owner has approved Plan 4's spec text. The revision sets each task's lease and boundary from the design's split and its list of pins. The leases below are what the design is expected to name; no task widens its lease mid-run.
- The rule is `docs/spec/timing.md` as Plan 4 left it, and the split and the list of pins are in `.planning/phases/7/DESIGN.md`. Nothing beyond the design is built: no per-rate offset, no per-view correction, one playhead (D-02).
- D-06: a fix that moves the anchor or adds a correction rewrites the pins that hold today's rule, each rewrite red against the old code. The design record names the full list.
- D-09 (b): the suites of Plans 2 and 3 were committed red, and that authorization ends when this plan's fix makes them pass. It covers no other test: every commit here is green on every other test and gate, `make test-e2e` included.
- The pin rewrites land in the same commit as the loop change that breaks them. The old pins fail the moment the loop applies the new rule, so splitting them from it would commit a red gate. That is why this plan holds both, against the usual split of putting pins in a plan of their own.
- No `CHANGELOG.md` entry: the v2 changelog is the owner's alone. Any user-facing text the change touches needs the owner's approval first (copy rules); the design record names none.

## Tasks

### Task 1: The approved rule's pure decisions, pinned at the model lane

- **Files:** hqptuner/static/model/gauges/playhead.js, tests/js/model/gauges/playhead.test.js
- **Reads:** .planning/phases/7/DESIGN.md, docs/spec/timing.md#The two clocks, docs/spec/timing.md#Rules, hqptuner/static/model/gauges/playhead.js#pacePaint, hqptuner/static/model/gauges/playhead.js#restartAt
- **Decisions:** D-01, D-02, D-08
- **Pins:** tests/js/model/gauges/playhead.test.js
- **Action:**
  - **Tests first.** For each new decision the design's split names, write its cases in `playhead.test.js`, asserting the value the split gives it. The unit, the assertion and the values are the test writer's. Each new decision is a new surface, so the red run is against its null stub (`docs/spec/testing.md` rule 8): the pre-change `playhead.js` with each new decision added as the export the design's split names, its body returning the zero value of the result type the split gives it and nothing more. Each case fails against that stub by `AssertionError`. A case green against the stub asserts what the absent decision also returns (rule 10): report it, and do not reshape it to turn it red. The stub is the red run's only edit to `playhead.js` and is replaced by the real decision in the same task.
  - **Then the code.** Each new decision becomes a pure function in `playhead.js`, exported beside today's `pacePaint`, which the loop still calls unchanged. The loop runs today's rule after this task, so every store and contract pin stays green. Retiring the parts of `pacePaint` the rule replaces is Task 2's.
  - **Constraints.** Model code reads no clock (Rules 6 and 10). Each decision allocates nothing per call (Rule 9).
  - If the design changes `pacePaint` in place and adds no decision beside it, this task has nothing to land, and the revision before dispatch folds it into Task 2.
  - Run `filepawl accept` whenever filepawl prints it.
- **Verify:** The executor's record names the null stub of each new decision (export name and the zero value it returns), and shows each new case failing by `AssertionError` against the pre-change `playhead.js` plus those stubs, tests kept. An import, missing-export, collection or type error counts as no red run: the case is run again against its stub, and if it then passes it is reported green, never reshaped. Then `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/playhead.test.js` prints `exit=0`. `git diff --quiet -- hqptuner/static/store/` exits 0. `scripts/gate.sh make check` fails only in the three `steady-*.test.js` suites of Plans 2 and 3.
  - Testing scope. Outcomes: each new decision returns the value the design's split gives it. Already covered: today's `pacePaint` cases, untouched here. Smallest check: one case per new decision. Sufficient evidence: the red run and the green run. Testing stops there.

### Task 2: The loop applies the approved rule, with every pin it breaks rewritten

- **Files:** hqptuner/static/model/gauges/playhead.js, hqptuner/static/store/meter/loop.js, tests/js/model/gauges/playhead.test.js, tests/js/store/meter/loop.test.js, tests/js/contracts/trace-and-meters.test.js, tests/js/contracts/trace-probes.js, tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py
- **Reads:** .planning/phases/7/DESIGN.md, docs/spec/timing.md#The two clocks, docs/spec/timing.md#Rules, hqptuner/static/model/gauges/playhead.js#pacePaint, hqptuner/static/store/meter/loop.js#paint, hqptuner/static/store/meter/loop.js#apply, hqptuner/static/store/meter/loop.js#reset, tests/js/contracts/trace-probes.js#wallProbe
- **Decisions:** D-01, D-02, D-06, D-08, D-09
- **Pins:** tests/js/model/gauges/playhead.test.js, tests/js/store/meter/loop.test.js, tests/js/contracts/trace-and-meters.test.js, tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py, tests/js/contracts/steady-lag.test.js, tests/js/contracts/steady-motion.test.js, tests/js/contracts/steady-spectrogram.test.js
- **Action:**
  - **Tests first.** Rewrite each pin the design record lists as holding today's rule, so it states the approved rule in its place: the D-06 cases in `playhead.test.js` and `loop.test.js`, contract 1 with `wallProbe`, and the e2e wall-time scroll cap, as far as the design lists each. Write each new store case the split calls for. Run them against the code as Task 1 left it: each rewritten or new case fails on an assertion. A case green there is no bite: report it, and do not reshape it to turn it red.
  - **Then the code.** `hqptuner/static/store/meter/loop.js` hands the decisions their inputs and applies what they return. The parts of `pacePaint` the rule replaces are retired, with no forwarder left behind. Both modules' header comments describe the approved rule; they are the design record in the code, so leave no sentence of the old rule standing.
  - **One commit.** The code change and every pin rewrite land in one commit, because the old pins fail the moment the loop applies the new rule.
  - **Constraints.** Model code reads no clock, and the loop stays the one `requestAnimationFrame`. Work per paint stays bounded and allocates nothing per paint (Rule 9). A break still restarts every view of playback, and nothing smooths across one (Rule 3).
  - **What stays unedited.** The suites of Plans 2 and 3, `tests/js/contracts/streams.js` and `tests/js/contracts/smooth-probes.js` are not touched. A test of Plans 2 and 3 still red after the code has two outcomes: fix the code, or take the plan back to the owner with the failing line.
  - **What stops the task.** A test outside this lease that turns red under the change is not edited. Stop and report it, since the lease came from the design record and a pin it missed is a planning gap. If the design needs a file outside this lease, stop for a plan revision; do not widen the lease mid-task. Run `filepawl accept` whenever filepawl prints it.
- **Verify:**
  - **Red run.** The executor's record shows each rewritten and new case failing by `AssertionError` against `playhead.js` and `loop.js` as Task 1 left them, with the implementation reverted to that commit and the tests kept. A case that reaches a store surface not present at that commit fails against the null stub of it the design's split names (the export present, returning its zero value), never at a missing export, which is no evidence of bite (`docs/spec/testing.md` rule 8).
  - **Plan 2 and 3 files unedited.** `git diff --quiet <Plan 3's last commit> -- tests/js/contracts/streams.js tests/js/contracts/smooth-probes.js tests/js/contracts/steady-lag.test.js tests/js/contracts/steady-motion.test.js tests/js/contracts/steady-spectrogram.test.js` exits 0 (AC9).
  - **Gates.** `scripts/gate.sh make check` prints `exit=0` (AC7). `scripts/gate.sh .venv/bin/pytest tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py -q` prints `exit=0`; it needs headless chromium, so probe for it first, and if it is missing, this check becomes a human-verify run of `make test-e2e` by the owner, before the commit.
  - **Rebuild.** `bash .claude/task-check.sh` passes: make check, a rebuilt `hqptuner:dev` and a healthy `:8090`. The container rebuild can hold a full core for more than 10 s, so name it before it runs (`~/dev/CLAUDE.md` 3.1).
  - **Testing scope.** Outcomes: the three smoothness behaviors on every replay of Plans 2 and 3, already written. Already covered: the new decisions, pinned in Task 1. Smallest addition: the rewritten pins and one case per new store decision the design names. Sufficient evidence: the red run, the unedited suites of Plans 2 and 3 passing, and `make check` green. Testing stops there.
  - **human-verify (AC6).** At the hand-back URL from the host skill, the owner plays tracks at two sample rates, with a start from stopped, a same-rate track change and a rate change. The owner sees the meters, the spectrum and the spectrogram hold the same lag behind the sound right after each start as later in the track, and move smoothly throughout.

## Notes

- The leases here are the files the design record is expected to name. Plan 4's Notes and this plan's Context say when they are revised: once DESIGN.md is approved, before dispatch.
- The e2e pin stays in Task 2, not a task of its own. Its rewrite fails against today's rule and the old version fails against the new one, so either commit order leaves `make test-e2e` red at one commit, and D-09 (b) authorizes no red test outside the suites of Plans 2 and 3.
- Late-connect timing (D-02) is covered by Plan 2's late-join replay, on its stated assumption, and by AC6 at the hand-back; no live late-connect run exists.
