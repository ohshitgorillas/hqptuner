---
phase: 5
plan: 1
# Phase 5 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against its goal and Success Criteria 1-6.
requirements: []
files:
  - hqptuner/engine/control.py
  - hqptuner/core/network.py
  - hqptuner/core/manager.py
  - hqptuner/core/loader.py
  - hqptuner/core/connection.py
  - hqptuner/core/engineread.py
  - hqptuner/api/factory.py
  - hqptuner/api/lifespan.py
  - hqptuner/api/login.py
  - hqptuner/api/routes/connection.py
  - hqptuner/api/routes/discovery.py
  - hqptuner/conf/httpauth.py
  - hqptuner/engine/release.py
  - hqptuner/engine/discovery.py
  - hqptuner/engine/metering.py
  - hqptuner/desktop.py
  - docs/architecture.md
  - tests/support/fake_network.py
  - tests/support/apps.py
  - tests/support/fake_http.py
  - tests/support/fake_discovery.py
  - tests/support/fake_metering.py
  - tests/engine/test_control_network.py
  - tests/apply/test_manager_network.py
  - tests/api/test_http_client_network.py
  - tests/api/login/test_login_network.py
  - tests/engine/test_ungated_readers_network.py
  - tests/api/test_discovery_network.py
  - tests/engine/test_metering_network.py
  - tests/test_desktop.py
  - .filepawl.toml
---

# Phase 5: Offline tests reach their fake daemons in-process - Plan 1: The app dials every daemon lane through a network it is handed

## Goal

Every offline test reaches each fake daemon it talks to in-process, so no offline test opens a real network connection and the clock gate's reading no longer depends on how busy the machine running the suite is. This plan builds the seam: every place the app opens a connection to hqplayerd, and the desktop launcher's knock on its own listen port, takes it from a network it was handed at construction, and the suite gains an in-process network with in-process serving for all four fakes.

## Must be true when done

- A `ControlClient`, a `ConnectionManager` and an app from `create_app`, each handed the suite's in-process network, reach a 4321 control fake that listens on no TCP port; built without it, each still dials asyncio's own TCP connection.
- The 8088 config client the app builds at start, after a Connection-panel save and after adopting the container-host alias, the `/about` and `/log` readers, and the login pair check all reach an 8088 fake served only in-process, through an httpx transport that calls the fake's handler directly, with no socket and no thread.
- The metering reader streams frames from an in-process 4322 fake, and a discovery search sends its datagram to an in-process responder and describes the daemon it finds over the in-process control lane.
- The desktop launcher's port knock, handed the suite's stand-in socket, says whether an in-process fake is served at the URL, and `tests/test_desktop.py`'s occupant and knock tests open no real connection.
- Inside `hqptuner/`, every request path is unchanged apart from where its connection comes from (Success Criterion 2).
- `scripts/gate.sh make check` is green after every task.

## Context

- No CONTEXT.md for this phase. Binding: `docs/testing.md` rules 4, 7, 8, 12, 13, 16, 17; layering `api > core > presets > lanes > engine > conf` (`lint-imports`); no gate change and no exemption (Success Criterion 4).
- Pattern to follow: `hqptuner/core/clock.py` `Clock` (a frozen dataclass of production defaults, handed to `ConnectionManager` and `create_app`, replaced by the suite through the constructor), and `engine/control.py` `Deadline` (a Protocol declared in the lower layer that the core object satisfies). `HttpOptions.transport` in `hqptuner/conf/httpconf.py` is the existing 8088 seam; `tests/engine/http/test_http_no_answer.py` already hands it a transport.
- Mechanism, binding on every task here:
  - The 8088 lane (owner ruling) reaches `fake_http`'s request handling in-process through an httpx transport that calls into the fake directly: no socket, no listener, no thread. `httpx.MockTransport`, which `tests/engine/http/test_http_no_answer.py` already hands `HttpOptions`, or a custom `httpx.AsyncBaseTransport`, is the executor's choice; task 3 states what it must keep.
  - The stream lanes (4321, 4322) reach their fake through a connected `socket.socketpair()` made at dial time, with the fake's asyncio stream callback started on the dialing loop. Kept, as the owner's ruling allows: it has no listener and no thread, its AF_UNIX pair never leaves the process and is no network connection, and the client's own asyncio stream code, its `SO_KEEPALIVE` branch and rule 4's split-frame quirks run unchanged over a real kernel stream. The pair matches TCP on what the suite relies on, with one exception: a zero-linger close gives an AF_UNIX peer a clean end of file, not a reset. A reset the suite needs comes from closing the fake's end while its receive queue holds unread bytes, which on Linux fails the peer's next read with `ECONNRESET` in the kernel (plan 3 task 4). An in-memory stream pair would put test code in place of asyncio's transport. The offline suite runs on Linux only (`.github/workflows/check.yml`, `ubuntu-latest`), where `socketpair()` is AF_UNIX.
  - Discovery reaches an in-process datagram endpoint.
  - No mechanism opens an AF_INET or AF_INET6 connection.
- Out of scope here: migrating the shared fixtures (plan 2), the per-file test migration (plan 3), the desktop listener test, removing the fakes' TCP listeners, the `docs/testing.md` rule and turning the socket guard on (plan 4). Task 8 migrates `tests/test_desktop.py`'s occupant and knock tests itself, because their fake is the file's own `served` helper and the knock seam's test is the file's own `answers` test. Every other existing test keeps dialing TCP until then and stays green, because every new parameter defaults to production behavior.

## Tasks

### Task 1: ControlClient opens its connection through a handed opener

- **Files:** hqptuner/engine/control.py, tests/support/fake_network.py, tests/support/apps.py, tests/engine/test_control_network.py, .filepawl.toml
- **Action:** `ControlClient` takes a keyword-only opener next to `deadline`. The opener is a callable that takes a host and a port and returns the awaitable `(StreamReader, StreamWriter)` pair. It defaults to `asyncio.open_connection`, so no existing caller changes. Declare its type in `engine/control.py` as a Protocol, the way `Deadline` is declared, so that core can hand one in without engine importing core. `connect` awaits the opener under the same `self._deadline.wait_for` and `_as_control_error` it uses today. Change nothing else in the request path. The `SO_KEEPALIVE` branch stays. Confirm that `setsockopt` on the AF_UNIX socket a socketpair gives does not raise. If it does, fix it in the test network, never by weakening the client.

  Create `tests/support/fake_network.py`, the suite's single process-wide in-process network. This task builds its stream half:
  - A test registers an asyncio stream callback, in the shape of `fake_control.serve_shared`, at a `(host, port)`.
  - The network's opener, dialing a registered address, makes a connected `socket.socketpair()`. It hands the caller one end as asyncio streams and starts the registered callback on the other end, on the loop doing the dialing. The fake therefore answers on the test's loop or on a `TestClient`'s app loop with no thread and no listener.
  - Dialing an address nothing is registered at raises `ConnectionRefusedError`, which is what a closed TCP port gives.
  - Registration with an explicit `(host, port)` is supported, because two daemons sit on two addresses with one port number in `tests/api/test_container_host_alias.py`.
  - A registration without a port takes a number that can never equal one `apps.closed_port()` returns or one `_no_daemon_but_the_fakes` holds, whichever was drawn first. This is guaranteed by construction, never by assuming a port range (rule 16):
    - The registration holds its number with a bound loopback socket that never listens, for the registration's lifetime. The kernel then gives that number to no later bind, so a `closed_port()` drawn after it cannot match it. `_no_daemon_but_the_fakes` holds its ports the same way for the whole session.
    - `apps.closed_port` keeps binding, reading and closing its socket as today, so a not-yet-migrated TCP dial to its number is still refused, and it also records the number in the network for the session. A registration that draws a recorded number redraws, so a registration made after a `closed_port()` cannot match it either.
    - No test is written for this: no test can force the kernel's draw onto a given number.
  - The test thread can register and unregister while an app loop dials.
  - A fake's task ends when its client end closes, so nothing outlives the loop that dialed it.

  Avoid any AF_INET or AF_INET6 connect in the module, any module-level clock, and any patch of asyncio. If `control.py` crosses filepawl's watch line, run `filepawl accept` without asking.
- **Verify:** Testing scope:
  - Outcome: a `ControlClient` handed the network's opener reaches a control fake registered only in-process. Its `GetInfo` answer carries the name the test wrote into that fake's State.
  - Already covered: the refusal of an unregistered address is already pinned by the closed-port tests once plan 3 migrates them, so no new refusal test is written. Existing tests stay green, which shows the default is unchanged.
  - Bite: the null stub is `ControlClient` accepting the opener keyword and ignoring it. Against that stub the new test must fail by assertion, not by exception, because nothing listens on TCP at the in-process-only address. Shape the observation so the refusal reaches the assertion as a value.
  - Testing stops there.
  - Commands, in order: red run against the stub, then `scripts/gate.sh .venv/bin/pytest tests/engine/test_control_network.py -q` green, then `scripts/gate.sh make check` green.

### Task 2: The manager and the app carry the network the control lane dials through

- **Files:** hqptuner/core/network.py, hqptuner/core/manager.py, hqptuner/core/loader.py, hqptuner/api/factory.py, tests/support/fake_network.py, tests/apply/test_manager_network.py, docs/architecture.md
- **Action:** Create `hqptuner/core/network.py` with a frozen dataclass modeled on `Clock`: the ways the app opens a connection to the daemon, each defaulting to the production call. This task's only member is the stream opener, defaulting to a reference to `asyncio.open_connection`. Use a reference rather than a wrapper, because a production-only wrapper body never runs offline and rule 12 forbids a test written to reach it.

  `ConnectionManager` takes the network at construction, next to `clock`. It is optional and defaults to the production instance. The manager holds it as an attribute that every lane reads, the way lanes read `mgr.clock`. `create_app` takes it next to `clock` and passes it to the manager. `loader.connect_and_load` builds its `ControlClient` with the manager's opener. `__main__.main` stays as it is and gets the production default.

  `tests/support/fake_network.py` exposes the process-wide network as an instance of this dataclass, so a test hands it to `create_app` or `ConnectionManager` through the constructor and never through a patch. That is the rule `docs/testing.md` rule 7 applies to `VirtualClock`.

  In `docs/architecture.md`, the composition-root paragraph that lists what the manager holds ("the clock seams and the client accessors") names the network seam next to the clock seams. Make that one sentence change only, with Edit, soft-wrapped.

  Caller-side delta: one `ConnectionManager` call in `create_app` and one `ControlClient` call in `loader`.
- **Verify:** Testing scope:
  - Outcome (a): a `ConnectionManager` built with the in-process network becomes reachable against a control fake registered only in-process.
  - Outcome (b): an app from `create_app` built with it, driven by `TestClient`, reports reachable on the ungated `/api/health`.
  - Bite: the null stub is both constructors accepting the network and ignoring it, so `loader` dials with the default opener. Both checks must fail by assertion against it.
  - Already covered: existing manager and app tests stay green, which shows the production default is unchanged.
  - Testing stops there.
  - Commands: red run, then `scripts/gate.sh .venv/bin/pytest tests/apply/test_manager_network.py -q` green, then `scripts/gate.sh make check` green, which includes the markdown soft-wrap and triviajudge checks on the doc line.

### Task 3: The app builds its 8088 config client on the network's transport

- **Files:** hqptuner/core/network.py, hqptuner/core/connection.py, hqptuner/api/factory.py, hqptuner/api/routes/connection.py, hqptuner/api/lifespan.py, tests/support/fake_http.py, tests/support/fake_network.py, tests/api/test_http_client_network.py, .filepawl.toml
- **Action:** Changes on the app side:
  - The network gains an HTTP member: a callable that takes a host and a port and returns an `httpx.AsyncBaseTransport`, or None for httpx's own transport. Production returns None.
  - The member must return a fresh transport on every call, because `httpx.AsyncClient` closes the transport it was given when it closes, and later tasks open short-lived clients.
  - `connection.build_http_client` takes the network and builds `HttpConfigClient` with an `HttpOptions` that carries the network's transport for `(cfg.hqp_host, cfg.hqp_http_port)`. Keep `HttpOptions`'s default timeout.
  - All three callers pass the manager's network: `create_app`, `apply_connection` in `api/routes/connection.py`, and `_adopt_alias` in `api/lifespan.py`. The alias path's test lands in task 6, the first point at which its control probe can reach an in-process fake.

  Changes on the test side (owner ruling: no socket and no server thread for the 8088 fake):
  - `fake_http` gains in-process answering. The same handler classes, the dict-driven `_http_handler(st)` and a case's own `handler=`, answer one request handed to them as HTTP/1.1 bytes over an in-memory connection object, and the bytes they write are the response. No socket, no listener, no thread: the handler runs inline on the thread that sent the request.
  - The handler still sees a `(host, port)`-shaped client address, so `BaseHTTPRequestHandler`'s logging and `address_string` behave as on TCP. The module's `_STATE` lock stays, because the test thread and a `TestClient`'s app thread still touch `st` concurrently.
  - Inline answering is safe because no handler in the suite blocks: `_http_handler` and the five `handler=` classes (in `tests/apply/test_http_write.py`, `tests/speakers/test_speakers_apply.py`, `tests/speakers/test_speakers_rideout.py`, `tests/api/test_log_refusal_when_hqplayer_has_none.py` and `tests/test_desktop.py`) each answer from their table and return. A handler that must wait is a stop-and-report, never a thread.
  - `fake_http.spawn` gains a way to serve `st` at an in-process network address instead of on TCP, yielding the same `st` with `_port` filled in. TCP stays the default, for `tests/e2e/support/stack.py`, whose app runs in a subprocess.
  - `st["_take_lane_down"]` on an in-process spawn unregisters the address, so every later request meets `httpx.ConnectError`, the in-process form of a refused connection. Each request is answered whole before the transport returns, so no held connection is left to sever. Teardown calls it as today and opens no wake connection, because nothing is parked.
  - `fake_network` gains the HTTP half: for an address served in-process, its transport factory returns a transport that turns each `httpx.Request` into request bytes (method, target, headers, body), has the registered handler answer them, and parses what the handler wrote into the `httpx.Response`, a close-delimited body included.
  - The transport keeps the fidelity tests pin over TCP today. An address nothing serves, or one taken down, raises `httpx.ConnectError`. An answer that is not an HTTP response, empty or a non-HTTP banner such as `tests/test_desktop.py`'s `speaking` handler writes, raises `httpx.RemoteProtocolError`, as httpcore does over TCP. `httpx.DigestAuth`'s 401-then-resend runs above the transport unchanged.
  - The same transport also answers a synchronous `httpx.Client`, because task 8's desktop probe is synchronous. `httpx.MockTransport` serves both.
  - No new dependency. No module imports another module's underscore name.
  - Keep `fake_http.py` under the 800-line test cap. Run `filepawl accept` without asking if filepawl prints it.
- **Verify:** Testing scope:
  - Outcome (a): an app built with the network and with an 8088 fake served only in-process reports, on the ungated `/api/health`, the credential verdict that fake's answer produced.
  - Outcome (b): `apply_connection` called on a manager built with the network, with a record naming an in-process-only 8088 fake, returns the `FormsOutcome` of a refresh that reached it.
  - Bite: the null stubs are `build_http_client` taking the network and ignoring it (stub for a), and `apply_connection` passing no network (stub for b). Each must fail its check by assertion.
  - Already covered: the transport's refusal and non-HTTP-answer fidelity is pinned by the existing closed-port, lane-down and `test_desktop.py` tests once task 8 and plan 3 move them onto the network, so no separate fidelity test is written. e2e uses TCP spawn unchanged, and the required `e2e` job covers it.
  - Testing stops there.
  - Commands: red runs, then `scripts/gate.sh .venv/bin/pytest tests/api/test_http_client_network.py -q` green, then `scripts/gate.sh make check` green. Also run `scripts/gate.sh make test-e2e` where a browser is installed. Otherwise the required CI job `e2e` carries it.

### Task 4: The login pair check reaches the daemon through the network

- **Files:** hqptuner/conf/httpauth.py, hqptuner/api/login.py, tests/api/login/test_login_network.py
- **Action:** `check_pair` takes the transport the same way `logtail.fetch_log` and `HttpConfigClient` already do, through `HttpOptions`. Its `wait` keeps its meaning as the request timeout. Its verdicts (`ACCEPTED`, `REFUSED`, `NOT_ANSWERED`) and the cases that produce them stay as documented in its docstring. The login route passes the transport the manager's network gives for the host the login names, or the host in force, and `cfg.hqp_http_port`. Change no error code or wording: owner copy stays verbatim. Caller-side delta: one call in `api/login.py`.
- **Verify:** Testing scope:
  - Outcome (a): `check_pair` handed an in-process-only 8088 fake's transport returns `ACCEPTED` for the fake's stock pair and `REFUSED` for a pair the fake refuses (two expected values on one surface, rule 10).
  - Outcome (b): `POST /api/login` on an app built with the network, against an in-process-only fake, answers 200 with a login cookie.
  - Bite: the null stubs are `check_pair` ignoring the transport (it then answers `NOT_ANSWERED`) and the route passing none. Each check fails by assertion.
  - Testing stops there.
  - Commands: red runs, then `scripts/gate.sh .venv/bin/pytest tests/api/login/test_login_network.py -q` green, then `scripts/gate.sh make check` green.

### Task 5: The ungated /about and /log readers reach the daemon through the network

- **Files:** hqptuner/engine/release.py, hqptuner/core/loader.py, hqptuner/core/engineread.py, tests/engine/test_ungated_readers_network.py
- **Action:** `release.fetch_about` takes an `HttpOptions` (or none) the way `logtail.fetch_log` does, and keeps a 10-second timeout, the value `_HTTP_TIMEOUT` and `HttpOptions`' default both hold today. Its other caller, `scripts/pytest_plugins/tested_release.py`, keeps working unchanged on the default. `connect_and_load` passes the manager network's transport for `(cfg.hqp_host, cfg.hqp_http_port)`. Both `fetch_log` calls in `engineread`, in `refresh_device_caps` and `read_log_tail`, do the same. Caller-side delta: three calls.
- **Verify:** Testing scope:
  - Outcome (a): a manager built with the network connects and holds the release the in-process-only 8088 fake's `/about` prints.
  - Outcome (b): `read_log_tail` returns the last lines of that fake's `/log`.
  - Outcome (c): `refresh_device_caps` reads the selected device's capabilities from that fake's `/log`.
  - Bite: one null stub per call site, each ignoring the network. Each check fails by assertion.
  - Already covered: existing release, logtail and devicecaps tests stay green on the default.
  - Testing stops there.
  - Commands: red runs, then `scripts/gate.sh .venv/bin/pytest tests/engine/test_ungated_readers_network.py -q` green, then `scripts/gate.sh make check` green.

### Task 6: Discovery sweeps and describes daemons through the network

- **Files:** hqptuner/core/network.py, hqptuner/engine/discovery.py, hqptuner/api/routes/discovery.py, hqptuner/api/lifespan.py, tests/support/fake_network.py, tests/support/fake_discovery.py, tests/api/test_discovery_network.py
- **Action:** Changes to discovery:
  - `discover` and `probe` take the stream opener next to `deadline`, and pass it to every `ControlClient` that `_describe` builds.
  - `discover` also takes a datagram-socket factory. Declare its Protocol in `engine/discovery.py` as exactly the socket calls `discover` already makes: `settimeout`, `sendto`, `recvfrom` raising `BlockingIOError` when nothing waits, and `close`. `socket.socket` then satisfies it unchanged.
  - Production code still makes no loop socket call, because uvloop provides no `sock_sendto` or `sock_recvfrom`.
  - The network gains the datagram member. Its default is a reference such as a `functools.partial` over `socket.socket` for AF_INET and SOCK_DGRAM, with no wrapper body.
  - `discover_daemons` passes the manager's network members, and `_adopt_alias`'s `probe` gets the manager's opener.

  Changes to the fakes:
  - `fake_network` gains an in-process datagram endpoint. Its `sendto` looks up the responder registered at the target `(host, port)` and queues that responder's table reply for the exact request bytes, with the responder's `(host, port)` as the sender.
  - A target with no responder, the multicast group included, is silent.
  - `recvfrom` pops the next reply or raises `BlockingIOError`.
  - `fake_discovery` gains an in-process responder over that registry. It keeps the exact-request-bytes table (rule 13) and the host the caller names.
  - Its UDP responder stays until plan 4, because `tests/engine/test_discovery.py` uses it until plan 3.
- **Verify:** Testing scope:
  - Outcome (a): `discover` handed the network's members lists the responder's host, with the product and platform the in-process control fake at that host reports.
  - Outcome (b): `GET /api/discover` on a logged-in app built with the network lists the same.
  - Outcome (c): an app built with the network, with no saved host and the alias served only in-process (control and 8088), starts up pointed at the alias. `/api/health` reports it reachable and carries the alias's credential verdict. This pins `_adopt_alias`'s probe and task 3's rebuild.
  - Bite: the null stubs are the new keywords accepted and ignored (a real UDP socket and asyncio's connect), the route passing nothing, and `_adopt_alias` passing nothing. Each check fails by assertion.
  - Already covered: `tests/engine/test_discovery.py`, including its uvloop and real-timer cases, stays green on the defaults.
  - Testing stops there.
  - Commands: red runs, then `scripts/gate.sh .venv/bin/pytest tests/api/test_discovery_network.py -q` green, then `scripts/gate.sh make check` green.

### Task 7: The metering reader streams from the daemon through the network

- **Files:** hqptuner/engine/metering.py, hqptuner/api/lifespan.py, tests/support/fake_metering.py, tests/engine/test_metering_network.py
- **Action:** `MeteringReader` takes the stream opener as a keyword next to `pace` and `monotonic`, defaulting to `asyncio.open_connection`. `_stream` dials through it, and still reads host and port at dial time so that `retarget` keeps working. The lifespan constructs the reader with the manager's opener. `fake_metering` gains an in-process stream fake: an asyncio callback that sends `frames` copies of the caller's frame and then parks until the reader hangs up. The fake still derives nothing (rule 13). Its TCP `spawn` stays until plan 4, because `junkcal_rig` and two api tests use it until plans 2 and 3.
- **Verify:** Testing scope:
  - Outcome (a): a reader handed the network's opener, with a playing context, ingests frames from an in-process-only 4322 fake. The band readout or the feed is non-empty where, with no stream, it reads empty.
  - Outcome (b): an app built with the network with metering on shows that stream on its meter feed or status bands.
  - Bite: the null stub is the opener accepted and ignored, and the lifespan passing none. Each check fails by assertion.
  - Testing stops there.
  - Commands: red runs, then `scripts/gate.sh .venv/bin/pytest tests/engine/test_metering_network.py -q` green, then `scripts/gate.sh make check` green.

### Task 8: The desktop launcher knocks on its listen port through a handed socket

- **Files:** hqptuner/desktop.py, tests/support/fake_network.py, tests/test_desktop.py, .filepawl.toml
- **Action:** Owner ruling: `tests/test_desktop.py`'s real loopback TCP goes. Production side:
  - `desktop.answers` takes the socket it knocks with from a keyword-only factory that defaults to `socket.socket` itself, a reference with no wrapper body (rule 12).
  - Declare the factory's socket as a Protocol in `desktop.py` naming exactly what `answers` does with it today: open it as a context manager, `settimeout`, `connect_ex`. `socket.socket` then satisfies it unchanged.
  - `getaddrinfo` stays: every host the offline tests resolve is numeric and reaches no network.
  - `occupant` and `Parts` are unchanged. `occupant` already takes `knock` and `get`, and its default knock stays `answers` on the real socket. Caller-side delta: zero production call sites.

  Test side:
  - `fake_network` gains the knock's stand-in socket. Its `connect_ex` answers from the registry table (rule 13): 0 at an address served in-process, stream or HTTP, and `errno.ECONNREFUSED` anywhere else. It keeps the timeout it was given, for the test to read.
  - In `tests/test_desktop.py`, `served` serves its handler in-process through task 3's `fake_http` in place of `fake_http.spawn` on TCP.
  - `occupant` is handed the network's knock (`answers` over the stand-in) and a `get` from a synchronous `httpx.Client` on the network's HTTP transport.
  - `test_occupant_calls_a_refused_connection_nobody` keeps its `closed_port`, which nothing is registered at. `test_answers_only_where_something_listens` hands `answers` the stand-in.
  - Every existing test keeps its name, assertion and values. `test_a_listener_takes_connections_before_it_runs` and its `accepts` helper are plan 4 task 2's.

  `hqptuner/desktop.py` is in `testing.strong_areas`, so this task adds one deeper check: the knock hands its socket the timeout `answers` was given. A knock with no timeout would hang the desktop launch on a port that drops packets, and no test pins it today.
- **Verify:** Testing scope:
  - Outcome (a): `answers` handed the stand-in reports a served address as answering and an unregistered one as not. This is the existing `test_answers_only_where_something_listens`, its assertion unchanged.
  - Outcome (b): the knock's socket carries the timeout `answers` was given, `PROBE_TIMEOUT` when none is.
  - Already covered: the occupant verdicts (nobody, HQPTuner, stranger, non-HTTP answer raises, timeouts) are the existing tests. Only their scaffolding changes, so the rule 8 refactor exemption applies to them and is stated in the hand-back.
  - Bite: the null stub is `answers` accepting the factory and ignoring it, so it knocks on a real socket. Then (a) reads `(False, False)`, because nothing listens on TCP at the in-process-only address, and (b) finds no timeout recorded. Both fail by assertion.
  - Testing stops there.
  - Commands: red run against the stub, then `scripts/gate.sh .venv/bin/pytest tests/test_desktop.py -q` green, then `scripts/gate.sh make check` green. Plan 2 task 1's guard later confirms that the file's only flagged test is `test_a_listener_takes_connections_before_it_runs`.

## Notes

- Plans 1 to 4 are sequential and share files (`tests/support/fake_network.py`, `tests/support/fake_http.py`, the fixtures, `tests/conftest.py`). They are not parallel slices.
- Production caller-side delta across this plan: `create_app` (2 calls), `loader` (2), `engineread` (2), `api/login` (1), `api/routes/connection` (1), `api/routes/discovery` (1), `api/lifespan` (3), and `discovery._describe` (1). `desktop` adds none: `answers` keeps its default, and `occupant` and `Parts` are unchanged. `__main__.main` is untouched.
- No `CHANGELOG.md` entry: internal-only, with no user-visible change.
