---
phase: 2
plan: 4
requirements: [INTG-01, INTG-02]
files:
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-backenddesc.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-pin-glass.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-ratedesc.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-ratehead.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-schema.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-seemore.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/about-state-import-stores.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/engine-rows.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/hardware.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/logging.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/about-state-import-owed.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/about-state-import.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/hardware-catalog-rows.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/rail.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/rail.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/rows.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-builders/snapshot.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/builder.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/profile-steps.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/profile.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-lists/option-list.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-page/conversion.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-builders/profile.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawer-grammar.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawer-save-restart.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawers-modes.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawers-source/drawers-source.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawers-speakers.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawer.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/conn.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/loadpreset.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/path.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/stations.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawer-family.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawer-plate.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawers-loudness.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawers-output.test.js
---

# Phase 2: Baseline recovery - Plan 4: Settings, builders and store faceplate suites

## Goal

The JS baseline in `.claude/worktrees/integrate` passes, through repaired test machinery and fixed production defects, with every valid claim unchanged (design step 12a). This plan recovers the settings, builder and store-faceplate suites, and migrates the passing output-drawer, settings, builder and store-faceplate suites' seeds.

## Must be true when done

- Every baseline failure in this plan's failing files that `routes.md` routes as `repair` passes, with claims and assert lines byte-identical to BASE.
- Every file of this plan meets the AC3 check.
- Every passing file migrated here has its pre-edit pass recorded and passes after the edit.
- Each failure left open carries a `Builder route:` or `Contract mismatch:` line in its task's commit message.

## Context

- Locked decisions, paths, file run, assert check, lint, BASE and the forbidden list as in Plan 1's Context. The AC3 check, the route procedure and the passing-file procedure are as in Plan 3's Context. Plans 1 to 3 are done first.
- Files that import Plan 1's repaired helpers keep their helper calls as they are: `store/faceplate-builders/profile.test.js` and `components/faceplate-builders/profile.test.js` import `profile-fixtures.js`, and `store/faceplate/drawer-plate.test.js` imports `listsfixture.js`. Only the seeds they make themselves are migrated. `seedReadings` replaces `readings.value` whole, so a file seeding after a helper has seeded passes everything through one call (D-10).
- Each task's Verify ends with the assert check, the AC3 check on its files, and lint.

## Tasks

### Task 1: Migrate the passing output-drawer suites' seeds

- **Files:** .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-backenddesc.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-pin-glass.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-ratedesc.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-ratehead.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-schema.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-seemore.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output.test.js
- **Action:** Apply the passing-file procedure to these seven files.
- **Verify:** The commit message quotes the pre-edit `exit=0`. A file run over the seven files prints `exit=0` after the edit. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 2: Recover the failing settings suites

- **Files:** .claude/worktrees/integrate/tests/js/components/faceplate-settings/about-state-import-stores.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-settings/engine-rows.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-settings/hardware.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-settings/logging.test.js
- **Action:** Apply the route procedure to every baseline failure in these four files. `engine-rows.test.js` and `logging.test.js` assign the form signals from local builders, which must meet the AC3 check too.
- **Verify:** A file run over the four files prints `exit=0`, except tests under `Builder route:`. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 3: Migrate the passing settings suites' seeds

- **Files:** .claude/worktrees/integrate/tests/js/components/faceplate-settings/about-state-import-owed.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-settings/about-state-import.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-settings/hardware-catalog-rows.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-settings/rail.test.js
- **Action:** Apply the passing-file procedure to these four files.
- **Verify:** The commit message quotes the pre-edit `exit=0`. A file run over the four files prints `exit=0` after the edit. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 4: Recover the failing builder suites

- **Files:** .claude/worktrees/integrate/tests/js/components/faceplate-builders/rail.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-builders/rows.test.js, .claude/worktrees/integrate/tests/js/store/faceplate-builders/snapshot.test.js
- **Action:** Apply the route procedure to every baseline failure in these three files. `rows.test.js` includes a `/Room EQ/` match failure, and its `matrixConfig.value` carries `rows` and `live_profiles`. `rows` goes under D-01. `live_profiles` is outside D-01's three keys and stays unless `routes.md` names it as the fault.
- **Verify:** A file run over the three files prints `exit=0`, except tests under `Builder route:`. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 5: Migrate the passing builder, list and page suites' seeds

- **Files:** .claude/worktrees/integrate/tests/js/components/faceplate-builders/builder.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-builders/profile-steps.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-builders/profile.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-lists/option-list.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-page/conversion.test.js, .claude/worktrees/integrate/tests/js/store/faceplate-builders/profile.test.js
- **Action:** Apply the passing-file procedure to these six files.
- **Verify:** The commit message quotes the pre-edit `exit=0`. A file run over the six files prints `exit=0` after the edit. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 6: Recover the failing store drawer suites

- **Files:** .claude/worktrees/integrate/tests/js/store/faceplate/drawer-grammar.test.js, .claude/worktrees/integrate/tests/js/store/faceplate/drawer-save-restart.test.js, .claude/worktrees/integrate/tests/js/store/faceplate/drawers-modes.test.js, .claude/worktrees/integrate/tests/js/store/faceplate/drawers-source/drawers-source.test.js, .claude/worktrees/integrate/tests/js/store/faceplate/drawers-speakers.test.js, .claude/worktrees/integrate/tests/js/store/faceplate/drawer.test.js
- **Action:** Apply the route procedure to every baseline failure in these six files.
- **Verify:** A file run over the six files prints `exit=0`, except tests under `Builder route:`. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 7: Recover the failing store shell suites

- **Files:** .claude/worktrees/integrate/tests/js/store/faceplate/conn.test.js, .claude/worktrees/integrate/tests/js/store/faceplate/loadpreset.test.js, .claude/worktrees/integrate/tests/js/store/faceplate/path.test.js, .claude/worktrees/integrate/tests/js/store/faceplate/stations.test.js
- **Action:** Apply the route procedure to every baseline failure in these four files. `conn.test.js` sets `applying` (`store/actions.js`) and `engineBusy` (`store/enginewrite.js`) and expects `busy`. `connState` in `hqptuner/static/store/faceplate/conn.js` reads `inFlight` of `store/core/ops.js`. Whether that is wrong machinery or a production defect is `routes.md`'s call. A defect stays a `Builder route:` entry here.
- **Verify:** A file run over the four files prints `exit=0`, except tests under `Builder route:`. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 8: Migrate the passing store faceplate suites' seeds

- **Files:** .claude/worktrees/integrate/tests/js/store/faceplate/drawer-family.test.js, .claude/worktrees/integrate/tests/js/store/faceplate/drawer-plate.test.js, .claude/worktrees/integrate/tests/js/store/faceplate/drawers-loudness.test.js, .claude/worktrees/integrate/tests/js/store/faceplate/drawers-output.test.js
- **Action:** Apply the passing-file procedure to these four files.
- **Verify:** The commit message quotes the pre-edit `exit=0`. A file run over the four files prints `exit=0` after the edit. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.
