---
phase: 8
status: complete
completed: 2026-11-24
---

# Phase 8: Visuals stay in sync after a track starts - Summary

The playhead now stands one delay behind the line the stamps set (`settledLead`, `followLine`) instead of fixing its lag at the restart, so the lag after a start matches the rest of the track at every rate; the owner passed it at 48k and 192k.

## What shipped

- The paint decision follows the line: `pacePaint` reads the paint's wall time, the arrival flag, the carried line and each frame's `arrivedAt` through `standOnLine` and `leadOf`, and hands the line back - `hqptuner/static/model/gauges/playhead.js`
- The loop carries the line between paints and clears it on reset - `hqptuner/static/store/meter/loop.js`
- The playhead suite's harness hands each paint its wall time, arrival flag and carried line - `tests/js/model/gauges/playhead.test.js`
- The old rule's run-based tests are retired; the four table files are unedited since `63af5055` and pass 41 of 41
- A carry case in `tests/js/store/meter/loop.test.js`, red against the pre-fix code (`at: 3620` against expected `at: 3634`)
- The owner's check on the rebuilt dev build: pass

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | 8ff7f058 | the playhead suite hands each paint its wall time, arrival flag and carried line |
| 1 | 2 | a9e8374d | retire the run-based tests of the old playhead rule |
| 1 | 3 | 82453398 | the playhead follows the line the stamps set, carried through the loop |
| 2 | 1 | none | owner's human-verify on the dev build; verification only, plan lease is `files: []` |

## Deviations

None recorded by the executors - plans executed as written.

Run notes from the coordinator, not plan deviations:

- The first `/cad-execute 8` pass dispatched Plan 2 alone. `.planning/phases/8/records/reports/` held 16 untracked reports from an earlier run that all name `.planning/phases/7/PLAN-*.md`, and its `plan-1.md` began `PLAN COMPLETE`, so the replay seam counted phase 8's Plan 1 as done. Plan 2 halted `blocked` (no fix in HEAD). The owner chose to move the 16 files aside to `.planning/phases/8/records/reports-old-phase7/`, untracked and unchanged; Plan 1 then ran, then Plan 2.
- Plan 2 stopped once more at its `human-verify` checkpoint before the owner's answer. The two earlier Plan 2 reports are `plan-2.1.md` and `plan-2.2.md`.
- The first Plan 2 bracket and the Plan 1 bracket were closed before the host reported their figures, so the run record carries no tokens for them: 43,639 tokens, 16 tool calls, 48 s; and 305,769 tokens, 167 tool calls, 6,057 s.

## Open items

- The e2e case `test_the_spectrogram_scroll_never_changes_by_more_than_one_column_between_paints[the_capture]` failed 3 of 9 runs under the approved rule (`assert 2 <= 1`), the same code passing the other runs, cause not found; host load was about 16 of 18 cores from other work. The executor retired it with its `_largest_step` helper under D-16. Whether it is a kept promise (no jump ahead) is the owner's decision.
- The delay-0 instance of `test_the_playhead_at_a_${delay}_ms_delay_moves_at_a_paint_no_frame_arrived_before` was retired on the executor's own classification; the 102.5 ms and 250 ms instances stay. If it is a premise pin, it needs an input past the opening span.
- Console NaN and Infinity errors on first paint on a fresh load of `:8090` (12 `<text>` y NaN, 6 `<path>` d NaN, 2 `<circle>` cx -Infinity). Cause and relation to Plan 1 unverified; not checked whether they predate Plan 1.
- The owner's pass names two rates (48k, 192k). It does not separately name the start from stopped and the same-rate track change.
- `generatedLandings`'s `lead` parameter in `tests/js/support/meter/meterrig.js` is passed by no caller; the file is outside Plan 1's lease.
- `leadOf` casts `arrivedAt` as always present because the feed stamps every queued frame. No path queues an unstamped frame today; one that did would make the playhead non-finite. A guard was declined.
- `make test-e2e` and `bash .claude/task-check.sh` did not run as one command (600 s limit on one tool command). e2e ran as two `pytest -m e2e` commands split by file, and task-check as `scripts/gate.sh make check` plus the script's trigger-write and health-check steps by hand.
- No `pacePaint`-level case holds the jump by a changed delay once the playhead is off its aim; `loop.test.js` holds it at loop level in both directions.
- `.planning/phases/8/records/reports-old-phase7/` holds 16 untracked reports of an earlier phase 7 run; their disposition is the owner's.

## Goal check

The goal is that after a track starts the visuals keep the lag they hold for the rest of the track, whatever the rate. `git log --oneline 8004ae30..HEAD` shows three commits, and the one that changes behavior is `82453398 fix(8-1): the playhead follows the line the stamps set, carried through the loop`: `hqptuner/static/model/gauges/playhead.js:119-126` now places the playhead at `now + settled.ceiling - delay` and follows that aim, where the prior code set `newest - delay` once at the restart and moved by wall time only, which is the cause phase 7's UAT item 8 named. Plan 1's digest reports `scripts/gate.sh make check` exit=0 on the final tree with the four table files unedited and 41 of 41 passing, where 12 of those cases were red at `63af5055`. The served build matches the tree: `:8090`'s `model/gauges/playhead.js`, `store/meter/loop.js` and `store/meter/delay.js` compared byte-identical to the working tree at `82453398`. The owner's verdict on that build is "yes, 48k and 192k both work at the same delay, pass." That plausibly delivers the goal. What is not shown: the owner's words name the two rates and not each kind of start, one e2e case was retired after failing 3 of 9 runs with no cause found, and first-paint console NaN errors on a fresh load are unexplained.

complete locally, not CI-verified
