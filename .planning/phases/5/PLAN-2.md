---
phase: 5
plan: 2
requirements:
  - METER-01
files:
  - scripts/probes/capture_meter_feed.py
  - tests/support/fixtures/meter_feed_capture.json
  - tests/e2e/test_spectrum_moves_smoothly_through_a_bursty_capture.py
  - .filepawl.toml
---

# Phase 5: Meter playhead on the loop's dt - Plan 2: Smooth spectrum through a replayed capture

## Goal

The meters, the spectrum and the spectrogram move smoothly in step with the music while frames reach the metering reader in bursts, with the stamps still the only authority for where the music is (owner approval, 2026-11-07). This plan closes UAT item 5 (AC5): smooth spectrum playback is proved by an automated check, not by a person's eye.

## Must be true when done

- A real capture of the meter feed, taken read-only from the dev container while the owner's music plays, is in the repo, and its arrivals come in bursts: it holds arrival gaps over 100 ms.
- The owner's limits for a smooth spectrum are recorded in the owner's own words, and the browser test reads them from one place.
- Replaying that capture into a real browser, on the page's own clock made virtual, the painted spectrum stays inside every owner limit on the current playhead.
- The same test fails by assertion against the pre-phase-5 playhead (the `hqptuner/static/model/gauges/playhead.js` and `hqptuner/static/store/meter/loop.js` of commit 6438e843).
- The test runs unattended in the `e2e` job: no live daemon, no fixed sleep, and its wall time does not grow with the capture's length beyond the paint work.
- `scripts/gate.sh make check` prints `exit=0`, and the existing meter e2e files still pass.

## Context

- Owner ruling 2026-11-07 (UAT.md item 5): "in time with the music" is the user's burden through the time alignment feature and is out of scope. Smooth spectrum playback is tested automatically: painted output in a real browser, replayed real capture, owner-set limits, red against the pre-phase-5 playhead. CONTEXT D-01 still binds: the playhead's target is the newest queued frame's end less the delay; behind it the playhead closes the lag faster than wall time (`CATCH_UP_MS` in `playhead.js`).
- CONTEXT Out still holds: nothing here probes or blames the daemon or the network, and nothing changes how frames are read or relayed server-side. The capture reads the app's own feed and never contacts hqplayerd.
- No production file changes in this plan. If the new test is red on the current code, that is a finding about the code: fix the code, or take the plan back to the owner. The test and the owner's limits are never edited to pass (repo CLAUDE.md, Delegation; `docs/spec/testing.md` rule 8).
- History rule for every file named here: no file is under a rebuild-from-spec order, and none has a RESTORE+TRIM verdict in `/home/atom/hqptuner-restore-triage.md` (its rows for `loop.js` and `playhead.js` read DROP, superseded at v2 HEAD). Task 4 checks out 6438e843's `playhead.js` and `loop.js` for the rule 8 red run only, then puts HEAD back.
- Patterns to follow: `tests/e2e/test_playing_readings_keep_flowing.py` (e2e meter test, `stack` and `page` fixtures, one plain `assert` per test), `tests/e2e/conftest.py` (`browser`, `page`), `scripts/probes/probe_metering_stream.py` (probe shape: read-only, bounded capture, usage docstring).

## Tasks

### Task 1: A real bursty capture of the meter feed is in the repo

- **Files:** scripts/probes/capture_meter_feed.py, tests/support/fixtures/meter_feed_capture.json
- **Action:** Add a read-only capture probe in the shape of `scripts/probes/probe_metering_stream.py`. It opens one `GET /api/meter/feed` on the dev container at `127.0.0.1:8090`, the same request a page makes. It records every server-sent event in arrival order: the event type and its data text, exactly as the wire carried them, with the event's arrival time in ms on a monotonic clock, counted from the capture's start. It stops on its own after a bounded capture and writes the fixture. Use the standard library only. The probe sends nothing to hqplayerd, writes nothing anywhere but its output file, and touches no staging buffer. A `geometry` event must precede the first `frame` event in the fixture, the way `hqptuner/engine/meterfeed.py` sends them, because the page lays out its bars from that event. The owner starts the music. The executor never starts, stops or seeks playback, because transport is the listener's call (repo CLAUDE.md prime directive). Ask the owner to start playback, then run the probe once. Record its PID and confirm with `ps -p` that it has exited. The capture length is the executor's choice (planner's discretion, recorded): a few seconds, enough to hold at least five arrival gaps over 100 ms, which is the regime the ROADMAP evidence measured (51 of 51 feed gaps over 100 ms on the live dev container). Keep the fixture no longer than that, because it is committed and read by CI. The fixture holds spectra and levels only, no track metadata, so nothing in it needs redacting.
- **Verify:** human-action first: the owner confirms music is playing in hqplayerd before the probe runs. Then a one-line `.venv/bin/python -c` read of `tests/support/fixtures/meter_feed_capture.json` reports that the first event is `geometry`, that there are `frame` events after it, and that at least five gaps between consecutive arrival times exceed 100 ms. `ps -p <probe PID>` shows it has exited. The probe passes its own gates in Task 5's `make check`.

### Task 2: The owner sets the smoothness limits

- **Files:** none (owner decision, recorded in the execution report verbatim)
- **Action:** Ask the owner, as a blocking question, for the limits a smooth spectrum must stay inside while the Task 1 capture replays. Phrase it in viewing terms, not test terms. Name the two symptoms the owner described at the phase 5 hand-back (PLAN.md Task 5): a freeze followed by a jump at each burst. Ask how long the painted spectrum may stand still while music it has not yet shown has arrived, and how far it may move in a single paint. Let the owner choose the units (paints, playback ms, or a multiple of the paint's wall time). State one fact the jump limit must allow for: by D-01, after a burst gap the playhead closes its lag faster than wall time (`CATCH_UP_MS`, 500 ms, in `hqptuner/static/model/gauges/playhead.js`). The owner ruling names "smooth spectrum playback". So the question names the view the test watches, the spectrum painted in the page's Source section, and asks the owner to confirm it or name the views that are meant (the Source drawer's spectrogram, the level bars). Propose no values. Do not show readings from a test run first, so that no limit is fitted to a measurement (`~/dev/CLAUDE.md` 6.3). Record the owner's answer verbatim. Each limit the owner sets is its own behavior, and so its own test in Task 3 (`docs/spec/testing.md` rule 17).
- **Verify:** The execution report quotes the owner's answer verbatim: one or more limits, each with a number and a unit, and the views they apply to. Task 3 does not start without it.

### Task 3: A browser test replays the capture and holds the painted spectrum to the owner's limits

- **Files:** tests/e2e/test_spectrum_moves_smoothly_through_a_bursty_capture.py, .filepawl.toml (only if `filepawl accept` is printed)
- **Action:** Write the e2e test in `tests/e2e/`, on the session `stack` and the `page` fixture, with the engine reading as playing, the way `test_playing_readings_keep_flowing.py`'s `playing` fixture sets and restores `stack.control_state`. The behavior, in the owner's terms: while the real capture's bursty arrivals reach the page, the spectrum the page paints stays inside each limit from Task 2. One test per owner limit, each with exactly one plain `assert`. Each limit appears once, as a named module-level constant whose doc comment says the owner set it. The value is Task 2's, unchanged. Constraints and their reasons follow. The page's clock is virtual: install Playwright's `page.clock` before `page.goto`, so `requestAnimationFrame`, `performance.now` and the page's timers run on time the test advances. No fixed sleep anywhere, and the wall time stays independent of the capture's length (`docs/spec/testing.md` rule 7, e2e exception; repo rule "Slow tests are defects"). Each captured meter feed event reaches the page at its captured arrival time on that virtual clock, with its event type and data text unmodified. Replace only the page's `EventSource` for `/api/meter/feed`, from an init script. Every other `EventSource` the page opens (the push channel in `hqptuner/static/store/sync.js`) stays the browser's own. Reasons: the server's relay is out of scope (CONTEXT Out), the capture already is the relay's output, and Playwright's `route.fulfill` sends one whole body, so it cannot deliver a stream in bursts. The fake delivers wire events only and stubs none of our code (`docs/spec/testing.md` rule 4). The readings come from painted output, the canvas pixels or the elements' painted geometry, read once per paint. Signals, the queue and the playhead value are internals, so no assertion reads them (rule 1). How motion is read from pixels is the test writer's choice. Nothing in the test asserts copy (rule 9). The test writer chooses the units, the delay the page runs at and every value except the owner's limits. A red run on the current code is a finding. Stop and report it with the readings. Never loosen a limit or reshape the test to pass. Run `filepawl accept` whenever filepawl prints it. Disclose before each run: the run starts headless chromium and the app, which can hold a full core for over 10 s (`~/dev/CLAUDE.md` 3.1). Record every PID and confirm with `ps -p` afterwards that none is left (4.1). `HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell` must be set on this host (phases/5/SUMMARY.md, phase 5).
- **Verify:** `HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell scripts/gate.sh .venv/bin/pytest -m e2e --no-cov -q tests/e2e/test_spectrum_moves_smoothly_through_a_bursty_capture.py` prints `exit=0`, with one passing test per owner limit. `ps -p <each recorded PID>` shows none left. Testing scope: the outcomes are the owner's limits on the painted spectrum during a bursty replay. The model lane already covers the playhead's arithmetic (AC1 to AC4, `tests/js/model/gauges/playhead.test.js`, phases/5/UAT.md, phase 5), and nothing yet covers painted output in a browser. The smallest addition is one browser test per owner limit over the one committed capture. The evidence is enough when the test is green here and red in Task 4. Testing stops there: no second capture, paint rate or view the owner did not name.

### Task 4: The browser test fails against the pre-phase-5 playhead

- **Files:** none (temporary revert, put back before the task ends)
- **Action:** Run the rule 8 red run (`docs/spec/testing.md`). Check out `hqptuner/static/model/gauges/playhead.js` and `hqptuner/static/store/meter/loop.js` from 6438e843, the commit before 6f0432e3. These are the only production files 6f0432e3 changed (`git show --stat 6f0432e3`). Keep the Task 3 test as it is and run it. Each test must fail by assertion, because the old playhead stands still between arrivals and jumps at each one. A setup error, an import error or a harness timeout proves nothing and does not count. Then check out both files from HEAD again. The same disclosure, PID record and `ps -p` check as Task 3 apply. A test that stays green against the old code does not tell the old playhead from the new one at the owner's limits. Report it to the owner with its readings. Do not change the limit or the test.
- **Verify:** The same pytest command as Task 3, run with the two files at 6438e843, prints a non-zero `exit=` with an `AssertionError` line for each test (quote the shortest decisive line per test). Afterwards `git status --porcelain -- hqptuner/static/model/gauges/playhead.js hqptuner/static/store/meter/loop.js` prints nothing. `ps -p <each recorded PID>` shows none left.

### Task 5: The offline gate and the meter e2e files are green

- **Files:** none (verification only)
- **Action:** Run the offline gate over the new probe, fixture and test. Then run the meter-facing e2e files together with the new one, to confirm the new test leaves the session stack as it found it (engine transport, track, metering stream). The same disclosure, PID record and `ps -p` check as Task 3 apply. A red gate goes back to the task that owns the failing path, never to an exemption (repo CLAUDE.md, gate exemptions are owner-approved).
- **Verify:** `scripts/gate.sh make check` prints `exit=0`. `HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell scripts/gate.sh .venv/bin/pytest -m e2e --no-cov -q tests/e2e/test_spectrum_moves_smoothly_through_a_bursty_capture.py tests/e2e/test_playing_readings_keep_flowing.py tests/e2e/test_spectrogram_header_no_scroll_bar_at_quarter_span.py` prints `exit=0`. `ps -p <each recorded PID>` shows none left.

## Notes

- Plan shape: one plan, as the CONTEXT directive asks. Tasks 1 to 5 run in order on shared files.
- Two tasks need the owner present: Task 1 (the music must be playing when the probe runs) and Task 2 (the limits). They can run in one sitting.
- The owner ruling names "smooth spectrum playback", and the UAT item names the meters, the spectrum and the spectrogram. This plan tests the spectrum. Task 2 asks the owner to confirm that view or name the others. Any view the owner names gets its tests in Task 3 under the same limits question, with no new task.
- No user-facing text, `data/*.json` or `CHANGELOG.md` changes. The plan adds no test lane besides `e2e`, which the required `e2e` job already runs.
- The CI `e2e` job does not run on `v2` without a pull request (PLAN.md Notes), so this plan's e2e evidence is local.
