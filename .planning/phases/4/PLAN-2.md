---
phase: 4
plan: 2
requirements: [INTG-04]
files:
  - .planning/phases/4/baseline/e2e.txt
  - .planning/phases/4/baseline/integrate-final.txt
  - .claude/worktrees/integrate/tests/
  - .claude/worktrees/integrate/hqptuner/
  - .claude/worktrees/integrate/.filepawl.toml
---

# Phase 4: Integrate into v2 - Plan 2: Local e2e on integrate

## Goal

Before the merge, the browser suite passes on `rebuild/integrate` in one disclosed local run (D-04), and `make check` is still green at integrate's final commit.

## Must be true when done

- In `.claude/worktrees/integrate`, `scripts/gate.sh make test-e2e`, run with the environment in Context, prints `exit=0`, and its log shows a passed count above zero; `.planning/phases/4/baseline/e2e.txt` quotes both and the commit.
- Every e2e failure the first run showed is fixed on `rebuild/integrate` before the merge, each fix in its own commit.
- If this plan committed anything to integrate, `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints `exit=0` at integrate's final commit, recorded in `.planning/phases/4/baseline/integrate-final.txt`.
- No process the runs started is left alive afterwards.

## Context

- Plan 1 is done first: `.planning/phases/4/baseline/integrate-check.txt` shows AC1 at `exit=0`.
- D-04: one local `make test-e2e` run in integrate, through `scripts/gate.sh`, footprint named before it starts. No e2e run record exists for `rebuild/integrate`; its last e2e commits (`914ea25d`, `fac5706c`, `98eb719d`) predate the frontend rebuild merges.
- Environment for every e2e run here: `PYTHONPATH=$(pwd)` and `HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell`. `PYTHONPATH` because the pytest process imports `hqptuner` (`tests/e2e/support/stack.py`, `tests/e2e/test_stop_and_restart.py`), and without it that import resolves to the main checkout's tree on `v2`, which lacks `hqptuner/lanes/__init__.py`. The app itself starts with `cwd=REPO_ROOT` in `launch_app`, so it already runs integrate's code. The chromium path comes from the `opal-hqptuner` skill; playwright's cache here holds no chromium. Do not source `hqpcreds`: `_app_env` points the app at loopback fakes with stock credentials, so no run touches the production hqplayerd.
- Footprint (`~/dev/CLAUDE.md` 3.1), named before each run: one serial pytest process, one app subprocess plus in-process socket fakes per session, and one headless chromium per test module (25 modules, `tests/e2e/conftest.py` `browser` fixture). Process ownership (4.1): after each run, list surviving `python -m hqptuner` and `headless_shell` processes whose parent chain is the run; kill any by PID, confirm with `ps -p`, and report the result.
- Repairs follow the 12a route (`rebuild-integrate-design.md`): wrong machinery under `tests/` goes to `test-writer` with claims and assertions unchanged; a demonstrated production defect goes to `builder` in the implicated `hqptuner/` paths, the failing e2e test kept unchanged as its reproducer (test-policy bug-fix rule), with a lower-lane test first where a lower lane observes the defect (`docs/spec/testing.md` rule 15). Tests are never edited to pass. A fix that would change user-facing text needs owner-approved copy first (repo `CLAUDE.md`, copy rule; load `copy-rules`).
- D-09: `uv.lock` and `.planning/reads.jsonl` stay untouched and out of every commit.

## Tasks

### Task 1: Run the e2e suite on integrate

- **Files:** .planning/phases/4/baseline/e2e.txt
- **Action:** In `.claude/worktrees/integrate` at its HEAD after Plan 1, name the footprint in Context, then run `scripts/gate.sh make test-e2e` once with the Context environment. Read the log the wrapper names. Do the process-ownership check in Context. Write `.planning/phases/4/baseline/e2e.txt` in the main checkout with the command and environment, the integrate commit, the `exit=` line and log path, the passed, failed and error counts from pytest's summary, each failing test id with its shortest decisive line, and the process check result. If chromium fails to launch before any test runs, record the launch error and stop: that is a host fact, not an integrate defect, and goes to the orchestrator. Change nothing in integrate.
- **Verify:** `.planning/phases/4/baseline/e2e.txt` exists and quotes an `exit=` line whose log path exists; the counts in the record match pytest's summary line in that log; `git -C .claude/worktrees/integrate status --short` lists only `?? .planning/reads.jsonl` and `?? uv.lock`. Testing scope: one run of the existing suite, no test added.

### Task 2: Fix each e2e failure on integrate

- **Files:** .claude/worktrees/integrate/tests/, .claude/worktrees/integrate/hqptuner/, .claude/worktrees/integrate/.filepawl.toml
- **Action:** Run only if Task 1 recorded a failing or erroring test; otherwise this task writes nothing. Adjudicate each failure Task 1 recorded against the approved behavior through the 12a route in Context, and fix it on `rebuild/integrate`, one failure or one shared cause per commit, paths staged by name. Reproduce each with a single-module run, `PYTHONPATH=$(pwd) HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell scripts/gate.sh .venv/bin/pytest -m e2e --no-cov -q <module>`, red before the fix and green after, both quoted in the commit. A fix that changes what the page shows is a visual change: hand it to the owner at the hand-back URL per the repo `hand-back` skill before Plan 3 starts. Run `filepawl accept` whenever filepawl prints it. No gate, threshold, marker, skip or exemption is changed to pass a test. Do the process-ownership check after every run.
- **Verify:** For each failing test id in `.planning/phases/4/baseline/e2e.txt`, a commit in `git -C .claude/worktrees/integrate log` after Plan 1's last commit quotes its module run red before and green after; no line of any pre-existing assertion in a failing test changed (`git diff` over that range shows none). Testing scope: the outcomes are the recorded failing tests passing; the failing e2e tests themselves are the reproducers; the only added checks are lower-lane tests for a production defect a lower lane observes; testing stops when every recorded failure passes.

### Task 3: Re-run the e2e suite after the fixes

- **Files:** .planning/phases/4/baseline/e2e.txt
- **Action:** Run only if Task 2 committed something. Name the footprint, run `scripts/gate.sh make test-e2e` once more in integrate with the Context environment at its new HEAD, do the process-ownership check, and add the run to the record: command, commit, `exit=` line, log path, counts, process check. A new failure goes back through Task 2.
- **Verify:** The record's last e2e run reads `exit=0` with a passed count above zero, at the commit `git -C .claude/worktrees/integrate rev-parse HEAD` printed when it ran. Testing scope: one full run of the existing suite.

### Task 4: Confirm `make check` at integrate's final commit

- **Files:** .planning/phases/4/baseline/integrate-final.txt
- **Action:** If this plan committed nothing to integrate, write the record stating that Plan 1's last `make check` run in `.planning/phases/4/baseline/integrate-check.txt` is at the unchanged HEAD and is the AC1 evidence, and run nothing. Otherwise name the `make check` footprint (Plan 1 Context) and run `PYTHONPATH=$(pwd) nice -n 19 scripts/gate.sh make check` once in integrate, recording the command, commit, `exit=` line, log path and the JS `# all files` row. A red result is recorded and returned, never absorbed into a gate, threshold or record file.
- **Verify:** `.planning/phases/4/baseline/integrate-final.txt` names the commit `git -C .claude/worktrees/integrate rev-parse HEAD` prints and an `exit=0` run at that commit, its own or Plan 1's. Testing scope: no new test; one gate log.

## Notes

- AC2 in CONTEXT writes the command as `scripts/gate.sh make test-e2e`; this plan runs it with `PYTHONPATH=$(pwd)` and `HQPTUNER_CHROMIUM` set, for the reasons in Context. The command and its `exit=` contract are unchanged.
- The e2e suite needs no hqplayerd, so no `live-daemon` procedure applies.
