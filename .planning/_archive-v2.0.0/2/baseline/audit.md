# Phase 2 exit audit

Status: Task 1 verify met for its four counted sections: open routes 0, AC3 literal hits 0, unmatched assert-line changes 0 in the 53 `files.txt` paths, AC6 hits 0. Two items are named for the owner, not counted as hits (sections 2 and 3). Audited at `rebuild/integrate` HEAD `3e90a6169f76248cbfe6069c307ea495d06d21a8`, BASE `082346ffcc11303f511bbade18aa6b0f9367370b`, 46 commits in `BASE..HEAD` (`git rev-list --count BASE..HEAD`). All commands run in `.claude/worktrees/integrate`. Scratch outputs are under `/tmp/p2audit/`. This audit supersedes the one taken at `cb5d5d42`; the only commit since is `3e90a616`.

## 1. Open routes

Command: `git log --format='%h %s' -i --grep='Contract mismatch' --grep='Builder route' BASE..HEAD`, plus every `builder` entry of `routes.md`, plus the B3 owner ruling (PLAN-6 Task 5). Result: zero open. The grep lists the same 10 commits as at `cb5d5d42`; `3e90a616` carries neither phrase.

Revert pairs, net zero. Checked with `git diff <orig> <orig>^ | git patch-id --stable` against `git diff <revert>^ <revert> | git patch-id --stable`; all four match:

- 44b29c4d reverted by 42b2711c
- ad7d5898 reverted by 9dd5a635
- 3b07d12b reverted by 4351acd0
- 9e507177 reverted by cc72db07

Their content is redone by 1ee4e55a (44b29c4d), 8287314d (ad7d5898 and 9e507177), 15bc96b7 (3b07d12b). The `Contract mismatch:` text of 9e507177 is counted once, under 8287314d and cb5d5d42 below.

Builder routes, each closed by a `hqptuner/static/` fix whose failing tests are unchanged in that commit:

| Route | Closed by | Production path | Test files in the commit |
|---|---|---|---|
| B1 (15 tests, shaper-fit name) | b68825fd | `store/alerts/shaperfit.js` | none (1 file changed) |
| B2 `test_a_held_write_shows_the_held_value_on_the_dormant_control` (the one `Builder route:` line, in 23ab52b1) | 89a46b88 | `store/sync.js` | none (1 file changed) |
| B3 owner ruling 2026-11-06 (station list, device caps), recorded in PLAN-6 Task 5 and the D-01 annotation in CONTEXT.md | 1ee4e55a | `store/core/readings.js`, `store/faceplate/stations.js`, `store/narrow/devicecaps.js`, `store/signals.js` | seeds moved, no assert line changed (section 3) |

Contract-mismatch records and their closing commit:

| Record (commit) | Closed by |
|---|---|
| 638f0527: `drawers-speakers-schema.test.js:124` switch row, unresolved Q2 | ceb112e9 (C2, case deleted) |
| 9cd0622c: 3 previewed `shaperfit-mode-gate.test.js` cases, unresolved Q1 | ceb112e9 (C1, cases deleted) |
| 007f8762: 4 `structural-roundtrip.test.js` cases, unresolved | ceb112e9 (C3, cases deleted) |
| 8003bc16: 6 `hardware-catalog.test.js` cases (Q2) | ceb112e9 (C2, file deleted whole) |
| 8003bc16: 4 `structural-roundtrip.test.js` cases | ceb112e9 (C3, cases deleted) |
| 8003bc16: `pipeline-baseline.test.js` `test_staging_the_daemon_rows_of_a_live_active_profile_reads_clean` | 007f8762 (`stagingWire` reconciles; case still present at HEAD, asserts unchanged) |
| 0ef73a19: 9 `applyguard.test.js` previewed-`direct_sdm` cases (Q1) | ceb112e9 (8 cases deleted) and 15bc96b7 (the ninth, `test_leaving_a_hazard_and_reaching_it_again_asks_again_at_edit_time`, repaired by seed, no assert changed) |
| ceb112e9 C1, C2, C3 | self: the owner rulings it records |
| 8287314d C2: `polling.test.js` `test_the_next_successful_fetch_replaces_the_held_snapshot`, `test_refresh_devices_repulls_the_config_forms` | self |
| cb5d5d42: `polling.test.js` `test_a_failed_config_fetch_keeps_the_last_good_snapshot` | self |

Open-route count: 0.

## 2. AC3: `config.value` and `matrixConfig.value` assignments

Command: `perl /tmp/p2audit/ac3.pl $(grep -rlE '\b(config|matrixConfig)\.value\b' tests/js)`, a multi-line scan from each `config.value =` / `matrixConfig.value =` to its closing `;` (`(?!=)` excludes `==`). Result: 182 assignments in `/tmp/p2audit/ac3b.txt`; 0 carry a `file`, `active` or `rows` key or a field value. A second grep, `(config|matrixConfig)\.value\.(file|active|rows)\s*=`, finds no member write.

The earlier hit, `polling.test.js:156` (`matrixConfig.value = { fields: [], active: "Kept" };`), is gone. 3e90a616 (coordinator ruling: fixture-shape repair under D-01) now reads `const kept = { fields: [{ name: "kept_field" }] }; matrixConfig.value = kept;`. AC3 literal hit count: 0.

What the 182 carry:

- Literal objects: `{ fields: [...] }`, `{ fields, profiles: null }`, `{ fields: [], profiles: { options: [...] } }`. No field-level `value:` key outside `options` (the two `value:` hits outside options are `field-harness.js:162-163`, which destructure `value` out to drop it, and a `models: [{ value: "", label: "" }]` option list).
- `null`: `profile_fanout.test.js:96`, `livepresets.test.js:72`, `control.test.js:54`, `faceplate.test.js:29`, `drawers-source-reuse.test.js:75`, `drawers-source.test.js:86`, `meter.test.js:72`, `meter-span.test.js:76`.
- Local builders: `configTree()` / `matrixTree()` (`store/faceplate-builders/profile.test.js:143,127`, `components/faceplate-builders/profile.test.js:94,127`, `profile-steps.test.js:81,98`) return `{ fields }` plus `file_profiles`, `live_profiles`, `preset_profiles` (matrix only). `form(live, active)` (`store/faceplate-page/profile.test.js:53`) returns `{ fields: [] }` and seeds through `seedReadings`. `FORM` (`logging.test.js:41`, `engine-rows.test.js:56`) is `{ fields }` only. `configPayload` (`support/easy/easyrate.js:66`) returns `{ fields, profiles: null }` with `value` stripped. `shaperfit-fixtures.js:168` and `devicecaps-harness.js:174` return `{ fields }` / `{ fields, profiles: null }`. Spreads (`...form`, `...config.value`, `...m`) copy the fixture's own `{ fields }`.
- `file_profiles`, `preset_profiles`: read by production (`store/matrix/profiles.js:28,143`), so they stay. `store/faceplate-page/profile.test.js:120` carries `file_profiles: { Desk: { rows: [] } }`; that `rows` is the stored profile's own shape (`profiles.js:86`, "A profile the config carries: {rows, post}"), nested, not a form-signal key.

Open items outside AC3's literal keys (listed, not counted):

- `live_profiles` is assigned to `matrixConfig.value` in `sdm-hide-superseded.test.js:365` and the `matrixTree` builders of `store/faceplate-builders/profile.test.js:138`, `components/faceplate-builders/profile.test.js:121` and `profile-steps.test.js:93`. `live_active: "Warm"` sits at `components/faceplate-builders/profile.test.js:123`. No `hqptuner/static/` line reads a `live_*` key. `routes.md` R3 names them with `active` as retired.
- Served and pushed bodies, not assignments: `store/live/polling.test.js:116,122` (SSE `config` / `matrix` events carrying `file: {}` and `active`, read back through `config.value?.active` at 117 and 123), `store/live/mirror.test.js:25,77`, `store/live/remirror.test.js:91`, `components/faceplate-settings/about-state-import-stores.test.js:145` (fake `/api/config` bodies carrying `file: {}` and `active`). Production writes them to `config` / `matrixConfig` through the `sync.js:120-121` mirror table. No `config.value =` appears in these lines, so the literal AC3 search does not reach them. `polling.test.js:116,122` and `mirror.test.js` are unchanged from BASE; `remirror.test.js` and `about-state-import-stores.test.js` were edited by Plan 5 or Plan 6 and kept the `file: {}` / `active` in their served bodies. Whether D-01 reaches a daemon body is the owner's call.

AC3 hit count: 0.

## 3. AC4: assert-line and test-title changes

Commands: `git diff -U0 BASE HEAD -- $(cat files.txt) | grep -E '^[+-]' | grep -E 'assert|\btest\('` (lines for the 53 baseline paths); then a statement-level comparison over every modified or deleted `tests/js/**/*.test.js` (`bash /tmp/p2audit/ac4run.sh`, which runs `perl /tmp/p2audit/ext2.pl` to extract each `assert.*(...)` call and each `test("title"` to its closing parenthesis, BASE against HEAD, diffed; result in `/tmp/p2audit/ac4-full7.txt`).

Result for the 53 `files.txt` paths: 45 changed lines, 0 added, 45 removed. All 45 are in ceb112e9 (the C1, C2, C3 deletions), including `tests/js/store/hardware-catalog.test.js`, which is deleted whole and so absent at HEAD. No path had an assert line or title edited in place.

Statement-level comparison over all modified test files, 68 lines (52 removed, 16 added), each matched:

| File | Change | Commit | Record |
|---|---|---|---|
| `store/guards/applyguard.test.js` | 8 cases removed (8 titles, 8 asserts) | ceb112e9 | `Contract mismatch: C1` |
| `store/guards/shaperfit-mode-gate.test.js` | 5 cases removed | ceb112e9 | C1 |
| `store/presets/presets.test.js` | 1 case removed | ceb112e9 | C1 |
| `components/faceplate-drawers/drawers-speakers-schema.test.js` | 1 case removed | ceb112e9 | C2 |
| `store/hardware-catalog.test.js` | file deleted, 2 templated cases (6 ids) | ceb112e9 | C2 |
| `store/structural-roundtrip.test.js` | 4 cases removed | ceb112e9 | C3 |
| `store/live/polling.test.js` | 2 cases removed | 8287314d | `Contract mismatch: C2` |
| `store/live/polling.test.js` | 1 case removed | cb5d5d42 | `Contract mismatch:` one line, no quotation |
| `store/live/polling.test.js` | 1 assert edited in place: `assert.equal(matrixConfig.value.active, "Kept")` to `assert.equal(matrixConfig.value, kept)`; title unchanged | 3e90a616 | coordinator ruling, fixture-shape repair under D-01 (one quotation, no `Contract mismatch:` record); see below |
| `components/faceplate-drawers/drawers-crossfeed.test.js` (2 asserts), `store/faceplate/drawers-crossfeed.test.js` (1 assert) | 3 asserts renamed `post_bauer_*` to `crossfeed_*` | 19cc6273 | revert of the 6343d922 renames (D-11, AC4 second clause: "reverted") |
| `model/store/reading.test.js` | 6 new tests added (6 titles, 6 asserts) | ba04762f | AC5 `nameOf` coverage; additions only |

Each of the three tied to a `Contract mismatch:` record: the quoted rulings are in ceb112e9 (C1: owner ruling plus `store/actions.js:188,209`; C2: owner ruling plus `store/faceplate/drawer/control.js:164`; C3: owner ruling plus `docs/spec/api.md:33` and `80a8bde0`). 8287314d carries an owner ruling plus `sync.js refreshConfig`. cb5d5d42 carries one sentence (`Plan 6 Task 4 removed the mirror (sync.js refreshConfig no longer writes config).`) with no document quotation.

`polling.test.js` is not in `files.txt` (it passed at baseline), so it is outside the per-path scope; it is listed because AC4 reads "a baseline test file". 3e90a616 is the one assert-line edit in the range without a `Contract mismatch:` record. Its commit message quotes D-01 and states the claim and test name are unchanged, and the coordinator ruled it a fixture-shape repair, not a contract mismatch. The claim is unchanged: a failed `/api/matrix` fetch keeps the held `matrixConfig` value. The retargeted assert checks identity of the held object where the old one checked the retired `active` sentinel.

The revert pair 9e507177 / cc72db07 removed and re-added 6 lines of `polling.test.js`: net zero.

Unmatched assert-line changes: 0 in the 53 `files.txt` paths; 0 elsewhere, with 3e90a616 matched to the coordinator's D-01 ruling only.

## 4. AC6: forbidden paths

Command: `git log --name-only --format= BASE..HEAD | grep -cE '^(uv\.lock|\.planning/reads\.jsonl)$'`. Result: 0. The range touches 10 `hqptuner/static/` paths (`store/actions.js`, `alerts/shaperfit.js`, `core/readings.js`, `faceplate/stations.js`, `narrow/devicecaps.js`, `resolve.js`, `schema/hardware.js`, `schema/speakers.js`, `signals.js`, `sync.js`) and the rest under `tests/js/`.

AC6 hit count: 0.

## Support files for Task 2

`git diff --name-only BASE HEAD -- tests/js/support` lists 10 files: `devicecaps-harness.js`, `easy/easyrate.js`, `easy/easytiles.js`, `field-harness.js`, `profile-fixtures.js`, `rendered/filter-fields.js`, `rendered/pipelines-fixture.js`, `wire/livepresetwire.js`, `wire/unreadwire.js`, `wire/wire.js`. Beyond the nine named in Context, Task 2's importer set also needs `easy/easyrate.js`, `rendered/filter-fields.js`, `wire/livepresetwire.js`, `wire/unreadwire.js` and `wire/wire.js`.
