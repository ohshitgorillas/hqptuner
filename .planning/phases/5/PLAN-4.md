---
phase: 5
plan: 4
# Phase 5 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against its goal and Success Criteria 1-6.
requirements: []
files:
  - scripts/pytest_plugins/tested_release.py
  - tests/gates/test_tested_release.py
  - tests/conftest.py
  - tests/support/fixtures_daemons.py
  - tests/support/fake_metering.py
  - tests/support/fake_discovery.py
  - tests/support/fake_network.py
  - tests/support/fake_http.py
  - tests/e2e/support/stack.py
  - tests/test_desktop.py
  - docs/testing.md
  - .filepawl.toml
---

# Phase 5: Offline tests reach their fake daemons in-process - Plan 4: The offline fakes stop listening on the network and the socket guard holds it

## Goal

Every offline test reaches each fake daemon it talks to in-process, so no offline test opens a real network connection and the clock gate's reading no longer depends on how busy the machine running the suite is. This plan migrates the last offline dialers, removes the TCP and UDP listeners the offline fakes kept for the transition, turns the socket guard on for every offline test, and writes the rule into `docs/testing.md`.

## Must be true when done

- No test outside the `live` and `e2e` markers opens a TCP or UDP connection, to a fake daemon or to anything else. The guard, now registered for every offline test, enforces it on every `make check` with no exemption (Success Criterion 1, owner ruling).
- The offline fakes listen only in-process. TCP serving survives only where the app runs in a subprocess, in the e2e stack and in `fake_http.spawn`'s default, and in `scripts/ci/daemon_standin.py` for the CI lifecycle jobs (Success Criterion 3).
- `docs/testing.md` states that tests hand the network in through the constructor rather than opening real connections to fakes, and its rules 4 and 7 no longer describe the offline fakes as real sockets or listener threads.
- `make test-live`'s release record still reads the real daemon over the real network, and its offline test reaches its fake in-process.
- No gate, gate threshold or exemption changed (Success Criterion 4). `scripts/gate.sh make check` is green, clock gate included, and the required CI jobs `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` pass on the phase's last `dev` commit (Success Criterion 6; the required set is the one Phase 1 Success Criterion 4 names).

## Context

- Depends on plans 1 to 3. After plan 3, the whole-suite guard run flags only `tests/gates/test_tested_release.py`, `tests/test_desktop.py::test_a_listener_takes_connections_before_it_runs`, and teardown-only wakes at tests holding a dual-served 8088 fixture (plan 2's Context). No test dials through plan 2 task 4's forward any more, since plan 3 moved every file that did.
- `tests/e2e/support/stack.py` runs the app as a subprocess and keeps its own TCP `spawn_control` and `fake_http.spawn`'s TCP default. Only a comment there may need to stay true.

## Tasks

### Task 1: The tested-release plugin can be handed a transport, and its test reaches its fake in-process

- **Files:** scripts/pytest_plugins/tested_release.py, tests/gates/test_tested_release.py
- **Action:** `pytest_sessionfinish` reads `/about` through `release.fetch_about` with an `HttpOptions` whose transport comes from a source the plugin declares. The source is the executor's choice, within these constraints:
  - It is a pytest-native input, such as a hook the plugin adds or a stash key a plugin object sets.
  - A run that hands nothing in, which is `make test-live`, reads the real daemon over the real network exactly as today.
  - Nothing patches `hqptuner/` or `scripts/` code.
  - The outer test hands the suite network's transport into its in-process inner run through `pytester.runpytest_inprocess`'s plugin objects.
  - The plugin's own rule stays: it reads the daemon the shell named when the run was configured, not the one a suite fixture repointed to.

  In the test, the `daemon` fixture and the repointing case serve their 8088 fakes and their control fake in-process. The test's assertions, cases and names are unchanged.
- **Verify:** Testing scope:
  - Outcomes: the existing cases still pass once the 8088 fakes are in-process. A green live run records the release the in-process fake prints. A repeat adds nothing. A non-green run adds nothing. The shell-named daemon wins over the repointed one.
  - Already covered: those are the existing tests. Only their scaffolding changes, so no new test is needed.
  - Bite: the null stub is the plugin declaring the input and ignoring it, so it dials TCP. The first case then records nothing, and must fail by assertion.
  - Testing stops there.
  - Commands: `PYTHONPATH=tests/support scripts/gate.sh .venv/bin/pytest -p socket_guard tests/gates/test_tested_release.py -q` is green with no guard error, then `scripts/gate.sh make check` is green.

### Task 2: The desktop listener test sees the listen socket listening without connecting to it

- **Files:** tests/test_desktop.py
- **Action:** Owner ruling 2's scope expansion covers this site: `test_a_listener_takes_connections_before_it_runs` connects to the port a `desktop.Listening` bound, through its `accepts` helper, which is a real loopback TCP connection in an offline test. It is HQPTuner's own listener, not a fake daemon, so there is no in-process network to hand it. The behavior stays as the test names it: a constructed `Listening` already listens, so a browser's connection made before `run` is queued, not refused.
  - The test observes that through the bound socket itself, with no connection. `uvicorn.Config.bind_socket` binds and does not listen, so only `Listening`'s own `listen` call puts the socket in the listening state. The observation is the test writer's choice; Linux exposes that state as `socket.SO_ACCEPTCONN`, and the offline suite runs on Linux only.
  - The real bind stays: a bind is not a connection, and the guard records none. `accepts` goes if nothing else uses it.
  - The test keeps its name. No production code changes.
- **Verify:** Testing scope:
  - Outcome: a constructed `Listening`'s socket is listening before `run`.
  - Bite: there is no pre-change state to fail, so the null stub stands in. It is a `Listening` without its `listen` call, and the test must fail by assertion against it. Run it red, then restore.
  - Already covered: `test_exit_asks_the_bound_server_to_stop` and the unstarted-thread test are untouched.
  - Testing stops there.
  - Commands: `PYTHONPATH=tests/support scripts/gate.sh .venv/bin/pytest -p socket_guard tests/test_desktop.py -q` is green with no guard error, then `scripts/gate.sh make check` is green.

### Task 3: The offline fakes stop listening on TCP and UDP

- **Files:** tests/conftest.py, tests/support/fixtures_daemons.py, tests/support/fake_metering.py, tests/support/fake_discovery.py, tests/support/fake_network.py, tests/support/fake_http.py, tests/e2e/support/stack.py, .filepawl.toml
- **Action:** Drop the TCP halves plan 2 kept:
  - `spawn_threaded_daemon` keeps its signature but only registers on the network. Its thread and its event loop go, because the fake answers on whichever loop dials it.
  - The control and 8088 fixtures in `fixtures_daemons` serve in-process only.
  - Served port numbers stay unique by plan 1's construction.
  - Plan 2 task 4's forward goes: the network no longer dials an announced address over TCP, and `fake_http.spawn`'s TCP path stops announcing. An address not registered in-process then refuses in-process, as plan 1 built it.

  Delete `fake_metering.spawn`'s TCP server and `fake_discovery.responder`'s UDP socket, together with what only they used, once nothing calls them. The e2e stack calls neither. `fake_http.spawn`'s TCP default stays for `tests/e2e/support/stack.py` alone, since plan 1 task 8 moved `tests/test_desktop.py` in-process. Dropping the dual-served 8088 fixtures' TCP halves also drops their teardown wake, which is the last connection plans 2 and 3 allowed in teardown.

  Rewrite the comments and module docstrings that describe a background-thread or real-TCP fake so they state what is now true. This covers the block above `spawn_threaded_daemon` in `tests/conftest.py`, the docstrings of `fake_metering` and `fake_discovery`, and the line in `tests/e2e/support/stack.py` saying `spawn_control` is modeled on `spawn_threaded_daemon`, if that no longer holds. Change no other comment.

  `_no_daemon_but_the_fakes` and `apps.closed_port` keep their bound, never-listening sockets: a bind is not a connection.
- **Verify:** Run `grep -nE "start_server|SOCK_DGRAM|\.listen\(|create_connection" tests/conftest.py tests/support/*.py`. The only matches it may show are `fake_http.py`'s TCP server path and its teardown wake, and `fake_network.py`'s port reservation if that binds. Anything else listening on TCP or UDP in offline support code is a miss. Run `grep -nE "open_connection|AsyncHTTPTransport" tests/support/fake_network.py`: every match is a call handed an existing socket (`sock=`), never a host and port, and no httpx transport of its own is built. Grep `tests/` for the name plan 2 task 4 gave the forward's announcement: it shows nothing. Together these show that the forward and its last announcer are gone. Then:
  - `scripts/gate.sh make check` is green.
  - `PYTHONPATH=tests/support scripts/gate.sh .venv/bin/pytest -m "not live and not e2e" -p socket_guard -q` is green with no guard error.
  - `scripts/gate.sh make test-e2e` passes where a browser is installed. Otherwise the required CI job `e2e` carries it.

  Pure scaffolding refactor, so the rule 8 exemption applies.

### Task 4: The socket guard runs for every offline test

- **Files:** tests/conftest.py
- **Action:** Add `socket_guard` to `pytest_plugins` in `tests/conftest.py`, next to `fixtures_daemons` and `fixtures_clients`. Change nothing else. The guard's scope and decision stay exactly as plan 2 task 1 wrote them: any TCP or UDP connection in an offline test, synchronous or from an event loop, with no exemption (owner ruling 3). This registers suite code. It edits no `make check` recipe, gate script, threshold or exemption.
- **Verify:** Testing scope:
  - Outcome: every offline test now runs under the guard, and the suite is green with no guard error in any phase.
  - Already covered: the guard's bite was proved by plan 2 task 1's red runs, the event-loop one and the synchronous one.
  - Commands: `scripts/gate.sh make check` is green, which includes the clock gate, the idle gate on this host, and the suite-time gate within its existing bar. A plain `scripts/gate.sh .venv/bin/pytest -m "not live and not e2e" -q`, with no `-p`, is also green, showing the guard is loaded by the suite itself.
  - An offline test the guard still flags here is reported to the owner as a finding, with its test id and the address. It is never answered with a carve-out, a skip or a marker.
  - Required CI jobs, human-verify: `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` all pass on the phase's last `dev` commit, the required set of Phase 1 Success Criterion 4. The phase changes production code those jobs run: `hqptuner/desktop.py`'s `answers` and every daemon-lane constructor. `check` and `e2e` run on a `dev` push (`.github/workflows/check.yml`). The other five are in `.github/workflows/release.yml`, whose `dev` push trigger fires only for its listed paths (`packaging/**`, the `scripts/package-*.sh` scripts, `hqptuner.spec`, `pyproject.toml`, the workflow itself), and this phase touches none of them. `release.yml` has no `workflow_dispatch` trigger, and its only other trigger is a `v*` tag push, which also runs the `publish` job (`release.yml`'s `publish: if: startsWith(github.ref, 'refs/tags/v')`). So the five jobs run at that exact commit only by cutting a release there. The owner pushes `dev` and chooses: tag that commit and publish, or take the five jobs at the next release tag and record this criterion as open until then. Adding a manual trigger is a workflow edit and is the owner's call, not this phase's. `/cad-verify` reads them with `ci-status`. The phase never pushes and does not edit a workflow. A red job goes back to the owner with its failing line, never into a threshold or an exemption.

### Task 5: The testing policy says tests hand the network in through the constructor

- **Files:** docs/testing.md
- **Action:** Owner ruling 4. Write with Edit, soft-wrapped: one numbered rule per logical line, and one line per sub-bullet. Three edits, nothing else in the file:
  - A new rule 18 at the end of "Core rules", after rule 17, so no rule cited by number elsewhere moves. Proposed wording, the owner's to approve or change: "18. **Tests hand the network in through the constructor; they never dial a fake.** Code that opens a network connection takes the way it connects at construction or at its entry point, defaulting to the real network, the way it takes its clock (rule 7). A test hands in the suite's in-process network (`tests/support/fake_network.py`) and registers its fake there, so the code's own request path runs unchanged and only the transport underneath differs: the 4321 and 4322 lanes over a `socket.socketpair()`, the 8088 lane through an httpx transport that calls the fake's handler directly, discovery through an in-process datagram endpoint. An address nothing is registered at refuses, as a closed port does. No test outside the `live` and `e2e` markers opens a TCP or UDP connection, to a fake or to anything else; `tests/support/socket_guard.py` fails one that does, and the fix is a seam in the code, never an exemption."
  - Rule 4's "run fake daemon speaking real XML over real socket" becomes "run fake daemon speaking real XML over the in-process network of rule 18". The rest of rule 4 stays, the quirks list included. Left as it is, rule 4 would require the socket that ruling 1 removes.
  - Rule 7's bullet "**Fake servers tear down promptly.**" is rewritten to state what now holds. Proposed wording: "**Fake servers tear down promptly.** Offline fakes hold no listener and no thread: a stream fake's task ends when its client end closes, and an 8088 fake answers each request whole before its transport returns. A new 8088 fake passes its own `handler` to `fake_http` where the dict-driven default does not fit. `fake_http.spawn`'s TCP listener, kept for the e2e stack's subprocess app, runs its thread on a loop of `server.handle_request()` with no timeout, parked in `select` between requests; teardown clears the listening flag, then opens one loopback connection to the port to wake the blocked call so the thread sees the flag cleared and returns."
  - No em dash in any added text. The new text states what holds and narrates no history, because triviajudge reads every added markdown line.
- **Verify:** This is a docs edit, so it runs its own gate only:
  - `python3 .claude/hooks/md-softwrap.py --check docs/testing.md` exits 0.
  - `grep -n "^18\. " docs/testing.md` shows the new rule, and `grep -n "real socket" docs/testing.md` shows nothing.
  - The pre-commit `triviajudge-md` hook passes at commit.
  - The owner approves or replaces the wording of rule 18 and of the rule 7 bullet before the commit. That approval is the check on the wording, because no gate judges it.

## Notes

- `tests/test_desktop.py` is in scope (owner ruling 2). Plan 1 task 8 gave `desktop.answers` its socket seam and moved the occupant and knock tests in-process. Task 2 here moves the listener test off its connection. After this plan, the only real-socket operation left in an offline test is a bind with no connection: `desktop.Listening` in task 2's test, `apps.closed_port` and `_no_daemon_but_the_fakes`. The guard does not record a bind, and none opens a connection.
- The `docs/testing.md` wording in task 5 is a proposal (owner ruling 4). Rules 4 and 7 are edited as well as rule 18 added, because both would otherwise state, as binding, a real socket and a listener thread that this phase removes from every offline fake.
