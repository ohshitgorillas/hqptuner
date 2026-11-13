PLAN COMPLETE

Plan: .planning/phases/5/PLAN-2.md

Tasks: 4 of 4

| Task | Commit | Note |
|---|---|---|
| 1 - Pin the close's baseline upload on each landed-write trigger | e3200241 | one parametrized claim over four runs (apply, live write, preset store write, none); against unfixed abuse.sh the apply and live params are red on `assert 0 == 1`, preset and none green. A first form with a separate no-write test was refused by the filepawl absence gate (asserts only an absent value), so the four runs are one parametrized test |
| 2 - Read the audit record's fields in close | 8b949cf9 | four jq reads moved under `.fields`; the four cases pass; breaks dropping the applied, lived and presetted arm each turn only their own param red, `true` turns no-write-landed red; script restored to the fixed form after each |
| 3 - Reconnect at once when control is taken down for a restart | 6a1c14d5 | `take_control_down` now calls `self._supervisor.redial()`; new offline test red before (control None, phase Down) and green after; `make check` exit=0. Host safety checked: only the first dial moves up, a refused dial still waits `poll_interval`, and `RECONNECT_FAST`/`RECONNECT_SLOW` belong to a loop that ended on a fault and are untouched |
| 4 - Close reads state back only once the app is ready again | d5d3ac43 | committed by the orchestrator on the owner's ruling to accept the wait with the pair bite only, see deviation. `scripts/abuse.sh` gains a bounded `/api/health` Ready poll after each refresh; `tests/e2e/test_abuse_bracket.py` gains `_close_after` (counts refreshes at the 8088 fake's `_on_refresh` hook) and `test_close_reads_state_back_on_its_first_turn_once_a_write_landed`. `pytest -m e2e tests/e2e/test_abuse_bracket.py` 14 passed in about 15 s (was about 110 s before Tasks 3 and 4); `make check` exit=0 on this tree; no assert line removed from the e2e file; no alarm-threshold override and no monkeypatch of the stack |

Deviations:

- [deviation] Task 4's Verify says removing the health wait (a break, reverted after) makes a positive case show more than one readback turn or go red. Actually true: with Task 3 in place, removing only the health wait leaves all 14 e2e tests green (log /tmp/gate-pytest-gbaFjr6B.log, 14 passed), because the redial now completes before `refresh_devices` finishes its own form refetch, so the readback's first turn already finds the app serving. The new first-turn test goes red (3 failed, about 100 s, `/tmp/gate-pytest-RsUYDZLm.log`) only when BOTH the health wait and the Task 3 redial are removed, so it bites the pair and not the wait alone. No stack seam in the plan's lease can slow the reconnect (`tests/e2e/support/stack.py` is outside the lease, and the alarm-threshold and monkeypatch routes are barred by rule 3). The health wait is therefore redundant in this stack today and only guards a slower reconnect.

Open items:

- Owner ruling 2026-11-12: Task 4's health wait is accepted as a guard whose bite is shown by the pair break (wait plus redial) only; committed as is.
- `refresh_devices` ignores `await_ready`'s result (`hqptuner/core/engineread.py`); still observable in code, left alone as the plan says.
- The earlier report was rotated to `.planning/phases/5/reports/plan-2.2.md` (git shows `plan-2.md` as modified/deleted until the orchestrator stages it).
