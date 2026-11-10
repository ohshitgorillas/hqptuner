---
phase: 3
plan: 4
requirements: [INTG-03]
files:
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawer-items.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawer-rows.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-speakers-schema.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawer.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/hardware-catalog-rows.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/rail.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/faceplate.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/builder.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/rows.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/profile-steps.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/profile.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-builders/profile.test.js
---

# Phase 3: Retired-shape ports - Plan 4: Drawer, settings, faceplate and builder suites

## Goal

Every remaining test and support under `tests/js/` runs on the approved interfaces (design step 12b). This plan ports the `profiles` keys out of the `config.value` fixtures of the drawer, settings, faceplate and builder suites, and the `live_profiles` / `live_active` keys out of the builder suites' `matrixConfig.value` fixtures.

## Must be true when done

- No `config.value` assignment, and no `configTree` builder assigned to it, in this plan's twelve files carries a `profiles` or `device_caps` key.
- No `matrixTree` builder in the three profile builder suites writes a `live_profiles` or `live_active` key into `matrixConfig.value`.
- Each of the twelve files passes after its port, with asserts byte-identical to START, and each port commit quotes its pre-edit run printing `exit=0` and its after-run.

## Context

- Shared Context, Port procedure, Port rules, assert check, lint, forbidden and kept lists: as in Plan 1's Context. Plans 1 to 3 are done first.
- `null`-valued `profiles` keys: `drawer-items`, `drawer-rows`, `drawers-speakers-schema` (its second `config.value` assignment), `components/faceplate-drawers/drawer`, `hardware-catalog-rows`, `components/faceplate-settings/rail`. Non-null station options: `faceplate.test.js`, `builder.test.js`, `rows.test.js`, and `profile-steps.test.js` `configTree`; none of their setups seeds a `profiles` reading today.
- `matrixTree` live keys: `components/faceplate-builders/profile.test.js` writes `live_profiles: ["Warm"]` and `live_active: "Warm"` and its setup seeds neither `enums.value.matrix_profiles` nor a `matrix_profile` reading. `profile-steps.test.js` writes `live_profiles: []` and already seeds a `matrix_profile` reading. `store/faceplate-builders/profile.test.js` writes `live_profiles` from `matrixTree`'s `live` option, and every setup passing it also assigns `enums.value.matrix_profiles` the same list. `file_profiles` and `preset_profiles` stay (D-03).
- D-04: `drawer-rows.test.js` serves wire readings; only its `config.value` fixture carries a D-01 key.
- Each task's Verify ends with the AC1 check on its files: `grep -n -E '(^|[^_a-z])(profiles|device_caps)\s*:' <files>` and `grep -n -E 'live_(profiles|active)\s*:' <files>` print no line inside a `config.value` or `matrixConfig.value` fixture or a builder assigned to one, read against the setup.

## Tasks

### Task 1: Port the drawer component suites' form fixtures

- **Files:** tests/js/components/faceplate-drawers/drawer-items.test.js, tests/js/components/faceplate-drawers/drawer-rows.test.js, tests/js/components/faceplate-drawers/drawers-speakers-schema.test.js, tests/js/components/faceplate-drawers/drawer.test.js
- **Action:** Remove `profiles: null` from each `config.value` assignment (Port rules, null value). Port procedure on the four files.
- **Verify:** the after-run over the four files prints `exit=0`; the AC1 check is clean; assert check clean; lint prints `exit=0`. Testing scope: the suites' own cases; no new test.

### Task 2: Port the settings and faceplate suites' form fixtures

- **Files:** tests/js/components/faceplate-settings/hardware-catalog-rows.test.js, tests/js/components/faceplate-settings/rail.test.js, tests/js/components/faceplate/faceplate.test.js
- **Action:** Remove `profiles: null` from the two settings suites' `config.value`. In `faceplate.test.js`, the setup's `config.value` holds `fields` alone and its station options move into that setup's one `seedReadings` call as the read-only `profiles` reading `{ value: { options }, readonly: true }` (Port rules, non-null value). Port procedure on the three files.
- **Verify:** the after-run over the three files prints `exit=0`; the AC1 check is clean; `faceplate.test.js`'s setup seeds a read-only `profiles` reading; assert check clean; lint prints `exit=0`. Testing scope: the suites' own cases; a case whose outcome changes now that stations reach production takes the Port procedure's routes; no new test.

### Task 3: Port the builder and rows suites' station metadata

- **Files:** tests/js/components/faceplate-builders/builder.test.js, tests/js/components/faceplate-builders/rows.test.js
- **Action:** As Task 2 for `faceplate.test.js`: each setup's `config.value` holds `fields` alone, and its station options join the existing `seedReadings` call, which already carries `active_preset`, as the read-only `profiles` reading. Port procedure on the two files.
- **Verify:** the after-run over the two files prints `exit=0`; the AC1 check is clean; assert check clean; lint prints `exit=0`. Testing scope: as Task 2.

### Task 4: Port the profile-steps suite's form and matrix fixtures

- **Files:** tests/js/components/faceplate-builders/profile-steps.test.js
- **Action:** `configTree` returns `fields` alone; its station options move into the setup's `seedReadings` call as the read-only `profiles` reading. `matrixTree` drops `live_profiles: []`: the setup's `matrix_profile` reading already serves the live profile, and an empty daemon list needs no seed. Correct `configTree`'s doc comment, which says it carries the stations. Port procedure on this file.
- **Verify:** the after-run prints `exit=0`; the AC1 check is clean; assert check clean; lint prints `exit=0`. Testing scope: the suite's own cases; no new test.

### Task 5: Port the profile builder component suite's matrix fixture

- **Files:** tests/js/components/faceplate-builders/profile.test.js
- **Action:** `matrixTree` drops `live_profiles` and `live_active` (Port rules). The setup seeds what they meant where production reads it: `enums.value.matrix_profiles` holding `["Warm"]`, and a `matrix_profile` reading for `Warm` in the existing `SERVED` seed, built with `profileReading` from `tests/js/support/profile-fixtures.js` (read-only import; that file is not edited). Correct the file's header comment where it says the stations sit on `config` and the daemon-known and live profiles on `matrixConfig`. Port procedure on this file.
- **Verify:** the after-run prints `exit=0`; the AC1 check is clean; the setup assigns `enums.value` with `matrix_profiles` and seeds a `matrix_profile` reading; assert check clean; lint prints `exit=0`. Testing scope: the suite's own cases; a case whose outcome changes now that Warm reaches production as live takes the Port procedure's routes; no new test.

### Task 6: Port the profile builder store suite's matrix fixture

- **Files:** tests/js/store/faceplate-builders/profile.test.js
- **Action:** `matrixTree` drops `live_profiles` and its `live` option, since every setup passing `live` already assigns `enums.value.matrix_profiles` the same list and the `load` readings serve `matrix_profile`. The call `matrixTree({ live: ["Warm", "Echo"] })` becomes `matrixTree()`. Correct the header comment where it lists the stations as part of the `config` form and the daemon-known and live profiles as part of the matrix payload. Port procedure on this file.
- **Verify:** the after-run prints `exit=0`; the AC1 check is clean; `grep -n -E 'live_profiles|matrixTree\(\{ live' tests/js/store/faceplate-builders/profile.test.js` prints nothing; assert check clean; lint prints `exit=0`. Testing scope: the suite's own cases; no new test.

## Notes

- Caller-side delta: Task 6 changes one call site of the file-local `matrixTree`; no other task changes a call.
