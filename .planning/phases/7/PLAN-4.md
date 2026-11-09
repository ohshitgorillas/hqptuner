---
phase: 7
plan: 4
# Phase 7 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against the five Success Criteria and CONTEXT AC1-AC7.
requirements: []
files:
  - hqptuner/api/readygate.py
  - hqptuner/api/factory.py
  - docs/architecture.md
  - tests/api/surface/test_ready_refusal.py
  - tests/api/surface/test_write_gate_scope.py
  - tests/api/surface/test_writes_refused_not_ready.py
  - tests/api/surface/test_not_ready_reads.py
  - hqptuner/
  - tests/
  - .filepawl.toml
---

# Phase 7: Remove the 4321-only mode - Plan 4: One gate refuses engine writes until both lanes are ready

## Goal

HQPTuner requires both the 4321 control lane and the 8088 config lane. With the 8088 lane logged out, its credentials refused, its page unread or the daemon down, every engine write is refused by one app-level gate, HQPTuner's own stores stay writable, and the 4321 reads are still attempted and bounded, relied on by nothing (ROADMAP SC1, D-01 to D-06, AC1 to AC3).

## Must be true when done

- While `ConnectionManager.ready` is false, `POST /api/config/live`, `POST /api/volume`, `POST /api/livepresets/{name}/apply`, `POST /api/matrix/profile`, `POST /api/autopilot` and `POST /api/config/apply` each answer a refusal and the fake 4321 receives no command from that request, for 8088 taken down, credentials refused and `/config` unread (AC1); the same holds while HQPTuner's own apply has the daemon restarting (D-02).
- The refusal carries a shipped sentence and an existing code: no 8088 client, credentials refused, the daemon not answering, or the config page read failed (D-05); no new copy and no new code.
- In that state `POST /api/config/stage` succeeds and the edit shows in `GET /api/config/pending`, and the other own-store writes (favorites, descriptions, narrowing, matrixmodes, live-preset save and delete) answer from their own routes (AC2, server half; D-04).
- In that state `/api/state`, `/api/status`, `/api/enumerations`, `GET /api/volume` and `/api/log` are answered by their own routes, not the gate, and with the fake 4321 stalled or silent each returns within its deadline on the test clock (AC3, D-03).
- A write route added later is refused while not ready without any change to the gate (D-04).
- `scripts/gate.sh make check` exits 0 after each task.

## Context

- Locked: D-01 (`ConnectionManager.ready` is the one readiness fact; no new flag), D-02 (the six routes, both halves of apply, and the restart window of HQPTuner's own apply), D-03 (reads attempted, bounded, relied on by nothing; rejected: refusing every route but login and Connection), D-04 (one app-level gate in the `LoginGate` shape; own-store routes stay open; rejected: switching route dependencies one at a time), D-05 (shipped sentences only), D-06 (`http_client is None` stays reachable and stays a refusal).
- Shape to follow: `hqptuner/api/gate.py` (`decide` returns an `Access`, `LoginGate` only executes it) and `hqptuner/api/crosssite.py`. Middleware order in `create_app`: the last added runs first, so the new gate is added before `LoginGate` and runs after it, and an unauthenticated write still answers `login_required`.
- Refusal parts that exist: `hqptuner.conf.httpauth.decline_error` (no client, credentials refused), `hqptuner.engine.controlerrors.ControlTimeoutError` (the no-answer sentence from `hqptuner.conf.noanswer.no_answer_message`, code `daemon_unavailable`), `hqptuner.api.deps.GetFormFailedError` (`daemon_read_failed`, over `readings.config_error`), rendered through `hqptuner.api.errors.refuse` and `STATUS`.
- `docs/testing.md`: rule 17 (one unit, one result: which requests the gate holds and which refusal it answers are two decisions, two functions), rule 9 (assert codes, never sentences), rule 8 (bite), rule 15 (lowest lane). New tests go in `tests/api/surface/` (D-14). Import layering `api > core > presets > lanes > engine > conf` holds unchanged.
- Out: the allowed-choice check on staged values (phase 8 D-01); any change to what a write does once admitted; any probe against the production daemon.

## Tasks

### Task 1: The refusal a not-ready app answers is one decision

- **Files:** hqptuner/api/readygate.py, tests/api/surface/test_ready_refusal.py, .filepawl.toml
- **Action:** Create the readiness module with one function that, given the app's `ConnectionManager` while `ready` is false, returns the refusal to answer, as one typed value on every path (rule 17). Order of causes: what `decline_error` returns comes first (no 8088 client, or credentials recorded refused), so the user's fix is named before a symptom; then a control lane that is not connected answers the no-answer sentence through `ControlTimeoutError` with the control lane's `Config.request_timeout`; then a recorded `readings.config_error` answers `GetFormFailedError` over that error; anything left (the 8088 lane not yet stamped answering) answers the no-answer sentence too. Reuse those classes as they are: D-05 forbids new copy, and adding a code would touch `STATUS` and the "API errors" contract for nothing. Write the tests first, one per cause, asserting the refusal's code only (rule 9) on a two-lane manager moved into each state mid-run; the module is new, so the bite obligation is the null stub (the module present, the function returning its zero value), named in the hand-back (rule 8).
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/api/surface/test_ready_refusal.py` prints `exit=0`, and fails against the null stub. Testing scope: four causes, four codes (`no_http_client`, `no_credentials`, `daemon_unavailable`, `daemon_read_failed`), one parametrized test per cause; the precedence of credentials over a down control lane is the one ordering case worth a test, since a wrong order names a symptom instead of the fix; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 2: Which requests the gate holds is one decision

- **Files:** hqptuner/api/readygate.py, tests/api/surface/test_write_gate_scope.py, .filepawl.toml
- **Action:** Add one function deciding from a request's method and path whether it is an engine write the gate holds. Every `GET` and `HEAD`, and every path outside `/api`, passes (D-03). Every `POST`, `PUT`, `PATCH` and `DELETE` to `/api` or under it is held, the same method set `CrossSiteGuard` covers, except this open set: `POST /api/login` and `POST /api/connection` (the way back to a working install), `POST /api/config/stage` and `DELETE /api/config/pending`, `PUT /api/favorites`, `PUT /api/descriptions`, `PUT /api/narrowing`, `PUT /api/matrixmodes`, `PUT` and `DELETE` of `/api/livepresets/{name}`, and `POST /api/autosave`. Holding by default is the point of D-04: a route added later is covered without anyone remembering it, and `POST /api/livepresets/{name}/apply` must stay held while `PUT` and `DELETE` on the same prefix stay open. Match paths exactly, as `gate.decide` does. Tests first: a parametrized case per open route and per D-02 route, plus one unregistered `POST` under `/api` that must be held; null-stub bite as in Task 1.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/api/surface/test_write_gate_scope.py` prints `exit=0`, and fails against the null stub. Testing scope: the six D-02 routes held, the open set passing, one unknown write held, one read passing; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 3: The gate is installed and refuses the six engine writes while not ready

- **Files:** hqptuner/api/readygate.py, hqptuner/api/factory.py (`create_app`), tests/api/surface/test_writes_refused_not_ready.py, tests/ (fallout: tests whose not-working write now answers from the gate), .filepawl.toml
- **Action:** Add an ASGI wrapper in the `LoginGate` shape that, for an `http` request the Task 2 function holds while `manager.ready` is false, answers the Task 1 refusal in the shared `{"detail", "code"}` shape at `STATUS[code]` and does not call the app; otherwise it passes the request through unchanged. Install it in `create_app` before `LoginGate` is added. Write the REST tests first and run them red against the pre-change tree (bite, rule 8): on a ready two-lane app, take the 8088 lane down, refuse credentials (`_refuse_auth`) or fail `/config` (`_fail_paths`) and let a poll record it, then each of the six D-02 routes answers a refusal and the fake 4321's command log gains no command from that request; add one case for the restart window of an apply HQPTuner itself started (D-02 owner ruling: no exemption for HQPTuner's own restart), where the unit is the test writer's choice. Run the suite: a test whose not-working write now answers from the gate with a different code is rebuilt on the gate's code, as the owner-approved behavior of D-02, and named in the hand-back; a test asserting a write succeeding while not ready is removed and named. The `docs/architecture.md` paragraph is Task 5's.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/api/surface/test_writes_refused_not_ready.py` fails on the pre-change tree and passes after. Testing scope: six routes by three not-ready causes asserting a refusal code and an unchanged command log, plus the restart-window case; the cause-to-code mapping is Task 1's, so these assert refusal and silence, not which code; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 4: Own-store writes and the 4321 reads stay answered while not ready

- **Files:** tests/api/surface/test_not_ready_reads.py, hqptuner/ (only the route or lane of a read found unbounded, see Action), .filepawl.toml
- **Action:** On a ready two-lane app with the 8088 lane taken down mid-run, prove D-03 and D-04 from the outside: `POST /api/config/stage` succeeds and its edit shows in `GET /api/config/pending` (AC2); `/api/state`, `/api/status`, `/api/enumerations`, `GET /api/volume`, `/api/log`, `GET /api/livepresets/snapshot` and `/api/meter/feed` (both named by D-03) are answered by their own routes, which is to say none of them answers with the gate's refusal; and with the fake 4321 set to stall or answer nothing (`_stall`, `_deaf`), each of those reads returns within its deadline on the virtual clock (AC3, `docs/testing.md` rule 7). If `/api/meter/feed` is a stream with no deadline by design, it is held to "not the gate" only and the reason is named in the hand-back. These are characterization tests of behavior the gate must not break: they pass before and after Task 3, so the rule 8 exemption is stated in the hand-back. A read that does not return within its deadline is a defect fixed in this task, never a threshold widened: the failing case is the red test, and the fix bounds that read in its own route or lane; if the fix would cross the import layering or change what an admitted write does, stop and raise it to the owner as a blocking question quoting the shortest decisive line.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/api/surface/test_not_ready_reads.py` prints `exit=0`. Testing scope: stage plus pending once, the seven reads parametrized for "not the gate" and for "returns under a stalled 4321"; the other own-store routes are covered by Task 2's scope test; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 5: The readiness gate is a normative rule in the architecture document

- **Files:** docs/architecture.md (section 2.4)
- **Action:** Add to `docs/architecture.md` section 2.4, beside the login gate and cross-site paragraphs, one soft-wrapped paragraph stating the readiness gate as a normative rule: which requests it holds, the open set, that it reads `ready`, where it sits in the middleware order and which refusals it answers (repo rule: a decision that changes a normative rule goes in `docs/architecture.md`). Markdown with `Write`/`Edit`; it must pass `triviajudge`.
- **Verify:** the paragraph names the held method set, every route of Task 2's open set, `ready`, its place before `LoginGate` in `create_app` and the four codes of Task 1, each matching the code as built. `.claude/hooks/md-softwrap.py --check docs/architecture.md` exits 0. Testing scope: documentation only, no test. `scripts/gate.sh make check` prints `exit=0`, and after the commit `scripts/gate.sh make trivia` prints `exit=0`.

## Notes

- Choices recorded: `POST /api/autosave` stays open. It is a pure HQPTuner store flag with no daemon touch, which D-04's principle ("HQPTuner's own-store routes stay open") covers, though D-04's parenthetical list does not name it. `POST /api/login` and `POST /api/connection` stay open because they are the user's way back to a working install. Every other write under `/api` is held, including `POST /api/profile/{action}`, `DELETE /api/preset/{name}`, `POST /api/speakers`, `POST /api/matrix/filter`, `POST /api/engine`, `POST /api/restore` and `POST /api/config/refresh`.
- The no-answer sentence for a control lane that is not connected follows D-05 literally; `ControlConnectionFailedError` ("not reachable at") is the other shipped 4321 sentence, and the owner may prefer it there.
- The refusals this gate adds are user-visible for volume, matrix profile switch, auto-pilot and live-snapshot apply while not ready; D-16 names a changelog entry only for the held LIVE edits and Apply not firing (Plan 5).
