PLAN COMPLETE

Plan: /home/atom/dev/hqptuner2/.planning/phases/5/PLAN-6.md

Tasks: 6 of 6

| Task | Commit | Note |
|---|---|---|
| 1 Pin family apply group unlit before an edit | 1e1a1958 | drawerHead `applyPaint(restart, true)` red on deepEqual [true,true] vs [false,true]; family() `hasDirty: () => true` red likewise (the family-only break was not caught by any existing test) |
| 2 DAC correction edit lights Matrix engine drawer's discard | none (already covered) | dropping dac_correction_enabled/_profile from FAMILIES.matrix.keys turns the existing `test_a_staged_dac_correction_edit_lights_the_apply_group_of_a_matrix_family_drawer_with_no_component_loaded` red (fail 1 of 4) and `drawer-family-keys.test.js` `test_every_family_holds_exactly_the_keys_its_member_drawers_hold` red on assertion; rule 12, no duplicate. Coverage cited in 1e1a1958 message |
| 3 Restart row left out by when leaves tab live | 78cf6455 | shownKeys row branch ignoring rowShown: red on deepEqual (fail 1 of 16) |
| 4 Own form's apply not also posting staged set | 234dfcb7 | applyDrawer own apply then runApply(): red on deepEqual [1,1] vs [1,0] (fail 1 of 17) |
| 5 Multi-tab drawer title carries no dot | 5b1d22b0 | titleDot without `tabs.length === 1`: red on deepEqual (fail 1 of 19) |
| 6 Row's question pinned under its own drawer only | 06afeaf2 | drawerQuestion returning every open question: red on deepEqual (fail 1 of 20) |

Full suite: `PYTHONPATH=$(pwd) scripts/gate.sh make check` (workflow.test_command is null, so the Makefile target) exit=0.

Deviations: none

Open items:

- The worktree had no `.venv` and an empty `hqptuner/static/vendor/eqlab` submodule, so pre-commit failed on missing executables on the first commit attempt. I symlinked `.venv` to the main checkout's and copied eqlab's `core/`, `src/` and `package.json` in (all untracked or ignored, no hook touched, no `--no-verify`), and committed with `PYTHONPATH=$(pwd)`. Each commit ran the full pre-commit set, including the offline pytest suite.
- Task 1 used a before/after pair (deepEqual [false, true]) rather than a bare `false`, to satisfy testing rule 10 (a bare false is what an absent feature also produces).
- Fixture changes in drawer-grammar.test.js: `ownForm` takes an optional `apply`; `beforeEach` now routes the apply POST into a record (no assertion line changed).
