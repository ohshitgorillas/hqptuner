PLAN COMPLETE

Plan: /home/atom/dev/hqptuner2/.planning/phases/7/PLAN-12.md

Tasks: 3 of 3

| Task | Commit | Note |
|---|---|---|
| 1 - The Output drawer suites share one rig | c00f2a1b | 21 non-import clones gone; one rig in `tests/js/support/rendered/outputdrawer.js`, `fire`, `within`, `rowHolding`, `drawerTree`, `configRoute` in `drawer-render.js`. Per-file test counts equal baseline (12 files). `make lint-js` green. `served1` read against rule 13: tables plus staged plumb-through, merged as is. Stays: pin~pin-glass import list. |
| 2 - The drawer family suites share their homes, loaders and staged rows | 3921dc07 | 4 clones gone (homes cases, crossfeed load, drawer store reset, staged rows); per-file counts equal baseline (8 files, 98 tests, same names). `make lint-js` green. |
| 3 - The remaining drawer suites share their fakes and renderers | 24b83528 | Running-chain reading to `readings.js`; `pixelCanvas`, `GLASS`, `TOKENS` and the source meter opening to `contracts/picture.js`; `tapUnlitOption` to `drawer-render.js` and the reset to `resetDrawerStore({})`; `holdSpeakersWrite` to `speakersform.js`; `seedVolume` to `volume-range.js`; engine-rows and visual call `tapFieldOption`; the two `drawers-volume-range` self-clones became tables of cases with every test name kept. Per-file counts equal baseline (14 files, 291 tests, same names), `spectrogram-picture` 72 and `spectrogram-columns` 2 unchanged. `make lint-js` green. Stays: hf-schema against engine-rows and logging, an import list. |

Deviations: none

Open items:

- Final suite, run by the coordinator on 85f0882a (the merge of this plan; the one commit since, 3b987f46, edits PLAN-1.md and PLAN-9.md only), log /tmp/gate-make-A0hNEUjl.log, read and checked by this continuation without a second run: ruff `All checks passed!`; mypy `Success: no issues found in 567 source files`; pytest `3676 passed, 162 deselected`; suite-time bar `[ok] suite 38.5s, bar 37.7s (+0.8s)`; `test-js` ends `# tests 5633`, `# pass 5621`, `# fail 12`. The 12 `not ok` lines are all in `tests/js/model/gauges/playhead-lag.test.js` (8), `playhead-motion.test.js` (3) and `playhead-scroll.test.js` (1), for example `test_a_start_stands_one_delay_behind_the_line_when_the_paint_ran_9_ms_after_the_arrival`. They are the phase baseline at 503ddec8 (phase 8's tables, outside this plan's lease), not a regression of this plan; `git diff 503ddec8 HEAD` on the three files is empty. No repair round, per the dispatch. Status is COMPLETE on that basis: the only red is the baseline red the phase names.
- Clones with a side in a drawer suite that this plan's lease does not reach, left for the plans that own them: `tests/js/components/faceplate/switcher.test.js` against `tests/js/support/rendered/treewalk.js` (`kids`, plan 13 lists both), `tests/js/store/faceplate/drawer-grammar.test.js` against `drawer.test.js` (plan 14). `tests/js/store/faceplate/drawers-volume.test.js` against `volume-range.js`, which plan 14 owns, no longer reports after `seedVolume`; plan 14 can call `seedVolume` for it.
- Import-list clones that stay, as the plan names them: `drawers-output-pin.test.js` against `drawers-output-pin-glass.test.js`, `drawers-hf-schema.test.js` against `engine-rows.test.js` and `logging.test.js`.
- Lean choices: `treewalk.js` and `support/page/canvas.js` are in the lease and untouched, because `tapFieldOption` already in `drawer-render.js` removed the tree finder copies and `pixelCanvas` merged into `contracts/picture.js`. The Output rig derives each `/config` form from the readings it seeds, by a name-to-type table, instead of repeating four field lists.
- Environment, none of it committed: `node_modules` and `.venv` are symlinks to the main tree, and `hqptuner/static/vendor/eqlab` was filled by copy; commits need `PYTHONPATH` set to the worktree. Pre-commit's suite-time gate failed once on task 1's first commit attempt (suite 43.4s, bar 37.7s, +5.7s) on a loaded host and passed on the retry with nothing changed; the failing run is the Python suite, which these JS-only commits do not touch.
