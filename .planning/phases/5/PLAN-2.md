---
phase: 5
plan: 2
requirements: [TEST-01]
files:
  - tests/e2e/test_abuse_bracket.py
  - scripts/abuse.sh
  - hqptuner/core/manager.py
  - tests/apply/manager/test_manager_control_down.py
---

# Phase 5: Untested behaviors covered - Plan 2: abuse.sh baseline upload

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the `scripts/abuse.sh close` bullet: the baseline upload after a run's apply, live write or preset store write landed.

## Must be true when done

- A run whose apply landed, one whose live write landed, and one whose preset store write landed each end with `close` uploading the baseline, and a test fails when any one trigger stops uploading.
- A run in which none of the three landed ends with no upload, so an always-upload close fails a test.
- `close` reads each audit record the way `GET /api/audit` serves it, with the event's own keys under `fields`.
- When the app takes its control connection down for an engine restart, it reconnects at once, without idling out a status interval first.
- After each refresh, `close` reads state back only once the app reports itself ready again, so each case's readback settles on its first turn and no case runs a `sleep 2` turn.
- `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_abuse_bracket.py` and `PYTHONPATH=$(pwd) scripts/gate.sh make check` each print `exit=0`.

## Context

- D-08: `close` is a shell script, tested in the e2e lane only (`tests/e2e/test_abuse_bracket.py`, three in-process wire fakes, the app in a subprocess). `make check` does not run that lane, so the pass and the bite proof each need their own `pytest -m e2e` run. No test touches the live daemon.
- D-02: the bite proof is a deliberate break of the covered line, reverted after; the commit message names each break and the test it turned red.
- `docs/spec/testing.md` rule 7 and "Speed is a correctness property" bind every task: a loop is tested for how many passes it makes and what it concludes, never how long it takes. In the e2e lane only bounded condition polls are allowed, never a fixed sleep. Where production paces on a real clock, the test injects a seam. Rule 3: no test monkeypatches the stack's internals (`_app_env`) or sets `HQPTUNER_ALARM_THRESHOLD` per case to buy time.
- Owner ruling 2026-11-12 (wave 1 checkpoint), the fields bug: `GET /api/audit` serves each record as `{seq, ts, event, fields}`, with the event's own keys (`ok`, `http`, `live`) under `fields` (`hqptuner/audit.py` `AuditRecord`, `AuditLog.records`). `close` reads `.ok` and `.http` at the record's top level (the diagnostic `jq` line, and the `applied`, `lived` and `keys` lines), so it never uploads after an apply or a live write.
- Owner ruling 2026-11-12, the reconnect: a measured spike found that with the fields bug fixed, each positive case took about 31 s, 16 or 17 readback turns. The refresh route (`hqptuner/core/engineread.py` `refresh_devices`, via `hqptuner/lanes/settle.py` `restart`) calls `ConnectionManager.take_control_down` (`hqptuner/core/manager.py`). That method drops the control client and breaks the readings, so `/api/state` answers 503, but unlike the socket-closed path in the same file it never calls `self._supervisor.redial()`. The connect loop therefore idles in `loader._rest` on `clock.pace(stop, cfg.status_interval)` (1.0 s default) before redialing. `settle.await_ready` gives up at the alarm threshold (0.05 s in `tests/e2e/support/stack.py`), `refresh_devices` ignores that result, and the route returns while state still answers 503, so `close`'s readback misses and sleeps. The `/api/health` phase reaching Ready (Lifecycle Ready on FORM_ANSWERED, after the readings are filled) is the condition the app already exposes for "serving state again".
- Host safety: the redial change also runs in production on every engine restart, against hqplayerd. If an immediate redial while the daemon is still restarting would retry faster than the existing fault backoff (`RECONNECT_FAST` / `RECONNECT_SLOW` in `manager.py`), stop with a checkpoint rather than ship it.
- Worktrees: every Python gate command here carries `PYTHONPATH=$(pwd)`.
- Out of scope: the `todo.txt` strike (Plan 19); `refresh_devices` ignoring `await_ready`'s result (record it as an open item if Task 3 leaves it observable); any `scripts/abuse.sh` change beyond Tasks 2 and 4.

## Tasks

### Task 1: Pin the close's baseline upload on each landed-write trigger

- **Files:** tests/e2e/test_abuse_bracket.py
- **Reads:** scripts/abuse.sh#close, tests/e2e/test_abuse_bracket.py#_bracket, tests/e2e/test_abuse_bracket.py#_call, tests/e2e/support/stack.py#Stack, tests/support/fake_http.py#_restore_post
- **Decisions:** D-01, D-02, D-08
- **Pins:** tests/e2e/test_abuse_bracket.py
- **Action:** Behavior the owner wants: `close` uploads the baseline (POST /api/restore through HQPTuner, which reaches the 8088 fake's restore) after a run in which an apply landed, after one in which a live write landed, and after one in which a preset store write landed (the script counts `preset.write`, `preset.load` and `preset.delete` audit events). Three results, three cases. The negative half, a run with none of the three landed makes no upload, is in scope because it is what lets the three discriminate: an always-uploading close passes all three positive cases and fails only this one (D-01's named wrong implementation). The upload is observed at the fake's own restore bookkeeping (`_restore_attempts` or `_restore_bytes` in `Stack.http_state`), read after `close` has returned, never by parsing the script's printed lines, which are copy. Each run is driven through HQPTuner's own routes the way the file's `_call` helper already does; close refuses unless the control fake reports idle and the applied fields read back at baseline, so each case sets up the fake state those checks need (the fake's restore adoption rows, `control_state`) before `close` runs. The stack stays function-scoped, as the module docstring explains, and runs at its own settings.
- **Verify:** Against the unfixed `scripts/abuse.sh`, `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_abuse_bracket.py` runs the apply and live-write cases red on their assertion (no upload), and the preset and no-landed-write cases green. Commit the four cases with those two red: `make check` and pre-commit do not run the e2e lane (D-08), so no `SKIP=` or `--no-verify` is involved.

### Task 2: Read the audit record's fields in close

- **Files:** scripts/abuse.sh
- **Reads:** scripts/abuse.sh#close, hqptuner/audit.py#AuditRecord, hqptuner/audit.py#AuditLog, hqptuner/api/routes/audit.py
- **Decisions:** D-02, D-08
- **Action:** Behavior the owner wants: `close` counts an apply or a live write as landed when that record's `fields.ok` is true, and reads back the keys of that apply's `fields.http`, matching the shape `GET /api/audit` serves. Fix every same-cause read in `close`: the diagnostic `jq` line that prints `http`, `live` and `ok`, and the `applied`, `lived` and `keys` lines. The preset count reads `.event` only and stays as it is.
- **Verify:** The four Task 1 cases pass. Three breaks, each applied alone to the trigger test in `scripts/abuse.sh` and reverted after: dropping the `"$applied" -gt 0` arm, dropping the `"$lived" -gt 0` arm, dropping the `"$presetted" -gt 0` arm. Each turns its own case red on the assertion, and replacing the whole condition with `true` turns the no-landed-write case red. After the reverts `git diff --quiet -- scripts/abuse.sh` succeeds. Each positive case's run ends with `_restore_attempts` at 1 in `Stack.http_state` (one upload), and the no-landed-write case's at 0. These cases may still run slow here; Tasks 3 and 4 remove the wait.

### Task 3: Reconnect at once when control is taken down for a restart

- **Files:** hqptuner/core/manager.py, tests/apply/manager/test_manager_control_down.py
- **Reads:** hqptuner/core/manager.py#ConnectionManager, hqptuner/core/loader.py, hqptuner/lanes/settle.py, hqptuner/clock.py, tests/support/virtual_clock.py, tests/apply/manager/test_manager_control_down.py
- **Decisions:** D-02
- **Action:** Behavior the owner wants: after the app takes its control connection down for an engine restart, it redials straight away instead of idling out one status interval first, the way it already does when the daemon closes the socket. Tests first, offline, on the `VirtualClock` handed in through the constructor (rule 7): the new test is red against the current `take_control_down` on an assertion, then the fix makes it green. The test observes the redial as passes or wire traffic on the fake daemon, never as elapsed seconds. Check the host-safety line in Context before landing the fix.
- **Verify:** The new test fails on an assertion against `take_control_down` as it is at the plan's pre-plan HEAD, and passes after the fix. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0, with no existing assertion line removed from `tests/apply/manager/`.

### Task 4: Close reads state back only once the app is ready again

- **Files:** scripts/abuse.sh, tests/e2e/test_abuse_bracket.py
- **Reads:** scripts/abuse.sh#close, hqptuner/api/routes/status.py, hqptuner/core/lifecycle.py
- **Decisions:** D-02, D-08
- **Action:** Behavior the owner wants: after each `/api/config/refresh` POST in `close`'s readback loop, `close` waits, as a bounded condition poll, until `/api/health` reports the app's phase Ready, and only then reads the form and live state back. The poll's bound is a ceiling on the condition, never a duration anything is expected to take. With Tasks 2 and 3 in place, each Task 1 case's readback settles on its first turn. If the existing cases cannot show the turn count, Task 1's file gains the observation (the 8088 fake's refresh-request count in `Stack.http_state`, or an equivalent wire count), never the script's printed lines.
- **Verify:** `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_abuse_bracket.py` prints exit=0. Each positive case shows one restore upload and one readback turn, so no `sleep 2` ran. Removing the health wait (a break, reverted after) makes a positive case show more than one readback turn, or go red on an assertion. No test sets `HQPTUNER_ALARM_THRESHOLD` or monkeypatches the stack. `git diff -U0 -- tests/e2e/test_abuse_bracket.py` removes no assert line, and `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
