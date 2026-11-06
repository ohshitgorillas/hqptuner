---
status: testing
phase: 1
fields_version: 1
started: 2026-11-06
updated: 2026-11-06
---

## Items

### 1. Branch coverage clears the 91% margin
expected: An offline run of accepted command 1 writes .coverage.json with totals.covered_branches / totals.num_branches at or above 0.91
criterion: AC1
status: pass
first_pass: pass
source: model
evidence: scripts/gate.sh .venv/bin/pytest -m "not live and not e2e" -q --cov=hqptuner --cov-branch --cov-report=json:.coverage.json -> exit=0, 2653 passed; .coverage.json totals 1445/1558 = 0.9275 at HEAD 48b5c46afbee748dcd7259f216e8292f15c54acb

### 2. junkcal.py is measured
expected: .coverage.json from that run has an entry for hqptuner/core/junkcal.py, and pyproject.toml [tool.coverage.run] omit no longer lists it
criterion: AC2
status: pass
first_pass: pass
source: model
evidence: .coverage.json files['hqptuner/core/junkcal.py']: 94/94 statements, 14/14 branches; pyproject.toml has no [tool.coverage.run] section, so no omit lists it

### 3. Python threshold check passes and bites
expected: Accepted command 2 exits 0 on the report, and exits non-zero on a copy whose covered_branches is lowered below 90% of num_branches
criterion: AC3
status: pass
first_pass: pass
source: model
evidence: node .github/cadence/coverage-report-check.mjs --format python --report .coverage.json -> rc=0, 'branches: 92.75% meets 90'; same on a copy with covered_branches=int(0.89*1558) -> rc=1, 'FAIL branches: 88.96% is below 90'

### 4. Testing policy agrees with the workflows
expected: planning.mjs test-policy check exits 0
criterion: AC4
status: pass
first_pass: pass
source: model
evidence: planning.mjs test-policy check --root . -> ok:true, gate_found:true, problems:[]

### 5. Both cadence files are tracked
expected: git ls-files .github/cadence lists coverage-policy.json and coverage-report-check.mjs
criterion: AC5
status: pass
first_pass: pass
source: model
evidence: git ls-files .github/cadence -> coverage-policy.json, coverage-report-check.mjs; git check-ignore on the script exits 1

### 6. check job runs the three commands after make check
expected: The check job in .github/workflows/check.yml runs the three accepted commands, after its make check step
criterion: AC6
status: pass
first_pass: pass
source: model
evidence: .github/workflows/check.yml:47-65: 'make check' step, then 'python coverage report', 'python coverage thresholds', 'js coverage thresholds' running commands 1-3 verbatim with 95/90 filled in

### 7. All seven required jobs green on the last dev commit
expected: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos and smoke-windows report success on the phase's last dev commit (ci: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows)
criterion: AC7
status: pending_ci
job: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows
commit: 48b5c46afbee748dcd7259f216e8292f15c54acb
source: model
evidence: required CI jobs run only on GitHub runners; this commit is not pushed and publishing for verification is not authorized

### 8. Report check refuses a malformed include or exclude
expected: coverage-report-check.mjs exits non-zero, without a TypeError, on a policy whose include or exclude is not an array of strings
status: pass
first_pass: pass
source: model
evidence: coverage-report-check.mjs --policy <copy> with include or exclude set to 5, ["a",1], "x", {"a":1}: all 8 runs rc=1, 'FAIL policy: ... include|exclude must be an array of strings', no TypeError

## Summary

total: 8
passed: 7
failed: 0
pending: 0
pending_ci: 1
skipped: 0
blocked: 0
reworked: 0
