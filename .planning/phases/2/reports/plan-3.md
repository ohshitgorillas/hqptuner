PLAN COMPLETE

Plan: .planning/phases/2/PLAN-3.md

Tasks: 8 of 8

| Task | Commit | Note |
|---|---|---|
| 1 Alert and shaper-fit suites | 9cd0622c | integrate. Run over the six files: 54 pass, 18 fail; the 18 are exactly 15 Builder route (B1) and 3 Contract mismatch (C1, unresolved Q1), tests untouched, baseline error text. header.test.js gets the `panel` Header takes; xref and header seeds moved to seedReadings; rail.test.js matrix switch is a `matrix_enabled` reading. lint-js exit=0, assert check clean |
| 2 Rail computed inputs | 8f419e1f | integrate. `speakers.value =` replaced by serving /api/speakers and `loadSpeakers()`; 32 baseline failures pass (13+12+7); value seeds in the one seedReadings call |
| 3 Shell suites | 3e5e410a | integrate. 69 pass, 0 fail (19 baseline failures). header.test.js: Header gets a `panel`, loaded station via `active_preset`, in-flight apply is a held `applyOp.run` (R6); rail.test.js health `phase: "Ready"` (R7); page, volume seeds via seedReadings |
| 4 Passing alert/shell seeds | ef585708 | integrate. Pre-edit `exit=0 log=/tmp/gate-node-eT0677th.log` (55 pass); after `exit=0 log=/tmp/gate-node-pLyyErQp.log` |
| 5 filter-fields + three suites | 02b3f52e | integrate. `filterFields(f, options)` keeps its parameters, returns `{ fields, values }` (metadata rows; four values for the caller's seedReadings), so the three importers changed. Pre-edit two-stage `exit=0 log=/tmp/gate-node-Nm5iRcE5.log` (HEAD copy against a copy of the old helper); after: 23 pass, 0 fail |
| 6 Remaining failing drawer suites | 638f0527 | integrate. 30 pass, 1 fail: drawers-speakers-schema.test.js:124 stays red under Contract mismatch C2 (Q2 unresolved), baseline text `+ '0' - '1'` |
| 7 Passing drawer seeds | 6c5ca083 | integrate. Pre-edit `exit=0 log=/tmp/gate-node-d1Frsbb3.log` (63 pass); after `exit=0 log=/tmp/gate-node-tc0gjuo8.log` |
| 8 Output drawer suites | 0354510e | integrate. 27 pass, 0 fail (4 baseline failures) |

Across all 36 leased files: AC3 check clean, assert check clean against 082346ff, lint-js exit=0 at each commit; no commit stages uv.lock or .planning/reads.jsonl.

Final suite: full JS run (workflow.test_command is null; same command as Plan 1 Task 1, concurrency 8, no process left behind): `# fail 117`, `# pass 4793` of 4910 (/tmp/gate-node-km5GSkWG.log). 76 fewer failures than after Plan 2 (193). Failing titles compared with baseline/failures.log: 0 new failures; failing files are all in baseline/files.txt. The 117 are the planned red: this plan's 19 open entries below, and 98 leased to Plans 4 and 5 and their builder/owner-question entries. No suite-red checkpoint under the dispatch rule, no repair round.

Deviations: none

Open items:

- 15 Builder route entries (B1, `hqptuner/static/store/alerts/shaperfit.js`) stay red untouched: components/faceplate-alerts/rail.test.js:100; store/faceplate-alerts/alerts.test.js:138,143,148,153,211,219; store/guards/shaperfit-alerts.test.js:82,98,105,110,119,179; store/guards/shaperfit-mode-gate.test.js:172,184.
- 4 Contract mismatch entries stay red, unresolved owner questions: C1/Q1 store/guards/shaperfit-mode-gate.test.js:201,213,225; C2/Q2 components/faceplate-drawers/drawers-speakers-schema.test.js:124.
- `tests/js/support/wire/unreadwire.js` `CONFIG()` still carries `file`, `active` and a profile `value`, is served as the /api/config body, and is leased to no plan; this plan's two importers no longer assign it, `store/c1-operations.test.js` (Plan 5) still does.
- Declined a second helper-level seed shape for rail-alerts (`seedReadings({ ...readings.value?.fields, matrix_enabled: true })` in faceplate-alerts/rail.test.js): the shaperfit fixture owns the one setup call and is unleased, so the test adds its switch on top of the fixture's readings (precedent: switcher.test.js).
