PLAN CHECKPOINT: structural

Plan: /home/atom/dev/hqptuner2/.planning/phases/5/PLAN-2.md

Tasks: 0 of 2

| Task | Commit | Note |
|---|---|---|
| 1 - Pin the close's baseline upload on each landed-write trigger | none | four cases written and run (apply red, live red, preset green, none green, as Task 1 wants); not committed, see deviation; draft kept in plan-2-draft.patch |
| 2 - Read the audit record's fields in close | none | fix written and verified to turn apply and live green; not committed, same deviation |

Worktree: scripts/abuse.sh and tests/e2e/test_abuse_bracket.py reverted to HEAD (6b0a1e0e). The full draft of both edits is `.planning/phases/5/reports/plan-2-draft.patch` (apply with `git apply`). The earlier dispatch's report is `plan-2.1.md`.

Deviations:

- [deviation] Task 2's Verify asserts each positive case's call phase is within 2 s of `test_close_leaves_every_store_as_open_found_it`'s (0.19 s), "so the readback loop took no second turn". Actually true in this e2e stack: no positive case can meet that bound, and at the stack's own settings each takes about 31 s. Evidence (all runs with the Task 2 fix applied, `--durations=0`):
  - Default stack (`HQPTUNER_ALARM_THRESHOLD=0.05`, `tests/e2e/support/stack.py:_app_env`): apply case 31.61 s, preset case 31.61 s, live case 32.54 s. A `bash -x` trace of close shows 17 turns of the readback loop (`livenow=` empty, `sleep 2`), then success.
  - Cause: close's readback loop POSTs `/api/config/refresh` and reads `GET /api/state` straight after. `refresh_devices` calls `settle.restart`, which takes the control socket down (`take_control_down` then `readings.break_engine()`), so `/api/state` answers 503 `not_loaded` until the app reconnects (about 1 s). `settle.await_ready` waits for Ready only up to `alarm_threshold`; at 0.05 s it returns at once, so the read lands in the 503 window on every turn. Probe: five refreshes 2 s apart, each followed by a state read, give 503 each time at 0.05, and give 200 only when the threshold is 1.5 s or more. It settles in the end by timing luck, which is the 31 s.
  - Production is not affected (alarm 15 s, and a real rescan blocks until the engine is back). This is the e2e stack's 0.05 s threshold meeting a loop that refreshes before every read.
  - With the threshold raised to 1.0 s in a test-local override of `stack_support._app_env`: apply 2.21 s, preset 2.22 s, live 3.14 s, baseline 0.19 s; all five cases pass. Each of the restore and the refresh then blocks for about the threshold (`until_ready` returns near the deadline, not at the reconnect: refresh took 1.52 s at 1.5, 3.02 s at 3.0). So the floor for one positive case is about 2 x threshold, and a threshold below the reconnect (about 0.5 to 1 s) is racy (0.5 s: 503 twice, 200 on the third). The 2 s bound is unreachable with a robust threshold; the live case also pays about 0.9 s for the live write route.
  - The Task 1 Action says a case taking a second loop turn is a slow test, not a passing one. Committing the cases at the stack's default settings would commit three 31 s tests; committing with the override commits a test-local monkeypatch of a private stack function and a bound the plan did not state.
  - Not touched by this: the owner's fields ruling. The Task 2 fix (read `.fields.ok`, `.fields.http`, `.fields.live` in the diagnostic line, `applied`, `lived`, `keys`) works: against the unfixed script the apply and live cases fail on `assert 0 == 1` (no upload), the preset and no-landed-write cases pass; with the fix all four pass and apply and live upload exactly once (`_restore_attempts` 1; none-case 0).

Open items:

- Owner decision needed, one of:
  1. Allow `tests/e2e/support/stack.py` into the lease so `stack()` takes an alarm threshold (default unchanged), and have the abuse-bracket `app` fixture pass 1.0; and restate the Task 2 timing bar as a floor-aware bound (for example each positive case within 4 s, or about 2 x threshold plus 1 s of the baseline case).
  2. Keep the lease and let the draft's test-local `monkeypatch.setattr(stack_support, "_app_env", ...)` stand (private-name patch inside the test module), with the same restated bound.
  3. Change `scripts/abuse.sh` close's readback loop to wait for `/api/state` to serve again (not just sleep 2 between refreshes), so it is correct against any reconnect time; this stays inside the lease and removes the dependence on the threshold, but changes the script beyond the owner's fields ruling.
  4. Strike the timing clause of Task 2's Verify.
- Spec check: `docs/spec/testing.md` rule 7 (no fixed sleeps in tests) is respected by every draft case; no sleep was added to the test file.
- Unverified: `make check` (lint, jscpd) was not run on the draft. The draft imports `Callable` and adds about 90 lines to the test file.
- Process footprint: every pytest run and its app subprocess exited; the `python -m hqptuner` processes in `ps` (pids 1890114, 3745217) predate this dispatch and are not mine.
