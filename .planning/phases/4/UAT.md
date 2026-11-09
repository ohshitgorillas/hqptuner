---
status: testing
phase: 4
fields_version: 1
started: 2026-11-09
updated: 2026-11-09
---

## Items

### 1. Clean-start boot in CI
expected: The e2e job starts the service from clean state and its suite passes (ci: e2e)
origin: smoke
status: pending
job: e2e
commit: 0c2ff910c3cbd31352aa8b7797a34383a5b15fe3
first_pass: fail
source: model
evidence: Runs on PR #5 at 0c2ff910, the CI timeouts reverted
cause: The Source drawer's quiet state (meterState 'silent', hqptuner/static/store/faceplate/drawers/source.js:83-88, from meterSilent at hqptuner/static/store/meter/feed.js:224-226, QUIET_MS 2000) is a clock read no signal backs. Since 8fc34281 nothing re-renders the drawer when frames resume, so a drawer first rendered 2 s or more after the feed opened stays on 'No metering available.' with no canvas.spec. On the CI runner the installed Playwright page clock runs at real time until pause_at, and the Source click lands 2.3 s (5.8 s after the suite) of page time after the feed opens. Reproduced on Opal: a 2.5 s real wait before the click gives data-meter=silent, canvas.spec 0 of 381 paints and '9 failed', each 'ShortReplayError ... 0 paints'; 1.0 s gives 381 of 381; 8fc34281^ with the same wait gives '9 passed' (/tmp/spike-20261109T220634/out2, out4, out5a, out5b). Separate defect in the same module: page.clock.pause_at() takes Unix seconds (playwright/_impl/_clock.py:95 'int(time * 1_000)'), the module passes Date.now() in ms.
fix: b43601be, retest

### 2. make check green on rebuild/integrate
expected: PYTHONPATH=$(pwd) scripts/gate.sh make check in .claude/worktrees/integrate prints exit=0
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: Clean gate logs at fe97fb16 (/tmp/gate-make-NzJYWMzN.log), abe984ba (/tmp/gate-make-tQreN5Yr.log) and 85fd14fb (/tmp/gate-make-GCBV0bCW.log: '3657 passed', '# pass 4856', '# fail 0', '# all files | 97.16 | 91.62 | 90.94'). 85fd14fb..5c2e3007 changes only JS comments. The phase record integrate-final.txt still names abe984ba, not the merged HEAD 5c2e3007.

### 3. Local e2e green on rebuild/integrate
expected: scripts/gate.sh make test-e2e in .claude/worktrees/integrate prints exit=0 and its log shows a passed count above zero
criterion: AC2
status: pass
first_pass: fail
source: model
evidence: In .claude/worktrees/integrate at 5c2e3007 (the merged second parent): PYTHONPATH=$(pwd) HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell nice -n 19 scripts/gate.sh make test-e2e printed exit=0 log=/tmp/gate-make-FqzVfA1u.log; '138 passed, 3657 deselected, 1 warning in 605.40s'.
reported: behavior unproven at the merged commit. The only green e2e run is at abe984ba. Six later integrate commits changed backend and frontend production code and deleted an e2e module, and no automated check has run the e2e suite on the tree that was merged.
severity: major

### 4. rebuild/integrate merged into v2
expected: git merge-base --is-ancestor rebuild/integrate v2 exits 0; the merge commit on v2 has two parents and the subject merge: rebuild/integrate into v2
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: `git merge-base --is-ancestor rebuild/integrate v2` exits 0. d1fbfb2b has parents 1ce87572 and 5c2e3007 and the subject 'merge: rebuild/integrate into v2'.

### 5. make check green on v2 after the merge
expected: scripts/gate.sh make check in /home/atom/dev/hqptuner2 on v2 prints exit=0
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: /tmp/gate-make-NMy3t3HZ.log at 0258e453: '3657 passed, 138 deselected', '# pass 4856', '# fail 0', '# all files | 97.16 | 91.62 | 90.94', with no make error line. d1fbfb2b..0258e453 touches only .planning/CAPTURE.md and .planning/config.json.

### 6. No threshold change, exemption or forbidden file in the phase
expected: No phase commit changes a coverage threshold in Makefile or .github/cadence/coverage-policy.json, adds a gate exemption, or contains uv.lock, .planning/reads.jsonl or .planning/phases/2/baseline/failures.log
criterion: AC5
status: pass
first_pass: pass
source: verifier
evidence: Independent re-audit of fe97fb16..5c2e3007 and of first-parent, non-merge eb290159..182df136: no exemption-marker added line outside .planning, no uv.lock, .planning/reads.jsonl or .planning/phases/2/baseline/failures.log, and a 0-line threshold diff. Makefile:138-140 still reads 95/90/85.

### 7. CI green on the owner's pull request from v2
expected: The check and e2e jobs are green on the owner's pull request from v2 (ci: check, e2e)
criterion: AC6
status: pending
job: check
commit: 0c2ff910c3cbd31352aa8b7797a34383a5b15fe3
first_pass: fail
source: model
evidence: Runs on PR #5 at 0c2ff910, the CI timeouts reverted
cause: The Source drawer's quiet state (meterState 'silent', hqptuner/static/store/faceplate/drawers/source.js:83-88, from meterSilent at hqptuner/static/store/meter/feed.js:224-226, QUIET_MS 2000) is a clock read no signal backs. Since 8fc34281 nothing re-renders the drawer when frames resume, so a drawer first rendered 2 s or more after the feed opened stays on 'No metering available.' with no canvas.spec. On the CI runner the installed Playwright page clock runs at real time until pause_at, and the Source click lands 2.3 s (5.8 s after the suite) of page time after the feed opens. Reproduced on Opal: a 2.5 s real wait before the click gives data-meter=silent, canvas.spec 0 of 381 paints and '9 failed', each 'ShortReplayError ... 0 paints'; 1.0 s gives 381 of 381; 8fc34281^ with the same wait gives '9 passed' (/tmp/spike-20261109T220634/out2, out4, out5a, out5b). Separate defect in the same module: page.clock.pause_at() takes Unix seconds (playwright/_impl/_clock.py:95 'int(time * 1_000)'), the module passes Date.now() in ms.
fix: b43601be, retest

### 8. The phase's production fix abe984ba (useBodyResize re-places the sheet after a changed plate line) is still exercised by a test
expected: unwired test coverage. The fix ships on v2, but the excision deleted its only reproducer, so no automated check exercises the behavior.
origin: verifier
status: pass
first_pass: fail
source: model
evidence: 121b2164 adds tests/e2e/test_sheet_top_tracks_plate_line.py (panel and option list, a failure line tapped away). HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_sheet_top_tracks_plate_line.py: '2 passed' in 3 of 3 runs (/tmp/gate-pytest-lVsRhEfW.log). With the abe984ba useLayoutEffect removed from Popover.js: '2 failed' in 3 of 3 runs, 'assert 148.0 == 109.0 ± 0.5' and 'assert (0.109375, 40.890625) == approx((0.0 ± 0.5, 2.0 ± 0.5))' (/tmp/gate-pytest-JG3q8xD8.log). scripts/gate.sh make check exit=0 log=/tmp/gate-make-eyovjPzK.log.
reported: unwired test coverage. The fix ships on v2, but the excision deleted its only reproducer, so no automated check exercises the behavior.
severity: minor
cause: 082482ca deleted tests/e2e/test_sheet_top_tracks_plate_line.py, the only reproducer for abe984ba. useBodyResize (hqptuner/static/components/faceplate/Popover.js:76-80) still re-places ConnPanel.js:144 and OptionList.js:158 on a change to alertsNow.value.plate, and failure alerts still put lines on the plate; grep -rln useBodyResize tests/ is empty.
fix: 121b2164, retest

### 9. The owner has seen the rebuilt faceplate at the hand-back URL before the phase is called done
expected: missing. The repo's hand-back rule requires the owner's look at every visual change before it is called done. The phase is marked complete, and its own open items say the owner has not looked.
origin: verifier
status: fail
first_pass: fail
source: model
evidence: SUMMARY.md frontmatter reads 'status: complete', while its open item says 'The owner has not yet looked at the rebuilt faceplate at http://10.0.0.238:8090'. .planning/phases/4/baseline/task-check.txt says 'this task does not call the phase done'. 85fd14fb removed the dropped-settings line, a visual element, and abe984ba changed sheet placement.
reported: missing. The repo's hand-back rule requires the owner's look at every visual change before it is called done. The phase is marked complete, and its own open items say the owner has not looked.
severity: minor
cause: Repo hand-back rule: the owner looks at every visual change before it is called done. 85fd14fb removed the dropped-settings line and abe984ba changed sheet placement; SUMMARY open items say the owner has not looked at http://10.0.0.238:8090.

## Summary

total: 9
passed: 6
failed: 1
pending: 2
skipped: 0
blocked: 0
reworked: 5
