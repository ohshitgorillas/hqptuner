---
phase: 5
status: complete
completed: 2026-11-09
---

# Phase 5: Meter playhead on the loop's dt - Summary

The meter playhead now moves at wall speed on the paint loop's `dt` and jumps only by a changed delay. The spectrogram paints every landed slice on one column grid with no blending, the spectrum trace shows one whole frame per paint, and status pushes no longer re-render the meters. Meters, spectrum and spectrogram move smoothly through bursty feeds, and the owner passed it live.

## What shipped

- Playhead at wall speed: each paint at an unchanged delay advances by its wall time, stops at the newest queued frame's end, jumps by a changed delay, and restarts one delay behind at a break. Arrivals never change its speed. This replaces plan 1's 500 ms catch-up - `hqptuner/static/model/gauges/playhead.js`, `hqptuner/static/store/meter/loop.js`
- Timing spec states the playhead's rule (two-clocks paragraph, rules 1 and 2) - `docs/spec/timing.md`
- Bursty capture of the dev container's meter feed (effective delay 1247.682 ms, longest gap 211.9 ms) as a fixture - plan 2, `7593f50f`
- Spectrogram paints a landed slice into the columns it covers, including columns already scrolled in. Nothing interpolates except the ridges and fire effects. The trace shows one whole frame per paint - `hqptuner/static/lib/spectroraster.js`, `components/faceplate/drawers/source/paint.js`, `model/gauges/meter/steps.js`, `fire.js`, `components/faceplate/page/spectrumfx.js`, `sourcepaint.js`
- Spectrogram columns lie on one grid of playback, so a scrolled picture is the picture painted whole, pixel for pixel - `lib/spectroraster.js`, `paint.js`
- A status push, a hidden list or a meter range pick re-renders only the components that show what changed (`stable(read)` in `store/signals.js`, plus narrowed computeds). An unshown push went from 349 renders to 0, a hidden list from 82 to 0, a range pick from 27 wasted renders to 0 - 13 files under `hqptuner/static/store/` and `components/`
- Tests: browser test `tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py`; owner-approved contract tests under `tests/js/contracts/` (nine files) with the Safari paint fixture `tests/support/fixtures/safari_paint_schedule.json`; model and loop sweeps in `tests/js/model/gauges/playhead.test.js` and `tests/js/store/meter/loop-painters.test.js`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | 6438e843 | Timing spec: the playhead moves on dt toward the stamped target |
| 1 | 2 | 6f0432e3 | Playhead follows the target on dt with a catch-up (later replaced by plan 3, task 1) |
| 1 | 3-5 | - | `make check` exit=0; browser meter tests 3 passed; owner hand-back "Smooth, in time" |
| 2 | 1 | 7593f50f | Capture the dev container's bursty meter feed |
| 2 | 2 | - | Owner ruling on the playhead rule (recorded in PLAN-2.md) |
| 2 | 3 | - (in 7c7265b9) | Timing spec: a delay change jumps the playhead by the change |
| 3 | 1 | c89ed07a | Playhead moves at wall speed and jumps by a changed delay (tests first: 81 red) |
| 3 | 2 | e81858c0 | Loop hands every view the music each paint reached (16 red against the prior code) |
| 3 | 3 | 899128d2 | Browser test holds the painted spectrogram to no stutter through bursty feeds |
| 3 | 4 | - | Browser test red against both earlier playheads |
| 3 | 5 | - | Gate, meter e2e files, rebuild, hand-back (failed twice, passed on the third run) |
| 3 | 6 | 12b42740, 14ac32c5 | Every landed slice painted, no interpolation outside the effects, one whole frame per paint; browser test start gate |
| 3 | 7 | 3df4d8cf | Contract tests: playhead sweep replays the Safari capture, a long paint stall and slow-paint runs |
| 3 | 8 | c395ce9f | Spectrogram columns on one grid |
| 3 | 9 | 8fc34281, a68d15ce | Unrelated changes cost the meters no render; render-cost test waits out the boot fit pass (owner-approved edit) |

## Deviations

- [deviation] Plan 1, task 1: `make trivia` exited 2, with all 11 flagged lines in `.planning/` and none in `docs/spec/timing.md`. Left alone, since `.planning/` is outside the lease.
- [deviation] Plan 1, task 2: the Verify step named `npm test`, which does not exist ("Missing script: test"). The JS suite ran as `make test-js` inside `make check`, which was green.
- [deviation] Plan 3, task 6: the task 3 browser test's start gate expected 30 of 40 probed columns to differ, which only held while the time blend was in place. It is now 13 (`PROBE_COLUMNS // 3`), in 14ac32c5.
- [deviation] Plan 3, task 6: `spectrum-motion.test.js` dropped its trace evenness and freeze claims by owner ruling. Its flame stand-in now draws a fixed pseudo-random sequence, so the picture-freeze claim can hold. `pixelcanvas.js` was inlined because of the filepawl 30-file cap on `tests/js/support`.
- [deviation] Plan 3, task 9: the `render-cost.test.js` contract read `actual: 4, expected: 0` because of a pending Conversion copy-fit pass that `booted()` left behind. The owner approved one more `await quiesce(wire); page.settle();` at the end of `booted()`, landed in a68d15ce.
- [deviation] Plan 3: `hqptuner/static/app.js` is outside the lease and was not edited. `railNow` is a stable computed, so the unchanged `ChainBody` call no longer subscribes to the whole status.
- [deviation] Plan 3: `hqptuner/static/store/` is at its 15-file filepawl cap, so `stable` went into `store/signals.js`. `spectroraster.js` was held at its 401-line allowance by moving the overhang widening into `paint.js`.
- [deviation] Plan 3, task 7: contract 7 is read at one-column precision, contract 6's two clauses are one test, and the Safari run starts at the first frame's paint (details in `reports/plan-3.3.md`).

## Open items

- A 300 s window can trim a spectrogram slice that is still inside the window by the delay: `store/meter/spectrogram.js` drops slices that start more than 300 s before the newest end. A whole paint then shows glass where the scrolled picture keeps the slice, less than a column wide. The 30 s window the contracts run never reaches this. A left-edge repaint was declined because it needs a ranged `rasterize` and a fifth parameter, and the lint caps parameters at four.
- `faceplateAlerts`: `stable` compares by content, so a same-kind, same-text failure line keeps the `act` closure it first held. The closure for a kind clears the same signal each time, so tapping behaves the same.
- Contract tests: the fresh-paint comparison runs on every 5th paint and the last one, not every paint. Contract 5 reaches preact internals (`options.__r`, a component's `base`). Contract 8 (total scroll) is not owner-approved and was not written. The contracts have no browser lane.
- Plan 1's open items: the `loop.test.js` close, reopen and stop cases passed unchanged; no private `playhead` state in `loop.js`; the browser meter tests need `HQPTUNER_CHROMIUM` on this host.
- Risk review: `risk_surface` fired on 7c7265b9..3df4d8cf (round 1) and on 3df4d8cf..c8e6f319 (round 2, which also covers the owner's c8e6f319 gate commit). Both returned no findings.

## Goal check

The commits plausibly deliver the goal. c89ed07a makes the playhead advance by each paint's wall time and jump only by a changed delay, and its 81 new model claims went red against the earlier code. e81858c0 holds every view to the music each paint reached. 899128d2's browser test of the painted spectrogram failed against both earlier playheads (task 4: `192 <= 25.0` at 6438e843) and passes now. The stamps are still the only authority: the playhead stops at the newest queued frame's end and restarts from it at a break. The two failed hand-backs (blank columns, choppy spectrum, then "still stutters") are covered by 12b42740 (every landed slice painted, one whole frame per trace paint), c395ce9f (one column grid, contract 3 green on all 9 schedules) and 8fc34281 (349 status-push renders down to 0). The full contract suite under `tests/js/contracts/` is committed and green. `make check` and the three meter e2e files passed on c8e6f319. The owner answered "Passes" at the live hand-back. Plan 1's catch-up from 6f0432e3 no longer ships, because plan 3 replaced it after D-01 was revised. Nothing in the goal looks missing.

complete locally, not CI-verified
