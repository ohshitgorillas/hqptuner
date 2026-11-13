---
task: excise-drop-report
branch: rebuild/integrate
base: a3d08308
---

# Task: excise the dropped-settings feature

Owner order, 2026-11-07, verbatim: "Excise". The feature: after a daemon restart the backend compares readings before and after (the "drop report"), serves the reverted live settings as `dropped_settings` on `GET /api/health`, clears them on `DELETE /api/health/dropped-settings`, and the faceplate shows a line under the top bar naming them with a clear action. After this task none of it exists: no endpoint, no field, no line, no spec rule, no test of it.

Binding for every file below: this is a removal, not a rebuild. No file is restored from history and no history is read for content. Deleting a test that exists only for the excised feature is part of the order; any other test is never edited to pass. `CHANGELOG.md` is the owner's alone and is not touched. No gate exemption is added.

Out of scope, stays as it is: the lifecycle's `Outcome` enum, `Standing.ended`, `outcome()` and `Lifecycle.outcome()` as they stood at fe97fb16 (they are `docs/spec/lifecycle.md` rule 10's, not the drop report's); the `taken` Down handling from 145017b7 (lifecycle.md line 39); `DroppedFields` in the audit (`hqptuner/audit_types.py`, `audit_narrow.py`, openapi audit schema), `engine/junkrun.py` `DROPPED`, `tests/audit/test_dropped_write_audit.py`; `components/faceplate/AlertLines.js`, `Header.js`, `Popover.js` `useBodyResize` and the generic `plate` alert home.

## Task 1: backend, API and specs

Files: `hqptuner/lanes/live/dropped.py`, `hqptuner/core/dropledger.py`, `hqptuner/core/readings.py`, `hqptuner/core/loader.py`, `hqptuner/core/manager.py`, `hqptuner/core/lifecycle.py`, `hqptuner/lanes/__init__.py`, `hqptuner/lanes/live/rate.py`, `hqptuner/api/routes/status.py`, `docs/spec/api.md`, `docs/spec/openapi.json`, `docs/spec/settings-truth.md`, `docs/spec/faceplate.md`, `tests/core/test_dropped_settings.py`, `tests/live/test_live_drop_report.py`, `tests/e2e/test_sheet_top_tracks_plate_line.py`, `tests/api/test_health_reading.py`, `tests/core/test_lifecycle_outcomes.py`, `tests/core/test_core_readings_engine_view.py`, `tests/e2e/conftest.py`, `tests/e2e/support/stack.py`.

Action: delete `lanes/live/dropped.py`, `core/dropledger.py` and their tests; remove the held reading (`Readings.held`, the hold in `break_engine`, `take_held`), `loader._report_drops` and its call, the manager's ledger and its wiring into `Lifecycle`, the lifecycle outcome listener (`on_outcome`, `_unheard`, `_named` and the emit) where it exists only to feed the ledger, the `dropped_settings` health field and the DELETE route. Remove tests that exist only for those pieces; in a shared test file remove only the cases or keys that name them. Specs: settings-truth.md rule 8, the "Drop report" table row and every sentence naming the drop report; api.md's `dropped_settings` and DELETE paragraphs and schema lines; openapi.json's `Dropped` schema, the `dropped_settings` property and its `required` entry, and the `/api/health/dropped-settings` path; faceplate.md's paragraph for the line. Before cutting rule 8, run `grep -rn "settings-truth.md rule\|settings-truth rule" docs hqptuner tests scripts`. If anything cites rule 9 or later, update each citation to the renumbered rule. Comments and docstrings naming the drop report are rewritten to state what holds now, or cut. The e2e support code: if `tests/e2e/conftest.py` or `support/stack.py` clears the report between tests, remove that call.

Verify: `grep -rn -i "dropped_settings\|dropped-settings\|dropledger\|lanes.live.dropped\|lanes/live/dropped\|drop report\|_report_drops\|take_held" hqptuner docs tests scripts` prints nothing; `scripts/gate.sh .venv/bin/pytest -m "not live" -q` exits 0; `scripts/gate.sh .venv/bin/lint-imports` exits 0.

## Task 2: faceplate line and client

Files: `hqptuner/static/store/alerts/dropped.js`, `hqptuner/static/store/faceplate/alerts.js`, `hqptuner/static/lib/api.js`, `hqptuner/static/store/core/readings.js`, `hqptuner/static/store/sync.js`, `tests/js/store/faceplate-alerts/alerts-dropped.test.js`, `tests/js/components/faceplate-alerts/header-dropped.test.js`, `tests/js/components/faceplate-alerts/header-dropped-clear.test.js`, `tests/js/components/faceplate-alerts/plate-dropped.test.js`, `tests/js/components/faceplate-alerts/plate-unread*.test.js`, `tests/js/store/faceplate-alerts/alerts-unread*.test.js`, `tests/js/lib/api.test.js`, `tests/js/support/**` where they name the feature.

Action: delete `store/alerts/dropped.js` and its four test files; remove `droppedAlert` from `store/faceplate/alerts.js`, `clearDroppedSettings` from `lib/api.js` and its tests, and any `dropped_settings` handling in the store; drop the `dropped_settings` key from the shared fixtures. Report, without changing it, whether any producer still raises an alert into the `plate` home once the dropped line is gone.

Verify: `grep -rn -i "dropped_settings\|droppedalert\|cleardropped\|dropped-settings\|DROPPED_MESSAGE" hqptuner/static tests/js` prints nothing; `scripts/gate.sh npm test` exits 0.

## Task 3: the whole gate

Verify: `PYTHONPATH=$(pwd) nice -n 19 scripts/gate.sh make check` in this worktree exits 0. The e2e suite is not run (about 590 s); its proof is Task 1's grep over `tests/e2e`.
