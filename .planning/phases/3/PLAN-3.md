---
phase: 3
plan: 3
requirements: [INTG-03]
files:
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-schema.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-seemore.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-pin-glass.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-dsdrow.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-backenddesc.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-ratedesc.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-ratehead.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/header.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/header-dropped.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/header-dropped-clear.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/plate-dropped.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/plate-unread.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/plate-unread-saves.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/xref.test.js
---

# Phase 3: Retired-shape ports - Plan 3: Output drawer and alert component suites

## Goal

Every remaining test and support under `tests/js/` runs on the approved interfaces (design step 12b). This plan ports the `profiles` and `device_caps` keys out of the `config.value` fixtures of the output drawer and alert component suites.

## Must be true when done

- No `config.value` assignment in this plan's sixteen files carries a `profiles` or `device_caps` key.
- Each of the sixteen files passes after its port, with asserts byte-identical to START.
- Each port commit quotes its pre-edit run printing `exit=0`, and its after-run.

## Context

- Shared Context, Port procedure, Port rules, assert check, lint, forbidden and kept lists: as in Plan 1's Context. Plans 1 and 2 are done first; `plate-unread.test.js` imports the `unreadwire.js` Plan 2 Task 5 ported.
- The nine output drawer suites each assign `profiles: null` and `device_caps` in the setup's `config.value` block. In `drawers-output.test.js` the value is the `caps` option of `load`, whose only call passes none, so it is `null` too.
- The seven alert suites assign `profiles` with station options (`["", "Day"]`) in `config.value`, except `xref.test.js`, which assigns `null`. Their setups seed `active_preset` and no `profiles` reading, so the non-null value moves into that setup's `seedReadings` call per the Port rules. D-04: none of these files serves a wire literal carrying a D-01 key beyond these fixtures.
- Each task's Verify ends with the AC1 check on its files: `grep -n -E '^\s*(profiles|device_caps)\s*:' <files>` prints no line inside a `config.value` block, read against the setup.

## Tasks

### Task 1: Port the output drawer suites' form fixtures, first three

- **Files:** tests/js/components/faceplate-drawers-output/drawers-output.test.js, tests/js/components/faceplate-drawers-output/drawers-output-schema.test.js, tests/js/components/faceplate-drawers-output/drawers-output-seemore.test.js
- **Action:** Remove `profiles: null` and `device_caps` from each setup's `config.value` block (Port rules, null value). In `drawers-output.test.js`, remove the now-unused `caps` option of `load` and correct its doc comment, which says the device caps are part of the form's metadata. Port procedure on the three files.
- **Verify:** the after-run over the three files prints `exit=0`; the AC1 check is clean; assert check clean; lint prints `exit=0`. Testing scope: the suites' own cases; no new test.

### Task 2: Port the output drawer suites' form fixtures, pin and DSD row

- **Files:** tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js, tests/js/components/faceplate-drawers-output/drawers-output-pin-glass.test.js, tests/js/components/faceplate-drawers-output/drawers-output-dsdrow.test.js
- **Action:** Remove `profiles: null` and `device_caps: null` from each setup's `config.value` block. Port procedure on the three files.
- **Verify:** the after-run over the three files prints `exit=0`; the AC1 check is clean; assert check clean; lint prints `exit=0`. Testing scope: as Task 1.

### Task 3: Port the output drawer suites' form fixtures, descriptions and rate head

- **Files:** tests/js/components/faceplate-drawers-output/drawers-output-backenddesc.test.js, tests/js/components/faceplate-drawers-output/drawers-output-ratedesc.test.js, tests/js/components/faceplate-drawers-output/drawers-output-ratehead.test.js
- **Action:** Remove `profiles: null` and `device_caps: null` from each setup's `config.value` block. Port procedure on the three files.
- **Verify:** the after-run over the three files prints `exit=0`; the AC1 check is clean; assert check clean; lint prints `exit=0`. Testing scope: as Task 1.

### Task 4: Port the header alert suites' station metadata

- **Files:** tests/js/components/faceplate-alerts/header.test.js, tests/js/components/faceplate-alerts/header-dropped.test.js, tests/js/components/faceplate-alerts/header-dropped-clear.test.js
- **Action:** Each setup's `config.value` holds `fields` alone. The station options its `profiles` key held move into the setup's one `seedReadings` call as the read-only `profiles` reading, whose value is the `{ options }` object production's `metadataValue("profiles")` reads (`hqptuner/static/store/faceplate/stations.js`). Port procedure on the three files.
- **Verify:** the after-run over the three files prints `exit=0`; the AC1 check is clean; each file's `seedReadings` call in the setup carries a `profiles` reading with `readonly: true`; assert check clean; lint prints `exit=0`. Testing scope: the suites' own cases; a case whose outcome changes now that stations reach production takes the Port procedure's routes; no new test.

### Task 5: Port the plate and cross-reference alert suites' station metadata

- **Files:** tests/js/components/faceplate-alerts/plate-dropped.test.js, tests/js/components/faceplate-alerts/plate-unread.test.js, tests/js/components/faceplate-alerts/plate-unread-saves.test.js, tests/js/components/faceplate-alerts/xref.test.js
- **Action:** As Task 4 for the three plate suites. In `xref.test.js`, remove `profiles: null` (null value). Port procedure on the four files.
- **Verify:** the after-run over the four files prints `exit=0`; the AC1 check is clean; the three plate setups seed a read-only `profiles` reading; assert check clean; lint prints `exit=0`. Testing scope: as Task 4.

## Notes

- Moving a non-null `profiles` value into the readings, rather than deleting it, is the planner's reading of "port onto the approved interfaces": the fixture's stations then reach production through the path it reads. Where that changes a case's outcome, the Port procedure decides the route; it never licenses an assert edit.
