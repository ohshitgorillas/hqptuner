---
phase: 3
plan: 6
requirements: [INTG-03]
files:
  - .claude/worktrees/integrate/tests/js/store/faceplate/loadpreset.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/header.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/switcher.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/switcher.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/rail-staged.test.js
  - .claude/worktrees/integrate/tests/js/store/live/remirror.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/about-state-import-owed.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/about-state-import-stores.test.js
---

# Phase 3: Retired-shape ports - Plan 6: The /api/config data fakes

## Goal

Every remaining test and support under `tests/js/` runs on the approved interfaces (design step 12b). This plan ports the remaining `/api/config` fakes that answer `{ data }`.

## Must be true when done

- No `/api/config` fake under `tests/js/` answers a body carrying `data`, and no `config` push fake remains.
- Each of the eight files passes after its port, with asserts byte-identical to START, and each port commit quotes its pre-edit run printing `exit=0` and its after-run.

## Context

- Shared Context, Port procedure, Port rules, assert check, lint, forbidden and kept lists: as in Plan 1's Context. Plans 1 to 5 are done first.
- The `{ data }` answers: `loadpreset.test.js` and `components/faceplate/header.test.js` in their `answer` functions; both `switcher.test.js` files in their `READS` tables (copying `config.value`); `rail-staged.test.js` in its `stagingWire` routes; `remirror.test.js` in its overlap wire (with retired `file`, `active` and `profiles` inside); both `about-state-import-*` files in their `stagingWire` routes, each also assigning `profiles: null` in a module-scope `config.value`. Each `{ data }` answer on `/api/state`, `/api/enumerations`, `/api/matrix` or `/api/speakers` in these files stays (D-03).
- Recalled: Phase 2 `SUMMARY.md` lists `header.test.js:67` and `remirror.test.js:91` among the passing fakes still serving `{ data }`.
- The `/api/config` answers these tasks write serve `readings.value` as the setup seeded it; that read stays valid after Plan 10 Task 7, since the seed then reaches `readings` through `refreshReadings` and the test's own wire never answers the seed's request.
- Each port task's Verify ends with `grep -n -E 'api/config.*data *:' <files>` printing nothing.

## Tasks

### Task 1: Serve readings from the preset-load and header answer fakes

- **Files:** tests/js/store/faceplate/loadpreset.test.js, tests/js/components/faceplate/header.test.js
- **Action:** Each `answer` function's `/api/config` branch answers the served readings the setup seeded, `readings.value` in the `{ generation, fields }` shape (Port rules), not `{ data: config.value }`. Port procedure on the two files.
- **Verify:** the after-run over the two files prints `exit=0`; the `data` grep is clean; assert check clean; lint prints `exit=0`. Testing scope: the suites' own cases; a case that now refreshes onto the seeded readings and changes outcome takes the Port procedure's routes; no new test.

### Task 2: Serve readings from the switcher read tables

- **Files:** tests/js/store/faceplate/switcher.test.js, tests/js/components/faceplate/switcher.test.js
- **Action:** Each `READS` table's `/api/config` entry answers a copy of the served readings in the `{ generation, fields }` shape, not `{ data: { ...config.value } }`, keeping the copy so a later write to the signal does not reach an answer already given. Port procedure on the two files.
- **Verify:** the after-run over the two files prints `exit=0`; the `data` grep is clean; assert check clean; lint prints `exit=0`. Testing scope: as Task 1.

### Task 3: Serve readings from the staged rail's wire

- **Files:** tests/js/components/faceplate/rail-staged.test.js
- **Action:** The `stagingWire` route for `/api/config` answers the served readings in the `{ generation, fields }` shape, or is removed so the wire's unrouted answer serves it, whichever leaves the file's cases passing as at the pre-edit run; record the choice in the commit message. The `/api/matrix` and `/api/speakers` routes stay. Port procedure on this file.
- **Verify:** the after-run prints `exit=0`; the `data` grep is clean; assert check clean; lint prints `exit=0`. Testing scope: as Task 1.

### Task 4: Serve readings from the remirror overlap wire

- **Files:** tests/js/store/live/remirror.test.js
- **Action:** The overlap wire's `/api/config` branch answers a served-readings body `{ generation, fields }` carrying no `file`, `active` or `profiles` key, in place of `{ data: { fields: [], file: {}, active: "", profiles: null } }`. The `/api/state` and `/api/enumerations` `{ data }` answers stay (D-03). Port procedure on this file.
- **Verify:** the after-run prints `exit=0`; the `data` grep is clean; `grep -n -E 'file: \{\}|active: ""|profiles' tests/js/store/live/remirror.test.js` prints nothing; assert check clean; lint prints `exit=0`. Testing scope: as Task 1.

### Task 5: Port the about-state import suites' config fake and form

- **Files:** tests/js/components/faceplate-settings/about-state-import-owed.test.js, tests/js/components/faceplate-settings/about-state-import-stores.test.js
- **Action:** Each `stagingWire` route for `/api/config` answers the served readings in the `{ generation, fields }` shape, not `{ data: { fields: FIELDS, ... } }`, so the form metadata `FIELDS` no longer rides the readings route. Each module-scope `config.value` assignment holds `fields` alone, with `profiles: null` removed (Port rules, null value). Port procedure on the two files.
- **Verify:** the after-run over the two files prints `exit=0`; the `data` grep is clean; `grep -n profiles: <files>` finds no line in a `config.value` assignment or `/api/config` answer; assert check clean; lint prints `exit=0`. Testing scope: as Task 1.

## Notes

- The phase exit check, formerly this plan's Task 6, is Plan 10 Task 8: it runs after the await ports and the seed switch of Plans 7 to 10. The Notes paragraph that listed `readings.value =` hits as expected is withdrawn (owner ruling 2026-11-06); Plan 10 counts any such hit outside the two reading-model suites as a failure.
