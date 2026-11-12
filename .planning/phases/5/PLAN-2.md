---
phase: 5
plan: 2
requirements: [TEST-01]
files:
  - tests/e2e/test_abuse_bracket.py
---

# Phase 5: Untested behaviors covered - Plan 2: abuse.sh baseline upload

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the `scripts/abuse.sh close` bullet: the baseline upload after a run's apply, live write or preset store write landed.

## Must be true when done

- A run whose apply landed, one whose live write landed, and one whose preset store write landed each end with `close` uploading the baseline, and a test fails when any one trigger stops uploading.
- A run in which none of the three landed ends with no upload, so an always-upload close fails a test.
- `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_abuse_bracket.py` prints `exit=0`.

## Context

- D-08: the subject is a shell script, tested in the e2e lane only (`tests/e2e/test_abuse_bracket.py`, three in-process wire fakes, the app in a subprocess). `make check` does not run it, so the pass and the bite proof each need their own `pytest -m e2e` run. No test touches the live daemon.
- D-02: the bite proof is a deliberate break of the covered line in `scripts/abuse.sh`, reverted after; the commit message names each break and the test it turned red.
- The e2e rule (`docs/spec/testing.md` rule 7): bounded condition polls only, no fixed sleeps in the test; abuse.sh's own `sleep 2` retry and readback loops stay (CONTEXT flagged assumption). One plain `assert` per test.
- Worktrees: every Python gate command here carries `PYTHONPATH=$(pwd)`. In a `.claude/worktrees/*` tree without it, `hqptuner` resolves to the main checkout's editable install, so the app subprocess and the gates measure the main checkout, not the worktree (repo `CLAUDE.md`, Dev).
- Out of scope: the `todo.txt` strike (Plan 19), any change to `scripts/abuse.sh` itself.

## Tasks

### Task 1: Pin the close's baseline upload on each landed-write trigger

- **Files:** tests/e2e/test_abuse_bracket.py
- **Reads:** scripts/abuse.sh#close, tests/e2e/test_abuse_bracket.py#_bracket, tests/e2e/test_abuse_bracket.py#_call, tests/e2e/support/stack.py#Stack, tests/support/fake_http.py#_restore_post
- **Decisions:** D-01, D-02, D-08
- **Pins:** tests/e2e/test_abuse_bracket.py
- **Action:** Behavior the owner wants: `close` uploads the baseline (POST /api/restore through HQPTuner, which reaches the 8088 fake's restore) after a run in which an apply landed, after one in which a live write landed, and after one in which a preset store write landed (the script counts `preset.write`, `preset.load` and `preset.delete` audit events). Three results, three cases. The negative half, a run with none of the three landed makes no upload, is in scope because it is what lets the three discriminate: an always-uploading close passes all three positive cases and fails only this one (D-01's named wrong implementation). The upload is observed at the fake's own restore bookkeeping (`_restore_attempts` or `_restore_bytes` in `Stack.http_state`), read after `close` has returned, never by parsing the script's printed lines, which are copy. Each run is driven through HQPTuner's own routes the way the file's `_call` helper already does; close refuses unless the control fake reports idle and the applied fields read back at baseline, so each case sets up the fake state those checks need (the fake's restore adoption rows, `control_state`) before `close` runs, such that the first upload is accepted and the first readback poll already reads baseline. A case whose state makes either of close's `sleep 2` loops take a second turn is a slow test (repo rule "slow tests are defects", the suite-time bar), not a passing one. The stack stays function-scoped, as the module docstring explains.
- **Verify:** `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_abuse_bracket.py` prints exit=0. Three breaks, each applied alone to the trigger test in `scripts/abuse.sh` and reverted after: dropping the `"$applied" -gt 0` arm, dropping the `"$lived" -gt 0` arm, dropping the `"$presetted" -gt 0` arm. Each turns its own case red on the assertion, and replacing the whole condition with `true` turns the no-landed-write case red. After the reverts `git diff --quiet -- scripts/abuse.sh` succeeds. Each positive case's run ends with `_restore_attempts` at 1 in `Stack.http_state` (one upload, no upload retry), and the no-landed-write case's at 0. In the passing run with `--durations=0` added, each new case's call phase is within 2 s of `test_close_leaves_every_store_as_open_found_it`'s call phase in the same run, so the readback loop took no second turn either. `git diff -U0 -- tests/e2e/test_abuse_bracket.py` removes no assert line, and `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0 (lint and jscpd over the new Python). Testing stops at the four cases; the readback, volume, profile and store restores after the upload are already pinned or out of this bullet.
