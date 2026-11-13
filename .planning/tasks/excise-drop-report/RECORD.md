# Task: excise-drop-report

## What shipped

- Excised the dropped-settings feature on owner order: backend drop report, dropped_settings health field, DELETE /api/health/dropped-settings, settings-truth.md rule 8, api.md, openapi and faceplate.md text, the faceplate line and its client code. The risk_surface review raised one low finding, five stale test comments, fixed in 5c2e3007.

## Commits

| Task | Commit | Description |
| --- | --- | --- |
| 1 | 082482ca9a71fb4dcfbfc2c3026899da654dbd71 | refactor(health): excise the dropped-settings report from the backend, API and specs |
| 1 | 85fd14fbce570249b3ba5408f64e74369fe19039 | refactor(faceplate): excise the dropped-settings line and its client |
| 1 | 5c2e3007d8091cdb6733a6ef70e46d34f6c4e95b | test: drop stale dropped-setting wording from health fixture comments |

## Files

### Task 1: excise-drop-report

- **Files:** docs/spec/api.md, docs/spec/faceplate.md, docs/spec/openapi.json, docs/spec/settings-truth.md, hqptuner/api/routes/status.py, hqptuner/core/dropledger.py, hqptuner/core/lifecycle.py, hqptuner/core/loader.py, hqptuner/core/manager.py, hqptuner/core/readings.py, hqptuner/lanes/__init__.py, hqptuner/lanes/live/dropped.py, hqptuner/lanes/live/rate.py, hqptuner/static/lib/api.js, hqptuner/static/store/alerts/dropped.js, hqptuner/static/store/faceplate/alerts.js, tests/api/test_health_reading.py, tests/core/test_core_readings_engine_view.py, tests/core/test_dropped_settings.py, tests/core/test_lifecycle_outcomes.py, tests/e2e/test_sheet_top_tracks_plate_line.py, tests/js/components/faceplate-alerts/header-dropped-clear.test.js, tests/js/components/faceplate-alerts/header-dropped.test.js, tests/js/components/faceplate-alerts/plate-dropped.test.js, tests/js/components/faceplate-alerts/plate-unread-saves.test.js, tests/js/components/faceplate-alerts/plate-unread.test.js, tests/js/lib/api.test.js, tests/js/store/faceplate-alerts/alerts-dropped.test.js, tests/js/store/faceplate-alerts/alerts-unread-saves.test.js, tests/js/store/faceplate-alerts/alerts-unread.test.js, tests/js/support/plateline.js, tests/live/test_live_drop_report.py
