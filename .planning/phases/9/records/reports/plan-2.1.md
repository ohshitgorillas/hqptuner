PLAN COMPLETE

Plan: .planning/phases/9/PLAN-2.md

Tasks: 2 of 2

| Task | Commit | Note |
|---|---|---|
| 1 - One yes or no per style for showing the trace | c6a13290 | `showsTrace(picked)` exported from sourcepaint.js, backed by `TRACE_STYLES` set beside `CANVAS_STYLES`. Six-row hand-written table in sourcepaint-section.test.js. Predicted and saw red against pre-change source (SyntaxError, no export `showsTrace`), then exit=0 with six new passing cases. `make check` exit=0. Lease ok. |
| 2 - The painter writes no trace under a style that shows none | fd8296c8 | `paint` hands `paintTrace` NO_COLUMNS for line and shadow under any style where `showsTrace` is false; `paintCanvases` still gets the real line. Header and `paintTrace` comments updated. 24 new cases (12 AC1 over Bars, Ridges, Fade, Flames x three paths; 3 AC3; 3 switch-away; 3 switch-back; plus 3 shadow/line/area under Trace counted in the AC3 three). Predicted and saw 15 red (12 AC1, 3 switch-away) and 9 green against the Task 1 painter, then all green after the change. SourceMeter.js and meter.css untouched (empty diff). `bash .claude/task-check.sh` via gate.sh exit=0: make check green, hqptuner:dev rebuilt, :8090 serving. Lease ok. |

Suite: `workflow.test_command` is null; the project's `make check` is the suite. It ran green inside task-check on the tree identical to the committed HEAD, so no second run.

Deviations: none Open items: `npm test` named in Task 2's Verify does not exist (package.json has no `test` script, "Missing script: test"); the JS suite runs as `make test-js` inside `make check`, which passed with sourcepaint-motion, spectrum-motion and meter tests unedited. The bite-proof for Task 2 was taken from the pre-change run of the same tests against Task 1's painter, not a second checkout. I piped one `gate.sh` run through `head` by mistake in Task 1 (its log was read in full afterward).
