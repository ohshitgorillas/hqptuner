---
phase: 5
status: complete
completed: 2026-11-07
---

# Phase 5: Meter playhead on the loop's dt - Summary

The meter playhead now advances on the paint loop's `dt` toward the stamped target, closing any lag with a 500 ms time constant (`CATCH_UP_MS`), so meters, spectrum and spectrogram move smoothly while frames arrive in bursts.

## What shipped

- Playhead catch-up on `dt`: closed form `head + (lag + CATCH_UP_MS) * -expm1(-dt / CATCH_UP_MS)`, stopped at the target from behind and at the newest queued end from ahead - `hqptuner/static/model/gauges/playhead.js`
- Loop passes `painted.dt` and the last paint's playhead into the one `pacePaint` call in `paint()` - `hqptuner/static/store/meter/loop.js`
- Timing spec reworded to the dt-driven playhead (two-clocks line, rules 1 and 2, "Feed event length" row) - `docs/spec/timing.md`
- Tests: `tests/js/model/gauges/playhead.test.js`, `tests/js/store/meter/loop.test.js`, `tests/js/store/meter/loop-painters.test.js`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | 6438e843 | Timing spec: the playhead moves on dt toward the stamped target |
| 1 | 2 | 6f0432e3 | Playhead follows the target on the loop's dt and closes any lag smoothly (tests first; bite proof 23 red of 185 against the prior code) |
| 1 | 3 | - | Offline gate: `scripts/gate.sh make check` exit=0 |
| 1 | 4 | - | Browser meter tests: 3 passed with `HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell` |
| 1 | 5 | - | Hand-back: `task-check` exit=0 at 6f0432e3; owner chose "Smooth, in time" at http://10.0.0.238:8090 |

## Deviations

- [deviation] Task 1 Verify expected `scripts/gate.sh make trivia` to print `exit=0`; observed exit=2, all 11 flagged lines in `.planning/phases/5/CONTEXT.md` and `PLAN.md`, none in `docs/spec/timing.md`. `.planning/` is exempt from the trivia judges; `make trivia` judges it only because `md_skip` matches exact paths.
- [deviation] Task 2 Verify named `scripts/gate.sh npm test`; observed "Missing script: test" (exit=1). The JS suite runs as `make test-js` inside `make check`, which was green.

## Open items

- The plan listed the `loop.test.js` close, reopen and stop cases as needing repair; they pass unchanged (a restart paint stands at the target), so they were left alone.
- Declined: no separate private `playhead` state in `loop.js`; the loop reads its own `playhead` signal, which only the loop writes.
- Browser meter tests need `HQPTUNER_CHROMIUM` set on this host; unset, they error at setup (chromium not found under `~/.cache/ms-playwright`).

## Goal check

The two commits plausibly deliver the goal. `6f0432e3` changes `playhead.js` so the playhead moves at every paint by `dt` toward the target instead of jumping to it, and `loop.js` feeds it `painted.dt`. The target is still derived from the stamps only, and the playhead never passes it from behind. The new invariants (`never_moves_backward`, `never_jumps_further_than_its_speed_allows`, moves at a paint where no frame arrived) went red against the prior code and green after. `6438e843` brings `docs/spec/timing.md` into line. The owner confirmed on the rebuilt container that the meters, spectrum and spectrogram move smoothly and in time. Nothing in the goal looks missing.

complete locally, not CI-verified
