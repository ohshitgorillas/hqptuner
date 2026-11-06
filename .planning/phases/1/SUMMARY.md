---
phase: 1
status: complete
completed: 2026-11-06
---

# Phase 1: Coverage gate in CI - Summary

The `check` job now measures the offline suite with branch coverage and fails below lines 95 / branches 90 (Python and JS), and the suite meets it at lines 97.49%, branches 93.19% with `hqptuner/core/junkcal.py` measured.

## What shipped

- `junkcal.py` measured again: the `[tool.coverage.run] omit` entry removed from `pyproject.toml`, with capture tests in `tests/test_junkcal.py` and `tests/support/junkcal_rig.py`
- Branch gaps closed by tests in `audit_narrow`, live routing, `metadata_json`, the restore lane and `formparse` (`tests/audit/`, `tests/apply/`, `tests/engine/test_metadata_json.py`); one unreachable restore branch removed
- `.github/cadence/coverage-report-check.mjs` tracked beside `coverage-policy.json`, refusing a policy whose `include`/`exclude` is not an array of strings
- Three coverage steps after `make check` in `.github/workflows/check.yml`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | ec8073f4 | measure junkcal and pin its capture behavior |
| 1 | 2 | a2cb5d2f | pin audit_narrow keeping and dropping by shape |
| 1 | 3 | 00dbca11 | pin the live routing fallbacks to the restore lane |
| 1 | 4 | a5b4387c | pin metadata_json dropping fields of the wrong shape |
| 1 | 5 | 74351375 | pin the restore lane's edges and drop an unreachable branch |
| 1 | 6 | a933957e | pin the form parser's non-numeric, multi-valued and matrix edges |
| 1 | 7 | a2d687ff | track the coverage report check |
| 1 | 8 | 27f4de0a | run the accepted coverage commands in the check job |
| 1 | fix | 323cb3e4 | refuse a coverage policy whose include or exclude is not an array of strings |

## Deviations

- [deviation] The `risk_surface` review (untrusted_input match on the script's `JSON.parse`) raised one low finding: a non-array `include`/`exclude` crashed with a TypeError. It was fixed in 323cb3e4, which also closes two same-cause silent passes (`include=5`, `include=["a",1]`). The script now differs from the Cadence template by that validation block.
- [deviation] Risk surfaces set for the project at `review.triggers.risk_surface.surfaces`: auth, concurrency, destructive, secrets, api_contract, untrusted_input (billing and migrations have no code here).

## Open items

- Task 1's plan said `clock.py` needed a wall-time reading; `Clock.now` already existed, so `clock.py` and `tests/engine/test_clock.py` are untouched and `junkcal._build_row` takes `mgr.clock.now()`.
- `hqptuner/conf/presetconf.py` `_profile_to_materialize` is a near-twin of restore's `_active_profile`; left alone, outside the lease and not a coverage gap.
- Task 7's Verify expected `git check-ignore -v` to exit 1; with `-v` it exits 0 printing the negation rule. The file is not ignored.
- AC7 (all seven required jobs green on the phase's last `dev` commit) waits on the owner's push; the `pyproject.toml` edit touches a `release.yml` path filter.
- The fix in 323cb3e4 has no automated test: no test home exists for `.github/cadence/coverage-report-check.mjs` and the lease named none. It was verified by hand against five malformed policies before and after.

## Goal check

The commits plausibly deliver the goal. `check.yml:55-65` runs the report, the Python threshold check and the JS thresholds (`--test-coverage-lines=95 --test-coverage-branches=90`) after `make check`. `planning.mjs test-policy check` returns `ok:true, gate_found:true`, and `git ls-files .github/cadence` lists both files. The executor reports branches at 1449/1556 = 93.12% after task 7 (93.19% after the fix), above the 0.91 margin, with junkcal in the report. It also reports that command 2 exits 1 on a copy lowered to 88.95%. Those figures come from the executor's report and were not re-run in this session. Not yet shown: CI itself turning red or green, which needs a push.

complete locally, not CI-verified
