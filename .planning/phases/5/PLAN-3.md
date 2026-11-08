---
phase: 5
plan: 3
# Phase 5 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against its goal and Success Criteria 1-6.
requirements: []
files:
  - tests/engine/test_control.py
  - tests/engine/test_control_answer_unreadable.py
  - tests/engine/test_control_desync.py
  - tests/engine/test_control_lost_and_absent.py
  - tests/engine/test_control_no_answer.py
  - tests/engine/test_control_queued.py
  - tests/engine/test_control_readback_report.py
  - tests/engine/http/test_http_unreachable_names_address.py
  - tests/engine/test_devicecaps.py
  - tests/engine/test_discovery.py
  - tests/engine/test_logtail.py
  - tests/api/login/test_login_pair_check.py
  - tests/api/login/test_login_route.py
  - tests/api/test_connection.py
  - tests/api/test_connection_lane.py
  - tests/api/test_container_host_alias.py
  - tests/api/test_credentials_rejected.py
  - tests/api/test_release_fetch.py
  - tests/api/test_release_tested.py
  - tests/api/test_advisor_hidden.py
  - tests/api/test_api_routes.py
  - tests/api/test_control_failure_reads.py
  - tests/api/test_filter_upload_guards.py
  - tests/api/test_log_refusal_when_hqplayer_has_none.py
  - tests/api/test_meter_feed_route.py
  - tests/api/test_refusal_codes_have_status.py
  - tests/api/test_status_bands.py
  - tests/apply/test_fault_narrowing.py
  - tests/apply/test_http_apply.py
  - tests/apply/test_http_write.py
  - tests/apply/test_live_routed_batches.py
  - tests/apply/test_manager_apply.py
  - tests/apply/test_manager_connection.py
  - tests/apply/test_live_readback_report.py
  - tests/apply/test_live_report_codes.py
  - tests/apply/test_live_state_refusal_report.py
  - tests/apply/test_live_volume_state_refusal_report.py
  - tests/apply/test_state_refusal_keeps_last_reading.py
  - tests/audit/test_audit_route.py
  - tests/audit/test_autopilot_audit.py
  - tests/presets/test_autopilot_stamp.py
  - tests/presets/test_autosave.py
  - tests/presets/test_backup_persist.py
  - tests/presets/test_carried_live_fields.py
  - tests/presets/test_description_routes.py
  - tests/presets/test_load_resync.py
  - tests/presets/test_preset_interfaces.py
  - tests/presets/test_preset_lifecycle.py
  - tests/presets/test_restore_carries_the_engine.py
  - tests/matrix/test_matrix_read.py
  - tests/speakers/test_speakers_apply.py
  - tests/speakers/test_speakers_rideout.py
  - tests/test_cover_floor.py
  - tests/support/fake_network.py
---

# Phase 5: Offline tests reach their fake daemons in-process - Plan 3: Test files that build their own clients and fakes move onto the in-process network

## Goal

Every offline test reaches each fake daemon it talks to in-process, so no offline test opens a real network connection and the clock gate's reading no longer depends on how busy the machine running the suite is. This plan migrates the 53 offline test files that construct a client, manager, app or fake of their own, and so open a socket the shared fixtures do not control. Planning measured them with an audit-hook survey of the whole offline suite: 2733 tests, 1069 of which opened an AF_INET socket.

## Must be true when done

- With `-p socket_guard` loaded, every file in this plan passes with no guard error recorded in setup or call. A teardown-only error at a test holding one of plan 2 task 5's dual-served 8088 fixtures is that fixture's TCP-half wake, which plan 4 task 3 removes.
- Each of these tests asserts exactly what it asserted before, under the same name, ids and values. Only how it reaches its fakes changed.
- `scripts/gate.sh make check` is green after every task.

## Context

- Depends on plans 1 and 2. The shared fixtures still also listen on TCP (plan 2's transition rule), and a file's own TCP fake handed to a support helper is reached through plan 2 task 4's forward, so a file migrated here and a file not yet migrated both stay green. A forwarded dial is a TCP connection, so a file that still uses the forward after its task fails that task's guard check in setup or call.
- Socketpair semantics: planning swept these files for reliance on a kernel behavior that TCP has and an AF_UNIX socketpair lacks. Only `tests/api/test_control_failure_reads.py` relies on one, the zero-linger reset, and task 4 keeps it. Other users of the `_close` knob, such as `tests/apply/test_live_report_codes.py`, expect a clean close, which a socketpair gives as TCP does. `tests/engine/test_control.py`'s fake catching `ConnectionResetError` is fake-side tolerance with no assertion on it. A refused dial is the network's `ConnectionRefusedError`, and no client or fake reads a peer address.
- One rule binds every task. A direct construction gets the suite's process-wide network from `tests/support/fake_network.py`. This covers `ControlClient`, `ConnectionManager`, `create_app`, `HttpConfigClient`, `MeteringReader`, `discover`, `probe`, `check_pair` and `logtail.fetch_log`. `HttpConfigClient` and `fetch_log` get it as `HttpOptions(transport=...)`, the way `tests/engine/http/test_http_no_answer.py` already does. A direct TCP or UDP fake moves to plan 1's in-process serving: `asyncio.start_server` on `fake_control`'s callbacks, `fake_http.spawn` on TCP, `fake_metering.spawn`, and `fake_discovery.responder` over UDP. Ports from `closed_port()` stay, because an address nothing is registered at refuses in-process. Explicit addresses (`host=`, `bind_port=`) carry over as explicit registrations.
- A test that cannot keep its assertion, expected value or name unchanged is a stop-and-report, never an edit. Tests are never edited to pass. This is a pure scaffolding refactor, so the `docs/testing.md` rule 8 exemption applies and is stated in the hand-back.
- Out of scope: `tests/test_desktop.py` (plan 1 task 8 and plan 4 task 2), `tests/gates/test_tested_release.py` (plan 4), and the live-marked tests and e2e. `tests/presets/test_switch_drops_profile.py` holds fixtures and no test, and opened no socket in the survey.
- Every task's check runs as `PYTHONPATH=tests/support scripts/gate.sh .venv/bin/pytest -p socket_guard <the task's files> -q`, followed by `scripts/gate.sh make check`, green. The guard run is green apart from teardown-only errors at tests holding one of plan 2 task 5's six dual-served 8088 fixtures (`http_daemon`, `stale_http_daemon`, `clamping_http_daemon`, `dying_http_daemon`, `restore_refusing_http_daemon`, `restore_recovering_http_daemon`). Read the log at the printed path: every error must name the teardown phase alone, at a test whose fixture closure (`--setup-plan`) holds one of the six. A setup or call record is a dial this task missed.

## Tasks

### Task 1: The control-client engine tests dial in-process

- **Files:** tests/engine/test_control.py, tests/engine/test_control_answer_unreadable.py, tests/engine/test_control_desync.py, tests/engine/test_control_lost_and_absent.py, tests/engine/test_control_no_answer.py, tests/engine/test_control_queued.py, tests/engine/test_control_readback_report.py
- **Action:** Apply the plan's rule. Every `ControlClient` these files build takes the network's opener. Each fake server they start, whether its own `asyncio.start_server` or a split-frame, stalling or desync handler, registers on the network instead. The fake's wire behavior is unchanged: the same frames, the same split points and the same stall.
- **Verify:** The plan's check over these seven files. Rule 8 exemption: refactor only.

### Task 2: The remaining engine tests reach their fakes in-process

- **Files:** tests/engine/http/test_http_unreachable_names_address.py, tests/engine/test_devicecaps.py, tests/engine/test_discovery.py, tests/engine/test_logtail.py
- **Action:** Apply the plan's rule. In `test_discovery.py`, every search takes the network's datagram factory and opener. Its responders become plan 1's in-process responder, and its alias and silent control daemons become network registrations. The uvloop case and the real-timer ledger case keep running on their own loops, and still list what they list today. `test_logtail.py`'s "nothing listening" port stays an address nobody registers.
- **Verify:** The plan's check over these four files. Rule 8 exemption: refactor only.

### Task 3: The login, connection, alias and release API tests reach their fakes in-process

- **Files:** tests/api/login/test_login_pair_check.py, tests/api/login/test_login_route.py, tests/api/test_connection.py, tests/api/test_connection_lane.py, tests/api/test_container_host_alias.py, tests/api/test_credentials_rejected.py, tests/api/test_release_fetch.py, tests/api/test_release_tested.py
- **Action:** Apply the plan's rule. The two-addresses-one-port cases in `test_container_host_alias.py` and `test_login_route.py` register both daemons explicitly at their `(host, port)`.
- **Verify:** The plan's check over these eight files. Rule 8 exemption: refactor only.

### Task 4: The other API tests reach their fakes in-process

- **Files:** tests/api/test_advisor_hidden.py, tests/api/test_api_routes.py, tests/api/test_control_failure_reads.py, tests/api/test_filter_upload_guards.py, tests/api/test_log_refusal_when_hqplayer_has_none.py, tests/api/test_meter_feed_route.py, tests/api/test_refusal_codes_have_status.py, tests/api/test_status_bands.py, tests/support/fake_network.py
- **Action:** Apply the plan's rule. The metering streams in `test_meter_feed_route.py` and `test_status_bands.py` move to plan 1's in-process 4322 fake, with the same frames and counts. The custom `handler=` in `test_log_refusal_when_hqplayer_has_none.py` keeps its handler class and serves at an in-process address. The TCP announcements plan 2 task 4 added for these files' own fakes go with the TCP fakes.

  `test_control_failure_reads.py` keeps a real reset. Its three tests are about what the user is shown when the control connection is reset under a command. Today `_serve_resetting` resets by closing a socket set to linger for zero seconds. On an AF_UNIX socketpair that close gives the client a clean end of file, not a reset. Moved as it is, the file would lose its premise while `test_a_reset_control_connection_does_not_show_the_user_the_socket_text` stayed green even against code that shows the user raw socket text. So:
  - `fake_network` gains a reset for a stream fake: the fake's end closes so that the client's next read fails in the kernel with `ECONNRESET`. `ControlClient._as_control_error` then meets it in its `OSError` branch, exactly as over TCP.
  - On Linux, closing an AF_UNIX stream end while its own receive queue holds unread bytes does this. Planning checked it on this host: a client's asyncio read raised `ConnectionResetError` with errno 104. TCP does the same when it closes a socket with unread data.
  - The mechanism is the executor's choice within those terms. The reset comes from the socket layer, never from an exception set on the client's reader or a patch of asyncio, so the client's own transport meets it as it meets a TCP reset. No TCP.
  - `_serve_resetting` resets through it in place of `SO_LINGER`, and `RESET_ON_CLOSE` goes if nothing else uses it.
  - The module docstring's sentence about sockets that linger for zero seconds is rewritten to state the in-process reset. No other comment changes.
  - The three tests keep their names, cases and assertions.
- **Verify:** The plan's check over these eight files. Rule 8 exemption: refactor only, except for `test_control_failure_reads.py`, whose premise now rests on the new reset. That file gets a bite proof:
  - The null stub makes the user's failure text carry the raw exception text, for example by having the `OSError` branch of `ControlClient._as_control_error` raise an error whose message is `str(exc)`.
  - First, against the file before migration (TCP, zero-linger reset), `test_a_reset_control_connection_does_not_show_the_user_the_socket_text` fails by assertion on both surfaces, `matrix-switch` and `live-write`. That shows the stub reaches the response.
  - Then, against the migrated file, the same test fails by assertion on both surfaces under the same stub. That shows the in-process reset reaches the client as `ECONNRESET`.
  - Restore the code. All three tests pass on both surfaces.
  - If the migrated test stays green under the stub, the reset is not reaching the client. That is a stop-and-report, never an edit to the test.
  - Testing stops there.

### Task 5: The 8088 apply and manager-connection tests reach their fakes in-process

- **Files:** tests/apply/test_fault_narrowing.py, tests/apply/test_http_apply.py, tests/apply/test_http_write.py, tests/apply/test_live_routed_batches.py, tests/apply/test_manager_apply.py, tests/apply/test_manager_connection.py
- **Action:** Apply the plan's rule. `test_http_write.py`'s capturing `handler=` keeps its class and serves at an in-process address.
- **Verify:** The plan's check over these six files. Rule 8 exemption: refactor only.

### Task 6: The live-report, state-refusal and audit tests reach their fakes in-process

- **Files:** tests/apply/test_live_readback_report.py, tests/apply/test_live_report_codes.py, tests/apply/test_live_state_refusal_report.py, tests/apply/test_live_volume_state_refusal_report.py, tests/apply/test_state_refusal_keeps_last_reading.py, tests/audit/test_audit_route.py, tests/audit/test_autopilot_audit.py
- **Action:** Apply the plan's rule.
- **Verify:** The plan's check over these seven files. Rule 8 exemption: refactor only.

### Task 7: The preset tests reach their fakes in-process

- **Files:** tests/presets/test_autopilot_stamp.py, tests/presets/test_autosave.py, tests/presets/test_backup_persist.py, tests/presets/test_carried_live_fields.py, tests/presets/test_description_routes.py, tests/presets/test_load_resync.py, tests/presets/test_preset_interfaces.py, tests/presets/test_preset_lifecycle.py, tests/presets/test_restore_carries_the_engine.py
- **Action:** Apply the plan's rule.
- **Verify:** The plan's check over these nine files. Rule 8 exemption: refactor only.

### Task 8: The matrix, speaker and coverage-floor tests reach their fakes in-process

- **Files:** tests/matrix/test_matrix_read.py, tests/speakers/test_speakers_apply.py, tests/speakers/test_speakers_rideout.py, tests/test_cover_floor.py
- **Action:** Apply the plan's rule. The speaker suites' custom `handler=` classes keep their shape and serve at an in-process address.
- **Verify:** The plan's check over these four files, plus one whole-suite run: `PYTHONPATH=tests/support scripts/gate.sh .venv/bin/pytest -m "not live and not e2e" -p socket_guard -q` is red only on `tests/gates/test_tested_release.py`, on `tests/test_desktop.py::test_a_listener_takes_connections_before_it_runs`, and on teardown-only errors at tests holding one of the six dual-served 8088 fixtures. Read the log at the printed path to confirm. Rule 8 exemption: refactor only.
