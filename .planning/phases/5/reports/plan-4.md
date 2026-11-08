PLAN COMPLETE

Plan: .planning/phases/5/PLAN-4.md

Tasks: 5 of 5

| Task | Commit | Note |
|---|---|---|
| 1 | 38c470b2 | Plugin adds hook `pytest_tested_release_network(config) -> Network \| None`; sessionfinish reads `/about` through the handed network, real `Network()` when none answers. Bite: plugin ignoring the hook: 7 failed + 7 errors, first case by assertion. make check green. Rule 8 exemption: scaffolding refactor. |
| 2 | 409fa539 | `test_a_listener_takes_connections_before_it_runs` asserts `SO_ACCEPTCONN == 1` on the bound socket; `accepts` deleted. Bite: `listen` replaced by `pass`: `assert 0 == 1`. make check green. |
| 3 | 5cbd0c2f | `spawn_threaded_daemon` only registers; control and 8088 fixtures in-process only; `fake_http.spawn` loses `networked` announce/withdraw; `fake_network` loses `announce`, `withdraw`, the TCP forward and `_Transport`. Owner approved `tests/presets/test_description_routes.py` into the lease. 2770 passed with `-p socket_guard`; `scripts/gate.sh make check` green. `make test-e2e` not run (CI `e2e` carries it). Rule 8 exemption: scaffolding refactor. |
| 4 | b6e93b13 | `socket_guard` added to `pytest_plugins`. Plain offline run (no `-p`): 2770 passed. make check green. No test flagged. CI-job human-verify (`check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos`, `smoke-windows`) is the owner's: needs push and, for the five release.yml jobs, a tag. |
| 5 | 64ffd36d | docs/testing.md: rule 18 added after rule 17, rule 4 phrase changed, rule 7 "Fake servers tear down promptly." bullet rewritten, all three verbatim as the owner approved. `md-softwrap.py --check docs/testing.md` rc=0; `grep -n "^18\. "` shows line 69; `grep -n "real socket"` empty; no em dash in added lines; lease-check ok; pre-commit (incl. triviajudge-md) passed. |

Deviations: none

Open items:
- Task 4 required CI jobs are owner-verified (see row 4).
- `fixtures_daemons.daemon`'s `spawn` is a plain function returning `asyncio.sleep(0, result)`; its 20 `await daemon(...)` callers in 17 files stay (outside the lease); ruff `unused-async` rejects an `async def` with no await. A later plan can make the factory synchronous.
- Closing full suite: `scripts/gate.sh make check` (workflow.test_command null; Makefile target) exit=0, log /tmp/gate-make-VSwBvQdV.log.
