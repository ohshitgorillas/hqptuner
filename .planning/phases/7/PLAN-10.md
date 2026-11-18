---
phase: 7
plan: 10
requirements: []
files:
  - tests/api/errors/test_api_error_codes.py
  - tests/api/test_advisor_hidden.py
  - tests/audit/test_autopilot_audit.py
  - tests/core/test_junkcal.py
  - tests/api/test_metering_dial.py
  - tests/api/test_junk_verdict_timing.py
  - tests/apply/manager/test_manager_retarget.py
  - tests/support/apps.py
  - tests/support/fake_metering.py
  - tests/api/test_api_write.py
  - tests/api/test_metadata_settings_default.py
  - tests/api/test_metadata_settings_more.py
  - tests/api/test_push_config_reading.py
  - tests/api/test_push_heartbeat_reading.py
  - tests/api/test_state_import_guards.py
  - tests/api/test_state_import_route.py
  - tests/support/state_import.py
  - tests/support/sse.py
  - tests/apply/manager/test_manager_control_down.py
  - tests/apply/manager/test_manager_faults_that_keep_the_connection.py
  - tests/apply/manager/test_manager_readings_die_with_their_connection.py
  - tests/apply/manager/test_manager_unreadable_backup.py
  - tests/apply/manager/conftest.py
  - tests/apply/test_live_state_refusal_report.py
  - tests/apply/test_live_volume_state_refusal_report.py
  - tests/apply/test_pipeline_apply.py
  - tests/matrix/test_matrix_profiles.py
  - tests/audit/test_aborted_apply_audit.py
  - tests/audit/test_audit_route.py
  - tests/audit/test_audit_wiring.py
  - tests/audit/test_dropped_write_audit.py
  - tests/audit/test_volume_trace.py
  - tests/audit/conftest.py
  - tests/support/fixtures_clients.py
  - tests/support/audit_records.py
  - tests/core/test_connection_evidence.py
  - tests/core/test_file_acquisition.py
  - tests/core/test_file_lifetime.py
  - tests/core/test_field_readings.py
  - tests/core/test_pending_readings.py
  - tests/core/test_lifecycle_outcomes.py
  - tests/core/test_lifecycle_retarget.py
  - tests/core/test_lifecycle_transitions.py
  - tests/lanes/test_settle.py
  - tests/support/lifecycle_rows.py
  - tests/support/transports.py
  - tests/support/answered_reading.py
  - tests/api/errors/test_control_failure_reads.py
  - tests/conftest.py
  - tests/e2e/support/stack.py
  - tests/support/fixtures_daemons.py
  - tests/gates/test_abuse_state_resolution.py
  - tests/test_build_manual.py
  - tests/test_fuzz.py
---

# Phase 7: One time base - Plan 10: No duplicated server-side test rigs

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- `npx jscpd --format python` reports no clone with a side under `tests/api/`, `tests/apply/`, `tests/audit/`, `tests/core/`, `tests/lanes/`, `tests/support/` or the root test files, except import lists and module docstrings repeated across split test files.
- Every test in these directories still runs and passes or fails exactly as at commit `503ddec8`, under the same count.

## Context

- D-03 binds this plan. Clone rules: a clone is gone when its code lives once and every former copy calls it; a forwarder or rename that leaves the same token run in two places removes nothing. Each removed clone turns its two copies into calls of one shared copy: two call sites per clone, in the files the task lists. A clone of a justified kind stays and is named, with its kind, in the commit message.
- `docs/spec/testing.md` binds every edit: no test is edited to pass, no assertion or expected value changes what it states (rule 1), fakes answer from tables (rule 13), helpers return values and hold no assert (rule 14), no test waits on a wall clock (rule 7). Shared helpers go in `tests/support/` (imported bare, pytest `pythonpath`) or in a directory `conftest.py`; a new support module's basename is unique in `tests/`.
- The `make lint` test gates (`check_test_assertions.py`, `check_test_clocks.py`, `check_no_copy_assertions.py`) run over every changed test file. `filepawl accept` runs whenever filepawl prints it.
- Common Verify for every task, over the task's files: (a) `scripts/gate.sh npx jscpd --format python`, then the log: no clone with both sides in the task's files except the stays its Action names; (b) `scripts/gate.sh .venv/bin/pytest -m "not live" -q` over the task's test files gives the same passed, failed and skipped counts as before the task; (c) `scripts/gate.sh make lint` passes. Testing scope for each: no behavior changes; the suites are their own check; no new test; testing stops there.

## Tasks

### Task 1: One builder makes the app and its config for the API suites

- **Files:** tests/api/errors/test_api_error_codes.py, tests/api/test_advisor_hidden.py, tests/audit/test_autopilot_audit.py, tests/core/test_junkcal.py, tests/api/test_metering_dial.py, tests/api/test_junk_verdict_timing.py, tests/apply/manager/test_manager_retarget.py, tests/support/apps.py, tests/support/fake_metering.py
- **Reads:** tests/support/apps.py, tests/api/test_advisor_hidden.py, tests/support/fake_metering.py
- **Decisions:** D-03
- **Action:** Clones removed: the `Config(...)` and app build (api_error_codes~autopilot_audit, advisor_hidden~autopilot_audit, advisor_hidden~metering_dial), the daemon-and-stream fakes setup (advisor_hidden~junkcal), the junk ceiling read (advisor_hidden~junk_verdict_timing), the polling rig (junk_verdict_timing~junkcal), the metering geometry rig (metering_dial~manager_retarget). Shared code goes in `apps.py` or `fake_metering.py`.
- **Verify:** The plan's common Verify over this task's files.

### Task 2: The API route suites share their fixtures

- **Files:** tests/api/test_api_write.py, tests/api/test_metadata_settings_default.py, tests/api/test_metadata_settings_more.py, tests/api/test_push_config_reading.py, tests/api/test_push_heartbeat_reading.py, tests/api/test_state_import_guards.py, tests/api/test_state_import_route.py, tests/support/state_import.py, tests/support/sse.py
- **Reads:** tests/support/state_import.py, tests/support/sse.py, tests/api/test_state_import_route.py
- **Decisions:** D-03
- **Action:** Clones removed: the `api_write` self-clone, the settings table fixture (metadata_settings_default~more, the second pair), the push stream rig (push_config_reading~push_heartbeat_reading), the import fixture (state_import_guards~state_import_route), the two `state_import_route.py` self-clones (near-identical tests folded into one parametrized case each, every case kept). Expected to stay: metadata_settings_default~more lines 4-25, a module docstring repeated across split test files.
- **Verify:** The plan's common Verify over this task's files.

### Task 3: One rig stands the manager up for the manager suites

- **Files:** tests/apply/manager/test_manager_control_down.py, tests/apply/manager/test_manager_faults_that_keep_the_connection.py, tests/apply/manager/test_manager_readings_die_with_their_connection.py, tests/apply/manager/test_manager_unreadable_backup.py, tests/apply/manager/test_manager_retarget.py, tests/apply/manager/conftest.py, tests/apply/test_live_state_refusal_report.py, tests/apply/test_live_volume_state_refusal_report.py, tests/apply/test_pipeline_apply.py, tests/matrix/test_matrix_profiles.py
- **Reads:** tests/apply/manager/test_manager_control_down.py, tests/apply/manager/test_manager_faults_that_keep_the_connection.py
- **Decisions:** D-03
- **Action:** Clones removed: the fault-once transport and the `Standing`/`Running` rig (control_down against faults_that_keep_the_connection, readings_die_with_their_connection and unreadable_backup; faults_that_keep_the_connection~unreadable_backup), the `manager_retarget.py` self-clone, the refusal-report daemon setup (live_state_refusal_report~live_volume_state_refusal_report). Expected to stay: pipeline_apply~matrix_profiles, an import list.
- **Verify:** The plan's common Verify over this task's files.

### Task 4: The audit suites share their log fixture and app

- **Files:** tests/audit/test_aborted_apply_audit.py, tests/audit/test_audit_route.py, tests/audit/test_audit_wiring.py, tests/audit/test_dropped_write_audit.py, tests/audit/test_volume_trace.py, tests/audit/conftest.py, tests/support/fixtures_clients.py, tests/support/audit_records.py
- **Reads:** tests/audit/test_aborted_apply_audit.py#audit_log, tests/support/fixtures_clients.py, tests/support/audit_records.py
- **Decisions:** D-03
- **Action:** Clones removed: the audit log fixture (aborted_apply_audit against audit_route, audit_wiring twice and volume_trace), the `aborted_apply_audit.py` self-clone, the app builder (audit_route~fixtures_clients), the threaded daemon spawn (dropped_write_audit~volume_trace).
- **Verify:** The plan's common Verify over this task's files.

### Task 5: The core suites share their transports, readings and the lifecycle wire table

- **Files:** tests/core/test_connection_evidence.py, tests/core/test_file_acquisition.py, tests/core/test_file_lifetime.py, tests/core/test_field_readings.py, tests/core/test_pending_readings.py, tests/core/test_lifecycle_outcomes.py, tests/core/test_lifecycle_retarget.py, tests/core/test_lifecycle_transitions.py, tests/lanes/test_settle.py, tests/support/lifecycle_rows.py, tests/support/transports.py, tests/support/answered_reading.py
- **Reads:** tests/core/test_lifecycle_outcomes.py, tests/lanes/test_settle.py, tests/core/test_connection_evidence.py
- **Decisions:** D-03
- **Action:** Clones removed: the `connection_evidence.py` self-clone, the counting transport wrapper (connection_evidence against file_acquisition and file_lifetime), the three `file_lifetime.py` self-clones, the PCM reading constants (field_readings~pending_readings), and lifecycle_outcomes~settle. The last is the planner's call on a flagged assumption: both tables carry the case `old-instance-answers-for-a-moment` with the same wire facts at the same clock readings, so it is one scenario and its rows are written once, as a table, and read by both suites; the table stays a table the test writes (rule 13). Expected to stay: lifecycle_retarget~lifecycle_transitions, a module docstring repeated across split test files.
- **Verify:** The plan's common Verify over this task's files, plus: `grep -n "old-instance-answers-for-a-moment" tests/core/test_lifecycle_outcomes.py tests/lanes/test_settle.py` still prints one case id in each, both passing.

### Task 6: The fake daemon servers and the script loaders live once

- **Files:** tests/api/errors/test_control_failure_reads.py, tests/conftest.py, tests/e2e/support/stack.py, tests/support/fixtures_daemons.py, tests/gates/test_abuse_state_resolution.py, tests/test_build_manual.py, tests/test_fuzz.py
- **Reads:** tests/conftest.py, tests/e2e/support/stack.py, tests/support/fixtures_daemons.py
- **Decisions:** D-03
- **Action:** Clones removed: the threadsafe `start_server` setup (control_failure_reads against `conftest.py` and `e2e/support/stack.py`), the `fixtures_daemons.py` self-clone, the creds-file helper (abuse_state_resolution~fuzz), the scripts-path import of a script under test (build_manual~fuzz). `tests/e2e/support/stack.py` serves the browser suites: if its shared part cannot import from `tests/conftest.py`, the shared code goes in `tests/support/fixtures_daemons.py` and both import it.
- **Verify:** The plan's common Verify over this task's files, plus `scripts/gate.sh make test-e2e` passes where the host can launch the browser, or the required `e2e` job passes on this commit.
