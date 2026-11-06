---
status: testing
phase: 2
fields_version: 1
started: 2026-11-06
updated: 2026-11-06
---

## Items

### 1. Fresh Windows install boots clean
expected: smoke-windows installs into an empty LOCALAPPDATA, the installed app starts and /api/health answers (ci: smoke-windows)
origin: smoke
status: pass
job: smoke-windows
commit: 397c076c80ba2eceb77d0efc6bbb434e8e76cbb5
first_pass: pass
source: model
evidence: smoke-windows concluded success at 397c076c on all three rows (release run 42165957447 attempt 2: x64 installer, arm64 installer, x64 bundle)

### 2. Installer-started launch answers at the network address
expected: smoke-windows step 2a: the app the installer starts through /LAUNCH answers /api/health at the runner's non-loopback address (ci: smoke-windows)
criterion: AC1
status: pass
job: smoke-windows
commit: 397c076c80ba2eceb77d0efc6bbb434e8e76cbb5
first_pass: pass
source: model
evidence: smoke-windows concluded success at 397c076c on all three rows (release run 42165957447 attempt 2: x64 installer, arm64 installer, x64 bundle); step 2a address check passed on both installer rows

### 3. Relaunch after stop answers at the same address
expected: after the smoke kills the installer-started app by PID and starts the installed exe, the new process answers /api/health at the same address (ci: smoke-windows)
criterion: AC2
status: pass
job: smoke-windows
commit: 397c076c80ba2eceb77d0efc6bbb434e8e76cbb5
first_pass: pass
source: model
evidence: release run 42159800331 at fc9803f5 (pre-fix hqptuner.iss): both installer rows FAIL: step 2a: address check: the installer-started app at 172.25.176.1 / 172.19.224.1 answered 000

### 4. Bite proof: pre-fix installer fails the address check
expected: a smoke-windows run with the new step against the pre-fix hqptuner.iss failed at step 2a's address check (ci: smoke-windows)
criterion: AC3
status: pass
job: smoke-windows
commit: 397c076c80ba2eceb77d0efc6bbb434e8e76cbb5
first_pass: pass
source: model
evidence: smoke-windows concluded success at 397c076c on all three rows (release run 42165957447 attempt 2: x64 installer, arm64 installer, x64 bundle); step 3 relaunch after PID stop answered at the network address

### 5. Silent install without /LAUNCH starts nothing
expected: after /VERYSILENT without the switch, no HQPTuner.exe process is running (ci: smoke-windows)
criterion: AC4
status: pass
job: smoke-windows
commit: 397c076c80ba2eceb77d0efc6bbb434e8e76cbb5
first_pass: pass
source: model
evidence: smoke-windows concluded success at 397c076c on all three rows (release run 42165957447 attempt 2: x64 installer, arm64 installer, x64 bundle); step 1 no-/LAUNCH silent install found no HQPTuner.exe

### 6. CHANGELOG Fixed entry and README wording
expected: CHANGELOG.md [Unreleased] has a Fixed entry and README.md no longer contains "reachable from that PC only", both texts matching the owner-approved wording
criterion: AC5
status: pass
first_pass: pass
source: model
evidence: grep -n 'reachable from that PC only' README.md -> no match (rc=1); CHANGELOG.md [Unreleased] ### Fixed: '- **The Windows app now allows connections from other devices on LAN.**' (owner's line, 78bba4dd); README.md:192,204 'Other devices on your LAN can connect to it...' (307c3e41); owner confirmed the landed text stands

### 7. All required CI jobs green on the phase's last dev commit
expected: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos and smoke-windows all report success (ci: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows)
criterion: AC6
status: pass
job: smoke-windows
commit: 397c076c80ba2eceb77d0efc6bbb434e8e76cbb5
first_pass: pass
source: model
evidence: at 397c076c: check success (check.yml run 42165957413; release.yml check skipped by design, if: startsWith(github.ref, refs/tags/v)); e2e, smoke x8, lifecycle-deb x2, lifecycle-rpm x2, smoke-macos x5, smoke-windows x3 all success

## Summary

total: 7
passed: 7
failed: 0
pending: 0
skipped: 0
blocked: 0
reworked: 0
