PLAN COMPLETE

Plan: .planning/phases/7/PLAN-2.md

Tasks: 6 of 6

| Task | Commit | Note |
|---|---|---|
| 1 - live_manager gains an 8088 lane and hands over ready | 40d9409e | Detail in plan-2.1.md. |
| 2 - http manager fixtures gain a control lane and run | abbe9ea6 | Detail in plan-2.1.md. Caller-side delta: 14 `http_manager_factory(` sites in 7 files gained `await`; `http_manager` and `clamping_manager` became async fixtures (their 300 users unchanged). `make check` exit=0 under the owner-approved baseline. |
| 3 - start_manager always starts with its 8088 fake answering | 2ad23564 | The handover already went through `Runs`/`ready_or_raise` (Task 2) and the "dead" case was rebuilt there. Here `start_manager` sets `hqp_http_port` from the `http_port` it dials and `test_devicecaps.py` dropped its redundant `hqp_http_port=port` override. The signature keeps `http_port`: the callers pass an `http_daemon` variant to move its state. Caller-side delta: 1 call site, 1 file. |
| 4 - api and engine per-file managers | f93d70a9 | `test_ungated_readers_network.py` (local 8088 `daemon` fixture and 3 hand-built managers replaced by `start_manager` plus the shared `http_daemon`), `test_logtail.py` (the unreachable case now takes the lane down with `_take_lane_down` after a ready start; the server-error case sets `_fail_paths` after a ready start), `test_manager_not_connected.py` (ready two-lane manager whose 4321 address is retargeted at `closed_port()`), `test_retired_client_closed.py` (ready manager from `start_manager`, then the recording clients are set mid-run), `test_http_client_network.py` `_applied` (`live_manager`, then `_refuse_auth` flipped on its 8088 fake before the save). |
| 5 - apply per-file managers | d4771e68 | `test_manager_apply.py` (`running_manager` is `live_manager`; no-client case sets `http_client = None` mid-run; the leftover-field case now asserts the persistent lane submitted), `test_manager_connection.py`, `test_manager_network.py`, `test_state_refusal_keeps_last_reading.py`, `test_fault_narrowing.py` (`faulting_matrix` swaps the faulting client in on a ready manager). `live_manager` gained a keyword-only `config=` mapping of `Config` fields. |
| 6 - presets, speakers, cover-floor managers | 2b60c982 | See the site list below. |

Suite: `scripts/gate.sh make check` exit=0 on the final tree (its offline pytest stage is the project's full suite; no `workflow.test_command` is set and the Makefile's `check` target runs `test`). No `--accept` of the suite-time gate was needed.

Caller-side delta of the tasks 4 to 6 rebuilds: no call site of a shared fixture changed beyond the files listed; `live_manager` callers (18 sites, 10 files) unchanged.

AC4 manager half: `grep -rn "ConnectionManager(" tests --include='*.py'` now lists one site, `tests/conftest.py:217` inside `Runs.start`, which every builder (`live_manager`, `http_manager_factory`, `start_manager`, and the per-file `dual_lane` in `tests/presets/test_load_resync.py`) goes through; `Runs.start` returns only through `ready_or_raise`, which raises `FixtureError` when `ready` is false. Sites rebuilt (previous per-file `ConnectionManager(`): `tests/test_cover_floor.py` (2), `tests/presets/test_preset_interfaces.py`, `tests/apply/test_manager_connection.py` (2), `tests/presets/test_load_resync.py` (2), `tests/apply/test_manager_network.py`, `tests/presets/test_carried_live_fields.py` (2), `tests/apply/test_fault_narrowing.py`, `tests/engine/test_manager_not_connected.py`, `tests/presets/test_preset_lifecycle.py`, `tests/apply/test_state_refusal_keeps_last_reading.py`, `tests/apply/test_manager_apply.py` (2), `tests/speakers/test_speakers_rideout.py`, `tests/api/test_ungated_readers_network.py`, `tests/api/test_http_client_network.py`, `tests/engine/test_logtail.py` (3), `tests/engine/http/test_retired_client_closed.py`, `tests/presets/test_backup_persist.py` (4).

Tests removed or rebuilt, with the 4321-only behavior each pinned:

- `tests/engine/test_devicecaps.py` case `fresh` of `test_a_manager_reports_the_capability_only_once_it_has_read_its_own_devices_announcement`: pinned a not-yet-loaded manager reporting no capability. A ready manager has loaded at connect, so the case cannot be stated. Removed, with the `load` parameter and `_loaded` helper.
- `tests/apply/test_manager_connect_load.py` case `dead` of `test_file_config_is_grounded_only_from_a_live_http_lane`: pinned `file_config is None` on a manager whose 8088 lane was dead at first connect. Rebuilt from a ready start with the lane taken down and `manager.restarting()`.
- `tests/apply/test_manager_apply.py::test_the_leftover_field_rides_the_persistent_lane`: pinned the `no_http_client` decline of a manager with no 8088 client, a 4321-only manager. Rebuilt: on a ready two-lane manager the leftover batch's persistent result is not `NOT_SUBMITTED`. The no-client decline stays asserted in `test_http_edit_without_credentials_reports_error` by setting `http_client = None` mid-run (D-06).
- `tests/apply/test_manager_connection.py` case `never_connected` of the mode-name join, and `tests/presets/test_carried_live_fields.py` case `cold`: pinned a never-connected manager with no State. Rebuilt on a ready manager whose `readings.state` is cleared (cases `no_state_reading` and `_cold`); the empty answer is still asserted beside the cases where the join and carry act.
- `tests/presets/test_load_resync.py` `_preset_load_with_no_control_connection`: pinned a load on a manager built with no 4321 lane. Rebuilt on a ready two-lane manager whose 4321 address is retargeted at a closed port; the picture is still empty after the load.
- `tests/speakers/test_speakers_rideout.py`: the speaker-form fakes serve no `/config` page, so no manager can become ready on them. The builder starts a ready manager on the healthy fake, then sets the manager's 8088 client onto the speaker fake mid-run, with the poll interval parked at 3600 s. No test removed.

Deviations: none

Open items:

- Nothing blocks. The suite-time baseline was raised by the owner (58.3 s); the final `make check` ran within it.
- Declined: no accessor for the fake 4321 state of an `http_manager_factory` manager (no case needed one).
