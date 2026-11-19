---
phase: 7
plan: 1
requirements: []
files:
  - hqptuner/static/lib/timebase.js
  - hqptuner/static/lib/clipboard.js
  - hqptuner/static/lib/browser/clipboard.js
  - hqptuner/static/components/faceplate/settings/LogTail.js
  - tests/js/lib/timebase.test.js
  - hqptuner/static/store/meter/feed.js
  - hqptuner/static/model/gauges/meter/meter.js
  - tests/js/store/meter/feed.test.js
  - tests/js/support/meterfeed.js
  - tests/js/store/meter/apodstamp.test.js
  - hqptuner/static/store/meter/delay.js
  - hqptuner/static/store/meter/loop.js
  - tests/js/store/meter/delay.test.js
  - tests/js/store/meter/spectrum-delay.test.js
  - hqptuner/static/lib/apodscale.js
  - tests/js/lib/apodscale.test.js
  - hqptuner/static/store/faceplate/drawers/source.js
  - hqptuner/static/model/gauges/crossfeed.js
  - hqptuner/static/model/shell/pipelines.js
---

# Phase 7: One time base - Plan 1: The time base and the feed's stamps

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- One module, `hqptuner/static/lib/timebase.js`, holds the one samples-to-ms conversion and the seconds-to-ms constant, and the feed store, the delay store, the apodizing scale and the Source drawer keep no conversion constant of their own.
- At 44100, 48000, 88200, 96000, 176400 and 192000 Hz, the end of every frame the feed store emits is strictly equal to the start of the contiguous frame after it.
- The spectrum delay the meter loop paces by is in ms from the delay store on; the user still types and stores the offset in seconds.
- The apodizing scale, the Source drawer's time axis, the crossfeed ITD and the pipeline delay caption take their unit conversions from the time base, and every number and caption they show is unchanged.

## Context

- D-02, D-04, D-06 and D-07 bind this plan. The structure lives under `lib/` because the layering is `app > components > store > model > lib` (D-04). The file name `timebase.js` is the planner's choice.
- The phase 8 tables `tests/js/model/gauges/playhead-lag.test.js`, `playhead-motion.test.js` and `playhead-scroll.test.js` build `MeterFrame`s by hand as `{ at, ms }` in whole ms and are type-checked by `tsconfig.node.json`; they must stay byte-identical (AC7) and keep their results.
- Testing policy: `docs/spec/testing.md` binds every test here; rules 8 (bite), 13 (tables), 15 (lowest lane), 17 and 18 (exact, no tolerance) most of all. The test writer chooses unit, lane, assertion and values.
- Out: the Python probes' arithmetic (D-08), `COLUMN_EPS`, `STEP_SLACK`, the painters' `dt` (Plan 3), the replay harness (Plan 4), any `CHANGELOG.md` entry.

## Tasks

### Task 1: Feed stamps come from one samples-to-ms conversion in the time base

- **Files:** hqptuner/static/lib/timebase.js, tests/js/lib/timebase.test.js, hqptuner/static/store/meter/feed.js, hqptuner/static/model/gauges/meter/meter.js, tests/js/store/meter/feed.test.js, tests/js/support/meterfeed.js, tests/js/store/meter/apodstamp.test.js
- **Reads:** hqptuner/static/store/meter/feed.js#decode, hqptuner/static/store/meter/feed.js#trim, hqptuner/static/model/gauges/meter/meter.js, hqptuner/static/model/gauges/playhead.js#endOf, tests/js/support/meterfeed.js#CONTIGUOUS_44K, docs/spec/timing.md#The two clocks
- **Decisions:** D-02, D-04, D-06, D-07
- **Pins:** tests/js/store/meter/feed.test.js, tests/js/store/meter/apodstamp.test.js, tests/js/store/meter/apodstrip.test.js, tests/js/model/gauges/playhead-lag.test.js, tests/js/model/gauges/playhead-motion.test.js, tests/js/model/gauges/playhead-scroll.test.js
- **Action:** Create `hqptuner/static/lib/timebase.js`, the browser's one time structure, and route the feed store's stamps through it. Behavior the owner wants, in their terms (D-02): a stamp's ms value comes from one function, from whole samples at the geometry's rate, and a frame's end is the whole-sample end `at + n` converted by that same function, never the converted start plus the converted length, so a frame's end equals the next contiguous frame's start exactly. The conversion multiplies the whole sample count by 1000 and divides once by the rate (planner's choice: one correctly rounded division, the form the tests already use). The module holds the browser's only seconds-to-ms constant (AC2 counts `MS_PER_S`/`US_PER_S` definitions; this file becomes their one home) and the readers of a frame's start and end. `MeterFrame.at` stays optional, and the `?? NaN` guard for a frame with no stamp lives inside the structure only (D-06). `decode` stamps each frame with its start and its converted end; `trim` and the feed's edge read the end through the structure, and `feed.js` keeps no conversion constant of its own. The `MeterFrame` typedef in `meter.js` documents the converted end with clock and unit (`docs/spec/timing.md`, "Every value that carries a time names its clock and its unit"). That end is optional on the type: the phase 8 tables build frames by hand as `{ at, ms }` in whole ms and may not change, so the structure's end reader reads a frame that carries no converted end as its start plus its length, and that branch lives inside the structure beside the `?? NaN` guard, nowhere else (planner's choice, flagged in Notes). Tests first, red against the current `feed.js`: the six rates of AC3, each with a hand-written contiguous table in `tests/js/support/meterfeed.js` (rule 13: no table works out a stamp), whose rows include ones where the current `at * (1000 / rate)` plus `n * (1000 / rate)` misses the next start. `SAME_MS` and its `near(...)` calls go from `feed.test.js` and `apodstamp.test.js` (D-07); their cases assert exact equality on rows the test writer picks so the expected ms value is exact, never by a new tolerance under another name. `feed.test.js`'s `SECOND_MS` goes with them (D-10): the gap the one-second cases expect between two stamps is that case's own ms value, written by hand, not a seconds-to-ms factor the suite keeps. Do not touch `playhead.js`, `spectrogram.js` or the raster here; Plan 2 moves them.
- **Verify:** Testing scope: the outcome is exact frame joins at six rates plus the unchanged break, geometry and queue behavior the feed suites already pin; the smallest new check is the six-rate contiguity case at the feed store lane, plus whatever the structure's own unstamped-frame guard needs at the lib lane; evidence is a red run and a green run; testing stops there. (1) Red run: with the new tests in place and `hqptuner/static/store/meter/feed.js` as at HEAD, `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/feed.test.js` fails by `AssertionError` on the six-rate contiguity case. (2) After the change the same command plus `tests/js/lib/timebase.test.js`, `tests/js/store/meter/apodstamp.test.js`, `tests/js/store/meter/apodstrip.test.js` and the three phase 8 tables give the same pass and fail outcome per test as at commit `503ddec8`, the new cases passing. (3) `grep -rnE "SAME_MS|SECOND_MS" tests/js/store/meter/feed.test.js tests/js/store/meter/apodstamp.test.js` prints nothing, and `grep -nE "(MS|US)_PER_S\s*=" hqptuner/static/store/meter/feed.js` prints nothing. (4) `scripts/gate.sh npx tsc -p jsconfig.json` and `scripts/gate.sh npx tsc -p tsconfig.node.json` pass, and `git diff 503ddec8 -- tests/js/model/gauges/playhead-lag.test.js tests/js/model/gauges/playhead-motion.test.js tests/js/model/gauges/playhead-scroll.test.js` prints nothing. (5) `bash .claude/task-check.sh` passes and prints the hand-back URL.

### Task 2: The spectrum delay is ms from the delay store on

- **Files:** hqptuner/static/store/meter/delay.js, hqptuner/static/store/meter/loop.js, tests/js/store/meter/delay.test.js, tests/js/store/meter/spectrum-delay.test.js
- **Reads:** hqptuner/static/store/meter/delay.js#engineDelay, hqptuner/static/store/meter/delay.js#effectiveDelay, hqptuner/static/store/meter/loop.js#paint
- **Decisions:** D-01
- **Pins:** tests/js/store/meter/delay.test.js, tests/js/store/meter/spectrum-delay.test.js, tests/js/store/meter/loop.test.js, tests/js/components/faceplate/display-delay.test.js
- **Action:** `engineDelay` and `effectiveDelay` carry ms, so the browser keeps this wall-time value in ms everywhere (D-01). The engine's `output_delay` arrives in µs and the user's offset is typed and stored in seconds; each is converted once, in `delay.js`, through the time base, and `US_PER_S` goes. `spectrumOffset`, its stored pref and the -5 to 5 s range the user types stay in seconds: they are the user's own unit, and no copy changes. The meter loop hands `pacePaint` the effective delay as it reads it, with no conversion of its own; `loop.js` keeps its `dt` handling exactly as it stands (Plan 3 moves it). Doc comments on both computeds name clock and unit. Each conversion is one correctly rounded operation on the reading, the whole µs divided once and the typed seconds multiplied once, so an exactly known reading gives an exactly known ms value. `SAME_S` and its `near(...)` calls go from `spectrum-delay.test.js` (D-07, owner ruling 2026-11-18): every reading the suite uses is exact in binary, in seconds and in ms (250000 µs is 250 ms; 0.5, -0.125, 1.25 and -0.75 s are 500, -125, 1250 and -750 ms), so its cases compare exactly, with no allowance under another name. Tests first: the delay suites state the two computeds in ms, red against the current `delay.js`.
- **Verify:** Testing scope: the outcome is the two delays read in ms with zero, missing and non-numeric engine reports still reading as before; already covered by the two delay suites, whose expected values move to ms; no new case beyond that; testing stops there. (1) Red run: the updated `tests/js/store/meter/delay.test.js` and `tests/js/store/meter/spectrum-delay.test.js` fail by `AssertionError` against `delay.js` as at HEAD. (2) After the change they pass, and `tests/js/store/meter/loop.test.js`, `tests/js/store/meter/loop-painters.test.js` and `tests/js/components/faceplate/display-delay.test.js` give the same outcome per test as before the task. (3) `grep -nE "SAME_S|near\(" tests/js/store/meter/spectrum-delay.test.js` prints nothing, `grep -nE "(MS|US)_PER_S" hqptuner/static/store/meter/delay.js` prints nothing, and `grep -n "MS_PER_S" hqptuner/static/store/meter/loop.js` prints only the line or lines Plan 3 removes, the painters' `dt` conversion, and none on the delay. (4) `bash .claude/task-check.sh` passes.

### Task 3: The apodizing scale and the Source drawer's time axis convert through the time base

- **Files:** hqptuner/static/lib/apodscale.js, tests/js/lib/apodscale.test.js, hqptuner/static/store/faceplate/drawers/source.js
- **Reads:** hqptuner/static/lib/apodscale.js#rateOf, hqptuner/static/lib/apodscale.js#windowSpan, hqptuner/static/lib/apodscale.js#playedMs, hqptuner/static/store/faceplate/drawers/source.js#MS_PER_S
- **Decisions:** D-01, D-04
- **Pins:** tests/js/lib/apodscale.test.js, tests/js/store/meter/apodstrip.test.js, tests/js/store/meter/apodlamp.test.js, tests/js/model/gauges/meter/meter-plot.test.js
- **Action:** `rateOf`, `windowSpan` and `playedMs` take their seconds-to-ms factor from the time base instead of a bare 1000 each, and `source.js` drops its own `MS_PER_S`, handing `timeTicks` the time base's value. Every value these return is unchanged: the window is still the chosen seconds in playback ms, a density is still events per second, and the axis ticks are the same. `meter-plot.js` lives under `model/gauges/meter/` and stays as it is (AC4 keeps `MS_PER_S` out of that directory).
- **Verify:** Testing scope: no behavior changes; the apodizing, strip and tick suites already pin every value; no new test; testing stops there. (1) `grep -nE "1000|MS_PER_S\s*=" hqptuner/static/lib/apodscale.js hqptuner/static/store/faceplate/drawers/source.js` prints nothing. (2) `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/apodscale.test.js tests/js/store/meter/apodstrip.test.js tests/js/model/gauges/meter/meter-plot.test.js` passes with the same test count as before the task, as do `tests/js/store/faceplate/drawers-source/` and `tests/js/components/faceplate-drawers/drawers-source*.test.js`. (3) `bash .claude/task-check.sh` passes.

### Task 4: The crossfeed ITD and the pipeline delay caption convert through the time base

- **Files:** hqptuner/static/model/gauges/crossfeed.js, hqptuner/static/model/shell/pipelines.js
- **Reads:** hqptuner/static/model/gauges/crossfeed.js, hqptuner/static/model/shell/pipelines.js
- **Decisions:** D-04
- **Pins:** tests/js/model/gauges/crossfeed.test.js, tests/js/model/shell/pipelines.test.js, tests/js/store/faceplate/xref.test.js
- **Action:** The scope gives the time base every time conversion in the browser. The two left outside the meter path take theirs from it: the crossfeed ITD and its low-band figure, seconds to µs, and the pipeline row's delay, seconds to ms for its caption. The time base gains the seconds-to-µs factor if it lacks one. Every figure sent and every caption shown is unchanged character for character: this is no copy change, and no wording moves.
- **Verify:** Testing scope: no behavior changes; the crossfeed and pipeline suites already pin the figures and the caption; no new test; testing stops there. (1) `grep -n "1e6" hqptuner/static/model/gauges/crossfeed.js` and `grep -n "st.t \* 1000" hqptuner/static/model/shell/pipelines.js` print nothing. (2) `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/crossfeed.test.js tests/js/model/shell/pipelines.test.js tests/js/store/faceplate/xref.test.js` passes with the same count as before the task. (3) `bash .claude/task-check.sh` passes.

## Notes

- Planner's choice in Task 1, for the owner's eye: a frame that carries no converted end (only the phase 8 tables, and the hand-built frames other suites write in whole ms) has its end read as start plus length inside the structure. The alternative, a required end on `MeterFrame`, would force edits to the three frozen phase 8 tables, which AC7 forbids.
- `tests/js/store/meter/spectrum-delay.test.js` carries `SAME_S`, a time tolerance D-07 does not name by name; under the owner ruling of 2026-11-18 it is the same defect as `SAME_MS`, and Task 2 removes it.
