# Roadmap: HQPTuner

## Overview

Milestone v2.0.0 lands the rebuild-integrate design on `v2`. The accepted testing policy's CI gate goes in first, so the integration work below it is measured against the same thresholds CI enforces. Then the integration worktree's JS baseline is recovered, the remaining tests are ported off retired shapes, and `rebuild/integrate` merges into `v2` with `make check` green. The order follows the design's own dependency: no port runs before its baseline passes, and no merge runs before the integrated tree is green.

## Phases

- [ ] **Phase 1: Coverage gate in CI** - the accepted coverage commands run in `check.yml` at lines 95 / branches 90, and the policy file is tracked
- [ ] **Phase 2: Baseline recovery** - the integration worktree's affected JS baseline runs with zero failures, with field values seeded through `seedReadings`
- [ ] **Phase 3: Retired-shape ports** - every remaining test and support under `tests/js/` uses the approved interfaces
- [ ] **Phase 4: Integrate into v2** - `make check` green on `rebuild/integrate`, which then merges into `v2`

## Phase Details

### Phase 1: Coverage gate in CI

**Goal:** CI enforces the accepted testing policy's coverage commands and thresholds, and any shortfall against them is closed.

**Depends on:** Nothing (first phase)

**Requirements:** None (testing-policy gate phase)

**Success Criteria:**

1. `planning.mjs test-policy check --root .` returns `ok: true`, with no accepted command missing from `.github/workflows/`.
2. `.github/cadence/coverage-policy.json` and `.github/cadence/coverage-report-check.mjs` are tracked by git.
3. The Python report check on `.coverage.json` exits 0 at lines 95 and branches 90, and the JS suite exits 0 at lines 95 and branches 90.
4. The `check` and `e2e` jobs pass on the commit that installs the gate.

### Phase 2: Baseline recovery

**Goal:** The JS baseline in `.claude/worktrees/integrate` passes, through repaired test machinery and fixed production defects, with every valid claim unchanged (design step 12a).

**Depends on:** Phase 1

**Requirements:** INTG-01, INTG-02

**Success Criteria:**

1. `scripts/gate.sh` over every test file of the retained affected baseline, run together, reports zero failures.
2. A search under `tests/js/` finds no assignment that seeds a field value through `config.value` or `matrixConfig.value`.
3. No commit in this phase edits an assertion of the retained baseline, except through the contract-mismatch route the design names.
4. The untracked `uv.lock` is in no recovery commit.

### Phase 3: Retired-shape ports

**Goal:** Every remaining test and support under `tests/js/` runs on the approved interfaces (design step 12b).

**Depends on:** Phase 2

**Requirements:** INTG-03

**Success Criteria:**

1. A search under `tests/js/` finds no use of a retired shape, `fileTruth` among them.
2. Each port's record shows its pre-edit baseline passing before the edit.
3. The whole JS suite exits 0 in `.claude/worktrees/integrate` after the last port.

### Phase 4: Integrate into v2

**Goal:** `rebuild/integrate` is green and merged into `v2` (design steps 12c and 13).

**Depends on:** Phase 3

**Requirements:** INTG-04, INTG-05

**Success Criteria:**

1. `PYTHONPATH=$(pwd) scripts/gate.sh make check` in `.claude/worktrees/integrate` prints `exit=0`.
2. `git merge-base --is-ancestor rebuild/integrate v2` exits 0.
3. `scripts/gate.sh make check` on `v2` after the merge prints `exit=0`.
