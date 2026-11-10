PLAN COMPLETE

Plan: .planning/phases/2/PLAN-6.md

Tasks: 6 of 6

| Task | Commit | Note |
|---|---|---|
| 1 Delete retired C1/C2/C3 cases | ceb112e9 | previous dispatch; see plan-6.1.md |
| 2 Remove dead `previewConfig` | 2599896b | previous dispatch; `grep -rn previewConfig hqptuner/static tests/js` finds nothing |
| 3 B1 shaper-fit name lookup | b68825fd | previous dispatch |
| 4 B2 re-mirror a held write | 89a46b88 | previous dispatch |
| 5a/b Serve readings in the fakes, delete 2 config-mirror cases | 8287314d | `unreadwire.js`, `livepresetwire.js` and the `polling.test.js` default body now serve `{ generation, fields }`. Deleted `test_the_next_successful_fetch_replaces_the_held_snapshot` and `test_refresh_devices_repulls_the_config_forms` with a `Contract mismatch:` line. Pre-commit passed, no hook skipped |
| 5c B3 profiles and device_caps from the readings | 1ee4e55a | `metadataValue` in `store/core/readings.js`; `stations.js` and `devicecaps.js` read it; `signals.js` comment trimmed to `{fields}`. Seeds moved in 11 test and harness files (`about-state-import`, `drawers-output`, `profile-core`, `stations`, `localbackends`, `devicecaps-harness`, both `faceplate-builders/profile`, `rail`, `snapshot`, `header`); `about-state-import.test.js` wire serves the real body. No assert line changed. Bite proof: with the old `stations.js` restored, `stations.test.js` plus `about-state-import.test.js` ran 9 failures, `test_a_landed_import_reads_the_station_list_again_from_the_server` among them (log `/tmp/gate-node-u7NPLRgk.log`); green with the new reader. Pre-commit passed, no hook skipped |
| 5d applyguard kept case | 15bc96b7 | `direct_sdm` seeded and staged as `"0"`; `applyguard.test.js` exit=0; no assert line changed |
| Fix: delete the last config-mirror case | cb5d5d42 | Deleted `test_a_failed_config_fetch_keeps_the_last_good_snapshot` from `polling.test.js`; no fixture or import was used only by it (`config`, `bad`, `refreshConfig` still serve other cases). Commit carries a `Contract mismatch:` line. `polling.test.js` exit=0 (log `/tmp/gate-node-g9bEEEPR.log`); only a removed assert line in the diff, none added or changed; `make lint-js` exit=0 (log `/tmp/gate-make-or0E9Cs2.log`); pre-commit passed, no hook skipped. Full suite not rerun, per the fix dispatch |
| 6 Matrix keep-last-good fixture to D-01 shape | 3e90a616 | `test_a_failed_matrix_fetch_keeps_the_last_good_form` now seeds `{ fields: [{ name: "kept_field" }] }` and asserts `matrixConfig.value` is still that object after a 503 on `/api/matrix`. Name and claim kept; no other case changed. Bite proof: with `mirror` in `store/sync.js` assigning `null` on a failed fetch (local, reverted, `git status` clean of it), the case went red (log `/tmp/gate-node-sawDGjUk.log`); green with the real code (log `/tmp/gate-node-vg9IEDVM.log`, exit=0). `make lint-js` exit=0 (log `/tmp/gate-make-oBFHzFc2.log`). Pre-commit passed, no hook skipped. Only `polling.test.js` staged. Full suite not rerun, per the fix dispatch |

Full suite: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test --test-concurrency=8 tests/js/*/*.test.js tests/js/*/*/*.test.js tests/js/*/*/*/*.test.js`, log `/tmp/gate-node-re6I8Nvz.log`: exit=0, 4883 tests, 4883 pass, 0 fail. `make lint-js` exit=0 before each Task 5 commit. Run once.

Deviations: Tasks 1 to 4 deviations are in plan-6.1.md. The Task 4 suite-red deviation is closed by Task 5a/b. The kept applyguard case from the Task 1 deviation is repaired (5d).

Open items:

- Gate discipline slips this dispatch, my own: one subset `node --test` gate run was sent to `/dev/null` (log `/tmp/gate-node-2C87uYzD.log` kept, run repeated properly), and one subset run was piped into `tail`. Neither was the full suite.
- Fakes still serving `{ data: ... }` that pass (`header.test.js:67`, `remirror.test.js:91`, `mirror.test.js:25`, `polling.test.js` push `config` event) stay for Phase 3, as the plan states.
- From Tasks 1 to 4, still open: `sync.js` `ROUTES` pushes `["config", config, data]`; `previewPreset` in `actions.js` has a stale docstring and discards `api.preset`; the three remaining applyguard "no question" cases leave no case proving an apply-time question opens.
- The `FormField` typedef comment in `applyguard.test.js` still says a checkbox is served as a real bool; `direct_sdm` is now a `"0"`/`"1"` string. Comment left unchanged.
- Task 6: the plan's literal bite ("mirroring disabled") would not turn this case red, since a failed fetch writes nothing either way; the bite used was a `mirror` that nulls the signal on failure. One first subset run of `polling.test.js` was piped into `tail` (my slip; the run was repeated properly, log `/tmp/gate-node-vg9IEDVM.log`).
- Task 6: a loose search `(config|matrixConfig)\.value = .*(file|active|rows)\b` under `tests/js/` still hits `tests/js/store/faceplate-page/profile.test.js:120`: `matrixConfig.value = { ...form(["Lounge"], "Lounge"), file_profiles: { Desk: { rows: [] } } }`. It carries `file_profiles` with a nested `rows`, not a top-level `file`, `active` or `rows` key. Left unchanged (outside Task 6 and "change no other case"); owner to judge.
- Hooks skipped: none. Untracked `uv.lock` and `.planning/reads.jsonl` were not staged.
