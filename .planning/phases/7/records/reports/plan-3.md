PLAN COMPLETE

- Plan: .planning/phases/7/PLAN-3.md
- Tasks: 5 of 5

| Task | Commit | Note |
|---|---|---|
| 1 - The VU needle moves on dt in ms | 376f17a8 | vu.js constants per ms; sourcepaint converts once through secondsToMs; vu.test.js red (5 fail) before the change |
| 2 - The meter steps and the flames move on dt in ms | a6b0ee73 | steps.js constants restated per ms; STEP_SLACK kept; committed with `SKIP=filepawl` under the owner's red-commit override |
| 3 - The painters take dt in ms | 5d4e572e | `msToSeconds` added to lib/timebase.js (one case in timebase.test.js, red by missing export first); aurora converts once at the `time` uniform; sourcepaint, spectrumfx and aurora hand `dt` straight to the steps; suites moved to ms (STEP_MS 31.25, HOLD_MS, SETTLE_MS, LATE_MS, TICK_MS 15.625, exact in binary); SourceMeter converted once through secondsToMs until Task 4. `filepawl check` clean after this commit (spectrumfx.js back at 496). |
| 5 - The two dt error messages say ms | bf71b9d1 | "seconds" became "ms" in both thrown messages, nothing else in them changed; prettier joined the aurora `if`/`throw` onto one line because the shorter message fits |
| 3 follow-up | 2fab7ba8 | aurora-glsl.test.js header said time counted in sixtieths of a second; now says ticks of 15.625 ms |
| 4 - The meter loop hands painters dt in ms | 32d40b97 | `MS_PER_S` gone from loop.js; `paint` hands `painted.dt`; SourceMeter passes `dt` straight; `same()` gone from loop-boot, loop-painters, loop.test (exact equality now); `dt * SECOND_MS` products gone from the loop suites and spectrum-motion; loop-boot keeps no SECOND_MS; 11 AssertionErrors red before loop.js changed |

Verification at the end:

- `grep -rn "MS_PER_S" hqptuner/static/components hqptuner/static/model/gauges/meter` and in `store/meter/loop.js`: nothing. No constant in steps.js ends in `_S`; `STEP_SLACK = 1e-9` is at line 15.
- `grep -rn "const same = " tests/js`: nothing. `grep -rnE "dt \* SECOND_MS" tests/js/store/meter`: nothing. `grep -n SECOND_MS loop-boot.test.js`: nothing.
- `npx tsc -p jsconfig.json` and `-p tsconfig.node.json`: exit 0. `make lint-js`: exit 0. `.venv/bin/filepawl check`: exit 0, clean (the State-to-restore item: spectrumfx.js is 496 again, not split, no gate skipped in tasks 3 to 5).
- Full suite: `workflow.test_command` is null, so the project's own `make check` ran (through `bash .claude/task-check.sh`) on the final tree: lint, lint-js and the offline pytest passed; test-js 5647 tests, 5635 pass, 12 fail. The 12 are the AC7 baseline playhead tests (`test_a_start_stands_one_delay_behind_the_line_*`, `test_a_restart_*`, `test_the_playhead_takes_a_rise_*`, `test_the_playhead_follows_a_rise_*`, `test_the_playhead_stops_at_the_newest_end_*`, `test_after_a_stand_the_edge_moves_on_toward_the_line`), the same names as before this plan, none touched by it. One more test than baseline is the new timebase case. The task-check rebuild and health-check step was not reached because make check stops at those 12.

Deviations:

- [deviation] Task 1 Verify (1) expected vu.test.js and vu-motion.test.js both red against HEAD vu.js; observed vu-motion.test.js green (3 pass). Its cases compare late-paint against steady-paint motion after a 3000 ms history; with ms handed to a seconds model every needle is fully settled both ways, so the invariant holds whatever the unit. Left as is: the task's testing scope allows no new case.
- [deviation] Task 2 Verify (1) expected meter-math.test.js red against HEAD; it has no time input at all, so there is nothing to move and nothing to fail. Left unchanged.
- [deviation] Task 3 Verify (1) expected the updated painter suites to fail by AssertionError against the painters as at HEAD; observed only spectrum-motion.test.js (ridges, `still: 61`) failing by AssertionError, and timebase.test.js failing on the missing `msToSeconds` export. The sourcepaint, spectrumfx and aurora suites stayed green: they assert same-time-same-picture and settled states, which hold when ms is read as seconds. No new case, per the task's testing scope.
- [deviation] Verify `bash .claude/task-check.sh` (Tasks 1 to 4) cannot pass: `make check` stops at test-js on the 12 baseline-red playhead tests, identical to the AC7 baseline. Everything before test-js passed.
- [deviation] Task 5: the plan text said the owner must approve the corrected wording and the task is not done until then. The owner ruled on 18 Nov, relayed by the coordinator, that these two messages need no approval; each says ms where it said seconds and nothing else in it changed. Task 5 was committed before Task 4 on that ruling (an order change said here; its files do not overlap Task 4's).
- [deviation] Task 4 Verify (5) and Task 3 Verify (5): the owner's look at the Source page's meters, spectrum styles and aurora at the hand-back URL was not done; no rebuild ran (see above) and an agent does not stand in for the owner's eyes.

Open items:

- The 12 AC7 baseline playhead tests are still red, as the dispatch said they would be; this plan neither caused nor covers them.
- Owner visual check of the meters, spectrum styles and aurora is still owed (Tasks 3 and 4 Verify (5)).
- `loop.test.js` and `loop-painters.test.js` keep their `SECOND_MS` and `(at * SECOND_MS) / RATE` conversions: Plan 15 Task 4's, per the plan.
- `loop-painters.test.js` still compares playhead moves with `Math.abs(m.by - m.wall) > 1e-6`. A time-float tolerance of that kind may belong to D-07; I left it because Task 4 named only `same()`, and the exact form was not tried.
- aurora-glsl.test.js has its own `same(a, b)` deep comparer with a relative TOL; it compares drawn canvases, not wall times, so it is not the `same()` rounding D-07 removes. Left as is.
- Task 3 added no test of the aurora's `time` uniform in seconds (the testing scope allowed no new case); `msToSeconds` itself has its one case.
