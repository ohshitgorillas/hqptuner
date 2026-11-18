---
phase: 7
plan: 13
requirements: []
files:
  - tests/js/components/faceplate-builders/builder.test.js
  - tests/js/components/faceplate-builders/profile-steps.test.js
  - tests/js/components/faceplate-builders/profile.test.js
  - tests/js/components/faceplate-builders/rail.test.js
  - tests/js/components/faceplate-builders/rows.test.js
  - tests/js/store/faceplate-builders/profile.test.js
  - tests/js/store/faceplate-builders/snapshot.test.js
  - tests/js/store/narrow/plainnames-flat.test.js
  - tests/js/support/profile-fixtures.js
  - tests/js/support/rendered/builderwire.js
  - tests/js/components/faceplate-controls/numbox.test.js
  - tests/js/components/faceplate-controls/select.test.js
  - tests/js/components/faceplate-controls/slider.test.js
  - tests/js/support/controls.js
  - tests/js/components/faceplate-alerts/drawer.test.js
  - tests/js/components/faceplate-alerts/header.test.js
  - tests/js/components/faceplate-alerts/plate-unread-saves.test.js
  - tests/js/components/faceplate-alerts/plate-unread.test.js
  - tests/js/components/faceplate-alerts/rail.test.js
  - tests/js/components/faceplate-settings/rail.test.js
  - tests/js/store/faceplate-alerts/alerts-unread.test.js
  - tests/js/store/faceplate-alerts/alerts.test.js
  - tests/js/support/wire/unreadsaves.js
  - tests/js/support/alerts.js
  - tests/js/components/faceplate-lists/console.test.js
  - tests/js/components/faceplate-lists/default-mark.test.js
  - tests/js/components/faceplate-lists/option-list.test.js
  - tests/js/store/faceplate-lists/facets.test.js
  - tests/js/components/faceplate-page/conversion.test.js
  - tests/js/store/faceplate-page/conversion.test.js
  - tests/js/components/faceplate-page/meter-rangebuttons.test.js
  - tests/js/components/faceplate-page/meter-vu.test.js
  - tests/js/components/faceplate-page/presets.test.js
  - tests/js/store/faceplate-page/presets.test.js
  - tests/js/support/listsfixture.js
  - tests/js/support/pagefixtures.js
  - tests/js/components/faceplate-settings/about-state-import-owed.test.js
  - tests/js/components/faceplate-settings/about-state-import-stores.test.js
  - tests/js/components/faceplate-settings/about-state-import.test.js
  - tests/js/support/aboutstate.js
  - tests/js/components/faceplate/display-delay.test.js
  - tests/js/support/page.js
  - tests/js/components/faceplate/display-span.test.js
  - tests/js/components/faceplate/display.test.js
  - tests/js/components/faceplate/header.test.js
  - tests/js/store/faceplate/loadpreset.test.js
  - tests/js/support/connpanel.js
  - tests/js/components/faceplate/hf-filter.test.js
  - tests/js/store/faceplate/hf.test.js
  - tests/js/components/faceplate/switcher.test.js
  - tests/js/store/faceplate/switcher.test.js
  - tests/js/support/switcherwire.js
  - tests/js/components/faceplate/rail-staged.test.js
  - tests/js/store/faceplate/drawer-family.test.js
  - tests/js/support/rendered/treewalk.js
  - tests/js/app/import.test.js
  - tests/js/app/no-app.test.js
  - tests/js/components/matrix/library-clear.test.js
---

# Phase 7: One time base - Plan 13: No duplicated component test rigs

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- `npx jscpd --format javascript` reports no clone with a side in the builder, control, alert, list, page, settings, faceplate, app or matrix component suites, except import lists repeated across split test files.
- Every one of those suites still passes or fails exactly as at commit `503ddec8`, under the same count.

## Context

- D-03 binds this plan, with Plan 12's clone rules, `docs/spec/testing.md` constraints and common Verify, applied to each task's own files. Shared helpers go under `tests/js/support/`; the new support modules' names are the planner's. `filepawl accept` runs whenever filepawl prints it.
- Two suites carry near-identical tests side by side; folding them into one parametrized case keeps every case and its name.

## Tasks

### Task 1: The builder suites share their wire, readings and staged rows

- **Files:** tests/js/components/faceplate-builders/builder.test.js, tests/js/components/faceplate-builders/profile-steps.test.js, tests/js/components/faceplate-builders/profile.test.js, tests/js/components/faceplate-builders/rail.test.js, tests/js/components/faceplate-builders/rows.test.js, tests/js/store/faceplate-builders/profile.test.js, tests/js/store/faceplate-builders/snapshot.test.js, tests/js/store/narrow/plainnames-flat.test.js, tests/js/support/profile-fixtures.js, tests/js/support/rendered/builderwire.js
- **Reads:** tests/js/components/faceplate-builders/profile-steps.test.js#pendingOf, tests/js/store/faceplate-builders/profile.test.js#pendingOf, tests/js/support/profile-fixtures.js, docs/spec/testing.md
- **Decisions:** D-03
- **Action:** Clones removed (16): builder~rail three times and builder~rows twice (the readings seed, the wire, the engine state), profile-steps~store profile four times and the component `profile.test.js`~store `profile.test.js` (the loaded profile tables and `pendingOf`), rows~snapshot four times and rows~plainnames-flat (the stations menu, the chain and the shapers), the `rows.test.js` self-clone. The flagged assumption on `pendingOf`, which builds a staged value from pending state: read it against rule 13 first. If it answers by the algorithm under test, the shared rig answers from a table the tests write; if it only plumbs, it is shared as it is. The commit says which.
- **Verify:** Plan 12's common Verify over this task's files, plus the commit message records the rule 13 reading of `pendingOf`.

### Task 2: The control suites share their input fake and their tables

- **Files:** tests/js/components/faceplate-controls/numbox.test.js, tests/js/components/faceplate-controls/select.test.js, tests/js/components/faceplate-controls/slider.test.js, tests/js/support/controls.js
- **Reads:** tests/js/components/faceplate-controls/numbox.test.js, tests/js/components/faceplate-controls/slider.test.js
- **Decisions:** D-03
- **Action:** Clones removed (6): the fake input element and its handlers (numbox~slider, numbox~select), the clamp table and the grayed-box table (numbox against slider and select).
- **Verify:** Plan 12's common Verify over this task's files.

### Task 3: The alert suites share their unread-saves rig

- **Files:** tests/js/components/faceplate-alerts/drawer.test.js, tests/js/components/faceplate-alerts/header.test.js, tests/js/components/faceplate-alerts/plate-unread-saves.test.js, tests/js/components/faceplate-alerts/plate-unread.test.js, tests/js/components/faceplate-alerts/rail.test.js, tests/js/components/faceplate-settings/rail.test.js, tests/js/store/faceplate-alerts/alerts-unread.test.js, tests/js/store/faceplate-alerts/alerts.test.js, tests/js/support/wire/unreadsaves.js, tests/js/support/alerts.js
- **Reads:** tests/js/support/wire/unreadsaves.js, tests/js/components/faceplate-alerts/plate-unread-saves.test.js
- **Decisions:** D-03
- **Action:** Clones removed (7): the advice fixture (alerts drawer~store alerts), the static wire and discard steps (header~plate-unread-saves twice), the saves rig (plate-unread-saves~plate-unread twice, ~alerts-unread), the rail buttons finder (alerts `rail.test.js`~settings `rail.test.js`). Expected to stay: plate-unread-saves~plate-unread lines 30-37, an import list.
- **Verify:** Plan 12's common Verify over this task's files.

### Task 4: The list and page suites share their loaders and button tables

- **Files:** tests/js/components/faceplate-lists/console.test.js, tests/js/components/faceplate-lists/default-mark.test.js, tests/js/components/faceplate-lists/option-list.test.js, tests/js/store/faceplate-lists/facets.test.js, tests/js/components/faceplate-page/conversion.test.js, tests/js/store/faceplate-page/conversion.test.js, tests/js/components/faceplate-page/meter-rangebuttons.test.js, tests/js/components/faceplate-page/meter-vu.test.js, tests/js/components/faceplate-page/presets.test.js, tests/js/store/faceplate-page/presets.test.js, tests/js/support/listsfixture.js, tests/js/support/pagefixtures.js
- **Reads:** tests/js/support/listsfixture.js, tests/js/components/faceplate-page/presets.test.js
- **Decisions:** D-03
- **Action:** Clones removed (5): the kept-rate table (console~facets), the defaults serve (default-mark~option-list), the conversion metadata (component~store `conversion.test.js`), the range buttons (meter-rangebuttons~meter-vu), the lists load (component~store `presets.test.js`). Expected to stay: console~rate-floor-row, meter-rangebuttons against meter-vu and meter (lines 12-20), import lists.
- **Verify:** Plan 12's common Verify over this task's files.

### Task 5: The state import suites share their rig

- **Files:** tests/js/components/faceplate-settings/about-state-import-owed.test.js, tests/js/components/faceplate-settings/about-state-import-stores.test.js, tests/js/components/faceplate-settings/about-state-import.test.js, tests/js/support/aboutstate.js
- **Reads:** tests/js/components/faceplate-settings/about-state-import-owed.test.js
- **Decisions:** D-03
- **Action:** Clones removed (3): the refusing switch and the store imports loaded after it (owed against stores twice and against `about-state-import.test.js`). Expected to stay: hardware-stale~store `hardware.test.js`, an import list.
- **Verify:** Plan 12's common Verify over this task's files.

### Task 6: The faceplate suites share their page, panel and switcher rigs

- **Files:** tests/js/components/faceplate/display-delay.test.js, tests/js/support/page.js, tests/js/components/faceplate/display-span.test.js, tests/js/components/faceplate/display.test.js, tests/js/components/faceplate/header.test.js, tests/js/store/faceplate/loadpreset.test.js, tests/js/support/connpanel.js, tests/js/components/faceplate/hf-filter.test.js, tests/js/store/faceplate/hf.test.js, tests/js/components/faceplate/switcher.test.js, tests/js/store/faceplate/switcher.test.js, tests/js/support/switcherwire.js, tests/js/components/faceplate/rail-staged.test.js, tests/js/store/faceplate/drawer-family.test.js, tests/js/support/rendered/treewalk.js
- **Reads:** tests/js/support/page.js, tests/js/support/rendered/treewalk.js, tests/js/components/faceplate/switcher.test.js
- **Decisions:** D-03
- **Action:** Clones removed (13): the node removal (display-delay~`page.js`), the span setup (display-span~display), the connection panel rig (header~loadpreset twice), the running-junk reading (hf-filter~store `hf.test.js`), the posts and inflight wire (hf-filter~component `switcher.test.js` twice), the staged rail (rail-staged~drawer-family), the switcher rig (component~store `switcher.test.js` four times), the children walk (component `switcher.test.js`~`treewalk.js`). Expected to stay: display-meters~display-range and rail-staged~`rail.test.js`, import lists.
- **Verify:** Plan 12's common Verify over this task's files.

### Task 7: The app and matrix suites drop their copied cases

- **Files:** tests/js/app/import.test.js, tests/js/app/no-app.test.js, tests/js/components/matrix/library-clear.test.js
- **Reads:** tests/js/app/import.test.js, tests/js/app/no-app.test.js, tests/js/components/matrix/library-clear.test.js
- **Decisions:** D-03
- **Action:** Clones removed (2): the import-and-ask-nothing case (import~no-app), and the `library-clear.test.js` self-clone (two near-identical tests folded into one parametrized case, both kept). Both app suites keep their tests; only the shared body moves.
- **Verify:** Plan 12's common Verify over this task's files, plus the case count: the run over this task's test files reports the same number of passing cases as before the task, each row of a parametrized case counted on its own, and every case name printed before the task is printed after it.
