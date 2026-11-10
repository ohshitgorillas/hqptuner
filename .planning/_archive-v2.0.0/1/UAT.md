---
status: testing
phase: 1
fields_version: 1
started: 2026-11-05
updated: 2026-11-05
---

## Items

### 1. Testing policy check passes on integrate
expected: In .claude/worktrees/integrate, `planning.mjs test-policy check --root .` returns ok:true with no accepted command missing from .github/workflows/
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: planning.mjs test-policy check --root . in integrate at 082346ff: {"ok":true,"accepted":true,"enforcement":"available","gate_found":true,"problems":[]}, rc=0.

### 2. Policy file and report check tracked, check byte-identical to template
expected: `git ls-files .github/cadence` in integrate lists coverage-policy.json and coverage-report-check.mjs, and the .mjs is byte-identical to cadence-core/templates/coverage-report-check.mjs
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: git ls-files .github/cadence lists coverage-policy.json and coverage-report-check.mjs; cmp against cadence-core/templates/coverage-report-check.mjs exits 0; git check-ignore exits 1; npx eslint on the file exits 0.

### 3. Python coverage meets lines 95 / branches 90
expected: In integrate, the accepted pytest coverage command then the report check on .coverage.json exits 0 at lines 95 and branches 90
criterion: AC3
status: pass
first_pass: pass
source: model
evidence: Main-session run in .claude/worktrees/integrate at 082346ff: `PYTHONPATH=$(pwd) scripts/gate.sh make pytest-offline` -> exit=0, '3673 passed, 143 deselected, 2 warnings in 39.67s'; then `node .github/cadence/coverage-report-check.mjs --format python --report .coverage.json` -> exit=0, 'lines: 97.54% meets 95', 'branches: 91.10% meets 90'.

### 4. pytest-offline carries the accepted command; check job runs pytest once
expected: `make -n pytest-offline` prints the accepted pytest command verbatim, and the check job in .github/workflows/check.yml runs pytest exactly once
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: make -n pytest-offline contains the accepted pytest command once (grep -cF = 1); check job has one .venv/bin/pytest step; make -n lint lint-js and make -n -o pytest-offline test IDLE_GATE=off print no pytest.

### 5. No threshold change, no exemption, coverage floor gate untouched
expected: The phase's commits change no coverage threshold, add no gate exemption, and leave scripts/gates/testing/check_coverage_floor.py unchanged
criterion: AC5
status: pass
first_pass: pass
source: verifier
evidence: git diff c530a6e3 HEAD leaves check_coverage_floor.py, pyproject.toml, .pre-commit-config.yaml, .jscpd.json, knip.json untouched; no added exemption text; eslint.config.js change narrows the **/*.mjs ignore only.

### 6. Deferred CI-run criterion (check and e2e jobs pass on the gate-installing commit) is carried by a later phase
expected: unwired - D-05 defers ROADMAP Phase 1 SC4 to Phase 4, but no Phase 4 success criterion carries it, so the green check + e2e run can be dropped without notice
origin: verifier
status: pass
first_pass: fail
source: model
evidence: git show 057a5728 -- .planning/ROADMAP.md adds Phase 4 success criterion 4 at ROADMAP.md:73: "The `check` and `e2e` jobs pass on the commit that brings the gate into `v2`." (grep -n), so the D-05 deferral now has a Phase 4 carrier.
reported: unwired - D-05 defers ROADMAP Phase 1 SC4 to Phase 4, but no Phase 4 success criterion carries it, so the green check + e2e run can be dropped without notice
severity: major
cause: CONTEXT.md D-05 defers ROADMAP Phase 1 SC4 (check and e2e jobs pass on the gate-installing commit) to Phase 4, but ROADMAP.md Phase 4 success criteria name only make check exit=0 on integrate, the merge-base ancestry, and make check exit=0 on v2; no criterion names a CI run, so the deferral has no carrier.
fix: 057a5728, retest

## Summary

total: 6
passed: 6
failed: 0
pending: 0
skipped: 0
blocked: 0
reworked: 1
