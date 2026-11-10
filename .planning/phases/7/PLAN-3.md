---
phase: 7
plan: 3
# Phase 7 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against the five Success Criteria and CONTEXT AC1-AC7.
requirements: []
files:
  - tests/support/apps.py
  - tests/support/fixtures_clients.py
  - tests/live/test_live_chain.py
  - tests/api/test_api_errors.py
  - tests/api/test_api_error_codes.py
  - tests/presets/test_favorites.py
  - tests/presets/test_narrowing_store.py
  - tests/presets/test_matrix_mode_routes.py
  - tests/presets/test_description_routes.py
  - tests/presets/test_autosave.py
  - tests/api/
  - tests/
  - .filepawl.toml
---

# Phase 7: Remove the 4321-only mode - Plan 3: Every test app runs both lanes

## Goal

HQPTuner requires both the 4321 control lane and the 8088 config lane. This plan makes every REST app a test builds the supported install: both fakes answering, the 8088 forms loaded and `ready` true before the case acts, with `unserved_login` kept only as the builder of a not-working app, and no test asserting a feature that works with 8088 down (ROADMAP SC2, D-10, D-11, AC4).

## Must be true when done

- `live_app`, `live_api`, `chain_api`, `api_client`, `http_client`, `gated_app`, the credential-test `app` in `tests/support/fixtures_clients.py` and the `chain_api` copy in `tests/live/test_live_chain.py` each serve an app whose `/api/health` reads `ready` true, with a 4321 fake and an 8088 fake both answering, before the case gets the client; one that cannot reach it raises `FixtureError`.
- No builder in `tests/support/` or `tests/conftest.py`, and no per-file `create_app(` builder, starts an app with a closed control port or without credentials as a working install; `unserved_login` is used only by cases whose subject is the not-working answer (AC4).
- Every REST test of a not-working answer (8088 down, refused, unread, no client, 4321 down) starts from a ready app and takes the lane away mid-run, or is an `unserved_login` case, or is a startup case on an app with neither lane answering (D-11 as amended).
- No test asserts a feature succeeding with the 8088 lane down; each removed test is named in the hand-back with the 4321-only behavior it pinned.
- The own-store suites (favorites, narrowing, descriptions, matrixmodes, autosave) still prove their routes never touch hqplayerd, now from a two-lane app by the fakes' own traffic.
- `scripts/gate.sh make check` exits 0 after each task.

## Context

- Locked: D-10 (every app builder and each per-file `create_app(` built with both fakes answering and the 8088 forms loaded), D-11 (refusal tests rebuilt on the two-lane install with the lane taken down mid-run, via `_take_lane_down` in `tests/support/fake_http.py`; `unserved_login` survives only as a not-working builder; tests pinning 4321-only behavior removed, or rebuilt on both lanes as owner-approved behavior changes, tests-first; owner amendment: a startup-subject test may start with neither lane answering, never with one lane only), D-06 (no client is a reachable state), D-14, D-15 (the test-side comment lines listed there are rewritten with their builders).
- Readiness is `/api/health` `ready` (D-01), the field `wait_for_api` can wait on in place of `_reachable`. Every fake is in-process (`docs/testing.md` rule 18). `log_in` needs the 8088 fake answering, which every two-lane builder now has for its whole life.
- Tests are never edited to pass. A case that can only be stated on an app that starts broken, such as a startup subject that cannot be reached mid-run, goes to the owner as a blocking question listed in the hand-back; it is neither kept on a broken builder nor deleted silently.
- Every gate run through `scripts/gate.sh`; `filepawl accept` whenever filepawl prints it. This plan follows Plan 2.

## Tasks

### Task 1: `live_app`, `live_api` and `chain_api` gain the 8088 lane

- **Files:** tests/support/apps.py (module docstring, `live_app`, `_reachable`), tests/support/fixtures_clients.py (module docstring, `live_api`, `chain_api`), tests/live/test_live_chain.py (module docstring, `_live_app`, `chain_api`), tests/api/test_api_error_codes.py, tests/ (fallout: the files using `live_api` or `chain_api`), .filepawl.toml
- **Action:** Make `live_app` build its app with credentials and its own in-process fake 8088 daemon that answers for the app's whole life (no longer through `unserved_login`, which takes the lane down before the app starts), wait on `ready` rather than `reachable`, and tear the fake down after the client; `live_api` and `chain_api` follow, and `tests/live/test_live_chain.py`'s private `_live_app` and `chain_api` copy the same build. Rewrite the docstrings that call these builders control-only or 4321-alone (`tests/support/apps.py` module docstring and `live_app`, `tests/support/fixtures_clients.py` module docstring and `chain_api`, `tests/live/test_live_chain.py` `_live_app` and `chain_api`) so they describe the two-lane build (D-15), passing `triviajudge`. In `tests/api/test_api_error_codes.py`, the cases that read "no credentials" off `live_api` (`test_config_without_credentials_is_unavailable`, `test_config_without_credentials_carries_code_no_credentials`) are rebuilt on a ready app that reaches the no-client state mid-run, or on `unserved_login`. Run the suites on these fixtures; LIVE-success cases now run with both lanes and stay; a case that asserted success only because 8088 was absent is removed and named in the hand-back.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/live tests/api tests/presets/test_autosave.py` prints `exit=0`. Testing scope: every handover ready on both lanes, checked by the builder on each use; the rebuilt no-credentials cases keep their code assertions; no new test; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 2: `api_client` serves a two-lane app

- **Files:** tests/support/fixtures_clients.py (`api_client`), tests/api/test_api_errors.py, tests/ (fallout: the files using `api_client`), .filepawl.toml
- **Action:** Build `api_client` on both fakes answering, credentials set and `ready` reached, instead of a closed control port with no credentials through `unserved_login`; rewrite its docstring (D-15). Rebuild the `tests/api/test_api_errors.py` cases that assert a not-working answer on it ("live routes without a connected daemon": volume, matrix profile switch, staged live apply; "snapshots before the first daemon load") so each starts ready and takes the lane away mid-run, then asserts the same code; a case whose subject is a state no running app can return to (the snapshot before any load) is rebuilt on `unserved_login` if that expresses it, else raised to the owner. Cases that used `api_client` only for its guards and buffering keep asserting them on the two-lane app.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/api tests/presets/test_favorites.py tests/engine/test_control_stall.py tests/test_autoeq.py` prints `exit=0`. Testing scope: the refusal codes stay asserted from a two-lane start; no new test; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 3: `http_client` and the credential-test `app` gain a control lane

- **Files:** tests/support/fixtures_clients.py (`http_client`, `app`), tests/api/test_api_errors.py (`half_wired_client`, `deaf_client`, `nocreds_client` and the cases on them), tests/ (fallout: the files using `http_client`), .filepawl.toml
- **Action:** Give `http_client` and `app` a fake 4321 daemon instead of `closed_port`, and wait for `ready` before `log_in`; rewrite the `http_client` docstring that says http-only operations never touch the control lane (D-15). Rebuild the `tests/api/test_api_errors.py` builders that start broken: `nocreds_client` (no credentials), `deaf_client` (nothing on the 8088 port) and `half_wired_client` (forms failing) each start ready on both lanes and move into their state mid-run (no client, `_take_lane_down`, `_fail_paths`), and the cases on them keep asserting the same status or code. `test_form_routes_before_any_fetch_are_unavailable` stays, on its own app started with neither lane answering (D-11 owner amendment), since its subject is the start before any fetch; it keeps asserting 503. Run the `http_client` suites and rebuild each case the live control lane now moves.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/api tests/apply tests/matrix tests/presets tests/audit tests/engine` prints `exit=0`. Testing scope: same behaviors from a two-lane start; no new test; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 4: `gated_app` builds on both lanes

- **Files:** tests/support/fixtures_clients.py (`gated_app`), tests/api/login/test_connection_keeps_login.py, tests/api/login/test_login_gate.py, tests/api/surface/test_cross_site_refused.py, .filepawl.toml
- **Action:** Give `gated_app` a fake 4321 daemon instead of `closed_port`, so every app it builds reaches `ready` with the pair in force; keep its shared state directory (a second app is a restart of the first), its `clock`, `pair` and `audit` arguments, and its rule that nothing is logged in. An app built with a pair the 8088 fake does not accept is a not-working app: rebuild such a case so it starts ready and changes the pair mid-run, or raise it to the owner.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/api/login tests/api/surface` prints `exit=0`. Testing scope: login and cross-site cases keep their codes; no new test; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 5: The own-store suites run on a two-lane app

- **Files:** tests/presets/test_favorites.py, tests/presets/test_narrowing_store.py, tests/presets/test_matrix_mode_routes.py, tests/presets/test_description_routes.py, tests/presets/test_autosave.py, .filepawl.toml
- **Action:** These suites build apps with no credentials and a closed control port so that "a route that answers at all answered without hqplayerd". Build them on both fakes answering and `ready` (the shared builders or their own, per file), and carry that proof over to the fakes' traffic: the 4321 fake's command log and the 8088 fake's request record show no write from the route under test. Rewrite the module and builder docstrings that describe the closed-port, no-credentials build (D-15: the favorites, narrowing, descriptions and matrixmodes suite docstrings), passing `triviajudge`.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/presets` prints `exit=0`. Testing scope: the never-touches-hqplayerd outcome stays asserted, now off fake traffic; the existing route tests carry it; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 6: Per-file apps in the login, connection, host and discovery suites run both lanes

- **Files:** tests/api/login/test_login_host.py, tests/api/login/test_login_network.py, tests/api/login/test_login_route.py, tests/api/surface/test_alias_marker.py, tests/api/surface/test_connection_host_rule.py, tests/api/surface/test_startup_bad_host.py, tests/api/test_connection.py, tests/api/test_connection_lane.py, tests/api/test_container_host_alias.py, tests/api/test_credentials_rejected.py, tests/api/test_discovery_network.py, tests/api/test_discovery_route.py, .filepawl.toml
- **Action:** Rebuild each `create_app(` and `unserved_login` use in these files so both fakes answer at the address the app is told and `ready` is reached before the case acts; a refused credential (`test_credentials_rejected.py`) or a host change is reached mid-run. Several of these suites test what the app does at startup (a saved record it refuses, the container alias probe, discovery before any host is chosen); where that startup state cannot be reached from a ready app, build the app in that startup condition with both fakes answering at their addresses and assert the startup outcome, and where the subject is a startup with no working lane by construction, build it with neither lane answering (D-11 owner amendment); never with one lane answering and the other not.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/api/login tests/api/surface tests/api/test_connection.py tests/api/test_connection_lane.py tests/api/test_container_host_alias.py tests/api/test_credentials_rejected.py tests/api/test_discovery_network.py tests/api/test_discovery_route.py` prints `exit=0`. Testing scope: the same behaviors from a two-lane start; no new test; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 7: The remaining per-file apps in `tests/api` run both lanes

- **Files:** tests/api/test_advisor_hidden.py, tests/api/test_api_health.py, tests/api/test_api_routes.py, tests/api/test_control_failure_reads.py, tests/api/test_filter_upload_guards.py, tests/api/test_http_client_network.py, tests/api/test_log_refusal_when_hqplayer_has_none.py, tests/api/test_meter_feed_route.py, tests/api/test_metering_network.py, tests/api/test_refusal_codes_have_status.py, tests/api/test_release_fetch.py, tests/api/test_release_tested.py, tests/api/test_status_bands.py, tests/api/test_unexpected_error_shape.py, .filepawl.toml
- **Action:** Rebuild each `create_app(` and `unserved_login` use in these files so both fakes answer and `ready` is reached before the case acts; a case whose subject is a not-working answer (a control failure on a read, a daemon with no log, a meter feed with the daemon gone) starts ready and takes the lane away mid-run, or stays on `unserved_login` when that is its subject.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/api` prints `exit=0`. Testing scope: same behaviors from a two-lane start; no new test; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 8: The per-file apps outside `tests/api` run both lanes, and AC4 holds

- **Files:** tests/apply/test_live_routed_batches.py, tests/apply/test_manager_network.py, tests/audit/test_audit_route.py, tests/audit/test_autopilot_audit.py, tests/engine/test_devicecaps.py, tests/engine/test_control_stall.py, tests/presets/test_autopilot_stamp.py, tests/presets/test_restore_carries_the_engine.py, tests/test_frozen_paths.py, tests/support/apps.py (`unserved_login`), .filepawl.toml
- **Action:** Rebuild each `create_app(` and `unserved_login` use in these files as in Task 7. Then confirm AC4 across the suite: every `create_app(` under `tests/` reaches `ready` with both fakes answering before its case acts, or is inside `unserved_login`; every remaining `unserved_login` caller's subject is the not-working answer; rewrite `unserved_login`'s docstring to say it builds the not-working app, passing `triviajudge`. Record the sites checked in the hand-back.
- **Verify:** `grep -rn "create_app(\|unserved_login(" tests --include='*.py'` lists only sites the hand-back accounts for. `scripts/gate.sh make check` prints `exit=0` and `scripts/gate.sh make test-e2e` prints `exit=0` (disclose first: Playwright and the app subprocess hold a core for well over 10 s, `~/dev/CLAUDE.md` 3.1). Testing scope: no new test; the builders' readiness checks and the passing suites are the evidence; stop there.

## Notes

- D-11 owner ruling, taken before `/cad-execute 7`: a test whose subject is startup itself may start with neither lane answering; no test starts half-connected. This covers `test_form_routes_before_any_fetch_are_unavailable` (Task 3) and the startup suites of Task 6. Task 6 still prefers both fakes answering wherever the startup outcome can be asserted that way.
