PLAN CHECKPOINT: suite-red

Plan: .planning/phases/2/PLAN-6.md

Tasks: 4 of 4 committed; the full suite is red with 11 failures outside `failures.log`, all caused by Task 4

| Task | Commit | Note |
|---|---|---|
| 1 Delete retired C1/C2/C3 cases | ceb112e9 | 24 routed cases minus one kept (see Deviations), plus 2 previewed-silences cases. `hardware-catalog.test.js` deleted whole (both loops were C2). File run over the five remaining files: 28 pass, 3 fail (2 B1, the 1 kept case). Assert check: no added `assert` or `test(` line. `make lint-js` exit=0 |
| 2 Remove dead `previewConfig` | 2599896b | `grep -rn previewConfig hqptuner/static tests/js` finds nothing. `previewPreset` keeps its `await api.preset(name)` call with the result unassigned. `make lint-js` exit=0. Full suite not run at this task, per the executor contract (one run per dispatch) |
| 3 B1 shaper-fit name lookup | b68825fd | `shaperName` reads `field(key).value.name` first, then the form option list for a staged or file-shown value. The four named files, unchanged: exit=0, 54 pass, 0 fail. `make lint-js` exit=0 |
| 4 B2 re-mirror a held write | 89a46b88 | `refreshConfig` now calls `safe(refreshReadings)` instead of mirroring `api.config` into the `config` signal. `live-reenum.test.js`, unchanged: exit=0, 9 pass, 0 fail. `make lint-js` exit=0 |

Full suite: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test --test-concurrency=8 <three globs>`, log `/tmp/gate-node-qendoeNR.log`: 4885 tests, 4873 pass, 12 fail. One of the 12 is the kept case (in `failures.log`). The other 11 are not in `failures.log` (compared by title against its 195 `not ok` lines). Before Task 4 the same names passed: the accidental run below, after Tasks 1 and 2, had 17 failures, all in `failures.log`.

The 11 regressions, all from `refreshConfig` now adopting the `/api/config` answer as `readings.value`, while the fakes still serve the retired `{ data: {...} }` body:

- `tests/js/components/faceplate-alerts/plate-unread.test.js`: 8 cases (`a_failed_apply`, `a_failed_snapshot_apply`, `a_failed_snapshot_list`, `a_live_write_hqplayer_refused`, `a_live_write_that_threw` shows one warning line; tapping the line for the first three raised). Error: `Cannot read properties of undefined (reading 'active_preset')` at `hqptuner/static/store/resolve.js:74`, reached from `readings.js:136` through `sync.js` `safe`. The wire is `tests/js/support/wire/unreadwire.js:130`, `"/api/config": () => ok({ data: CONFIG() })`.
- `tests/js/store/live/polling.test.js`: `test_the_next_successful_fetch_replaces_the_held_snapshot` (line 162) and `test_refresh_devices_repulls_the_config_forms` (line 212). Both serve `ok({ data: { fields: [], file: {}, active: "Fresh" } })` and assert the retired `config` signal mirror.
- `tests/js/components/faceplate-settings/about-state-import.test.js:219`: `test_a_landed_import_reads_the_station_list_again_from_the_server`. Its wire serves `ok({ data: offering(serverStations) })` at line 86.

Deviations:

- [deviation] Task 1: the plan and `routes.md` route `test_leaving_a_hazard_and_reaching_it_again_asks_again_at_edit_time` (applyguard) as C1 and count it among the 24 to delete. It is not a preview case. It fails with `direct_sdm is not staged: effective() reads false, not false` because it calls `stageQuietly(w, "direct_sdm", false)` and `edit` stages the string `"false"`, which the staging fake does not reconcile against the checkbox domain `"1"`/`"0"`. The claim (an acknowledgement lapses when the hazard leaves the staged picture) is valid. It is wrong test machinery (a repair), not a retired claim. I did not delete it. It stays red, as it is in `failures.log`, and needs a lead-authored repair in a later plan.
- [deviation] Task 1: the Action names 24 cases; I deleted `test_a_previewed_sdm_preset_silences_the_pcm_conflict` and `test_a_previewed_pcm_preset_silences_the_sdm_conflict` as well. They share the `previewMode` seam with the three routed previewed cases, which wrote `previewConfig`; they passed only vacuously (empty alert list) and the `previewConfig` grep requirement could not hold with them kept. Net deletions: 12 of the 13 C1 cases, plus those 2, 7 C2 and 4 C3 (hardware-catalog's 6 are two template loops).
- [deviation] Task 2 and the Plan 6 "full-suite run shows no failing test outside `failures.log`" lines: Task 4's Action ("make the refresh adopt the served answer", "remove the retired `.data` mirroring") cannot meet that criterion inside the lease. The 11 tests above are passing baseline tests whose wire serves the retired body, so the adoption crashes them. They need a repair of `unreadwire.js`, `polling.test.js` and `about-state-import.test.js`, which are outside the lease.
- [deviation] Footprint: in Task 2 a malformed `grep` under zsh expanded to an empty file list and `node --test` ran the entire suite (5908 tests) at default concurrency, once, for under a minute. No process of mine remains (checked with `ps`). It was not used as the dispatch's full-suite run; the controlled `--test-concurrency=8` run above is.

Open items:

- Repair needed outside the lease for the 11 tests above: `tests/js/support/wire/unreadwire.js` (serve `/api/config` as a readings body), `tests/js/store/live/polling.test.js` (its config-mirror claims and `{ data: ... }` bodies), `tests/js/components/faceplate-settings/about-state-import.test.js` (`{ data: offering(...) }` body). Whether polling's `config` mirror claims are retired (contract-mismatch) or only mis-served is the owner's call.
- `sync.js` `ROUTES` still pushes `["config", config, data]`: the push body is the readings, which has no `data`. I left it; it is retired mirroring that no test or caller of this plan names.
- `previewPreset` in `actions.js` still calls `api.preset(name)` and discards the answer, and its docstring still says it loads the preset's values as the editor's baseline. Both are stale under the C1 ruling. Left unchanged (no behavior change; comment is the owner's wording to settle).
- The three remaining applyguard "no question" cases are all that is left in that suite: no case now proves an apply-time question opens. Retired with C1.
- Declined: a fallback-free `shaperName` (served name only). A staged or file-shown modulator is a form enum ID and has no served engine name, so the option-list match stays as the second step.
