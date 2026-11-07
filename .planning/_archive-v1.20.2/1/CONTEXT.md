# Phase 1: Coverage gate in CI - Context

Gathered: 2026-11-05

Feeds: /cad-plan 1

## Scope boundary

In: the three accepted coverage commands running in CI's required `check` job, the report-check script tracked in the repo, `hqptuner/core/junkcal.py` measured, Python branch coverage raised to a clear margin above 90%, and every required job green on the phase's last `dev` commit.

Out: any edit to the accepted policy (`testing.coverage.*` in `.planning/config.json` or `.github/cadence/coverage-policy.json`), `testing.required_jobs`, the per-file coverage floor and its EXEMPT list, and the Windows fixes of phases 2 and 3.

Deferred: None

Plan shape: multiple plans, same phase (let /cad-plan break it down)

## Durable decisions

None this phase

## Decisions

- D-01 (Accepted policy): the three commands in `testing.coverage.commands` go into CI verbatim, with `{lines}`=95 and `{branches}`=90 filled in; `.planning/config.json` and `.github/cadence/coverage-policy.json` are not edited. Evidence: `.github/cadence/coverage-policy.json`, `.planning/config.json`, cadence `references/test-policy.md`.
- D-02 (Accepted policy): `test-policy check` is a text match against `.github/workflows/`; its only failure today is the three commands missing from every workflow, and the policy file is already tracked (12f24e4d). Evidence: cadence `bin/planning/testing-policy.mjs:115-125,217-237`.
- D-03 (Accepted policy): lines 95 / branches 90 bind both Python (command 2 over `.coverage.json`) and JS (command 3's node flags); Python lines are already 96.97%. Evidence: cadence `templates/coverage-report-check.mjs`, `.coverage.json`, `Makefile` `test-js`.
- D-04 (Report-check script): `.github/cadence/coverage-report-check.mjs` is copied verbatim from the cadence template and tracked through a `.gitignore` negation, since `.gitignore:106` `*.mjs` ignores it today. Evidence: `.gitignore:106`, `git check-ignore -v`.
- D-05 (Report-check script): `hqptuner/core/junkcal.py` leaves `[tool.coverage.run] omit`; any coverage drop or per-file floor hit that follows is fixed under `docs/testing.md` rule 12. Evidence: `pyproject.toml`, 9c9b6acc, `scripts/gates/testing/check_coverage_floor.py`.
- D-06 (Coverage level): no global Python branch gate exists today; command 2 becomes the first, and the per-file floor stays as it is. Evidence: `Makefile:59-60`, `.pre-commit-config.yaml`, `scripts/gates/testing/check_coverage_floor.py`.
- D-07 (Coverage level): the phase builds a margin above 90% branches by closing behavior-backed gaps (largest today: `hqptuner/audit_narrow.py` 15, `hqptuner/lanes/live/routing.py` 7, `hqptuner/metadata_json.py` 7, `hqptuner/lanes/http/restore.py` 6, `hqptuner/conf/formparse.py` 6); unreachable branches are removed as dead code, and no test is written to reach a line. Evidence: `.coverage.json` (1391/1544 = 90.09% on 2026-11-05), `docs/testing.md` rule 12.
- D-08 (CI placement): the three commands run as steps in `.github/workflows/check.yml`'s existing `check` job, after `make check`, so a coverage failure turns the required `check` job red on `dev` pushes, PRs, and the `release.yml` and `docker.yml` calls. Evidence: `.github/workflows/check.yml`, `.github/workflows/release.yml:19-26`, `.github/workflows/docker.yml:21`.

## Acceptance criteria

- [ ] AC1: in an offline run of accepted command 1, `.coverage.json` shows `totals.covered_branches / totals.num_branches` at or above 0.91.
- [ ] AC2: `.coverage.json` from that run has an entry for `hqptuner/core/junkcal.py`, and `pyproject.toml` no longer lists it under `[tool.coverage.run] omit`.
- [ ] AC3: accepted command 2 exits 0 on that report, and exits non-zero on a copy of it whose `covered_branches` is lowered below 90% of `num_branches`.
- [ ] AC4: `node "${CLAUDE_PLUGIN_ROOT}/cadence-core/bin/planning.mjs" test-policy check` exits 0.
- [ ] AC5: `git ls-files .github/cadence` lists both `coverage-policy.json` and `coverage-report-check.mjs`.
- [ ] AC6: the `check` job in `.github/workflows/check.yml` runs the three accepted commands after `make check`.
- [ ] AC7: `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` all report success on the phase's last `dev` commit once the owner pushes it (ci: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows)

## Flagged assumptions

- The five `release.yml` jobs run only on a push touching `packaging/**`, `scripts/package-*.sh`, `hqptuner.spec`, `pyproject.toml` or `.github/workflows/release.yml`, and the workflow has no `workflow_dispatch`; the planner orders the work so the last commit touches one of those paths (`pyproject.toml` is the natural one) or says it cannot - Likely; if wrong: AC7 stays pending with no job run on the last commit.
- When `release.yml` calls `check.yml`, GitHub may name the runs `check / check` and `check / e2e`, which `ci-status` (`judgeJob`) does not match; the push-to-`dev` run of `check.yml` names them plainly - Unclear; if wrong: `ci-status` reads those jobs as pending on tag runs.
- CI's `setup-node` "22" resolves to a release with `--test-coverage-lines/branches/functions`, since `make test-js` already runs those flags in green CI - Likely; if wrong: command 3 fails on an unknown flag.
- Removing the junkcal omit may pull global branches down or trip the per-file 90 floor on `hqptuner/core/junkcal.py`; its measured coverage is unknown - Unclear; if wrong: D-05's fallout work is larger than D-07's margin work assumes.
- Branch coverage moved by two branches between 2026-11-03 and 2026-11-05 with no code change, which points at run-to-run variance - Unclear; if wrong: the 91% target in AC1 may need a different margin.
