---
phase: 1
status: complete
completed: 2026-11-05
---

# Phase 1: Coverage gate in CI - Summary

The `check` job in `.github/workflows/check.yml` on `rebuild/integrate` now runs the three accepted coverage commands, and the Python suite measures lines 97.54% and branches 91.10% against 95 / 90, with the policy file and the report check tracked.

## What shipped

- Accepted coverage policy and Cadence config carried from `v2` - `.github/cadence/coverage-policy.json`, `.planning/config.json` (integrate worktree)
- Report check tracked byte-identical to the Cadence template and linted - `.github/cadence/coverage-report-check.mjs`, with a `.gitignore` negation and an `eslint.config.js` ignore negation plus node-globals block
- `pytest-offline` recipe holds the accepted pytest command as one contiguous run, flag set unchanged - `Makefile`
- `check` job runs lint, the accepted pytest command, the test gates without a second pytest, the report check and the accepted JS command, each suite once - `.github/workflows/check.yml`
- Plugin docstrings no longer call the Makefile line the only command line that loads them - `scripts/pytest_plugins/run_stamp.py`, `scripts/pytest_plugins/suite_deadline.py`, `scripts/idle_probe.py`, `scripts/clock_probe.py`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | 053b39de | carry accepted coverage policy and config onto integrate |
| 1 | 2 | 69ec84f3 | track the coverage report check and lint it |
| 1 | 3 | 6c2e527f | order the pytest-offline recipe so it holds the accepted pytest command |
| 1 | 4 | 812f4704 | run the accepted coverage commands in the check job |
| 1 | 5 | 082346ff | stop the plugin docstrings naming the Makefile line as the only command line |
| 1 | 6 | none | coverage proof run; no files changed |

## Deviations

- [deviation] Task 2: the plan said to reword the `.mjs` scratch comment above the eslint ignores block; the `comment-trivia` judge rejected four rewordings, so the coordinator amended Task 2 and Task 6's verify to delete it instead (69ec84f3).
- [deviation] Task 5: the plan said to reword the docstring sentence; the judge rejected every rewording, so the coordinator amended Task 5 to cut the clause and end each paragraph at the load instruction. The judge still rejected the unchanged summary line of each docstring, and the owner approved the cut and committing it with `SKIP=comment-trivia` only (082346ff).
- [deviation] Task 6 ran before Task 5 while Task 5 waited on the owner; it touches none of Task 5's files.

## Open items

- `make check` is red at `test-js` only (`# fail 195` of 4904); the count equals the 195 failing JS tests `CONTEXT.md` puts in Phase 2, and D-05 defers the JS command exiting 0 and the green CI run to Phase 4.
- The `comment-trivia` judge rejects unchanged docstring summary lines ("Describes implementation details and measurement mechanics") once any line of the docstring changes; a probable judge misfire, not investigated.
- `risk_surface` scope is unanswered at the repo layer (`review.triggers.risk_surface.surfaces`); this run passed all eight categories explicitly.
- Untracked `uv.lock` and `.planning/reads.jsonl` in the integrate worktree, neither written by this phase, left untouched.

## Goal check

The commits plausibly deliver the phase goal on `rebuild/integrate`. `planning.mjs test-policy check` prints `ok:true`, `accepted:true`, `gate_found:true` and `"problems":[]` after 812f4704 (task 4 report row). The report check prints `lines: 97.54% meets 95` and `branches: 91.10% meets 90`, so there is no Python shortfall to close (task 6 report row). `make pytest-offline` ran 3673 passed with exit 0. `git diff c530a6e3 HEAD` leaves `check_coverage_floor.py`, `pyproject.toml`, `.pre-commit-config.yaml`, `.jscpd.json` and `knip.json` untouched and adds no exemption text. The `risk_surface` review of c530a6e3..082346ff returned no findings. Not delivered here, by D-05: the JS command exiting 0 at 95 / 90 and a green `check` + `e2e` run, both Phase 4.

complete locally, not CI-verified
