---
phase: 7
plan: 3
depends_on: [2]
requirements: []
files:
  - tests/js/contracts/schedules.js
  - tests/js/contracts/streams.js
  - tests/js/contracts/smooth-probes.js
  - tests/js/contracts/steady-lag.test.js
  - tests/js/contracts/steady-motion.test.js
  - tests/js/contracts/steady-spectrogram.test.js
  - tests/support/fixtures/meter_start_capture_3.json
  - scripts/probes/meter/arrival_patterns.py
---

# Phase 7: Visuals stay in sync after a track starts - Plan 3: Made-up streams, steady motion and steady spectrogram, red against today's code

## Goal

After a track starts, the visuals keep the same lag behind the sound that they hold for the rest of the track, whatever the track's sample rate. Plan 2 committed the second capture, measured how the data arrives in both captures, and wrote the steady-lag suite on streams that reproduce those patterns. This plan adds the made-up bursty and drifting streams, writes the steady-motion and steady-spectrogram suites, and shows D-08's three smoothness behaviors red against the code as it stands (AC8); Plan 5's fix makes them pass unedited (AC9).

## Must be true when done

- Three test suites state, in the owner's terms, steady lag, steady motion and steady spectrogram, and each replays Plan 2's streams measured from both live captures and made-up bursty and drifting streams, each with a heard clock known to the sample, through the app's own feed store, meter loop, spectrogram history and Source drawer painter.
- Run against today's code, each of the three suites fails on an assertion, never on an import or a collection error, on at least one replay, and each failing case names the replay and the paint where the behavior broke.
- Nothing under `hqptuner/` changed, and the existing contract suites under `tests/js/contracts/` pass unedited.
- `scripts/gate.sh make check` fails only on the new smoothness tests; every lint gate, and every other test, is green.
- The three suites and their support files are committed while red, as D-09 (b) decided, each task in its own commit.

## Context

- D-08 binds every task: general tests, no assumption about the cause, red against today's code by `docs/spec/testing.md` rule 8, then the fix. The plan names the behaviors; the unit, the lane, the assertions and every value are the test writer's (repo `CLAUDE.md`). The three behaviors are three results (rule 17): the lag is a level read at each paint, the motion is the move each paint makes against the music's progress over its own wall time, and the spectrogram's scroll is read off its picture. Each gets its own suite.
- D-10 binds every task and amends D-08 and D-09 (a): what is heard is each stream's own heard clock, known to the sample from how the stream is generated, never a Status `position` fit and never the stream's own `at`/`n` count.
- D-09 (b) binds every task: the suites are committed while red, before the fix lands. The authorization covers the test files of Plans 2 and 3 only (`streams.js`, `smooth-probes.js` and the three `steady-*.test.js` suites), and only their failing tests; every lint gate and every other test stays green in each commit. It ends when Plan 5's fix makes them pass.
- Plan 2 built what this plan extends: the replay world (its Task 1), the second capture (its Task 2), the arrival measurement `scripts/probes/meter/arrival_patterns.py` (its Task 3, whose output this plan's Task 1 draws its sizes from), and `streams.js`, `smooth-probes.js` and `steady-lag.test.js` with the measured-pattern streams and their heard clock (its Task 4) and the lag compared across starts, rates and join points (its Task 5). The new suites follow `trace-and-meters.test.js` and `spectrogram-picture.test.js`: replay each stream once, then every test reads one finding of it.
- Already covered, so not restated (rule 12): contract 1 (each paint moves the playhead its wall time unless it stands at the newest end, never past it, never backward), contract 2 (over a run the picture moves left as far as the playhead's advance, within one column), contracts 3, 4, 6 and 7. Contract 1 allows the playhead to stand at the newest end, which D-08's steady motion forbids outside a real break; that difference is where steady motion bites.
- Out of scope: any change under `hqptuner/`, any edit to a capture fixture once committed, any filter measurement.
- `tests/js/contracts/` holds 9 files and the directory cap is 15; Plan 2 adds 3 and this plan adds 2, leaving 1.

## Tasks

### Task 1: Steady lag on made-up bursty and drifting streams

- **Files:** tests/js/contracts/streams.js, tests/js/contracts/smooth-probes.js, tests/js/contracts/steady-lag.test.js, tests/js/contracts/schedules.js
- **Reads:** tests/js/contracts/streams.js, tests/js/contracts/schedules.js#bursts, tests/js/contracts/schedules.js#SCHEDULES, scripts/probes/meter/arrival_patterns.py, .planning/phases/7/CAPTURE.md, docs/spec/timing.md#Measured facts
- **Decisions:** D-08, D-10
- **Action:** Add the made-up streams to `streams.js`, so the steady-lag suite replays them beside Plan 2's measured-pattern streams.
  - **What is heard.** In a made-up stream, what is heard is the playback clock the stream itself is generated from; the header says so for each stream. The stream rules of Plan 2's Task 4 hold: one rule places the heard clock against the stamps for every start, and Status goes out at the app's read cadence and the engine's measured grain.
  - **Made-up bursty streams.** Bursts land early and late against the music. A backlog lands ahead of wall time over an opening stretch after a start and then holds its lead, the shape the captures show after each rate change. The streams run at more than one metering rate, with a rate change, a start from stopped and a gapless same-rate track change. Frame lengths are inside the measured range and change mid-feed (`docs/spec/timing.md` Rule 11).
  - **Made-up drifting streams.** Over a whole track, the stamps run faster than the music heard in one stream and slower in another. The drift each capture shows at 44100 as Plan 2's Task 3 prints it (446 ms over 170 s on the first) gives the measured sizes to draw from, cited in the header with the command line, as Plan 2's Task 4 cites its values.
  - Touch `steady-lag.test.js` or `smooth-probes.js` only if a made-up stream needs a reading Plan 2's Tasks 4 and 5 did not add, and say which in the commit message. Touch `schedules.js` only to export a generator instead of copying it. The constraints of Plan 2's Task 4 hold.
  - **If the suite is green on every replay against today's code,** stop and report the readings to the owner. Never reshape a stream, a tolerance or the opening stretch to turn it red.
  - **Commit** while the suite is red (D-09 (b)).
- **Verify:** Run `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/steady-lag.test.js` against today's code. It prints a non-zero exit. Every failure in its log is an `AssertionError` naming a replay; none is an import, a collection or a type error. The log's test names include each bursty and each drifting stream. `git diff --quiet <pre-plan HEAD> HEAD -- hqptuner/ tests/support/fixtures/` exits 0. `scripts/gate.sh make lint-js` prints `exit=0`.
  - Testing scope. Outcomes: the lag holds through bursty and drifting arrivals.
  - Already covered: the measured-pattern streams (Plan 2's Tasks 4 and 5).
  - Smallest checks: the same lag reading per added stream, no new reading unless a stream needs one.
  - Sufficient evidence: the red run with assertion failures only. Testing stops there.

### Task 2: Steady motion

- **Files:** tests/js/contracts/steady-motion.test.js, tests/js/contracts/smooth-probes.js, tests/js/contracts/streams.js
- **Reads:** tests/js/contracts/streams.js, tests/js/contracts/trace-probes.js#wallProbe, tests/js/contracts/trace-and-meters.test.js, hqptuner/static/model/gauges/playhead.js#pacePaint
- **Decisions:** D-08, D-09
- **Action:** Write the suite for D-08 (2), on the streams of Plan 2's Task 4 and this plan's Task 1, with the music heard as each stream's own heard clock gives it:
  - **The behavior.** Each paint shows the moment of playback its own wall time calls for. Over a paint, the playhead moves as far as the music heard moves over that paint's wall time. The music heard over a paint is read off the stream's heard clock, never off the stream's Status `position`, whose 107 to 320 ms steps would fail a playhead that moves smoothly. It never freezes while the music moves, never jumps ahead and never steps back. The one exception is a real break such as a stop or a seek: in these replays, the stops the Status samples show, and the breaks the feed store marks after them. This is a different result from steady lag: lag is a level, and motion is each paint's move, so a playhead can hold its lag within a frame and still freeze, or stutter.
  - **Already covered.** Contract 1 (`wallProbe`) checks each move against wall `dt` and lets the playhead stand at the newest end. This suite reads the move against the music heard, and allows no standing outside a real break. Do not restate `wallProbe`. Add a stream to `streams.js` only if steady motion needs a shape the streams of Plan 2's Task 4 and this plan's Task 1 lack, and say which in the commit message.
  - **Constraints.** As in Plan 2's Task 4: one assertion per test, each stream replayed once, this suite's own readings added to `smooth-probes.js` and no unused one, no copied blocks, the suite's time reported.
  - **If the suite is green on every replay against today's code,** stop and report the readings to the owner; do not reshape anything to turn it red.
  - **Commit** while the suite is red (D-09 (b)).
  - **Owner ruling, 2026-11-16 (D-11).** The suite came back green on all 189 tests against today's code. The owner keeps it as written and it commits green: it pins a real contract, and the defect is lag, not motion. The red-run verify below is waived for this task only.
- **Verify:** Run `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/steady-motion.test.js` against today's code. It prints a non-zero exit, and every failure is an `AssertionError` naming a replay and a paint (waived by the owner ruling above: it exits 0). `git diff --quiet <pre-plan HEAD> HEAD -- hqptuner/` exits 0. `scripts/gate.sh make lint-js` prints `exit=0`.
  - Testing scope. Outcomes: no freeze, no jump ahead and no step back outside a real break, on every stream.
  - Already covered: the wall-speed move and never-backward (contract 1).
  - Smallest checks: one motion reading per stream, the real breaks taken from the stream's own Status and feed marks.
  - Testing stops at the red run.

### Task 3: Steady spectrogram

- **Files:** tests/js/contracts/steady-spectrogram.test.js, tests/js/contracts/smooth-probes.js
- **Reads:** tests/js/contracts/picture-probes.js#scrollProbe, tests/js/contracts/spectrogram-picture.test.js, tests/js/contracts/picture.js, tests/js/contracts/streams.js, hqptuner/static/store/meter/spectrogram.js#spectrogramRange
- **Decisions:** D-08, D-09
- **Action:** Write the suite for D-08 (3), on the streams of Plan 2's Task 4 and this plan's Task 1, with the music heard as each stream's heard clock gives it:
  - **The behavior.** The spectrogram scrolls at a constant rate in playback time, with no stalls and no catch-up bursts. Read it off the picture the Source drawer's real painter draws, never off the playhead signal, so this suite can fail where steady motion passes: a history that falls behind or clears while the playhead moves, or a picture that holds and then jumps.
  - **Already covered.** Contract 2 (`scrollProbe`) sums the scroll over a whole run against the playhead's advance. This suite reads it paint by paint, against the playback time each paint covers.
  - **If no plausible wrong implementation** fails this suite and passes Task 2's, the two are one test (rule 12). Then write no duplicate: stop and report that to the owner.
  - **Constraints.** As in Plan 2's Task 4, this suite's own readings added to `smooth-probes.js` and no unused one. The picture replay costs the most, so report the suite's time.
  - **If the suite is green on every replay against today's code,** stop and report the readings to the owner.
  - **Commit** while the suite is red (D-09 (b)).
  - **Owner ruling, 2026-11-16.** The suite came back green on all 189 tests against today's code (17106 paints, no stall, no burst). The owner keeps it as written and it commits green, as Task 2 did under D-11: it guards the picture, which steady motion does not read. The red-run verify below is waived for this task only.
- **Verify:** Run `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/steady-spectrogram.test.js` against today's code. It prints a non-zero exit, and every failure is an `AssertionError` naming a replay and a paint (waived by the owner ruling above: it exits 0). Then `scripts/gate.sh make check` fails, and the failures its log lists are all in `steady-lag.test.js`, `steady-motion.test.js` and `steady-spectrogram.test.js`; every lint gate and every other test passes. `git diff --name-only --diff-filter=M <pre-plan HEAD> HEAD -- hqptuner/ 'tests/js/contracts/*.test.js' ':!tests/js/contracts/steady-lag.test.js'` prints nothing; the two new suites are added files, and `steady-lag.test.js` is Plan 2's, which Task 1 may extend.
  - Testing scope. Outcomes: no stall and no catch-up burst in the picture, on every stream.
  - Already covered: scroll over a run (contract 2), and the picture's consistency (contracts 3 and 7).
  - Smallest checks: one per-paint scroll reading per stream.
  - Testing stops at the red run and the `make check` readout.

### Task 4: A frame lands at the same moment whatever the source rate

- **The third capture is on disk,** `tests/support/fixtures/meter_start_capture_3.json`, made by the owner on 2026-11-16 (`scripts/probes/meter/capture_meter_start.py held 240 0.69`, exit 0, one connection, ended by window, 33402 frames, 1180 Status samples). It holds a 192000 start from stopped, a change to 44100, a change back to 192000 and a gapless 192000 track change. It is complete; commit it as captured.
- **Files:** tests/support/fixtures/meter_start_capture_3.json, scripts/probes/meter/arrival_patterns.py, tests/js/contracts/streams.js, tests/js/contracts/steady-lag.test.js, tests/js/contracts/smooth-probes.js
- **Reads:** tests/support/fixtures/meter_start_capture_3.json, scripts/probes/meter/arrival_patterns.py, tests/js/contracts/streams.js, tests/js/contracts/steady-lag.test.js
- **Decisions:** D-08, D-09, D-10, D-11
- **Action:** Commit the third capture as the owner captured it, in its own commit. Then measure it with `scripts/probes/meter/arrival_patterns.py` and add streams reproducing its 192000 arrival patterns, as Plan 2's Task 4 did for the first two captures, with the measured values and the command line cited in the `streams.js` header.
  - **The measurement script crashes on this capture.** `arrival_patterns.py` prints every start and then stops in `print_drift` with `ZeroDivisionError: division by zero` (`return (cap.pb[b] - cap.pb[a]) / (cap.t[b] - cap.t[a])`). Fix it in its own commit before measuring, so it still reproduces CAPTURE.md's figures on the first capture.
  - **The behavior (D-11).** When a frame lands on screen does not depend on the source rate. A frame of a 44100 track and a frame of a 192000 track land at exactly the same moment relative to when they are heard: the lag after a start at one rate equals the lag at every other rate, within floating-point error, on every stream, both directions of every rate change.
  - **Already covered.** Plan 2's Task 5 compares lag across a rate change within one metering frame of the finer rate. D-11 replaces that tolerance for the comparison across rates; the comparisons across starts at one rate and across join points are not changed by this task.
  - `tests/js/contracts/` has one slot left under its cap, so extend the existing files rather than adding one.
  - **If the comparison is green on every replay against today's code,** stop and report the readings to the owner. Never reshape a stream or a tolerance to turn it red.
  - **Commit** while red (D-09 (b)).
- **Verify:** `git show --stat --format=` on the capture commit lists the fixture alone. Run `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/steady-lag.test.js` against today's code: it prints a non-zero exit, every failure is an `AssertionError` naming a replay and the rates compared, and the log's test names include a 192000 stream. `git diff --quiet <pre-plan HEAD> HEAD -- hqptuner/` exits 0. `scripts/gate.sh make lint-js` prints `exit=0`.
  - Testing scope. Outcomes: the lag is the same at every source rate, exactly.
  - Already covered: lag steady within a track, across starts and joins (Plan 2's Tasks 4 and 5).
  - Testing stops at the red run.

## Notes

- **Split, 2026-11-16.** This plan's three tasks were Tasks 4 to 6 of Plan 2, moved here unchanged except for their numbers and cross-references, because Plan 2's brief was 41921 bytes against the 32768-byte ceiling. Plan 2 keeps the capture-backed work (the replay world, the second capture, the arrival measurement and steady lag on the measured-pattern streams). This plan holds the work that rests on what Plan 2 built: made-up streams whose heard clock is generated, and the motion and spectrogram suites that read every stream. Plan 2's Tasks 4 and 5 hold no stop rule for a green suite; this plan's Task 1 holds the stop rule for the whole steady-lag suite.
- **Revision, 2026-11-16, on D-10.** The plan review's two HIGH findings were on Plan 2's old Task 3: its `position` fit's intercept error assumed independent Status residuals, which are autocorrelated (lag-1 0.57 to 0.61), so the fit cannot carry one-frame comparisons; and no task compared lag across join points (AC5). The owner ruled (D-10) that the fit is dropped as the tests' clock. This plan's changes follow from that: the D-09 (a) context and the fitted-line note are removed, steady motion reads the music heard off each stream's heard clock instead of the fitted line, Task 1 draws its drift sizes from Plan 2's Task 3 measurement and keeps Plan 2's stream rules, every reference to Plan 2's old Task 3 now names its Task 4 or 5, and Task 1's lease adds `schedules.js` for a shared generator. The stop rule for a green suite and the never-reshape rule are unchanged. Task 3's final diff check now leaves out `steady-lag.test.js`, which Task 1 may extend.
- **Red commits (D-09 (b)).** Tasks 1 to 3 commit their suites red, as Plan 2's Task 3 does; the owner decided this, as an exception to `~/dev/CLAUDE.md` 11.4 and the repo's "`make check` green before every commit" for these test files only. Plan 5's AC9 check is a diff against these commits.
