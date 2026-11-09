---
phase: 7
plan: 5
# Phase 7 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against the five Success Criteria and CONTEXT AC1-AC7.
requirements: []
files:
  - hqptuner/static/components/PendingBar.js
  - hqptuner/static/store/signals.js
  - hqptuner/static/store/live/write.js
  - tests/js/components/pendingbar.test.js
  - tests/js/store/live/live-held.test.js
  - CHANGELOG.md
  - hqptuner/api/routes/status.py
  - hqptuner/api/factory.py
  - hqptuner/api/deps.py
  - hqptuner/api/routes/matrix/matrix.py
  - hqptuner/static/store/resolve.js
  - hqptuner/static/components/volume/Playback.js
  - docs/openapi.json
  - hqptuner/
  - tests/
  - docs/
  - README.md
  - .filepawl.toml
---

# Phase 7: Remove the 4321-only mode - Plan 5: The page waits for both lanes, and nothing describes a 4321-only mode

## Goal

HQPTuner requires both the 4321 control lane and the 8088 config lane. While not ready, the page stays dimmed, edits still stage, Apply does not fire and LIVE edits wait to be sent once both lanes are ready; and no documentation, comment or docstring describes a 4321-only mode as supported (ROADMAP SC1, SC4, SC5; D-07, D-08, D-09, D-15, D-16, D-17; AC2 client half, AC6, AC7).

## Must be true when done

- With `/api/health` reading `ready` false, the pending bar's Apply, Save and Save as New do nothing when clicked and no apply request is sent, while staging an edit still works (AC2, D-08).
- A LIVE edit made while not ready sends nothing; once `ready` reads true, one `POST /api/config/live` goes out per edited setting, carrying that setting's newest value (AC2, D-08).
- The page is dimmed while not ready and the status pill reads its existing states off the same `ready` fact; neither changed (D-07, D-17).
- None of the comment and docstring lines D-15 lists describes a 4321-only mode as supported, and no other documentation, comment or docstring under `hqptuner/`, `tests/`, `docs/` or `README.md` does either; wire-fact lines stay (AC6, SC4).
- `CHANGELOG.md` `[Unreleased]` carries the owner's entry for the held LIVE edits and Apply not firing, verbatim (D-16).
- `scripts/gate.sh make check` exits 0 on the phase's last `dev` commit (AC7).

## Context

- Locked: D-07 (the not-working state is the existing dim; the Connection panel's auto-open rules stay), D-08 (edits stage, Apply does not fire, LIVE edits held and sent once both lanes are ready, newest value per setting only, every not-ready state including HQPTuner's own restart; it governs this state over the no-disabled-button rule; rejected: replaying every held edit in order), D-09 (`HealthReport.connected` stays, reworded as the control connection standing, feeding only the Connection panel's latch), D-15 (the listed lines), D-16 (owner copy), D-17 (pill unchanged, reads `ready`).
- `ready` (`hqptuner/static/store/signals.js`) already drives the dim (`components/App.js`) and the pill (`components/widgets/StatusPill.js`); after this plan `PendingBar` reads it too and the `connected` computed has no reader left. `store/setup.js` reads `health.value.connected` directly for its latch and keeps doing so.
- No new visible text: the pending bar's existing held status line stays as it is (D-05, D-17). User-facing copy is owner-approved verbatim (`CLAUDE.md`); load `copy-rules` before touching `CHANGELOG.md`.
- `docs/testing.md` frontend rules and rule 9 (no copy in assertions or selectors); tests-first with a red run against the pre-change code (rule 8). Every gate through `scripts/gate.sh`; `filepawl accept` whenever filepawl prints it. This plan follows Plan 4. A visual change goes in front of the owner at the hand-back URL per `CLAUDE.md`, but `CLAUDE.local.md` binds this checkout: work here ends at `make check`, with no `/task-check` and no reviewer run against `:8090`.

## Tasks

### Task 1: While not ready, Apply does not fire and LIVE edits wait for both lanes

- **Files:** hqptuner/static/components/PendingBar.js (`PendingBar`, `inert`, `statusLine`), hqptuner/static/store/signals.js (`connected`, `ready`), hqptuner/static/store/live/write.js (`writeLive`), tests/js/components/pendingbar.test.js, tests/js/store/live/live-held.test.js, CHANGELOG.md, .filepawl.toml
- **Action:** Before any edit in this task, check that the owner's verbatim `CHANGELOG.md` entry for D-16 is in hand (quoted in this plan or given by the owner in the session); if not, stop here, before any code changes, and ask the owner for it, naming what the entry covers. `PendingBar` reads `ready` where it reads `connected` today, so Apply, Save and Save as New are inert and the existing held status line shows whenever both lanes are not ready; delete the `connected` computed and its comment from `signals.js`, since nothing reads it once `PendingBar` stops (knip would flag the export), and rewrite the `PendingBar` comment that said a down configuration lane leaves live settings writable (D-15). In `store/live/write.js`, a `writeLive` made while `ready` is false sends nothing and keeps the field's value, the newest replacing any earlier one for the same field; when `ready` turns true the held fields are sent, one `POST /api/config/live` per field with its newest value, through the same write and re-mirror path a live write takes now, and the held set is emptied; a held write the server then refuses reports on that field the way a refused write does today. Hold in the browser store, in memory: a reload while not ready drops held edits, which is the planner's call recorded for CONTEXT's flagged assumption 1. Tests first, red against the pre-change code: replace `test_apply_is_enabled_with_the_configuration_lane_down_and_disabled_with_no_connection` in `tests/js/components/pendingbar.test.js`, which pins the 4321-only behavior (D-11), with the owner-approved behavior that Apply is inert with the configuration lane down and the control lane up; and in the new store test, edits to two fields, one edited twice, made while not ready send nothing, then on `ready` exactly one live write per field goes out, carrying the newest value. Land the owner's `CHANGELOG.md` `[Unreleased]` entry for this change verbatim in the same commit (D-16); write no agent-drafted entry into the file.
- **Verify:** the two new tests fail against the pre-change code and pass after (bite proof). `scripts/gate.sh npm test` prints `exit=0`. `scripts/gate.sh .venv/bin/python scripts/gates/check_changelog.py` prints `exit=0`. Testing scope: Apply inert while not ready (replacing the 4321-only case), the held-then-sent outcome with newest-value collapse; the existing app and status-pill tests already cover the dim and the pill on `ready` (D-07, D-17) and must pass unchanged; stop there. `scripts/gate.sh make check` prints `exit=0`.

### Task 2: The production comments and docstrings D-06, D-09 and D-15 name describe the two-lane app

- **Files:** hqptuner/api/routes/status.py (`HealthReport`), hqptuner/api/factory.py (`create_app`), hqptuner/api/deps.py (`require_credentials`), hqptuner/api/routes/matrix/matrix.py (`matrix_profile`), hqptuner/static/store/resolve.js (`formValue`), hqptuner/static/components/volume/Playback.js (`configRange`), docs/openapi.json, .filepawl.toml
- **Action:** Rewrite these lines so none describes a 4321-only mode as supported, each saying what the code does now and passing `triviajudge`: the `HealthReport.connected` comment becomes the control connection standing, the field the Connection panel's latch reads, and its "can still apply a live setting" sentence goes (D-09); the `create_app` docstring's "not fatal" framing and the no-credentials warning it logs no longer present an install without credentials as a working one (D-06; the log line is HQPTuner's own log, not owner copy); the `require_credentials` docstring's "unavailable rather than broken" framing goes (D-06); the `matrix_profile` docstring no longer offers "needs no credentials" as a working mode; the `formValue` comment in `resolve.js` and the `configRange` comment in `Playback.js` stop naming "no credentials" as an ordinary state. Behavior does not change: the no-client branches stay refusals (D-06). `matrix_profile`'s docstring is its OpenAPI description, so regenerate `docs/openapi.json` with `scripts/gates/check_openapi.py --write` and let only that description move.
- **Verify:** `git diff --stat` shows only comment, docstring and log-text changes in the six source files plus the one description in `docs/openapi.json`. `scripts/gate.sh .venv/bin/python scripts/gates/check_openapi.py` prints `exit=0`. Testing scope: no behavior changes, so no test; the gates are the check. `scripts/gate.sh make check` prints `exit=0`, and after the commit `scripts/gate.sh make trivia` prints `exit=0`.

### Task 3: No documentation, comment or docstring anywhere describes a 4321-only mode

- **Files:** hqptuner/, tests/, docs/, README.md, docs/openapi.json, .filepawl.toml
- **Action:** Task 2 owns the D-15 lines and the `docs/openapi.json` regeneration for them; this task is the sweep for the rest of SC4. Run, over `hqptuner/ tests/ docs/ README.md CONTRIBUTING.md` excluding `docs/official/`, `docs/eq-assistant/`, `docs/openapi.json` and binary files: `grep -rniE --binary-files=without-match "control lane alone|4321 alone|control[- ]only|no credentials|without credentials|still appl(y|ies)|configuration lane is down|config lane is down|8088 (lane )?(is )?down|reduced mode|degraded mode"`. For each hit, decide whether it presents the control lane alone, an absent or refused credential, or a down 8088 lane as a mode in which features work, and rewrite each that does, passing `triviajudge`; markdown with `Write`/`Edit`, soft-wrapped. Lines stating a wire fact stay, as D-15 lists them (`docs/protocol.md` on the unauthenticated 4321 lane, `docs/matrix-spec.md`, `hqptuner/engine/control.py`, `docs/architecture.md` section 1), and so does prose describing a refusal. A route docstring that changes moves `docs/openapi.json`; regenerate it with `scripts/gates/check_openapi.py --write`. Record each hit and whether it was rewritten or kept as a wire fact or refusal in the hand-back.
- **Verify:** the same grep, rerun after the edits, prints only lines the hand-back lists as kept, each with its reason (wire fact or refusal); any unlisted line fails the task. `scripts/gate.sh make check` prints `exit=0` (AC7) and `scripts/gate.sh make test-e2e` prints `exit=0` on this last commit (disclose first: Playwright and the app subprocess hold a core for well over 10 s, `~/dev/CLAUDE.md` 3.1); after the commit `scripts/gate.sh make trivia` prints `exit=0`. Testing scope: no behavior changes, so no test; stop there.

## Notes

- Held LIVE edits live in the browser store and do not survive a reload; CONTEXT's flagged assumption 1 left that to the planner. If the owner wants them to survive a reload, the hold moves to session storage, still in `store/live/write.js`.
- Not held, because D-08 names LIVE edits only: the playback volume knob (`POST /api/volume`), a live-snapshot apply and a matrix profile switch. While not ready the server refuses those (Plan 4) and the page reports it through its existing error paths.
- Open for the owner: what a LIVE control shows while its edit is held. CONTEXT does not say; this plan adds no text, and the control may show the engine's value until the held edit is sent.
- The `CHANGELOG.md` entry D-16 calls for is not in any planning artifact. The repo rule wants it approved with the plan, so ask the owner for it before `/cad-execute 7`; Task 1 checks for it before any code edit and stops there if it is missing.
- Plan check warned that Task 1 joins `PendingBar` and the `writeLive` hold. They stay one task because both are the user-visible change D-16's one entry covers, and the repo rule lands an entry in the same commit as its change.
- The pending bar's existing held status line contains an em dash; it is existing owner copy and this plan does not touch it.
