---
phase: 7
status: complete
completed: 2026-11-19
---

# Phase 7: One time base - Summary

Every conversion between samples, milliseconds, microseconds and seconds now lives in `hqptuner/static/lib/timebase.js`, every production and test caller reads it, 279 unjustified clones are gone, and the jscpd threshold dropped from 2.3 to 0.33.

## What shipped

- The time base and its conversions (`samplesToMs`, `usToMs`, `secondsToMs`, `secondsToUs`, `msToSeconds`, `MS_PER_S`) - `hqptuner/static/lib/timebase.js`
- Feed stamps, spectrum delay, apodizing scale, Source drawer time axis, crossfeed ITD and pipeline delay caption convert through the time base - `hqptuner/static/store/meter/`, `hqptuner/static/components/`
- The playback model and spectrogram history read frame start and end from the time base; the playhead moves by exactly the paint's wall time - `hqptuner/static/model/gauges/`
- Painters, VU needle, meter steps and flames run on `dt` in ms - `hqptuner/static/model/gauges/meter/`, `hqptuner/static/store/meter/loop.js`
- Test contracts on the time base with exact comparisons, no `EPS`, no `SAME_MS` - `tests/js/contracts/`, `tests/js/model/gauges/playhead.test.js`, `tests/js/store/meter/`
- The timing spec names the time base as owner of the conversion - `docs/spec/timing.md`
- Production JavaScript clones gone: one popover placement routine, one `HIDEABLE`, one `chainCurves` - `hqptuner/static/components/`
- Production Python clones gone: one SSE relay, one too-new-store error, scripts import engine code - `hqptuner/api/push.py`, `hqptuner/presets/store/jsonfile.py`, `hqptuner/engine/metering.py`
- Junk-burst and junkcal tooling shares its loaders, scorers and tallies - `scripts/junkburst/`, `scripts/junkcal/`
- Probe plumbing lives once - `scripts/probes/kit/probekit.py`; one console recorder for page captures - `scripts/sweepslide.py`
- Shared test rigs for server, browser, gate, lane, store, drawer, component and meter suites - `tests/support/`, `tests/js/support/`
- The duplication budget: 33 clones, all of a justified kind, threshold 0.33 - `.jscpd.json`; `CODEC_HOLDS` has one home - `tests/support/field_codecs.py`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | 0d47ec2c | Feed stamps come from one samples-to-ms conversion |
| 1 | 2 | 0fbca80a | The spectrum delay is ms from the delay store on |
| 1 | 3 | 1fe71234 | Apodizing scale and Source drawer time axis convert through the time base |
| 1 | 4 | 45eabf35 | Crossfeed ITD and pipeline delay caption convert through the time base |
| 2 | 1 | 12a32005 | Pacing decision reads frame start and end through the time base |
| 2 | 2 | f1a8db41 | Spectrogram slices end where their last frame ends |
| 2 | 3 | 12d27edb | Playhead moves by exactly the paint's wall time |
| 3 | 1 | 376f17a8 | The VU needle moves on dt in ms |
| 3 | 2 | a6b0ee73 | The meter steps and the flames move on dt in ms |
| 3 | 3 | 5d4e572e | The painters take dt in ms |
| 3 | 3 | 2fab7ba8 | Follow-up: aurora-glsl test header says ticks of 15.625 ms |
| 3 | 4 | 32d40b97 | The meter loop hands painters dt in ms |
| 3 | 5 | bf71b9d1 | The two dt error messages say ms |
| 4 | 1 | 39e3649f | World stamps frames through the time base |
| 4 | 2 | 159b81bb | Schedules convert through the time base |
| 4 | 3 | 0ab227d9 | Trace probes exact |
| 4 | 4 | 4bb30ac1 | Playhead suite converts nothing itself |
| 4 | 5 | 31b36134 | Playhead suite exact |
| 5 | 1 | 0d7ae929 | The spec names the time base as owner of the conversion |
| 6 | 1 | dd3541d0 | One routine parks a popover under its trigger |
| 6 | 2 | 67459d1c | The remaining production JavaScript clones go |
| 7 | 1 | 0772cc8d | One relay serves both server-sent event streams |
| 7 | 2 | none | No change: Protocol against TypedDict cannot share a field list |
| 7 | 3 | 28aefc3d | One too-new-store error serves both preset stores |
| 7 | 4 | none | No change: TypedDict against dataclass, and totality differs |
| 7 | 5 | 72f881fb | Scripts that copied engine code import it |
| 8 | 1 | b715dc29 | The junk-burst feature helpers live once |
| 8 | 2 | 72d23a04 | One burst loader and one scorer serve the junk-burst views |
| 8 | 3 | c67d62f1 | The two corpus runners share their tallies and report |
| 8 | 4 | d22f5c80 | The junkcal evaluators share their fill reading |
| 9 | 1 | f067131e | The probes' daemon plumbing lives once |
| 9 | 2 | 3983688b | The rate probes share their slot lookup and their restore |
| 9 | 3 | 9f8c1b5f | One console recorder serves the page captures |
| 10 | 1 | b83ae997 | One builder makes the app and its config for the API suites |
| 10 | 2 | b71856e8 | The API route suites share their fixtures |
| 10 | 3 | dd9a9281 | One rig stands the manager up for the manager suites |
| 10 | 4 | e3f21db8 | The audit suites share their log fixture and app |
| 10 | 5 | 76aef2b2 | The core suites share transports, readings and the lifecycle wire table |
| 10 | 6 | 50ffb77d | The fake daemon servers and the script loaders live once |
| 11 | 1 | a36d7270 | The browser suites share their page scripts and settle wait |
| 11 | 2 | 860925a7 | The gate suites share their fixture layers and script loaders |
| 11 | 3 | aa0333cb | The live-lane suites share their hooks and modes |
| 11 | 4 | 59d27ec9 | The matrix profile suites share their readers |
| 11 | 5 | ca3f2a15 | The preset store suites share their store builders |
| 12 | 1 | c00f2a1b | The Output drawer suites share one rig |
| 12 | 2 | 3921dc07 | The drawer family suites share homes, loaders and staged rows |
| 12 | 3 | 24b83528 | The remaining drawer suites share their fakes and renderers |
| 13 | 1 | e86e59a9 | The builder suites share their wire, readings and staged rows |
| 13 | 2 | ed9c2027 | The control suites share their input fake and their tables |
| 13 | 3 | f602bc1f | The alert suites share their unread-saves rig |
| 13 | 4 | cd5de7ee | The list and page suites share their loaders and button tables |
| 13 | 5 | 4d525175 | The state import suites share their rig |
| 13 | 6 | 9015090a | The faceplate suites share their page, panel and switcher rigs |
| 13 | 7 | d2212a3c | The app and matrix suites drop their copied cases |
| 14 | 1 | 62fc782d | The core store suites fold their copied cases |
| 14 | 2 | d8a44fca | The live store suites share their re-enumeration rig |
| 14 | 3 | e21b673c | The guard suites share their staging wire |
| 14 | 4 | 1c0a9154 | The narrowing suites share their facet and metadata rigs |
| 14 | 5 | efa5fa3f | The panel, restart and easy suites share their rigs |
| 14 | 6 | 212d7722 | The list, profile and layout store suites share their rigs |
| 14 | 7 | a978b37c | The support wires, storage fake and library suites share once |
| 15 | 1 | d724dc82 | The dropped-frame feed table is built from the contiguous one |
| 15 | 2 | 23db951f | The meter store suites share their feed and loop rigs |
| 15 | 3 | e43c6941 | The contracts share their seeded generator and their probe run |
| 15 | 4 | 90359e9b | The meter store suites and the Source paint suite convert no time themselves |
| 15 | 5 | 153f78e1 | The meter store suites judge the playhead and the covering frame exactly |
| 16 | 1 | 0b9df429 | The codec table has one home and the jscpd threshold is what the repository measures |

## Deviations

- [deviation] Plans 1, 2, 3, 6, 7, 11: the Verify step `bash .claude/task-check.sh` could not pass. It runs `make check` first, which stops at `test-js` on the 12 baseline-red playhead tests (AC7), so no dev container rebuild ran and no hand-back URL was produced for any plan of this phase.
- [deviation] Plan 3 task 1: `vu-motion.test.js` was expected red against the old `vu.js` and stayed green; its cases compare settled needles, which hold in either unit. No new case, per the task's testing scope.
- [deviation] Plan 3 task 2: `meter-math.test.js` was expected red and has no time input; left unchanged.
- [deviation] Plan 3 task 3: only `spectrum-motion.test.js` and `timebase.test.js` went red before the change; the sourcepaint, spectrumfx and aurora suites assert same-time-same-picture and stayed green.
- [deviation] Plan 3 task 5 was committed before task 4, on the owner's ruling of 18 Nov that the two error messages need no wording approval (bf71b9d1 before 32d40b97).
- [deviation] Plan 16: the plan as written could not be met. Owner rulings of 2026-11-19 replaced two stop conditions: the `CODEC_HOLDS` table moved to a shared home (lease widened to three test files), and the gate stays per-format with the threshold at the lowest value every per-format run passes (0.33; Python measures 0.3241% of lines). AC1 in `CONTEXT.md` was reworded to match. jscpd compares the lines percentage, not tokens as the plan read it.
- Plans 4, 5, 8, 9, 10, 12, 13, 14, 15: executed as written.

## Open items

- The 12 AC7 baseline playhead tests stay red (8 in `playhead-lag.test.js`, 3 in `playhead-motion.test.js`, 1 in `playhead-scroll.test.js`); they are phase 8's tables. `make check` therefore exits non-zero and `task-check.sh` never reaches its rebuild.
- Owed to the owner's eyes at a hand-back URL, never shown: the Source page meters, spectrum styles and aurora (plan 3); the Source drawer's spectrogram (plan 2); each popover, the Visual settings drawer and the matrix plot (plan 6).
- `docs/spec/timing.md` line 71 holds a pre-existing em dash; removing it needs owner wording (plan 5).
- Plan 5's executor piped one `make check` run through `tail -40`, against the repo rule; the full log was kept and read.
- `scripts/junkcal/junkcal_view.py` keeps the alias `median_smooth` and `scripts/junkcal/junkcal_seq.py` keeps the alias `full_curve`, each for one importer outside the plans' leases (`junkcal_cli.py`, `junkcal_why.py`).
- `median_smooth` now raises `StatisticsError` on a negative width where the view's old copy returned a copy; reachable only through a negative `--smooth` on the junkcal CLI (plan 7).
- `hqptuner/presets/store/narrowingjson.py`: the `FacetInput` docstring says every value is typed `object` while the fields are typed concretely (plan 7).
- `scripts/junkcal/junkcal_burst.py` has its own raw-bytes `_read_frame`; `jbpolicyyield._yield_veto_forces_real` repeats `veto_forces_real`; a third `_handshakes` helper stays in `tests/apply/manager/test_manager_handshake_answered_error.py`. None is a jscpd clone at 50 tokens and each was outside its plan's lease.
- Shared helpers sit in second-choice homes because a lease named no better one: `askedWire` in `tests/js/support/rendered/treewalk.js` (plan 13), `seenOnce` in `tests/js/contracts/schedules.js` (plan 15), preset and live tables imported from sibling test modules (plan 11). Per-directory `conftest.py` files the plans named were not created: a second one shadows the bare `from conftest import` (plans 10, 11).
- `display-delay.test.js` keeps its own minimal fake DOM, and `aurora-glsl.test.js` keeps a relative-tolerance canvas comparer; neither compares wall times (plans 3, 13).
- Plan 3 added no test of the aurora's `time` uniform in seconds; `msToSeconds` has its one case.
- Corpus at `/srv/hqptuner/state/junkburst/` was absent; plan 8's byte-identity check used a synthetic harness.
- Only one e2e file was run in plan 10; plan 11 ran its 11 e2e files (109 passed). The full `make test-e2e` was not run in this phase.
- Commits a6b0ee73 and both plan 6 commits used `SKIP=` under the owner's active red-commit override.
- The config carries four keys retired in Cadence v4.4.0 (`planning.workflow_plans`, `workflow.use_workflows`, `workflow.multi_workflow`, `workflow.execute_workflows`); they are ignored and warn on every resolve.

## Goal check

The commits plausibly deliver the goal. One home for conversions: `grep -rnE "(MS|US)_PER_S\s*=" hqptuner/static tests/js` prints two lines, both in `hqptuner/static/lib/timebase.js` (lines 5 and 7), which is AC2. Callers use it: plans 1 to 4 and 15 report the feed store, playhead, meter loop, painters, `world.js`, `schedules.js` and the probes converted, and the AC4 and AC5 greps (`MS_PER_S` under `components` and `model/gauges/meter`, `_S` constants in `steps.js`, `SAME_MS` under `tests/js`, `EPS` in `trace-probes.js`) print nothing on the final tree. The spec names the owner: `grep -c "lib/timebase.js" docs/spec/timing.md` prints 3 (AC6). Duplication: the final gate log `/tmp/gate-make-bjYbR9g4.log` shows `Found 22 clones.` (python), `Found 11 clones.` (javascript) and `Found 0 clones.` (css), 33 against a bound of 43, with `.jscpd.json` at `"threshold": 0.33`; that each of the 33 is of a justified kind rests on the plan 16 executors' reading plus the owner's ruling on four borderline import-led clones, not on a reading of mine. No regression: the same log shows `3676 passed` for pytest and 12 `not ok` lines for JavaScript, and none of the 12 falls outside the four baseline name patterns; `git diff --stat 503ddec8` over the three playhead table files prints nothing (AC7). What is missing: the "bit for bit" criterion is proven by exact-equality tests, not by any run in a browser, and no visual change of this phase has been in front of the owner, because the 12 baseline reds stop `task-check.sh` before its rebuild. The duplication claim is bounded by jscpd's 50-token floor; the open items name three smaller repeats it does not see.

complete locally, not CI-verified
