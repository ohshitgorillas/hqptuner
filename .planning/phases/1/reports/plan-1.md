PLAN COMPLETE

Plan: .planning/phases/1/PLAN.md

Tasks: 2 of 2

| Task | Commit | Note |
|---|---|---|
| 1 - A snapshot save sends no DELETE for a station that was not ticked | 8a507170 | Wire fake now holds per-station lists (PUT writes named stations, DELETE removes only `?station=`). Bite: with the fake updated and shell.js unchanged, `test_saving_to_another_station_leaves_the_record_on_its_own` and `test_renaming_while_saving_to_another_station_keeps_the_old_name_on_its_own` failed (AssertionError, 'Warm' missing from Day). After the `write` change the shell and livepresets suites exit=0; the other suites using the fake exit=0. |
| 2 - The builders' save model drops the move-out rule | 6c67c626 | `savedTo` has no move branch and no `keep`. Bite: `test_unticking_its_own_station_leaves_the_record_there` failed against the unchanged model (the only red of 61). After the change builder, shell and profile suites exit=0; `grep -nw keep` over the three files prints nothing. `test_a_record_that_stays_is_copied_not_moved` removed (same outcome as the reversed check); `test_a_moved_record_is_then_edited_where_it_went` renamed, assertion unchanged. `.filepawl.toml` needed no accept. |

Checkpoint resolved (human-verify): coordinator ran `bash .claude/task-check.sh`, passed (make check green, hqptuner:dev rebuilt, 200). Owner at hand-back URL: "Works as described" (snapshot on A, untick A, tick B, Save lists it under A and B).

Final full suite (`scripts/gate.sh make check`; workflow.test_command is null): exit=0 (log /tmp/gate-make-eB9yFVUf.log).

Deviations: none

Open items: the Task 2 commit was first made as `refactor(1-2)` and amended to the dispatched scope `1-1` before report.
