PLAN COMPLETE

- Plan: .planning/phases/7/PLAN-2.md
- Tasks: 3 of 3 committed; full suite run

| Task | Commit | Note |
|---|---|---|
| 1 - pacing decision reads frame start and end through the time base | 12a32005 | per-test outcomes of the 5 playhead suites identical to the HEAD baseline (345 tests, the same 12 red); `make lint-js` green |
| 2 - spectrogram slices end where their last frame ends | f1a8db41 | staged diff checked against the earlier report (six task files plus `.filepawl.toml`, which now drops the spectroraster.js allowance after `filepawl accept`); lease-check `ok:true` (staged 7, declared 10). Red run earlier: new join case failed by AssertionError. After: the 8 pinned files exit 0, all pass; both greps print nothing, `COLUMN_EPS` still defined; `tsc -p jsconfig.json` and `tsc -p tsconfig.node.json` exit 0; `make lint-js` green. Pre-commit gates (filepawl tree gate etc.) passed. |
| 3 - playhead moves by exactly the paint's wall time | 12d27edb | new case `test_a_paint_at_an_unchanged_delay_leaves_the_playhead_exactly_where_it_stood_plus_the_paints_wall_time` (playhead 1000, dt 1000/60, delay 250): red by AssertionError against playhead.js as task 1 left it (actual 1016.6666666666665, expected 1016.6666666666666). Fix in `pacePaint`: `(playhead ?? from) + dt + ((delayed ?? delay) - delay)`. After: playhead.test.js 305 of 305 pass; across all 8 Pins files 488 tests, 12 fail, exactly the AC7 baseline names in playhead-lag/motion/scroll; the three files give the same failing names with and without the fix; `git diff 503ddec8 --` on the three files prints nothing. `make lint-js` green. |

Full suite: `scripts/gate.sh make -k check` (the repo's own `make check`, no workflow.test_command set): lint, lint-js and the Python suite passed; test-js ran 5646 tests, 5634 pass, 12 fail, exactly the AC7 baseline cases of playhead-lag/motion/scroll. Counts as the passing suite for this plan.

Deviations:
- [deviation] Task 1 verify (3) and Task 2 verify (5) and Task 3 verify (3) expect `bash .claude/task-check.sh` to pass and yield a hand-back URL. It stops at `make check` on the 12 known phase 8 red tests (AC7), so no rebuild and no URL; the owner's look at the Source page and drawer is not possible from this run. Recorded as a deviation per the dispatch, not a blocker.

Open items:
- The 12 AC7 baseline reds (8 playhead-lag, 3 playhead-motion, 1 playhead-scroll) stay red; phase 8's tables.
- The owner has not seen the Source drawer's spectrogram or the Source page meters at a hand-back URL (task-check.sh not reached).
- `tests/js/model/gauges/playhead.test.js` still carries its own `endOf` helper (line 143) and `EPS` allowance; the plan's tasks do not name them, later plans (D-06, D-07) remove them.
