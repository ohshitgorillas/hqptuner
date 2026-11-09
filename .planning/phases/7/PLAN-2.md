---
phase: 7
plan: 2
# Phase 7 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against the five Success Criteria and CONTEXT AC1-AC7.
requirements: []
files:
  - tests/conftest.py
  - tests/support/fixtures_daemons.py
  - tests/api/test_http_client_network.py
  - tests/api/test_ungated_readers_network.py
  - tests/engine/http/test_retired_client_closed.py
  - tests/engine/test_logtail.py
  - tests/engine/test_manager_not_connected.py
  - tests/apply/test_fault_narrowing.py
  - tests/apply/test_manager_apply.py
  - tests/apply/test_manager_connection.py
  - tests/apply/test_manager_network.py
  - tests/apply/test_state_refusal_keeps_last_reading.py
  - tests/apply/test_engine_apply.py
  - tests/apply/test_manager_connect_load.py
  - tests/presets/test_backup_persist.py
  - tests/presets/test_carried_live_fields.py
  - tests/presets/test_load_resync.py
  - tests/presets/test_preset_interfaces.py
  - tests/presets/test_preset_lifecycle.py
  - tests/speakers/test_speakers_rideout.py
  - tests/test_cover_floor.py
  - tests/
  - .filepawl.toml
---

# Phase 7: Remove the 4321-only mode - Plan 2: Every manager fixture runs both lanes

## Goal

HQPTuner requires both the 4321 control lane and the 8088 config lane. This plan makes every `ConnectionManager` a test builds the supported install: both fakes answering, the 8088 forms loaded, `ready` true when the test gets it, and every not-working state reached from there by taking a lane away mid-run (ROADMAP SC2, D-10, D-11, AC4 manager half).

## Must be true when done

- `live_manager`, `http_manager_factory`, `http_manager`, `clamping_manager` and `start_manager` each hand over a manager whose `ready` is true, with a 4321 fake and an 8088 fake both answering and the 8088 forms loaded; a builder that cannot reach `ready` raises `FixtureError` instead of handing over a broken manager.
- Every per-file `ConnectionManager(` in the suite is built the same way, both lanes answering and `ready` reached before the case acts.
- Each manager-level test of a not-working state (8088 refused, 8088 down, no 8088 client, 4321 down) starts from a ready two-lane manager and takes the lane away mid-run (`_take_lane_down`, `_refuse_auth`, `_fail_paths`, or the manager's own `http_client` set to None for the no-client state of D-06).
- No manager test asserts a feature succeeding with the 8088 lane down.
- `scripts/gate.sh make check` exits 0 after each task.

## Context

- Locked: D-10 (every manager gets both lanes; rejected: keeping single-lane managers as lane-unit fixtures), D-11 (not-working tests rebuilt on the two-lane install with the lane taken down mid-run; tests pinning 4321-only behavior removed, or rebuilt as owner-approved behavior changes, tests-first), D-06 (`http_client is None` stays a reachable state), D-14 (new test files in subdirectories).
- Pattern to follow: `start_manager` in `tests/conftest.py` already builds the two-lane manager, spawns `run()` on the clock, waits `settled(clock)` and tears down with `stop`, the task, `aclose` and the client's `aclose`. Every 8088 fake is `fake_http.spawn(..., in_process=True)` and every 4321 fake registers on `fake_network` (phase 5: no offline test opens a TCP or UDP socket, `docs/testing.md` rule 18).
- Tests are never edited to pass. A test whose subject was a single-lane manager is rebuilt so the same behavior is asserted from a two-lane start; one that can only be stated on a manager that starts broken goes to the owner as a blocking question, listed in the hand-back, never kept on a broken builder and never deleted silently. Each removed test is named in the hand-back with the 4321-only behavior it pinned.
- Every gate run through `scripts/gate.sh`; `filepawl accept` whenever filepawl prints it. Plans 1 to 5 run in order; this plan follows Plan 1.

## Tasks

### Task 1: `live_manager` gains an 8088 lane and hands over ready

- **Files:** tests/conftest.py (`live_manager`, `LiveBuilt`), tests/support/fixtures_daemons.py, tests/apply/test_engine_apply.py (`declining`), tests/ (fallout: the ten files using `live_manager`), .filepawl.toml
- **Action:** Give each manager `live_manager` builds an `HttpConfigClient` on its own in-process fake 8088 daemon (`fake_http.state()` defaults), so the manager connects on both lanes; hand it over only once `manager.ready` is true after `settled(clock)`, raising `FixtureError` otherwise; close the client at teardown as `start_manager` does. A case must be able to reach its daemon's 8088 state to take that lane down; how the builder hands it over (a wider tuple or an accessor) is the executor's choice, and the hand-back states the caller-side delta: how many call sites change and in which files. Rebuild the `declining` fixture in `tests/apply/test_engine_apply.py` so both cases start ready on both lanes: the refused credential is already earned off the wire, and the no-client case reaches `http_client is None` mid-run through the manager's public `http_client` setter rather than a control-only build. Run the `live_manager` suites and rebuild each case the 8088 lane now moves (request counts, form refreshes on the poll, preset migration on connect) on the two-lane facts, keeping the behavior it asserts.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/apply tests/test_cover_floor.py tests/test_junkcal.py` prints `exit=0`. Testing scope: the outcome is that every `live_manager` handover is ready on both lanes; the fixture's own `FixtureError` is the check, raised on every use, so no new test is added; evidence is the ten suites passing on the rebuilt fixture; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 2: The http manager fixtures gain a control lane and run

- **Files:** tests/conftest.py (`http_manager_factory`, `http_manager`, `clamping_manager`, `ManagerFactory`), tests/apply/test_fault_narrowing.py, tests/apply/test_http_apply.py, tests/apply/test_profile_materialize_lane.py, tests/engine/test_devicecaps.py, tests/matrix/test_filter_upload.py, tests/presets/test_backup_persist.py, tests/presets/test_preset_lifecycle.py, tests/ (fallout: the sixteen files using `http_manager`), .filepawl.toml
- **Action:** Give every manager `http_manager_factory` builds a control port on its own fake 4321 daemon (the `daemon` factory or `live_daemon_port` shape), spawn its `run()` on the clock and hand it over once `ready` is true after `settled(clock)`, the `start_manager` handover, with `FixtureError` when `ready` is not reached and the same teardown. The 8088 daemon stays an argument so the outage suites keep their `dying`, `stale` and `clamping` variants. Building now awaits, so `http_manager` and `clamping_manager` become async fixtures and every direct `http_manager_factory(` call is awaited; the hand-back states that caller-side delta (call sites and files). Rebuild each case the running poll loop or the control lane now moves, keeping the behavior it asserts; a case that relied on a manager never connected is rebuilt from a ready start with the lane taken down mid-run (D-11).
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/apply tests/presets tests/matrix tests/engine` prints `exit=0`. Testing scope: the outcome is every http-manager handover ready on both lanes; the fixture's `FixtureError` checks it on every use, so no new test is added; stop when the suites pass. `scripts/gate.sh make check` prints `exit=0`.

### Task 3: `start_manager` always starts with its 8088 fake answering

- **Files:** tests/conftest.py (`start_manager`, `StartManager`), tests/apply/test_manager_connect_load.py, tests/apply/test_fault_narrowing.py, tests/presets/test_rescan_replay.py, tests/matrix/test_matrix_read.py, tests/engine/test_devicecaps.py, .filepawl.toml
- **Action:** `start_manager` takes an `http_port` today, and `tests/apply/test_manager_connect_load.py` hands it `closed_port` for its "dead" lane case, which builds a manager that starts broken. Make the builder start every manager with an answering 8088 fake and hand it over once `ready` is true, `FixtureError` otherwise; rebuild the "dead" lane case so the 8088 lane is taken down after a ready start and the case then asserts what the next connect or poll answers. Keep the `**overrides` reach the five callers use (`preset_dir`, `hqp_control_port`, `alarm_threshold`, `hqp_http_port`); a caller that pointed both lanes at one fake port (`tests/engine/test_devicecaps.py`) is rebuilt on two fakes. State the caller-side delta in the hand-back.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/apply/test_manager_connect_load.py tests/apply/test_fault_narrowing.py tests/presets/test_rescan_replay.py tests/matrix/test_matrix_read.py tests/engine/test_devicecaps.py` prints `exit=0`. Testing scope: the "dead" lane outcome stays asserted from a ready start; no new test; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 4: Per-file managers in `tests/api` and `tests/engine` run both lanes

- **Files:** tests/api/test_http_client_network.py, tests/api/test_ungated_readers_network.py, tests/engine/http/test_retired_client_closed.py, tests/engine/test_logtail.py, tests/engine/test_manager_not_connected.py, .filepawl.toml
- **Action:** Rebuild each `ConnectionManager(` these files construct so both fakes answer and `ready` is reached before the case acts, reusing the shared two-lane fixtures where a case's shape fits them. `tests/engine/test_manager_not_connected.py` and the ungated-readers suite test not-working states: start each case ready and take the lane away mid-run (D-11). A case that tests the 8088 client alone through a manager rebuilds on a ready two-lane manager; D-10 rejected keeping lane-unit managers.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/api/test_http_client_network.py tests/api/test_ungated_readers_network.py tests/engine/http/test_retired_client_closed.py tests/engine/test_logtail.py tests/engine/test_manager_not_connected.py` prints `exit=0`. Testing scope: the same behaviors asserted from a two-lane start; no new test; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 5: Per-file managers in `tests/apply` run both lanes

- **Files:** tests/apply/test_fault_narrowing.py, tests/apply/test_manager_apply.py, tests/apply/test_manager_connection.py, tests/apply/test_manager_network.py, tests/apply/test_state_refusal_keeps_last_reading.py, .filepawl.toml
- **Action:** Rebuild each `ConnectionManager(` in these files as in Task 4: both fakes answering, `ready` reached before the case acts, not-working states reached mid-run. Connection-lifecycle cases in `test_manager_connection.py` and `test_manager_network.py` that assert what a 4321 drop does keep asserting it, now from a ready two-lane manager.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/apply` prints `exit=0`. Testing scope: the same behaviors from a two-lane start; no new test; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 6: Per-file managers in `tests/presets`, `tests/speakers` and the cover-floor suite run both lanes

- **Files:** tests/presets/test_backup_persist.py, tests/presets/test_carried_live_fields.py, tests/presets/test_load_resync.py, tests/presets/test_preset_interfaces.py, tests/presets/test_preset_lifecycle.py, tests/speakers/test_speakers_rideout.py, tests/test_cover_floor.py, tests/conftest.py, .filepawl.toml
- **Action:** Rebuild each `ConnectionManager(` in these files as in Task 4. Then confirm AC4's manager half across the whole suite: every `ConnectionManager(` under `tests/` either is one of the shared builders in `tests/conftest.py` that hands over ready, or reaches `ready` with both fakes answering before its case acts; record in the hand-back the list of sites checked.
- **Verify:** `grep -rn "ConnectionManager(" tests --include='*.py'` lists only sites the hand-back accounts for as two-lane and ready. `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/presets tests/speakers tests/test_cover_floor.py` prints `exit=0`. Testing scope: no new test; the builders' readiness checks and the passing suites are the evidence; stop there. `scripts/gate.sh make check` prints `exit=0`.

## Notes

- Interpretation recorded: D-10 names `live_manager`, `http_manager_factory`, `http_manager` and `clamping_manager`; `start_manager` already runs both lanes but lets a caller hand it a closed 8088 port, which AC4 forbids for a builder in `tests/conftest.py`, so Task 3 brings it under the same rule.
- A running poll loop now sits under the http managers. It advances only when a case advances the virtual clock, so a case that never advances it sees one connect and no poll.
