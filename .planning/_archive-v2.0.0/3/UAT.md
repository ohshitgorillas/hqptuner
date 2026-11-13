---
status: testing
phase: 3
fields_version: 1
started: 2026-11-07
updated: 2026-11-07
---

## Items

### 1. No retired shape left under tests/js
expected: Search under tests/js finds no fileTruth, no /api/config or config push fake with a data key, no profiles/device_caps key in a config.value fixture, no live_profiles/live_active key in a matrixConfig.value fixture, and no readings.value = outside store/core/readings.test.js and model/store/reading.test.js
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: fileTruth, /api/config data fake and readings.value= greps empty; bracket scan of every config.value/matrixConfig.value fixture finds no profiles, device_caps, live_profiles or live_active key; profile-fixtures.js:47-67 sends live_* to enums and a seeded reading.

### 2. Config push excised at both ends
expected: sync.js and api/push.py carry no config push route or source; no test under tests/ subscribes to or asserts on a config push event
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: sync.js:114-121 and push.py:63-72 carry no config route or source; no test names a config push event; start-to-exit test-name diff removes exactly the three config-push tests; mirror/polling and push_route/push_feed re-runs exit=0.

### 3. Every port commit quotes a pre-edit exit=0 run
expected: Each phase 3 port commit message quotes a pre-edit gate run on its files printing exit=0
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: 61/61 commits in e50d7316..fe97fb16 have a 'Pre-edit:' exit=0 line; each cited log exists, shows zero failures and predates its commit.

### 4. No unaccounted assert-line change
expected: Every changed assert line in a ported test is under the contract-mismatch route with quotations, a deletion of a config-push test, or an await-only change listed under 'Await-only assert lines:'
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: Independent line diff plus AST check: only config-push assert deletions and 56 await-only lines, all listed under 'Await-only assert lines:' in 41b357fa and 637923d3; 0 inner multi-line assert changes.

### 5. Whole JS suite green after last port
expected: In .claude/worktrees/integrate the D-07 whole-suite command prints exit=0 with zero failures
criterion: AC5
status: pass
first_pass: pass
source: model
evidence: this session, integrate @ fe97fb16: scripts/gate.sh bash -c 'node --import ./tests/js/support/vendor-resolve.js --test --test-concurrency=8 tests/js/*/*.test.js tests/js/*/*/*.test.js tests/js/*/*/*/*.test.js' -> exit=0 log=/tmp/gate-bash-y5XD3lK3.log, tests 4880 pass 4880 fail 0

### 6. tests/api green after push excision
expected: scripts/gate.sh .venv/bin/pytest -m 'not live' -q tests/api in .claude/worktrees/integrate prints exit=0
criterion: AC6
status: pass
first_pass: pass
source: model
evidence: this session, integrate @ fe97fb16: scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/api -> exit=0 log=/tmp/gate-pytest-4mmR6K2z.log, 340 passed

### 7. Testing policy agrees with the workflow files
expected: planning.mjs test-policy check --root . passes
status: pass
first_pass: fail
source: model
evidence: planning.mjs test-policy check --root .claude/worktrees/integrate -> {"ok":true,"accepted":true,"gate_found":true,"problems":[]}. The earlier fail ran --root . on the v2 checkout; the gate lives on rebuild/integrate (Phase 1).
cause: test-policy check: policy-disagrees: accepted command ".venv/bin/pytest -m "not live and not e2e" -q --cov=hqptuner --cov-branch --cov-report=json:.coverage.json" is in no workflow file under .github/workflows/; accepted command "node .github/cadence/coverage-report-check.mjs --format python --report .coverage.json" is in no workflow file under .github/workflows/; accepted command "node --experimental-test-coverage --test-coverage-exclude='tests/**' --test-coverage-exclude='**/vendor/**' --test-coverage-lines={lines} --test-coverage-branches={branches} --test-coverage-functions=85 --import ./tests/js/support/vendor-resolve.js --test tests/js/*/*.test.js tests/js/*/*/*.test.js tests/js/*/*/*/*.test.js" is in no workflow file under .github/workflows/
fix: earlier fail was a wrong --root; routed note withdrawn

## Summary

total: 7
passed: 7
failed: 0
pending: 0
skipped: 0
blocked: 0
reworked: 1
