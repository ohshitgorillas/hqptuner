---
phase: 1
plan: 1
# Phase 1 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against the Success Criteria and CONTEXT AC1-AC7.
requirements: []
files:
  - pyproject.toml
  - .filepawl.toml
  - hqptuner/core/junkcal.py
  - hqptuner/core/clock.py
  - tests/engine/test_clock.py
  - tests/test_junkcal.py
  - tests/support/
  - hqptuner/audit_narrow.py
  - tests/audit/
  - hqptuner/lanes/live/routing.py
  - tests/apply/
  - hqptuner/metadata_json.py
  - tests/engine/test_metadata_json.py
  - hqptuner/lanes/http/restore.py
  - hqptuner/conf/formparse.py
  - .gitignore
  - .github/cadence/coverage-report-check.mjs
  - .github/workflows/check.yml
---

# Phase 1: Coverage gate in CI - Plan 1: Coverage margin and CI gate

## Goal

CI fails any change that drops coverage below the accepted policy (lines 95, branches 90), and the offline suite meets that policy with `hqptuner/core/junkcal.py` measured and a margin above 90% branches.

## Must be true when done

- An offline run of accepted command 1 writes a `.coverage.json` whose `totals.covered_branches / totals.num_branches` is at or above 0.91 and which carries an entry for `hqptuner/core/junkcal.py`.
- Accepted command 2 exits 0 on that report and exits non-zero on a copy of it whose branch count is lowered below 90%.
- The `check` job in `.github/workflows/check.yml` runs the three accepted commands, thresholds filled in, after `make check`, so a push to `dev` or a PR below the policy turns `check` red.
- `planning.mjs test-policy check` exits 0, and `git ls-files .github/cadence` lists `coverage-policy.json` and `coverage-report-check.mjs`.
- `make check` is green on every commit of the phase, and no policy value, per-file floor, EXEMPT entry or gate exemption changed.
- `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` report success on the phase's last `dev` commit once the owner pushes it.

## Context

- Locked: D-01 (three accepted commands into CI verbatim, `{lines}`=95, `{branches}`=90; `.planning/config.json` and `.github/cadence/coverage-policy.json` untouched), D-04 (report-check copied verbatim from the cadence template, tracked by a `.gitignore` negation), D-05 (junkcal leaves `[tool.coverage.run] omit`, fallout fixed under `docs/testing.md` rule 12), D-06 (per-file floor and its EXEMPT list stay as they are), D-07 (margin from behavior-backed gaps; unreachable branches removed as dead code; no test written to reach a line), D-08 (steps in the existing `check` job after `make check`).
- The report check fails when any tracked `hqptuner/**/*.py` file is absent from the report (template `coverage-report-check.mjs`, python branch, `files: in scope but absent from the report`). With junkcal omitted, command 2 fails today. That is why junkcal is measured first and the CI steps land last.
- Binding for every task: `docs/testing.md` (read before writing any test; rules 1-4, 7, 12, 15 and 16 bite hardest here), every gate run through `scripts/gate.sh`, `make check` green before every commit, `filepawl accept` run whenever filepawl prints it.
- Out of scope: `testing.coverage.*`, `testing.required_jobs`, `scripts/gates/testing/check_coverage_floor.py` (floor and EXEMPT), `release.yml`, `docker.yml`, and the Windows work of phases 2 and 3.

## Tasks

### Task 1: Measure hqptuner/core/junkcal.py at the per-file floor

- **Files:** pyproject.toml (`[tool.coverage.run]`), hqptuner/core/junkcal.py (`Capture`, `run`, `_claim`, `_build_row`, `_spectrum`), hqptuner/core/clock.py, tests/engine/test_clock.py, tests/test_junkcal.py, tests/support/, .filepawl.toml
- **Action:** Remove `hqptuner/core/junkcal.py` from `[tool.coverage.run] omit` in `pyproject.toml`. It is the only entry, so the table and its comment line go with it. Then close junkcal's coverage gap under rule 12 in the same commit, tests first, because the coverage-floor gate refuses the omit removal on its own. The planner measured the gap on 2026-11-05 by running `tests/test_junkcal.py` alone with the omit lifted: 44 of 94 statements and 1 of 14 branches (41.67% per file, floor 90). With no new tests, global branches would read 1392/1558 = 89.35%. The missing branches are in `_spectrum` (no window), `Capture._append` (first row of a period claims a file), and `Capture.tick` (each leg of the no-reader/no-context/not-playing/no-aggregate guard, the `PERIOD_GAP_SECONDS` close, the ineligible return, the key change that opens a new file, the `OSError` write failure). `_claim`'s numbered-suffix loop and `run`'s pacing loop have no covering test either. The behaviors to pin, through the public `Capture(dest).tick(mgr)` and `run(mgr, dest)` only:
  - A playing, eligible tick appends one JSON row to a period file under `dest`.
  - Idle ticks short of `PERIOD_GAP_SECONDS` keep the period's file. Reaching the gap closes the period, so the next row opens a new file.
  - An ineligible tick writes nothing.
  - A change of samplerate, bins or bandwidth opens a new file.
  - A failed write is logged and the next tick still captures.
  - A row's spectrum is null without a window, and otherwise keeps only points at or above `SPECTRUM_FLOOR_HZ`.
  - `run` ticks once per `TICK_SECONDS` of the manager clock until cancelled.

  Drive the manager through the existing wire fakes (`tests/support/fake_metering.py`, `tests/support/fake_control.py`) and the virtual clock (`tests/support/virtual_clock.py`), with `dest` under `tmp_path`. Never patch `datetime`, `asyncio.to_thread` or junkcal's private helpers (rules 3 and 4), and never wait on a wall clock (rule 7). `_claim`'s numbered-suffix loop is not dead: `_build_row` stamps each row with `datetime.now(UTC)` (junkcal.py:93) and `_claim` names the file from that stamp, so a test that closes a period or changes the key and then ticks again claims two files in the same UTC second and takes `n += 1`. Never remove that loop; without it `touch(exist_ok=False)` raises `FileExistsError`, `tick` logs it as a write failure and the row is lost. Its coverage still depends on whether the wall-clock second rolls over, which is a code problem under rules 7 and 12: route the row timestamp through the manager clock seam (`hqptuner/core/clock.py` has no wall-time reading today, so add one there and have the virtual clock drive it), so a test pins the same-second collision deterministically. Name that choice in the commit message. Add to `tests/support/` only when no existing fake speaks the wire shape a test needs. These tests characterize existing behavior, so they are exempt from rule 8's red run; say so in the hand-back. Leave `TickState` and the module's other members as they are: nothing here licenses a wider cleanup.
- **Verify:** `scripts/gate.sh make check` exits 0, including the coverage-floor gate with junkcal measured. In the `.coverage.json` that run writes, `files["hqptuner/core/junkcal.py"]` exists and its `summary.percent_covered` is at or above 90. `pyproject.toml` no longer has a `[tool.coverage.run]` omit naming junkcal. Testing scope: the outcomes are the seven behaviors above. `tick_state`'s ineligible verdict and `band_stats` are already covered. Add the smallest set that pins each remaining behavior once, against the fakes, with no live daemon contact. The evidence is enough when junkcal clears the floor and every branch the report still lists has been removed as unreachable or covered by a behavior test. Testing stops there.

### Task 2: Close the branch gaps in hqptuner/audit_narrow.py

- **Files:** hqptuner/audit_narrow.py (`narrow_fields` and its `_is_*` guards), tests/audit/, .filepawl.toml
- **Action:** The 2026-11-05 report lists 15 missing branches in `hqptuner/audit_narrow.py` (90.68% per file), every one of them partial. The module's contract is in its docstring: `narrow_fields` keeps a recognized key holding the right shape and drops an unrecognized key or a wrong-shaped value, so a hand-edited or foreign JSONL line never crashes the reader. Re-measure first, because the numbers may have moved. Then, for each missing branch, either pin the behavior it carries at the lowest lane that observes it (rule 15: `narrow_fields` is public, so a pure-function test comes before a test through `AuditLog.tail` in `hqptuner/audit.py`), or remove the branch where no input through that contract can reach it, naming each removal in the commit message. Choose the inputs from the shapes the docstring and `hqptuner/audit_types.py` declare, never by reading which line is uncovered and building a value to reach it (rule 12). Collapse same-key cases into one parametrized test (rule 2).
- **Verify:** `scripts/gate.sh make check` exits 0. In the fresh `.coverage.json`, `files["hqptuner/audit_narrow.py"].missing_branches` is empty, or each branch still listed is named in the task report with the reason closing it exceeds the planned effort (test-policy coverage-shortfall rule). Any drop in that file's `num_branches` matches removals the commit message names. Testing scope: the outcomes are keep-on-right-shape and drop-on-wrong-shape-or-unknown-key per field family. Well-formed rows are already covered by `tests/audit/`. Add one parametrized case per field family with a wrong shape. That is enough once the file's missing branches are gone, and testing stops there.

### Task 3: Close the branch gaps in hqptuner/lanes/live/routing.py

- **Files:** hqptuner/lanes/live/routing.py, tests/apply/, .filepawl.toml
- **Action:** The 2026-11-05 report lists 7 missing branches in `hqptuner/lanes/live/routing.py` (92.44% per file). This is a strong area (`hqptuner/lanes/`). Re-measure, then read each missing branch and name the routing outcome it decides: which lane a field is sent to, what a refusal or an absent target produces. Pin that outcome at the lowest lane that observes it, through routing's public surface or the manager's apply path that `tests/apply/test_live_routed_batches.py` and `tests/apply/test_manager_apply.py` already drive, against `tests/support/fake_control.py` over its real socket (rule 4). Remove a branch only where no input through the contract reaches it, and name the removal in the commit message. Do not monkeypatch our own code, do not export a private to reach a branch, and do not contact hqplayerd.
- **Verify:** `scripts/gate.sh make check` exits 0. In the fresh `.coverage.json`, `files["hqptuner/lanes/live/routing.py"].missing_branches` is empty, or each branch still listed is named in the task report with the reason closing it exceeds the planned effort. Any drop in `num_branches` matches removals the commit message names. Testing scope: as a strong area, each closed branch's failure leg (a refusal, an absent target, a field with no live route) gets its own case against the fake daemon, not only the success leg. The success routing is already covered by the two apply test files. That is enough once the file's missing branches are gone, and testing stops there.

### Task 4: Close the branch gaps in hqptuner/metadata_json.py

- **Files:** hqptuner/metadata_json.py, tests/engine/test_metadata_json.py, .filepawl.toml
- **Action:** The 2026-11-05 report lists 7 missing branches in `hqptuner/metadata_json.py` (97.85% per file). `tests/engine/test_metadata_json.py` already covers the module's narrowing functions off their defensive edges. Re-measure, then for each missing branch either add the narrowing outcome it carries (a malformed or wrong-typed value is refused or defaulted the way the module's contract states) to that file through the functions it already imports, or remove the branch where no input of the declared JSON shape reaches it, naming each removal in the commit message. Choose inputs from the documented data shape, not from the uncovered line (rule 12). Parametrize same-function cases (rule 2).
- **Verify:** `scripts/gate.sh make check` exits 0. In the fresh `.coverage.json`, `files["hqptuner/metadata_json.py"].missing_branches` is empty, or each branch still listed is named in the task report with the reason closing it exceeds the planned effort. Any drop in `num_branches` matches removals the commit message names. Testing scope: the outcomes are the refusal or default per malformed field. Well-formed reads and the existing edges are already covered. Add one parametrized case per remaining edge. That is enough once the file's missing branches are gone, and testing stops there.

### Task 5: Close the branch gaps in hqptuner/lanes/http/restore.py

- **Files:** hqptuner/lanes/http/restore.py, tests/apply/, .filepawl.toml
- **Action:** The 2026-11-05 report lists 6 missing branches in `hqptuner/lanes/http/restore.py` (92.46% per file). This is a strong area (`hqptuner/lanes/`) and the persistent-settings write path (backup, surgical `hqplayerd.xml` edit, `POST /restore`, readback). Re-measure, then name the restore outcome each missing branch decides, such as a refused restore, a readback that disagrees, or a missing element. Pin it at the lowest lane that observes it, against `tests/support/fake_http.py` and `tests/support/fake_config_xml.py` over the wire (rules 4 and 13), with tests placed in `tests/apply/`. Remove a branch only where the contract cannot reach it, and name the removal in the commit message. Offline fakes only: no call reaches hqplayerd or the dev container, and the write path gains no idle gate (product rule: user actions always proceed).
- **Verify:** `scripts/gate.sh make check` exits 0. In the fresh `.coverage.json`, `files["hqptuner/lanes/http/restore.py"].missing_branches` is empty, or each branch still listed is named in the task report with the reason closing it exceeds the planned effort. Any drop in `num_branches` matches removals the commit message names. Testing scope: as a strong area, each closed branch's failure leg (the daemon refuses, the readback disagrees, the config lacks the element) gets its own case against the fakes. The restore happy path is already covered across `tests/apply/`, `tests/presets/` and `tests/matrix/`. That is enough once the file's missing branches are gone, and testing stops there.

### Task 6: Close the branch gaps in hqptuner/conf/formparse.py

- **Files:** hqptuner/conf/formparse.py, tests/apply/, .filepawl.toml
- **Action:** The 2026-11-05 report lists 6 missing branches in `hqptuner/conf/formparse.py` (95.96% per file). This is a strong area (`hqptuner/conf/`). It parses the daemon's 8088 configuration form, and `tests/apply/test_form_parse.py` already drives it from form bytes. Re-measure, then for each missing branch either pin the parse outcome it carries for a documented form shape (an absent attribute, an unchecked control, an unknown input type), in `tests/apply/test_form_parse.py` or a sibling in `tests/apply/`, or remove the branch where no form the daemon serves can reach it. Name each removal in the commit message. Check form shapes against `docs/protocol.md` and the hqpdoc tools (`hqp_find`, then `hqp_section`), not by inference. Feed the parser bytes, as the existing tests do; do not mock our own code.
- **Verify:** `scripts/gate.sh make check` exits 0. In the fresh `.coverage.json`, `files["hqptuner/conf/formparse.py"].missing_branches` is empty, or each branch still listed is named in the task report with the reason closing it exceeds the planned effort. Any drop in `num_branches` matches removals the commit message names. Testing scope: as a strong area, each closed branch's malformed-form leg gets its own case. Well-formed parsing is already covered by `tests/apply/test_form_parse.py` and `tests/engine/test_httpconf_form_types.py`. That is enough once the file's missing branches are gone, and testing stops there.

### Task 7: Track the coverage report check

- **Files:** .gitignore, .github/cadence/coverage-report-check.mjs
- **Action:** Copy `/home/atom/.claude/plugins/cache/cadence/cadence/3.11.1/cadence-core/templates/coverage-report-check.mjs` byte for byte to `.github/cadence/coverage-report-check.mjs` (D-04). Add the negation `!.github/cadence/coverage-report-check.mjs` to `.gitignore` on the line after the `*.mjs` pattern: gitignore applies the last match, so a negation above the pattern does nothing. Keep the comment above `*.mjs` accurate for the scratch scripts it still covers. Pre-commit tags `.mjs` as javascript, so the eslint, doc-refs, archaeology and comment-trivia hooks see this file. `eslint.config.js` ignores `**/*.mjs`, `.jscpd.json` ignores it, and knip's `project` globs do not reach `.github/`. If archaeology or comment-trivia refuses the template's comments, stop and raise a blocking question to the owner quoting the refusal. The copy is verbatim by decision, so do not edit it, and an exemption needs the owner's approval of that site first.
- **Verify:** `git check-ignore -v .github/cadence/coverage-report-check.mjs` exits 1, so the file is not ignored. `cmp` of the template against the copy exits 0. Run accepted command 1 through `scripts/gate.sh` (one core for about 40 s; name it before it runs). Accepted command 2, `scripts/gate.sh node .github/cadence/coverage-report-check.mjs --format python --report .coverage.json`, exits 0 with no "absent from the report" line (AC3, first half). In that report, `totals.covered_branches / totals.num_branches` is at or above 0.91 (AC1), and `files` has `hqptuner/core/junkcal.py` (AC2). Copy the report to `${CLAUDE_SCRATCH:-/tmp}`, set the copy's `totals.covered_branches` below `0.9 * totals.num_branches`, and run the same script with `--report <copy>`: it exits non-zero and names branches (AC3, second half). If AC1 reads below 0.91, that is a measured shortfall in Tasks 1-6: report the actual ratio and stop, and change no threshold. Testing scope: no new tests. The template is cadence's, and the pass/fail pair above is enough evidence that it reads this report.

### Task 8: Run the accepted coverage commands in the CI check job

- **Files:** .github/workflows/check.yml (`jobs.check.steps`, after the `make check` step)
- **Action:** Add three steps to the `check` job in `.github/workflows/check.yml`, after the existing `make check` step and in this order: accepted command 1, then 2, then 3, from `testing.coverage.commands`. Copy each verbatim, with command 3's `{lines}` and `{branches}` filled in as 95 and 90. Put each command on one line inside a `run: |` block scalar so YAML quoting alters no character and `test-policy check`'s text match finds it. Separate named steps make a red run name the failing command. Command 2 reads the `.coverage.json` command 1 writes in the same job workspace; the checkout already has git and the `npm ci` install command 3 needs. Leave the `e2e` job, `release.yml` and `docker.yml` alone: both reach this job through `workflow_call` and `needs: check`, so they inherit the gate. Do not edit `.github/cadence/coverage-policy.json` or `.planning/config.json`. Command 1 runs the offline suite a second time after `make check`. That is what D-01 and D-08 lock, and the job's `timeout-minutes: 20` holds it. Any comment added states what the step enforces.
- **Verify:** `node /home/atom/.claude/plugins/cache/cadence/cadence/3.11.1/cadence-core/bin/planning.mjs test-policy check` exits 0 with `"ok":true` (AC4). Loading `.github/workflows/check.yml` with `.venv/bin/python` and `yaml` shows the `make check` step's index below each of the three new steps' indices in `jobs.check.steps` (AC6). After the task's commit, `git ls-files .github/cadence` lists `coverage-policy.json` and `coverage-report-check.mjs` (AC5). `scripts/gate.sh make check` exits 0. CI: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows report success on the phase's last `dev` commit once the owner pushes it (AC7). Testing scope: no new tests. The commands and thresholds are the accepted policy, and the required-job run is the evidence.

## Notes

- Plan shape deviation: CONTEXT asks for multiple plans, but this is one plan of 8 tasks. The CI work (Tasks 7-8) shares no files with the coverage work, but it must land after it: the report check fails while junkcal is absent from the report, and global branches read 89.35% once junkcal is measured without its tests. That ordering fails the split test, and 8 tasks fit one plan's ceiling.
- Task order departs from the testing-policy instruction that the CI job be the first task. A CI step committed first would carry a red gate, because command 2 fails today on the junkcal omit, and `~/dev/CLAUDE.md` 11.4 forbids committing one. The CI steps therefore land last, on a tree that passes them.
- The CONTEXT flag asks for the last commit to touch a `release.yml` path. It cannot: the only such change here is Task 1's `pyproject.toml` edit, and moving it last would commit a red CI gate in Task 8. GitHub judges a push's `paths` filter on all files changed across the pushed range, so a push carrying the whole phase runs the five release jobs on its head. A push that leaves Task 1 out of the final range runs none of them, and AC7 then stays pending. The push is the owner's.
- Footprint: each full offline-suite run holds about one core for about 40 s (`.pytest-junit.xml` time 40.457 s on 2026-11-05). `~/dev/CLAUDE.md` 3.1 has the executor name each run before it starts.
- No `CHANGELOG.md` entry and no user-facing copy: this is internal-only work, which the changelog rule lets skip.
- In a worktree, run gates as `PYTHONPATH=$(pwd) scripts/gate.sh make check` (repo `CLAUDE.md`, Dev).
- `pyproject.toml` calls junkcal a "temporary feature to be used for a few days then disabled". Retiring the module is the owner's call and is not in this plan. D-05 brings it under measurement as it stands.
