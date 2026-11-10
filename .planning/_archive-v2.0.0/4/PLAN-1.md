---
phase: 4
plan: 1
requirements: [INTG-04]
files:
  - .planning/phases/4/baseline/integrate-check.txt
  - .claude/worktrees/integrate/tests/js/
  - .claude/worktrees/integrate/.filepawl.toml
---

# Phase 4: Integrate into v2 - Plan 1: Integrate check green

## Goal

`rebuild/integrate` is green (design step 12c): `PYTHONPATH=$(pwd) scripts/gate.sh make check` in `.claude/worktrees/integrate` prints `exit=0`, with any JS coverage shortfall against the `test-js` thresholds closed by new tests and no threshold or exemption touched.

## Must be true when done

- In `.claude/worktrees/integrate`, `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints `exit=0` at the plan's last integrate commit, and `.planning/phases/4/baseline/integrate-check.txt` quotes that line, its log path and the commit it ran at.
- The JS coverage `# all files` row of that run reads at least lines 95, branches 90, functions 85, and the record quotes it.
- No commit of this plan changes a threshold in `Makefile` or `.github/cadence/coverage-policy.json`, adds a gate exemption, or contains `uv.lock` or `.planning/reads.jsonl`.
- The record states whether a JS coverage shortfall with every test passing made `make test-js` exit non-zero (the first flagged assumption in CONTEXT).

## Context

- D-02 locks the coverage repair: a shortfall against lines 95 / branches 90 / functions 85 (`Makefile` `test-js`) is closed inside Phase 4 by new tests written tests-first through the 12a route (`docs/superpowers/specs/rebuild-integrate-design.md`, step 12a: the lead commissions `test-writer` for tests; claims stay unchanged). No threshold changes, no `--test-coverage-exclude` is added, no exemption is written (Phase 1 D-05, `.planning/phases/1/CONTEXT.md`; Phase 1 UAT, coverage floor gate untouched).
- D-03 and D-05: the AC1 command runs in `.claude/worktrees/integrate` with `PYTHONPATH=$(pwd)`, because both trees' `.venv` is the editable install of `/home/atom/dev/hqptuner2/hqptuner`. The Python half is expected green (`.pytest-junit.xml` 3672 tests, 0 failures; `.coverage.json` lines 97.54 / branches 91.10) and is confirmed, not worked.
- The only recorded JS coverage figure, 96.40 / 90.10 / 86.06, comes from the `dev` checkout (`/tmp/gate-make-*.log`), not from integrate. No integrate coverage run exists. Phase 3's exit record ran the JS suite without coverage flags: 4880 of 4880 pass at `fe97fb16` (`.planning/phases/3/UAT.md`).
- Footprint (`~/dev/CLAUDE.md` 3.1): `make check` runs `pytest-offline` (3672 tests, about 39 s on one full core, `.planning/phases/1/PLAN.md` Notes), then `test-js`, whose recipe sets no `--test-concurrency`, so node runs up to 17 test processes on this 18-core host for the JS suite's duration. Name both before each `make check` starts. Every `make check` in this phase runs under `nice -n 19`, so hqplayerd keeps first claim on the cores while node's workers run (`~/dev/CLAUDE.md` 2.1, 3.1); the gate, its thresholds and its `exit=` line are unchanged. `taskset` is not used, because a narrower core set lengthens the suite and could fire the D-06 suite-time gate for a reason the code did not cause. Interim JS runs this plan adds pass `--test-concurrency=8`, the Phase 2 and 3 full-suite shape (`.planning/phases/2/PLAN-1.md`).
- D-06: `make check` writes `.suite-time.rebuild--integrate.json` and `.idle-last.rebuild--integrate.json` into `/home/atom/dev/hqptuner/`. A firing idle or suite-time gate is evidence (`~/dev/CLAUDE.md` 6.3): those record files are never edited, deleted or re-baselined to pass.
- D-09: `uv.lock`, `.planning/reads.jsonl` in integrate and stash `b23a78f0` stay untouched and out of every commit. Integrate commits stage their paths by name.

## Tasks

### Task 1: Measure `make check` on integrate

- **Files:** .planning/phases/4/baseline/integrate-check.txt
- **Action:** In `.claude/worktrees/integrate` at its current HEAD (`fe97fb16` at planning time), name the footprint in Context, then run `PYTHONPATH=$(pwd) nice -n 19 scripts/gate.sh make check` once. Read the log the wrapper names; do not pipe the gate. Write `.planning/phases/4/baseline/integrate-check.txt` in the main checkout with: the command, the integrate commit, the `exit=` line and log path, every failing gate with its shortest decisive line, the node test summary counts (`# tests`, `# pass`, `# fail`), the `# all files` coverage row, and for each of lines, branches and functions that sits under its threshold, the gap in points and the `hqptuner/static/` files with the most uncovered lines, branches or functions in that metric, each with the uncovered line ranges node prints. State whether `make test-js` exited non-zero on the coverage threshold alone with zero failing tests. Change nothing in integrate. If any gate other than the `test-js` coverage thresholds fails (a Python gate, `check_spelling.py`, `check_docs.py`, `css-dead`, a lint, a failing JS test), record it and stop this plan after Task 1: its repair touches files no plan declares, so it goes back to the orchestrator for a repair plan through the 12a route rather than into Task 2.
- **Verify:** `.planning/phases/4/baseline/integrate-check.txt` exists and quotes an `exit=` line whose log path exists under `${CLAUDE_SCRATCH:-/tmp}`; the `# all files` row in the record matches the row in that log; `git -C .claude/worktrees/integrate status --short` lists only `?? .planning/reads.jsonl` and `?? uv.lock`. Testing scope: measurement only, no test is added; the evidence is the one log.

### Task 2: Close the JS coverage shortfall with new tests

- **Files:** .claude/worktrees/integrate/tests/js/, .claude/worktrees/integrate/.filepawl.toml
- **Action:** Run only if Task 1 recorded a coverage metric under its threshold and no other failing gate; otherwise this task writes nothing and its Verify reads Task 1's record. Close the gap Task 1 measured, and only that gap, with new tests under `tests/js/` for supported behavior of the under-covered `hqptuner/static/` code Task 1 names, chosen by the test writer at the lowest lane that observes each behavior (`docs/spec/testing.md` rules 1, 10, 12 and 15); the plan names no test, unit, assertion or value. Tests-first for code that already exists is my reading of D-02: each new test is shown to bite by a red run with the behavior it pins broken by a temporary edit to the production code, reverted before the commit, and the commit quotes the red line and the green line (`docs/spec/testing.md` rule 8). A test that only executes a line is forbidden (`docs/spec/testing.md` rule 12; test-policy coverage rule). A line no public contract reaches is not reach-tested: it is dead code or a wrong surface, its fix is production code D-02 does not license, so it goes to the owner as a blocking question naming the file and lines. No edit under `hqptuner/`, no change to `Makefile`, `.github/cadence/coverage-policy.json`, the `--test-coverage-*` flags or any exemption. Run `filepawl accept` whenever filepawl prints it. Interim checks are file runs, `PYTHONPATH=$(pwd) scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <files>`, and coverage runs of the `test-js` recipe's own flags and three globs with `--test-concurrency=8` added. Stop adding tests once all three metrics meet their thresholds (test-policy completion rule). If the measured gap needs materially more than a handful of test files, say so once in the task report with the measured gap, and continue: D-02 keeps the closure in this phase. Commit each test file or tightly related group in integrate on `rebuild/integrate`, by name.
- **Verify:** In `.claude/worktrees/integrate`, `PYTHONPATH=$(pwd) scripts/gate.sh node --experimental-test-coverage --test-coverage-exclude='tests/**' --test-coverage-exclude='**/vendor/**' --test-coverage-lines=95 --test-coverage-branches=90 --test-coverage-functions=85 --test-concurrency=8 --import ./tests/js/support/vendor-resolve.js --test tests/js/*/*.test.js tests/js/*/*/*.test.js tests/js/*/*/*/*.test.js` prints `exit=0` and its `# all files` row reads at least 95 / 90 / 85; `git -C .claude/worktrees/integrate diff --name-only fe97fb16..HEAD` lists only paths under `tests/js/` and `.filepawl.toml`; every commit of this task quotes a red and a green line. Testing scope: outcomes are the three global coverage figures and the behaviors the new tests pin; existing coverage is Task 1's per-file rows; the smallest additional set is the tests that lift the short metric over its bar; sufficient evidence is the exit line above plus each commit's bite quote; testing stops at the thresholds. Effort: unknown until Task 1 measures, small if the integrate figures match the `dev` checkout's.

### Task 3: Confirm `make check` green on integrate

- **Files:** .planning/phases/4/baseline/integrate-check.txt
- **Action:** If Task 2 committed nothing and Task 1 printed `exit=0`, add a line to the record that Task 1's run at the unchanged HEAD is the AC1 evidence, and run nothing. Otherwise name the footprint in Context and run `PYTHONPATH=$(pwd) nice -n 19 scripts/gate.sh make check` once in `.claude/worktrees/integrate` at its new HEAD, and add to the record the command, the commit, the `exit=` line and log path, and the `# all files` row. A red result is not absorbed: it is recorded with its shortest decisive line and returned to the orchestrator, and nothing in a gate, threshold or record file is changed to turn it green.
- **Verify:** The record's last run line reads `exit=0` at the commit `git -C .claude/worktrees/integrate rev-parse HEAD` prints, and its `# all files` row reads at least 95 / 90 / 85; `git -C .claude/worktrees/integrate diff fe97fb16..HEAD -- Makefile .github/cadence/coverage-policy.json` prints nothing. Testing scope: no new test; the evidence is one `make check` log at the final integrate commit.

## Notes

- The testing-policy CI task is not repeated here: Phase 1 installed it on integrate (`053b39de`, `69ec84f3`, `812f4704`), and `planning.mjs test-policy check --root .` returns `ok:true` in `.claude/worktrees/integrate` today. It reaches `v2` through Plan 3's merge.
- A non-coverage failure at Task 1 halts this plan by design: its files are unknown until measured, so no lease can name them. The orchestrator plans that repair from the record.
