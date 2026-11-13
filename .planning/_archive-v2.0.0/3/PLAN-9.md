---
phase: 3
plan: 9
requirements: [INTG-03]
files:
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawer-family.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawer-grammar.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawer-plate.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawer-save-restart.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawer.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawers-crossfeed.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawers-loudness.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawers-modes.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawers-output.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawers-pipelines.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawers-source/drawers-source.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawers-speakers.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/loadpreset.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/path.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/rail-now.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/stations.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/switcher.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-alerts/alerts-unread.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-builders/profile.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-builders/snapshot.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-lists/dsd-kind.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-lists/facets.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-lists/options.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-lists/rate-cap.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-page/conversion.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-page/profile-core.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-page/profile.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/applyguard.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/directsdmwarn.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/sdm-hide-superseded.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/xfmode.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/xfmode-refusal.test.js
  - .claude/worktrees/integrate/tests/js/store/live/live-reenum.test.js
  - .claude/worktrees/integrate/tests/js/store/live/live.test.js
  - .claude/worktrees/integrate/tests/js/store/live/livepresets.test.js
  - .claude/worktrees/integrate/tests/js/store/live/polling.test.js
---

# Phase 3: Retired-shape ports - Plan 9: Store faceplate, guard and live await ports

## Goal

Every remaining test and support under `tests/js/` runs on the approved interfaces (design step 12b). This plan awaits the readings seed in the store faceplate, alert, builder, list, page, guard and live suites.

## Must be true when done

- In this plan's 36 test files, every call that reaches a seed is awaited (Await rule), and every assert line and test title is byte-identical to START.
- Each of the 36 files passes after its port, and each port commit quotes its pre-edit run printing `exit=0` and its after-run.

## Context

- Shared Context, Port procedure, Port rules, assert check, lint, forbidden and kept lists: as in Plan 1's Context. The Await rule, Await check, order and caller-side delta: as in Plan 7's Context. Plans 1 to 8 are done first.
- `store/faceplate/drawers-volume.test.js`, `store/faceplate/rail-pipelines.test.js` and `store/faceplate/volume.test.js` are not here: their covered calls sit on assert lines (Plan 10 Task 3).
- `store/guards/xfmode-refusal.test.js` and `store/live/polling.test.js` take the seed calls Plan 1 Tasks 5 and 6 left. Polling has one, inside an async test.

## Tasks

### Task 1: Await the seeds in the store drawer suites

- **Files:** tests/js/store/faceplate/drawer-family.test.js, tests/js/store/faceplate/drawer-grammar.test.js, tests/js/store/faceplate/drawer-plate.test.js, tests/js/store/faceplate/drawer-save-restart.test.js, tests/js/store/faceplate/drawer.test.js
- **Action:** Apply the Await rule to the five files, including the `loadLists` call and file-local `runningOn` of `drawer-plate.test.js`. Port procedure on the five files.
- **Verify:** the after-run over the five files prints `exit=0`; the Await check is clean; the assert check is clean; lint prints `exit=0`. Testing scope: the suites' own cases; before the switch the port changes no behavior; no new test; testing stops at the file run.

### Task 2: Await the seeds in the store drawers suites, crossfeed to source

- **Files:** tests/js/store/faceplate/drawers-crossfeed.test.js, tests/js/store/faceplate/drawers-loudness.test.js, tests/js/store/faceplate/drawers-modes.test.js, tests/js/store/faceplate/drawers-output.test.js, tests/js/store/faceplate/drawers-pipelines.test.js, tests/js/store/faceplate/drawers-source/drawers-source.test.js
- **Action:** Apply the Await rule to the six files, including each file-local `load` that seeds and the `beforeEach` of `drawers-source.test.js`. Port procedure on the six files.
- **Verify:** as Task 1, over the six files.

### Task 3: Await the seeds in the store speakers, preset, path, rail, station and switcher suites

- **Files:** tests/js/store/faceplate/drawers-speakers.test.js, tests/js/store/faceplate/loadpreset.test.js, tests/js/store/faceplate/path.test.js, tests/js/store/faceplate/rail-now.test.js, tests/js/store/faceplate/stations.test.js, tests/js/store/faceplate/switcher.test.js
- **Action:** Apply the Await rule to the six files, including `play` and `report` in `path.test.js`, `wire` in `rail-now.test.js` and `serve` in `stations.test.js`. Also include the `loadLists` calls and `beforeEach` of `switcher.test.js`, whose bindings come from a destructured `await import(...)`. Port procedure on the six files.
- **Verify:** as Task 1, over the six files.

### Task 4: Await the seeds in the store alerts-unread and builder suites

- **Files:** tests/js/store/faceplate-alerts/alerts-unread.test.js, tests/js/store/faceplate-builders/profile.test.js, tests/js/store/faceplate-builders/snapshot.test.js
- **Action:** Apply the Await rule to the three files, including `load` in `profile.test.js` and `serve` in `snapshot.test.js`. Port procedure on the three files.
- **Verify:** as Task 1, over the three files.

### Task 5: Await the seeds in the store list suites

- **Files:** tests/js/store/faceplate-lists/dsd-kind.test.js, tests/js/store/faceplate-lists/facets.test.js, tests/js/store/faceplate-lists/options.test.js, tests/js/store/faceplate-lists/rate-cap.test.js
- **Action:** Apply the Await rule to the four files, including their `loadLists` calls and `loadDsd` in `dsd-kind.test.js`. Port procedure on the four files.
- **Verify:** as Task 1, over the four files.

### Task 6: Await the seeds in the store page suites

- **Files:** tests/js/store/faceplate-page/conversion.test.js, tests/js/store/faceplate-page/profile-core.test.js, tests/js/store/faceplate-page/profile.test.js
- **Action:** Apply the Await rule to the three files, including `wire` in `conversion.test.js`, `serve` in `profile-core.test.js` and `form` in `profile.test.js`. Port procedure on the three files.
- **Verify:** as Task 1, over the three files.

### Task 7: Await the seeds in the store guard suites

- **Files:** tests/js/store/guards/applyguard.test.js, tests/js/store/guards/directsdmwarn.test.js, tests/js/store/guards/sdm-hide-superseded.test.js, tests/js/store/guards/xfmode.test.js, tests/js/store/guards/xfmode-refusal.test.js
- **Action:** Apply the Await rule to the five files, including `reset` in `xfmode-refusal.test.js`, which seeds through `seedReadings` since Plan 1 Task 5. Port procedure on the five files.
- **Verify:** as Task 1, over the five files.

### Task 8: Await the seeds in the store live suites

- **Files:** tests/js/store/live/live-reenum.test.js, tests/js/store/live/live.test.js, tests/js/store/live/livepresets.test.js, tests/js/store/live/polling.test.js
- **Action:** Apply the Await rule to the four files, including each file-local `reset` that seeds. Port procedure on the four files.
- **Verify:** as Task 1, over the four files.
