# Roadmap: HQPTuner

## Overview

Milestone v2.0.0 lands the rebuild-integrate design on `v2`. The accepted testing policy's CI gate goes in first, so the integration work below it is measured against the same thresholds CI enforces. Then the integration worktree's JS baseline is recovered, the remaining tests are ported off retired shapes, and `rebuild/integrate` merges into `v2` with `make check` green. The order follows the design's own dependency: no port runs before its baseline passes, and no merge runs before the integrated tree is green.

## Phases

- [x] **Phase 1: Coverage gate in CI** - the accepted coverage commands run in `check.yml` at lines 95 / branches 90, and the policy file is tracked
- [x] **Phase 2: Baseline recovery** - the integration worktree's affected JS baseline runs with zero failures, with field values seeded through `seedReadings`
- [x] **Phase 3: Retired-shape ports** - every remaining test and support under `tests/js/` uses the approved interfaces
- [x] **Phase 4: Integrate into v2** - `make check` green on `rebuild/integrate`, which then merges into `v2`
- [x] **Phase 5: Meter playhead on the loop's dt** - the meters, spectrum and spectrogram move smoothly while frames reach the metering reader in bursts

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
4. The `check` and `e2e` jobs pass on the commit that brings the gate into `v2`.

### Phase 5: Meter playhead on the loop's dt

**Goal:** The meters, the spectrum and the spectrogram move smoothly in step with the music while frames reach the metering reader in bursts, with the stamps still the only authority for where the music is (owner approval, 2026-11-07).

**Depends on:** Nothing (independent of phase 4)

**Requirements:** METER-01

**Evidence the fix rests on:** frames reach the metering reader in bursts, and the server relays them as they land: on the live dev container at a 192k metering rate, 51 of 51 feed gaps over 100 ms passed while `/api/health` answered every 10 ms ping under 20 ms, and the whole app fed a paced fake at 192k delivers every event 21.35 ms apart (max 22.9 ms). The playhead (`hqptuner/static/model/gauges/playhead.js` `pacePaint`) moves only when a frame arrives, so each burst shows as a freeze and a jump. Spike scripts: `/tmp/spike-stutter/`. The owner's standing ruling holds: the stutter is fixed in our code, and the daemon and the network are neither probed nor blamed.

**Approach (owner-approved):** `pacePaint` stays pure and takes the paint's `dt` (wall time since the last paint) as a required argument; between frames the playhead advances by `dt`, never past the newest queued frame's end less the delay, and restarts at a break. The meter loop hands it `dt` from the injected `Clock` it already holds; no other code reads time. `docs/spec/timing.md` is reworded to allow exactly this: its two-clocks line and rule 1 let the playhead move on `dt` between two stamps it already has, and the "Feed event length" row loses its false "always shorter than a paint" claim. Built by the `pacer` agent, tests first.

**Success Criteria:**

1. While frames arrive in bursts, the playhead moves the same distance over the same stretch of wall time whatever the paint rate, and never stands still for a paint while a frame it has not shown is queued and behind the newest end less the delay.
2. The playhead never passes the newest queued frame's end less the delay, and never moves backward except at a break.
3. At a break the playhead restarts at the break frame and every view of playback starts again, as today.
4. Each paint still starts where the last one ended: no gap and no overlap.
5. `pacePaint` reads no clock; the meter loop's `Clock` is the only source of `dt`.
6. `docs/spec/timing.md` states the rule the code follows, and `scripts/gate.sh make check` prints `exit=0`.
