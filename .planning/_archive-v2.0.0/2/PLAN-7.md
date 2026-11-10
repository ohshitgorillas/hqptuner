---
phase: 2
plan: 7
requirements: [INTG-01, INTG-02]
files:
  - .planning/phases/2/baseline/audit.md
  - .planning/phases/2/baseline/exit.txt
  - .planning/phases/2/baseline/regression.txt
---

# Phase 2: Baseline recovery - Plan 7: Exit check

## Goal

The JS baseline in `.claude/worktrees/integrate` passes, through repaired test machinery and fixed production defects, with every valid claim unchanged (design step 12a). This plan proves it: one run over the retained baseline plus every helper consumer, with zero failures, beside an audit of the phase's commits.

## Must be true when done

- One file run over exactly `files.txt` plus every importer of each touched support file prints `exit=0` with `# fail 0` (AC1, AC2).
- A search under `tests/js/`, support included, finds no `config.value` or `matrixConfig.value` assignment carrying a field value or a `file`, `active` or `rows` key (AC3).
- No phase commit changes an assert line in a baseline test file without a `Contract mismatch:` record carrying two quotations (AC4).
- `git log --name-only BASE..HEAD` lists neither `uv.lock` nor `.planning/reads.jsonl` (AC6).
- A full-suite run shows no failing test that was not already failing in `failures.log`.

## Context

- Locked: D-04, D-06, D-07, D-12, D-13 (`.planning/phases/2/CONTEXT.md`). File run, full-suite run, BASE and paths as in Plan 1's Context. This plan writes no file under `tests/js/` or `hqptuner/`.
- Precondition: Plans 1 to 6 are done. Every `Builder route:` entry, in `routes.md` and in the phase's commit messages, is closed by a commit that fixes the named `hqptuner/static/` path with its failing test unchanged. If one is open, this plan stops at Task 1.
- A `files.txt` path that Plan 6 deleted whole is written in `exit.txt` as deleted, with its commit, and is not run. The test cases Plan 6 deleted under C1, C2 and C3 (`routes.md`) are matched in Task 1's AC4 section to that plan's `Contract mismatch:` commit.
- D-07 support files: `listsfixture.js`, `shaperfit-fixtures.js`, `profile-fixtures.js`, `field-harness.js`, `threetrees.js`, `easy/easytiles.js`, `devicecaps-harness.js`, `rendered/pipelines-fixture.js`, `rendered/volume-range.js`. Add every other file under `tests/js/support/` that `git diff --name-only BASE..HEAD` lists. An importer is any file under `tests/js/` whose import specifier resolves to that support file.

## Tasks

### Task 1: Audit the phase's commits

- **Files:** .planning/phases/2/baseline/audit.md
- **Action:** Write `audit.md` with four sections, each with the command run and its result.
  - Open routes: every `Builder route:` and `Contract mismatch:` line in `git log BASE..HEAD` and every `builder` entry of `routes.md`, each with the commit that closed it. Any entry with none is open.
  - AC3: every assignment to `config.value` or `matrixConfig.value` under `tests/js/`, found by a multi-line search from the assignment to its closing `;`. Record what each carries, and for an assignment from a local builder, what that builder returns. Option entries' `value` is metadata.
  - AC4: for each path in `files.txt`, the added and removed lines containing `assert`, or a `test(` title, in `git diff BASE HEAD`, each matched to the commit carrying its `Contract mismatch:` quotations.
  - AC6: `git log --name-only --format= BASE..HEAD` filtered for `uv.lock` and `.planning/reads.jsonl`.
- **Verify:** `audit.md` shows zero open routes, zero AC3 hits, zero unmatched assert-line changes and zero AC6 hits. Otherwise stop and return the finding: an open builder route needs a production-fix plan, an AC3 hit in an unleased file needs plan revision, and an unmatched assert change is a defect to revert. Testing scope: read-only checks; no test.

### Task 2: Run the exit check

- **Files:** .planning/phases/2/baseline/exit.txt
- **Action:** Build the list: every path of `files.txt`, plus every importer of each support file in Context, deduplicated and sorted. Write the list to `exit.txt`. Run one file run over exactly that list, with `--test-concurrency=8` and a footprint statement before it starts (`~/dev/CLAUDE.md` 3.1). Add no coverage flag (D-06); `make test-js` is not the exit command. Append the `exit=` line, the `# pass` / `# fail` counts and the log path to `exit.txt`.
- **Verify:** `exit.txt` shows `exit=0` and `# fail 0`. Every line of `files.txt` appears in its list. For each support file in Context, `grep -rlE` over `tests/js` for its import shows no importer missing from the list. Testing scope: this run is the phase's acceptance evidence for INTG-01; nothing is added.

### Task 3: Run the full-suite regression check

- **Files:** .planning/phases/2/baseline/regression.txt
- **Action:** Run the full-suite run once, as Plan 1 Task 1 ran it (D-12: a regression check beside the exit check, not the exit criterion). Write the `exit=` line, counts and log path to `regression.txt`, with every failing test's file and title.
- **Verify:** Every failing test listed in `regression.txt` also appears as failing in `failures.log`. A failure new since baseline is a regression of this phase: stop and return it with its decisive line. Testing scope: one run; nothing is added.
