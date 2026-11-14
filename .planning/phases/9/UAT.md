---
status: testing
phase: 9
fields_version: 1
started: 2026-11-14
updated: 2026-11-14
---

## Items

### 1. Concurrent write lanes queue, never interleave
expected: While one apply runs, a second apply, preset load or /api/restore waits then completes with no 409; the daemon receives the two operations' /restore pushes in sequence, never interleaved
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: Route-level ApplyOps.write_lock on all six D-02 lanes (apply.py:121, preset.py:61, config.py:338, config.py:398, matrix.py:233); tests/apply/overlap/test_apply_queue.py 12 cases pass; verifier bite run against 42807119^: 'assert 2 == 1'.

### 2. Apply clears only what it carried
expected: A field staged or re-staged with a new value during an apply is still in GET /api/config/pending after the apply converges; a filter parked during an apply is still parked after it
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: pending.py:117-123 clear_applied on the apply's own copy; filterpark.py:199-210 releases only unchanged carried bytes; test_apply_keeps_restaged.py (3) and test_park_release.py pass; verifier bite run against 382b2250^: 3 failed by assertion.

### 3. One dated safety copy per operation, five kept, bad bytes rejected
expected: An apply taking two restore passes leaves exactly one new safety copy holding the pre-apply state; after 6 operations the 5 most recent copies remain; an empty or non-zip /backup body replaces no stored copy
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: presetops.py is_settings_archive/copies_to_prune/_write_new_copy, restore.py:233-243 held flag; tests/presets/integrity/test_safety_copies.py 9 cases pass; verifier bite run against 32bd0c24^: 'assert 2 == 1', 'assert 3 == 1', "'Drifted' == 'Opal'".

### 4. Store writes are atomic and serialized
expected: Two concurrent writers to one JSON store both land and the file always parses; a write killed between temp write and rename leaves the previous file whole; connection.json stays mode 0600
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: hqptuner/atomicwrite.py adopted at every store write site; per-instance locks around read-modify-write; test_atomic_write.py, test_atomic_writes.py, test_store_locks.py, test_connection_file_mode.py (0o600) pass.

### 5. Dispositions recorded for F-029, F-030, F-031
expected: DISPOSITIONS.md has one entry each for F-029, F-030, F-031; each fixed part names its commit and a proof failing against pre-fix code; the per-client buffer and rollback declines quote the owner's ruling
criterion: AC5
status: pass
first_pass: pass
source: verifier
evidence: .planning/security/DISPOSITIONS.md:188,198,207 with commits, proofs and quoted owner rulings ('Keep shared, decline clause', 'No rollback, decline').

### 6. Gates green locally and in CI
expected: make check green; check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows pass on the phase's last dev commit (ci: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows)
criterion: AC6
status: pending_ci
job: check,e2e,smoke,lifecycle-deb,lifecycle-rpm,smoke-macos,smoke-windows
commit: e28b66fb48e004aa52856f5b385da87ba7e5d20b
source: model
evidence: local half settled: `scripts/gate.sh make check` -> exit=0, 3240 passed / 181 deselected (pytest), # pass 4908 # fail 0 (JS). The seven required jobs run only on GitHub Actions (macOS, Windows, deb/rpm lifecycle), not on this host.

### 7. Changelog carries the Security entry
expected: CHANGELOG.md [Unreleased] has a ### Security section with the four owner-approved bullets
status: pass
first_pass: pass
source: verifier
evidence: CHANGELOG.md [Unreleased] ### Security has the four bullets character-identical to PLAN-1.md:96.

## Summary

total: 7
passed: 6
failed: 0
pending: 0
pending_ci: 1
skipped: 0
blocked: 0
reworked: 0
