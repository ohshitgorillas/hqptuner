PLAN CHECKPOINT: structural

- Plan: .planning/phases/7/PLAN-3.md
- Tasks: 2 of 5

| Task | Commit | Note |
|---|---|---|
| 1 - The VU needle moves on dt in ms | 376f17a8 | vu.js constants per ms; sourcepaint converts once through secondsToMs; vu.test.js red (5 fail) before the change |
| 2 - The meter steps and the flames move on dt in ms | a6b0ee73 | steps.js constants restated per ms (STEP_PER_MS, *_MS, *_PER_MS, *_PER_MS2), STEP_SLACK kept; stepFlames doc; three painters convert once through secondsToMs; steps.test.js and fire.test.js red (17 AssertionErrors) before the change; committed with `SKIP=filepawl` under the owner's red-commit override, see Open items |

Deviations:

- [deviation] Task 1 Verify (1) expected vu.test.js and vu-motion.test.js both red against HEAD vu.js; observed vu-motion.test.js green (3 pass). Its cases compare late-paint against steady-paint motion after a 3000 ms history; with ms handed to a seconds model every needle is fully settled both ways, so the invariant holds whatever the unit. Left as is: the task's testing scope allows no new case.
- [deviation] Task 2 Verify (1) expected meter-math.test.js red against HEAD; it has no time input at all (its header says the model hands it no dt, clock or wall time), so there is nothing to move and nothing to fail. Left unchanged.
- [deviation] Verify (4) `bash .claude/task-check.sh` cannot pass: `make check` stops at test-js on the 12 baseline-red playhead tests (5646 tests, 5634 pass, 12 fail, identical to the AC7 baseline, both after Task 1 and Task 2). Nothing else in make check failed except the filepawl line below; the rebuild step was not reached.

Open items:

- Task 2: `filepawl check` prints `spectrumfx.js: grew past allowance (497 > 496); split it`. The one added line is the transient `secondsToMs` import the painter needs while it is still handed seconds; Task 3 removes it and the file returns to 496. Committed with `SKIP=filepawl` under the CLAUDE.md red-commit override for the v2 refactor; no allowance was accepted or edited. Re-check `filepawl check` after Task 3.
- Task 3 not started, tree clean of its edits. It needs a seconds conversion from ms for the aurora's vendor `time` uniform "through the time base" and `hqptuner/static/lib/timebase.js` has none (it exports `samplesToMs`, `usToMs`, `secondsToMs`, `secondsToUs`, `startOf`, `endOf`, and `MS_PER_S`, which Task 3's grep forbids in components). The file and `tests/js/lib/timebase.test.js` are outside the plan's 22-file lease, so `lease-check` would refuse the commit. Proposed: add `msToSeconds(ms)` to `lib/timebase.js` (one division by `MS_PER_S`) with one case in `tests/js/lib/timebase.test.js`, both added to the lease. Alternative declined: `sway / secondsToMs(1)` in `aurora.js`, which passes the grep but spells a conversion backwards through the wrong function.
