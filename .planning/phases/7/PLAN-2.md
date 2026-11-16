---
phase: 7
plan: 2
depends_on: [1]
requirements: []
files:
  - tests/js/contracts/world.js
  - tests/js/contracts/schedules.js
  - tests/support/fixtures/meter_start_capture_2.json
  - scripts/probes/meter/arrival_patterns.py
  - tests/js/contracts/streams.js
  - tests/js/contracts/smooth-probes.js
  - tests/js/contracts/steady-lag.test.js
---

# Phase 7: Visuals stay in sync after a track starts - Plan 2: Steady lag on streams measured from the two captures

## Goal

After a track starts, the visuals keep the same lag behind the sound that they hold for the rest of the track, whatever the track's sample rate. This plan commits the second capture, measures from both captures how the data arrives around a track start, and writes the steady-lag suite of D-08's first smoothness behavior on replay streams that reproduce those measured patterns with a heard clock known to the sample (D-10). Plan 3 adds the made-up bursty and drifting streams and the other two behaviors, and shows all three red against today's code (AC8); Plan 5's fix makes them pass unedited (AC9).

## Must be true when done

- The second capture is committed with its parsed content as the owner captured it.
- One committed read-only command prints, from either capture, the arrival patterns the streams reproduce: the opening rush at each rate, the frame gaps at track changes, the drift in steady play at 44100, and what the app's reader does around each start. On the first capture it reproduces CAPTURE.md's figures.
- The steady-lag suite states steady lag in the owner's terms and replays, through the app's own feed store and meter loop, streams that reproduce those patterns. Each stream knows where its music is heard at every wall time, to the sample, from how it was generated, never from a Status `position` fit and never from the code under test.
- The suite compares the lag at one metering frame, never loosened: within each track after its opening stretch (AC3), across starts, across rates in both directions (44100 to 96000 and 96000 to 44100, AC4), and across join points inside the opening stretch of the same start (AC5).
- Every measured value a stream uses, and the command that printed it, is recorded in `streams.js`'s header.
- Run against today's code, every failure of the suite is an assertion naming its replay, never an import or a collection error.
- Nothing under `hqptuner/` changed, and the existing contract suites under `tests/js/contracts/` pass unedited. `scripts/gate.sh make check` fails on nothing but the steady-lag suite.
- The suite and its support files are committed while red, as D-09 (b) decided, each task in its own commit.

## Context

- D-08 binds every task, red by `docs/spec/testing.md` rule 8, then the fix. The plan names the behaviors; the unit, the lane, the assertions and every value are the test writer's (repo `CLAUDE.md`). The three behaviors are three results (rule 17), each with its own suite; this plan writes the steady-lag one.
- D-10 binds Tasks 3 to 5 and amends D-08 and D-09 (a): the tests' clock is each replay stream's own heard clock, known exactly. The captures are measured (Task 3), and the streams reproduce what was measured. Status `position` and `output_delay` may be read to measure the patterns; neither is the tests' clock.
- D-09 (b) binds every task: the suites are committed while red, before the fix lands. The authorization covers the test files of Plans 2 and 3 only (`streams.js`, `smooth-probes.js` and the three `steady-*.test.js` suites), and only their failing tests; every lint gate and every other test stays green in each commit. It ends when Plan 5's fix makes them pass.
- The harness exists: `tests/js/contracts/world.js` `replay` runs a schedule through the real stack on a virtual clock; it takes `geometry` (every geometry event, the first included, so `open` sends none), `status` (`{ t, fields }`) and a per-frame `at` (Task 1). The new suite follows `trace-and-meters.test.js`: replay each stream once, then every test reads one finding of it.
- Out of scope: any change under `hqptuner/`, any edit to the content of either capture fixture, the repo-root `spectstutter.json` and `fuckedspecrogram.jpg`, any filter measurement.
- `tests/js/contracts/` holds 9 files and the directory cap is 15; this plan adds 3 and Plan 3 adds 2, leaving 1.

## Tasks

### Task 1: The replay world carries rate changes and the engine's Status (done, af639b46)

- **Files:** tests/js/contracts/world.js, tests/js/contracts/schedules.js
- **Reads:** tests/js/contracts/world.js#replay, tests/js/contracts/world.js#open, tests/js/contracts/schedules.js#Schedule, tests/js/support/apodpolls.js#poll, tests/js/support/apodpolls.js#newTrack, hqptuner/static/store/meter/feed.js#decode, hqptuner/static/store/meter/delay.js#effectiveDelay, hqptuner/static/store/signals.js#enginePlaying, hqptuner/static/store/meter/spectrogram.js#initSpectrogram, hqptuner/engine/meterfeed.py#reset
- **Decisions:** D-03, D-04, D-08
- **Action:** Today `replay` sends one `geometry` event before the first paint, stamps each frame from a running count of its `n` at one rate, and holds the engine's Status at one playing poll, so the delay is the user's offset alone. Make it able to replay a stream that also carries the following, each entering the page through the same feed-store path the page's own stream takes. Which arrivals a stream holds, and how faithful they are to what the owner's page receives, is the stream's to state (Task 4), not the harness's:
  - **Geometry events mid-stream**, at their arrival times, so a rate change reaches the feed store as the wire sends it. A server reader's reconnect reaches the page the same way, as `MeterFeed.reset` in `hqptuner/engine/meterfeed.py` makes it: a geometry event, then stamps counting from 0. The replay sends it as exactly that and adds no other signal.
  - **The stream's own stamps.** A stream that gives each frame its `at` and `n` (the capture does) is sent with them. The frames the replay hands back carry playback ms at the rate of the geometry they arrived under, read from the wire stamps, as `decode` in `hqptuner/static/store/meter/feed.js` converts them.
  - **Status samples at their times**, through the Status signal the suite already drives (`poll` in `tests/js/support/apodpolls.js`, or `engineStatus`), with at least `state`, `track_serial`, `position` and `output_delay`. The loop then stops and starts where the engine's state does, and the effective delay is the engine's reported delay plus the user's offset, as `effectiveDelay` computes it.
  - The existing schedules replay exactly as they do now: every existing contract suite passes with no edit to any `*.test.js` file. Extend the `Schedule` type in `schedules.js` only as far as the new fields need.
  - Keep `world.js` free of `test()` and `assert` and reading no clock, as its header says. Add no export no test uses yet (knip covers `tests/js/`).
- **Verify:** `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/trace-and-meters.test.js tests/js/contracts/spectrogram-picture.test.js tests/js/contracts/spectrogram-columns.test.js tests/js/contracts/render-cost.test.js` prints `exit=0`. `git diff --quiet -- 'tests/js/contracts/*.test.js' hqptuner/` exits 0. `scripts/gate.sh make lint-js` prints `exit=0`. Testing scope: this is harness, so it gets no test of its own. The existing suites passing unedited show the old path is intact, and Task 4's stream replay is the evidence the new path works. Stop there.

### Task 2: The second capture is committed as captured

- **Files:** tests/support/fixtures/meter_start_capture_2.json
- **Reads:** tests/support/fixtures/meter_start_capture_2.json
- **Decisions:** D-05, D-10
- **Action:** The owner ran the read-only probe a second time on 2026-11-16 (`scripts/probes/meter/capture_meter_start.py held 360 0.69`, exit 0, one connection, ended by window). The file is on disk and untracked. Commit it as the owner captured it.
  - **It is the capture the measurement rests on.** Before staging, confirm from the file: schema `meter_start_capture/1`, one run in `held` mode, `ended` `window`, one connection, 22427 frames, 1768 Status samples, track serials 13 to 18, and geometry events at 96000 (63.6 ms), 44100 (82710.7 ms), 96000 (128800.0 ms) and 44100 (186468.2 ms). A mismatch stops the task and goes to the owner.
  - **Content unchanged.** Before staging, copy the file to `${CLAUDE_SCRATCH:-/tmp}` and record its sha256. The pre-commit prettier hook matches `.json` and reformats it, as it did Plan 1's fixture (Plan 1's report: whitespace only, parsed content equal). Commit the formatted file, and check its parsed content equals the copy. Never edit its content; a parsed difference stops the task. A prettier exemption for the fixture needs owner approval and is not proposed.
  - No test reads the file yet, so this commit is green.
- **Verify:** `git show --stat --format= HEAD` lists `tests/support/fixtures/meter_start_capture_2.json` and nothing else. `.venv/bin/python -I -c "import json,sys; sys.exit(json.load(open(sys.argv[1])) != json.load(open(sys.argv[2])))" tests/support/fixtures/meter_start_capture_2.json <the scratch copy>` exits 0. `git status --short tests/support/fixtures/` prints nothing. `scripts/gate.sh make check` prints `exit=0`; it holds cores for more than 10 s, so name it before it runs (`~/dev/CLAUDE.md` 3.1). Testing scope: none; a fixture.

### Task 3: Measure how the data arrives around a track start, from both captures

- **Files:** scripts/probes/meter/arrival_patterns.py
- **Reads:** .planning/phases/7/CAPTURE.md, scripts/probes/meter/capture_meter_start.py, hqptuner/engine/metering.py#run, hqptuner/engine/metering.py#_stream, hqptuner/core/loader.py#_rest, hqptuner/engine/meterfeed.py#reset, hqptuner/config.py
- **Decisions:** D-03, D-04, D-05, D-10
- **Action:** Write a read-only script that takes a capture fixture's path and prints the arrival patterns the replay streams of Task 4 reproduce. It reads the file and nothing else: no connection, no write, no fixture output. Its definitions are CAPTURE.md's (the stamp lead per frame, the metering rate from each frame's header, a serial change read off the Status samples), so on the first capture it prints CAPTURE.md's figures. Per start it prints:
  - **The opening rush, at each rate.** For each resume after a stretch with no frames, the stamps' lead over wall time from the resume's first frame at +0 to +1000 ms, the mean lead over +5 to +9 s, and how long the lead takes to come within 50 ms of that mean (CAPTURE.md block B). For each start with no such stretch, the shift in median lead against the window before it (block A). From Status `position`: how long after the serial change `position` first leaves 0, and the step it moves in (block E).
  - **The frame gaps at track changes.** Every frame gap over 250 ms within 3 s of a serial change, whether a geometry event and a stamp break follow it, and the shift in median lead across it (blocks C and A; on the first capture, the 296 ms gap at 96000 with the stamps 107 ms behind after it).
  - **The drift in steady play.** For each steady stretch (no start or stop inside it), the change in mean lead between its first and last full 10 s bin (block F), with `position`'s seconds per wall second over the same stretch (block E). The script finds the stretches from the Status samples and prints their bounds; on the first capture it also prints block F's own windows, so its figures can be checked against CAPTURE.md.
  - **What the app's reader does around each start.** From 3 s before to 3 s after each serial change: each Status sample's `state`, the length of every stretch where it is not playing, each read whose reply (`t_ms` less `sent_ms`) takes over 500 ms, and `output_delay` per rate. Then, from the code (`run` and `_stream` in `hqptuner/engine/metering.py`, `_rest` in `hqptuner/core/loader.py`, `IDLE_RECHECK`, `status_interval`), whether the app's reader holds its connection through that start or drops and rejoins, and the wall window its rejoin falls in. The first executor read it as 0 to 2.0 s after Status shows playing.
  - The script fits no line and reads no `position` as a clock: `position` here measures when a track is first heard and that it advances at wall speed, as D-10 allows.
  - Lint clean (ruff, black, strict mypy) with no exemption added or widened.
  - **Report.** Run it on both captures. The commit message and the task report hold both outputs whole, with the command lines. Where a figure for the second capture differs from the first capture's by more than one metering frame (10.7 ms at 96000, 23.2 ms at 44100), say so in plain terms. These are the measured values Task 4 cites. CAPTURE.md is Plan 1's record and is not edited.
- **Verify:** `.venv/bin/python -I scripts/probes/meter/arrival_patterns.py tests/support/fixtures/meter_start_capture.json` exits 0 and prints CAPTURE.md's figures: a lead of 559 ms and 566 ms at +300 ms after the two resumes, within 50 ms of the mean at +256 ms and +231 ms; gaps of 1168, 1159 and 296 ms at serials 33, 35 and 34; a change of +446 ms on block F's 44100 window from 130 s; `output_delay` 502358 at 44100 and 501364 at 96000; `position` leaving 0 after 1008 and 1009 ms at the rate changes. A figure that does not reproduce stops the task. `.venv/bin/python -I scripts/probes/meter/arrival_patterns.py tests/support/fixtures/meter_start_capture_2.json` exits 0 and prints a row for each of serials 14 to 18. `git show --stat --format= HEAD` lists the script alone. `scripts/gate.sh make lint` prints `exit=0`; a `scripts/` edit runs its own gate only. Testing scope: none; a read-only measurement, checked by reproducing CAPTURE.md.

### Task 4: Measured-pattern streams, with steady lag through each track

- **Files:** tests/js/contracts/streams.js, tests/js/contracts/smooth-probes.js, tests/js/contracts/steady-lag.test.js, tests/js/contracts/schedules.js
- **Reads:** tests/js/contracts/world.js#replay, tests/js/contracts/schedules.js#generated, tests/js/contracts/schedules.js#bursts, tests/js/contracts/schedules.js#SCHEDULES, tests/js/contracts/trace-probes.js#wallProbe, tests/js/contracts/trace-and-meters.test.js, scripts/probes/meter/arrival_patterns.py, .planning/phases/7/CAPTURE.md, hqptuner/engine/meterfeed.py#reset, docs/spec/timing.md#Measured facts, docs/spec/testing.md
- **Decisions:** D-02, D-03, D-04, D-08, D-09, D-10
- **Action:** Write the stream module with replay streams that reproduce Task 3's measured patterns, and the steady-lag suite that replays them.
  - **What is heard.** Each stream is generated from its heard clock: for each track, the wall time its first sample is heard, and from there one sample of the track's rate per sample of wall time, as Status `position` advances at wall speed in both captures (Task 3). The stamps the stream sends are derived from that clock through the measured patterns, so where the music is heard is known to the sample at every wall time. It is never read from a Status sample or from the code under test. One rule places each track's heard clock against its stamps, the same rule for every start of every stream. A value Task 3 measures per start is support for the rule, never a per-start offset, since a per-start offset would carry the Status reading's 106.67 ms grain into every comparison. The header states the rule as an assumption, with the readings that support it.
  - **The patterns (`streams.js`).** The streams together reproduce what Task 3 measures, at the sizes it prints:
    - The opening rush after a rate change, at 44100 and at 96000: the stamps running ahead of wall time by the measured lead over the measured length, then holding that lead, after the measured stretch with no frames and a geometry event.
    - The start from stopped: frames already arriving at wall speed while State is not playing, for the reader that holds the connection.
    - The gapless same-rate change: no geometry event and no stamp break; at 96000 the measured frame gap with the stamps behind after it.
    - Steady play at 44100 with the stamps drifting against what is heard at the measured rate.
    - Both Status shapes at a rate change: State not playing for about 1 s (first capture), and State staying playing with one slow read (second capture).
    - Status samples at the app's own read cadence (`status_interval`), with `position` in the engine's measured step and `output_delay` per rate as measured; a stream sends nothing the engine does not, at no finer grain than it reports. Frames per event and arrival grouping are as CAPTURE.md block D measures.
  - **Two readers, and joins.** Each start is replayed as the reader that holds the connection receives it, and as the app's reader receives it by its connect rule (Task 3): no stream while State is not playing, then a fresh reader, which `MeterFeed.reset` makes a geometry event and then stamps counted from 0, joining at more than one point across the rejoin window. Where the reader holds, the stream adds the page joining late, with a fresh reader, at more than one point inside the opening stretch; at a rate change that stretch holds the rush, so these joins are what AC5 rests on most. A join's heard clock is the start's heard clock re-based to the join's stamp count. What a fresh reader receives at a join is unmeasured, since the owner cut the late-connect runs: the header states the assumption that it receives the start's arrivals from the join on.
  - **The record.** Every measured value a stream uses is stated in the header with the exact command line that printed it (Task 3's script and the fixture path). This is where the streams cite their values.
  - **The behavior (`steady-lag.test.js`).** The delay between what is on screen and what is heard stays the same through a whole track, within one metering frame at the track's own rate. This task writes that reading for every track of every stream, after every start, as the held reader and as the app's reader at each join point (D-08 (1), AC3). The lag is read after the opening stretch; the test states that stretch's length and that it comes from Task 3's figure for the rush, set before the suite first runs against today's code. What is on screen is the playhead the replay hands back. The suite replays every stream `streams.js` exports, so Plan 3's streams join it with no edit to the sweep.
  - **Readings (`smooth-probes.js`).** Only the readings this suite uses, one probe per reading, returning plain values, as in `trace-probes.js`: no `test()`, no `assert`, no export no test uses (knip covers `tests/js/`).
  - **Constraints.** One assertion per test (rule 2); a sweep is one generated test per case, never a loop of asserts. Replay each stream once per suite. Keep the suite fast: measure the JS suite's time before and after, and report both. Copy no block from the existing suites (jscpd at 2.3% covers `tests/`); export a generator from `schedules.js` instead of copying it, and touch `schedules.js` for nothing else.
  - **Never reshape** a stream, a tolerance, the opening stretch or the set of compared readings to turn a case red or green (rule 8 and the repo's tests-first rule). If the suite is green on every stream, record the readings and go on; Plan 3's Task 1 holds the stop rule for the whole suite.
  - **Commit** the files while the suite is red (D-09 (b)).
- **Verify:** Run `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/steady-lag.test.js` against today's code. Every failure in its log is an `AssertionError` naming a replay; none is an import, a collection or a type error. The log's test names cover a start from stopped, a same-rate change at each rate, a rate change in each direction, the 44100 drift, both Status shapes at a rate change, and more than one join point on each reader. `streams.js`'s header states the heard-clock rule as an assumption, the join assumption, and each measured value with its command line. `grep -n "position" tests/js/contracts/streams.js` shows `position` only as a Status field a stream sends, never read back as a clock. `git diff --quiet <pre-task HEAD> HEAD -- hqptuner/ tests/support/fixtures/` exits 0. `scripts/gate.sh make lint-js` prints `exit=0`.
  - Testing scope. Outcomes: the lag holds through each track after each start, on each reader and join.
  - Already covered: nothing reads lag against what is heard; contract 1 reads the playhead against wall time only.
  - Smallest checks: one lag-steadiness reading per track per replay.
  - Sufficient evidence: the run with assertion failures only, and the test names covering every start kind above. Testing stops there.

### Task 5: The lag compared across starts, rates and join points

- **Files:** tests/js/contracts/steady-lag.test.js, tests/js/contracts/smooth-probes.js
- **Reads:** tests/js/contracts/streams.js, tests/js/contracts/steady-lag.test.js, tests/js/contracts/smooth-probes.js, docs/spec/testing.md
- **Decisions:** D-02, D-08, D-09, D-10
- **Action:** Add to the steady-lag suite the comparisons that make the lag the same everywhere, each at one metering frame, the frame of the finer rate when the two differ (10.7 ms when a 96000 track is in the pair). The level compared is each track's lag after its opening stretch, read as Task 4 reads it.
  - **Across starts.** Within each stream, every start against every other: the start from stopped, each same-rate change and each rate change. Every start has a known heard clock, so none is left out.
  - **Across rates, both directions.** A start at 44100 against one at 96000, on a change from 44100 to 96000 and on a change from 96000 to 44100 (AC4).
  - **Across join points.** For each start, the lag at every join point against the lag at every other, the held reader counting as one join point (AC5, review finding 2). A playhead whose level depends on where the page joined fails here even when each join's own track is steady.
  - The pairs are generated from each stream's own starts and joins, so Plan 3's streams join them with no edit. The header of `steady-lag.test.js` states the set: every pair of starts and every pair of joins of one start; none is dropped.
  - The constraints and the never-reshape rule of Task 4 hold, and Plan 3's Task 1 holds the stop rule for the whole suite.
  - **Commit** while red (D-09 (b)).
- **Verify:** Run `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/steady-lag.test.js` against today's code. Every failure is an `AssertionError` naming a replay and the pair compared. The log's test names hold, for each stream, an across-starts test per pair of starts, an across-rates test on a 44100 to 96000 change and on a 96000 to 44100 change, and an across-joins test per start that has more than one join point. `git diff --name-only <pre-task HEAD> HEAD` lists only this task's two files. `scripts/gate.sh make lint-js` prints `exit=0`.
  - Testing scope. Outcomes: the lag's level is the same across starts, rates and joins. Already covered: steadiness within each track (Task 4). Smallest checks: one comparison per named pair. Sufficient evidence: the red run with assertion failures only. Testing stops there.

## Notes

- **Revision, 2026-11-16, on D-10.** The plan review raised two HIGH findings on the old Task 3. Finding 1: the intercept error "residual sd over root n" assumed independent Status residuals, but their lag-1 autocorrelation is 0.57 to 0.61 on every serial of both captures; with block means the pair (16, 17) at two combined standard errors is 11.4 to 12.6 ms against the 10.67 ms frame, so a captured `position` fit cannot carry one-frame comparisons. Finding 2: AC5 asks for lags compared across join points, and no task compared them. The owner ruled (D-10) that the `position` fit is dropped as the tests' clock, with no new capture. This revision removes the fit, its stamp-origin rules, its intercept errors, its pair lists and its fit-error stop rule; replaces the four raw capture replays with streams that reproduce the captures' measured patterns on a heard clock known to the sample; moves the second capture's symptom re-check into the measurement task (new Task 3); splits steady lag into the within-track reading (Task 4) and the comparisons across starts, rates and join points (Task 5, finding 2). The rule that a tolerance, a stream, the opening stretch or the set of compared pairs is never reshaped is unchanged.
- **Earlier revision, 2026-11-16.** The first executor committed Task 1 (af639b46) and stopped on the old fit-error stop rule; the owner then made the second capture, and the old Tasks 4 to 6 moved to Plan 3. Continuation starts at Task 2.
- **Where the captures enter.** Under D-10 neither capture is replayed raw: with no clock known to a frame on them, no lag reading on a raw replay could be trusted at one frame. They enter through Task 3's measurement, and the streams cite it. Both stay: the first holds a gapless same-rate change after a rate change and State not playing for about 1 s at each rate change; the second holds three rate changes in both directions and State staying playing with one slow Status read.
- **Status in the streams.** The page gets Status every `status_interval` (1.0 s), not the probe's 200 ms; a smoother `position` than the engine sends would let a design pass on a signal the page never gets.
- **Red commits (D-09 (b)).** Tasks 4 and 5 commit red, as Plan 3's three tasks do; the owner decided this, as an exception to `~/dev/CLAUDE.md` 11.4 and the repo's "`make check` green before every commit" for these test files only. Tasks 2 and 3 are green. Plan 5's AC9 check is a diff against these commits.
- The app reader's replay and the late joins stand in for the unmeasured connect-timing case (D-02, AC5) on an assumption the captures cannot confirm; the header of `streams.js` says so.
