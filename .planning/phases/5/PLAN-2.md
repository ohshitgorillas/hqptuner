---
phase: 5
plan: 2
# Phase 5 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against its goal and Success Criteria 1-6.
requirements: []
files:
  - tests/support/socket_guard.py
  - tests/test_socket_guard.py
  - tests/conftest.py
  - tests/support/fixtures_daemons.py
  - tests/support/fixtures_clients.py
  - tests/support/apps.py
  - tests/support/junkcal_rig.py
  - tests/support/fake_network.py
  - tests/support/fake_http.py
  - tests/support/fake_metering.py
  - tests/api/test_control_failure_reads.py
  - .filepawl.toml
---

# Phase 5: Offline tests reach their fake daemons in-process - Plan 2: Shared fixtures and helpers build on the in-process network

## Goal

Every offline test reaches each fake daemon it talks to in-process, so no offline test opens a real network connection and the clock gate's reading no longer depends on how busy the machine running the suite is. This plan moves the shared fixtures and helpers onto plan 1's network and lands the socket guard that proves it, opt-in for now.

## Must be true when done

- A guard plugin, loaded with `-p socket_guard`, fails any offline test that opens a TCP or UDP connection, synchronous or from an event loop, naming each address and the phase (setup, call or teardown) it was opened in.
- Every client, manager and app built inside `tests/conftest.py` and `tests/support/` dials through the in-process network, and every fake the shared fixtures serve can be reached through it.
- With the guard loaded over the whole offline suite, every test it flags lives in a file named in plan 3's task lists or in `tests/gates/test_tested_release.py`, is `tests/test_desktop.py::test_a_listener_takes_connections_before_it_runs`, or is flagged only in teardown while holding one of task 5's dual-served 8088 fixtures.
- A test file plan 3 has not migrated yet that hands a support helper a TCP fake of its own still reaches that fake once the helper dials through the network.
- No test's assertions, expected values or names changed, and `scripts/gate.sh make check` is green after every task.

## Context

- Depends on plan 1: `tests/support/fake_network.py`, `hqptuner/core/network.py`, the in-process serving in `fake_http`, `fake_metering` and `fake_discovery`, and the new constructor parameters.
- Transition rule for this plan: a shared fixture whose fake is also dialed by a test file plan 3 has not migrated yet keeps its TCP listener and also registers the same fake, at the same `(host, port)` with the same State and log, on the network. Plan 4 drops the TCP half. Only a fake whose sole dialer is support code goes network-only here.
- The transition rule also covers the other direction: a test file plan 3 has not migrated that hands a support helper a fake it serves itself on TCP. Once task 5 builds that helper's client or app on the network, the network forwards dials to that fake's announced TCP address (task 4), until plan 3 migrates the file and plan 4 task 3 removes the forward.
- What the transition costs the guard: a dual-served 8088 fixture's TCP half is `fake_http.spawn` on TCP, whose teardown wakes its parked `handle_request` with one loopback connection (`docs/testing.md` rule 7). With the guard covering synchronous connections (owner ruling), every test holding such a fixture is flagged in teardown until plan 4 task 3 drops the TCP half. That is why the guard names the phase, and why this plan's and plan 3's whole-suite checks allow teardown-only records at those tests. It is a property of the transition, not a carve-out: the guard's decision does not change, and plan 4's final run allows nothing.
- Pure refactor of test scaffolding: no test is edited to pass, and the `docs/testing.md` rule 8 exemption for refactor-only test changes applies to tasks 2 to 5. It is stated in the hand-back.

## Tasks

### Task 1: An opt-in socket guard flags any offline test that opens a TCP or UDP connection

- **Files:** tests/support/socket_guard.py, tests/test_socket_guard.py
- **Action:** `tests/support/socket_guard.py` is a pytest plugin module, loaded with `-p socket_guard`. Plan 4 registers it in `tests/conftest.py`, and nothing registers it before then. Requirements:
  - At import it installs one `sys.addaudithook`.
  - The hook records `socket.connect` and `socket.sendto` events on AF_INET and AF_INET6 sockets, from any thread, synchronous or from an event loop, while a test not marked `live` or `e2e` is being set up, run or torn down, so the window covers fixtures. `socket.connect` is the event `connect_ex` raises too, so `desktop.answers`'s knock is covered.
  - At that test's teardown the plugin raises `narrow.FixtureError` naming each recorded address and the phase it was recorded in. This is the fixture-that-refuses pattern of `_real_record_untouched` in `tests/gates/test_tested_release.py`.
  - The decision to record or not is one pure function whose return value is the verdict (rule 17). The hook and the fixture only execute it (rule 14: no assert outside a test).
  - No event-loop condition and no other carve-out (owner ruling). An offline test that opens a TCP or UDP connection of any kind, to a fake daemon or to anything else, is flagged. A bind is not a connection and is not recorded, so `apps.closed_port` and `_no_daemon_but_the_fakes` stay unflagged.
  - Recording is thread-safe, because a `TestClient` app loop runs on its own thread.
  - The hook returns at once for every event other than those two, so the suite-time gate does not move.
  - No exemption list, skip path or marker beyond `live` and `e2e`, which are Success Criterion 1's own scope.
- **Verify:** Testing scope:
  - Outcomes of the decision function:
    - flagged: an IPv4 connect, an IPv6 connect and an IPv4 datagram send in an offline test
    - not flagged: an AF_UNIX socket, a `live`-marked test, an `e2e`-marked test
  - The decision takes no loop or thread state as input, so there is no loop case to sweep. The wired hook's synchronous reach is proved by the second bite run below.
  - Write these as parametrized cases with one assertion each.
  - Bite (null stub): the function answers "not flagged" for every input, and the flagged cases must fail by assertion.
  - Bite of the wired hook: on this tree, `PYTHONPATH=tests/support scripts/gate.sh .venv/bin/pytest -p socket_guard tests/engine/test_control.py -q` reports a guard error naming a loopback address for its tests, which still dial TCP from an event loop. `PYTHONPATH=tests/support scripts/gate.sh .venv/bin/pytest -p socket_guard tests/test_desktop.py -q` flags exactly `test_a_listener_takes_connections_before_it_runs`, whose `accepts` helper connects synchronously, and no other test in the file, which also confirms plan 1 task 8. Both runs without `-p socket_guard` are green.
  - Testing stops there.
  - Last, `scripts/gate.sh make check` is green. The plugin is not registered, so the suite is unaffected.

### Task 2: The shared control fakes register on the network and the fixtures' clients and managers dial through it

- **Files:** tests/conftest.py, tests/support/fixtures_daemons.py, .filepawl.toml
- **Action:** Each of the following also registers its `fake_control` callback (`serve` or `serve_shared`, with the same overrides, State and log) on the network at the address of its TCP listener: `spawn_threaded_daemon`, `live_daemon_port`, the `daemon` factory, `garbled_metadata_client`, `disabled_volume_client`, `deaf_volume_client`, `threaded_daemon_port` and `threaded_disabled_volume_port`. Teardown unregisters it. The clients these fixtures build are built with the network's opener, and so are the `ConnectionManager`s that `live_manager` and `start_manager` build. `spawn_threaded_daemon` keeps its signature, so its direct callers are untouched. The 4321 half of `start_manager` changes here and its 8088 client in task 5. Caller-side delta: none outside these two files.
- **Verify:** Pure scaffolding refactor, so the rule 8 exemption applies.
  - `PYTHONPATH=tests/support scripts/gate.sh .venv/bin/pytest -p socket_guard tests/engine/test_recv_resilience.py tests/apply/test_live_snapshot.py tests/apply/test_setters.py -q` is green with no guard error. These are fixture-only users of `garbled_metadata_client`, `live_manager` and `live_client`. Users of `spawn_threaded_daemon` through `apps.live_app` stay flagged until task 5 moves `create_app` onto the network.
  - `scripts/gate.sh make check` is green.

### Task 3: The junk-calibration rig streams its frames in-process

- **Files:** tests/support/junkcal_rig.py
- **Action:** `Rig.attach` serves its frames through plan 1's in-process 4322 fake instead of `fake_metering.spawn`, and builds its `MeteringReader` with the network's opener. Its sole dialer is the reader it builds, so it goes network-only. The pacing and monotonic arguments it takes from `mgr.clock` stay.
- **Verify:** Pure scaffolding refactor, so the rule 8 exemption applies.
  - `PYTHONPATH=tests/support scripts/gate.sh .venv/bin/pytest -p socket_guard tests/test_junkcal.py -q` is green with no guard error naming the rig's stream.
  - `scripts/gate.sh make check` is green.

### Task 4: A test file's own TCP fake stays reachable through the network until that file moves

- **Files:** tests/support/fake_network.py, tests/support/fake_http.py, tests/support/fake_metering.py, tests/api/test_control_failure_reads.py
- **Action:** Transition scaffolding for task 5, removed by plan 4 task 3. Task 5 builds every client and app the support helpers make on the network. Five test files plan 3 has not migrated yet hand those helpers a fake they serve themselves on TCP only, and would go red at task 5 without this:
  - `tests/apply/test_http_apply.py`: `once_refusing_http_daemon`, a `fake_http.spawn` on TCP, goes to `http_manager_factory`.
  - `tests/engine/test_devicecaps.py`: three file-local `fake_http.spawn` fixtures go to `http_manager_factory`.
  - `tests/api/test_status_bands.py` and `tests/api/test_meter_feed_route.py`: their `fake_metering.spawn` streams feed the app `unserved_login` builds, whose lifespan reader dials through the manager's opener (plan 1 task 7).
  - `tests/api/test_control_failure_reads.py`: `_resetting_daemon`, its own `asyncio.start_server` on a thread, goes to `live_app`.
  - Planning found these by reading every caller of `http_manager_factory`, `start_manager`, `live_manager`, `live_app`, `unserved_login` and `fixtures_clients.app` for a fake the file serves itself. Every other caller hands them a shared fixture's fake, a `spawn_threaded_daemon` port, a `closed_port` or a default port `_no_daemon_but_the_fakes` holds.

  The network gains a forward:
  - A TCP fake announces its loopback address while it listens and withdraws it when it stops. The network's stream opener and its async HTTP transport dial an announced address over real TCP.
  - An address registered in-process wins over an announced one, so a dual-served fixture still answers in-process.
  - The choice is made per dial and per request, so it does not matter whether a client was built before or after the fake.
  - An address neither registered nor announced still refuses in-process, so `closed_port` numbers and `_no_daemon_but_the_fakes`'s ports open no connection.
  - The knock stand-in, the synchronous HTTP transport and the datagram endpoint do not forward: no caller hands a support helper a TCP or UDP fake through them.

  Announcers:
  - `fake_http.spawn`'s TCP path and `fake_metering.spawn` announce their address while they listen, and withdraw it at teardown and when the lane is taken down.
  - `_resetting_daemon` in `tests/api/test_control_failure_reads.py` announces its address the same way. That is the only change to that file here, and plan 3 task 4 replaces it.

  A forwarded dial is a real TCP connection, so the guard flags it. Every such dial is in a file plan 3 migrates, and plan 3's per-file guard checks fail any forwarded dial left after a file moves.
- **Verify:** Transition scaffolding that plan 4 task 3 deletes, so it gets no test of its own, since that test would be deleted with it. Its proof is task 5's check, where these five files stay green with the helpers on the network. Here, `scripts/gate.sh make check` is green, which shows that an announcement changes nothing while no support helper dials through the network.

### Task 5: The shared 8088 fakes register on the network and every app the support helpers build dials through it

- **Files:** tests/conftest.py, tests/support/fixtures_daemons.py, tests/support/fixtures_clients.py, tests/support/apps.py, .filepawl.toml
- **Action:** The fixtures `http_daemon`, `stale_http_daemon`, `clamping_http_daemon`, `dying_http_daemon`, `restore_refusing_http_daemon` and `restore_recovering_http_daemon` serve one `st` both on TCP and at the same `(host, port)` on the network. Taking the lane down (`st["_take_lane_down"]`, and `_die`) stops both listeners and severs both sets of connections, so a test sees one daemon.

  These all build on the network:
  - `http_manager_factory` and `start_manager` build their `HttpConfigClient` with the network's transport through `HttpOptions`, and their `ConnectionManager` with the network.
  - In `fixtures_clients`, `app`, `live_api`, `chain_api`, `gated_app`, `api_client` and `http_client` pass the network to `create_app`.
  - In `apps`, `unserved_login` and `live_app` pass the network to `create_app`.

  `unserved_login`'s login fake is dialed only by the app's own login route, so it serves network-only. `log_in` and `closed_port` keep their behavior.
- **Verify:** Pure scaffolding refactor, so the rule 8 exemption applies.
  - `scripts/gate.sh .venv/bin/pytest tests/apply/test_http_apply.py tests/engine/test_devicecaps.py tests/api/test_status_bands.py tests/api/test_meter_feed_route.py tests/api/test_control_failure_reads.py -q` is green: task 4's five files still reach their own fakes.
  - `scripts/gate.sh make check` is green. This is also the check on task 4's sweep: a file of the same shape that the sweep missed goes red here. That is a stop-and-report naming the file and its fake, whose fix is an announcement in that file as task 4 makes; it is never answered by editing an assertion.
  - `PYTHONPATH=tests/support scripts/gate.sh .venv/bin/pytest -m "not live and not e2e" -p socket_guard -q` is red only on test files in plan 3's eight task lists, on `tests/gates/test_tested_release.py`, on `tests/test_desktop.py::test_a_listener_takes_connections_before_it_runs`, and on tests flagged only in teardown that hold one of this task's six dual-served 8088 fixtures (their TCP half's wake). Read the log at the printed path, and confirm that every guard error falls in one of those four. For the fourth, the error names the teardown phase alone and the test's fixture closure (`--setup-plan` on that test id) includes one of the six. A guard error anywhere else, or a setup or call record at a test of the fourth kind, means that test reaches a fake through a support path this plan missed. That is fixed here, not deferred.

## Notes

- The guard has no event-loop condition (owner ruling). `tests/test_desktop.py` is in its scope: plan 1 task 8 moved its occupant and knock tests in-process, and plan 4 task 2 moves its listener test off a connection.
- The teardown allowance in task 5's check, and in plan 3's checks, is a reading of an intermediate run, not part of the guard. Plan 4 task 3 drops the TCP halves that cause it, and plan 4's whole-suite run allows no guard error at all.
