# Phase 4: Integrate into v2 - Context

Gathered: 2026-11-06

Feeds: /cad-plan 4

## Scope boundary

In: `make check` green on `rebuild/integrate` in `.claude/worktrees/integrate` (design step 12c), closing any JS coverage shortfall against the `test-js` thresholds; one disclosed local `make test-e2e` run there; the `--no-ff` merge of `rebuild/integrate` into `v2` (design step 13); `make check` green on `v2` after the merge.

Out: any push, published branch or pull request (the owner opens the PR, `~/dev/CLAUDE.md` 11.2); any coverage threshold change or gate exemption (Phase 1 D-05); `uv.lock`, integrate's `.planning/reads.jsonl`, `.planning/phases/2/baseline/failures.log` and stash `b23a78f0`; the Phase 2 and 3 open items (`previewPreset`, `About.js:43` `duringEngineWrite`, the writerless `config` signal in `store/signals.js`, the /tmp checker scripts); cutover work (CUT-01).

Deferred: None.

Plan shape: multiple plans, same phase (owner answer at the size question; /cad-plan breaks it down, with the integrate measurement and coverage repair before the e2e run, and the merge and `v2` check last).

## Durable decisions

- D-01 (Merge shape): step 13 is a `--no-ff` merge commit on `v2`, made from the main checkout `/home/atom/dev/hqptuner2`, subject `merge: rebuild/integrate into v2`, with a message that passes `scripts/gates/check_commit_msg.py` (judged by the `commit-msg` hook and again by `make lint` on `v2`). A fast-forward is impossible: `v2` has 26 commits `rebuild/integrate` lacks, integrate 230 `v2` lacks, merge base `21e65b20`. Rejected: merging `v2` into `rebuild/integrate` and fast-forwarding `v2`, which would put `.planning/**` into integrate's history. Evidence: `docs/superpowers/specs/rebuild-integrate-design.md:131`; precedent `daadaa93`, `87afaf02`; owner answer 2026-11-06.
- D-02 (Coverage shortfall): if the `test-js` thresholds (lines 95 / branches 90 / functions 85) fail on integrate, the shortfall is closed inside Phase 4 by new tests written tests-first through the 12a route; no threshold in `Makefile` or `.github/cadence/coverage-policy.json` changes and no exemption is written. Rejected: a checkpoint to the owner before any test, and a separate coverage phase. Evidence: `.claude/worktrees/integrate/Makefile:135-144`; Phase 1 D-05 (`.planning/phases/1/CONTEXT.md`); owner answer 2026-11-06.

## Decisions

- D-03 (Order): run `PYTHONPATH=$(pwd) scripts/gate.sh make check` in `.claude/worktrees/integrate` first, then one `scripts/gate.sh make test-e2e` there, then the merge, then `scripts/gate.sh make check` in `/home/atom/dev/hqptuner2` on `v2` without `PYTHONPATH`. Both trees' `.venv` is the editable install of `/home/atom/dev/hqptuner2/hqptuner`, which is why integrate needs `PYTHONPATH=$(pwd)`. Evidence: ROADMAP Phase 4 criteria 1 to 3; `.venv` resolution in both trees.
- D-04 (Local e2e): one local `make test-e2e` run in integrate before the merge, through `scripts/gate.sh`, its footprint named before it starts (headless chromium per test module, `tests/e2e/conftest.py:55-59`). Failures are fixed on integrate before the merge. Evidence: owner answer 2026-11-06; no e2e run record exists for `rebuild/integrate` (`.planning/` grep).
- D-05 (Python half): the Python gates are expected green on integrate and 12c only confirms them; they are not a planned work item. Evidence: `.claude/worktrees/integrate/.pytest-junit.xml` (3672 tests, 0 failures); `.coverage.json` lines 97.54 / branches 91.10, the 4 files under 90% all in `check_coverage_floor.py` `EXEMPT`.
- D-06 (Gate records): `make check` writes `.suite-time.<branch>.json` and `.idle-last.<branch>.json` into `/home/atom/dev/hqptuner/`, the shared git common dir's checkout, not into either tree. Evidence: `git rev-parse --git-common-dir`; `scripts/git_checkout.py:12-23`; `scripts/gates/testing/check_suite_time.py:18-27`; `scripts/gates/testing/check_idle.py:21-24,46-50`.
- D-07 (Merge is clean): `git merge-tree --write-tree v2 rebuild/integrate` gives tree `65a10726` with no conflicts, and that tree restores `hqptuner/lanes/__init__.py` (deleted on `v2` by `38b7e28e`, still imported by `hqptuner/presets/__init__.py:7`), so the merge itself repairs the red `v2` suite the CAPTURE.md todo records. If either branch moves before the merge, the preview is re-run. Evidence: `git cat-file -e 65a10726:hqptuner/lanes/__init__.py`; `.planning/CAPTURE.md`.
- D-08 (Dirty planning files): `.planning/CAPTURE.md` and `.planning/config.json` on `v2` are committed by name before the criterion-3 run, so the spelling gate judges committed content only. The CAPTURE.md todo on the read-volume hook removal is already done (`451eaefe`) and is checked off in that commit. Evidence: owner answer 2026-11-06; `git show --stat 451eaefe`.
- D-09 (Untouched paths): `uv.lock` and `.planning/reads.jsonl` in integrate, `.planning/phases/2/baseline/failures.log` on `v2` and stash `b23a78f0` stay out of every commit and are not touched. Evidence: `rebuild-integrate-design.md:124`; Phase 2 SUMMARY open items.
- D-10 (CI proof): criterion 4 is read by the owner: the owner opens a pull request from `v2` (a push to `v2` triggers no run, `.github/workflows/check.yml` `on:`), and green `check` and `e2e` jobs on that pull request count, synthetic merge ref included. The agent never pushes. Evidence: owner answers 2026-11-06; `.planning/PROJECT.md` Context, CI.

## Acceptance criteria

- [ ] AC1: `PYTHONPATH=$(pwd) scripts/gate.sh make check` in `.claude/worktrees/integrate` prints `exit=0`.
- [ ] AC2: `scripts/gate.sh make test-e2e` in `.claude/worktrees/integrate` prints `exit=0`, and its log shows a passed count above zero.
- [ ] AC3: `git merge-base --is-ancestor rebuild/integrate v2` exits 0, and the merge commit on `v2` has two parents and the subject `merge: rebuild/integrate into v2`.
- [ ] AC4: `scripts/gate.sh make check` in `/home/atom/dev/hqptuner2` on `v2` after the merge prints `exit=0`.
- [ ] AC5: no commit in the phase changes a coverage threshold in `Makefile` or `.github/cadence/coverage-policy.json`, adds a gate exemption, or contains `uv.lock`, `.planning/reads.jsonl` or `.planning/phases/2/baseline/failures.log`.
- [ ] AC6: the `check` and `e2e` jobs are green on the owner's pull request from `v2`. (ci: check, e2e)

## Flagged assumptions

- A JS coverage shortfall with every test passing makes `make test-js` exit non-zero, and the `tests/js/*/*/*/*.test.js` glob expands the same under `make` locally as in CI - Unclear; if wrong: a local AC1 green does not predict the CI `check` job. The first AC1 run settles it (owner answer 2026-11-06).
- JS coverage on integrate meets lines 95 / branches 90 / functions 85 - Unclear; the only recorded figure (96.40 / 90.10 / 86.06) is from the `dev` checkout, not integrate; if wrong: D-02 test work sizes the phase.
- Gates pre-commit does not run on every commit (`check_spelling.py $(git ls-files)`, `check_docs.py`, `css-dead`) pass on integrate - Likely; if wrong: AC1 adds an unplanned repair round.
- The `v2` tree after the merge differs from integrate only in `.planning/**` and 7 files (22+/471-), so AC4 follows from AC1 - Likely; if wrong: a `v2`-only gate failure needs a fix commit on `v2`.
- The e2e suite finds a chromium binary on this host (playwright's own cache holds no chromium; `HQPTUNER_CHROMIUM` and the `opal-hqptuner` skill name the host binary) - Likely; if wrong: AC2 fails at browser launch before any test runs.
- The e2e suite passes on integrate; its last commits (`914ea25d`, `fac5706c`, `98eb719d`) predate the frontend rebuild merges - Unclear; if wrong: D-04 repair work before the merge.
