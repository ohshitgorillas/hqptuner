---
phase: 6
plan: 4
# Phase 6 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against findings F-004, F-005, F-015, F-017, F-020, F-021, F-022 and F-023, the Success Criteria and CONTEXT AC1-AC7.
requirements: []
files:
  - hqptuner/conf/httpconf.py
  - hqptuner/conf/httpauth.py
  - hqptuner/conf/noanswer.py
  - hqptuner/core/network.py
  - hqptuner/core/connection.py
  - hqptuner/core/manager.py
  - hqptuner/core/loader.py
  - hqptuner/core/engineread.py
  - hqptuner/engine/logtail.py
  - hqptuner/engine/release.py
  - hqptuner/engine/control.py
  - hqptuner/api/factory.py
  - hqptuner/api/lifespan.py
  - hqptuner/api/login.py
  - hqptuner/api/deps.py
  - hqptuner/api/routes/connection.py
  - docs/architecture.md
  - tests/support/fake_network.py
  - tests/engine/http/test_http_ceiling.py
  - tests/engine/http/test_http_deadline.py
  - tests/engine/http/test_ungated_reader_bounds.py
  - tests/engine/http/test_retired_client_closed.py
  - tests/api/login/test_login_pair_check.py
  - tests/engine/test_control_stall.py
  - .filepawl.toml
---

# Phase 6: Connection host and stored credential - Plan 4: Every 8088 read and Control API document is bounded, and a replaced client closes

## Goal

Findings F-004, F-005, F-015, F-017, F-020, F-021, F-022 and F-023 are each fixed or carry an owner ruling. This plan closes F-017: every 8088 read carries a per-path size ceiling and a total deadline on the injectable clock, a replaced 8088 client is closed once nothing holds it, and a Control API document has a total deadline and a scan that does not redo the whole buffer per chunk.

## Must be true when done

- An 8088 response larger than its path's ceiling is refused, on every 8088 read D-12 names, including a Digest challenge body (AC5).
- An 8088 or 4321 response still dripping past its total deadline on the test clock is abandoned, with the existing "HQPlayer did not answer within N seconds." sentence (AC5).
- After a Connection save, the replaced 8088 client is closed once its in-flight requests finish, an in-flight restore or apply completes, and repeated saves leave no growing list of open clients (AC5, D-11).
- Control API documents within `MAX_RESPONSE` still parse when split across many chunks.

## Context

- Locked: D-11, D-12 (ceilings per path: settings backups measured 4.7 to 8.7 MB, n=26; forms 4.6 to 29.5 KB), D-13 (the deadline runs on the injectable `Clock` or `Deadline`, not httpx's per-read timeout and not a wall clock, and reaches `HttpOptions` and `Network.http_options`), D-14 (keep `MAX_RESPONSE`), D-10 (the three 8088 refusal sentences stay).
- Researched for CONTEXT's flagged assumption (httpx 0.28.1, `.venv`): `AsyncClient._send_handling_auth` calls `await response.aread()` on the 401 challenge before the next request, so a ceiling applied only to `aiter_bytes` on the returned stream misses the challenge body. `DigestAuth.requires_response_body` is False. `Response.num_bytes_downloaded` counts raw (pre-decoding) bytes. The ceiling therefore sits where both bodies pass and counts decoded bytes, or bounds raw bytes at the transport and decoded bytes on the final read; either is authorized if Task 2's Verify holds.
- Layering: `HttpOptions` lives in `conf`, which cannot import `engine.control.Deadline`. A conf-level protocol of the same shape, or moving `Deadline` down into `conf` with `engine.control` re-importing it, are both allowed; loosening the import-linter contract is not.
- New error types subclass the `httpx` type their callers already catch (the pattern of `HttpUnreachableError`, `HttpNoAnswerError`, `AuthRefused`), so every `except httpx.HTTPError` site is unchanged.
- Tests drive time with `tests/support/virtual_clock.py` `VirtualClock` and the network with `tests/support/fake_network.py` (`docs/testing.md` rules 7 and 18); a dripping or oversized body is a fake transport stream, never a real socket.

## Tasks

### Task 1: The authenticated 8088 client's exchanges have a total deadline on the app's clock

- **Files:** hqptuner/conf/httpconf.py, hqptuner/conf/noanswer.py, hqptuner/core/network.py, hqptuner/core/connection.py, hqptuner/api/factory.py, hqptuner/api/routes/connection.py, hqptuner/api/lifespan.py, tests/support/fake_network.py, tests/engine/http/test_http_deadline.py
- **Action:** `HttpConfigClient._get` and `_post` each run the whole exchange, the Digest challenge round trip and the body included, under one total deadline through the deadline object's `wait_for` (D-13), on top of httpx's per-read timeout, which stays. The deadline object reaches the client through `HttpOptions` from `Network.http_options`; `build_http_client` and its two callers (`create_app`, `apply_connection`; Plan 3 Task 5 removed `_adopt_alias`'s rebuild, which stays removed) pass the manager's `Clock`, which already carries `wait_for`. Choose the total and record its value and basis in a comment beside it and in the commit message. Expiry raises `HttpNoAnswerError` for the total's seconds (approved sentence, D-10). This is the tracer for the plan: the clock wired from the app to the 8088 read. Record the deadline rule in `docs/architecture.md` in Task 2's commit, with the ceiling.
- **Verify:** Testing scope, function lane on `HttpConfigClient` over a fake transport stream that yields one chunk per virtual second (strong area `hqptuner/conf/`; risk surface untrusted_input): a `/config` read still dripping past the total deadline raises `HttpNoAnswerError` after `VirtualClock.advance`, with no real time spent; a read completing inside it returns the form. The existing 8088 suite staying green is the evidence that normal reads are unaffected; stop there. Bite: the first red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`.

### Task 2: The authenticated 8088 client's reads carry a per-path size ceiling

- **Files:** hqptuner/conf/httpconf.py, tests/support/fake_network.py, tests/engine/http/test_http_ceiling.py, docs/architecture.md
- **Action:** `HttpConfigClient._get` (every read: `/config`, `/matrix`, `/speakers`, `/config/refresh`, `/backup/settings.zip`) refuses a body larger than a ceiling chosen for its path, counting the 401 challenge body too (Context: httpx reads it whole inside `_send_handling_auth`). Ceilings: the forms and `/config/refresh` above the 29.5 KB measured maximum with stated headroom, `/backup/settings.zip` above the 8.7 MB maximum with stated headroom; each value and its basis in a comment beside it and in the commit message. An oversized body raises a new `httpx.HTTPError` subclass whose sentence is owner copy (Notes); if it is not in hand when this task runs, stop and ask. Record the ceiling and deadline rule in `docs/architecture.md` where the 8088 lane is described.
- **Verify:** Testing scope, function lane over a fake transport (risk surfaces untrusted_input and api_contract): a `/config` body one byte over its ceiling raises the oversized error; a `/backup/settings.zip` body over its ceiling raises it; a 401 challenge whose body is over the ceiling raises it and the fake counts no second request; a body at the measured maximum passes. Bite: the three refusal cases red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`.

### Task 3: The ungated readers carry a ceiling and a total deadline

- **Files:** hqptuner/engine/logtail.py, hqptuner/engine/release.py, hqptuner/core/loader.py, hqptuner/core/engineread.py, tests/engine/http/test_ungated_reader_bounds.py
- **Action:** `fetch_log` and `fetch_about` read under Tasks 1 and 2's mechanisms: a ceiling for `/log` and one for `/about`, each value and basis recorded as in Task 2, and the same total deadline. D-12 measured neither path, so measure both first: one read-only `GET` of each against the running daemon through the repo's tested lane (load `live-daemon`; no write), and set each ceiling above the measured size with stated headroom, sized for a long-running daemon's log. `connect_and_load` and `_fetch_log` pass the manager's clock through the options they already build. The `/log` ceiling is a refusal, as for every other path; `tail_text`'s 256 KiB cap stays, and the `_TAIL_CAP` comment ("a large log never blows up memory") is corrected to say what the cap does, since the whole body is read before it applies (F-017). `fetch_about` keeps raising `httpx.HTTPError` subclasses only, which `connect_and_load` already catches.
- **Verify:** Testing scope, function lane over a fake transport (strong area `hqptuner/engine/`): `fetch_log` refuses a body over its ceiling; `fetch_about` refuses one over its ceiling; each abandons a drip past the deadline on `VirtualClock` (four cases); a `/log` body at the measured size with the stated headroom still tails. The 500-line tail is already covered by `tests/engine/test_logtail.py`. Bite: all four red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`.

### Task 4: The login's pair check carries a ceiling and a total deadline

- **Files:** hqptuner/conf/httpauth.py, hqptuner/api/login.py, tests/api/login/test_login_pair_check.py
- **Action:** `check_pair` reads `/config` under Task 2's ceiling for that path and the same total deadline, with `login` passing the manager's clock. An oversized or dripping answer is `PairVerdict.NOT_ANSWERED`, which the login already reports with its approved "HQPlayer did not answer." sentence; no new copy.
- **Verify:** Testing scope, function lane beside the existing pair-check cases: an accepted pair whose `/config` body is over the ceiling, and one whose body drips past the deadline on `VirtualClock`, each answer `NOT_ANSWERED` (two cases); the four existing verdict cases stay green. Bite: both red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`.

### Task 5: A replaced 8088 client is closed once nothing holds it

- **Files:** hqptuner/core/manager.py, hqptuner/conf/httpconf.py, hqptuner/api/deps.py, hqptuner/api/lifespan.py, hqptuner/core/loader.py, tests/engine/http/test_retired_client_closed.py
- **Action:** The `http_client` setter no longer appends to `_retired`, and the list and its drain in `aclose` go (D-11). A replaced client is closed as soon as no request holds it: at once when none does, else when the last holder finishes. "Holds" spans a lane that keeps the client across awaits (`lanes/settle`, `presets/presetops`, `lanes/http/restore`, named in the setter's own docstring), so an in-flight restore or apply finishes on the client it started with and is never aborted. Holders, mapped for this plan: every read of the client goes through `require_http()` or `http_client`. The sites are in `lanes/settle.py` (3), `lanes/http/restore.py` (1), `lanes/http/forms.py` (1, a local kept across three awaits), `lanes/http/speakerprocessing.py` (2, one a local kept across awaits), `presets/presetops.py` (2), `presets/presetlane.py` (5), `presets/fileconfig.py` (2), `core/applyops.py` (1), `core/engineread.py` (1), `core/loader.py` (2) and `conf/httpauth.py` (1). Each runs inside one of two entry points. The first is an HTTP request, where every route takes the manager through `Mgr` or `HttpMgr` in `hqptuner/api/deps.py`; no route reads `app.state.manager` for the client. The second is a pass of `ConnectionManager.run`, where `loader.connect_and_load` and `loader.poll` reach `refresh_http_forms`, `engineread` and `presetops.migrate_once`. The other spawned tasks (`autopilotops.run`, `junkcal.run`, the metering reader) never touch the 8088 client. Nothing spawns a task from a request. So the hold is taken at those two entry points: on the client in service when the request or pass begins, released when it ends. The resolution of `Mgr` and `HttpMgr` (`manager_of`, `_http_manager`) and the body of `ConnectionManager.run` are where it is taken. A lane that calls `require_http()` again after a mid-request replacement gets the new client, which is in service and stays open. Caller-side delta: zero call sites in `lanes/`, `presets/`, `core/applyops.py`, `core/engineread.py`, `conf/httpauth.py` and the routes, which take `Mgr`/`HttpMgr` by annotation unchanged. The edits are `hqptuner/api/deps.py`, `hqptuner/core/manager.py` and, if the poll pass's hold sits there, `hqptuner/core/loader.py`. State the mechanism and that delta in the commit message. If the executor finds a holder outside those two entry points, it reports the site before editing it. Update `make_lifespan`'s shutdown comment about retired clients.
- **Verify:** Testing scope, function lane on `ConnectionManager` with clients over recording fake transports (risk surface concurrency): a client replaced while idle reports its transport closed right after the replacement; a client replaced while a request holding it is paused on the fake reports not closed until that request completes, then closed; that held request completes with its fake's answer; ten replacements in a row leave every replaced transport closed. Bite: the first and fourth red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`.

### Task 6: A Control API document has a total deadline

- **Files:** hqptuner/engine/control.py, tests/engine/test_control_stall.py
- **Action:** `ControlClient._recv_document` gives up on a document still incomplete after a total deadline, through `self._deadline.wait_for` (the injected `Deadline`, D-13), on top of the per-read wait that stays. Choose the total relative to `self._timeout` and record the value and its basis. Expiry reaches the caller as `ControlTimeoutError` through `_as_control_error`, rendering the approved no-answer sentence for the total's seconds, and the connection is dropped as `request` already does on a timeout. `MAX_RESPONSE` stays (D-14).
- **Verify:** Testing scope, function lane against a fake daemon on the in-process network that writes one byte per virtual second and never completes (strong area `hqptuner/engine/`): the command raises `ControlTimeoutError` once the virtual clock passes the total deadline, though no single read waited past the per-read timeout; a split frame that completes inside the deadline still parses (already covered by the split-frame cases; rely on them). Bite: the first red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`.

### Task 7: The Control API scan does work per chunk, not per buffer

- **Files:** hqptuner/engine/control.py, tests/engine/test_control_stall.py
- **Action:** `_recv_document` stops decoding and splitting the whole accumulated buffer on every chunk (D-14). Decode incrementally (an incremental UTF-8 decoder keeps a split multibyte sequence intact), and attempt `parse_frame` only when the new chunk could have completed the document, such as when it carries a `>` or the newline flush hint (`docs/protocol.md` §1/§4), executor's choice, recorded. The lenient parse in `hqptuner/engine/frames.py` and the `MAX_RESPONSE` check are unchanged.
- **Verify:** Testing scope: a performance fix with no new observable result, so it is characterization (rule 8 exemption, stated in the hand-back): the existing split-frame, bare-`&` and double-escaped cases in `tests/engine/` stay green, plus one added case of a document split inside a multibyte UTF-8 character, which must still parse. Mutation of the new trigger condition is what checks it later. `scripts/gate.sh make check` prints `exit=0`.

## Notes

- **Copy:** the oversized-8088-response sentence (Task 2) is not in D-17's list but falls under its rule ("every other visible text change ships only in owner-approved wording"); it reaches users through `daemon_read_failed` ("Reading HQPlayer's configuration failed: {error}"). Pending owner approval. Every other refusal here reuses approved sentences.
- Task 5's holders are mapped in its Action: 21 read sites, all reached from a request (`Mgr`/`HttpMgr`) or a `ConnectionManager.run` pass. The hold sits at those two entry points, so the caller-side delta at the lane call sites is zero and the lease needs no lane file.
- Shared with Plans 1, 3 and 5, which run in order 1, 2, 3, 4, 5: `hqptuner/conf/httpconf.py`, `hqptuner/conf/httpauth.py`, `hqptuner/core/connection.py`, `hqptuner/api/lifespan.py`, `hqptuner/api/login.py`, `hqptuner/api/routes/connection.py`, `hqptuner/engine/logtail.py`, `docs/architecture.md`, `.filepawl.toml`.
