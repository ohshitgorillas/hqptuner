---
phase: 4
status: complete
completed: 2026-11-11
---

# Phase 4: Dimmed while HQPlayer is away - Summary

The plate takes a `data-away` mark while the health phase reads Down or Alarm, and draws it at the same `var(--op-2)` opacity as the restart dim. Every control stays live.

## What shipped

- `hqplayerAway` computed, read from `phase` alone (Down or Alarm is away; Reachable, Ready and no reading are not) - `hqptuner/static/store/faceplate/conn.js`
- `Plate` stamps `data-away`; `.plate[data-restarting],.plate[data-away]` share one rule - `hqptuner/static/components/faceplate/Plate.js`, `hqptuner/static/css/base.css`
- Unit tests for the computed and the mark - `tests/js/store/faceplate/conn.test.js`, `tests/js/components/faceplate/plate-away.test.js`
- Browser test: dimmed while the control lane is away, the Settings drawer still opens by tap, undimmed on return - `tests/e2e/test_plate_dims_while_hqplayer_away.py`
- The page dim named as a phase consumer in the lifecycle pipeline table - `docs/spec/lifecycle.md`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | b6c484a4 | dim the plate while HQPlayer has no connection |
| 1 | 2 | 1f849a37 | e2e: the plate dims while the control lane is away, every control stays live, and it undims on return |
| 1 | 3 | 183d26ac | lifecycle pipeline names the page dim as a phase consumer |

## Deviations

None - plans executed as written.

## Open items

- Human verify not done: with HQPlayer away for the dev container (for example the connection panel pointed at an address with no HQPlayer, then put back), the owner sees the whole plate dimmed, taps a control and sees it respond, and sees it undim once the address is restored. hqptuner:dev was rebuilt and is serving at :8090.
- This checkout's `.venv` has an editable install of `hqptuner` pointing at `.claude/worktrees/integrate/`. A gate run as `scripts/...` without `PYTHONPATH=$(pwd)` checks that tree instead: it made `check_openapi.py` report false drift in the first dispatch. Left as is; it may serve another session.
- `scripts/gate.sh make test-e2e` cannot finish in one command: the host test-timeout hook kills it at 600 s. The e2e files from `test_plate_dims_while_hqplayer_away.py` to the end were run instead (110 passed); files sorted before it were not re-run to completion.
- e2e needs `HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell` when `hqpcreds` is not sourced.
- `make check` missed the one-assertion-per-test gate on the new e2e file; only the pre-commit hook caught it (fixed in the code, no exemption).
- The executor piped one `scripts/gate.sh make check` run into `tail`, against the repo rule; the full log was kept by gate.sh.

## Goal check

The commits plausibly deliver the goal. `hqplayerAway` reads `phase.value === "Down" || phase.value === "Alarm"` (`b6c484a4`, `conn.js`), so a crash or a foreign restart dims as well as an own one, and Reachable or Ready undims with no reload. The dim is opacity only: the e2e test opens the Settings drawer by tap while dimmed (`1f849a37`), and the bite proof failed all 3 e2e tests with the three source files reverted. The restart dim is unchanged: `plate-restarting.test.js` is unedited and green. `PYTHONPATH=$(pwd) scripts/gate.sh make check` exited 0 and task-check passed. What is missing is the owner's own look at the dim at the hand-back URL.

complete locally, not CI-verified
