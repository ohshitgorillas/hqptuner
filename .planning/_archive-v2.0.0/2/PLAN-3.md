---
phase: 2
plan: 3
requirements: [INTG-01, INTG-02]
files:
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/header.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/rail.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/xref.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-alerts/alerts.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/shaperfit-alerts.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/shaperfit-mode-gate.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/rail-staged.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/rail-now.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/rail-pipelines.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/header.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/page.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/rail.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/volume.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/header-dropped-clear.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/header-dropped.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/plate-dropped.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/plate-unread-saves.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/plate-unread.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/rows.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate-alerts/alerts-unread.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/faceplate.test.js
  - .claude/worktrees/integrate/tests/js/support/rendered/filter-fields.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-fft-catalog.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-modes-schema.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-resampling-two-stage.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-hf-schema.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-loudness.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-matrix-schema.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-pipelines-schema.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-speakers-schema.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawer-items.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawer-rows.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-speakers-stale.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-speakers.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-dsdrow.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js
---

# Phase 2: Baseline recovery - Plan 3: Alerts, shell and drawer component suites

## Goal

The JS baseline in `.claude/worktrees/integrate` passes, through repaired test machinery and fixed production defects, with every valid claim unchanged (design step 12a). This plan recovers the alert, faceplate-shell, rail and drawer suites, and migrates every value seed in them to `seedReadings`.

## Must be true when done

- Every baseline failure in this plan's failing files that `routes.md` routes as `repair` passes, with its claims and assert lines byte-identical to BASE.
- No assignment to `config.value` or `matrixConfig.value` in this plan's files, or in a local builder whose result they assign, carries a field value or a `file`, `active` or `rows` key.
- Every passing file this plan migrates passed before its edit (the run is recorded) and passes after it.
- No test writes a computed signal. `speakers` and the other rail inputs are reached through their sources.
- Each failure left open carries a `Builder route:` or `Contract mismatch:` line in its task's commit message.

## Context

- Locked: D-01, D-02, D-03, D-05, D-08, D-10, D-12, D-13, D-14 (`.planning/phases/2/CONTEXT.md`). Plans 1 and 2 are done first: the shared helpers these suites import are already repaired (D-03).
- Paths, file run, assert check, lint, BASE and the forbidden list as in Plan 1's Context.
- **The AC3 check** for a file: no assignment in it to `config.value` or `matrixConfig.value` carries a field entry's own `value`, a `file` key, an `active` key or a `rows` key. Neither does any local builder (`form`, `offering`, `CONFIG`, `configTree` and the like) whose result is assigned to either. An `options` entry's `value` is metadata and stays.
- **Route procedure** for a failing-file task. Each failing test takes the route its `routes.md` entry gives.
  - `repair`: the lead writes the brief to `test-writer`, carrying the failing evidence and the TypeScript declaration view of the built interface. The fix moves values into the one `seedReadings` call of the setup, with config and matrix fields in that one call (D-10), and strips the form signals to metadata. It reaches computed signals through their sources. It passes props the built component takes. Claims and assert lines stay byte-identical.
  - `builder`: the failing test stays unchanged, and no `hqptuner/` file is edited in this plan. The commit message lists it under `Builder route:` with the failing line and the implicated `hqptuner/static/` path.
  - Contract mismatch: a test change only with the before-and-after document quotations in the commit message under `Contract mismatch:`; `moved` only with those quotations. An `unresolved` mismatch stops the task and goes to the owner.
  - A test that passed at baseline but fails once the seeds are repaired is adjudicated now (D-05): a production defect becomes a `Builder route:` entry, and a machinery fault is repaired.
  - Every other seed in the file is migrated the same way, so the file meets the AC3 check.
- **Passing-file procedure** (D-08): first run the files and quote the pre-edit `exit=0` line and log path in the commit message. Migrate the seeds and strip the form signals as above, with asserts byte-identical, and run again.
- Each task's Verify ends with the same three checks: the assert check, the AC3 check on its files, and lint.

## Tasks

### Task 1: Recover the alert and shaper-fit suites

- **Files:** .claude/worktrees/integrate/tests/js/components/faceplate-alerts/header.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-alerts/rail.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-alerts/xref.test.js, .claude/worktrees/integrate/tests/js/store/faceplate-alerts/alerts.test.js, .claude/worktrees/integrate/tests/js/store/guards/shaperfit-alerts.test.js, .claude/worktrees/integrate/tests/js/store/guards/shaperfit-mode-gate.test.js
- **Action:** Apply the route procedure to every baseline failure in these six files. The `Cannot read properties of undefined (reading 'openPanel')` failures in `components/faceplate-alerts/header.test.js` meet `Knob` in `hqptuner/static/components/faceplate/Header.js`, which takes a `panel` (`ConnPanelStore` of `store/connpanel.js`). They take the route `routes.md` gives. Seeds that reach these suites through `shaperfit-fixtures.js` were settled in Plan 1 Task 6 and are not re-seeded here.
- **Verify:** A file run over the six files prints `exit=0`. The only exceptions are tests listed under `Builder route:` in this commit, and each of those fails with its baseline error text. Then the assert check, the AC3 check and lint. Testing scope: the existing claims are the checks; no new test.

### Task 2: Reach the rail's computed inputs through their sources

- **Files:** .claude/worktrees/integrate/tests/js/components/faceplate/rail-staged.test.js, .claude/worktrees/integrate/tests/js/store/faceplate/rail-now.test.js, .claude/worktrees/integrate/tests/js/store/faceplate/rail-pipelines.test.js
- **Action:** Apply the route procedure to every baseline failure in these files. The 32 `Cannot set property value of [object Object] which has only a getter` failures write computed signals. One is `speakers.value =` at `rail-now.test.js` and `rail-staged.test.js` against `speakers` in `hqptuner/static/store/matrix/speakers.js`, a `computed` over `speakerForm.base`. Any other computed signal written in these setups gets the same treatment. Seed each through the source the built store reads (for `speakers`, the speaker form's load path), never by redefining the signal. The `rows` and value seeds in these files' form-signal assignments move to `seedReadings`, `matrix_pipelines` included.
- **Verify:** A file run over the three files prints `exit=0`, except tests under `Builder route:`. `grep -nE "\bspeakers\.value\s*=" <three files>` prints nothing. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 3: Recover the faceplate shell suites

- **Files:** .claude/worktrees/integrate/tests/js/components/faceplate/header.test.js, .claude/worktrees/integrate/tests/js/components/faceplate/page.test.js, .claude/worktrees/integrate/tests/js/components/faceplate/rail.test.js, .claude/worktrees/integrate/tests/js/components/faceplate/volume.test.js
- **Action:** Apply the route procedure to every baseline failure in these four files, the `openPanel` failure in `header.test.js` included (see Task 1's note on `Knob`).
- **Verify:** A file run over the four files prints `exit=0`, except tests under `Builder route:`. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 4: Migrate the passing alert and shell suites' seeds

- **Files:** .claude/worktrees/integrate/tests/js/components/faceplate-alerts/header-dropped-clear.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-alerts/header-dropped.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-alerts/plate-dropped.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-alerts/plate-unread-saves.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-alerts/plate-unread.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-alerts/rows.test.js, .claude/worktrees/integrate/tests/js/store/faceplate-alerts/alerts-unread.test.js, .claude/worktrees/integrate/tests/js/components/faceplate/faceplate.test.js
- **Action:** Apply the passing-file procedure to these eight files, each of which passed at baseline.
- **Verify:** The commit message quotes the pre-edit `exit=0`. A file run over the eight files prints `exit=0` after the edit. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 5: Move the filter-select fixture and its three suites onto seedReadings

- **Files:** .claude/worktrees/integrate/tests/js/support/rendered/filter-fields.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-fft-catalog.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-modes-schema.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-resampling-two-stage.test.js
- **Action:** `filterFields` returns the four filter selects with a field `value` each, and its three importers spread them into `config.value`, so it is a helper-routed seed (D-09). The helper's rows carry metadata only (name, type, options). The four values reach `readings.value` in each caller's one `seedReadings` call. Keep `filterFields`'s parameters if the callers can still pass their values through them (D-02). If that cannot hold, say why in the commit message. Repair the helper before the callers, in this one commit. Then apply the route procedure to every baseline failure in `drawers-fft-catalog.test.js` and `drawers-modes-schema.test.js`. Apply the passing-file procedure to `drawers-resampling-two-stage.test.js`, with its pre-edit pass recorded. Update the `ChainFilters` doc comment to what the helper now carries.
- **Verify:** A file run over the three suites prints `exit=0`, except tests under `Builder route:`. The commit message quotes `drawers-resampling-two-stage.test.js`'s pre-edit `exit=0`. `grep -n "value:" tests/js/support/rendered/filter-fields.js` shows no field-entry `value`. Then the assert check, the AC3 check on all four files, and lint. Testing scope (`tests/js/support/` is a strong area): all three importers run; no new test.

### Task 6: Recover the remaining failing drawer suites

- **Files:** .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-hf-schema.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-loudness.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-matrix-schema.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-pipelines-schema.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-speakers-schema.test.js
- **Action:** Apply the route procedure to every baseline failure in these five files. Failures in `drawers-pipelines-schema.test.js` that Plan 1 Task 7 settled in `rendered/pipelines-fixture.js` are not re-seeded here.
- **Verify:** A file run over the five files prints `exit=0`, except tests under `Builder route:`. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 7: Migrate the passing drawer suites' seeds

- **Files:** .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawer-items.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawer-rows.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-speakers-stale.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-speakers.test.js
- **Action:** Apply the passing-file procedure to these four files.
- **Verify:** The commit message quotes the pre-edit `exit=0`. A file run over the four files prints `exit=0` after the edit. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.

### Task 8: Recover the failing output-drawer suites

- **Files:** .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-dsdrow.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js
- **Action:** Apply the route procedure to every baseline failure in these two files.
- **Verify:** A file run over the two files prints `exit=0`, except tests under `Builder route:`. Then the assert check, the AC3 check and lint. Testing scope: existing claims only.
