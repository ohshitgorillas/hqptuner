PLAN CHECKPOINT: structural

Plan: /home/atom/dev/hqptuner2/.planning/phases/7/PLAN-1.md

Tasks: 0 of 4

| Task | Commit | Note |
|---|---|---|
| 1 - Feed stamps come from one samples-to-ms conversion in the time base | none | Implemented and staged on `cadence/phase-7-plan-1`, NOT committed: the pre-commit gates `filepawl tree gate` and `suite wall time against its bar` fail (see Open items). Verify items 1 to 4 pass; item 5 not run. |
| 2 - The spectrum delay is ms from the delay store on | none | not started (checkpoint) |
| 3 - The apodizing scale and the Source drawer's time axis convert through the time base | none | not started (checkpoint) |
| 4 - The crossfeed ITD and the pipeline delay caption convert through the time base | none | not started (checkpoint) |

Task 1 evidence (staged, uncommitted):
- New `hqptuner/static/lib/timebase.js` (`samplesToMs`, `startOf`, `endOf`; `MS_PER_S` kept private until a later task needs it exported, so knip stays green), `tests/js/lib/timebase.test.js` (6 cases), six-rate contiguity table `CONTIGUOUS_AT_RATES` in `tests/js/support/meterfeed.js`, `feed.js` decode/trim/edge through the structure, `MeterFrame.end` documented in `meter.js`, `SAME_MS`/`SECOND_MS`/`near` gone from `feed.test.js` and `apodstamp.test.js`; `ONE_SECOND_APART_176K` rows changed to `at` 0 and 176400 so the one-second expectation is exactly 1000.
- Verify (1) red: against `feed.js` at HEAD, the six new cases `test_in_a_contiguous_feed_at_<rate>_hz_each_frame_ends_exactly_where_the_next_one_starts` fail with `AssertionError` (ERR_ASSERTION), 6 of 38 failing.
- Verify (2) after the change: per-test outcome diff against the HEAD run of the six named suites shows only added passing cases (the six rate cases, the 6 timebase cases) and the one replaced case; the same 12 phase 8 table tests (playhead-lag, playhead-motion, playhead-scroll) fail before and after.
- Verify (3): both greps print nothing.
- Verify (4): `npx tsc -p jsconfig.json` and `-p tsconfig.node.json` exit 0; `git diff 503ddec8 --stat` over the three phase 8 tables prints nothing.
- Also green: eslint, prettier, knip, jscpd, `check_doc_refs.py` on the touched files.
- Wide run of `tests/js/store/meter`, `tests/js/model/gauges`, `tests/js/contracts` (before the eqlab copy below): only the 12 phase 8 table failures plus two files that could not load for want of the eqlab submodule.

Deviations: none

Open items:
- BLOCKER, structural. Pre-commit `filepawl tree gate` fails: `hqptuner/static/lib: 16 files, cap 15`. `lib/` already holds 15 files (`api`, `apodscale`, `binaural-setup`, `clipboard`, `clock`, `coerce`, `dom`, `download`, `errtext`, `profilerank`, `samejson`, `spectroraster`, `units`, `volume`, `wav`); D-04 and AC1 put `timebase.js` there. Fixing it needs a file moved out of `lib/` with its callers rewritten, outside this plan's lease, or a cap change that is the owner's. Proposal: `filepawl mv` `clipboard.js` (1 importing file) and/or `download.js` (2 importing files) into the existing `hqptuner/static/lib/browser/` (holds `storage.js`), which is where browser-API wrappers already live; one move is enough to reach 15. Other lib files by importing-file count: wav 2, profilerank 3, volume 3, samejson 4, apodscale 5, spectroraster 7, binaural-setup 8, units 9, errtext 11, clock 20, api 28, coerce 50, dom 198. The move needs the paths added to the plan's lease.
- Pre-commit `suite wall time against its bar` fails: `suite 43.3s, bar 37.7s: +5.6s, escalate to owner (--accept)`, with "no bar for this branch yet: judged against .suite-time.v2.json". This change touches no Python; cause not established (candidate: first run on a branch with no bar, or load on the host). It is the owner's `--accept`, not mine; I did not run it.
- Every task's last Verify item is `bash .claude/task-check.sh` (Task 1 item 5, Task 2 item 4, Tasks 3 and 4 item 3). It writes the rebuild trigger to `/home/atom/dev/hqptuner2/state/rebuild.request` (outside this worktree) and rebuilds the `hqptuner:dev` container, so I did not run it; it also needs the main tree's `make check` environment. It has to run from the main session after merge.
- Worktree environment: the new worktree has no `.venv` and an empty `hqptuner/static/vendor/eqlab` (submodule not initialized), so gates fail here until set up. I symlinked `node_modules` and `.venv` to the main tree's (both gitignored) and copied `core/`, `src/` and `package.json` of the main tree's eqlab into the worktree's empty eqlab directory (git ignores it, an attempted symlink broke git and was undone). Pre-commit then ran: python gates, eslint, prettier, tsc (both), knip, jscpd, doc-refs all green except the two above.
- Declined shape: `MS_PER_S`, `US_PER_S` and `usToMs`/`sToMs` helpers are not in `timebase.js` yet; Verify of Task 1 needs only the samples conversion and the readers, and knip would flag an unused export. Tasks 2 to 4 add what they use.
