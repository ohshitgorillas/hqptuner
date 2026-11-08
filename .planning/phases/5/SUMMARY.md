---
phase: 5
status: complete
completed: 2026-11-07
---

# Phase 5: Offline tests reach their fake daemons in-process - Summary

Every daemon lane (4321 and 4322 control streams, 8088 HTTP, discovery UDP, metering, the desktop knock) now dials through a `Network` handed in at construction, the offline fakes serve only on the in-process `tests/support/fake_network.py`, and `socket_guard` fails any offline test that opens a TCP or UDP connection.

## What shipped

- `Network` seam (`open_stream`, `http_transport`, `http_options`, `open_datagram`) - `hqptuner/core/network.py`, carried by `create_app`, the manager, the loader, `check_pair`, `release.fetch_about`, discovery `Search`, `MeteringReader` and `desktop.answers`
- In-process network for tests: stream half over `socket.socketpair()`, 8088 half over an httpx `MockTransport`, datagram registry, `reset` for connection-reset fidelity - `tests/support/fake_network.py`
- Socket guard (audit hook, flags any TCP or UDP connect outside `live` and `e2e`) - `tests/support/socket_guard.py`, registered for every offline test in `tests/conftest.py:40`
- Shared fixtures and every test file that built its own clients or fakes moved onto the in-process network - `tests/support/fixtures_daemons.py`, `tests/support/fixtures_clients.py`, plan 3's files
- Offline fakes hold no listener: `fake_network` lost `announce`, `withdraw` and the TCP forward, and `fake_http.spawn` lost `networked`. TCP serving stays only in the e2e stack and `fake_http.spawn`'s default
- Tested-release plugin reads `/about` through a network a test hands it, via the `pytest_tested_release_network` hook - `scripts/pytest_plugins/tested_release.py`
- Rule 18 added, rule 4 phrase and rule 7 teardown bullet rewritten, verbatim as the owner approved - `docs/testing.md`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | 59332122 | ControlClient `opener` keyword; fake_network stream half |
| 1 | 2 | ed509584 | `core/network.py` Network(open_stream) carried by manager, create_app, loader |
| 1 | 3 | 94cefd13 | Network.http_transport; build_http_client takes the network; fake_http in-process spawn |
| 1 | 4 | db360156 | check_pair takes `float \| HttpOptions`; login route passes the network transport |
| 1 | 5 | fe18ecaa | Network.http_options; release.fetch_about and readers pass it |
| 1 | 6 | cb38f86b | Network.open_datagram; discovery Search gains opener and datagrams |
| 1 | 7 | 131ba82c | MeteringReader dials through the network's opener |
| 1 | 8 | eb2834a8 | desktop.answers takes a sockets factory; occupant and knock tests in process |
| - | - | d2025f73 | ruff ignores PLR0911, PLR0912, PLR0913 and PLR0915 project-wide, by owner instruction |
| 1 | - | eb54bd46 | check_pair, MeteringReader and discover take the transport and openers as plain arguments |
| - | - | 34ff3147 | ruff ignores PLR0917 too |
| 2 | 1 | 740b9499 | socket_guard plugin and its test |
| 2 | 3 | 40fc4d56 | junkcal rig serves metering in process |
| 2 | 2 | 85d35084 | control fakes register on the network; clients and managers use it |
| 2 | 4 | 1d1c3113 | transitional announce and TCP forward for not-yet-moved dialers |
| 2 | 5 | a47199af | 8088 fixtures dual-served; factories and apps on the network |
| 3 | 1 | 1c2c296d | seven control-client engine tests in process |
| 3 | 2 | 743917c5 | four engine files on the network; fake_discovery.responder removed |
| 3 | 3 | 9f91c86b | eight login, connection, alias and release files |
| 3 | 4 | 9935354e | eight API files; fake_network.reset; fake_metering.spawn removed |
| 3 | 5 | 3aeb495e | six 8088 apply and manager-connection files |
| 3 | 6 | 87147b4a | seven live-report, state-refusal and audit files |
| 3 | 7 | 5786abb1 | nine preset files |
| 3 | 8 | b59c30fb | matrix, speaker and coverage-floor files |
| 4 | 1 | 38c470b2 | tested-release plugin network hook; its test in process |
| 4 | 2 | 409fa539 | desktop listener test reads SO_ACCEPTCONN instead of connecting |
| 4 | 3 | 5cbd0c2f | offline fakes stop listening on TCP and UDP |
| 4 | 4 | b6e93b13 | socket_guard registered for every offline test |
| 4 | 5 | 64ffd36d | docs/testing.md rule 18, rule 4 and rule 7 |

## Deviations

- [deviation] Plan 1 tasks 5 and 7: new test files would have pushed `tests/engine` past its 30-file directory cap, so by owner checkpoint they moved to `tests/api` (`test_ungated_readers_network.py`, `test_metering_network.py`). fe18ecaa, 131ba82c
- [deviation] Success Criterion 4 (no gate changed): by owner instruction, ruff no longer enforces PLR0911, PLR0912, PLR0913, PLR0915 or PLR0917 (`pyproject.toml` `ignore`). `check_pair` takes the transport as a keyword-only argument, `MeteringReader` takes its opener in the constructor, and `discover` takes the opener and datagram factory as arguments. d2025f73, eb54bd46, 34ff3147
- [deviation] Plan 2 task 3 committed before task 2: with `live_manager` in process, `tests/test_junkcal.py` failed in 6 of 8 runs until its rig moved too. 40fc4d56, 85d35084
- [deviation] Plan 2 task 5: `fake_http.spawn` gained a `networked` keyword the plan did not list. Plan 4 task 3 removed it again. a47199af, 5cbd0c2f
- [deviation] Plan 4 task 3: `daemon_backup` in `tests/presets/test_description_routes.py` still dialed `http_daemon` over TCP ("Connection refused" once the fakes went in-process). The owner approved adding the file to the plan's lease, and it now uses `fake_network.http_transport`. 5cbd0c2f

## Open items

- Required CI jobs `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` not yet run on the phase's last `dev` commit (Success Criterion 6). Needs an owner push, and a tag for the five `release.yml` jobs.
- `make test-e2e` not run locally for any plan (no Playwright browser on this host). CI `e2e` carries it.
- `fixtures_daemons.daemon`'s `spawn` returns `asyncio.sleep(0, result)` from a plain function. Its 20 `await daemon(...)` callers in 17 files are outside the lease. A later plan can make the factory synchronous.
- `fake_control`'s GetInfo name is fixed as "Fake", so plan 1 task 1's check reads back the State volume the test wrote.

## Goal check

The commits plausibly deliver the goal. Every lane the app dials takes its network at construction (plan 1, eight commits 59332122..eb2834a8). The guard is now in `pytest_plugins` for every offline run (`tests/conftest.py:40`). A plain offline run with it registered gave 2770 passed and nothing flagged (plan 4 task 4 report). The only listener left in `tests/support` is `fake_http.spawn`'s TCP default (`tests/support/fake_http.py:602-620`), kept for the e2e stack's subprocess app, as Success Criterion 3 allows. Rule 18 is at `docs/testing.md:69`. `scripts/gate.sh make check` exited 0 at 64ffd36d (log `/tmp/gate-make-VSwBvQdV.log`). Not shown here: that the clock gate's reading no longer depends on machine load. The suite simply no longer touches the network, and no load comparison was run. Success Criterion 6's CI jobs are still pending.

complete locally, not CI-verified
