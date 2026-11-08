# Roadmap: HQPTuner v1

## Overview

v1.20.2 fixes the two Windows app problems reported against v1.20.1. The coverage gate comes first because the accepted testing policy requires it: Python branch coverage sits just under its threshold and no CI job enforces the policy yet. Network reachability comes before the upgrade fix because a fresh install has no workaround, while an upgrade can be worked around by uninstalling first.

## Phases

- [x] **Phase 1: Coverage gate in CI** - CI enforces the accepted testing policy and the suite meets it
- [x] **Phase 2: Windows network access** - a fresh Windows install is reachable from other devices
- [x] **Phase 3: Windows upgrade install** - installing over an existing version leaves a working app
- [ ] **Phase 4: API exposure and authentication** - the API answers only callers it should, from the networks it should
- [ ] **Phase 5: Offline tests reach their fake daemons in-process** - no offline test opens a real network connection to a fake daemon
- [ ] **Phase 6: Connection host and stored credential** - the stored daemon credential reaches only the daemon the user chose
- [ ] **Phase 7: Config write path and input validation** - client input reaches the daemon and its files only in the shapes the allowlist names
- [ ] **Phase 8: Apply and store integrity** - concurrent applies and interrupted writes leave config and stores whole
- [ ] **Phase 9: Release pipeline supply chain** - what ships is what was tested, and signing secrets meet only pinned code
- [ ] **Phase 10: Agent tooling and repo guards** - the repo's agent tooling and rules hold against a hostile branch or injected content

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

Phases 4 to 9 remediate findings F-001 to F-048 of the independent security review of v1.20.1 (reviewed commit `a942cfca`, dated 2026-11-06). Each phase owns the findings its goal lists.

### Phase 4: API exposure and authentication

**Goal:** Findings F-001, F-002, F-003, F-008, F-009, F-024, F-025, F-027 and F-028 are each fixed or carry an owner ruling

**Depends on:** Phase 1

**Requirements:** None

**Success Criteria:**

1. Each of this phase's findings has a recorded disposition: fixed, naming the commit, or declined or deferred, quoting the owner's ruling.
2. Every Critical and High finding in this phase is fixed, or declined or deferred only by an owner ruling.
3. Each fixed finding has a test or check that fails against the pre-fix code.
4. `make check` is green and the required CI jobs pass on the phase's last `dev` commit.

### Phase 5: Offline tests reach their fake daemons in-process

**Goal:** Every offline test reaches each fake daemon it talks to in-process, so no offline test opens a real network connection and the clock gate's reading no longer depends on how busy the machine running the suite is

**Depends on:** Phase 4 plan 1 (runs before phase 4 resumes at plan 2 task 5)

**Requirements:** None

**Success Criteria:**

1. No test outside the `live` and `e2e` markers opens a TCP or UDP socket to a fake daemon: the fake 8088 HTTP daemon, the fake 4321 control daemon, the fake metering source and the fake discovery responder are each reached in-process.
2. The app's own code reaches the daemon through the same request path in tests as in production; only the transport underneath differs.
3. Real network connections to a daemon remain only in the CI lifecycle jobs against `scripts/ci/daemon_standin.py` and in `live`- and `e2e`-marked tests.
4. No gate is changed and no exemption is added.
5. Each changed behavior has a test that fails against the pre-change code.
6. `make check` is green and the required CI jobs pass on the phase's last `dev` commit.

### Phase 6: Connection host and stored credential

**Goal:** Findings F-004, F-005, F-015, F-017, F-020, F-021, F-022 and F-023 are each fixed or carry an owner ruling

**Depends on:** Phase 4

**Requirements:** None

**Success Criteria:**

1. Each of this phase's findings has a recorded disposition: fixed, naming the commit, or declined or deferred, quoting the owner's ruling.
2. Every Critical and High finding in this phase is fixed, or declined or deferred only by an owner ruling.
3. Each fixed finding has a test or check that fails against the pre-fix code.
4. `make check` is green and the required CI jobs pass on the phase's last `dev` commit.

### Phase 7: Config write path and input validation

**Goal:** Findings F-006, F-007, F-010, F-011, F-012, F-013, F-014, F-016, F-018, F-019, F-026, F-032 and F-033 are each fixed or carry an owner ruling

**Depends on:** Phase 4

**Requirements:** None

**Success Criteria:**

1. Each of this phase's findings has a recorded disposition: fixed, naming the commit, or declined or deferred, quoting the owner's ruling.
2. Every Critical and High finding in this phase is fixed, or declined or deferred only by an owner ruling.
3. Each fixed finding has a test or check that fails against the pre-fix code.
4. `make check` is green and the required CI jobs pass on the phase's last `dev` commit.

### Phase 8: Apply and store integrity

**Goal:** Findings F-029, F-030 and F-031 are each fixed or carry an owner ruling

**Depends on:** Phase 7

**Requirements:** None

**Success Criteria:**

1. Each of this phase's findings has a recorded disposition: fixed, naming the commit, or declined or deferred, quoting the owner's ruling.
2. Each fixed finding has a test or check that fails against the pre-fix code.
3. `make check` is green and the required CI jobs pass on the phase's last `dev` commit.

### Phase 9: Release pipeline supply chain

**Goal:** Findings F-034, F-035, F-036, F-037, F-038, F-039, F-040, F-041 and F-042 are each fixed or carry an owner ruling

**Depends on:** Phase 1

**Requirements:** None

**Success Criteria:**

1. Each of this phase's findings has a recorded disposition: fixed, naming the commit, or declined or deferred, quoting the owner's ruling.
2. Every Critical and High finding in this phase is fixed, or declined or deferred only by an owner ruling.
3. Each fixed finding has a test or check that fails against the pre-fix code.
4. `make check` is green and the required CI jobs pass on the phase's last `dev` commit.

### Phase 10: Agent tooling and repo guards

**Goal:** Findings F-043, F-044, F-045, F-046, F-047 and F-048 are each fixed or carry an owner ruling

**Depends on:** Phase 1

**Requirements:** None

**Success Criteria:**

1. Each of this phase's findings has a recorded disposition: fixed, naming the commit, or declined or deferred, quoting the owner's ruling.
2. Every High finding in this phase is fixed, or declined or deferred only by an owner ruling.
3. Each fixed finding has a test or check that fails against the pre-fix code.
4. `make check` is green and the required CI jobs pass on the phase's last `dev` commit.
