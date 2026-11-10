---
phase: 3
plan: 7
requirements: [INTG-03]
files:
  - .claude/worktrees/integrate/tests/js/support/readings.js
  - .claude/worktrees/integrate/tests/js/support/listsfixture.js
  - .claude/worktrees/integrate/tests/js/support/rendered/pipelines-fixture.js
  - .claude/worktrees/integrate/tests/js/support/rendered/volume-range.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/header-dropped-clear.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/header-dropped.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/header.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/plate-dropped.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/plate-unread-saves.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/plate-unread.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/rail.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/rows.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-alerts/xref.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/builder.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/profile-steps.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/profile.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/rail.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-builders/rows.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-backenddesc.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-dsdrow.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-pin-glass.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-ratedesc.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-ratehead.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-seemore.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-lists/console.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-lists/default-mark.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-lists/option-list.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-lists/tip.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/about-state-import-owed.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/about-state-import-stores.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/about-state-import.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-settings/engine-rows.test.js
---

# Phase 3: Retired-shape ports - Plan 7: Async seed interface and the first component await ports

## Goal

Every remaining test and support under `tests/js/` runs on the approved interfaces (design step 12b). This plan and Plans 8 to 10 remove the last `readings.value =` assignment outside the reading-model suites, the one inside `seedReadings`. This plan makes the seed's interface asynchronous and awaits it in the first component suites.

## Must be true when done

- `seedReadings`, `loadLists`, `loadPipelines` and `loadVolumeRange` are `async` functions whose bodies are unchanged, and the whole JS suite still passes.
- In this plan's 30 test files, every call that reaches a seed is awaited, and every assert line and test title is byte-identical to START.
- Each port commit quotes its pre-edit run printing `exit=0` and its after-run.

## Context

- Shared Context, Port procedure, Port rules, assert check, lint, forbidden and kept lists: as in Plan 1's Context. Plans 1 to 6 are done first. This Context is shared by Plans 7 to 10.
- Why (owner ruling 2026-11-06, AC1 as written): after the phase, `grep -rn -E 'readings\.value *= *[^=]' tests/js` matches only inside `tests/js/store/core/readings.test.js` and `tests/js/model/store/reading.test.js`. `seedReadings` (`tests/js/support/readings.js`) assigns the signal today. The only production writer of `readings` is `refreshReadings` (`hqptuner/static/store/core/readings.js`, `readingsRefresher`), which adopts the body `api.config()` fetches from `/api/config`. Plan 10 Task 7 therefore makes the seed load its readings through `refreshReadings`. That path is asynchronous, so every seed is awaited first. A production setter added for tests is ruled out twice: it dodges the search (evasion), and it falls outside Phase 2 D-12's production-fix scope (carried by D-08).
- Order, chosen so every pre-edit run stays at `exit=0` (D-05). First, Task 1 makes `seedReadings` and the three synchronous support exports that reach it `async`, with bodies unchanged, so they still write synchronously and no caller changes behavior. Next, Plans 7 to 10 await them at every caller. Last, Plan 10 adds the awaits inside the support helpers, then switches the seed onto the load path. Before the switch, awaiting a seed only yields one microtask.
- **Await rule** (each await port): in the task's files, each of these calls is the operand of `await`:
  - a call of `seedReadings`;
  - a call of a support export that reaches it: `loadLists` (`support/listsfixture.js`), `loadPipelines` (`support/rendered/pipelines-fixture.js`), `loadVolumeRange` (`support/rendered/volume-range.js`), the already-async `reset` of `support/field-harness.js`, `support/devicecaps-harness.js`, `support/shaperfit-fixtures.js` and `support/profile-fixtures.js`, `resetLive` (`support/easy/easytiles.js`) and `trees` (`support/threetrees.js`);
  - a call of any file-local function whose body makes such a call.

  Every function holding such a call becomes `async`, repeated until nothing changes. A `test` or `beforeEach` callback that becomes `async` keeps its title and every other token byte-identical. Two mechanical consequences are part of the rule. A function made `async` whose JSDoc says `@returns {T}` gets `@returns {Promise<T>}`, since `tsc` rejects a non-Promise return type on an async function (TS1064); known sites are `appliedWith`, `pipelinesLit` and `crossfeedLit` (Plan 10 Task 3), `reset` in `store/live/livepresets.test.js` and `store/live/live-reenum.test.js` (Plan 9 Task 8), and `reset` in `store/narrow/narrowing-rate.test.js` (Plan 10 Task 1), and the AST scan lists any other. A non-assert line the added `await` pushes past the prettier `printWidth` of 120 is rewrapped the way `npx prettier --write` prints it, and on no other line; the known site is `store/resolve-facade.test.js:84` (Plan 8 Task 7). The commit lists both kinds of change. Nothing else in the file changes: no reordering, no new helper, no seed moved, no assert line touched except under Plan 10's owner-approved await-only route. If a covered call sits inside a callback that cannot be `async`, the task stops for adjudication under the Port procedure. The planning scan found none: every anonymous callback holding such a call is a `test` or `beforeEach` callback.
- **Await check** (each await port's Verify): an AST scan over the task's files lists no un-awaited call that the Await rule covers. It is written under `${CLAUDE_SCRATCH:-/tmp}`, never committed, and uses the worktree's `node_modules/typescript`. It resolves bindings from static imports and from destructured `await import(...)`, which `store/faceplate/switcher.test.js`, `components/faceplate/switcher.test.js` and `components/faceplate-page/presets.test.js` use. Also, `grep -n 'seedReadings(' <files> | grep -v 'await seedReadings('` prints nothing.
- Caller-side delta, counted at planning with that scan over the worktree tip `e50d7316`:
  - Call sites: 156 direct `seedReadings` call sites, and 490 call sites gaining `await` in total.
  - Files: 125 in all, 116 test files and 9 support files. `store/guards/xfmode-refusal.test.js` makes 126 once Plan 1 Task 5 seeds it.
  - Functions: 312 become `async`. 238 are `test` or `beforeEach` callbacks and 74 are named helpers.
  - No edit: 22 further files call an async support export and already await every such call.
  - Leases: Plans 7 to 10 lease all 126 files, grouped by directory. Plan 7 holds 30 test files plus Task 1's four support files, Plan 8 holds 37, Plan 9 holds 36, and Plan 10 holds 14 test files plus the nine support files and the seed switch.
  - At execution: each task re-runs the scan over its files before the pre-edit run. A file the Await rule reaches but no plan leases is reported, not edited.
- Assert lines: 60 of the 490 sites sit on assert lines, in 7 files, all in Plan 10 Tasks 3 and 4 (see Plan 10 Context). No task in Plans 7 to 9 changes an assert line.

## Tasks

### Task 1: Make the seed and its three synchronous support callers async

- **Files:** tests/js/support/readings.js, tests/js/support/listsfixture.js, tests/js/support/rendered/pipelines-fixture.js, tests/js/support/rendered/volume-range.js
- **Action:** `seedReadings` becomes an `async` function with its body unchanged, so it still assigns `readings.value` before it returns. Its doc comment says the returned promise resolves once the readings are seeded. `loadLists`, `loadPipelines` and `loadVolumeRange` become `async` with bodies unchanged, and their doc comments say the same. No caller changes in this task. None of the four bodies holds an `await`, so each still runs to completion before its caller's next statement. The value of doing this first: the callers' awaits then await a promise rather than `undefined`, and tsc checks the interface the switch keeps. Port procedure: every importer of these files is effectively the whole suite, so the pre-edit and after-runs are the full-suite run (it holds 8 of 18 cores; say so before each run).
- **Verify:** the full-suite after-run prints `exit=0` and `# fail 0`. `grep -n -E 'export async function (seedReadings|loadLists|loadPipelines|loadVolumeRange)\b'` over the four files prints four lines. The commit's diff of the four files changes only those four declaration lines and their doc comments. Lint prints `exit=0`. Testing scope: an interface change with no behavior change; the whole suite is the evidence; no new test.

### Task 2: Await the seeds in the header and plate alert suites

- **Files:** tests/js/components/faceplate-alerts/header-dropped-clear.test.js, tests/js/components/faceplate-alerts/header-dropped.test.js, tests/js/components/faceplate-alerts/header.test.js, tests/js/components/faceplate-alerts/plate-dropped.test.js, tests/js/components/faceplate-alerts/plate-unread-saves.test.js
- **Action:** Apply the Await rule to the five files, including the `seedReadings` calls Plan 3 Task 4 and Task 5 gave a `profiles` reading. Port procedure on the five files.
- **Verify:** the after-run over the five files prints `exit=0`; the Await check is clean; the assert check is clean; lint prints `exit=0`. Testing scope: the suites' own cases; before the switch the port changes no behavior; no new test; testing stops at the file run.

### Task 3: Await the seeds in the remaining alert component suites

- **Files:** tests/js/components/faceplate-alerts/plate-unread.test.js, tests/js/components/faceplate-alerts/rail.test.js, tests/js/components/faceplate-alerts/rows.test.js, tests/js/components/faceplate-alerts/xref.test.js
- **Action:** Apply the Await rule to the four files. `rail.test.js` also reaches a seed through the `shaperfit-fixtures.js` `reset`; that call is awaited too. Port procedure on the four files.
- **Verify:** as Task 2, over the four files.

### Task 4: Await the seeds in the builder component suites

- **Files:** tests/js/components/faceplate-builders/builder.test.js, tests/js/components/faceplate-builders/profile-steps.test.js, tests/js/components/faceplate-builders/profile.test.js, tests/js/components/faceplate-builders/rail.test.js, tests/js/components/faceplate-builders/rows.test.js
- **Action:** Apply the Await rule to the five files, including the file-local helpers that seed (`wire` in `builder.test.js`, `rail.test.js` and `rows.test.js`). Port procedure on the five files.
- **Verify:** as Task 2, over the five files.

### Task 5: Await the seeds in the output drawer suites, backend, DSD row and pin

- **Files:** tests/js/components/faceplate-drawers-output/drawers-output-backenddesc.test.js, tests/js/components/faceplate-drawers-output/drawers-output-dsdrow.test.js, tests/js/components/faceplate-drawers-output/drawers-output-pin-glass.test.js, tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js
- **Action:** Apply the Await rule to the four files, including the file-local `load` of `drawers-output-pin-glass.test.js` and `drawers-output-pin.test.js`. Port procedure on the four files.
- **Verify:** as Task 2, over the four files.

### Task 6: Await the seeds in the output drawer suites, rate, see-more and main

- **Files:** tests/js/components/faceplate-drawers-output/drawers-output-ratedesc.test.js, tests/js/components/faceplate-drawers-output/drawers-output-ratehead.test.js, tests/js/components/faceplate-drawers-output/drawers-output-seemore.test.js, tests/js/components/faceplate-drawers-output/drawers-output.test.js
- **Action:** Apply the Await rule to the four files. `drawers-output-schema.test.js` is not here: its covered calls sit on assert lines (Plan 10 Task 4). Port procedure on the four files.
- **Verify:** as Task 2, over the four files.

### Task 7: Await the seeds in the list component suites

- **Files:** tests/js/components/faceplate-lists/console.test.js, tests/js/components/faceplate-lists/default-mark.test.js, tests/js/components/faceplate-lists/option-list.test.js, tests/js/components/faceplate-lists/tip.test.js
- **Action:** Apply the Await rule to the four files, including their calls of `loadLists`, `serve` in `default-mark.test.js` and `serveConversion` in `option-list.test.js`. Port procedure on the four files.
- **Verify:** as Task 2, over the four files.

### Task 8: Await the seeds in the state-import and engine-row settings suites

- **Files:** tests/js/components/faceplate-settings/about-state-import-owed.test.js, tests/js/components/faceplate-settings/about-state-import-stores.test.js, tests/js/components/faceplate-settings/about-state-import.test.js, tests/js/components/faceplate-settings/engine-rows.test.js
- **Action:** Apply the Await rule to the four files. The module-scope seeds of `about-state-import-owed.test.js` and `about-state-import-stores.test.js` take a top-level `await`, which the ES module test files allow. Port procedure on the four files.
- **Verify:** as Task 2, over the four files.

## Notes

- `docs/superpowers/specs/rebuild-integrate-design.md` (**Modules**, the `tests/js/support/readings.js` entry) still describes `seedReadings` as setting `readings.value` with no return. That record is outside this phase's lease and is raised in the planner's return, not edited here.
- Testing policy: the seed is test machinery, not product behavior. The behavior under test is unchanged, and every suite that reads a seeded value proves the seed. No new test is planned.
