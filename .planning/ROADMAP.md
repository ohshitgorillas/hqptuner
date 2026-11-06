# Roadmap: HQPTuner v1

## Overview

v1.20.2 fixes the two Windows app problems reported against v1.20.1. The coverage gate comes first because the accepted testing policy requires it: Python branch coverage sits just under its threshold and no CI job enforces the policy yet. Network reachability comes before the upgrade fix because a fresh install has no workaround, while an upgrade can be worked around by uninstalling first.

## Phases

- [x] **Phase 1: Coverage gate in CI** - CI enforces the accepted testing policy and the suite meets it
- [ ] **Phase 2: Windows network access** - a fresh Windows install is reachable from other devices
- [ ] **Phase 3: Windows upgrade install** - installing over an existing version leaves a working app

## Phase Details

### Phase 1: Coverage gate in CI

**Goal:** CI fails any change that drops coverage below the accepted policy, and the suite meets that policy

**Depends on:** Nothing (first phase)

**Requirements:** None

**Success Criteria:**

1. Python branch coverage in `.coverage.json` from an offline suite run is at or above 90%.
2. A workflow under `.github/workflows/` runs the three accepted coverage commands, and a run below lines 95 or branches 90 fails.
3. `.github/cadence/coverage-policy.json` is tracked and `planning.mjs test-policy check` exits 0.
4. The required jobs `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` pass on the phase's last `dev` commit.

### Phase 2: Windows network access

**Goal:** A fresh Windows install answers on the PC's network address from the first launch on

**Depends on:** Phase 1

**Requirements:** WIN-01

**Success Criteria:**

1. On a Windows machine with no HQPTuner, the app launched by the installer's own finish page answers `/api/health` at the machine's non-loopback address.
2. After Quit from the tray and a start from the Start menu, the app still answers `/api/health` at that address.
3. `smoke-windows` exercises the installer-started launch and fails when that launch answers on loopback only.

### Phase 3: Windows upgrade install

**Goal:** Installing a new version over an existing one leaves an app that starts cleanly

**Depends on:** Phase 1

**Requirements:** WIN-02

**Success Criteria:**

1. Installing the new installer over an installed v1.20.1, then launching, shows the tray icon and no "Unhandled exception in script" dialog.
2. After that upgrade, the app answers `/api/health` at the machine's non-loopback address.
3. `smoke-windows` installs the previous release, installs the new build over it, and fails when the upgraded app does not start.
