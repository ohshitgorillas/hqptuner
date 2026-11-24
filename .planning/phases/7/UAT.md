---
status: testing
phase: 7
fields_version: 1
started: 2026-11-19
updated: 2026-11-24
---

## Items

### 1. Clone count within bound and jscpd threshold at its floor
expected: `scripts/gate.sh npx jscpd` reports at most 43 clones, and the `threshold` in `.jscpd.json` is the lowest two-decimal value at which every per-format run of `scripts/gate.sh make jscpd` passes
criterion: AC1
status: pass
first_pass: pass
source: model
evidence: After e87d056c: scripts/gate.sh make check log /tmp/gate-make-toILTyaV.log shows Found 15 clones (python), Found 11 clones (javascript), Found 0 clones (css): 26 against a bound of 43. Python measures 156 of 86897 lines, 0.1795%. scripts/gate.sh make jscpd at threshold 0.17: exit=2, 'jscpd found too many duplicates (0.2%) over threshold (0.2%)'; at 0.18: exit=0. .jscpd.json holds 0.18.

### 2. Time constants defined in one lib file
expected: `grep -rnE "(MS|US)_PER_S\s*=" hqptuner/static tests/js` prints hits in one file only, and that file is under `hqptuner/static/lib/`
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: The grep prints only hqptuner/static/lib/timebase.js:5 and :7.

### 3. Frame end equals next frame start at six rates
expected: At 44100, 48000, 88200, 96000, 176400 and 192000 Hz, the end of every frame the feed store emits is strictly equal (===) to the start of the contiguous frame after it
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: tests/js/store/meter/feed.test.js:226-233 with strict deepEqual. ok 5074-5079 in /tmp/gate-make-wQH1fweY.log, one per rate.

### 4. No seconds conversion in components or meter model
expected: `grep -rn "MS_PER_S" hqptuner/static/components hqptuner/static/model/gauges/meter` prints nothing, and no constant in `hqptuner/static/model/gauges/meter/steps.js` has a name ending in `_S`
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: The MS_PER_S grep prints nothing. No steps.js constant ends in _S (steps.js:14-33).

### 5. Float-drift tolerances gone from tests
expected: `grep -rn "SAME_MS" tests/js` prints nothing, and `tests/js/contracts/trace-probes.js` contains no `EPS`
criterion: AC5
status: pass
first_pass: pass
source: verifier
evidence: The SAME_MS grep prints nothing, and trace-probes.js contains no EPS.

### 6. Timing spec names the time base as conversion owner
expected: `docs/spec/timing.md` names `hqptuner/static/lib/timebase.js` as the owner of the samples-to-ms conversion
criterion: AC6
status: pass
first_pass: pass
source: verifier
evidence: docs/spec/timing.md:24 names hqptuner/static/lib/timebase.js as the owner of the conversion of whole samples to ms.

### 7. No regression against 503ddec8 and playhead tables untouched
expected: `scripts/gate.sh make check` reports no failing test that was passing at commit `503ddec8`, and `git diff 503ddec8 -- tests/js/model/gauges/playhead-lag.test.js tests/js/model/gauges/playhead-motion.test.js tests/js/model/gauges/playhead-scroll.test.js` prints nothing
criterion: AC7
status: pass
first_pass: pass
source: verifier
evidence: The table diff is empty. make check: pytest 3676 passed; JS 12 fail, all in the three unchanged phase 8 table files (8/3/1), matching .planning/phases/8/records/reports/plan-1.md:15.

### 8. Source page meters, spectrum styles and aurora look unchanged
expected: On the dev build, the Source page meters, every spectrum style and the aurora move and look as they did before the painters took dt in ms (plan 3)
status: fail
first_pass: fail
source: model
evidence: SUMMARY deviation for plans 1, 2, 3, 6, 7 and 11 (task-check never rebuilt hqptuner:dev). The tests/js/model/gauges/meter/*.test.js suites judge model state, not the painted picture.
reported: fail: different rates still run at different delays. it's closer, but it's not the same. this indicates that there's still some fudging going on somewhere that needs excised.
severity: major
cause: Owner verdict of 2026-11-23 on the rebuilt dev build, so not a pass (plan 19 Verify). The automated check plan 18 added passes at 21d07176: ok 894, 895, 938 and the other painter cases in /tmp/gate-make-o2Ve03XD.log. Diagnosis by code reading, not measured live: hqptuner/static/model/gauges/playhead.js:109 sets the playhead at a restart to `newest - delay` and from then on moves it by wall time only, so the lag is fixed by how far the stamps ran ahead of wall time when the track started. docs/spec/timing.md (The two clocks) says the playhead follows the line's lead; settledLead (:164) and followLine (:195) exist in the same file and no production code calls them. The size of the opening lead depends on the rate through the feed's stride (hqptuner/engine/meterfeed.py:116-123). No rate branch, tolerance or offset was found in the feed, delay, loop or playhead path. The 12 red tests (playhead-lag 8, playhead-motion 3, playhead-scroll 1) assert exactly the missing behavior, e.g. test_a_start_stands_one_delay_behind_the_line_when_the_paint_ran_9_ms_after_the_arrival. This is phase 8's stated bug and its success criterion 2.
fix: left open by owner 2026-11-23: phase 8 makes the playhead follow the line

### 9. Source drawer spectrogram looks unchanged
expected: On the dev build, the Source drawer's spectrogram scrolls and paints as before, with no seam or gap between slices (plan 2)
status: pass
first_pass: fail
source: model
evidence: At 21d07176: `scripts/gate.sh make check` log /tmp/gate-make-o2Ve03XD.log: ok 590, 591, 592 (test_the_spectrogram_shows_no_blank_column_... in drawers-source-paint-blank.test.js). `scripts/gate.sh .venv/bin/pytest -m e2e --no-cov -q` over test_spectrogram_scrolls_smoothly_through_bursty_feeds.py, test_popovers_park_beside_what_opens_them.py and test_popovers_fit_every_format.py: exit=0, `46 passed, 1 warning in 307.93s`, log /tmp/gate-pytest-ehghk1Ut.log. The owner's verdict of 2026-11-23 did not speak to the spectrogram.
reported: no automated check exercises it: no check paints the dev build's Source drawer spectrogram. The picture contracts run on a fake canvas, and their oracle uses the at+ms derivation with EPS.
severity: minor
cause: No automated check exists: the picture contracts paint a fake canvas, nothing paints the Source drawer spectrogram on a dev build, and no dev build ran in this phase.
fix: routed to /cad-plan

### 10. Popovers, Visual settings drawer and matrix plot look unchanged
expected: On the dev build, each popover parks under its trigger as before, and the Visual settings drawer and the matrix plot look and behave as before (plan 6)
status: pass
first_pass: fail
source: model
evidence: At 21d07176: `scripts/gate.sh .venv/bin/pytest -m e2e --no-cov -q` over test_popovers_park_beside_what_opens_them.py, test_popovers_fit_every_format.py and test_spectrogram_scrolls_smoothly_through_bursty_feeds.py: exit=0, `46 passed, 1 warning in 307.93s`, log /tmp/gate-pytest-ehghk1Ut.log. The park test reads seven of the nine sites; the volume panel and the alert note are not read (plan 18 open item). The Visual settings drawer and the matrix plot are held by visual.test.js and profile.test.js inside the JS suite, whose only 12 failures are the phase 8 playhead tables (/tmp/gate-make-o2Ve03XD.log). The owner's verdict of 2026-11-23 did not speak to this item.
reported: no automated check exercises it: no test asserts where any of the nine popover sites lands after dd3541d0 moved them onto place() and parkPanel(), and no dev build ran for plan 6.
severity: minor
cause: No automated check exists: no test asserts where the nine popover sites moved onto place() and parkPanel() by dd3541d0 land, the full e2e suite was not run in this phase, and no dev build ran.
fix: routed to /cad-plan

### 11. Every test contract reads a frame's or a slice's end through the time base and judges times exactly, with no tolerance
expected: behavior wrong: a test oracle re-derives slice ends as start plus length instead of reading them through the time base, and needs a float tolerance to agree with the code under test. This breaks success criteria 2 and 4 (test contracts use the structure; exact tests hold without tolerance).
origin: verifier
status: pass
first_pass: fail
source: model
evidence: After 4148b887: grep for EPS and for an at-plus-ms end in tests/js/contracts/picture.js and tests/js/store/meter/loop.test.js prints nothing (rc=1); node --test over spectrogram-picture, spectrogram-columns, trace-and-meters, loop, drawers-source-paint and drawers-source-paint-blank: # tests 201, # pass 201, # fail 0.
reported: behavior wrong: a test oracle re-derives slice ends as start plus length instead of reading them through the time base, and needs a float tolerance to agree with the code under test. This breaks success criteria 2 and 4 (test contracts use the structure; exact tests hold without tolerance).
severity: major
cause: Plan 15 converted the meter store suites but left two oracles re-deriving a slice end as at + ms: tests/js/contracts/picture.js:184,188,189 (with EPS = 1e-9 at :38, applied at :192 and :194) and tests/js/store/meter/loop.test.js:101-102. AC5 greps only SAME_MS and trace-probes.js, so no acceptance criterion saw them. Confirmed by grep this session.
fix: 4148b887, retest

### 12. No logic is duplicated: wherever two places derive the same value, both use one shared structure
expected: behavior wrong: the goal says duplicated code is not allowed anywhere, and these repeats sit under jscpd's 50-token floor or inside its entry-point exemption. The SUMMARY admits two of them.
origin: verifier
status: pass
first_pass: fail
source: model
evidence: At 21d07176: `grep -rn "class CliError" scripts hqptuner` prints one hit, scripts/probes/kit/probekit.py:36. scripts/junkcal/junkcal_burst.py has no _read_frame and imports read_raw_frame from hqptuner.engine.metering (:40, :99). `grep -rn "_yield_veto_forces_real\|def _handshakes" scripts tests` prints nothing; one handshakes at tests/support/fixtures_daemons.py:177. `secondsToMs(1) / 60` has one home, tests/js/support/meter/capture.js:10. `make check` log /tmp/gate-make-o2Ve03XD.log: Found 15 clones (python), 11 (javascript), 0 (css). This settles the repeats the item named; repeats under jscpd's 50-token floor that nobody has named are not searched for.
reported: behavior wrong: the goal says duplicated code is not allowed anywhere, and these repeats sit under jscpd's 50-token floor or inside its entry-point exemption. The SUMMARY admits two of them.
severity: minor
cause: Retest after e87d056c: the four repeats the fix named are gone (one PAINT_60HZ_MS home in tests/js/support/meter/capture.js, shared handshakes fixture, veto_forces_real called with MIRROR_VETO_LEVEL, probekit.run_cli in 8 probes). One confirmed repeat remains outside the approved fix: scripts/junkcal/junkcal_burst.py:133 _read_frame repeats the header unpack, the plausibility check and the payload sizing of hqptuner/engine/metering.py:343 read_frame, differing only in handing back the raw header bytes; sharing it changes production engine code. Also left: scripts/probes/gen_kaiser_oracle.py keeps its own CliError class and a synchronous main(), and scripts/sweep.py has a third CliError class.
fix: e87d056c, retest

### 13. Suite `scripts/gate.sh make check` is green
expected: `scripts/gate.sh make check` exits 0
status: fail
first_pass: fail
source: model
cause: At 21d07176: `scripts/gate.sh make check` exit=2, log /tmp/gate-make-o2Ve03XD.log: pytest `3681 passed, 164 deselected`; JS `# tests 5653`, `# pass 5641`, `# fail 12`. The 12 `not ok` lines (2218-2224, 2230, 2249, 2252, 2253, 2257) are in playhead-lag.test.js (8), playhead-motion.test.js (3) and playhead-scroll.test.js (1), and `git diff --stat 503ddec8` over those three files prints nothing. No other failure. The suite stays red until phase 8 makes those tables pass.
fix: left open by owner: phase 8 owns the 12 red tables

## Summary

total: 13
passed: 11
failed: 2
pending: 0
skipped: 0
blocked: 0
reworked: 6
