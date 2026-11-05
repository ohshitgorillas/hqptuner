---
phase: 2
plan: 5
requirements: [INTG-01, INTG-02]
files:
  - .claude/worktrees/integrate/tests/js/store/guards/applyguard.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/directsdmwarn.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/sdm-hide-superseded.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/xfmode.test.js
  - .claude/worktrees/integrate/tests/js/store/hardware-catalog.test.js
  - .claude/worktrees/integrate/tests/js/store/loudness-applied.test.js
  - .claude/worktrees/integrate/tests/js/store/pipeline-baseline.test.js
  - .claude/worktrees/integrate/tests/js/store/structural-roundtrip.test.js
  - .claude/worktrees/integrate/tests/js/store/fixed-volume-readings.test.js
  - .claude/worktrees/integrate/tests/js/store/live/live-reenum.test.js
  - .claude/worktrees/integrate/tests/js/store/live/livepresets.test.js
  - .claude/worktrees/integrate/tests/js/store/narrow/narrowing-rate.test.js
  - .claude/worktrees/integrate/tests/js/store/presets/presets.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-page/presets.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/bufferwarn.test.js
  - .claude/worktrees/integrate/tests/js/store/c1-operations.test.js
  - .claude/worktrees/integrate/tests/js/store/core/control.test.js
  - .claude/worktrees/integrate/tests/js/store/spken-catalog.test.js
  - .claude/worktrees/integrate/tests/js/store/narrow/localbackends.test.js
  - .claude/worktrees/integrate/tests/js/store/presets/matrixmode-preset.test.js
  - .claude/worktrees/integrate/tests/js/store/live/live.test.js
  - .claude/worktrees/integrate/tests/js/store/live/polling.test.js
  - .claude/worktrees/integrate/tests/js/store/live/remirror.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-page/conversion.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-page/profile-core.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-page/profile.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-lists/rate-cap.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-lists/dsd-kind.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-lists/default-mark.test.js
---

# Phase 2: Baseline recovery - Plan 5: Guard, catalog, live and preset store suites

## Goal

The JS baseline in `.claude/worktrees/integrate` passes, through repaired test machinery and fixed production defects, with every valid claim unchanged (design step 12a). This plan recovers the remaining store suites and migrates the last passing files that seed values.

## Must be true when done

- Every baseline failure in this plan's failing files that `routes.md` routes as `repair` passes, with claims and assert lines byte-identical to BASE.
- Every file of this plan meets the AC3 check.
- Every passing file migrated here has its pre-edit pass recorded and passes after the edit.
- Each failure left open carries a `Builder route:` or `Contract mismatch:` line in its task's commit message.

## Context

- Locked decisions, paths, file run, assert check, lint, BASE and the forbidden list as in Plan 1's Context. The AC3 check, the route procedure and the passing-file procedure are as in Plan 3's Context. Plans 1 to 4 are done first.
- `store/faceplate-page/presets.test.js` imports `easy/easytiles.js`. `narrow/localbackends.test.js` imports `devicecaps-harness.js`. `faceplate-page/profile.test.js` imports `profile-fixtures.js`. `faceplate-lists/rate-cap.test.js`, `store/faceplate-lists/dsd-kind.test.js` and `components/faceplate-lists/default-mark.test.js` import `listsfixture.js`. Their helper calls stay as they are, and only their own seeds move (D-02, D-10).
- Each task's Verify ends with the assert check, the AC3 check on its files, and lint.

## Tasks

### Task 1: Recover the failing guard suites

- **Files:** .claude/worktrees/integrate/tests/js/store/guards/applyguard.test.js, .claude/worktrees/integrate/tests/js/store/guards/directsdmwarn.test.js, .claude/worktrees/integrate/tests/js/store/guards/sdm-hide-superseded.test.js, .claude/worktrees/integrate/tests/js/store/guards/xfmode.test.js
- **Action:** Apply the route procedure to every baseline failure in these four files. Two failure lines are named in D-05. One is `direct_sdm is not staged: effective() reads null, not 1`, thrown by `applyguard.test.js`'s own staging check, whose fixtures carry `direct_sdm` as a `config.value` field value and `file`. The other is `expected a recognized block`, thrown by `xfmode.test.js`'s setup. The thrown message lines are claims, and they stay byte-identical.
- **Verify:** A file run over the four files prints `exit=0`, except tests under `Builder route:`. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 2: Recover the failing catalog and pipeline store suites

- **Files:** .claude/worktrees/integrate/tests/js/store/hardware-catalog.test.js, .claude/worktrees/integrate/tests/js/store/loudness-applied.test.js, .claude/worktrees/integrate/tests/js/store/pipeline-baseline.test.js, .claude/worktrees/integrate/tests/js/store/structural-roundtrip.test.js, .claude/worktrees/integrate/tests/js/store/fixed-volume-readings.test.js
- **Action:** Apply the route procedure to every baseline failure in these five files. Pipeline rows held in `matrixConfig.value.rows` move to `matrix_pipelines` readings.
- **Verify:** A file run over the five files prints `exit=0`, except tests under `Builder route:`. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 3: Recover the failing live, narrowing and preset suites

- **Files:** .claude/worktrees/integrate/tests/js/store/live/live-reenum.test.js, .claude/worktrees/integrate/tests/js/store/live/livepresets.test.js, .claude/worktrees/integrate/tests/js/store/narrow/narrowing-rate.test.js, .claude/worktrees/integrate/tests/js/store/presets/presets.test.js, .claude/worktrees/integrate/tests/js/store/faceplate-page/presets.test.js
- **Action:** Apply the route procedure to every baseline failure in these five files. For `faceplate-page/presets.test.js`, failures that Plan 1 Task 5 settled in the easy helpers already pass. The ones left, such as the extra `lifelike>concert-hall` and `perfect-ten>concert-hall` rows, take their own `routes.md` route.
- **Verify:** A file run over the five files prints `exit=0`, except tests under `Builder route:`. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 4: Migrate the passing guard, operations and catalog suites' seeds

- **Files:** .claude/worktrees/integrate/tests/js/store/guards/bufferwarn.test.js, .claude/worktrees/integrate/tests/js/store/c1-operations.test.js, .claude/worktrees/integrate/tests/js/store/core/control.test.js, .claude/worktrees/integrate/tests/js/store/spken-catalog.test.js, .claude/worktrees/integrate/tests/js/store/narrow/localbackends.test.js, .claude/worktrees/integrate/tests/js/store/presets/matrixmode-preset.test.js
- **Action:** Apply the passing-file procedure to these six files.
- **Verify:** The commit message quotes the pre-edit `exit=0`. A file run over the six files prints `exit=0` after the edit. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 5: Migrate the passing live, page and list suites' seeds

- **Files:** .claude/worktrees/integrate/tests/js/store/live/live.test.js, .claude/worktrees/integrate/tests/js/store/live/polling.test.js, .claude/worktrees/integrate/tests/js/store/live/remirror.test.js, .claude/worktrees/integrate/tests/js/store/faceplate-page/conversion.test.js, .claude/worktrees/integrate/tests/js/store/faceplate-page/profile-core.test.js, .claude/worktrees/integrate/tests/js/store/faceplate-page/profile.test.js, .claude/worktrees/integrate/tests/js/store/faceplate-lists/rate-cap.test.js
- **Action:** Apply the passing-file procedure to these seven files.
- **Verify:** The commit message quotes the pre-edit `exit=0`. A file run over the seven files prints `exit=0` after the edit. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 6: Migrate the passing DSD list suites' seeds

- **Files:** .claude/worktrees/integrate/tests/js/store/faceplate-lists/dsd-kind.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-lists/default-mark.test.js
- **Action:** Apply the passing-file procedure to these two files. Each file's local `selectField` builds field entries carrying `value: options[0][0]` (`dsd-kind.test.js:61`, `default-mark.test.js:63`), which `loadDsd` and `serve` spread into `config.value`. Strip `value` from those entries and seed those values through `seedReadings`. Their `listsfixture.js` calls stay as they are (D-02, D-10).
- **Verify:** The commit message quotes the pre-edit `exit=0`. A file run over the two files prints `exit=0` after the edit. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.
