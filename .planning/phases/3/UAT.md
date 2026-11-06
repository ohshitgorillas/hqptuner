---
status: testing
phase: 3
fields_version: 1
started: 2026-11-06
updated: 2026-11-06
ci: 24fb2153623a3490e39589bac3701ed1a6988278
---

## Items

### 1. Upgrade over a quit v1.20.1 starts cleanly
expected: smoke-windows step 8: after v1.20.1 is installed and stopped by PID, the new installer into the same /DIR leaves an app still running after its tray is built and answering /api/health at the non-loopback address (ci: smoke-windows)
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: smoke.sh:287-295 and check_upgraded :246-273, wired at :472-475 and release.yml:365,370,393-399; CI run 42208798868 on 6010276d, x64 and arm64 installer rows both 'smoke: OK' (/tmp/claude-1000/sw-42208798868/*.log).

### 2. Upgrade over a running v1.20.1 closes it and starts cleanly
expected: smoke-windows step 9: no v1.20.1 process remains after the install, and the upgraded app is still running after its tray is built and answers /api/health at the non-loopback address (ci: smoke-windows)
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: smoke.sh:300-311 (survivor check :305-307 before lookup); hqptuner.iss:32 CloseApplications=force; CI run 42208798868 both installer rows 'smoke: OK' after step 9.

### 3. Upgrade steps run red against the pre-fix installer
expected: a smoke-windows run with the upgrade steps against the pre-fix hqptuner.iss fails at an upgrade step (ci: smoke-windows)
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: Run 42205190797 on 7f773b94 (pre-fix iss): both installer rows 'FAIL: step 9 (previous release running): the installer failed over the previous release', Setup log 'Some applications could not be shut down.' (/tmp/claude-1000/sw-42205190797/*.log).

### 4. Uninstall after upgrade removes the install
expected: after the upgrade, the uninstaller leaves no {app} directory (ci: smoke-windows)
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: smoke.sh:277-284 bounded wait for $UPGRADE_APP gone, called at :294 and :310; CI run 42208798868 both installer rows 'smoke: OK'.

### 5. CHANGELOG has the approved Fixed entry
expected: CHANGELOG.md [Unreleased] ### Fixed carries the owner-approved upgrade-fix entry
criterion: AC5
status: pass
first_pass: pass
source: verifier
evidence: CHANGELOG.md:10 '- **The Windows app now reinstalls cleanly.**' under [Unreleased] ### Fixed, verbatim match to the owner-approved wording in .planning/phases/3/reports/plan-1.1.md:15; check_changelog.py '[ok]'.

### 6. All required CI jobs green on the last dev commit
expected: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos and smoke-windows report success on the phase's last dev commit (ci: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows)
criterion: AC6
status: pass
job: smoke-windows
commit: 24fb2153623a3490e39589bac3701ed1a6988278
first_pass: fail
source: model
evidence: test-policy ci-status at 24fb2153: check, e2e, smoke (8 rows), lifecycle-deb, lifecycle-rpm, smoke-macos (5 rows) and smoke-windows (3 rows) concluded success; release run 42290268828 after one re-run of the stapling network failure, check run 42290268877
cause: smoke-macos concluded skipped at 24fb2153: its dependency build-macos (macos-15-intel, x86_64) failed in run 42290268828 at stapling, 'FAIL: stapling dist/HQPTuner-1.20.1-intel.dmg failed.' after five 'NSURLErrorDomain Code=-1005 The network connection was lost.' against api.apple-cloudkit.com. check, e2e, smoke, lifecycle-deb, lifecycle-rpm concluded success; smoke-windows still running at read time.
fix: 24fb2153, retest

### 7. After an upgrade over v1.20.1 the app shows its tray icon and no 'Unhandled exception in script' dialog (ROADMAP criterion 1, WIN-02)
expected: behavior wrong - no automated check exercises it: the smoke checks a proxy (PID alive 5 s after health) that the phase's own CONTEXT says passes on a broken windowed build whose error dialog keeps the process alive
origin: verifier
status: fail
first_pass: fail
source: model
evidence: packaging/windows/smoke.sh:263-266 is the only post-health check besides the LAN health call; hqptuner.spec:81 windowed on Windows; hqptuner/desktop.py:258-263 tray on main thread after server thread; CONTEXT.md flagged assumption 3; SUMMARY.md Goal check 'Criterion 1 is checked by proxy only'. Pre-fix step 8 passed, so the proxy has never gone red on the reported symptom.
reported: behavior wrong - no automated check exercises it: the smoke checks a proxy (PID alive 5 s after health) that the phase's own CONTEXT says passes on a broken windowed build whose error dialog keeps the process alive
severity: major
cause: No check looks for the error dialog. check_upgraded (packaging/windows/smoke.sh:262-266) only requires the PID alive 5 s after /api/health. The windowed PyInstaller build (hqptuner.spec:81) keeps the process alive behind an 'Unhandled exception in script' dialog, so a broken tray load passes. Pre-fix step 8 passed in run 42205190797, so this proxy has never gone red on the reported symptom.
fix: routed to /cad-plan

## Summary

total: 7
passed: 6
failed: 1
pending: 0
skipped: 0
blocked: 0
reworked: 2
