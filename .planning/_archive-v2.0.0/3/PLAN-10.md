---
phase: 3
plan: 10
requirements: [INTG-03]
files:
  - .claude/worktrees/integrate/tests/js/store/narrow/localbackends.test.js
  - .claude/worktrees/integrate/tests/js/store/narrow/narrowing-rate.test.js
  - .claude/worktrees/integrate/tests/js/store/presets/matrixmode-preset.test.js
  - .claude/worktrees/integrate/tests/js/store/presets/presets.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-page/conversion.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-page/profile.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-page/presets.test.js
  - .claude/worktrees/integrate/tests/js/store/loudness-applied.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawers-volume.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/rail-pipelines.test.js
  - .claude/worktrees/integrate/tests/js/store/faceplate/volume.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate/volume.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-volume-range.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers-output/drawers-output-schema.test.js
  - .claude/worktrees/integrate/tests/js/support/devicecaps-harness.js
  - .claude/worktrees/integrate/tests/js/support/easy/easytiles.js
  - .claude/worktrees/integrate/tests/js/support/field-harness.js
  - .claude/worktrees/integrate/tests/js/support/listsfixture.js
  - .claude/worktrees/integrate/tests/js/support/profile-fixtures.js
  - .claude/worktrees/integrate/tests/js/support/rendered/pipelines-fixture.js
  - .claude/worktrees/integrate/tests/js/support/rendered/volume-range.js
  - .claude/worktrees/integrate/tests/js/support/shaperfit-fixtures.js
  - .claude/worktrees/integrate/tests/js/support/threetrees.js
  - .claude/worktrees/integrate/tests/js/support/readings.js
  - .planning/phases/3/baseline/exit.txt
---

# Phase 3: Retired-shape ports - Plan 10: Last await ports, the seed switch and the exit check

## Goal

Every remaining test and support under `tests/js/` runs on the approved interfaces (design step 12b). This plan awaits the last seeds, switches `seedReadings` onto the store's own load path so no `readings.value =` assignment remains outside the reading-model suites, and runs the phase's exit check.

## Must be true when done

- `seedReadings` puts its readings into `readings` through `refreshReadings`, and `grep -rn -E 'readings\.value *= *[^=]' tests/js` matches only lines in `tests/js/store/core/readings.test.js` and `tests/js/model/store/reading.test.js`.
- Under `tests/js/`, every call the Await rule covers is awaited, the support helpers' own seed calls included.
- The D-07 whole-suite command prints `exit=0` with zero failures in the integrate worktree after the last port, and `.venv/bin/pytest -m "not live" -q tests/api` through `scripts/gate.sh` prints `exit=0`.
- Every port commit since START quotes a pre-edit run printing `exit=0`. No commit since START changes an assert line of a ported test, except a deleted `config` push test, a recorded contract-mismatch route, or an owner-approved await-only assert line (Context).

## Context

- Shared Context, Port procedure, Port rules, assert check, lint, forbidden and kept lists: as in Plan 1's Context. The Await rule, Await check, order and caller-side delta: as in Plan 7's Context. Plans 1 to 9 are done first.
- **Owner ruling on AC4, Tasks 3 and 4 (2026-11-06): approved.** The owner chose "Allow await-only" for the route below. In the seven files of Tasks 3 and 4, 60 covered calls sit on assert lines. For example, `store/loudness-applied.test.js` asserts `assert.equal(appliedWith({ at: "-40" }), 50);`, and `appliedWith` seeds. AC1 can be met there only by changing those assert lines, and AC4 as worded forbids that outside the contract-mismatch route or a `config` push deletion. Deleting the tests would also remove assert lines.
  - Approved route: insert `await` before each covered call, with parentheses where a member access follows the call, as in `(await rangeWith({})).level`. Nothing else on the line changes, so the asserted call and the expected value stay byte-identical. Each commit lists every changed assert line under `Await-only assert lines:` and quotes the owner's approval.
  - Tasks 5 to 8 run after Tasks 3 and 4, since the switch needs every seed awaited.
- Support awaits: Plan 7 Task 1 and Plans 7 to 10 made every caller await the support exports. Each support helper's own seed call can then be awaited without a non-awaiting caller seeing a half-run helper.
- The switch (Task 7). `refreshReadings` is the readings refresher in `hqptuner/static/store/core/readings.js`. It calls `api.config()`, which reaches `fetch` synchronously (`hqptuner/static/lib/api.js`, `getJSON` then `reach`). It then adopts the body as `readings.value`, keeping only the latest request. So a seed can answer exactly its own request: put a one-shot fetch in place, call `refreshReadings()`, restore the previous fetch before yielding, then await the refresh.

## Tasks

### Task 1: Await the seeds in the store narrowing and preset suites

- **Files:** tests/js/store/narrow/localbackends.test.js, tests/js/store/narrow/narrowing-rate.test.js, tests/js/store/presets/matrixmode-preset.test.js, tests/js/store/presets/presets.test.js
- **Action:** Apply the Await rule to the four files, including the file-local `reset` of `narrowing-rate.test.js` and every call of it. Port procedure on the four files.
- **Verify:** the after-run over the four files prints `exit=0`; the Await check is clean; the assert check is clean; lint prints `exit=0`. Testing scope: the suites' own cases; before the switch the port changes no behavior; no new test; testing stops at the file run.

### Task 2: Await the seeds in the component page suites

- **Files:** tests/js/components/faceplate-page/conversion.test.js, tests/js/components/faceplate-page/profile.test.js, tests/js/components/faceplate-page/presets.test.js
- **Action:** Apply the Await rule to the three files, including `play` in `conversion.test.js` and `serve` in `profile.test.js`. Also include the `loadLists` call of `presets.test.js`, whose binding comes from a destructured `await import(...)`. Port procedure on the three files.
- **Verify:** as Task 1, over the three files.

### Task 3: Await the seeds in the store volume, loudness and rail-pipelines suites

- **Files:** tests/js/store/loudness-applied.test.js, tests/js/store/faceplate/drawers-volume.test.js, tests/js/store/faceplate/rail-pipelines.test.js, tests/js/store/faceplate/volume.test.js
- **Action:** Apply the Await rule to the four files, with the approved route on assert lines. The covered helpers on assert lines are `appliedWith`, `modeWith`, `rangeWith`, `crossfeedLit`, `pipelinesLit`, `levelWith` and `marksWith`. The commit carries the `Await-only assert lines:` record. Port procedure on the four files.
- **Verify:** the after-run over the four files prints `exit=0`; the Await check is clean. The assert check shows only the lines the record lists. Each listed line, with every `await` and each parenthesis pair added around an awaited call removed, equals its START text byte for byte. Lint prints `exit=0`. Testing scope: the suites' own cases; no new test.

### Task 4: Await the seeds in the component volume and output-schema suites

- **Files:** tests/js/components/faceplate/volume.test.js, tests/js/components/faceplate-drawers/drawers-volume-range.test.js, tests/js/components/faceplate-drawers-output/drawers-output-schema.test.js
- **Action:** As Task 3, for these three files, including the `loadVolumeRange` calls of `drawers-volume-range.test.js`. The covered helpers on assert lines are `drawn`, `expanded`, `hidden`, `loudMarks`, `startupAttr`, `grayed`, `markupWith`, `needle`, `shownGroups` and `shownPickers`. Port procedure on the three files.
- **Verify:** as Task 3, over the three files.

### Task 5: Await the seed inside the harness and list support helpers

- **Files:** tests/js/support/devicecaps-harness.js, tests/js/support/easy/easytiles.js, tests/js/support/field-harness.js, tests/js/support/listsfixture.js, tests/js/support/profile-fixtures.js
- **Action:** Apply the Await rule inside the five helpers: each one's `seedReadings` call is awaited, in `reset`, `resetLive` and `loadLists`. Exported names and parameters stay. Port procedure: the pre-edit and after-runs cover every importer of the five files, found with `grep -rl` over `tests/js`. That includes importers through another support file, and importers through a destructured `await import(...)`.
- **Verify:** the after-run over the importers prints `exit=0`; the Await check over the five files is clean; lint prints `exit=0`. Testing scope: the importers' cases; no new test.

### Task 6: Await the seed inside the rendered, shaper-fit and three-trees support helpers

- **Files:** tests/js/support/rendered/pipelines-fixture.js, tests/js/support/rendered/volume-range.js, tests/js/support/shaperfit-fixtures.js, tests/js/support/threetrees.js
- **Action:** As Task 5, for `loadPipelines`, `loadVolumeRange`, the `shaperfit-fixtures.js` `reset` and `trees`.
- **Verify:** as Task 5, over these four files' importers.

### Task 7: Seed readings through the store's load path

- **Files:** tests/js/support/readings.js
- **Action:** `seedReadings` stops writing the `readings` signal and puts its readings into `readings` through `refreshReadings` (Context). It builds `{ generation: stamp, fields: entries }` exactly as today and answers the seed's own `/api/config` request with that body, through a fake response built with `ok` from `tests/js/support/wire/wire.js`. It resolves once `refreshReadings` has adopted the body.
  - The fake answers only the seed's own request. Whatever `globalThis.fetch` held before the call is back in place before the seed first yields. A test's own wire never answers the seed, and the seed never answers the test.
  - The wait uses microtasks only, with no timer (slow tests are defects).
  - Kept: `fieldReading`, `served`, both parameters, and the replace-whole meaning (one seed per setup, Phase 2 D-10).
  - Comments: correct the header and doc comments where they say the helper sets `readings.value`. Drop the `readings` import if nothing else uses it.
  - Forbidden: any write to the `readings` signal in this file, by any spelling, and any production export added for the seed (owner ruling 2026-11-06; Phase 2 D-12).
  - Port procedure: pre-edit and after-runs are the full-suite run (8 of 18 cores; say so before each).
- **Verify:** the full-suite after-run prints `exit=0` and `# fail 0`. `grep -n -E 'readings\.value *= *[^=]' tests/js/support/readings.js` prints nothing. Reading the file shows no write to `readings` by any spelling. `grep -n refreshReadings tests/js/support/readings.js` shows its import and its call. Lint prints `exit=0`. Testing scope: the outcome is that every seeded value reaches `readings` through `refreshReadings` and that no test's fetch fake sees the seed's request. That is covered by every suite that reads a seeded value, where a missed await or a lost answer fails the case. It is also covered by the refresh cases of `store/core/readings.test.js`, and by the suites whose own wire answers `/api/config`. No new test is added, and testing stops at the full-suite run.

### Task 8: Run the phase exit check and record it

- **Files:** .planning/phases/3/baseline/exit.txt
- **Action:** In the integrate worktree, after Task 7's commit, run the checks below. Write `exit.txt` with the sha, each command, its `exit=` line and log path, the TAP pass, fail and test counts, and each search's output. Say before the full-suite run that it holds 8 of 18 cores, and before the pytest run that it runs the `tests/api` suite. A failing check is not absorbed: quote its shortest decisive line in `exit.txt` and stop for a repair task. The checks:
  - (1) The D-07 full-suite run (AC5).
  - (2) `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/api` (AC6).
  - (3) The AC1 searches under `tests/js`:
    - `grep -rn fileTruth tests/js`;
    - `grep -rn -E 'api/config.*data *:' tests/js`;
    - `grep -rn -E 'emit\("config"|event: "config"|secondEventMoves\("config"' tests/js`;
    - the `config.value` block scan for `profiles` or `device_caps` keys (Notes);
    - `grep -rn -E 'live_(profiles|active)\s*:' tests/js`;
    - `grep -rn -E 'readings\.value *= *[^=]' tests/js`, where every hit outside `tests/js/store/core/readings.test.js` and `tests/js/model/store/reading.test.js` is a failure and no hit is expected anywhere else.
  - (4) The AC2 searches: `grep -n '"config"' hqptuner/static/store/sync.js hqptuner/api/push.py`; `grep -rn 'events(blocks, "config")' tests`.
  - (5) AC3: `git log --format='%h %s%n%b' <START>..HEAD` shows a `Pre-edit:` line with `exit=0` in every port commit.
  - (6) AC4: `git diff <START> -- tests` shows a removed or added assert or `test(` line only in these places:
    - inside a deleted `config` push test;
    - in a file whose commit carries a `Contract mismatch:` record;
    - on a `test(` or `beforeEach(` line whose only change is `async` before its callback, or Plan 1 Task 6's dropped `t`;
    - on a line an owner-approved `Await-only assert lines:` record lists;
    - in the case a Plan 1 Task 6 `Deleted:` line names, if that route was taken.
  - (7) The Await check over every file under `tests/js` lists no un-awaited covered call.
- **Verify:** `exit.txt` records `exit=0` and `# fail 0` for (1) and `exit=0` for (2). Every (3) and (4) search prints empty output, except the `live_` hits Notes names and the `readings.value` hits inside the two reading-model suites. (5), (6) and (7) hold for every commit since START. Testing scope: this task adds no test; these runs and searches are the phase's acceptance evidence, and testing stops at them.

## Notes

- Expected `live_` hits in (3), kept by decision, listed in `exit.txt` and not counted as failures: `live_profiles` / `live_active` in `tests/js/store/presets/profiles.test.js` and `tests/js/support/profile-fixtures.js`, the `reset()` parameter names (D-03, Phase 2 D-02). No `readings.value =` hit is expected outside the two reading-model suites (owner ruling 2026-11-06).
- The `config.value` block scan in (3) is the planning-time scan. For each file with a multi-line `config.value = {` assignment, the lines up to its closing `};` are searched for a `profiles`, `device_caps`, `file`, `active` or `rows` key. It runs together with the single-line `grep -rn -E 'config\.value *=.*(profiles|device_caps)' tests/js`.
- Recalled: Phase 2 `UAT.md` shows the exit-check shape: one `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test` run, `exit=0`, zero failures.
- Plans 7 and 10 both lease `support/readings.js`, `support/listsfixture.js`, `support/rendered/pipelines-fixture.js` and `support/rendered/volume-range.js`. They also re-lease files of Plans 1 to 6. The plans run in order, so the overlap is sequential.
