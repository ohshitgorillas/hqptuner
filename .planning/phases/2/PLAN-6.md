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
