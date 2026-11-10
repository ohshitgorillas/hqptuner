---
phase: 3
plan: 8
requirements: [INTG-03]
files:
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/hardware-catalog-rows.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/hardware.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/logging.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/rail.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/faceplate.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/header.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/page.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/rail-staged.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/rail.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/switcher.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawer-items.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawer-rows.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawer.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-crossfeed.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-fft-catalog.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-hf-schema.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-loudness.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-matrix-schema.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-modes-schema.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-pipelines-schema.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-pipelines.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-plate-names.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-resampling-two-stage.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-speakers-schema.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-speakers-stale.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-speakers.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-volume-range-seemore.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-volume-schema.test.js
  - .claude/worktrees/integrate/tests/js/store/c1-operations.test.js
  - .claude/worktrees/integrate/tests/js/store/drawer-restart.test.js
  - .claude/worktrees/integrate/tests/js/store/pipeline-baseline.test.js
  - .claude/worktrees/integrate/tests/js/store/resolve-facade.test.js
  - .claude/worktrees/integrate/tests/js/store/spken-catalog.test.js
  - .claude/worktrees/integrate/tests/js/store/structural-roundtrip.test.js
  - .claude/worktrees/integrate/tests/js/store/fixed-volume-readings.test.js
  - .claude/worktrees/integrate/tests/js/store/core/control.test.js
  - .claude/worktrees/integrate/tests/js/store/core/readings.test.js
---

# Phase 3: Retired-shape ports - Plan 8: Settings, faceplate, drawer and top-level store await ports

## Goal

Every remaining test and support under `tests/js/` runs on the approved interfaces (design step 12b). This plan awaits the readings seed in the remaining settings suites, the faceplate and drawer component suites, the top-level store suites and the core store suites.

## Must be true when done

- In this plan's 37 test files, every call that reaches a seed is awaited (Await rule), and every assert line and test title is byte-identical to START.
- Each of the 37 files passes after its port, and each port commit quotes its pre-edit run printing `exit=0` and its after-run.

## Context

- Shared Context, Port procedure, Port rules, assert check, lint, forbidden and kept lists: as in Plan 1's Context. The Await rule, Await check, order and caller-side delta: as in Plan 7's Context. Plans 1 to 7 are done first.
- `components/faceplate-drawers/drawers-volume-range.test.js` is not here: its covered calls sit on assert lines (Plan 10 Task 4). `components/faceplate/volume.test.js` is not here for the same reason. The component page suites are in Plan 10 Task 2.
- `store/core/readings.test.js` keeps its own `readings.value` assignments, which AC1 allows in that suite; only its seed calls change.

## Tasks

### Task 1: Await the seeds in the hardware, logging and rail settings suites

- **Files:** tests/js/components/faceplate-settings/hardware-catalog-rows.test.js, tests/js/components/faceplate-settings/hardware.test.js, tests/js/components/faceplate-settings/logging.test.js, tests/js/components/faceplate-settings/rail.test.js
- **Action:** Apply the Await rule to the four files, including the file-local `load` of `logging.test.js` and `playing` of `rail.test.js`. Port procedure on the four files.
- **Verify:** the after-run over the four files prints `exit=0`; the Await check is clean; the assert check is clean; lint prints `exit=0`. Testing scope: the suites' own cases; before the switch the port changes no behavior; no new test; testing stops at the file run.

### Task 2: Await the seeds in the faceplate component suites

- **Files:** tests/js/components/faceplate/faceplate.test.js, tests/js/components/faceplate/header.test.js, tests/js/components/faceplate/page.test.js, tests/js/components/faceplate/rail-staged.test.js, tests/js/components/faceplate/rail.test.js, tests/js/components/faceplate/switcher.test.js
- **Action:** Apply the Await rule to the six files, including the file-local `loadStation`, `run`, `load` and `playing` that seed, and the `loadLists` call and `beforeEach` of `switcher.test.js`, whose bindings come from a destructured `await import(...)`. Port procedure on the six files.
- **Verify:** as Task 1, over the six files.

### Task 3: Await the seeds in the drawer component suites, items to FFT catalog

- **Files:** tests/js/components/faceplate-drawers/drawer-items.test.js, tests/js/components/faceplate-drawers/drawer-rows.test.js, tests/js/components/faceplate-drawers/drawer.test.js, tests/js/components/faceplate-drawers/drawers-crossfeed.test.js, tests/js/components/faceplate-drawers/drawers-fft-catalog.test.js
- **Action:** Apply the Await rule to the five files, including `loadConfig` in `drawer.test.js` and `load` in `drawers-fft-catalog.test.js`. Port procedure on the five files.
- **Verify:** as Task 1, over the five files.

### Task 4: Await the seeds in the drawer schema suites, HF to pipelines schema

- **Files:** tests/js/components/faceplate-drawers/drawers-hf-schema.test.js, tests/js/components/faceplate-drawers/drawers-loudness.test.js, tests/js/components/faceplate-drawers/drawers-matrix-schema.test.js, tests/js/components/faceplate-drawers/drawers-modes-schema.test.js, tests/js/components/faceplate-drawers/drawers-pipelines-schema.test.js
- **Action:** Apply the Await rule to the five files, including the `loadPipelines` call of `drawers-pipelines-schema.test.js` and the file-local `load` of `drawers-modes-schema.test.js`. Port procedure on the five files.
- **Verify:** as Task 1, over the five files.

### Task 5: Await the seeds in the drawer suites, pipelines to speakers schema

- **Files:** tests/js/components/faceplate-drawers/drawers-pipelines.test.js, tests/js/components/faceplate-drawers/drawers-plate-names.test.js, tests/js/components/faceplate-drawers/drawers-resampling-two-stage.test.js, tests/js/components/faceplate-drawers/drawers-speakers-schema.test.js
- **Action:** Apply the Await rule to the four files, including the `loadPipelines` call of `drawers-pipelines.test.js`, the `loadLists` call of `drawers-plate-names.test.js` and the file-local `load` of `drawers-resampling-two-stage.test.js`. Port procedure on the four files.
- **Verify:** as Task 1, over the four files.

### Task 6: Await the seeds in the drawer suites, speakers to volume schema

- **Files:** tests/js/components/faceplate-drawers/drawers-speakers-stale.test.js, tests/js/components/faceplate-drawers/drawers-speakers.test.js, tests/js/components/faceplate-drawers/drawers-volume-range-seemore.test.js, tests/js/components/faceplate-drawers/drawers-volume-schema.test.js
- **Action:** Apply the Await rule to the four files, including the `loadVolumeRange` call of `drawers-volume-range-seemore.test.js` and the file-local `load` of `drawers-volume-schema.test.js`. Port procedure on the four files.
- **Verify:** as Task 1, over the four files.

### Task 7: Await the seeds in the first top-level store suites

- **Files:** tests/js/store/c1-operations.test.js, tests/js/store/drawer-restart.test.js, tests/js/store/pipeline-baseline.test.js, tests/js/store/resolve-facade.test.js
- **Action:** Apply the Await rule to the four files, including the `beforeEach` callbacks of `drawer-restart.test.js` and `resolve-facade.test.js`. Port procedure on the four files.
- **Verify:** as Task 1, over the four files.

### Task 8: Await the seeds in the remaining top-level and the core store suites

- **Files:** tests/js/store/spken-catalog.test.js, tests/js/store/structural-roundtrip.test.js, tests/js/store/fixed-volume-readings.test.js, tests/js/store/core/control.test.js, tests/js/store/core/readings.test.js
- **Action:** Apply the Await rule to the five files, including `load` in `fixed-volume-readings.test.js`, `serve` in `control.test.js` and the `beforeEach` of `readings.test.js`. The `readings.value` assignments of `readings.test.js` stay byte-identical. Port procedure on the five files.
- **Verify:** as Task 1, over the five files.
