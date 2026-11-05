---
phase: 2
plan: 1
requirements: [INTG-01, INTG-02]
files:
  - .planning/phases/2/baseline/base.txt
  - .planning/phases/2/baseline/files.txt
  - .planning/phases/2/baseline/failures.log
  - .planning/phases/2/baseline/routes.md
  - .claude/worktrees/integrate/tests/js/support/field-harness.js
  - .claude/worktrees/integrate/tests/js/support/profile-fixtures.js
  - .claude/worktrees/integrate/tests/js/support/easy/easyrate.js
  - .claude/worktrees/integrate/tests/js/support/easy/easytiles.js
  - .claude/worktrees/integrate/tests/js/support/shaperfit-fixtures.js
  - .claude/worktrees/integrate/tests/js/support/rendered/pipelines-fixture.js
---

# Phase 2: Baseline recovery - Plan 1: Baseline record and shared seed helpers

## Goal

The JS baseline in `.claude/worktrees/integrate` passes, through repaired test machinery and fixed production defects, with every valid claim unchanged (design step 12a). This plan fixes the baseline on record before any repair, routes every failure, and repairs the shared support helpers before any of their callers is touched.

## Must be true when done

- `.planning/phases/2/baseline/` holds the fresh failing test-file list, the whole failure log and the tip SHA it was taken on, all captured before the first repair commit of the phase.
- Every failing test in that log has exactly one route in `routes.md`: machinery repair, builder, or contract mismatch.
- `field-harness.js`, `profile-fixtures.js` and the easy helpers assign no field value and no `file`, `active` or `rows` key to `config.value` or `matrixConfig.value`; the values they receive reach `readings.value` through the one `seedReadings`.
- Every importer of a helper this plan touches that passed at baseline still passes, with no caller edited.
- No commit of this plan adds or removes an assert line, and none stages `uv.lock` or `.planning/reads.jsonl`.

## Context

- Locked: D-01 (form signals carry only `fields` metadata, `profiles`, `device_caps`; `file`, `active`, `rows` go, no empty placeholders), D-02 (a repaired helper keeps its callers' signatures where it can, seeds through `seedReadings`, strips values from the form signal), D-03 (one route per failure; shared helpers before callers), D-04 (fresh baseline, durable path outside `/tmp`), D-06 (exit command shape), D-09 (helper-routed seeds count), D-10 (`seedReadings` and `fieldReading` unchanged; it replaces `readings.value` whole, so one call per setup), D-13 (stage by name), D-14 (red intermediate commits allowed; other pre-commit gates apply). Source: `.planning/phases/2/CONTEXT.md`.
- Every `tests/js/` and `scripts/` path is relative to `/home/atom/dev/hqptuner2/.claude/worktrees/integrate`, and every command runs there. `.planning/phases/2/baseline/` is under `/home/atom/dev/hqptuner2` (the main checkout), outside `/tmp`. Markdown there is written with `Write`/`Edit`, soft-wrapped.
- A file run means `PYTHONPATH=$(pwd) scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <files>`, no coverage flags. A full-suite run adds `--test-concurrency=8` and passes the three globs `make test-js` passes (`tests/js/*/*.test.js tests/js/*/*/*.test.js tests/js/*/*/*/*.test.js`), expanded by bash because zsh errors on an empty glob. It holds 8 of 18 cores for the run: say so before it starts (`~/dev/CLAUDE.md` 3.1). Never pipe a gate into `head`, `tail` or `grep`; read the log it names.
- The assert check means `git diff <BASE> -- <files>` (BASE from `base.txt`) shows no added or removed line containing `assert` and no changed `test(` title.
- Lint means `PYTHONPATH=$(pwd) scripts/gate.sh make lint-js` prints `exit=0` (eslint, prettier, both `tsc` projects, knip, jscpd at 2.3%). An export a repair leaves unused is deleted, not exempted.
- Built interfaces: `tests/js/support/readings.js` (`fieldReading`, `seedReadings`), `hqptuner/static/store/core/readings.js` `field`, `hqptuner/static/store/resolve.js` `configByName` / `matrixByName`. Production reads of the form signals are `config.value?.fields`, `config.value?.profiles`, `config.value.device_caps`, `matrixConfig.value?.fields`, `matrixConfig.value.file_profiles` and `matrixConfig.value.preset_profiles`; nothing reads `file`, `active` or `rows`.
- Forbidden (design Homes table and step 12a): a second seed builder, a local field-reading builder, a `readings.value = {...}` literal outside `support/readings.js`, a compatibility reader, a skip, a relaxed assertion, any edit to `seedReadings` or `fieldReading`.
- Out of scope: retired shapes such as `fileTruth` (Phase 3), the JS coverage thresholds and CI (Phase 4), any `v2` code change, any `hqptuner/` edit in this plan.

## Tasks

### Task 1: Capture the fresh baseline on the branch tip

- **Files:** .planning/phases/2/baseline/base.txt, .planning/phases/2/baseline/files.txt, .planning/phases/2/baseline/failures.log
- **Action:** On the current `rebuild/integrate` tip, with the tracked tree clean (only `?? .planning/reads.jsonl` and `?? uv.lock` untracked), run the full-suite run once. Copy the whole log it names into `failures.log` with `cp`, never trimmed. Write `files.txt` with one repo-relative path per line, sorted: every test file that holds a failing test, taken from the `location:` line of each `not ok` block, plus any file that fails as a whole. Write `base.txt` with the tip SHA (this is BASE for every later plan), the exact command, the `# pass` and `# fail` counts, the original log path, and an `unleased:` line listing every path in `files.txt` that no Plan 3, 4 or 5 task leases. Phase 1's last `make check` log showed 195 failures in the 53 files those plans lease; that log is a cross-check, not the list. The Oct 29 log `/tmp/gate-make-xpmIlBwM.log` predates four commits and is not the list either (D-04).
- **Verify:** `git -C .claude/worktrees/integrate rev-parse HEAD` equals the SHA in `base.txt`. The `# fail` count in `base.txt` equals the number of `not ok` blocks of test type in `failures.log`. Every `location:` file of a failing block appears in `files.txt`, and no other path does. `git status --short` in integrate shows exactly the two untracked paths. If `unleased:` is not empty, stop and return the list for plan revision before Task 2. Testing scope: no test is written; the evidence is the run itself and these counts.

### Task 2: Route every baseline failure

- **Files:** .planning/phases/2/baseline/routes.md
- **Action:** Adjudicate each failing test in `failures.log` against the approved behavior (`docs/spec/api.md`, `docs/spec/faceplate.md`, `docs/superpowers/specs/rebuild-integrate-design.md`) and the built interface it calls, read through the TypeScript declaration view, including every shared fixture the test imports. Give each failure exactly one entry: file, test title, the decisive failing line, the route, and its evidence. A `repair` entry names the wrong machinery (for example a value seeded through `config.value` that production reads from `readings.value.fields`, a write to a computed signal such as `speakers` in `store/matrix/speakers.js`, a prop the built `Header` takes and the test omits, as with `panel.openPanel`). A `builder` entry names the valid claim and the `hqptuner/static/` path a failing line implicates (D-12). A contract-mismatch entry quotes the before and after documents, or reads `unresolved` and names the owner question. Entries may share a cause line, never a route. Add a helper section saying, for `shaperfit-fixtures.js`, `rendered/pipelines-fixture.js`, `easy/easytiles.js`, `easy/easyrate.js`, `field-harness.js` and `profile-fixtures.js`, which importer failures that helper causes. D-05 binds: every failure is adjudicated here, whatever its cause, and none is deferred to Phase 3. No test or production file changes in this task.
- **Verify:** The number of entries in `routes.md` equals the `# fail` count in `base.txt`, and each test title of a `not ok` block appears exactly once. Every entry carries one of the three routes. Every `builder` entry names a path under `hqptuner/static/`. Every contract-mismatch entry carries two quotations or `unresolved`. `git status --short` in integrate is unchanged from Task 1. Testing scope: no test is written; the record is the evidence the later repair tasks cite.

### Task 3: Seed field-harness values through seedReadings

- **Files:** .claude/worktrees/integrate/tests/js/support/field-harness.js
- **Action:** `reset({ fields, matrix, meta, plain })` keeps its signature and its callers stay unedited (D-02, D-09). It assigns `config.value` the `fields` entries with their form metadata only (name, options, bounds and the rest, no `value`) and `profiles: null`, with no `file` or `active` key, and `matrixConfig.value` the `matrix` entries with no `value`. The values those entries carry, `MATRIX_ENGAGED` included, reach `readings.value` in one `seedReadings` call made after `discardAll()` settles, under the served names `store/core/readings.js` `field` resolves. Update the `ConfigField` typedef and its comment to state what the type now carries. Cite `field-harness.js` `reset` and `CONTEXT.md` D-09 in the commit message.
- **Verify:** A file run over the six importers (`tests/js/store/narrow/plainnames-flat.test.js`, `tests/js/store/narrow/plainnames-rec.test.js`, `tests/js/store/prose-notes.test.js`, `tests/js/store/prose-options.test.js`, `tests/js/store/prose-sdm-note.test.js`, `tests/js/store/simplified-two-stage.test.js`) prints `exit=0`, as they did at baseline. `git diff --stat <BASE>` shows `field-harness.js` alone changed by this commit. The assert check is clean, and no assignment in the file to either form signal carries a field `value` or a `file`, `active` or `rows` key. Lint passes. Testing scope (`tests/js/support/` is a strong area): the deeper check is every importer passing unedited; no new test.

### Task 4: Strip profile-fixtures form signals to metadata

- **Files:** .claude/worktrees/integrate/tests/js/support/profile-fixtures.js
- **Action:** `reset` keeps its signature. Its `config.value` assignment loses `file` and `active`, and its `matrixConfig.value` assignment loses `rows`. The members `m` spreads in (`file_profiles`, `preset_profiles`, which production reads) stay. If an importer relied on `rows` for pipeline rows, those rows reach `readings.value` through the existing `seedReadings` call in `reset`, in that one call (D-10). Leave `profileReading`, `pendingReading` and the wire route as they are.
- **Verify:** A file run over the eight importers (`tests/js/components/faceplate-builders/profile.test.js`, `tests/js/components/faceplate-page/profile.test.js`, `tests/js/components/faceplate/switcher.test.js`, `tests/js/store/faceplate-builders/profile.test.js`, `tests/js/store/faceplate-page/profile.test.js`, `tests/js/store/faceplate/switcher.test.js`, `tests/js/store/presets/profile_fanout.test.js`, `tests/js/store/presets/profiles.test.js`) prints `exit=0`, as at baseline. Only `profile-fixtures.js` is changed by this commit. The assert check is clean. `grep -nE "file: \{\}|active: \"\"|rows: \[\]" tests/js/support/profile-fixtures.js` prints nothing. Lint passes. Testing scope: importers passing unedited is the evidence; no new test.

### Task 5: Seed the easy helpers' file half through seedReadings

- **Files:** .claude/worktrees/integrate/tests/js/support/easy/easyrate.js, .claude/worktrees/integrate/tests/js/support/easy/easytiles.js
- **Action:** The payload `configPayload` builds and `easytiles.js` assigns to `signals.config.value` carries `fields` metadata and `profiles` only: no `file` half, no `active`, no field `value` in the rows `formFields` returns. The values that half and those rows carry (`mode`, the `engineRows(engine)` backend and switches) reach `readings.value` through one `seedReadings` call after `discardAll()` in the same easytiles setup, served as file-store readings where the payload held them in `file`. `easytiles.js` keeps its exported signatures, so `easytable.js` and the test importers are not edited. If `configPayload` changes shape or loses its only caller, update its doc comment, or delete it if knip reports it unused. Any importer failure `routes.md` attributes to these helpers passes after this task.
- **Verify:** A file run over `tests/js/components/faceplate-page/presets.test.js`, `tests/js/store/faceplate-page/presets.test.js`, `tests/js/store/easy/easy.test.js`, `tests/js/store/easy/easy-pips.test.js`, `tests/js/store/easy/easy-filtername.test.js` and `tests/js/components/matrix/library-clear.test.js` shows every file that passed at baseline passing. In `store/faceplate-page/presets.test.js`, each failure `routes.md` gives these helpers passes, and the rest fail with their baseline error text. Only the two helper files are changed by this commit. The assert check is clean, and no assignment in either file to a form signal carries a field value or a `file`, `active` or `rows` key. Lint passes. Testing scope: importer runs only; no new test.

### Task 6: Repair shaperfit-fixtures where routes.md blames it

- **Files:** .claude/worktrees/integrate/tests/js/support/shaperfit-fixtures.js
- **Action:** If the helper section of `routes.md` blames `shaperfit-fixtures.js` for any importer failure (candidates: `store/guards/shaperfit-alerts.test.js`, `store/guards/shaperfit-mode-gate.test.js`, `store/faceplate-alerts/alerts.test.js`, `components/faceplate-alerts/rail.test.js`), repair the fixture's `reset` seed as that entry states. Keep its signature, keep the one `seedReadings` call, and leave claims unchanged. If no failure is blamed on it, make no change and say so in the task report, quoting the `routes.md` line.
- **Verify:** A file run over its eight importers (`tests/js/components/faceplate-alerts/drawer.test.js`, `tests/js/components/faceplate-alerts/rail.test.js`, `tests/js/store/faceplate-alerts/alerts-dropped.test.js`, `tests/js/store/faceplate-alerts/alerts.test.js`, `tests/js/store/faceplate-alerts/alerts-unread-saves.test.js`, `tests/js/store/guards/shaperfit-alerts.test.js`, `tests/js/store/guards/shaperfit-graying.test.js`, `tests/js/store/guards/shaperfit-mode-gate.test.js`) shows every file that passed at baseline passing. Every failure blamed on the helper passes, and every other failure keeps its baseline error text. The assert check is clean. Lint passes. Testing scope: importer runs only; no new test.

### Task 7: Repair pipelines-fixture where routes.md blames it

- **Files:** .claude/worktrees/integrate/tests/js/support/rendered/pipelines-fixture.js
- **Action:** The same rule as Task 6 for `rendered/pipelines-fixture.js` and the failures of `components/faceplate-drawers/drawers-pipelines-schema.test.js`. Repair only what `routes.md` blames on the fixture, keeping its signature and its one `seedReadings` call. If nothing is blamed on it, make no change and say so, quoting the line.
- **Verify:** A file run over `tests/js/components/faceplate-drawers/drawers-pipelines-schema.test.js` and `tests/js/components/faceplate-drawers/drawers-pipelines.test.js` shows `drawers-pipelines.test.js` passing, every failure blamed on the fixture passing, and every other failure keeping its baseline error text. The assert check is clean. Lint passes. Testing scope: importer runs only; no new test.

## Notes

- Plans 1 to 6 run in order. They share no files, but Task 1 must precede every repair (D-04), and Plan 1's helpers precede their callers in Plans 3 to 5 (D-03).
- Full-suite runs add `--test-concurrency=8` to D-06's command shape, to keep the host unsaturated (`~/dev/CLAUDE.md` 3.1). It is not a coverage flag.
- `failures.log` is about 1 MB of TAP. D-04 needs it whole at a durable path; whether it is committed with the planning docs is the orchestrator's call.
- No plan leases an `hqptuner/static/` path. Which production files a `builder` route touches is unknown until Task 2 adjudicates and the repair plans expose what seeds hid. The only production path the Phase 1 failure output names is `components/faceplate/Header.js` (`openPanel`), and the evidence there points to test machinery. If `routes.md` or any `Builder route:` commit line names a defect, a production-fix plan leased from those entries runs after Plan 5 and before Plan 6. It goes `test-writer` red first where no valid failing test exists, then `builder`. Plan 6 Task 1 refuses to pass while one is open.
- Kept out of scope as not covered by D-01's three keys: the `matrixConfig.value` members `live_profiles`, `file_profiles` and `preset_profiles` (production reads the last two), and the `/api/config` answer `tests/js/support/wire/livepresetwire.js` serves with `file` and `active`. That answer is a wire fake, not an assignment, so AC3 does not reach it.
- Recalled: Phase 1 `SUMMARY.md` (`# fail 195` of 4904 at the integrate tip; untracked `uv.lock` and `.planning/reads.jsonl` left untouched) and Phase 1 `UAT.md` (`test-policy check --root .` ok in integrate).
