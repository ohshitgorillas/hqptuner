PLAN COMPLETE

Plan: .planning/phases/2/PLAN-4.md

Tasks: 8 of 8

| Task | Commit | Note |
|---|---|---|
| 1 Passing output drawer seeds | 13277f26 | integrate. Pre-edit `exit=0 log=/tmp/gate-node-rGr2HRWJ.log` (54 pass); after `exit=0 log=/tmp/gate-node-fPMMvZUb.log`. Five files migrated; schema and drawers-output lose their empty `file`/`active` keys. lint-js exit=0, assert check clean, AC3 clean |
| 2 Failing settings suites | bcffc46e | integrate. 32 pass, 0 fail (8 baseline failures, all repair: about-state-import-stores 1 R3, engine-rows 3 R2, hardware 3 R4, logging 1 R2). `/tmp/gate-node-mvWzHGAL.log`. engine-rows and logging local `form` builders became metadata plus a `load` helper that seeds. hardware seeds multicore/ecores/cuda as readings with `restarts: true` |
| 3 Passing settings seeds | 77f1a09b | integrate. Pre-edit `exit=0 log=/tmp/gate-node-HZQoCJDW.log` (24 pass); after `exit=0 log=/tmp/gate-node-NlTLy5Lu.log` |
| 4 Failing builder suites | 520da834 | integrate. 99 pass, 0 fail (9 baseline failures, all repair: rail 1 R3, rows 2 R3, snapshot 6 R2/R3). `/tmp/gate-node-ektKu78m.log`. rows.test.js `matrixConfig` loses `rows`, `live_profiles`, `live_active` (routes.md R3 names them as unread); running profile is a `matrix_profile` reading |
| 5 Passing builder, list, page seeds | 60315525 | integrate. Pre-edit `exit=0 log=/tmp/gate-node-VxfoVX3f.log` (170 pass); after `exit=0 log=/tmp/gate-node-pBgXpjFD.log`. profile-steps.test.js and store/faceplate-builders/profile.test.js already carried no value/file/active/rows key: unchanged, no commit line for them |
| 6 Failing store drawer suites | 6071c375 | integrate. 101 pass, 0 fail (16 baseline failures, all repair: grammar 5 R4, save-restart 1 R4, modes 3 R2, source 1 R2, speakers 1 R2, drawer 5 R3/R4). `/tmp/gate-node-iQsHoaeI.log` |
| 7 Failing store shell suites | 1ee27c59 | integrate. 38 pass, 0 fail (6 baseline failures, all repair: conn 3 R6, loadpreset 1 R3, path 1 R2, stations 1 R3). `/tmp/gate-node-HehXT4DR.log`. conn.test.js holds `applyOp` / `liveOp` runs in flight instead of writing `applying` / `engineBusy` |
| 8 Passing store faceplate seeds | d26e448f | integrate. Pre-edit `exit=0 log=/tmp/gate-node-1YGxyVCY.log` (37 pass); after `exit=0 log=/tmp/gate-node-DjoH8K9x.log` |

Across all 38 leased files: AC3 check clean (checked by an AST scan of every `config.value` / `matrixConfig.value` assignment plus the local builders read by hand), assert check clean against 082346ff (no added or removed `assert` line, no changed `test(` title), lint-js exit=0 at every commit. Every commit stages only leased paths by name; no commit stages uv.lock or .planning/reads.jsonl.

Final suite: full JS run (workflow.test_command is null; same command as Plan 1 Task 1, concurrency 8, no process left behind): `# fail 78`, `# pass 4832` of 4910 (/tmp/gate-node-HkKzFh11.log). 39 fewer failures than after Plan 3 (117). Failing titles compared with baseline/failures.log: 0 new failures; failing files are all in baseline/files.txt. The 78 are the planned red: Plan 3's 19 open entries (15 Builder route B1, 4 Contract mismatch C1/C2) and the rest leased to Plans 5 and 6. No suite-red checkpoint under the dispatch rule, no repair round.

Deviations: none

Open items:

- 0 Builder route and 0 Contract mismatch entries in this plan: all 39 baseline failures in the 17 failing files of Tasks 2, 4, 6 and 7 were routes.md `repair` and are green.
- Observation, unverified as a defect: `connState` (store/faceplate/conn.js) reads only `inFlight` of store/core/ops.js, and `duringEngineWrite` (store/enginewrite.js) sets `engineBusy`, which nothing in `hqptuner/static/` reads. `components/faceplate/settings/About.js:43` runs `duringEngineWrite(() => api.restore(file))` outside any engine operation, so a state restore does not read busy on the brand knob; `forms.js` and `actions.js` callers run inside engine operations and do. Left alone (D-12: no failing line implicates it; conn.test.js now passes through held engine operations). Owner call whether the restore should count.
- Declined: a shared `formField`-without-value helper in `tests/js/support/chainenums.js` (unleased); the four builder suites destructure `{ name, options }` from `formField` locally, the shaperfit-fixtures precedent.
- Kept `live_profiles` / `live_active` in components/faceplate-builders/profile.test.js and `live_profiles` in the other two passing builder profile suites: passing-file procedure strips values, `file`, `active`, `rows`; routes.md names `live_*` only for the failing rows.test.js.
- `tests/js/support/wire/unreadwire.js` `CONFIG()` still carries `file`, `active` and a profile `value` (Plan 3 open item, unleased, not in this plan's files).
