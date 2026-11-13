---
status: testing
phase: 2
fields_version: 1
started: 2026-11-06
updated: 2026-11-06
---

## Items

### 1. Exit check over baseline plus helper importers is green
expected: In .claude/worktrees/integrate, one scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <baseline files + helper importers> run prints exit=0 with zero failures
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: /tmp/gate-node-WhbfrsZE.log '# tests 2051 # pass 2051 # fail 0' over the 165-file list in baseline/exit.txt at 3e90a616. Tip unchanged and tracked tree clean.

### 2. Baseline list and failure log retained outside /tmp, and the exit run uses exactly that list plus importers
expected: The baseline file list and failure log captured at the pre-repair tip exist under .planning/phases/2/baseline/, and the exit run's file set equals that list plus the helper importers
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: files.txt equals the failing-file set taken from failures.log. The recomputed 154 direct importers unioned with files.txt, minus deleted hardware-catalog.test.js, gives 165 paths, identical to the exit.txt list.

### 3. No field-value or file/active/rows seeds in config.value or matrixConfig.value under tests/js/
expected: A search under tests/js/ (support included) finds no config.value or matrixConfig.value assignment carrying a field value or a file, active or rows key
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: Independent scan: 182 assignments, 0 with file/active/rows keys or field-level values. Helpers strip value and seed through seedReadings (field-harness.js:162-170, easyrate.js:67).

### 4. No unrecorded assert-line change in baseline test files; 6343d922 crossfeed renames reverted or recorded
expected: Phase commits change no assert line in a baseline test file without a Contract mismatch record carrying before/after document quotes, and each assert 6343d922 renamed in drawers-crossfeed.test.js is reverted or carries that record
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: Statement-level assert diff BASE..HEAD: baseline-file changes are all ceb112e9 deletions under Contract mismatch C1/C2/C3. Both drawers-crossfeed.test.js files are identical to 6343d922^ in asserts and titles.

### 5. nameOf engine-name behavior is tested with a recorded red bite proof
expected: A test covers nameOf in hqptuner/static/model/store/reading.js, passes now, and the phase record shows it failing against code without nameOf
criterion: AC5
status: pass
first_pass: pass
source: verifier
evidence: 6 tests in tests/js/model/store/reading.test.js pass in /tmp/gate-node-L0OIisBn.log (ok 2626-2631). ba04762f records '# fail 6' with nameOf reversed.

### 6. Phase commits never include uv.lock or .planning/reads.jsonl
expected: git log --name-only over the phase's commits lists neither uv.lock nor .planning/reads.jsonl
criterion: AC6
status: pass
first_pass: pass
source: verifier
evidence: git log --name-only matches 0 hits on rebuild/integrate 082346ff..3e90a616 and 0 on v2 14dd1427^..084e44af.

### 7. Testing policy agrees with the workflow files
expected: planning.mjs test-policy check --root . passes
status: skipped
first_pass: fail
source: model
cause: test-policy check: policy-disagrees. Accepted commands are in no workflow file under .github/workflows/: the pytest coverage command, node .github/cadence/coverage-report-check.mjs --format python, and the node --experimental-test-coverage JS command. gate_found: false.
reason: Owner decision: CI and coverage enforcement are Phase 4 scope (Phase 1 D-05).

### 8. Valid config keep-last-good claim deleted without the contract-mismatch quotations, leaving the behavior untested
expected: behavior wrong: a valid claim was deleted instead of repaired, against the goal's 'every valid claim unchanged' and D-03. No automated check now exercises a failed /api/config fetch keeping the last good readings.
origin: verifier
status: pass
first_pass: fail
source: model
evidence: e50d7316 adds test_a_failed_readings_fetch_keeps_the_last_good_readings to tests/js/store/live/polling.test.js. scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/polling.test.js -> exit=0, # pass 15 # fail 0 (/tmp/gate-node-zn0aYT4c.log). Bite: with refreshReadings setting readings.value = null before rethrow, exit=1, # fail 1, strictEqual at polling.test.js:173 (/tmp/gate-node-93iR0cMd.log); source restored.
reported: behavior wrong: a valid claim was deleted instead of repaired, against the goal's 'every valid claim unchanged' and D-03. No automated check now exercises a failed /api/config fetch keeping the last good readings.
severity: major
cause: cb5d5d42 deleted test_a_failed_config_fetch_keeps_the_last_good_snapshot because its assert read the retired config.value.active key (D-01). The claim itself still holds in code: refreshConfig runs safe(refreshReadings) (hqptuner/static/store/sync.js:104), so a failed fetch should leave the served readings as they were. Broken setup on a valid claim, not a contract mismatch; no test now covers it.
fix: e50d7316, retest

## Summary

total: 8
passed: 7
failed: 0
pending: 0
skipped: 1
blocked: 0
reworked: 2
