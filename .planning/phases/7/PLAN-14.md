---
phase: 7
plan: 14
requirements: []
files:
  - tests/js/store/core/control.test.js
  - tests/js/store/core/forms-applied.test.js
  - tests/js/store/core/forms-reads.test.js
  - tests/js/store/core/forms.test.js
  - tests/js/store/core/readings.test.js
  - tests/js/support/readings.js
  - tests/js/store/live/live-reenum.test.js
  - tests/js/store/live/live.test.js
  - tests/js/store/live/remirror.test.js
  - tests/js/support/wire/livepresetwire.js
  - tests/js/store/guards/applyguard.test.js
  - tests/js/store/guards/directsdmwarn.test.js
  - tests/js/store/guards/sdm-hide-superseded.test.js
  - tests/js/store/guards/xfmode-refusal.test.js
  - tests/js/store/pipeline-baseline.test.js
  - tests/js/support/shaperfit-fixtures.js
  - tests/js/support/wire/wire.js
  - tests/js/store/narrow/length-facet.test.js
  - tests/js/store/narrow/phase-facet.test.js
  - tests/js/store/narrow/narrowing-rate.test.js
  - tests/js/store/narrow/quality-facet-default.test.js
  - tests/js/store/narrow/plainnames-flat.test.js
  - tests/js/store/narrow/plainnames-rec.test.js
  - tests/js/support/wire/narrowingwire.js
  - tests/js/store/connpanel-verdict.test.js
  - tests/js/store/connpanel.test.js
  - tests/js/store/faceplate/view-panel.test.js
  - tests/js/support/rendered/connpanel.js
  - tests/js/store/drawer-restart.test.js
  - tests/js/store/resolve-facade.test.js
  - tests/js/store/easy/easy-pips.test.js
  - tests/js/store/easy/easy.test.js
  - tests/js/support/easy/easytable.js
  - tests/js/store/faceplate-lists/rate-cap.test.js
  - tests/js/store/faceplate-lists/rate-floor.test.js
  - tests/js/store/faceplate-page/profile-core.test.js
  - tests/js/store/faceplate/display-format-exact-size.test.js
  - tests/js/store/faceplate/display-format.test.js
  - tests/js/store/faceplate/drawer-grammar.test.js
  - tests/js/store/faceplate/drawer.test.js
  - tests/js/store/faceplate/drawers-volume.test.js
  - tests/js/support/rendered/volume-range.js
  - tests/js/support/rendered/drawer-stage.js
  - tests/js/components/faceplate-settings/visual.test.js
  - tests/js/store/theme.test.js
  - tests/js/support/storage.js
  - tests/js/lib/dom-perpage.test.js
  - tests/js/lib/wheelguard.test.js
  - tests/js/support/wheel.js
  - tests/js/lib/mount.test.js
  - tests/js/store/descriptions.test.js
  - tests/js/store/presets/favorites.test.js
  - tests/js/support/easy/easyrate.js
  - tests/js/support/wire/unreadwire.js
---

# Phase 7: One time base - Plan 14: No duplicated store and support test rigs

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- `npx jscpd --format javascript` reports no clone with a side in the store suites outside `tests/js/store/meter/`, the `tests/js/lib/` suites or `tests/js/support/`, except import lists repeated across split test files.
- Every one of those suites still passes or fails exactly as at commit `503ddec8`, under the same count.

## Context

- D-03 binds this plan, with Plan 12's clone rules, `docs/spec/testing.md` constraints and common Verify, applied to each task's own files. Shared helpers go under `tests/js/support/`. `filepawl accept` runs whenever filepawl prints it.
- Several suites carry near-identical tests side by side; folding them into one parametrized case keeps every case and its name.
- `tests/js/support/` is a strong area of the testing policy: a support module changed here keeps every answer it gives each caller, and every suite importing it passes as before, not only the suites this plan names.

## Tasks

### Task 1: The core store suites fold their copied cases

- **Files:** tests/js/store/core/control.test.js, tests/js/store/core/forms-applied.test.js, tests/js/store/core/forms-reads.test.js, tests/js/store/core/forms.test.js, tests/js/store/core/readings.test.js, tests/js/support/readings.js
- **Reads:** tests/js/store/core/control.test.js, tests/js/store/core/forms.test.js
- **Decisions:** D-03
- **Action:** Clones removed (7): the two `control.test.js` self-clones and control~readings (the held answer), the self-clones in `forms-applied.test.js`, `forms-reads.test.js` and twice in `forms.test.js`. Near-identical tests become one parametrized case each, every case kept under its name.
- **Verify:** Plan 12's common Verify over this task's files, plus the case count: the run over this task's test files reports the same number of passing cases as before the task, each row of a parametrized case counted on its own, and every case name printed before the task is printed after it.

### Task 2: The live store suites share their re-enumeration rig

- **Files:** tests/js/store/live/live-reenum.test.js, tests/js/store/live/live.test.js, tests/js/store/live/remirror.test.js, tests/js/support/wire/livepresetwire.js
- **Reads:** tests/js/store/live/live-reenum.test.js, tests/js/support/wire/livepresetwire.js
- **Decisions:** D-03
- **Action:** Clones removed (5): the readings and fetch rig (live-reenum against `live.test.js` four times and against remirror). Expected to stay: hidden against syncdoc-settled and syncdoc, import lists.
- **Verify:** Plan 12's common Verify over this task's files.

### Task 3: The guard suites share their staging wire

- **Files:** tests/js/store/guards/applyguard.test.js, tests/js/store/guards/directsdmwarn.test.js, tests/js/store/guards/sdm-hide-superseded.test.js, tests/js/store/guards/xfmode-refusal.test.js, tests/js/store/pipeline-baseline.test.js, tests/js/support/shaperfit-fixtures.js, tests/js/support/wire/wire.js
- **Reads:** tests/js/support/wire/wire.js#stagingWire, tests/js/support/shaperfit-fixtures.js
- **Decisions:** D-03
- **Action:** Clones removed (7): the config route answer (applyguard~directsdmwarn), the staging wire (directsdmwarn~pipeline-baseline), the live metadata table (sdm-hide-superseded~`shaperfit-fixtures.js`), the four `xfmode-refusal.test.js` self-clones.
- **Verify:** Plan 12's common Verify over this task's files.

### Task 4: The narrowing suites share their facet and metadata rigs

- **Files:** tests/js/store/narrow/length-facet.test.js, tests/js/store/narrow/phase-facet.test.js, tests/js/store/narrow/narrowing-rate.test.js, tests/js/store/narrow/quality-facet-default.test.js, tests/js/store/narrow/plainnames-flat.test.js, tests/js/store/narrow/plainnames-rec.test.js, tests/js/support/wire/narrowingwire.js
- **Reads:** tests/js/support/wire/narrowingwire.js, tests/js/store/narrow/length-facet.test.js
- **Decisions:** D-03
- **Action:** Clones removed (4 at most): the facet rig (length-facet~phase-facet, past its import lines), the reset-and-serve step (narrowing-rate~quality-facet-default), the flat metadata table and its rig (plainnames-flat~plainnames-rec twice). A part of one of these that is only an import list stays.
- **Verify:** Plan 12's common Verify over this task's files.

### Task 5: The panel, restart and easy suites share their rigs

- **Files:** tests/js/store/connpanel-verdict.test.js, tests/js/store/connpanel.test.js, tests/js/store/faceplate/view-panel.test.js, tests/js/support/rendered/connpanel.js, tests/js/store/drawer-restart.test.js, tests/js/store/resolve-facade.test.js, tests/js/store/easy/easy-pips.test.js, tests/js/store/easy/easy.test.js, tests/js/support/easy/easytable.js
- **Reads:** tests/js/store/connpanel.test.js, tests/js/support/rendered/connpanel.js, tests/js/support/easy/easytable.js
- **Decisions:** D-03
- **Action:** Clones removed (5): the connection phases table and panel rig (connpanel-verdict against connpanel twice and against view-panel, into `tests/js/support/rendered/connpanel.js`, which Plan 13 created), the volume-max key rig (drawer-restart~resolve-facade), the presets table (easy-pips~easy).
- **Verify:** Plan 12's common Verify over this task's files.

### Task 6: The list, profile and layout store suites share their rigs

- **Files:** tests/js/store/faceplate-lists/rate-cap.test.js, tests/js/store/faceplate-lists/rate-floor.test.js, tests/js/store/faceplate-page/profile-core.test.js, tests/js/store/faceplate/display-format-exact-size.test.js, tests/js/store/faceplate/display-format.test.js, tests/js/store/faceplate/drawer-grammar.test.js, tests/js/store/faceplate/drawer.test.js, tests/js/store/faceplate/drawers-volume.test.js, tests/js/support/rendered/volume-range.js, tests/js/support/rendered/drawer-stage.js
- **Reads:** tests/js/store/faceplate-lists/rate-cap.test.js, tests/js/support/rendered/volume-range.js
- **Decisions:** D-03
- **Action:** Clones removed (6 at most): the rate marker rig (rate-cap~rate-floor), the `profile-core.test.js` self-clone, the window sizes (display-format-exact-size~display-format, past the import lines, which stay), the drawer schema rows (drawer-grammar~drawer), the volume readings (drawers-volume~`volume-range.js`). Expected to stay: rail-now~rail-pipelines, an import list.
- **Verify:** Plan 12's common Verify over this task's files.

### Task 7: The support wires, storage fake and library suites share once

- **Files:** tests/js/components/faceplate-settings/visual.test.js, tests/js/store/theme.test.js, tests/js/support/storage.js, tests/js/lib/dom-perpage.test.js, tests/js/lib/wheelguard.test.js, tests/js/support/wheel.js, tests/js/lib/mount.test.js, tests/js/store/descriptions.test.js, tests/js/support/wire/narrowingwire.js, tests/js/store/presets/favorites.test.js, tests/js/support/easy/easyrate.js, tests/js/support/wire/livepresetwire.js, tests/js/support/wire/unreadwire.js, tests/js/support/wire/wire.js
- **Reads:** tests/js/support/storage.js, tests/js/support/wire/wire.js, tests/js/support/wire/livepresetwire.js, tests/js/support/wheel.js
- **Decisions:** D-03
- **Action:** Clones removed (9): the localStorage fake (visual~theme and theme~`storage.js`, one fake in `storage.js`), the wheel rig (dom-perpage~wheelguard), the `mount.test.js` self-clone, the profiles wire (descriptions~`narrowingwire.js`), the `favorites.test.js` self-clone, the enums tables and wire answers (easyrate~livepresetwire, livepresetwire~unreadwire, livepresetwire~`wire.js`). Expected to stay: prose-notes~prose-sdm-note, an import list. Every suite that imports a changed support module passes as before.
- **Verify:** Plan 12's common Verify over this task's files, plus `scripts/gate.sh make test-js` passes with the same test count as before the task, since the support wires serve suites beyond this list.
