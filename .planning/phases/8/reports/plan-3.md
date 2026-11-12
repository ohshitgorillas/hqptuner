PLAN COMPLETE

Plan: .planning/phases/8/PLAN-3.md

Tasks: 3 of 3

| Task | Commit | Note |
|---|---|---|
| 1 - A Control API attribute value containing `"` is refused | c8de972d | `AttributeValueRefusedError` (code `invalid_input`) raised in `ControlClient.send` before any byte is written; values otherwise sent raw. `.filepawl.toml` control.py allowance 404 to 409 on the owner's approval via the coordinator. Bite: characterization green, three refusal cases red before. |
| 2 - POST /api/volume refuses a level that is not a number | 0129d2f7 | `writer.not_a_number` public, shared by `_malformed` and `volume_set`; refusal `VolumeLevelRefusedError` (invalid_input). Bite: `abc` cases red before. |
| 3 - A profile switch names only a profile the daemon lists | 00869dfd | `matrixlane.UnknownProfileError` (invalid_input) after a fresh `get_matrix_profiles()`; empty name skips the read; `docs/matrix-spec.md` sentence rewritten. Bite: `Ghost` cases red before; listed-name and empty-name cases green before and after. |

Deviations: [deviation] Task 2 Verify asserted both `-3"/><Stop/` and `abc` red against the commit before; Task 1 (already committed) refuses any `"` value inside `ControlClient.send`, so the quote case was already green at Task 2's start (refused as invalid_input, no Volume sent); only `abc` was red. The route check still covers it earlier.
Open items: No CHANGELOG.md edit in any task: Plan 1 Notes (owner ruling 2026-11-11) put the phase's single Security bullet in Plan 1 Task 1 and say other Changelog-marked tasks add none; `check_changelog.py` printed ok. New user-facing strings for owner review (refusal copy delegated, Plan 1 Notes): hqptuner/engine/controlerrors.py `AttributeValueRefusedError`: "HQPTuner did not send {element}: its {attribute} value contains a double quote." (reaches the UI through any setter route's ControlError path); hqptuner/api/routes/volume.py `volume_set`: the writer's reason "could not convert string to float: '<level>'" reused unchanged; hqptuner/lanes/matrixlane.py `UnknownProfileError`: "HQPlayer has no matrix profile named {name}." (UI shows it on a profile switch). A docstring line added to `volume_set` was dropped because it changes docs/openapi.json. Pre-commit's test-assertion gate and comment judge caught issues `make check` did not (absent-value-only assertion; negation-narration docstring); both fixed in Task 1's commit. Full suite: `make test` (workflow.test_command is null; the Makefile target is the offline suite) exit=0, 99.3s. A first attempt with a bare `pytest -m "not live"` also collected the e2e lane and errored on missing browser fixtures; it is the wrong selector, not a regression.
