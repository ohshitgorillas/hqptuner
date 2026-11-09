---
phase: 6
plan: 3
# Phase 6 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against findings F-004, F-005, F-015, F-017, F-020, F-021, F-022 and F-023, the Success Criteria and CONTEXT AC1-AC7.
requirements: []
files:
  - hqptuner/core/connection.py
  - hqptuner/api/factory.py
  - hqptuner/api/lifespan.py
  - hqptuner/api/routes/connection.py
  - hqptuner/api/routes/status.py
  - hqptuner/api/routes/discovery.py
  - hqptuner/engine/discovery.py
  - hqptuner/config.py
  - Dockerfile
  - compose.yaml
  - README.md
  - CHANGELOG.md
  - docs/architecture.md
  - docs/openapi.json
  - hqptuner/static/store/setup.js
  - hqptuner/static/components/Setup.js
  - tests/api/surface/test_startup_bad_host.py
  - tests/api/surface/test_alias_marker.py
  - tests/api/test_container_host_alias.py
  - tests/api/test_discovery_route.py
  - tests/api/test_discovery_network.py
  - tests/js/store/setup.test.js
  - tests/js/components/chrome/setup.test.js
  - .filepawl.toml
---

# Phase 6: Connection host and stored credential - Plan 3: A bad saved host never stops the start, and the container alias is only offered

## Goal

Findings F-004, F-005, F-015, F-017, F-020, F-021, F-022 and F-023 are each fixed or carry an owner ruling. This plan closes F-015 at startup and F-022: a saved record whose host fails Plan 1's validator is handled like a corrupt record, and `host.docker.internal` is probed only inside the image and offered, never adopted.

## Must be true when done

- With `connection.json` holding the host `a:b` at start, the app starts, `/api/health` answers 200, and the SPA shows the Connection panel (AC3).
- A corrupt or invalid saved record counts as a chosen host: no alias probe follows it (D-09).
- Without the image marker, a start with no saved host and an empty `/api/discover` sweep send no request to `host.docker.internal` (AC4).
- With the marker, a start does not set the host from the alias; an answering alias is offered in the Connection panel for the user to choose (AC4, D-04).
- `README.md`, `compose.yaml` and the `Config.container_host_alias` comment say what the code does.

## Context

- Builds on Plan 1's validator in `hqptuner/conf/` (importable from `core`) and Plan 2's discovered-daemon list in the panel.
- Locked: D-04 (marker set in the `Dockerfile` `ENV` block; Docker only; never sniff `/.dockerenv` or `/run/.containerenv`; the gate covers startup and the `/api/discover` empty-sweep fallback), D-09, D-17, D-18 (`tests/api/test_container_host_alias.py` `test_a_start_dials_the_record_then_the_variable_and_falls_back_to_the_host_alias` alias case replaced as an owner-approved behavior change).
- `create_app` (`hqptuner/api/factory.py`) and `_adopt_alias` (`hqptuner/api/lifespan.py`) both already catch `StoreCorruptError` and log "starting unconfigured"; `ConnectionStore.read` raises `ConnectionStoreCorruptError`. `host_is_unchosen` decides whether the alias is probed.
- Out: podman; the three 8088 refusal sentences (D-10).

## Tasks

### Task 1: A saved host the validator refuses is read as a corrupt record

- **Files:** hqptuner/core/connection.py, hqptuner/api/routes/connection.py, tests/api/surface/test_startup_bad_host.py
- **Action:** `ConnectionStore.read` runs Plan 1's validator on the stored host and raises `ConnectionStoreCorruptError` for one it refuses, so `create_app` logs its warning and starts without the record, the 8088 client is never built from it, and the file stays on disk until a save replaces it (D-09). A record written under a pin by Plan 1 Task 6 still reads as that task recorded. `remembered` in `hqptuner/api/routes/connection.py` also reads the store, and `login` calls it on every accepted login; a record the store refuses must not turn that login into a `store_corrupt` 500, or the panel D-09 opens cannot lead to the save that replaces the file. Treat a refused record there as no choice made, for a corrupt and an invalid record alike (D-09: "handled like a corrupt record"), and say so in its docstring.
- **Verify:** Testing scope, REST lane (strong area `hqptuner/conf/` through its caller): a `create_app` over a record holding `a:b` builds, `/api/health` answers 200, `/api/login` with the pair in force answers 200 (so the panel's login screen can lead to a save), and the file is still on disk afterwards. The SPA opening its panel on a gated refusal is already covered by `tests/js/store/setup.test.js` `test_a_request_refused_for_want_of_a_login_opens_the_panel`. Bite: the first case red against the commit before this one (the build raised `InvalidURL`; the test takes the start's outcome as a value so the red run is an assertion failure). `scripts/gate.sh make check` prints `exit=0`.

### Task 2: A corrupt or invalid record counts as a chosen host

- **Files:** hqptuner/api/lifespan.py, hqptuner/core/connection.py, tests/api/surface/test_startup_bad_host.py
- **Action:** `_adopt_alias` returns without probing when `ConnectionStore.read` raised, so a corrupt or invalid record never starts the alias probe (D-09). Keep `host_is_unchosen`'s meaning for the record-absent case; the corrupt case is decided before it.
- **Verify:** Testing scope, REST lane with an alias fake that counts requests on the in-process network: a start over a corrupt record (unparseable JSON) and one over a record holding `a:b` each leave the alias fake at zero requests (two cases). Bite: both red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`.

### Task 3: The image carries the marker, and only a marked start probes the alias

- **Files:** Dockerfile, hqptuner/config.py, hqptuner/api/lifespan.py, tests/api/surface/test_alias_marker.py, tests/api/surface/test_startup_bad_host.py, tests/api/test_container_host_alias.py, tests/api/test_discovery_network.py
- **Action:** Add a new `HQPTUNER_*` variable to the `Dockerfile` `ENV` block that says the process runs in the HQPTuner image, read by a new `Config` field with the default meaning "not in the image" (D-04). `_adopt_alias` probes the alias only when that field says so. Name the variable in `README.md`'s table in Task 7. Two existing tests build a `Config` with no marker and expect an unmarked start to probe the alias, so this task turns them red: the alias case of `tests/api/test_container_host_alias.py::test_a_start_dials_the_record_then_the_variable_and_falls_back_to_the_host_alias` (D-18 names it) and both cases of `tests/api/test_discovery_network.py::test_a_start_with_no_host_adopts_the_alias_served_in_process` (not named by D-18: Plan 1 Notes, owner approvals, item 9). In this commit each is replaced by the same claim made for a marked start, since D-04 makes the probe an in-image behavior; Task 5 replaces them again for the offer. The second is replaced only on the owner's confirmation; never edit either to pass. Task 2's two cases are built with the marker on from this commit, since an unmarked start no longer probes and they would pass with the corrupt-record return deleted; that is the setup D-09 is about, not an edit to pass, because both still assert zero alias requests.
- **Verify:** Testing scope, REST lane: a start with no record, no host pin and the marker off leaves the alias fake at zero requests; with the marker on, the alias fake is asked; Task 2's two cases, marker on, still leave the alias fake at zero requests, and each turns red when `_adopt_alias`'s corrupt-record return is removed (checked once by hand, reported in the commit). Bite: the first red against the commit before this one. Before replacing the two existing tests, run them against this task's code and report which cases are red; expected: the alias case of the first and both cases of the second, nothing else. The `Dockerfile` line itself is checked by the `smoke` CI job, which builds the image (the phase's CI checkpoint, Plan 5 Notes). `scripts/gate.sh make check` prints `exit=0`.

### Task 4: The discovery fallback asks the alias only in the image

- **Files:** hqptuner/api/routes/discovery.py, hqptuner/engine/discovery.py, tests/api/test_discovery_route.py
- **Action:** The marker is read at the route. `discover_daemons` builds its `Search` with `cfg.container_host_alias` only when Task 3's marker field is on, and with no alias otherwise; `Search.alias` admits an absent value, and `discover` skips the empty-sweep probe when `search.alias` is absent, so `discover` keeps one decision point and never reads `Config` (D-04). `Search`'s default stays `ALIAS`. Which tests turn red follows from that choice. Every `Search(...)` the tests build names its alias explicitly (`tests/engine/test_discovery.py`, three sites; `tests/api/test_discovery_network.py` `test_a_search_handed_the_network_lists_the_daemon_the_responder_names`), so no engine test changes. `test_the_discover_route_on_an_app_handed_the_network_lists_the_same` gets an answered datagram, so it never reaches the fallback. The one red case is the alias-listening case of `tests/api/test_discovery_route.py::test_a_zero_search_window_still_serves_the_daemon_the_host_alias_names`, whose `Config` carries no marker. It is replaced by the same claim made with the marker on, and the unmarked case below is added. D-18 does not name it, so it is replaced only on the owner's confirmation (Plan 1 Notes, owner approvals, item 10); never edit it to pass.
- **Verify:** Testing scope, REST lane on the in-process network: without the marker, an empty sweep answers `[]` and the alias fake counts zero requests; with it, an empty sweep lists the alias's daemon. Bite: the first red against the commit before this one. Before replacing the existing case, run `tests/api/test_discovery_route.py`, `tests/api/test_discovery_network.py` and `tests/engine/test_discovery.py` against this task's code and report which cases are red; expected: only that alias-listening case. Any other red case is reported to the owner before any edit. `scripts/gate.sh make check` prints `exit=0`.

### Task 5: A marked start offers the alias and never adopts it

- **Files:** hqptuner/api/lifespan.py, hqptuner/api/routes/status.py, docs/architecture.md, docs/openapi.json, tests/api/test_container_host_alias.py, tests/api/test_discovery_network.py
- **Action:** `_adopt_alias` no longer writes `cfg.hqp_host` or rebuilds the 8088 client. An alias that answers is kept as an offer, in app state and in no store, and reported to the panel through `/api/health`'s answer, the one read open before login (`OPEN_PATHS`), so a fresh container install that starts logged out sees the offer and can name the alias in its login (D-01). The field carries only the alias host name, and only when it answered; record it in `docs/architecture.md`. Replace the alias case of `test_a_start_dials_the_record_then_the_variable_and_falls_back_to_the_host_alias` (D-18); its record and variable cases stay. Replace `tests/api/test_discovery_network.py::test_a_start_with_no_host_adopts_the_alias_served_in_process`, as Task 3 left it, with its claim for the offer: a marked start reaches the alias through the network it was handed and reports it as offered. That needs the owner's confirmation (Plan 1 Notes, owner approvals, item 9). A fresh install whose daemon is elsewhere still reaches it, because a login may name any host (D-01).
- **Verify:** Testing scope, REST lane with three daemon pairs as the existing test builds them: with the marker on and no record, `GET /api/connection` after start names the default host, not the alias's address; `GET /api/health` with no login cookie reports the alias as offered, and reports no offer when the alias did not answer; the record and variable cases still dial their own daemon unchanged; a marked start on `fake_network.NETWORK` reports the in-process alias as offered. Bite: the first two red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`, `check_openapi.py` included.

### Task 6: The panel shows the alias offer

- **Files:** hqptuner/static/store/setup.js, hqptuner/static/components/Setup.js, tests/js/store/setup.test.js, tests/js/components/chrome/setup.test.js
- **Action:** When Task 5's read reports an offered alias, the panel shows it in the owner-approved alias-offer wording (D-17) with a pick that puts the address in the host field through `fillHost`, saving nothing. If the wording is not in hand, stop and ask. Reuse Plan 2's list entry if the offer is a daemon record. The existing `hostHelp` lines stay unchanged.
- **Verify:** Testing scope, store lane plus component lane: a logged-out panel whose health read carries an offer renders one pickable offer found by `data-testid`; picking it sets the host field to the offered address; no save request is sent. Bite: red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`.

### Task 7: The docs say what the alias does now

- **Files:** README.md, compose.yaml, hqptuner/config.py, hqptuner/engine/discovery.py, CHANGELOG.md
- **Action:** `README.md`'s `HQPTUNER_CONTAINER_HOST_ALIAS` row ("Address tried at startup and by discovery when nothing else has named the daemon's host") and a new row for Task 3's marker; `compose.yaml`'s header comment ("HQPTuner finds it there on first start"); the `container_host_alias` comment in `hqptuner/config.py` and `ALIAS`'s comment in `hqptuner/engine/discovery.py` ("resolves inside a container only") each say what the code now does. `README.md` and `compose.yaml` reach users, so their wording is the owner's (D-17); if it is not in hand, stop and ask. If the approved `### Security` entry from Plan 2 does not cover the alias change, the owner approves its bullet and it lands here.
- **Verify:** Testing scope: documentation only, no test. `scripts/gate.sh make check` prints `exit=0`; `.claude/hooks/md-softwrap.py --check README.md` passes; `scripts/gates/check_changelog.py` passes if `CHANGELOG.md` changed; the triviajudge hooks raise no flag on the added lines.

## Notes

- **Copy (D-17), each pending owner approval before its task:** the alias offer (Task 6), the `README.md` rows and `compose.yaml` comment (Task 7), a `CHANGELOG.md` bullet only if Plan 2's entry does not cover this change.
- **Tests D-18 does not name.** Tasks 3 and 5 replace both cases of `tests/api/test_discovery_network.py::test_a_start_with_no_host_adopts_the_alias_served_in_process`. Task 4 replaces the alias-listening case of `test_a_zero_search_window_still_serves_the_daemon_the_host_alias_names`. The marker is read at the route, so `tests/engine/test_discovery.py` is untouched. Each replacement needs the owner's word, gathered in Plan 1 Notes "Owner approvals needed before execution".
- Recalled (phases/4/SUMMARY.md, phase 4): the state export already withholds `connection.json` and the configured record's name, so a corrupt record kept on disk by Task 1 does not leak through the export.
- Shared with Plans 1, 2 and 5, which run in order 1, 2, 3, 4, 5: `hqptuner/core/connection.py`, `hqptuner/api/lifespan.py`, `hqptuner/api/routes/connection.py`, `hqptuner/config.py`, `hqptuner/engine/discovery.py`, the panel's two JS files and their tests, `CHANGELOG.md`, `docs/architecture.md`, `docs/openapi.json`, `.filepawl.toml`.
