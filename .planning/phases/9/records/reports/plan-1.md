PLAN COMPLETE

Plan: /home/atom/dev/hqptuner2/.planning/phases/9/PLAN-1.md

Tasks: 2 of 2

| Task | Commit | Note |
|---|---|---|
| 1 - per-style, per-part trace rule | 45344e2f | `tracePartsOf(picked)` in sourcepaint.js returns `{line, area, shadow}`; 18-case hand-written table. Bite: run before the export existed failed with "does not provide an export named 'tracePartsOf'". `make check` exit=0. |
| 2 - painter draws each part as the rule says | 15632c94 | `paintTrace` takes one `TraceColumns` object, each path from its own answer; `showsTrace` and `TRACE_STYLES` removed with the six-row `showsTrace` table; Fade's line and area leaves-empty cases retired, Fade shadow case kept. Bite: new `test_under_fade_a_playing_paint_draws_the_trace` and `..._the_area` failed against 45344e2f with empty paths, passed after. `grep showsTrace` over `hqptuner/static` and `tests/js` prints nothing. The five files the plan keeps untouched show an empty diff against 572852cb. `make check` (includes test-js) exit=0. |

Full suite: `workflow.test_command` is null, so the project's own gate ran once: `scripts/gate.sh make check` at HEAD 15632c94, `exit=0 log=/tmp/gate-make-8XSfWDOK.log`. No processes left behind.

Deviations: none

Open items: Task 2's Verify asks for `bash .claude/task-check.sh`. Its steps 2 and 3 write a trigger file outside the repository (`HQPTUNER_REBUILD_TRIGGER`) for a root-owned systemd path unit, rebuild `hqptuner:dev` on the live host and poll :8090. Under the contract that is a decision checkpoint, so only step 1 (`make check`, green) ran. By owner decision ("Plan 3 runs it"), the rebuild and health-check half (steps 2 and 3) of Task 2's Verify is handed to Plan 3. Plan 3 compares the served `sourcepaint.js` with the tree and runs `task-check.sh` itself before the owner's eyes-on check. This plan did not run `task-check.sh`, did not rebuild `hqptuner:dev` and did not touch :8090. The hand-back URL to the owner's eyes (AC7, Aurora per D-10) is outstanding and also Plan 3's.

Open items: worktree lacked `.venv`, `node_modules` and the eqlab submodule checkout (network url); provisioned with gitignored symlinks to the main tree's `.venv` and `node_modules`, and a copy of the main tree's eqlab files (its `.git` file removed) so `make check` could run. None of it is tracked or committed.

Open items: declined a configurable or table-driven parts structure beyond the three-way `tracePartsOf` function; the Verify's six-row answers are met by three fixed return objects.
