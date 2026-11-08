PLAN COMPLETE

Plan: .planning/phases/5/PLAN-2.md

Tasks: 5 of 5

| Task | Commit | Note |
|---|---|---|
| 1 | 740b9499 | tests/support/socket_guard.py (audit hook, pure `flagged(event, family, current)`, per-phase wrappers, autouse refusing fixture) and tests/test_socket_guard.py (one parametrized test, 10 cases). Null stub fails the 6 flagged cases by assertion. Wired: test_control.py errors naming 127.0.0.1 ports; test_desktop.py flags only test_a_listener_takes_connections_before_it_runs. `__all__` lists the three hooks (the env_probe convention) so vulture needs no exemption. |
| 3 | 40fc4d56 | Committed before task 2 (order change, see Deviations). `Rig.attach` serves through `fake_network.serving(partial(fake_metering.serve, frame=...))`, reader built with `opener=NETWORK.open_stream`. test_junkcal 10 of 10 green after; guard run over test_junkcal green. |
| 2 | 85d35084 | Control fakes also register on the network (`spawn_threaded_daemon`, `live_daemon_port`, `daemon`, the three client fixtures, both threaded ports); clients take `opener=NETWORK.open_stream`; `live_manager` builds its manager on `NETWORK`; `start_manager` on `Network(NETWORK.open_stream)` (stream half only, its 8088 client moved in task 5). Guard run over test_recv_resilience, test_live_snapshot, test_setters: green. |
| 4 | 1d1c3113 | `fake_network.announce`/`withdraw`; `open_stream` and an async `_Transport` (MockTransport subclass) forward announced, not-registered addresses over real TCP; `fake_http.spawn` TCP path, `fake_metering.spawn` and `_resetting_daemon` announce. make check green. |
| 5 | a47199af | `fake_http.spawn(..., networked=True)` serves one `st` on TCP and on the network at the same address; the six 8088 fixtures use it; lane down stops both. `http_manager_factory`, `start_manager` build their client with `NETWORK.http_options` and their manager on `NETWORK`; `fixtures_clients` apps and `apps.unserved_login` pass `NETWORK` to `create_app`; the login fake is now `in_process=True`. The five task 4 files: 79 passed. make check green. |

Whole-suite guard run (`-m "not live and not e2e" -p socket_guard`): 2770 passed, 685 errors, 0 failures. 385 errors are in files named in plan 3 task lists or `tests/gates/test_tested_release.py`, and 1 is `tests/test_desktop.py::test_a_listener_takes_connections_before_it_runs`. The other 299 are in 25 files outside those lists; every one is teardown-only, and `--setup-plan` shows a dual-served 8088 fixture in each closure (three parametrized cases reach it through `request.getfixturevalue("http_client")` or the `http_daemon`-built `audit_client`/`unlogged_client`, confirmed by reading the fixtures). No setup or call record at a test of the fourth kind.

Final suite: `scripts/gate.sh make check` (workflow.test_command is null; the Makefile target) green at a47199af.

Deviations: [deviation] task 3 committed before task 2. Plan asserted task 2 leaves `make check` green; observed otherwise: with `live_manager` on the in-process network its polls finish instantly, and `tests/test_junkcal.py` (whose rig still dialed a real TCP 4322 stream until task 3) failed in 6 of 8 runs ("the fakes never reached the state the case arranged"), against 0 of 8 at HEAD before. Task 3's change is independent of task 2, so it was committed and gated first.

Open items: `fake_http.spawn` gained a `networked` keyword (the plan lists no new parameter) so one `st` can be served both ways without reaching into private handler names. `MeteringReader` takes `opener` as a constructor keyword now (plan 1's report said attribute; later commit changed it), so the rig passes it that way.
