PLAN COMPLETE

Plan: .planning/phases/1/PLAN.md

Tasks: 9 of 9

| Task | Commit | Note |
|---|---|---|
| 1 Measure junkcal at the per-file floor | ec8073f4 | omit removed; junkcal 100% lines/branches (94 stmts, 14 branches) |
| 2 audit_narrow branch gaps | a2cb5d2f | 15 missing branches closed by tests, none removed |
| 3 routing branch gaps | 00dbca11 | 7 missing branches closed by tests (tests/apply/test_live_routing_refusals.py), none removed |
| 4 metadata_json branch gaps | a5b4387c | 7 missing branches closed by tests, none removed |
| 5 restore branch gaps | 74351375 | 5 closed by tests (tests/apply/test_restore_edges.py, one new fake knob _truncated_backup); 1 removed as unreachable (the declined-is-None leg after a mid-pass AuthRefused); restore.py num_branches 30 to 28 |
| 6 formparse branch gaps | a933957e | 6 missing branches closed by tests in tests/apply/test_form_parse.py, none removed |
| 7 Track the coverage report check | a2d687ff | template copied byte for byte (cmp 0), .gitignore negation; command 2 exits 0 on the report (lines 97.48, branches 93.12) and exits 1 on a copy lowered to 88.95% branches; junkcal in report files; branches 1449/1556 = 93.12% |
| 8 Coverage commands in the CI check job | 27f4de0a | three steps after make check; test-policy check ok:true; check step index 4 below steps 5, 6, 7; git ls-files .github/cadence lists both files |
| 9 Fix pass: policy include/exclude type check | 323cb3e4 | review finding (low): coverage-report-check.mjs now fails `policy: <path> is not a usable coverage policy: include|exclude must be an array of strings`, exit 1, when either key is present and not an array of strings. No test home exists for the .mjs (tests/js globs cover hqptuner assets; the plan lease names no test file), so verified by scratch-dir malformed policies against the real .coverage.json. BEFORE: include="hqptuner/**" -> `TypeError: include.map is not a function or its return value is not iterable`; include=null -> `TypeError: Cannot read properties of null (reading 'length')`; exclude="tests/**" -> `TypeError: exclude.map is not a function`; include=5 and include=["a",1] -> silent pass (lines 97.49% meets 95, branches 93.19% meets 90). AFTER: all five print the one FAIL line above, exit 1; valid include=["hqptuner/**"] and the real policy exit 0 (lines 97.49, branches 93.19). make check exit=0 via scripts/gate.sh. |

Deviations: none

Open items: Task 1 plan said clock.py has no wall-time reading and one must be added; Clock.now (and VirtualClock.now) already exist, so clock.py and tests/engine/test_clock.py are untouched and junkcal._build_row now takes mgr.clock.now().

Open items: hqptuner/conf/presetconf.py `_profile_to_materialize` is a near-twin of the restore `_active_profile` (delete-the-active-profile rule), already covered by tests/matrix/test_profile_materialize.py; left alone, outside the lease and not a coverage gap.

Open items: Task 7 Verify said `git check-ignore -v` exits 1; with -v it exits 0 and prints the negation rule that matched, while plain `git check-ignore` exits 1. The file is not ignored (git add took it).

Open items: AC7 (all seven required jobs green on the phase's last dev commit) waits on the owner's push. Task 1's pyproject.toml edit is in the pushed range, so a push of the whole phase touches a release.yml path filter.

Open items: new tests are characterization of existing behavior, so exempt from docs/testing.md rule 8's red run. Spot mutations confirmed the junkcal tests bite (gap comparison and key-change check each turned tests red).
