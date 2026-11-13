---
phase: 3
plan: 2
requirements: [INTG-03]
files:
  - .claude/worktrees/integrate/tests/js/support/easy/easyrate.js
  - .claude/worktrees/integrate/tests/js/support/easy/easytiles.js
  - .claude/worktrees/integrate/tests/js/support/field-harness.js
  - .claude/worktrees/integrate/tests/js/support/shaperfit-fixtures.js
  - .claude/worktrees/integrate/tests/js/support/wire/unreadwire.js
  - .claude/worktrees/integrate/tests/js/store/c1-operations.test.js
---

# Phase 3: Retired-shape ports - Plan 2: Shared support helpers

## Goal

Every remaining test and support under `tests/js/` runs on the approved interfaces (design step 12b). This plan ports the shared support helpers that carry a retired shape, before any of their callers (Phase 2 D-03).

## Must be true when done

- No support helper under `tests/js/support/` assigns `config.value` with a `profiles` or `device_caps` key, or serves an `/api/config` answer carrying `data`, `file` or `active`.
- Every importer of each ported helper passes after the port, with asserts byte-identical to START.
- Each port commit quotes its pre-edit run over the helper's importers printing `exit=0`, and its after-run.

## Context

- Shared Context, Port procedure, Port rules, assert check, lint, forbidden and kept lists: as in Plan 1's Context. Plan 1 is done first.
- `tests/js/support/` is a testing strong area: a helper edit is proven over every importer, which is each task's file run.
- Importers, from `grep -rl` over `tests/js` at planning: `easy/easyrate.js` is imported by `easy/easytiles.js`; `easy/easytiles.js` by `store/faceplate-page/presets.test.js`, `components/faceplate-page/presets.test.js` and `support/easy/easytable.js`, which `store/easy/easy.test.js`, `store/easy/easy-pips.test.js`, `store/easy/easy-filtername.test.js` and `store/faceplate-page/presets.test.js` import. `field-harness.js` by `store/narrow/plainnames-flat.test.js`, `store/narrow/plainnames-rec.test.js`, `store/prose-notes.test.js`, `store/prose-options.test.js`, `store/prose-sdm-note.test.js`, `store/simplified-two-stage.test.js`. `shaperfit-fixtures.js` by `components/faceplate-alerts/drawer.test.js`, `components/faceplate-alerts/rail.test.js`, `store/faceplate-alerts/alerts-dropped.test.js`, `store/faceplate-alerts/alerts.test.js`, `store/faceplate-alerts/alerts-unread-saves.test.js`, `store/guards/shaperfit-alerts.test.js`, `store/guards/shaperfit-graying.test.js`, `store/guards/shaperfit-mode-gate.test.js`. `wire/unreadwire.js` by `components/faceplate-alerts/plate-unread.test.js`, `store/c1-operations.test.js`, `store/faceplate-alerts/alerts-unread.test.js` and `support/unreadareas.js` (whose importers are the same three). Each task re-runs the grep before its pre-edit run and adds any importer found since.
- Caller-side delta: only Task 5 changes a caller, one call site in `store/c1-operations.test.js`; every other helper keeps its exported names and signatures.

## Tasks

### Task 1: Drop the profiles key from the easy harness config payload

- **Files:** tests/js/support/easy/easyrate.js
- **Action:** `configPayload` returns form metadata only: remove `profiles: null` (Port rules, null value), and correct its doc comment, which today says the payload carries `profiles` null. The `fields` mapping stays as it is. Port procedure over the easy-family importers listed in Context.
- **Verify:** the after-run over `store/faceplate-page/presets.test.js`, `components/faceplate-page/presets.test.js`, `store/easy/easy.test.js`, `store/easy/easy-pips.test.js`, `store/easy/easy-filtername.test.js` prints `exit=0`; `grep -n profiles tests/js/support/easy/easyrate.js` prints nothing; assert check on those files clean; lint prints `exit=0`. Testing scope: the importers' cases are the coverage; no new test.

### Task 2: Serve the easy harness's /api/config fake in the served-readings shape

- **Files:** tests/js/support/easy/easytiles.js
- **Action:** The `routes` fake answers `/api/config` with the served readings `{ generation, fields }` the harness seeded (Port rules), not `{ data: signals.config.value }`. Correct the doc comment above `FORM` where it says it is the form "as /api/config serves it", since `/api/config` serves readings and `FORM` is the form metadata the `config` signal holds. Keep the other routes, including the `{ data }` answers of `/api/state` and `/api/enumerations` (D-03).
- **Verify:** the after-run over the same five easy-family files prints `exit=0`; `grep -n 'data: signals.config' tests/js/support/easy/easytiles.js` prints nothing; assert check clean; lint prints `exit=0`. Testing scope: as Task 1; a case that now refreshes readings onto real data and changes outcome is adjudicated by the Port procedure's routes, not by a new test.

### Task 3: Drop the profiles key from the field harness

- **Files:** tests/js/support/field-harness.js
- **Action:** In `reset`, the `config.value` assignment carries `fields` alone; remove `profiles: null` (Port rules, null value). Port procedure over the six `field-harness.js` importers.
- **Verify:** the after-run over the six importers prints `exit=0`; `grep -n profiles tests/js/support/field-harness.js` prints nothing; assert check clean; lint prints `exit=0`. Testing scope: the importers' cases; no new test.

### Task 4: Drop the profiles key from the shaper-fit fixtures

- **Files:** tests/js/support/shaperfit-fixtures.js
- **Action:** The `config.value` assignment carries `fields` alone; remove `profiles: null` (Port rules, null value). The two rate-limit fields and their comment stay. Port procedure over the eight `shaperfit-fixtures.js` importers.
- **Verify:** the after-run over the eight importers prints `exit=0`; `grep -n profiles tests/js/support/shaperfit-fixtures.js` prints nothing; assert check clean; lint prints `exit=0`. Testing scope: the importers' cases; no new test.

### Task 5: Port the unread wire's config form and its one caller

- **Files:** tests/js/support/wire/unreadwire.js, tests/js/store/c1-operations.test.js
- **Action:** `CONFIG()` carries the retired `file`, `active` and `profiles` keys. The station metadata `READINGS()` serves keeps its exact value, the `profiles` reading `{ value: { value: "Day", options: [...] }, readonly: true }`, written in `READINGS` itself rather than read through `CONFIG()`. `CONFIG` then holds only form metadata, or is deleted if no caller needs it (knip refuses an unused export). In `c1-operations.test.js`, the setup assigns `config.value` form metadata only, with no `profiles` key, and keeps its other imports from the wire. Port procedure over `c1-operations.test.js`, `components/faceplate-alerts/plate-unread.test.js` and `store/faceplate-alerts/alerts-unread.test.js`. Leave the `profiles` keys those two alert suites write into `config.value` themselves: Plans 3 and 5 port them.
- **Verify:** the after-run over the three files prints `exit=0`; `grep -n -E '^\s*(file|active|profiles)\s*:' tests/js/support/wire/unreadwire.js` prints exactly one line, the `profiles` reading inside `READINGS`, and `grep -n 'CONFIG()' tests/js/support/wire/unreadwire.js` prints nothing; `grep -n profiles tests/js/store/c1-operations.test.js` prints nothing; assert check clean; lint prints `exit=0`. Testing scope: the three suites' cases; no new test.

## Notes

- Plan 1 runs first; Plans 3 and 5 run after this plan, since they port suites importing `unreadwire.js` and `shaperfit-fixtures.js` callers whose helpers must already be ported.
