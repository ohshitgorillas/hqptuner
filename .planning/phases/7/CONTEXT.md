# Phase 7: One time base - Context

Gathered: 2026-11-18

Feeds: /cad-plan 7

## Scope boundary

In: one shared time structure under `hqptuner/static/lib/` that owns every time conversion in the browser, used by the feed store, the playhead, the meter loop, the painters, the spectrogram raster, the apodizing scale and the JavaScript tests and contracts; wall time in ms everywhere in the browser, the painters and `model/gauges/meter/steps.js` included; removal of all 279 unjustified clones in the repository, in production code, tests and scripts, JavaScript and Python; the jscpd threshold lowered to what the repository measures afterward; the amendment to `docs/spec/timing.md` that names the structure, in the owner's wording.

Out: the samples-to-ms arithmetic in `scripts/probes/meter/arrival_patterns.py` and `scripts/probes/capture_meter_feed.py`; a Python time structure on the server; the 43 clones judged justified; the pixel and step epsilons `COLUMN_EPS` (`hqptuner/static/lib/spectroraster.js`) and `STEP_SLACK` (`hqptuner/static/model/gauges/meter/steps.js`); retiring the `world.js` and `schedules.js` replay harness, which is phase 8's call; any change to the phase 8 red tables; any `CHANGELOG.md` entry.

Deferred: None

Plan shape: multiple plans (owner: big, planning splits the work into several plans inside this phase).

## Durable decisions

- D-01 (time unit): the browser keeps wall time in ms everywhere. The painters and `hqptuner/static/model/gauges/meter/steps.js` move from `dt` in seconds to `dt` in ms, and the conversions between seconds and ms disappear; keeping seconds in the drawing code behind one conversion was considered and rejected. Evidence: owner answer 2026-11-18; `hqptuner/static/store/meter/loop.js:38,196,202`, `hqptuner/static/store/meter/delay.js:13,55`, `hqptuner/static/lib/apodscale.js:14,23,43`, `hqptuner/static/store/faceplate/drawers/source.js:26,111`, `hqptuner/static/model/gauges/meter/steps.js:3,58`, `docs/spec/timing.md` ("The two clocks").
- D-02 (playback time): playback time stays in ms from the feed store on, and samples are not carried through the model. A stamp's ms value comes from one function, from whole samples, and a frame's end is the whole-sample end `at + n` converted, never `at_ms + ms_ms`, so a frame's end equals the next contiguous frame's start exactly. Carrying samples and the rate through the model, and an integer sub-ms unit, were the alternatives. Evidence: owner confirmation 2026-11-18; measured 2026-11-18 over 11,724 stamps at six rates, production's `at * (1000 / rate)` (`hqptuner/static/store/meter/feed.js:117-120`) and the tests' `(at * 1000) / rate` (`tests/js/contracts/world.js:206`, `tests/js/contracts/schedules.js:78,102`, `tests/js/model/gauges/playhead.test.js:266`) disagree on 2,397 of them, and at 44100 `at_ms + n_ms` and `(at + n)` converted disagree on 593 of 1,954 frames; `docs/spec/timing.md` ("The two clocks"); `.planning/phases/8/CONTEXT.md` D-14, D-16.
- D-03 (duplication scope): "Duplicated code is illegal" covers the whole repository. All 279 clones judged unjustified go in this phase, in production code, tests and scripts, JavaScript and Python; removing only the 18 in meter and timing files, or those plus the production ones, was considered and rejected. The 43 judged justified stay: repeated import lists and module docstrings in split test files, type declarations that cannot share a field list, per-script entry points, and the `blockstats.py` mirror of the junkburst scoring code. The two feed tables in `tests/js/support/meterfeed.js:41-68` are not justified: `docs/spec/testing.md` rule 13 bans a fake that answers by the algorithm under test, not an input table built from another. Evidence: owner answers 2026-11-18; jscpd run 2026-11-18 under `.jscpd.json` (171 JavaScript clones at 2.29% of tokens, 152 Python clones at 1.94%); per-clone reading 2026-11-18; `.claude/skills/junkburst/SKILL.md` ("Engine port").

## Decisions

- D-04 (home): the shared time structure is a new module under `hqptuner/static/lib/`, since the layering is `app > components > store > model > lib` and `lib/spectroraster.js` and `lib/apodscale.js` both need it. Evidence: `eslint.config.js` (layering rules), `hqptuner/static/lib/spectroraster.js` (`endOf`), `hqptuner/static/model/gauges/playhead.js` (`startOf`, `endOf`), `hqptuner/static/store/meter/feed.js` (`decode`, `trim`).
- D-05 (spec): `docs/spec/timing.md` is amended to name the shared structure as the owner of the conversion; the feed store stays the one call site that converts wire stamps and calls the structure to do it. The amended text is the owner's, approved verbatim before it lands. Evidence: `docs/spec/timing.md` (two-clocks table, pipeline table "Feed store" row, rule 2), `hqptuner/static/store/meter/feed.js:117`.
- D-06 (optional stamp): `MeterFrame.at` stays optional, and the `?? NaN` guard lives inside the shared structure only; the callers' own `start` and `end` helpers go. Evidence: `hqptuner/static/model/gauges/meter/meter.js` (`@property {number} [at]`), `hqptuner/static/model/gauges/playhead.js:73`, `hqptuner/static/store/meter/feed.js:144-146,173`, `tests/js/model/gauges/playhead.test.js:143`, `tests/js/model/gauges/slicerange.test.js:68,75`, `tests/js/store/meter/spectrogram.test.js:148`, `tests/js/contracts/trace-probes.js:47,50`.
- D-07 (tolerances): test tolerances that only absorb float drift in time values go: `SAME_MS` and the `same()` rounding, and the `EPS` in the trace probes. `COLUMN_EPS` and `STEP_SLACK` are pixel and step arithmetic and stay. Evidence: `docs/spec/testing.md` rule 18; `tests/js/store/meter/feed.test.js` (`SAME_MS`), `tests/js/store/meter/apodstamp.test.js:119`, `tests/js/store/meter/loop.test.js:76`, `tests/js/store/meter/loop-boot.test.js:35`, `tests/js/store/meter/loop-painters.test.js:115`, `tests/js/contracts/trace-probes.js:71`.
- D-08 (Python): the two Python probe scripts keep their own samples-to-ms arithmetic, and the server gets no time structure, since production Python converts no time today. The unjustified clones under `scripts/` still go under D-03. Evidence: owner answer 2026-11-18; `hqptuner/engine/meterfeed.py` (`metering_rate`, `FrameData.at`/`n` ints), `hqptuner/clock.py`, `scripts/probes/meter/arrival_patterns.py:7,88`, `scripts/probes/capture_meter_feed.py:89`.
- D-09 (threshold): the `threshold` in `.jscpd.json` drops from 2.3 to the percentage the repository measures after the phase. Evidence: owner confirmation 2026-11-18; `.jscpd.json`.
- D-10 (test contracts): the test contracts stop re-deriving conversions and break detection; expected values are hand-written, and only harness plumbing calls the shared structure. Evidence: `tests/js/contracts/world.js:186-207`, `tests/js/model/gauges/playhead.test.js:113,261-268`, `tests/js/contracts/schedules.js:70-78,94-102`, `docs/spec/testing.md` rule 13, `.planning/phases/8/CONTEXT.md` D-16.
- D-11 (replay harness): the `world.js` and `schedules.js` replay harness is migrated onto the shared structure, not retired. Evidence: `tests/js/contracts/trace-and-meters.test.js`, `tests/js/contracts/spectrogram-columns.test.js`, `tests/js/contracts/spectrogram-picture.test.js` (all import `world.js`); `.planning/phases/8/PLAN-1.md` Task 1.

## Acceptance criteria

- [ ] AC1: `scripts/gate.sh npx jscpd` reports at most 43 clones, and the `threshold` in `.jscpd.json` is the lowest two-decimal value at which every per-format run of `scripts/gate.sh make jscpd` passes. [reworded by owner ruling 2026-11-19: the gate is per-format and compares strictly, so no value equals the combined run's printed figure and passes]
- [ ] AC2: `grep -rnE "(MS|US)_PER_S\s*=" hqptuner/static tests/js` prints hits in one file only, and that file is under `hqptuner/static/lib/`.
- [ ] AC3: At 44100, 48000, 88200, 96000, 176400 and 192000 Hz, the end of every frame the feed store emits is strictly equal (`===`) to the start of the contiguous frame after it.
- [ ] AC4: `grep -rn "MS_PER_S" hqptuner/static/components hqptuner/static/model/gauges/meter` prints nothing, and no constant in `hqptuner/static/model/gauges/meter/steps.js` has a name ending in `_S`.
- [ ] AC5: `grep -rn "SAME_MS" tests/js` prints nothing, and `tests/js/contracts/trace-probes.js` contains no `EPS`.
- [ ] AC6: `docs/spec/timing.md` names the shared structure's file path as the owner of the samples-to-ms conversion.
- [ ] AC7: `scripts/gate.sh make check` reports no failing test that was passing at commit `503ddec8`, and `git diff 503ddec8 -- tests/js/model/gauges/playhead-lag.test.js tests/js/model/gauges/playhead-motion.test.js tests/js/model/gauges/playhead-scroll.test.js` prints nothing.

## Flagged assumptions

- The 43 justified verdicts are correct - Likely; they rest on two agents' reading of each clone, with one import-list pair read by the session and the last 15 Python clones judged by the session from one side of each pair; if wrong: AC1's bound of 43 is too loose or too tight, and the planner re-judges the clone it doubts.
- The clone `tests/core/test_lifecycle_outcomes.py:38-44` against `tests/lanes/test_settle.py:157-163` (the same wire-fact table at two lanes) is the planner's call - Unclear; if the settle case is the same scenario the table is shared, and if it is a coincidence both stay and AC1's bound becomes 44.
- The per-clone list exists only in the session that gathered this context and in the jscpd logs under `/tmp` - Confident; if wrong or lost: the planner reruns `scripts/gate.sh npx jscpd` and works from its output, since AC1 is a count and not a list.
- Merging the fixtures `served1` and `pendingOf` leaves them deriving fake readings from staged state, which may brush `docs/spec/testing.md` rule 13 - Unclear; if wrong: the merge needs a table in their place.
- Phase 7 serves no requirement ID in `REQUIREMENTS.md` - Confident; if wrong: `/cad-audit` finds an orphan.
- Moving the painters to `dt` in ms changes no number a user sees - Likely; if wrong: a meter ballistic or hold time shifts, which AC7 catches only where a test pins it.
