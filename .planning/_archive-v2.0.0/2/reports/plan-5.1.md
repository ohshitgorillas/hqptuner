PLAN CHECKPOINT: structural

Plan: .planning/phases/2/PLAN-5.md

Tasks: 2 of 6

| Task | Commit | Note |
|---|---|---|
| 1 Failing guard suites | 0ef73a19 | integrate. 53 pass, 9 fail over the four files (`/tmp/gate-node-P5mTpReF.log`). directsdmwarn 6 R2, sdm-hide-superseded 2 R2, xfmode 6 R2/R8 green. applyguard: seeds moved, its 9 previewed-preset cases stay red (Contract mismatch C1, unresolved Q1; failing line now `direct_sdm is not staged: effective() reads false, not 1`). lint-js exit=0, assert check clean against 082346ff, AC3 clean |
| 2 Failing catalog and pipeline store suites | 8003bc16 | integrate. 17 pass, 11 fail over the five files (`/tmp/gate-node-NMuQTNhG.log`; the commit message says 18 pass, which is wrong by one). loudness-applied 9 R2 and fixed-volume-readings 1 R2 green; hardware-catalog 6 stay red (C2, unresolved Q2); structural-roundtrip 4 and pipeline-baseline 1 red, see Deviations. lint-js exit=0 (after prettier on loudness-applied), assert check clean, AC3 clean |

Deviations:

- [deviation] routes.md routes the 4 structural-roundtrip failures (R2, R8) and the 4 pipeline-baseline failures (R8) as `repair`. Reality: pipeline-baseline's 3 baseline failures are repaired and green, but the 4 structural-roundtrip cases stay red with every value and row served ("true !== false" on `W.staged.http`), so the repair route does not close them. Cause: commit 80a8bde0 removed client cleanliness drops ("Remove split and client cleanliness drops from actions."), the client sends no `drop`, and `docs/spec/api.md` line 33 gives reconciliation to the server ("`staged` is ... null when its destination store already holds that value"). `stagingWire` in `tests/js/support/wire/wire.js` (not in this plan's lease, shared by many importers) keeps every staged entry.
- [deviation] `pipeline-baseline.test.js` `test_staging_the_daemon_rows_of_a_live_active_profile_reads_clean` passed at baseline vacuously (empty `readings.value`, so `stagedCount` was 0) and fails once the rows are served (`1 !== 0`), for the same unreconciled-buffer cause. It is a failure that did not fail at baseline, so the final suite would be a suite-red checkpoint on it. Every seed in the file is correct; no seed makes it pass.

Open items:

- applyguard.test.js, 9 cases: Contract mismatch C1, unresolved, owner question Q1.
- hardware-catalog.test.js, 6 cases: Contract mismatch C2, unresolved, owner question Q2.
- structural-roundtrip.test.js 4 cases and pipeline-baseline.test.js 1 case: new unresolved contract mismatch (above). Owner/orchestrator decision needed: (a) add `tests/js/support/wire/wire.js` to this plan's lease so `stagingWire` reconciles a staged entry against the served baseline the way the server does (every importer then needs a re-run), or (b) route the cases as contract mismatch (client-side return-to-baseline drop is retired, the server owns it).
- Tasks 3 to 6 not started. They may meet the same unreconciled-buffer cause.
