---
phase: 2
plan: 6
requirements: [INTG-01]
files:
  - .claude/worktrees/integrate/tests/js/store/guards/applyguard.test.js
  - .claude/worktrees/integrate/tests/js/store/presets/presets.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/shaperfit-mode-gate.test.js
  - .claude/worktrees/integrate/tests/js/store/hardware-catalog.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-speakers-schema.test.js
  - .claude/worktrees/integrate/tests/js/store/structural-roundtrip.test.js
  - .claude/worktrees/integrate/tests/js/support/easy/easytiles.js
  - .claude/worktrees/integrate/hqptuner/static/store/actions.js
  - .claude/worktrees/integrate/hqptuner/static/store/signals.js
  - .claude/worktrees/integrate/hqptuner/static/store/schema/hardware.js
  - .claude/worktrees/integrate/hqptuner/static/store/schema/speakers.js
  - .claude/worktrees/integrate/hqptuner/static/store/alerts/shaperfit.js
  - .claude/worktrees/integrate/hqptuner/static/store/live/write.js
  - .claude/worktrees/integrate/hqptuner/static/store/sync.js
  - .claude/worktrees/integrate/hqptuner/static/store/core/readings.js
  - .claude/worktrees/integrate/hqptuner/static/store/resolve.js
  - .claude/worktrees/integrate/hqptuner/static/store/faceplate/stations.js
  - .claude/worktrees/integrate/hqptuner/static/store/narrow/devicecaps.js
  - .claude/worktrees/integrate/tests/js/support/wire/unreadwire.js
  - .claude/worktrees/integrate/tests/js/support/wire/livepresetwire.js
  - .claude/worktrees/integrate/tests/js/support/readings.js
  - .claude/worktrees/integrate/tests/js/support/devicecaps-harness.js
  - .claude/worktrees/integrate/tests/js/store/live/polling.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/about-state-import.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/profile.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/rail.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/header.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-builders/profile.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-builders/snapshot.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawers-output.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-page/profile-core.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/stations.test.js
  - .claude/worktrees/integrate/tests/js/store/narrow/localbackends.test.js
---

# Phase 2: Baseline recovery - Plan 6: Stale claims out, production defects fixed

## Goal

The JS baseline in `.claude/worktrees/integrate` passes, through repaired test machinery and fixed production defects, with every valid claim unchanged (design step 12a). This plan deletes the test cases whose claims the owner retired (C1, C2, C3 in `routes.md`) and fixes the production code that fails the valid claims routed builder (B1, B2).

## Must be true when done

- Every test case routed C1, C2 or C3 in `routes.md` is deleted, and each deletion's commit message carries a `Contract mismatch:` line quoting the owner ruling and the code or spec line it rests on.
- `previewConfig` appears nowhere under `hqptuner/static/` or `tests/js/`.
- Every test case routed B1 or B2 passes, with that test file unchanged by this plan.
- A full-suite run shows no failing test that was not already failing in `failures.log`.

## Context

- Locked decisions, paths, file run, assert check, lint and BASE as in Plan 1's Context. Plans 1 to 5 are done first.
- Owner rulings, 2026-11-05: a previewed preset does not change what a control shows (C1); a control's value is the served reading, not a form draft (C2); the stored server buffer keeps a clean entry and only the `staged` reading reconciles (C3). A test claiming otherwise is stale and is deleted, never rewritten to pass.
- B1 and B2 are valid claims whose failing tests already exist and are red against current code. That red run is the bite proof (`docs/spec/testing.md` rule 8). The fix makes them pass with the test files untouched.
- A test file left with no case after a deletion is deleted whole, and its imports of shared helpers go with it.

## Tasks

### Task 1: Delete the retired C1, C2 and C3 cases

- **Files:** .claude/worktrees/integrate/tests/js/store/guards/applyguard.test.js, .claude/worktrees/integrate/tests/js/store/presets/presets.test.js, .claude/worktrees/integrate/tests/js/store/guards/shaperfit-mode-gate.test.js, .claude/worktrees/integrate/tests/js/store/hardware-catalog.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-speakers-schema.test.js, .claude/worktrees/integrate/tests/js/store/structural-roundtrip.test.js
- **Action:** Delete every `test(` case `routes.md` routes `Cause: C1` (13), `Cause: C2` (7) and the four `structural-roundtrip.test.js` buffer cases C3 names (4), 24 in all, plus any fixture, import or setup line only those cases used. Leave every other case byte-identical. The commit message carries one `Contract mismatch:` line per cause with the owner ruling and its code or spec quotation from `routes.md`.
- **Verify:** A file run over the six files shows none of the 24 titles and no failing test outside B1. Every remaining case's lines are byte-identical to HEAD before the task (the assert check). Lint. Testing scope: deletion only; no test is added or changed.

### Task 2: Remove dead `previewConfig` and the stale catalog headers

- **Files:** .claude/worktrees/integrate/hqptuner/static/store/actions.js, .claude/worktrees/integrate/hqptuner/static/store/signals.js, .claude/worktrees/integrate/hqptuner/static/store/schema/hardware.js, .claude/worktrees/integrate/hqptuner/static/store/schema/speakers.js, .claude/worktrees/integrate/tests/js/support/easy/easytiles.js
- **Action:** Remove the `previewConfig` signal (`signals.js:38`), its writes and import in `actions.js` (lines 13, 188, 209), and its reset in `easytiles.js:220`. Cut the header claims in `schema/hardware.js` and `schema/speakers.js` that a row's value is the drawer's draft over the engine's form; a row's value is its served reading.
- **Verify:** `grep -rn previewConfig hqptuner/static tests/js` finds nothing. A full-suite run shows no failing test outside `failures.log`. Lint. Testing scope: dead-code removal; no behavior changes, no test.

### Task 3: Fix the shaper-fit name lookup (B1)

- **Files:** .claude/worktrees/integrate/hqptuner/static/store/alerts/shaperfit.js
- **Action:** Make `shaperName` take the modulator or ditherer name from the served reading's `name` (`docs/spec/api.md:35`), not by matching the engine list index against the config form's enum IDs, as B1 in `routes.md` states.
- **Verify:** A file run over `store/faceplate-alerts/alerts.test.js`, `store/guards/shaperfit-alerts.test.js`, `components/faceplate-alerts/rail.test.js` and `store/guards/shaperfit-mode-gate.test.js` prints `exit=0`, with those files unchanged by this task. Lint. Testing scope: existing red tests are the proof; none added.

### Task 4: Re-mirror a held live write into the readings (B2)

- **Files:** .claude/worktrees/integrate/hqptuner/static/store/live/write.js, .claude/worktrees/integrate/hqptuner/static/store/sync.js
- **Action:** After a live write, `remirrorLive` (`write.js:96`) refreshes through `refreshConfig` (`sync.js:101`), which mirrors the retired `config` signal. Make the refresh adopt the served `/api/config` answer as the readings, as `store/core/readings.js:136` does, so a held write shows on its control without a generation change. Remove the retired `.data` mirroring if nothing else reads it.
- **Verify:** `live-reenum.test.js` `test_a_held_write_shows_the_held_value_on_the_dormant_control` passes with the file unchanged. A full-suite run shows no failing test outside `failures.log` and none of B1, B2. Lint. Testing scope: existing red test is the proof; none added.

### Task 5: Serve the readings shape in the fakes Task 4 broke, read metadata from the readings (B3), repair the kept applyguard case

- **Files:** .claude/worktrees/integrate/tests/js/support/wire/unreadwire.js, .claude/worktrees/integrate/tests/js/support/wire/livepresetwire.js, .claude/worktrees/integrate/tests/js/store/live/polling.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-settings/about-state-import.test.js, .claude/worktrees/integrate/tests/js/store/guards/applyguard.test.js, .claude/worktrees/integrate/hqptuner/static/store/core/readings.js, .claude/worktrees/integrate/hqptuner/static/store/resolve.js, .claude/worktrees/integrate/hqptuner/static/store/faceplate/stations.js, .claude/worktrees/integrate/hqptuner/static/store/narrow/devicecaps.js, and the test seed files listed in `files:` that seed `profiles` or `device_caps` on `config.value`
- **Action:** (a) The fakes that answer `GET /api/config` with the retired `{ data: ... }` body and now crash under Task 4 (`unreadwire.js:130`, `livepresetwire.js`, `polling.test.js`, `about-state-import.test.js:86`) serve the route's real `{ generation, fields }` body (`hqptuner/core/fieldreadings.py`). (b) The `polling.test.js` cases that claim `refreshConfig` mirrors `/api/config` into the `config` form signal are stale: Task 4 removed that mirror. Delete them, with a `Contract mismatch:` line citing Task 4 and `sync.js` `refreshConfig`. (c) B3, owner ruling 2026-11-06 ("Fix both"): `stationTree` (`store/faceplate/stations.js:43`) and `deviceCaps` (`store/narrow/devicecaps.js:62`) read `profiles` and `device_caps` from the served metadata readings (`hqptuner/fields/register.py:371,373`), not the `config` signal, whose only writer takes a `data` key the server never sends. Move the test seeds of `profiles` and `device_caps` from `config.value` to the readings; no assert line changes. (d) Repair the kept applyguard case `test_leaving_a_hazard_and_reaching_it_again_asks_again_at_edit_time`: seed and stage `direct_sdm` as the served `"0"`/`"1"` strings (a Text field, `hqptuner/fields/register.py`; checkbox rows stage `"1"`/`"0"`, `store/faceplate/drawer/rows.js`); no assert line changes. The other fakes that serve `{ data: ... }` and still pass belong to Phase 3 and stay unchanged.
- **Verify:** `test_a_landed_import_reads_the_station_list_again_from_the_server` is red against the old readers once its fake serves the real shape (the bite proof), then green. The kept applyguard case passes. A full-suite run shows no failing test outside `failures.log`. Assert check: no assert line added or changed outside the deleted cases. Lint. Testing scope: fixture-shape repair, stale-case deletion and the B3 fix; no new test.

### Task 6: Repair the matrix keep-last-good case to the D-01 form shape

- **Files:** .claude/worktrees/integrate/tests/js/store/live/polling.test.js
- **Action:** `test_a_failed_matrix_fetch_keeps_the_last_good_form` (`polling.test.js:155`) seeds `matrixConfig.value` with the `active` key D-01 removed from every form fixture, and asserts on it. Its claim stays valid: `refreshConfig` still mirrors `/api/matrix` into `matrixConfig` (`store/sync.js:105`), and a failed fetch keeps the last good form. Keep the test name and the claim. Seed only D-01 keys, and assert that the held form survives the failed fetch. The commit message names this as a fixture-shape repair under D-01, and quotes D-01 and `sync.js:105`. Change no other case.
- **Verify:** The file run over `polling.test.js` prints `exit=0`. With `matrixConfig` mirroring disabled locally (not committed), the case goes red. A search under `tests/js/` for an assignment to `config.value` or `matrixConfig.value` that carries a `file`, `active` or `rows` key finds none. Lint. Testing scope: one fixture-shape repair; no new test.
