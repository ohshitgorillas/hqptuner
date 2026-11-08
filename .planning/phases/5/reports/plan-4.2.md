PLAN CHECKPOINT: human-verify

Plan: .planning/phases/5/PLAN-4.md

Tasks: 4 of 5

| Task | Commit | Note |
|---|---|---|
| 1 | 38c470b2 | Plugin adds hook `pytest_tested_release_network(config) -> Network \| None`; sessionfinish reads `/about` through the handed network, real `Network()` when none answers. Bite: plugin ignoring the hook: 7 failed + 7 errors, first case by assertion. make check green. Rule 8 exemption: scaffolding refactor. |
| 2 | 409fa539 | `test_a_listener_takes_connections_before_it_runs` asserts `SO_ACCEPTCONN == 1` on the bound socket; `accepts` deleted. Bite: `listen` replaced by `pass`: `assert 0 == 1`. make check green. |
| 3 | 5cbd0c2f | `spawn_threaded_daemon` only registers (thread and loop gone); control and 8088 fixtures in-process only; `fake_http.spawn` loses `networked` announce/withdraw; `fake_network` loses `announce`, `withdraw`, the TCP forward and `_Transport`; conftest, `fixtures_daemons`, `fake_http.spawn` and e2e `stack.py` comments rewritten. Owner approved `tests/presets/test_description_routes.py` into the lease: `daemon_backup` now passes `transport=http_transport("127.0.0.1", port)` (fake_network's `http_transport`, a `httpx.MockTransport`, sync-client typed; `NETWORK.http_transport` is async-typed and failed mypy). Greps: `start_server\|SOCK_DGRAM\|\.listen(\|create_connection` shows only `fake_http.py:621` (teardown wake of the TCP default); `open_connection` in fake_network only `sock=` calls; no `announce`/`withdraw(` in tests. `PYTHONPATH=tests/support scripts/gate.sh .venv/bin/pytest -m "not live and not e2e" -p socket_guard -q`: 2770 passed. `scripts/gate.sh make check` green. `make test-e2e` not run (CI `e2e` carries it). Rule 8 exemption: scaffolding refactor. |
| 4 | b6e93b13 | `socket_guard` added to `pytest_plugins` in `tests/conftest.py`. Plain `scripts/gate.sh .venv/bin/pytest -m "not live and not e2e" -q` (no `-p`): 2770 passed. `scripts/gate.sh make check` green. No test flagged. CI-job human-verify (`check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos`, `smoke-windows` on the phase's last `dev` commit) is the owner's: needs push and, for the five release.yml jobs, a tag. |
| 5 | not started | Needs owner approval of rule 18 and rule 7 bullet wording before the commit. |

Deviations: none

Open items:
- Task 5 (docs/testing.md): owner must approve or replace the rule 18 wording and the rule 7 "Fake servers tear down promptly" bullet wording (proposed text in PLAN-4.md Task 5), and rule 4's one-phrase change.
- Task 4 required CI jobs are owner-verified (see row 4).
- `fixtures_daemons.daemon`'s `spawn` is a plain function returning `asyncio.sleep(0, result)`; its 20 `await daemon(...)` callers in 17 files stay (outside the lease); ruff `unused-async` rejects an `async def` with no await. A later plan can make the factory synchronous.
- Full-suite run for the plan's closing allowance not yet taken (plan not complete); the guard-on offline suite ran green twice above.
