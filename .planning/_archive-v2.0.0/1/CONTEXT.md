# Phase 1: Coverage gate in CI - Context

Feeds: /cad-plan 1

## Scope boundary

In: in `.claude/worktrees/integrate` (branch `rebuild/integrate`), write the three accepted coverage commands from `.github/cadence/coverage-policy.json` verbatim into `.github/workflows/check.yml`, commit the policy file and `.github/cadence/coverage-report-check.mjs`, make the Makefile's Python test recipe carry the accepted pytest command, and prove Python coverage at lines 95 / branches 90.

Out: any work on `v2` (it receives the gate at the Phase 4 merge); fixing the 195 failing JS tests (Phase 2); fixing `v2` lint errors; pushing, opening a PR, or changing CI triggers.

Deferred: the JS accepted command exiting 0 at lines 95 / branches 90 belongs to Phase 4, because the integrate JS suite does not pass. The `check` and `e2e` jobs passing on the installing commit belongs to Phase 4, because `check.yml` runs only on push to `dev` and on pull requests (`check.yml:3-10`).

Plan shape: multiple plans, same phase (owner's size answer; /cad-plan breaks it down).

## Durable decisions

- D-03 (Workflow wiring): the Makefile `pytest-offline` recipe contains the accepted pytest command `.venv/bin/pytest -m "not live and not e2e" -q --cov=hqptuner --cov-branch --cov-report=json:.coverage.json` word for word, plus its existing extra flags, and the `check` job runs that one line, so the offline suite runs once per job and the accepted policy is not edited. Rejected: a second bare pytest step (suite runs twice), and rewriting the accepted commands (a policy change). Evidence: `Makefile:83`, `Makefile:109-113` (the `check_fresh_reports.py`, `check_suite_time.py`, `check_clock_waits.py` gates read the run stamp and junit report only this recipe writes), `testing-policy.mjs:115-125,224-229` (text match on workflow YAML only).
- D-05 (Deferral): Phase 1 ends at wiring plus the Python coverage proof; the JS exit-0 at 95/90 and the green `check` + `e2e` run on the installing commit belong to Phase 4. Evidence: the integrate JS suite does not pass; `.github/workflows/check.yml:3-10`.

## Decisions

- D-01 (Landing branch): the work lands in `.claude/worktrees/integrate` on `rebuild/integrate`; `v2` gets the gate when Phase 4 merges. Integrate's Python suite passes and its coverage report meets lines 95 / branches 90; `v2`'s suite does not import. `coverage-policy.json` is tracked on `v2` and not on integrate, so integrate must receive it. Evidence: owner answer; `.claude/worktrees/integrate/.coverage.json`.
- D-02 (Policy artifacts): the three accepted commands appear verbatim in `.github/workflows/check.yml`, and `coverage-report-check.mjs` is copied unmodified from the Cadence template `cadence-core/templates/coverage-report-check.mjs`. Evidence: `cadence-core/references/test-policy.md:84`, `testing-policy.mjs:115-125`.
- D-04 (Thresholds): no coverage threshold changes and no exemption is added; the existing per-file 90% floor (`scripts/gates/testing/check_coverage_floor.py`) stays as it is, and the new total check runs beside it. Evidence: `scripts/gates/testing/check_coverage_floor.py:27-36`, `hqptuner2/CLAUDE.md` gate-exemption rule.

## Acceptance criteria

- [ ] AC1: in `.claude/worktrees/integrate`, `node planning.mjs test-policy check --root .` returns `ok: true`, with no accepted command missing from `.github/workflows/`.
- [ ] AC2: in `.claude/worktrees/integrate`, `git ls-files .github/cadence` lists `coverage-policy.json` and `coverage-report-check.mjs`, and `coverage-report-check.mjs` is byte-identical to the Cadence template.
- [ ] AC3: in `.claude/worktrees/integrate`, running the accepted pytest coverage command and then the report check on `.coverage.json` exits 0 at lines 95 and branches 90.
- [ ] AC4: in `.claude/worktrees/integrate`, `make -n pytest-offline` prints the accepted pytest command verbatim, and the `check` job in `.github/workflows/check.yml` runs pytest exactly once.
- [ ] AC5: the phase's commits change no coverage threshold, add no gate exemption, and leave `scripts/gates/testing/check_coverage_floor.py` unchanged.

## Flagged assumptions

- Merging `v2` into `rebuild/integrate` (as `151e8723` did) or carrying `coverage-policy.json` over alone are both ways to satisfy D-01; which one is the planner's call - Likely; if wrong: a `v2` merge drags unrelated `.planning/` or `CLAUDE.md` changes into integrate.
- Integrate's Python coverage (lines 97.54%, branches 91.10% in `.claude/worktrees/integrate/.coverage.json`) matches its current tree - Confident; if wrong: AC3 has a Python shortfall to close in code.
- Every in-scope `hqptuner/` file on integrate appears in `.coverage.json`, since `hqptuner/lanes/__init__.py` exists there, so the report check's absent-file rule does not fire - Confident; if wrong: AC3 fails on an absent file, closed in code, never by exemption.
- Whether `test-policy ci-status` attributes a pull-request merge-ref run to the installing commit's SHA is unverified - Unclear; matters only for the deferred CI criterion.
