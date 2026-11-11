---
phase: 2
status: complete
completed: 2026-11-10
---

# Phase 2: Modulators fit the output rate - Summary

The modulator picker grays every modulator whose `min_rate_hz` floor is above the SDM output rate in force, on all four pickers and the remembering Switcher slot, with the row's tier badge as the only reason; and a live write or live snapshot apply that makes playback stop now reports `playback_stopped` from the lane and shows as a failed apply reading "HQPlayer stopped playback while applying this."

## What shipped

- Rate-in-force gate on the modulator list (`sdmRateInForce`, `floorMark`) - `hqptuner/static/store/faceplate/lists/options.js`, `Opt.disabled` in `hqptuner/static/model/shell/option-list.js`
- Grayed row: `aria-disabled`, tier badge kept, no reason text, a tap does nothing - `hqptuner/static/components/faceplate/lists/Rows.js`, `hqptuner/static/css/sheets.css`
- A Switcher slot remembering an above-floor modulator is grayed and does not apply - `hqptuner/static/store/faceplate/bottom/switcher.js`, `hqptuner/static/components/faceplate/bottom/Switcher.js`
- Spec rule for the gate, with the badge as the reason - `docs/spec/faceplate.md:159`
- `LiveApplyReport.playback_stopped`, detected once in `_apply_batch` from the State read before and after the batch (2 then 0 or 3) - `hqptuner/lanes/live/lane.py`, `docs/spec/openapi.json`, `docs/spec/api.md`
- Client stop line `PLAYBACK_STOPPED` appended by `reportError` - `hqptuner/static/store/ui/wirelabels.js`, `hqptuner/static/store/live/state.js`
- Tests: `tests/js/store/faceplate-lists/rate-floor.test.js`, `tests/js/components/faceplate-lists/rate-floor-row.test.js`, `tests/js/store/faceplate/switcher-rate-floor.test.js`, `tests/js/components/faceplate-lists/rate-floor-surfaces.test.js`, `tests/live/test_live_stop_report.py`, `tests/js/store/live/live-stop.test.js`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | b31c4717 | Spec states the modulator gate against the rate in force |
| 1 | 2 | d9ee0e41 | Modulator list grays what the SDM rate in force cannot run |
| 1 | 3 | 74240ee6 | Grayed row marked disabled, takes no tap (reason text since removed by 6a) |
| 1 | 4 | d062e942 | Test: all four modulator pickers open the same gated list |
| 1 | 5 | a6f8b3c3 | A Switcher slot remembering an unsupported modulator is grayed |
| 1 | 6a | f0c2e12f | Grayed row shows no reason text; the rate badge is the reason |
| 1 | 6 | none | Gate green, task-check PASS, owner accepted at hand-back |
| 2 | 1 | 756b2a79 | Live report says when playback stopped under the batch |
| 2 | 2 | 01120876 | A live apply that stopped playback shows as a failed apply |
| 2 | 3 | none | Gate green, task-check PASS, owner accepted at hand-back |

## Deviations

- [deviation] Plan 1: the approved reason copy "Needs DSD512 or higher" was dispatched as one fixed string, so every grayed row read 512 whatever its floor (256+ and 1024+ modulators included). At hand-back the owner ruled the tier badge already states the floor; fix pass 6a removed the reason text and its styles, and the spec line now names the badge as the reason (f0c2e12f). The dispatch wording was the orchestrator's, not the executor's.
- [deviation] Plan 2: task 1 (756b2a79) was committed with `SKIP=mypy,suite-time,clock-waits,doc-refs` on a claim that the gates were red at the pre-plan HEAD. The red came from the wave worktree's environment (`.venv` symlinked to `/home/atom/dev/hqptuner/.venv`, `vendor/eqlab` submodule absent). mypy was re-run green on that commit with this repo's `.venv`, and the later `make check` runs at 01120876 and f0c2e12f were green with every gate.

## Open items

- `.venv`'s editable install resolves `hqptuner` to the stale `.claude/worktrees/integrate` tree; `make check` without `PYTHONPATH=$(pwd)` tests that tree (seen red at `check_openapi.py`). `task-check.sh` was run with `PYTHONPATH=$(pwd)` for that reason.
- No `phase_diff` review ran (gate `off`), so the interaction of the two plans merged in one wave went unreviewed.
- What the list grays while no SDM rate is in force (PCM chain, stopped, auto, missing reading) follows the plan: nothing is grayed. CONTEXT lists this as unsettled.
- A real playback stop against the production daemon was never reproduced; the stop line was checked through a browser fetch override, and the backend detection through the fake daemon.

## Goal check

The commits plausibly deliver the goal. The picker half: `floorMark` grays a modulator when `rate > 0 && floor > rate`, with the rate from the pin or the running `sdm_rate` (`hqptuner/static/store/faceplate/lists/options.js`), and d062e942 proves the four pickers share that list. a6f8b3c3 covers the remembered Switcher slot. Bite proofs are in `reports/plan-1.md` (for example 5 of 14 red at the parent of d9ee0e41). The stop half: `_apply_batch` compares State before and after the batch and sets `playback_stopped`, and `apply_preset` ORs its two batches (756b2a79, 4 stop cases red first). The client appends the approved line on that flag (01120876, 3 of 7 red first). `PYTHONPATH=$(pwd) scripts/gate.sh bash .claude/task-check.sh` passed at f0c2e12f and the container served. The owner checked both at the hand-back URL and answered "pass". `risk_surface` raised 0 findings on `756b2a79..f0c2e12f` and on `391c02dd..01120876`. Nothing in the goal looks missing; the no-SDM-rate case remains as the plan defined it.

complete locally, not CI-verified
