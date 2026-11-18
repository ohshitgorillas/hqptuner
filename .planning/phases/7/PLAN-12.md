---
phase: 7
plan: 12
requirements: []
files:
  - tests/js/components/faceplate-drawers-output/drawers-output-backenddesc.test.js
  - tests/js/components/faceplate-drawers-output/drawers-output-dsdrow.test.js
  - tests/js/components/faceplate-drawers-output/drawers-output-pin-glass.test.js
  - tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js
  - tests/js/components/faceplate-drawers-output/drawers-output-ratedesc.test.js
  - tests/js/components/faceplate-drawers-output/drawers-output-ratehead.test.js
  - tests/js/components/faceplate-drawers-output/drawers-output-schema.test.js
  - tests/js/components/faceplate-drawers-output/drawers-output-seemore.test.js
  - tests/js/components/faceplate-drawers-output/drawers-output.test.js
  - tests/js/components/faceplate-drawers/drawer-items.test.js
  - tests/js/components/faceplate-drawers/drawer-rows.test.js
  - tests/js/store/faceplate/drawers-output.test.js
  - tests/js/support/rendered/outputdrawer.js
  - tests/js/support/rendered/drawer-render.js
  - tests/js/components/faceplate-drawers/drawer-homes.test.js
  - tests/js/components/faceplate-settings/drawer-homes-settings.test.js
  - tests/js/support/drawer-homes.js
  - tests/js/components/faceplate-drawers/drawers-crossfeed.test.js
  - tests/js/store/faceplate/drawers-crossfeed.test.js
  - tests/js/support/rendered/crossfeedload.js
  - tests/js/components/faceplate-drawers/drawers-matrix-schema.test.js
  - tests/js/store/faceplate/drawer-family.test.js
  - tests/js/support/rendered/drawer-stage.js
  - tests/js/components/faceplate-drawers/drawers-pipelines.test.js
  - tests/js/store/faceplate/drawers-pipelines.test.js
  - tests/js/support/rendered/pipelines-fixture.js
  - tests/js/components/faceplate-drawers/drawers-rate-title.test.js
  - tests/js/store/faceplate/chain.test.js
  - tests/js/support/readings.js
  - tests/js/components/faceplate-drawers/drawers-source-paint-blank.test.js
  - tests/js/components/faceplate-drawers/drawers-source-paint.test.js
  - tests/js/contracts/picture.js
  - tests/js/support/page/canvas.js
  - tests/js/components/faceplate-drawers/drawers-speakers-schema.test.js
  - tests/js/components/faceplate-settings/hardware-catalog-rows.test.js
  - tests/js/support/rendered/speakersform.js
  - tests/js/components/faceplate-drawers/drawers-speakers.test.js
  - tests/js/store/faceplate/drawers-speakers.test.js
  - tests/js/components/faceplate-drawers/drawers-volume-range.test.js
  - tests/js/components/faceplate-drawers/drawers-volume-schema.test.js
  - tests/js/support/rendered/volume-range.js
  - tests/js/components/faceplate-settings/engine-rows.test.js
  - tests/js/components/faceplate-settings/visual.test.js
  - tests/js/support/rendered/treewalk.js
---

# Phase 7: One time base - Plan 12: No duplicated drawer test rigs

## Goal

A single time base. Duplicated code is illegal. We use shared core structures everywhere.

## Must be true when done

- `npx jscpd --format javascript` reports no clone with a side in the drawer suites (`tests/js/components/faceplate-drawers*/`, the drawer suites under `tests/js/store/faceplate/`) except import lists repeated across split test files.
- Every drawer suite still passes or fails exactly as at commit `503ddec8`, under the same count.

## Context

- D-03 binds this plan. Clone rules: a clone is gone when its code lives once and every former copy calls it; a forwarder or rename that leaves the same token run in two places removes nothing. Each removed clone turns its two copies into calls of one shared copy: two call sites per clone, in the files the task lists. A clone of a justified kind stays and is named, with its kind, in the commit message.
- `docs/spec/testing.md` binds every edit: no test edited to pass, no assertion or expected value changes what it states, fakes answer from tables (rule 13), helpers return values and hold no assert (rule 14), a test asserts only strings it put on the wire itself (rule 9). Shared helpers go under `tests/js/support/`, never in a `*.test.js` file. `filepawl accept` runs whenever filepawl prints it.
- Common Verify for every task, over the task's files: (a) `scripts/gate.sh npx jscpd --format javascript`, then the log: no clone with both sides in the task's files except the stays its Action names; (b) `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test` over the task's test files gives the same pass and fail counts as before the task; (c) `scripts/gate.sh make lint-js` passes (eslint, prettier, both `tsc` projects, knip and jscpd at the current threshold). Testing scope for each: no behavior changes; the suites are their own check; no new test; testing stops there.

## Tasks

### Task 1: The Output drawer suites share one rig

- **Files:** tests/js/components/faceplate-drawers-output/drawers-output-backenddesc.test.js, tests/js/components/faceplate-drawers-output/drawers-output-dsdrow.test.js, tests/js/components/faceplate-drawers-output/drawers-output-pin-glass.test.js, tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js, tests/js/components/faceplate-drawers-output/drawers-output-ratedesc.test.js, tests/js/components/faceplate-drawers-output/drawers-output-ratehead.test.js, tests/js/components/faceplate-drawers-output/drawers-output-schema.test.js, tests/js/components/faceplate-drawers-output/drawers-output-seemore.test.js, tests/js/components/faceplate-drawers-output/drawers-output.test.js, tests/js/components/faceplate-drawers/drawer-items.test.js, tests/js/components/faceplate-drawers/drawer-rows.test.js, tests/js/store/faceplate/drawers-output.test.js, tests/js/support/rendered/outputdrawer.js, tests/js/support/rendered/drawer-render.js
- **Reads:** tests/js/components/faceplate-drawers-output/drawers-output-schema.test.js#served1, tests/js/store/faceplate/drawers-output.test.js#served1, tests/js/components/faceplate-drawers-output/drawers-output-ratedesc.test.js#load, docs/spec/testing.md
- **Decisions:** D-03
- **Action:** The Output drawer suites' repeated staging wire, schema tables, `load` and `served1` rigs live once in `tests/js/support/rendered/outputdrawer.js` (planner's name); the render-and-find helper they share with `drawer-items` and `drawer-rows` goes in `drawer-render.js`. All 27 clones between these files go except the import lists (backenddesc~dsdrow and ~ratedesc, dsdrow against ratehead, schema and seemore, schema~drawers-output). The flagged assumption on `served1`, which builds served readings from staged state: read it against rule 13 first. If it answers a reading by the algorithm under test, the merged rig answers from a table the tests write instead; if it only plumbs the staged value through unchanged, it is merged as it is. The commit says which.
- **Verify:** The plan's common Verify over this task's files, plus the commit message records the rule 13 reading of `served1`.

### Task 2: The drawer family suites share their homes, loaders and staged rows

- **Files:** tests/js/components/faceplate-drawers/drawer-homes.test.js, tests/js/components/faceplate-settings/drawer-homes-settings.test.js, tests/js/support/drawer-homes.js, tests/js/components/faceplate-drawers/drawers-crossfeed.test.js, tests/js/store/faceplate/drawers-crossfeed.test.js, tests/js/support/rendered/crossfeedload.js, tests/js/components/faceplate-drawers/drawers-matrix-schema.test.js, tests/js/store/faceplate/drawer-family.test.js, tests/js/support/rendered/drawer-stage.js, tests/js/components/faceplate-drawers/drawers-pipelines.test.js, tests/js/store/faceplate/drawers-pipelines.test.js, tests/js/support/rendered/pipelines-fixture.js
- **Reads:** tests/js/support/drawer-homes.js, tests/js/support/rendered/drawer-stage.js, tests/js/support/rendered/pipelines-fixture.js
- **Decisions:** D-03
- **Action:** Clones removed: the drawer homes table (drawer-homes~drawer-homes-settings, into `drawer-homes.js`), the crossfeed `load` (component~store `drawers-crossfeed`, into `crossfeedload.js`, planner's name), the matrix drawer stage (drawers-matrix-schema~drawer-family, into `drawer-stage.js`), `stagedRows` (component~store `drawers-pipelines`, into `pipelines-fixture.js`).
- **Verify:** The plan's common Verify over this task's files.

### Task 3: The remaining drawer suites share their fakes and renderers

- **Files:** tests/js/components/faceplate-drawers/drawers-rate-title.test.js, tests/js/store/faceplate/chain.test.js, tests/js/support/readings.js, tests/js/components/faceplate-drawers/drawers-source-paint-blank.test.js, tests/js/components/faceplate-drawers/drawers-source-paint.test.js, tests/js/contracts/picture.js, tests/js/support/page/canvas.js, tests/js/components/faceplate-drawers/drawers-speakers-schema.test.js, tests/js/components/faceplate-settings/hardware-catalog-rows.test.js, tests/js/support/rendered/speakersform.js, tests/js/components/faceplate-drawers/drawers-speakers.test.js, tests/js/store/faceplate/drawers-speakers.test.js, tests/js/components/faceplate-drawers/drawers-volume-range.test.js, tests/js/components/faceplate-drawers/drawers-volume-schema.test.js, tests/js/support/rendered/volume-range.js, tests/js/components/faceplate-settings/engine-rows.test.js, tests/js/components/faceplate-settings/visual.test.js, tests/js/support/rendered/drawer-render.js, tests/js/support/rendered/treewalk.js
- **Reads:** tests/js/contracts/picture.js, tests/js/support/page/canvas.js, tests/js/support/rendered/volume-range.js, tests/js/support/rendered/drawer-render.js
- **Decisions:** D-03
- **Action:** Clones removed: the running-chain reading (drawers-rate-title~chain), the source paint setup and the pixel canvas fake (source-paint-blank against source-paint and twice against `contracts/picture.js`; one canvas fake serves both, in `page/canvas.js` or `picture.js`), the speakers rows (speakers-schema~hardware-catalog-rows twice, into `speakersform.js`), the `drawers-speakers` component~store clone, the two `drawers-volume-range.test.js` self-clones (near-identical tests folded into one parametrized case each, every case kept), the volume readings (volume-schema~`volume-range.js`), the tree finder and drawer render (engine-rows against `drawer-render.js` and visual, visual~`drawer-render.js`). Expected to stay: drawers-hf-schema against engine-rows and logging, import lists. `tests/js/contracts/picture.js` also serves the replay suites: they pass as before.
- **Verify:** The plan's common Verify over this task's files, plus `tests/js/contracts/spectrogram-picture.test.js` and `tests/js/contracts/spectrogram-columns.test.js` give the same outcome per test as before the task.
