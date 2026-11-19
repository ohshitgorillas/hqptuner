PLAN CHECKPOINT: structural

Plan: /home/atom/dev/hqptuner2/.planning/phases/7/PLAN-13.md

Tasks: 1 of 7

| Task | Commit | Note |
|---|---|---|
| 1 - The builder suites share their wire, readings and staged rows | e86e59a9 | 16 clones gone; wire, enumerations, form, overlay and Headphones book in `tests/js/support/rendered/builderwire.js`; Bauer/DAC lists, config form, File values, served readings and fresh-builder reset in `profile-fixtures.js`; two live-cell cases share `liveDiffs`. Per-file case names and ok/not-ok equal baseline (8 files plus 5 other consumers of profile-fixtures). `make lint-js` green. `pendingOf` read against rule 13: only plumbs (table plus server-style equal-to-File drop), shared as is; in the commit message. |

Deviations: none (the checkpoint below is a lease and gate conflict, not a changed criterion)

Open items:

- CHECKPOINT structural, at task 2. `tests/js/support/` holds 30 files, the filepawl cap (`.venv/bin/filepawl check`: `tests/js/support: 31 files, cap 30` with `controls.js` added, so the pre-commit `filepawl tree gate` refuses the commit). The plan's `files:` list names six NEW top-level modules there: `controls.js`, `alerts.js`, `pagefixtures.js`, `aboutstate.js`, `connpanel.js`, `switcherwire.js` (`listsfixture.js` and `page.js` already exist). None can land at that path. Cap is not an allowance matter (`filepawl accept` does not apply: the directory is at the cap, not a file under watch).
- Placing `controls.js` under an existing subdirectory fails the lease: `lease-check` with `tests/js/support/rendered/controls.js` staged returns `{"ok":false,"reason":"undeclared-files","undeclared":["tests/js/support/rendered/controls.js"]}`. Task 1 was unaffected because its new module is `tests/js/support/rendered/builderwire.js`, which the lease names.
- Proposed fix for the orchestrator: amend PLAN-13 `files:` so the six new modules sit in a subdirectory (for example `tests/js/support/rendered/` for `controls.js`, `alerts.js`, `connpanel.js`, `switcherwire.js`, and `tests/js/support/lists/` or the same dir for `pagefixtures.js`, `aboutstate.js`), then re-dispatch from task 2.
- Task 2 is DONE IN THE WORKING TREE, NOT COMMITTED, nothing staged: `tests/js/support/controls.js` (new, to be moved to the chosen subdirectory with its three relative imports and the three suites' import paths adjusted), `tests/js/components/faceplate-controls/{numbox,select,slider}.test.js`. State: per-file case names and ok/not-ok equal baseline (77 lines, 0 not ok), jscpd reports no clone with a side in the controls suites, `make lint-js` exit 0. Only the move and the commit remain.
- Baseline captured for the rest of the plan under `/tmp/c13/` (`t<N>.base`, `base.txt`); not committed.
