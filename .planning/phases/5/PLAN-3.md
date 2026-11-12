---
phase: 5
plan: 3
requirements: [TEST-01]
files:
  - tests/js/store/live/health.test.js
  - tests/js/lib/coerce.test.js
  - tests/js/lib/wav.test.js
  - tests/js/lib/no-copy-assertions-rule.test.js
---

# Phase 5: Untested behaviors covered - Plan 3: Health alerts and lib readers

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the `store/health.js` speed-alert bullet and the two `lib` bullets (`wireNum`, `wavRateFromHeader`, the no-copy rule's seeded literal).

## Must be true when done

- The slow-speed alert waits six seconds on the clock, and recovery, a stop and an unusable reading each start that wait over; a test fails when any of these breaks.
- A speed at the warn threshold raises no warning while one under it does, and a low buffer with a healthy speed raises no alert.
- `wireNum("0", d)` reads 0 while `""` reads `d`; a corrupted RIFF tag reads no rate; the no-copy rule does not report a literal composed of in-tests seeds.
- Each new test was seen red against a deliberate break of the line it covers, the break reverted, and no existing assertion line changed.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: a negative claim (raises nothing, reads none) gets a test only when it fails against the named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate. Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run as the claim's coverage, in the commit message or, when nothing is committed, the plan summary.
- D-06: health runs on the suite's existing fake clock (`initHealth(fake.clock)`, `SUSTAIN_MS = 6000`); no production clock change. D-10: one assertion per test, the assertion-shape and no-copy rules, jscpd at 2.3% over `tests/`: repeated setup is factored into a helper inside the same test file.
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4). Read `docs/spec/testing.md` before writing a test.

## Tasks

### Task 1: Pin the slow-speed alert holding off for the full six-second wait

- **Files:** tests/js/store/live/health.test.js
- **Reads:** hqptuner/static/store/health.js#waitOut, hqptuner/static/store/health.js#initHealth, tests/js/store/live/health.test.js#hold
- **Decisions:** D-01, D-02, D-04, D-06, D-10
- **Pins:** tests/js/store/live/health.test.js
- **Action:** Behavior: a speed held under a threshold for just short of the six-second wait raises no alert; it kills an alert that fires at once. The existing positive cases (`test_a_sustained_slow_speed_warns`, the critical case, the not-ready phases) stay as they are and are its contrast. Every "for N ms" is a reading of the fake clock, moved with `fake.advance`; every poll is a fresh object (the suite header's hazards).
- **Verify:** The health test file passes under the plan's gate. Lowering `SUSTAIN_MS` to 0 turns the new test red on an assertion, and is reverted.

### Task 2: Pin what starts the slow-speed wait over

- **Files:** tests/js/store/live/health.test.js
- **Reads:** hqptuner/static/store/health.js#waitOut, hqptuner/static/store/health.js#belowThresholds, hqptuner/static/store/health.js#usableSpeed, tests/js/store/live/health.test.js#hold
- **Decisions:** D-01, D-02, D-04, D-06, D-10
- **Pins:** tests/js/store/live/health.test.js
- **Action:** Behavior: the wait starts over on any frame that does not qualify, so the alert needs a full wait after the next slow frame. Three triggers, three cases: a recovering frame mid-wait (kills a wait that keeps running across a recovery); the engine stopping mid-wait; an unusable speed reading (0, negative or unparseable) mid-wait, which also never itself trips the alert (kills an unusable reading read as slow). Every "for N ms" is a reading of the fake clock, moved with `fake.advance`; every poll is a fresh object (the suite header's hazards).
- **Verify:** The health test file passes under the plan's gate. Breaks, each alone: `waitOut` no longer canceling on a non-qualifying frame; `belowThresholds` ignoring `playing`; `usableSpeed` returning true for every number. Each turns its matching new test red on an assertion and is reverted. Testing stops at these three triggers.

### Task 3: Pin the warn threshold's boundary

- **Files:** tests/js/store/live/health.test.js
- **Reads:** hqptuner/static/store/health.js#SPEED_WARN, hqptuner/static/store/health.js#belowThresholds, tests/js/store/live/health.test.js#test_the_critical_threshold_is_exclusive
- **Decisions:** D-02, D-04, D-06, D-10
- **Pins:** tests/js/store/live/health.test.js#test_the_critical_threshold_is_exclusive
- **Action:** Behavior: a speed held at the warn threshold raises no warning, and one held just under it does. The critical side of "warn vs critical" is already pinned by `test_the_critical_threshold_is_exclusive` and `test_a_sustained_below_realtime_speed_is_critical`; this task adds only the warn boundary, as a pair whose two results differ (rule 10: two observations on one surface, not one lookup).
- **Verify:** The health test file passes under the plan's gate. Breaking `warn: speedOk && sp < SPEED_WARN` to `<=` turns the at-threshold case red on an assertion, and raising `SPEED_WARN` past the just-under value turns the other red; both are reverted.

### Task 4: Pin that a low buffer alone raises nothing

- **Files:** tests/js/store/live/health.test.js
- **Reads:** hqptuner/static/store/health.js#outputBufferApplies, hqptuner/static/store/health.js#engineAlerts
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/live/health.test.js#test_output_buffer_does_not_apply_until_a_positive_fill_is_seen
- **Action:** Behavior: a playing engine at a healthy speed whose output fill (or input fill) sits low, held past the speed wait, raises no alert. The plausible wrong implementation it kills is the one the module's own comment rules out: a sustained-low "starvation" alert. The case must first prove the buffer applies (a positive fill seen this track), so the low reading is a real low and not a non-applying buffer.
- **Verify:** The health test file passes under the plan's gate. Adding a starvation alert to `engineAlerts` (any alert raised while `output_fill` is under, say, 0.2 on an applying buffer) turns the case red on an assertion, and is reverted.

### Task 5: Pin wireNum keeping a wire 0

- **Files:** tests/js/lib/coerce.test.js
- **Reads:** hqptuner/static/lib/coerce.js#wireNum, hqptuner/static/lib/coerce.js#isBlank
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/lib/coerce.test.js#test_a_blank_value_falls_back_to_the_default
- **Action:** Behavior: a wire value of `"0"` reads as 0, not as the caller's default, while `""` reads as the default (already pinned by `test_a_blank_value_falls_back_to_the_default`). The plausible wrong implementation named in the CONTEXT flagged assumptions is `Number(v) || d`.
- **Verify:** The coerce test file passes under the plan's gate. Replacing `wireNum`'s body with `Number(v) || d` turns the new case red on an assertion, and is reverted.

### Task 6: Pin wavRateFromHeader refusing a corrupted RIFF tag

- **Files:** tests/js/lib/wav.test.js
- **Reads:** hqptuner/static/lib/wav.js#wavRateFromHeader, tests/js/lib/wav.test.js#wavHeader
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/lib/wav.test.js
- **Action:** Behavior: a header whose RIFF tag is corrupted, with an otherwise valid fmt chunk, reads no rate. The wrong implementation it kills skips the RIFF check and reads the fmt rate anyway; the file's existing rate case is the contrast that makes the null discriminating. The file header already promises this case.
- **Verify:** The wav test file passes under the plan's gate. Removing the `0x52494646` comparison from `wavRateFromHeader` turns the new case red on an assertion, and is reverted.

### Task 7: Pin the no-copy rule leaving an in-tests composed literal alone

- **Files:** tests/js/lib/no-copy-assertions-rule.test.js
- **Reads:** eslint-rules/no-copy-assertions.js, tests/js/lib/no-copy-assertions-rule.test.js#seedFixture
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/lib/no-copy-assertions-rule.test.js
- **Action:** Behavior: with the seed import from under `tests/` in place, a literal composed of those seeds is not reported. The wrong implementation it kills ignores in-tests seeds when judging a composed literal; the existing "without the seed import a literal composed of the seeds is reported once" case is its contrast. Use the file's `seedFixture` and `reportedLines`; assert on line numbers, never the rule's wording.
- **Verify:** The rule test file passes under the plan's gate. Breaking the rule so seeds imported from `tests/` no longer cover a composed literal turns the new case red on an assertion, and is reverted (`git diff --quiet -- eslint-rules/no-copy-assertions.js`). `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
