PLAN COMPLETE

Owner accepted on 2026-11-05: the executor returned `PLAN CHECKPOINT: suite-red`. The full JS run shows 193 failures of 4904 against the 195-failure baseline, with 0 new failures. Every remaining failure is leased to Plans 3, 4 or 5.

Plan: .planning/phases/2/PLAN-1.md

Tasks: 7 of 7

| Task | Commit | Note |
|---|---|---|
| 1 Capture fresh baseline | 14dd1427 | hqptuner2 v2. BASE 082346ff; 195 fail of 4904 in 53 files; `unleased:` empty. failures.log left untracked. Committed with SKIP=pytest-offline,fresh-reports,coverage-floor (v2 Python suite does not import: LaneManager) under the red-commit override |
| 2 Route every failure | 4c93ecb6 | hqptuner2 v2. routes.md: 195 entries, 160 repair, 15 builder (store/alerts/shaperfit.js shaperName), 20 contract-mismatch unresolved (Q1 preview grounding, Q2 catalog rows of daemon forms). Same SKIP list |
| 3 field-harness | 45f5e359 | integrate. 6 importers pass (42/42); lint-js exit=0; assert check clean |
| 4 profile-fixtures | 85e32cbd | integrate. 8 importers pass (197/197); lint-js exit=0; grep for file/active/rows prints nothing |
| 5 easy helpers | 522c0334 | integrate. 6 files pass (370/370), store/faceplate-page/presets.test.js:254 now passes; lint-js exit=0 |
| 6 shaperfit-fixtures | none | No change. routes.md helper section: "`tests/js/support/shaperfit-fixtures.js` (8 importers): blamed for no failure." Its importer failures are builder (B1) or contract-mismatch (C1) |
| 7 pipelines-fixture | 5ef99f79 | integrate. drawers-pipelines-schema.test.js and drawers-pipelines.test.js pass (7/7); lint-js exit=0 |

Final suite (full JS run, same command as Task 1, concurrency 8; workflow.test_command is null and `make test-js` carries Phase 4 coverage thresholds): `# fail 193`, `# pass 4711` of 4904. Fixed vs baseline: exactly the two helper-blamed tests. New failures: none. The 193 left are routed in routes.md to later plans, the builder entries and the owner questions. No repair round: the red is the planned baseline, and curing it needs files outside this plan's lease.

Deviations: none

Open items:

- failures.log (1 MB) untracked at .planning/phases/2/baseline/failures.log; whether it is committed is the orchestrator's call.
- 20 contract-mismatch entries are `unresolved` and need an owner answer. Q1: does a previewed preset still change the values a control shows before Apply (previewConfig is written at store/actions.js:188 and read nowhere since 38b7e28e). Q2: do hardware and speakers catalog rows read their daemon form through field() or through the form's own store.
- 15 builder entries (shaperfit alerts) need a production-fix plan on hqptuner/static/store/alerts/shaperfit.js; a scratch check outside the repo showed a name-first lookup passes all 15 with tests untouched (plan Notes: runs after Plan 5, before Plan 6).
- The conn/knob tests drive `applying`/`engineBusy`, which `connState` no longer reads (R6). Separately, About.js restore runs `duringEngineWrite` outside any engine op, so the knob never reads busy during a restore; no failing test covers it.
- Scratch copy /tmp/p2exp (tests, hqptuner, node_modules symlink) could not be removed: `rm -rf` is blocked on this host. It is outside the repo and holds no process; it needs deleting by the owner or by a `rm -r` the hook allows.
- Declined: no new test and no `configPayload` deletion (easytiles still calls it).
