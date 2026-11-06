PLAN CHECKPOINT: structural

Plan: .planning/phases/2/PLAN-5.md

Tasks: 2 of 6

| Task | Commit | Note |
|---|---|---|
| 1 Failing guard suites | 0ef73a19 | integrate. 53 pass, 9 fail over the four files (`/tmp/gate-node-P5mTpReF.log`). directsdmwarn 6 R2, sdm-hide-superseded 2 R2, xfmode 6 R2/R8 green. applyguard: seeds moved, its 9 previewed-preset cases stay red (Contract mismatch C1, unresolved Q1; failing line now `direct_sdm is not staged: effective() reads false, not 1`). lint-js exit=0, assert check clean against 082346ff, AC3 clean |
| 2 Failing catalog and pipeline store suites | 8003bc16 | integrate. 17 pass, 11 fail over the five files (`/tmp/gate-node-NMuQTNhG.log`; the commit message says 18 pass, which is wrong by one). loudness-applied 9 R2 and fixed-volume-readings 1 R2 green; hardware-catalog 6 stay red (C2, unresolved Q2); structural-roundtrip 4 and pipeline-baseline 1 were red |
| 2 (remainder) stagingWire reconciles its answers | 007f8762 | integrate, `tests/js/support/wire/wire.js` only (lease extension, see Deviations). Stage and GET pending now answer the buffer reconciled against the served GET /api/config readings, the stored payload untouched. Full JS suite (all 334 test files, `--test-concurrency=4`, ~10 s) before: 4910 tests, 51 fail (`/tmp/gate-node-BWEMGlGZ.log`); after: 50 fail (`/tmp/gate-node-c9QmWIf8.log` is the first variant, final variant 50 too); fixed `pipeline-baseline` `test_staging_the_daemon_rows_of_a_live_active_profile_reads_clean`; no test that passed before fails after. lint-js exit=0 (`/tmp/gate-make-wU6E7lmc.log`). The 4 structural-roundtrip cases stay red |

Deviations:

- [deviation] Lease extended with `tests/js/support/wire/wire.js` on the orchestrator's instruction (checkpoint outcome option (a)).
- [deviation] The checkpoint outcome asserted that the server drops a staged entry its destination holds, and that making `stagingWire` do so passes the 4 `structural-roundtrip.test.js` cases and `pipeline-baseline` `reads_clean` with assertions unchanged. Reality: `hqptuner/core/pending.py` `reconcile` (line 190) docstring "Return dirty fields for display, preserving the complete staged write payload" and `clean_pending` (line 90) reconcile only the ANSWER; the stored buffer keeps the entry (only a client `drop` removes it, `PendingStore.drop`, and the client sends none since 80a8bde0). `docs/spec/api.md:33` likewise speaks of the `staged` reading, not the buffer. Modeling that faithfully fixes `pipeline-baseline` `reads_clean` (it reads `stagedCount` from the echo) and leaves the 4 structural-roundtrip cases red, because they assert `W.staged.http` (the stored buffer) holds nothing clean. Building option (a) literally (prune the stored buffer) was tried and passes the 4 cases but regresses `structural-roundtrip.test.js` `test_under_a_preview_an_edit_matching_the_running_config_is_not_dropped` (green at baseline; it asserts the buffer keeps `volume_max` "-3" equal to the running engine value, and the wire cannot tell a previewed state, which is client-only) and, in an earlier variant, a race in `drawers-loudness` (my own bug, fixed). Pruning is therefore not the server's behavior and not consistent with that baseline-green test, so I did not commit it.

Open items:

- structural-roundtrip.test.js, 4 cases (`test_an_edit_returned_to_its_baseline_leaves_nothing_in_the_server_buffer`, `test_pipelines_staged_back_to_their_baseline_rows_leave_nothing_in_the_server_buffer`, `test_editing_one_field_clears_an_unrelated_field_that_has_gone_clean`, `test_a_checkbox_toggled_off_and_back_on_leaves_nothing_in_the_server_buffer`): Contract mismatch, unresolved. They claim the server's stored buffer prunes clean entries; the server preserves the payload and the client no longer sends `drop`. Owner decision needed; routes.md:383-386 says `repair`, which does not hold.
- The same cause may make `structural-roundtrip` `test_under_a_preview_an_edit_matching_the_running_config_is_not_dropped` vacuous: it asserts a preview-grounded baseline that the rebuilt client no longer has (preview is client-only state).
- applyguard.test.js, 9 cases: Contract mismatch C1, unresolved, owner question Q1.
- hardware-catalog.test.js, 6 cases: Contract mismatch C2, unresolved, owner question Q2.
- Declined: reconciling `live` lane entries in the fake. Mapping `live` keys and args to readings needs the control catalog, and none of the 5 target cases stages through that lane.
- Tasks 3 to 6 not started (stopped at the checkpoint).
- The assert check and AC3 check were not run on `wire.js`: it is machinery, not a test file with claims.
