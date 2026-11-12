---
phase: 7
status: complete
completed: 2026-11-11
---

# Phase 7: Remove the 4321-only mode - Summary

HQPTuner refuses every engine write until both the 4321 control lane and the 8088 config lane are ready, through one ASGI gate (`hqptuner/api/readygate.py`), and every test fixture now starts an app or manager ready on both lanes against fakes that serve the captured 6.0.4 `/config` page.

## What shipped

- The fake 8088 `/config` page is the captured 6.0.4 page with state values moved in, and the fake 4321 enumerates the page's filter, oversampling, dither and modulator IDs - `tests/support/fake_http.py`, `tests/support/fake_control.py`
- Every manager fixture (`live_manager`, `http_manager_factory`, `start_manager`, per-file builders) hands over a manager only once `ready` reads true, else raises `FixtureError` - `tests/conftest.py` (`Runs.start`)
- Every test app builder (`live_app`, `api_client`, `http_client`, `gated_app`, per-file apps) hands over an app only once `/api/health` reads `ready`; the no-client state is reached through `POST /api/connection` with a blank pair (`apps.blank_the_pair`, `apps.blank_the_managers_pair`) rather than by writing manager internals - `tests/support/apps.py`, `tests/support/fixtures_clients.py`
- The readiness gate: every POST, PUT, PATCH and DELETE under `/api` outside the open set answers the refusal of its first cause while `ready` is false - `hqptuner/api/readygate.py`, `hqptuner/api/factory.py`
- Auto-pilot's junk-filter move and the LIVE re-assert send nothing while a lane is down - `hqptuner/core/autopilotops.py`, `hqptuner/lanes/live/lane.py`
- The gate is a normative rule - `docs/architecture.md` section 2.4
- The page: Apply, Save and Save as New are inert while not ready; a LIVE edit made while not ready is sent, refused by the gate, and the refusal shows on that control (D-08 as amended 2026-11-11) - `hqptuner/static/components/PendingBar.js`, `hqptuner/static/store/live/write.js`
- Comments, docstrings, log text and one `docs/openapi.json` description describe the two-lane app
- `CHANGELOG.md` entry under `[Unreleased]` / `### Fixed`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | 537bc34d | the fake 8088 config page is the captured 6.0.4 page |
| 1 | 2 | 1a27b1aa | the fake 4321 enumerates the page's filter, oversampling, dither and modulator IDs |
| 2 | 1 | 40d9409e | live_manager reads its own fake 8088 and hands over ready on both lanes |
| 2 | 2 | abbe9ea6 | the http manager fixtures run on a fake 4321 and hand over ready on both lanes |
| 2 | 3 | 2ad23564 | start_manager configures the 8088 port it dials |
| 2 | 4 | f93d70a9 | the api and engine per-file managers start ready on both lanes |
| 2 | 5 | d4771e68 | the apply per-file managers start ready on both lanes and lose a lane mid-run |
| 2 | 6 | 2b60c982 | the presets, speakers and cover-floor managers start ready on both lanes |
| 3 | 1 | 7ca14657 | live_app, live_api and chain_api serve an app with both lanes ready |
| 3 | 2 | 63613f8e | api_client serves a ready two-lane app |
| 3 | 3 | 75a2f11c | http_client and the credential-test app serve a ready two-lane app |
| 3 | 4 | ab7d97d7 | gated_app builds on both lanes |
| 3 | 5 | fd4caeb2 | the own-store suites run on a ready two-lane app |
| 3 | 6 | 5e3ce0c3 | the login, connection, host and discovery apps start with both lanes answering |
| 3 | 7 | 36bbf29a | the remaining tests/api apps start ready on both lanes |
| 3 | 8 | 6da05cb7 | the remaining per-file apps start ready on both lanes |
| 3 | fix | 85faba08 | risk_surface fix: no-client state through POST /api/connection; 4321-only-success and fabricated-form cases removed |
| 3 | fix | f3be6b21 | same-cause fix: manager-level no-client cases through the connection save |
| 4 | 1 | 31a0c563 | the refusal a not-ready app answers names its cause, the pair first |
| 4 | 2 | f6c8e112 | which requests the readiness gate holds is one decision |
| 4 | 3 | ac0280b8 | the six engine writes are refused until both lanes are ready |
| 4 | 4 | 27154d25 | own-store writes and the 4321 reads stay answered while the 8088 lane is down |
| 4 | 5 | 88ba9e45 | auto-pilot and the LIVE re-assert send nothing while a lane is down |
| 4 | 6 | 10e4ebda | the readiness gate is a normative rule in the architecture document |
| 4 | 3 | df0a487d | the changelog entry, first sentence of the owner's wording |
| 5 | 1 | 85c9e708 | Apply is inert and LIVE edits wait for both lanes |
| 5 | 2 | 0abfd055 | comments and docstrings describe the two-lane app |
| 5 | fix | 585e5fbe | risk_surface fix: a LIVE edit made while not ready is sent and the refusal shows |

## Deviations

- [deviation] Plan 4 Task 3: the owner's changelog entry was rejected by the `changelog-trivia` hook on "Previously" ("prior release behavior stated; reader needs current state"); the owner ruled to ship the first sentence only, committed as df0a487d.
- [deviation] Plan 5 Task 1: the LIVE hold was removed after the risk review (stale enumeration IDs on a held mode switch; held values overwriting newer edits). Owner ruling 2026-11-11: "this is getting too messy. don't stash, just tell the user that the apply failed". D-08 amended in CONTEXT.md; fix 585e5fbe.
- [deviation] Offline suite wall time rose from 36.8 s to about 99 s across the phase (the whole 6.0.4 page parsed by `parse_config_form` at about 8 to 10 ms a call, on every ready start). The owner approved the increase; the baseline was reset to 46.4 s before plan 1's continuation and to 58.3 s before plan 2's, and later runs were accepted inside the 5 to 10 s band.

## Open items

- The 502 answer of `ensure_form` on `/api/matrix` and `/api/speakers` has no test since plan 3's fix removed `test_form_routes_after_a_failed_fetch_are_bad_gateway`; a ready app can still reach that state (readiness reads `/config` alone). Filed as a public issue on the repository's tracker, fingerprint `5afef170c2af3964`.
- `parse_config_form` cost is now the bulk of suite time; a parse cache keyed on page text (production change) was discussed and not taken.
- Plan 4: the elapsed-time cases of Task 4 were not shown red (a stalled read hangs; a failure would show as a hang caught by the suite deadline).
- Plan 4: `/api/log` and `/api/meter/feed` are checked for status only; `/api/meter/feed` answers 204 in that fixture, so the stream is not exercised.
- Plan 4: the restart-window case covers `POST /api/autopilot` only.
- Plan 4: the gate answers the no-answer sentence (`ControlTimeoutError`) when the control lane is not connected, per D-05; the owner may prefer `ControlConnectionFailedError` there.
- Plan 3 and plan 5: no single risk-check record spans each plan's whole range; each plan's fired range and its fix range are recorded and settled separately, because the one re-arm round was spent.
- `make trivia` exits non-zero on uncommitted `.planning/` lines from other phases; none in a path this phase changed.
- `make test-e2e` needs `HQPTUNER_CHROMIUM` from `hqpcreds` on this host.

## Goal check

The commits plausibly deliver the goal. Every engine write is refused while `ready` is false (ac0280b8, `hqptuner/api/readygate.py`), and readiness needs both lanes, because `stamp_http_ok` sets `http_ok` only with a client and no `config_error` (`hqptuner/core/loader.py:123`). The two server-started writes send nothing while not ready (88ba9e45). The page keeps Apply inert while not ready, and a LIVE edit made then is sent, refused, and the refusal is shown (85c9e708, 585e5fbe). On the fixture side, every app and manager builder hands over only a ready two-lane install (40d9409e..2b60c982, 7ca14657..6da05cb7). Tests that pinned a 4321-only success were removed and named in the reports, among them the two autosave cases in 85faba08 and the `test_restart_survival.py` stored-boots cases. The no-client state is reached through the production connection path instead of manager writes (85faba08, f3be6b21). Two gaps remain. Readiness reads `/config` alone, so a ready app can still serve 502 on `/api/matrix` and `/api/speakers` with no test, filed as an issue. The read-side behavior with a lane down is checked for status only on `/api/log` and `/api/meter/feed`. Neither keeps a feature working over 4321 alone.

complete locally, not CI-verified
