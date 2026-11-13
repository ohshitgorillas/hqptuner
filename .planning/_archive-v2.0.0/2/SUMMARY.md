---
phase: 2
status: complete
completed: 2026-11-06
---

# Phase 2: Baseline recovery - Summary

The integration worktree's JS suite went from 195 failures of 4904 (baseline at `082346ff`) to 0 failures of 4882 at `rebuild/integrate` `3e90a616`, through repaired test machinery, three production fixes (shaper-fit name lookup, held-write re-mirror, station list and device caps read from the served readings) and the deletion of owner-retired claims.

## What shipped

- Baseline record, failure routing and audit: `.planning/phases/2/baseline/` (`routes.md`, `audit.md`, `exit.txt`, `regression.txt`), on `v2`.
- Shared seed helpers repaired to the readings shape: `tests/js/support/` (field-harness, profile-fixtures, pipelines-fixture, wire fakes `wire.js`, `unreadwire.js`, `livepresetwire.js`), on `rebuild/integrate`.
- Component and store suites migrated to `seedReadings` with no assert changed: alerts, shell, drawers, settings, builders, faceplate, guards, catalog, live, preset and DSD list suites, on `rebuild/integrate`.
- B1: `shaperName` in `hqptuner/static/store/alerts/shaperfit.js` reads the served name first, then the form option list.
- B2: `refreshConfig` in `hqptuner/static/store/sync.js` refreshes the readings instead of mirroring the retired `config` body, so a held live write shows on the dormant control.
- B3: `metadataValue` in `hqptuner/static/store/core/readings.js`; `stations.js` and `devicecaps.js` read profiles and device caps from it (owner ruling B3).
- Dead `previewConfig` removed from `hqptuner/static/store/actions.js`.
- Retired claims C1 (preview changes what a control shows), C2 (control value outside `field(key).value.value`) and C3 (server buffer empties once an edit goes clean) deleted, each with a `Contract mismatch:` commit line; `store/hardware-catalog.test.js` deleted whole.

## Commits

Code commits are on `rebuild/integrate`; plan 1 tasks 1 and 2, plan 7 and the `docs(2)` routing commits are on `v2`.

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | 14dd1427 | Fresh JS baseline at 082346ff: 195 fail of 4904 |
| 1 | 2 | 4c93ecb6 | Route all 195 failures in routes.md |
| 1 | 3 | 45f5e359 | field-harness to the readings shape |
| 1 | 4 | 85e32cbd | profile-fixtures to the readings shape |
| 1 | 5 | 522c0334 | Easy helpers repaired |
| 1 | 6 | none | shaperfit-fixtures blamed for no failure |
| 1 | 7 | 5ef99f79 | pipelines-fixture repaired |
| 2 | 1 | 19cc6273 | Restore three renamed crossfeed asserts |
| 2 | 2 | ba04762f | nameOf tests with bite proof |
| 3 | 1 | 9cd0622c | Alert and shaper-fit suites |
| 3 | 2 | 8f419e1f | Rail computed inputs served through /api/speakers |
| 3 | 3 | 3e5e410a | Shell suites |
| 3 | 4 | ef585708 | Passing alert and shell seeds |
| 3 | 5 | 02b3f52e | filter-fields helper and three suites |
| 3 | 6 | 638f0527 | Remaining failing drawer suites |
| 3 | 7 | 6c5ca083 | Passing drawer seeds |
| 3 | 8 | 0354510e | Output drawer suites |
| 4 | 1 | 13277f26 | Passing output drawer seeds |
| 4 | 2 | bcffc46e | Failing settings suites |
| 4 | 3 | 77f1a09b | Passing settings seeds |
| 4 | 4 | 520da834 | Failing builder suites |
| 4 | 5 | 60315525 | Passing builder, list and page seeds |
| 4 | 6 | 6071c375 | Failing store drawer suites |
| 4 | 7 | 1ee27c59 | Failing store shell suites |
| 4 | 8 | d26e448f | Passing store faceplate seeds |
| 5 | 1 | 0ef73a19 | Failing guard suites |
| 5 | 2 | 8003bc16 | Failing catalog and pipeline store suites |
| 5 | 2 | 007f8762 | stagingWire reconciles its answers against served readings |
| 5 | 3 | 23ab52b1 | Failing live, narrowing and preset suites |
| 5 | 4 | 88f6da50 | Passing guard, operations and catalog suites |
| 5 | 5 | ec3e1a7d | Passing live, page and list suites |
| 5 | 6 | 2d5bda74 | Passing DSD list suites |
| - | - | 8925f777 | docs(2): retire C1 to C3 and add plan 6 |
| 6 | 1 | ceb112e9 | Delete retired C1, C2 and C3 cases |
| 6 | 2 | 2599896b | Remove dead previewConfig |
| 6 | 3 | b68825fd | B1 shaper-fit name lookup |
| 6 | 4 | 89a46b88 | B2 re-mirror a held write |
| 6 | 5a/b | 8287314d | Fakes serve readings; two config-mirror cases deleted |
| 6 | 5c | 1ee4e55a | B3 profiles and device caps from the readings |
| 6 | 5d | 15bc96b7 | applyguard kept case setup repaired |
| 6 | fix | cb5d5d42 | Last config-mirror case deleted |
| 6 | 6 | 3e90a616 | Matrix keep-last-good fixture to the D-01 shape |
| 7 | 1 | ac148243 | Audit of the phase's commits at 3e90a616 |
| 7 | 2 | da66f688 | Exit check: 165 files, 0 failures |
| 7 | 3 | 8d2cdcb0 | Full-suite regression check: 4882 of 4882 |

## Deviations

- [deviation] Plan 1 returned `PLAN CHECKPOINT: suite-red` at 193 failures, all leased to later plans; the owner accepted it on 2026-11-05.
- [deviation] Plan 5: lease extended with `tests/js/support/wire/wire.js` on the orchestrator's instruction (007f8762).
- [deviation] Plan 5 task 3: the live-reenum held-write case, routed repair (R9), was a production defect; rerouted B2 to plan 6 (8925f777).
- [deviation] Plan 5 task 5: `polling.test.js` not migrated, since its asserts read the retired `active` key; resolved by the structural checkpoint outcome.
- [deviation] Plan 6 task 1: one routed C1 case (`test_leaving_a_hazard_and_reaching_it_again_asks_again_at_edit_time`) is a valid claim with broken setup; kept and repaired in 15bc96b7. Two vacuous previewed-silences cases deleted beyond the 24 routed (ceb112e9).
- [deviation] Plan 6 task 4 (89a46b88) regressed 11 passing tests whose fakes served the retired `{ data }` body; plan 6 gained tasks 5 and 6 and a wider file list, closing them in 8287314d, 1ee4e55a, 15bc96b7, cb5d5d42 and 3e90a616.
- [deviation] Plan 6 task 5c amended D-01 by owner ruling B3: profiles and device caps come from the served readings (annotated in CONTEXT.md).
- [deviation] Coordinator decision: the polling.test.js config-mirror cases were stale and deleted; the matrix keep-last-good case had a valid claim and was repaired (3e90a616), one assert line edited in place without a `Contract mismatch:` record.
- [deviation] Process slips: one full-suite run at default concurrency from a malformed zsh glob (plan 6, under a minute); one subset gate run sent to `/dev/null` and two piped into `tail` (plan 6, repeated properly); the coordinator wrote PLAN-6.md task 5 and the CONTEXT.md D-01 note from the shell (soft-wrap check passes). Plan 1 and plan 7 docs commits on `v2` used `SKIP=pytest-offline,fresh-reports,coverage-floor` under the red-commit override, since the v2 Python tree does not import.

## Open items

- Fakes still serving `{ data: ... }` that pass (`header.test.js:67`, `remirror.test.js:91`, `mirror.test.js:25`, `polling.test.js` push event) and `live_profiles` / `live_active` keys in builder fixtures: Phase 3 retired-shape ports.
- `sync.js` `ROUTES` still pushes `["config", config, data]`, which the readings body does not carry.
- `previewPreset` in `actions.js` discards `api.preset(name)` and keeps a stale docstring.
- No remaining applyguard case proves an apply-time question opens.
- `About.js:43` runs `duringEngineWrite` outside any engine operation, and nothing reads `engineBusy`, so a state restore does not show busy on the brand knob; unverified as a defect, owner call.
- `tests/js/store/faceplate-page/profile.test.js:120` carries `file_profiles` with a nested `rows`; owner to judge whether D-01 reaches it.
- cb5d5d42's `Contract mismatch:` line carries no document quotation.
- Five indirect importers of changed support files are outside exit.txt by D-07's definition; they passed in the full run.
- `applyguard.test.js` `FormField` typedef comment still says a checkbox is a real bool.
- Stash `b23a78f0` holds the owner's staged live-reenum edit, untouched.
- Scratch copy `/tmp/p2exp` from plan 1 is still on disk; `rm -rf` is blocked on this host.
- `baseline/failures.log` (1 MB) stays untracked: it is raw node output whose canceled-count line uses the British spelling and fails the American-spelling gate, and the log is not edited.

## Goal check

The goal is a passing JS baseline in the integrate worktree through repaired machinery and production fixes, valid claims unchanged. The record supports it: the exit check over the 165 affected files ran `# fail 0` of 2051 (`baseline/exit.txt`, da66f688), and the full suite ran 4882 of 4882 at `3e90a616` (`baseline/regression.txt`, 8d2cdcb0), down from 195 failures at `082346ff` (14dd1427). The three production defects are fixed in code (b68825fd, 89a46b88, 1ee4e55a), and every assert-line check in plans 2 to 5 reports no added or removed assert. Two qualifications: 24 claims were deleted rather than made to pass, under owner rulings C1 to C3 recorded in 8925f777, so "every valid claim unchanged" rests on those rulings; and 3e90a616 edits one assert line in place, ruled a fixture-shape repair with no `Contract mismatch:` record. Retired shapes still in passing fakes and fixtures are Phase 3's scope, not a gap in this one.

complete locally, not CI-verified
