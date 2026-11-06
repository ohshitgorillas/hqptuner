---
phase: 3
plan: 5
requirements: [INTG-03]
files:
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawer-grammar.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawer-save-restart.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawer.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/applyguard.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/directsdmwarn.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/sdm-hide-superseded.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-alerts/alerts-unread.test.js
---

# Phase 3: Retired-shape ports - Plan 5: Store suites

## Goal

Every remaining test and support under `tests/js/` runs on the approved interfaces (design step 12b). This plan ports the `profiles` keys out of the store suites' `config.value` fixtures and the `live_profiles` key out of the one store guard suite's `matrixConfig.value` fixture.

## Must be true when done

- No `config.value` assignment in this plan's seven files carries a `profiles` or `device_caps` key, and no `matrixConfig.value` assignment carries `live_profiles` or `live_active`.
- Each of the seven files passes after its port, with asserts byte-identical to START, and each port commit quotes its pre-edit run printing `exit=0` and its after-run.

## Context

- Shared Context, Port procedure, Port rules, assert check, lint, forbidden and kept lists: as in Plan 1's Context. Plans 1 to 4 are done first; `alerts-unread.test.js` imports the `unreadwire.js` Plan 2 Task 5 ported.
- `null`-valued `profiles` keys: `drawer-grammar`, `drawer-save-restart`, `store/faceplate/drawer`, `applyguard`, `directsdmwarn`, and both `config.value` assignments of `sdm-hide-superseded`. `sdm-hide-superseded` also writes `live_profiles: []` into `matrixConfig.value`, beside `file_profiles: {}`, which stays (D-03). `alerts-unread` assigns station options and seeds `active_preset` with no `profiles` reading.
- Each task's Verify ends with the AC1 check on its files: `grep -n -E '(^|[^_a-z])(profiles|device_caps)\s*:' <files>` and `grep -n -E 'live_(profiles|active)\s*:' <files>` print no line inside a `config.value` or `matrixConfig.value` assignment, read against the setup.

## Tasks

### Task 1: Port the store drawer suites' form fixtures

- **Files:** tests/js/store/faceplate/drawer-grammar.test.js, tests/js/store/faceplate/drawer-save-restart.test.js, tests/js/store/faceplate/drawer.test.js
- **Action:** Remove `profiles: null` from each `config.value` assignment (Port rules, null value). Port procedure on the three files.
- **Verify:** the after-run over the three files prints `exit=0`; the AC1 check is clean; assert check clean; lint prints `exit=0`. Testing scope: the suites' own cases; no new test.

### Task 2: Port the apply and direct-SDM guard suites' form fixtures

- **Files:** tests/js/store/guards/applyguard.test.js, tests/js/store/guards/directsdmwarn.test.js
- **Action:** Remove `profiles: null` from each `config.value` assignment. The `fields` mappings stay. Port procedure on the two files.
- **Verify:** the after-run over the two files prints `exit=0`; the AC1 check is clean; assert check clean; lint prints `exit=0`. Testing scope: as Task 1.

### Task 3: Port the SDM hide-superseded suite's form and matrix fixtures

- **Files:** tests/js/store/guards/sdm-hide-superseded.test.js
- **Action:** Remove `profiles: null` from both `config.value` assignments, and `live_profiles: []` from the `matrixConfig.value` assignment, keeping its `fields` and `file_profiles` (D-03). An empty daemon profile list needs no seed. Port procedure on this file.
- **Verify:** the after-run prints `exit=0`; the AC1 check is clean; assert check clean; lint prints `exit=0`. Testing scope: as Task 1.

### Task 4: Port the store alerts unread suite's station metadata

- **Files:** tests/js/store/faceplate-alerts/alerts-unread.test.js
- **Action:** The setup's `config.value` holds `fields` alone, and its station options move into the setup's one `seedReadings` call, which carries `active_preset`, as the read-only `profiles` reading `{ value: { options }, readonly: true }` (Port rules, non-null value). Port procedure on this file.
- **Verify:** the after-run prints `exit=0`; the AC1 check is clean; the setup seeds a read-only `profiles` reading; assert check clean; lint prints `exit=0`. Testing scope: the suite's own cases; a case whose outcome changes now that stations reach production takes the Port procedure's routes; no new test.
