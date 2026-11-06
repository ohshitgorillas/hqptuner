PLAN CHECKPOINT: structural

Plan: .planning/phases/2/PLAN-7.md

Tasks: 0 of 3

| Task | Commit | Note |
|---|---|---|
| 1 Audit the phase's commits | none | `baseline/audit.md` written, uncommitted (verify not met). Open routes 0, AC4 unmatched 0, AC6 hits 0, AC3 hits 1: `tests/js/store/live/polling.test.js:156` `matrixConfig.value = { fields: [], active: "Kept" };`, asserted at line 158 as `matrixConfig.value.active`. Task 1 verify says stop and return it. |
| 2 Run the exit check | none | not started (stopped at Task 1, per the plan's precondition) |
| 3 Full-suite regression check | none | not started; the full suite was not run in this dispatch |

Deviations: [deviation] PLAN-7 Task 1 Verify expected zero AC3 hits; observed one, `polling.test.js:156` carries the retired `active` key. Plan 5 and Plan 6 both lease `polling.test.js`, neither migrated that sentinel. Plan 7 writes no file under `tests/js/`, so nothing was changed. Stopped.

Open items:

- AC3 hit above. The claim (`test_a_failed_matrix_fetch_keeps_the_last_good_form`) is valid: `refreshConfig` still mirrors `/api/matrix` into `matrixConfig` (`hqptuner/static/store/sync.js:105`). Fixing the sentinel changes the assert line `assert.equal(matrixConfig.value.active, "Kept")`, so it takes the repair route only if the assert stays byte-identical (impossible while the sentinel is `active`) or the contract-mismatch route with quotations. The owner or a plan revision decides.
- Near-misses outside AC3's letter: `live_profiles` and `live_active` keys assigned to `matrixConfig.value` (`sdm-hide-superseded.test.js:365`, the `matrixTree` builders of `store/faceplate-builders/profile.test.js:138`, `components/faceplate-builders/profile.test.js:121,123`, `profile-steps.test.js:93`). No production line reads a `live_*` key. Not counted as hits.
- cb5d5d42's `Contract mismatch:` line is one sentence with no document quotation; `polling.test.js` is not in `files.txt`, so the AC4 per-path check does not reach it.
- Task 2's importer set needs five support files beyond Context's nine: `easy/easyrate.js`, `rendered/filter-fields.js`, `wire/livepresetwire.js`, `wire/unreadwire.js`, `wire/wire.js` (listed by `git diff --name-only BASE HEAD -- tests/js/support`).
- No hook skipped. Nothing committed. `uv.lock`, `.planning/reads.jsonl`, `STATE.md`, `reports/`, `baseline/failures.log` not staged.
