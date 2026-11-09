---
phase: 6
plan: 1
# Phase 6 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against findings F-004, F-005, F-015, F-017, F-020, F-021, F-022 and F-023, the Success Criteria and CONTEXT AC1-AC7.
requirements: []
files:
  - hqptuner/conf/hostaddr.py
  - hqptuner/conf/httpconf.py
  - hqptuner/conf/httpauth.py
  - hqptuner/engine/logtail.py
  - hqptuner/config.py
  - hqptuner/api/errors.py
  - hqptuner/api/login.py
  - hqptuner/api/routes/connection.py
  - hqptuner/core/connection.py
  - docs/architecture.md
  - docs/openapi.json
  - tests/engine/http/test_host_address.py
  - tests/engine/http/test_ipv6_urls.py
  - tests/api/surface/test_connection_host_rule.py
  - tests/api/login/test_login_host.py
  - tests/api/test_refusal_codes_have_status.py
  - .filepawl.toml
---

# Phase 6: Connection host and stored credential - Plan 1: One host rule at the save, the login and every 8088 URL

## Goal

Findings F-004, F-005, F-015, F-017, F-020, F-021, F-022 and F-023 are each fixed or carry an owner ruling. This plan closes the server side of F-004 and F-005 and the save-time half of F-015: one host validator, used by the Connection save and the login, the login's host rule kept as D-01 states it, and a Connection save that cannot carry the stored password to a new host or copy a pinned or in-memory password to disk.

## Must be true when done

- A Connection save or a login naming `a:b`, `target:9000/path?x=` or `fe80::1%eth0` is refused, nothing is saved, and no request leaves for that host (AC2).
- A host of `::1` is accepted, and every 8088 read for it goes to `http://[::1]:8088/...` (AC2).
- A login naming a host other than the one in force checks only the typed pair, at the named host; an accepted one replaces the stored record with that host and pair, so the pair held for the old host is never sent to the new one (D-01). Today's login already does this, held by `tests/api/login/test_login_route.py` `test_a_login_naming_another_host_is_checked_against_that_host` and `test_an_accepted_login_naming_another_host_retargets_to_it`, which stay as they are; no task changes it.
- A Connection save that changes the host without both a username and a password answers "HQPTuner requires a new username and password when switching host addresses for security; please re-enter your credentials.", saves nothing and sends no request to the new host; a save to the same host with a blank password keeps the stored one (AC1).
- A Connection save naming a value the environment pins differently is refused with the existing `login_values_pinned` refusal, and `connection.json` never receives a pinned value or a password the request did not carry.

## Context

- Locked: D-01, D-02, D-03, D-05, D-06, D-08 (no daemon check before a save), D-10 (the three 8088 refusal sentences stay), D-17 (copy), D-18 (test directories).
- Layering `api > core > presets > lanes > engine > conf` (`pyproject.toml` `[tool.importlinter]`): the validator lives in `hqptuner/conf/` so `core` startup (Plan 3) imports it too.
- `apply_connection` in `hqptuner/api/routes/connection.py` is shared by the save and by `login` in `hqptuner/api/login.py`; a rule placed there covers both.
- Tests-first with a red bite run against the pre-change code (`docs/testing.md` rule 8); copy never appears in an assertion (rule 9); every gate through `scripts/gate.sh`; `filepawl accept` whenever filepawl prints it.
- Out: the frontend (Plan 2), startup reading of a saved record (Plan 3), response bounds (Plan 4).

## Tasks

### Task 1: One validator decides whether a string is a daemon host

- **Files:** hqptuner/conf/hostaddr.py, tests/engine/http/test_host_address.py, .filepawl.toml
- **Action:** Create the one host validator D-03 names, in a new `hqptuner/conf/` module. It accepts a DNS hostname, an IPv4 literal or a bare IPv6 literal, and refuses a port, a path, a query, userinfo, whitespace anywhere, an IPv6 zone ID (`%eth0`), a bracketed form and an empty value. It is a pure function whose return value is the decision (`docs/testing.md` rule 17): one type on every path, either a typed result or a refusal raised as one exception type, executor's choice, recorded in the commit message. Use the standard library's `ipaddress` for the two literal forms rather than a hand regex, and a positive hostname check rather than a deny-list: dot-separated labels of 1 to 63 ASCII letters, digits and hyphens, no label starting or ending with a hyphen, 253 characters at most. A host that passes is also refused if `httpx.URL` raises on the 8088 URL rendered from it, so the validator never accepts a host the client build would reject. The same module also renders a host for an 8088 URL: an IPv6 literal bracketed, anything else unchanged (D-03: "stored bare, bracketed wherever an 8088 URL is built, kept bare for the 4321 socket"). Import nothing above `conf`.
- **Verify:** Testing scope, pure-function lane (strong area `hqptuner/conf/`): parametrized accept cases `hqplayer.local`, `192.168.1.5`, `::1`, `2001:db8::5`; refuse cases `a:b`, `target:9000/path?x=`, `fe80::1%eth0`, `user@host`, `host name`, ` 10.0.0.5`, `[::1]`, empty, `a\x7fb` (control character), `💥.local` (non-ASCII), `-a.local` (leading hyphen), `999.1.1.1` (passes the label rule and is refused only by the `httpx.URL` step, so that step has a case); and the URL rendering of `::1` as `[::1]` and of `10.0.0.5` unchanged. That set is the boundary: each refuse case is one class of input the host reached `http://{host}:{port}` with before. Bite: the module is new, so the static discharge applies (rule 8): the plan's null stub accepts every string and renders it unchanged, and every refuse case and the bracket case fail against it. `scripts/gate.sh make check` prints `exit=0`.

### Task 2: The Connection save and the login refuse an invalid host

- **Files:** hqptuner/api/routes/connection.py, hqptuner/api/login.py, hqptuner/api/errors.py, docs/architecture.md, docs/openapi.json, tests/api/surface/test_connection_host_rule.py, tests/api/login/test_login_host.py, tests/api/test_refusal_codes_have_status.py
- **Action:** `write_connection` runs Task 1's validator on the host the record will carry (the body's, or the host in force when the body names none) before `apply_connection` writes anything, and `login` runs it on the body's host before `check_pair` is called. An invalid host is refused with an `ErrorBody` whose sentence is the owner-approved invalid-host refusal (D-17); if that wording is not in hand when this task runs, stop and ask for it (Notes, Copy). Its code is new, entered in `STATUS` in `hqptuner/api/errors.py` with a 4xx status, and listed in `docs/architecture.md` "API errors". Nothing is saved, the live config is untouched and no request is sent. This is the end-to-end tracer for the phase: the validator reached through both open write paths.
- **Verify:** Testing scope, REST lane on `tests/support/apps.py` builders and the in-process network: a save with each of `a:b`, `target:9000/path?x=`, `fe80::1%eth0` answers the new code (parametrized); the record file is unchanged after it; the fake 8088 at the named address counts no request; a login with each answers the new code; `::1` is accepted at the save. Existing save and login tests stay green unchanged. Bite: the refuse cases red against the commit before this one, as assertion failures (the save then wrote the record and the build raised `InvalidURL`). The default test client re-raises that error into the test, so these cases build the app with `raise_server_exceptions=False` and assert on the answer's code and the record file as values, as Task 3 does for its URLs. `tests/api/test_refusal_codes_have_status.py` covers the new code with no edit if it enumerates `STATUS`; touch it only if it lists codes by hand. `scripts/gate.sh make check` prints `exit=0`, including `scripts/gates/check_openapi.py` (run `--write` only if the snapshot changed and say so in the commit).

### Task 3: Every 8088 URL brackets an IPv6 host

- **Files:** hqptuner/conf/httpconf.py, hqptuner/conf/httpauth.py, hqptuner/engine/logtail.py, hqptuner/config.py, tests/engine/http/test_ipv6_urls.py
- **Action:** The four places an 8088 base URL is built use Task 1's rendering: `HttpConfigClient.__init__`, `check_pair`, `fetch_log` and `Config.hqp_http_base_url` (which `release.fetch_about` reads through `ConnectionManager.http_base_url`). The host stays bare everywhere else: in `cfg.hqp_host`, in the record, in `Network.http_transport(host, port)` calls, and on the 4321 and 4322 sockets (D-03). `hqptuner/config.py` importing a `conf` module is allowed by the contract; if `lint-imports` disagrees, build the URL at the caller instead and say so in the commit. The refusal sentences that name `host:port` stay as they are (D-10).
- **Verify:** Testing scope, function lane with a transport that records each request's URL (`docs/testing.md` rule 18): for host `::1`, the client's config read, `check_pair`, `fetch_log` and `fetch_about` each request `http://[::1]:8088/...` (four cases, one claim each). An IPv4 host is already covered by every existing 8088 test. Bite: all four red against the commit before this one, as assertion failures. The pre-change code raises `InvalidURL` before any request leaves, which is an error, not an assertion failure, so each test takes the URL the recording transport saw (none when nothing was sent) as a value and asserts on it. `scripts/gate.sh make check` prints `exit=0`.

### Task 4: Changing the host needs both the username and the password

- **Files:** hqptuner/api/routes/connection.py, hqptuner/api/errors.py, docs/architecture.md, tests/api/surface/test_connection_host_rule.py
- **Action:** `write_connection` refuses a save whose host differs from the host in force unless the body carries a non-empty `username` and a non-empty `password` (D-02). Absent and blank count alike, because a blank field is how the panel says "keep the stored password" (`submitConnection` omits it), and D-02's same-host rule gives blank that meaning. The refusal is an `ErrorBody` with the owner's sentence verbatim: "HQPTuner requires a new username and password when switching host addresses for security; please re-enter your credentials." Its code is new, entered in `STATUS` with a 4xx status and in `docs/architecture.md` "API errors". The refusal comes before `apply_connection`, so nothing is saved, the live config is untouched and no request leaves for the new host. A save to the same host with no password keeps the stored one, as today. Update `ConnectionBody`'s docstring, which says a client changing the host alone need not send the credentials back. No daemon check is added (D-08).
- **Verify:** Testing scope, REST lane (risk surfaces auth and secrets): a host-changing save with no password, and one with no username, each answers the new code (two cases); after it the record file is unchanged and the fake 8088 at the new host counts no request; a host-changing save carrying both is accepted; a same-host save with no password leaves the stored password in force. Bite: the refusal and no-request cases red against the commit before this one. `tests/api/login/test_connection_keeps_login.py::test_a_save_that_changes_only_the_host_logs_nobody_out` stays green, since both reads still answer 200; it no longer exercises a host change, which goes to the owner in the report rather than into an edit. `scripts/gate.sh make check` prints `exit=0`.

### Task 5: A Connection save follows the login's pin rule

- **Files:** hqptuner/api/routes/connection.py, tests/api/surface/test_connection_host_rule.py
- **Action:** `write_connection` refuses with the existing `LoginValuesPinnedError` (code `login_values_pinned`, owner-approved wording) when the body's host, username or password differs from a value the environment pins, using `pinned_differs` from `hqptuner/core/connection.py`, before anything is written or sent (D-06). Fields the body omits are filled from the config before the check, so an omitted pinned field never differs.
- **Verify:** Testing scope, REST lane: with `HQPTUNER_HQP_HOST` pinned, a save naming another host answers `login_values_pinned` and leaves the record file unchanged; with `HQPTUNER_HQP_PASSWORD` pinned, a save naming another password answers the same; a save naming exactly the pinned values is accepted. An empty pin counting as no pin is already covered by `test_an_empty_pin_is_no_pin` for the shared helper. Bite: the two refusal cases red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`.

### Task 6: connection.json never receives a pinned value or a password the request did not carry

- **Files:** hqptuner/api/routes/connection.py, hqptuner/core/connection.py, tests/api/surface/test_connection_host_rule.py
- **Action:** In the shared write path (`apply_connection`, or `ConnectionStore.write`'s caller), the record written to disk takes no field the environment pins (D-06), and its password is either one the request carried or the one `connection.json` already held (D-05: "`remember:true` writing a pinned or in-memory password" is closed). That read of the held record treats a corrupt record, or one whose host fails Task 1's validator, as holding no password, so a save over it succeeds and replaces the file (D-09: "the file stays until the user saves over it"). The live config keeps the in-memory pair for the rest of the run as today: the rule binds the file, not `layer_onto_config`. How a pinned field is represented on disk is the executor's choice, bound by one constraint: after the pin is removed, the next start reads that file without crashing and layers it as `hqptuner/core/connection.py`'s module docstring describes (a record is the whole answer for all three fields). Record the choice in the commit message and in that docstring. This covers the login too, since `login` applies a differing pair through `apply_connection`.
- **Verify:** Testing scope, REST lane plus a store read (risk surface secrets): with `HQPTUNER_HQP_PASSWORD` pinned, a save with `remember:true` and no password leaves no pinned password in the file; on an install whose record says `remember:false` and whose password was typed this run, a save with `remember:true` and no password leaves no password in the file; with `HQPTUNER_HQP_HOST` pinned, a save leaves the pinned host out of the file; and that file, read by a fresh `create_app` with the pin removed, starts the app (`/api/health` 200); a save with `remember:true` and no password over a corrupt record (unparseable JSON) and over one holding `a:b` each succeeds and leaves a readable record with no password (two cases). Bite: the first three red against the commit before this one; the two corrupt-record cases are new paths this task adds the read for, and each is red against a stub of that read that raises as `ConnectionStore.read` does. `scripts/gate.sh make check` prints `exit=0`.

## Notes

- **Copy (D-17).** Owner-approved, verbatim: the host-change refusal of Task 4. Pending owner approval before Task 2: the invalid-host refusal sentence. Reused unchanged: `LoginValuesPinnedError`'s wording (Task 5).
- **Owner approvals needed before execution.** Gather these in one owner request before Plan 1 starts. Each task still stops and asks if its item is not in hand when it runs.
  - Copy, verbatim (D-17): (1) Plan 1 Task 2, the invalid-host refusal sentence; (2) Plan 2 Task 1, the discovered-daemon list entry and its prompt; (3) Plan 2 Task 2, the `CHANGELOG.md` `[Unreleased]` `### Security` entry, ideally covering the alias change so Plan 3 Task 7 needs no extra bullet; (4) Plan 2 Task 3, the blank-password placeholder (D-17 names "Leave blank to keep the stored password"; the owner confirms or rewords it, since a blank field now keeps the stored password only at the same host); (5) Plan 2 Task 4, the note that the stored password is unencrypted (Plan 2 Notes: it claims no file protection Windows does not give); (6) Plan 3 Task 6, the alias offer; (7) Plan 3 Task 7, the `README.md` `HQPTUNER_CONTAINER_HOST_ALIAS` row, the new marker row and the `compose.yaml` header comment, plus a `CHANGELOG.md` bullet only if (3) does not cover the alias; (8) Plan 4 Task 2, the oversized-8088-response sentence.
  - Test replacements not named by D-18, each confirmed as an owner-approved behavior change, never edited to pass: (9) `tests/api/test_discovery_network.py::test_a_start_with_no_host_adopts_the_alias_served_in_process`, both cases, red at Plan 3 Task 3 (no marker in its `Config`) and again at Plan 3 Task 5 (no adoption); (10) the alias-listening case of `tests/api/test_discovery_route.py::test_a_zero_search_window_still_serves_the_daemon_the_host_alias_names`, red at Plan 3 Task 4.
  - Already approved by D-18, listed so the request is complete: `tests/js/store/setup.test.js` `test_discovery_fills_a_host_field_the_user_has_not_touched` (Plan 2 Task 1); the alias case of `tests/api/test_container_host_alias.py` `test_a_start_dials_the_record_then_the_variable_and_falls_back_to_the_host_alias`, red at Plan 3 Task 3 and replaced there and again at Plan 3 Task 5.
  - Reported, not replaced: `tests/api/login/test_connection_keeps_login.py::test_a_save_that_changes_only_the_host_logs_nobody_out` stays green after Task 4 but no longer exercises a host change.
  - CONTEXT AC1's first clause now matches D-01: a login naming another host sends that host only the typed pair, never the stored one, and when accepted replaces the saved record. Nothing is pending here.
- **D-01 (owner ruling, 2026-11-08).** A login may name any host and is checked there with the typed pair only; an accepted login to another host replaces the stored record. Today's `login` already does this, so no task changes the login's host handling, and the D-03 validator still runs at login (Task 2). The owner accepted the residual for F-004 and F-005: a caller who reaches the app before login can retarget it to a server they control, and can learn through the login whether another host answers; no stored credential leaves. Plan 5 Task 4 records it in both dispositions.
- **D-02 reading.** "Carries both the username and the password" is read as present and non-empty (Task 4), because blank is the panel's "keep the stored one".
- **Run order.** The five plans run in order 1, 2, 3, 4, 5. The frontmatter `files:` lists overlap between every adjacent pair, so `plan-overlap` reports overlaps and `/cad-execute` takes the sequential path, which runs plans in numeric order (`workflows/execute.md` `choose_path`, `execute_sequential`). The PLAN template has no `depends_on` or `wave` key.
- Shared with later plans, which run after this one: `hqptuner/api/routes/connection.py`, `hqptuner/core/connection.py`, `hqptuner/conf/httpconf.py`, `hqptuner/conf/httpauth.py`, `hqptuner/engine/logtail.py`, `hqptuner/config.py`, `hqptuner/api/login.py`, `docs/architecture.md`, `docs/openapi.json`, `.filepawl.toml`.
