---
phase: 1
plan: 1
requirements: []
files:
  - .claude/worktrees/integrate/.github/cadence/coverage-policy.json
  - .claude/worktrees/integrate/.planning/config.json
  - .claude/worktrees/integrate/.github/cadence/coverage-report-check.mjs
  - .claude/worktrees/integrate/.gitignore
  - .claude/worktrees/integrate/eslint.config.js
  - .claude/worktrees/integrate/Makefile
  - .claude/worktrees/integrate/.github/workflows/check.yml
  - .claude/worktrees/integrate/scripts/pytest_plugins/run_stamp.py
  - .claude/worktrees/integrate/scripts/pytest_plugins/suite_deadline.py
  - .claude/worktrees/integrate/scripts/idle_probe.py
  - .claude/worktrees/integrate/scripts/clock_probe.py
---

# Phase 1: Coverage gate in CI - Plan 1: Wire the accepted coverage commands into check.yml on rebuild/integrate

## Goal

CI enforces the accepted testing policy's coverage commands and thresholds, and any shortfall against them is closed. In this phase that holds on `rebuild/integrate` (worktree `.claude/worktrees/integrate`); `v2` receives it at the Phase 4 merge.

## Must be true when done

- In `.claude/worktrees/integrate`, `node /home/atom/.claude/plugins/cache/cadence/cadence/3.11.1/cadence-core/bin/planning.mjs test-policy check --root .` prints `"ok":true`, `"accepted":true`, `"gate_found":true` and an empty `problems` list. At planning time it prints `"accepted":false`, a vacuous pass, because integrate has no `.planning/config.json`.
- `git ls-files .github/cadence` in integrate lists `coverage-policy.json` and `coverage-report-check.mjs`, and the second is byte-identical to the Cadence template.
- `make -n pytest-offline` in integrate prints the accepted pytest command as one contiguous run of text. The `check` job in `check.yml` runs the offline pytest suite exactly once and the JS suite exactly once.
- In integrate, the accepted pytest command followed by the report check on `.coverage.json` exits 0 at lines 95 and branches 90.
- No commit in this plan changes a coverage threshold or adds a gate exemption. None touches `scripts/gates/testing/check_coverage_floor.py`.

## Context

- Locked: D-01 (lands on `rebuild/integrate`, nothing on `v2`), D-02 (the three accepted commands appear verbatim in `check.yml`, and the report check is copied unmodified), D-03 (the `pytest-offline` recipe holds the accepted pytest command word for word plus its existing extra flags, and the `check` job runs that one line), D-04 (no threshold change, no exemption, the per-file floor stays). D-05 is deferred to Phase 4: the JS command exiting 0 and the green `check` + `e2e` run. No task here tries to satisfy it. Source: `.planning/phases/1/CONTEXT.md`, phase 1.
- Every path in this plan is relative to `/home/atom/dev/hqptuner2/.claude/worktrees/integrate`, and every command runs there. A gate runs as `PYTHONPATH=$(pwd) scripts/gate.sh <cmd>` (the worktree rule in `hqptuner2/CLAUDE.md`).
- `planning.mjs test-policy check` matches the accepted commands as text against the workflow files under `.github/workflows/`. It drops full-line YAML comments, joins `\` continuations and collapses whitespace (`normalize` in `cadence-core/bin/planning/testing-policy.mjs`). A command inside a comment does not count, so each command must be on a real `run:` line.
- Out of scope: any `v2` commit, fixing the failing JS tests (Phase 2), push, PR, changes to CI triggers, `make test-js`, and the `e2e` job.

## Tasks

### Task 1: Carry the accepted policy and its config onto rebuild/integrate

- **Files:** .github/cadence/coverage-policy.json, .planning/config.json
- **Action:** Take both files from the `v2` branch's committed tree (`git checkout v2 -- <path>`) unchanged, and commit them on `rebuild/integrate`. Do not merge `v2` into integrate. Both files are needed. `check` compares the config against the committed policy file, and without `.planning/config.json` it reports `accepted:false` and checks nothing (the current state). A full `v2` merge would also carry `e4a918e6`'s triviajudge skips for `.planning/` into integrate (`pyproject.toml` `md_skip`, the `md-trivia` `exclude`), and AC5 forbids adding an exemption. Copying only these two files avoids that. They are identical on both sides, so the Phase 4 merge sees an identical add on each side and does not conflict. Leave the untracked `uv.lock` untracked.
- **Verify:** In integrate, `git diff v2 HEAD -- .github/cadence/coverage-policy.json .planning/config.json` prints nothing. `git show --stat HEAD` lists exactly those two paths, and `uv.lock` is not among them. `planning.mjs test-policy check --root .` now prints `"accepted":true` and `"enforcement":"available"`. Its `problems` list holds exactly the three `accepted command ... is in no workflow file` entries and no config-versus-file disagreement. Testing scope: no automated test. The policy check's own output is the proof, and testing stops there.

### Task 2: Track the report check, byte-identical to the template

- **Files:** .github/cadence/coverage-report-check.mjs, .gitignore, eslint.config.js
- **Action:** Copy `/home/atom/.claude/plugins/cache/cadence/cadence/3.11.1/cadence-core/templates/coverage-report-check.mjs` to `.github/cadence/coverage-report-check.mjs` and do not modify it (D-02). `.gitignore` ignores every `*.mjs` (the throwaway-scratch rule under its "throwaway node scratch scripts" comment), so a plain `git add` skips the file. Add a negation for this one path directly after that rule, with a one-line comment saying what the file is. Do not use `git add -f`: it would leave the file tracked but still matched by an ignore rule that says the opposite. In `eslint.config.js`, the global ignore `"**/*.mjs"` (line 159) would now skip a tracked source file, which widens that exemption's reach. Narrow it instead: add `"!.github/cadence/coverage-report-check.mjs"` directly after it in the same ignores array, and add a config block `files: [".github/cadence/**/*.mjs"]` with `languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.node }`, shaped like the existing `tests/js/**/*.js` block. This narrows an exemption and adds none. Update the ignore's comment so it no longer says every `.mjs` is scratch. Leave `.jscpd.json` as it is: its `path` list (`hqptuner`, `scripts`, `tests`) never reaches `.github`. If eslint still reports any error on the template after this change, stop and report the rule and line. The template cannot be edited (D-02), and any suppression is an owner-approved exemption.
- **Verify:** `cmp` between the template and the copy exits 0. `git check-ignore -q .github/cadence/coverage-report-check.mjs` exits 1. `git ls-files .github/cadence` lists `coverage-policy.json` and `coverage-report-check.mjs`. `node .github/cadence/coverage-report-check.mjs --format python --report .coverage.json` prints one `lines:`, one `branches:` and one `statements:` line, reading thresholds from the tracked policy file without `--policy`. `npx eslint .github/cadence/coverage-report-check.mjs` exits 0 and lints the file instead of printing an ignored-file warning. `npx eslint .` exits 0. `npx prettier --check eslint.config.js` exits 0. Testing scope: the template is Cadence's and carries its own tests. The byte comparison and one run against the existing report are sufficient, and testing stops there.

### Task 3: Make the pytest-offline recipe carry the accepted pytest command

- **Files:** Makefile
- **Action:** Reorder the `pytest-offline` recipe line so its expansion holds `.venv/bin/pytest -m "not live and not e2e" -q --cov=hqptuner --cov-branch --cov-report=json:.coverage.json` as one contiguous run. The `PYTHONPATH=scripts:scripts/pytest_plugins:$$PYTHONPATH` prefix stays in front. The remaining existing flags follow the run: `-p idle_probe`, `-p clock_probe`, `-p run_stamp`, `-p suite_deadline`, `--cov-report=term-missing` and `--junitxml=.pytest-junit.xml`. Keep `$(VENV)` and `"$(OFFLINE_MARKERS)"` in the recipe so every marker name is still spelled once. Neither expression changes, and both expand to the accepted text. Add no flag, drop no flag, and leave every other recipe as it is (D-03, D-04). The comment above the target says it is "the one place its command is written". That stops being true once `check.yml` carries a copy (Task 4), so reword it to name both places.
- **Verify:** `make -n pytest-offline | grep -cF '.venv/bin/pytest -m "not live and not e2e" -q --cov=hqptuner --cov-branch --cov-report=json:.coverage.json'` prints `1`. The whitespace-split tokens of `make -n pytest-offline`, sorted, are identical before and after the edit, so the flag set is unchanged. `git diff HEAD~1 -- Makefile` touches only the `pytest-offline` recipe line and its comment. Testing scope: this is a pure reorder. The token comparison proves nothing was gained or lost, and Task 6 runs the line for real. Testing stops there.

### Task 4: Run the accepted commands in the check job, each suite once

- **Files:** .github/workflows/check.yml
- **Action:** In the `check` job, replace the single `make check IDLE_GATE=off` step with steps that run, in order:
  1. `make lint lint-js`.
  2. The `pytest-offline` recipe line exactly as `make -n pytest-offline` prints it after Task 3 (D-03).
  3. The `test` target's gates without rerunning pytest: `make -o pytest-offline test IDLE_GATE=off`. GNU make's `-o` skips a phony prerequisite's recipe, checked at planning time.
  4. `node .github/cadence/coverage-report-check.mjs --format python --report .coverage.json`.
  5. The accepted JS command with `{lines}` and `{branches}` filled in as 95 and 90, verbatim from `coverage-policy.json`.

  Together these run what `make check` runs, with pytest and the JS suite once each. Do not keep `make check`, `make test` without `-o`, or `make test-js` in this job. Each of them would run a suite a second time. Keep `IDLE_GATE=off` on the gates step. Rewrite the existing step comment so it still explains the offline-only selection and the idle gate for the new steps. Leave the triggers, the `install` step and the whole `e2e` job unchanged. A command may span lines with `\` continuations, since the matcher joins them, but must not sit inside a comment.
- **Verify:**
  - `planning.mjs test-policy check --root .` prints `"ok":true`, `"accepted":true`, `"gate_found":true` and `"problems":[]`.
  - `actionlint .github/workflows/check.yml` exits 0. It exits 0 on the current file.
  - `make -n -o pytest-offline test IDLE_GATE=off` prints no `pytest` invocation.
  - Read the `check` job's steps through `.venv/bin/python` with PyYAML. Across all of its `run:` values together, exactly one step runs `.venv/bin/pytest` (count the token `.venv/bin/pytest`, not the substring `pytest`), and exactly one step carries `--experimental-test-coverage`. No `run:` value contains `make check`, `make test-js` or a bare `make pytest-offline`. The `make -o pytest-offline test` form is allowed.

  Testing scope: CI does not run on `rebuild/integrate` (`check.yml` triggers), so the green CI run is Phase 4's (D-05). The policy check, actionlint and the step inspection above are sufficient here, and testing stops there.

### Task 5: Correct the docstrings that call the Makefile line the only command line

- **Files:** scripts/pytest_plugins/run_stamp.py, scripts/pytest_plugins/suite_deadline.py, scripts/idle_probe.py, scripts/clock_probe.py
- **Action:** Each module docstring says the `pytest-offline` target is the one command line that loads the plugin, run by `make test` and the `pytest-offline` pre-commit hook. After Task 4, the `check` job in `.github/workflows/check.yml` runs a copy of that line too. Reword only that sentence in each docstring so it states the places the line now runs. The text must state what holds now, with no history (the `triviajudge` comment judge reads docstrings). Change no code and no other sentence.
- **Verify:** `git diff HEAD~1 --stat` lists only these four files, and `git diff HEAD~1` changes only docstring lines. `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/ruff check` and `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/black --check`, each over the four files, print `exit=0`. Testing scope: this is a docstring-only change, so no test applies and testing stops there.

### Task 6: Prove Python coverage at lines 95 and branches 90

- **Files:** none expected. If a shortfall appears, the files that close it are a new plan, as stated below.
- **Action:** In integrate, run the Python half of the `check` job in its order: `PYTHONPATH=$(pwd) scripts/gate.sh make pytest-offline`, then `PYTHONPATH=$(pwd) scripts/gate.sh make -o pytest-offline test IDLE_GATE=off`, then `PYTHONPATH=$(pwd) scripts/gate.sh node .github/cadence/coverage-report-check.mjs --format python --report .coverage.json`. Footprint, disclosed in advance under `~/dev/CLAUDE.md` 3.1: the offline suite took 38.9 s for 3673 tests on one core at its last run (`.pytest-junit.xml`), and it is not parallelized. Record the `lines:` and `branches:` figures the report check prints. At planning time the existing report read lines 97.54% and branches 91.10%. Change no threshold and add no exemption (D-04). If the report check fails, stop. Report the actual gap and the files the report check names, per the testing policy's coverage-shortfall rule, and return it for a gap plan. Do not add tests inside this task.
- **Verify:**
  - All three gate runs print `exit=0`, and the report check prints `lines: ... meets 95` and `branches: ... meets 90`.
  - `git diff c530a6e3 HEAD -- scripts/gates/testing/check_coverage_floor.py pyproject.toml .pre-commit-config.yaml .jscpd.json knip.json` prints nothing. `git diff c530a6e3 HEAD -- eslint.config.js` holds only Task 2's change: one added `"!.github/cadence/coverage-report-check.mjs"` ignore negation, the reworded comment above the ignore, and the one added `.github/cadence/**/*.mjs` node-globals block. It removes no rule and adds no ignore. `c530a6e3` is the integrate HEAD at planning time; if integrate moved before Task 1, use its HEAD from just before Task 1.
  - `git diff c530a6e3 HEAD` adds no `noqa`, `type: ignore`, `eslint-disable`, `EXEMPT` or `-exempt:` text.

  Testing scope: the outcome is the total coverage figure. The existing offline suite already provides it, and the per-file floor already covers per-file regressions. One run of the accepted command plus the report check is sufficient evidence, and testing stops there unless a measured shortfall appears.

## Notes

- **Plan shape deviation.** CONTEXT asks for multiple plans. This is one plan of 6 tasks, because the slices are ordered and share inputs. Task 4's check needs Task 1's policy file and Task 3's recipe line. Task 6 runs Task 2's report check and Task 3's line. A split would put cross-plan ordering between slices that can be verified only in sequence.
- **Copy, not merge (D-01's flagged choice).** Carrying the two files avoids bringing `v2`'s `.planning/` triviajudge skips into integrate, and those skips would collide with AC5. The cost: integrate does not get `057c120f`'s `.gitignore` entries for Cadence run records. If a Cadence run ever writes `.planning/trace.jsonl` or `reads.jsonl` inside integrate, those files show as untracked there.
- **Commits on a red tree.** Integrate's `make check` is red on the JS suite (Phase 2's work). Pre-commit runs every gate except the JS suite, so these commits rest on the owner's active red-commit override for the v2 restructure in `hqptuner2/CLAUDE.md`. The orchestrator owns git and that call.
- **Lint reach of the tracked `.mjs`.** Left alone, eslint's `**/*.mjs` ignore would grow from scratch files to one tracked file, and the gate rules count that widening as a new exemption. Task 2 narrows the ignore and adds a node-globals block, so the file gets linted. Linted through stdin with `--no-ignore`, the template failed only `no-undef` on `process` and `console` (4 errors), and node globals resolve them. `.jscpd.json` never reaches `.github`.
- **Footprint.** The pre-commit `pytest-offline` hook is `always_run: true` (`.pre-commit-config.yaml:91-101`), so every task commit runs the offline suite: 3673 tests, about 39 s on one full core. Task 6 runs it once more. Name each run before it starts (`~/dev/CLAUDE.md` 3.1).
- Task 5 is outside the locked decisions. It keeps four docstrings true after D-03's wiring, and the owner can strike it.
