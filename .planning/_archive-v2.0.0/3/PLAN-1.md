---
phase: 3
plan: 1
requirements: [INTG-03]
files:
  - .planning/phases/3/baseline/start.txt
  - .claude/worktrees/integrate/hqptuner/static/store/sync.js
  - .claude/worktrees/integrate/tests/js/store/live/mirror.test.js
  - .claude/worktrees/integrate/tests/js/store/live/polling.test.js
  - .claude/worktrees/integrate/hqptuner/api/push.py
  - .claude/worktrees/integrate/tests/api/test_push_config_reading.py
  - .claude/worktrees/integrate/tests/js/store/live/live.test.js
  - .claude/worktrees/integrate/tests/js/store/guards/xfmode-refusal.test.js
---

# Phase 3: Retired-shape ports - Plan 1: Starting baseline, config push excision and the three single-site ports

## Goal

Every remaining test and support under `tests/js/` runs on the approved interfaces (design step 12b). This plan records the phase's starting baseline, excises the `config` push event at both ends, ports the `fileTruth` and hand-built `readings.value` sites, and removes the polling suite's `readings.value` teardown.

## Must be true when done

- A full JS suite run at the integrate tip, taken before any port, is recorded in `.planning/phases/3/baseline/start.txt` with its sha, command, counts and log path.
- `hqptuner/static/store/sync.js` and `hqptuner/api/push.py` name no `config` push route or source, and no test under `tests/` emits, subscribes to or asserts on a `config` push event.
- `.venv/bin/pytest -m "not live" -q tests/api`, run through `scripts/gate.sh` in the integrate worktree, prints `exit=0` after the push excision.
- No line under `tests/js/` names `fileTruth`, and `store/guards/xfmode-refusal.test.js` seeds its readings through `seedReadings` and `fieldReading` with no `readings.value =` literal.
- `store/live/polling.test.js` assigns no `readings.value`.
- Each port commit of this plan quotes its pre-edit gate run printing `exit=0` and its after-run.

## Context

This Context is the shared one for Plans 1 to 10; the later plans cite it.

- Locked (`.planning/phases/3/CONTEXT.md`): D-01 retired-shape list, D-02 config push excised at both ends, D-03 kept shapes, D-04 wire-served literals ported only where they carry a D-01 key, D-05 pre-edit baseline per port, D-06 starting baseline, D-07 exit command, D-08 carried Phase 2 rules (D-03 failure routes, D-12 production-fix scope, D-13 stage by name, D-14 red intermediate commits).
- Paths: every `tests/`, `hqptuner/` and `scripts/` path is relative to `/home/atom/dev/hqptuner2/.claude/worktrees/integrate` (branch `rebuild/integrate`), and every gate runs there. `.planning/phases/3/` is under `/home/atom/dev/hqptuner2` (the main checkout, branch `v2`); records there are committed on `v2` by name, never staging the untracked `.planning/phases/2/baseline/failures.log`.
- **File run**: `PYTHONPATH=$(pwd) scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <files>`, no coverage flags. **Full-suite run**: the `.planning/phases/2/baseline/base.txt` command (`--test-concurrency=8` and the three globs `tests/js/*/*.test.js tests/js/*/*/*.test.js tests/js/*/*/*/*.test.js`), globs expanded by bash since zsh errors on an empty glob. It holds 8 of 18 cores: say so before it starts (`~/dev/CLAUDE.md` 3.1). A gate is never piped into `head`, `tail` or `grep`; read the log it names.
- **Port procedure** (D-05): before the edit, file-run the task's files plus every importer of a support file the task edits, and quote the `exit=0` line and log path in the commit message as `Pre-edit:`. A failing pre-edit run stops the task: it goes back to repair, not to the port. After the edit, run the same files and quote the line as `After:`. A test whose outcome changes after the port takes exactly one Phase 2 D-03 route: a machinery fault is repaired with asserts byte-identical; a production defect stays failing, the test unchanged, under a `Builder route:` commit line naming the failing line and the implicated `hqptuner/static/` path; an assertion contradicting approved behavior takes the contract-mismatch route with before-and-after document quotations under `Contract mismatch:`, and an unresolved one stops the task for the owner.
- **Port rules**, by retired shape (D-01):
  - A `profiles` or `device_caps` key in a `config.value` assignment, or in a builder whose result is assigned to `config.value`: a `null` value is removed, since production reads both through `metadataValue` (`hqptuner/static/store/core/readings.js`), which answers null for an absent reading. A non-null value moves into the setup's one `seedReadings` call as a read-only metadata reading, the `{ value, readonly: true }` shape `store/faceplate/stations.test.js` and `store/faceplate/drawers-output.test.js` seed, unless that call already serves the key, in which case it is removed. One `seedReadings` call per setup, since it replaces `readings.value` whole (Phase 2 D-10).
  - An `/api/config` fake answering `{ data }`: it answers the served-readings shape `{ generation, fields }`, as `support/threetrees.js` does by answering `readings.value`.
  - A `live_profiles` or `live_active` key written into `matrixConfig.value`: removed. Production reads the daemon-known profiles from `enums.value.matrix_profiles` and the live profile from the `matrix_profile` reading (`hqptuner/static/store/matrix/profiles.js` `daemonProfiles`, `matrixActiveProfile`); the task seeds them there only where the setup does not already.
- **Assert check**: `git diff <START> -- <files>`, START the sha in `.planning/phases/3/baseline/start.txt`, shows no added or removed line containing `assert` and no changed `test(` title, except the deletion of a test pinning the excised `config` push (AC4). A `test(` or `beforeEach(` line may change only by gaining `async` before its callback (Plans 7 to 10, Await rule) or by losing a callback parameter its body no longer uses (Task 6), its title byte-identical either way.
- **Lint**: `PYTHONPATH=$(pwd) scripts/gate.sh make lint-js` prints `exit=0`. An export or parameter a port leaves unused is deleted, not exempted.
- Forbidden: a second seed builder, a local field-reading builder, any `readings.value =` assignment under `tests/js/` outside `store/core/readings.test.js` and `model/store/reading.test.js` (AC1 as written, owner ruling 2026-11-06; the one in `support/readings.js` stands only until Plan 10 Task 7 removes it), any write to the `readings` signal by a spelling that dodges that search (`Object.assign`, bracket access, an alias of the signal, a production setter added for tests), a compatibility reader, a skip, a relaxed assertion, any edit to `fieldReading`, any edit to `seedReadings` outside Plan 7 Task 1 and Plan 10 Task 7, any gate exemption, `--no-verify` or `SKIP=`, staging `uv.lock` or `.planning/reads.jsonl` (D-13). Red intermediate commits are allowed (D-14); every other pre-commit gate applies.
- Kept, out of scope (D-03 and the CONTEXT Out list): `{ data }` fakes on `/api/matrix`, `/api/state`, `/api/status`, `/api/enumerations` and `/api/speakers`; `file_profiles` and `preset_profiles`; `live_active` in test names and comments; the `support/profile-fixtures.js` `reset()` parameter names; coverage thresholds and CI (Phase 4); any work on `v2` code.

## Tasks

### Task 1: Record the starting full-suite baseline

- **Files:** .planning/phases/3/baseline/start.txt
- **Action:** Before any port, take one full-suite run at the integrate worktree tip (D-06), since the last full run was at `3e90a616` and `e50d7316` was checked per file only. Say before it starts that it holds 8 of 18 cores. Write `start.txt` in the field layout of `.planning/phases/2/baseline/base.txt`: sha (`git rev-parse HEAD` in the worktree), branch and worktree, the exact command, pass, fail and test counts from the TAP summary, and the log path `scripts/gate.sh` printed. This sha is START for every later task's assert check. If the run reports any failure, quote each failing test's shortest decisive line in `start.txt`, commit the record, and stop the phase: a failing baseline goes back to repair (D-05), and no port task starts on it.
- **Verify:** `start.txt` exists with a sha equal to the worktree's `git rev-parse HEAD` at the time of the run, and its fail count matches the `# fail` line of the log it names. Testing scope: this task adds no test; the run itself is the evidence, and a fail count of 0 is the condition for Task 2 to start.

### Task 2: Excise the config push at the page end

- **Files:** hqptuner/static/store/sync.js, tests/js/store/live/mirror.test.js, tests/js/store/live/polling.test.js
- **Action:** Remove the `["config", config, data]` entry from `ROUTES` in `sync.js` (D-02): `ROUTES` unwraps `.data` from a `ConfigReading` push that carries none, so every push writes `undefined` into the form-metadata signal and never reaches `readings`, and live values keep coming from the `refreshConfig` poll. Remove the `config` import there if nothing else in the file uses it. Delete the tests pinning the event: the two config-event cases of `mirror.test.js` (`test_an_identical_config_event_leaves_the_config_signal_unnotified`, `test_a_changed_config_event_notifies_the_config_signal_once`) together with the `CONFIG` constant, the `config` counter and import, and the `"config"` member of `secondEventMoves`'s `which` type that only they used; and the `event: "config"` entry of the `EVENTS` table in `polling.test.js`, plus the word "config" in the comment above that table that lists the wrapped events, and the `config` import of `polling.test.js`, whose only use is that entry. Leave every other `ROUTES` entry, the `matrix` event case of `polling.test.js` (its `active` key is not on the D-01 list) and the volume cases untouched. Do not re-route the push into `readings` (rejected in D-02). Pre-edit run per the Port procedure, over the two test files plus the other `sync.js` importers: `tests/js/store/apply-summary.test.js`, `tests/js/store/live/hidden.test.js`, `tests/js/store/live/syncdoc-settled.test.js`, `tests/js/store/live/syncdoc.test.js`.
- **Verify:** the after-run over the six files prints `exit=0`; `grep -n '"config"' hqptuner/static/store/sync.js` prints nothing; `grep -rn -E 'emit\("config"|event: "config"|secondEventMoves\("config"' tests/js` prints nothing; the assert check shows removed assert and `test(` lines only inside the two deleted mirror cases and the deleted `EVENTS` entry; lint prints `exit=0`. Testing scope: the outcome is that no push event writes the form-metadata signal and live values still arrive by poll; the poll is already covered by `polling.test.js` `test_a_failed_readings_fetch_keeps_the_last_good_readings` and the readings suites, and the remaining push routes by the `EVENTS` loop, so no new test is added; the search settles the excision and testing stops there.

### Task 3: Excise the config push at the server end

- **Files:** hqptuner/api/push.py, tests/api/test_push_config_reading.py
- **Action:** Remove `Source("config", ...)` from `sources()` in `push.py` (D-02), drop `config` from the `hqptuner.api.routes` import if nothing else uses it, and correct the module docstring's event list and the `sources()` docstring's event count to the events that remain. `hqptuner/api/routes/config.py` `current_config` stays: its route still calls it. In `test_push_config_reading.py`, delete `test_daemon_bounds_reach_the_subscriber_on_the_refresh_that_read_them`, which pins the config event, and the helpers and constants only it used (`_minimums_pushed`, `FIRST_MINIMUM`, `SECOND_MINIMUM`); keep `test_a_credential_verdict_reaches_the_subscriber_on_the_refresh_that_read_it` and everything it uses. Pre-edit run: `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/api/test_push_config_reading.py tests/api/test_push_route.py tests/api/test_push_feed.py tests/api/test_push_heartbeat_reading.py` prints `exit=0`, quoted as `Pre-edit:`.
- **Verify:** the same pytest run after the edit prints `exit=0`; `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/api` prints `exit=0` (AC6); `grep -n '"config"' hqptuner/api/push.py` prints nothing; `grep -rn 'events(blocks, "config")' tests` prints nothing; `scripts/gate.sh .venv/bin/ruff check hqptuner/api/push.py tests/api/test_push_config_reading.py`, `scripts/gate.sh .venv/bin/black --check` on the same two files, `scripts/gate.sh .venv/bin/vulture` and `scripts/gate.sh .venv/bin/mypy` report no finding naming either file (a finding elsewhere is quoted in the commit, not fixed here). Testing scope: the remaining push events are covered by the four push suites; the credential-verdict case still proves a refresh publishes on the read that took it; no new test; testing stops at these runs.

### Task 4: Port the fileTruth comment in the live suite

- **Files:** tests/js/store/live/live.test.js
- **Action:** Rewrite the comment above `FILE()` so it describes what `FILE()` and `fileFields` serve now, the overlay as field readings shown from file keyed by form-field name, with the PCM rate limit as `defaults_samplerate` and the SDM one as `defaults_bitrate`. It names no `fileTruth`, no retired `file` signal and no history, and cites the schema entries where they now live (`pcm_rate` and `sdm_rate` are in `hqptuner/static/store/schema/output.js`, not `store/schema.js`). Code and asserts stay byte-identical. Port procedure: pre-edit and after-runs on `live.test.js`.
- **Verify:** the after-run prints `exit=0`; `grep -rn fileTruth tests/js` prints nothing; `git diff <START> -- tests/js/store/live/live.test.js` changes comment lines only; lint prints `exit=0`. Testing scope: comment-only; the file run is the whole evidence.

### Task 5: Port the hand-built readings literal in the xfmode refusal suite

- **Files:** tests/js/store/guards/xfmode-refusal.test.js
- **Action:** In `reset`, build each field through `fieldReading(value, ...)` from `tests/js/support/readings.js` with the overrides that reproduce today's entry exactly (`show: "file"`, `restarts: true`, generation 1; `fieldReading` already supplies `engine: null`, `staged: null`, `lane: "form"`, `diverges: false`, `bounds: null` for a file-shown reading), and replace `readings.value = { generation: 1, fields }` with one `seedReadings(fields, 1)` call, and drop `readings` from the `store/core/readings.js` import, keeping `refreshReadings`. The `/api/config` route keeps serving the same `fields` with its `staged` overlay. Asserts and test titles stay byte-identical. Port procedure on this file.
- **Verify:** the after-run prints `exit=0`; `grep -n 'readings\.value *=' tests/js/store/guards/xfmode-refusal.test.js` prints nothing; the assert check is clean; lint prints `exit=0`. Testing scope: the suite's own cases are the coverage; no new test.

### Task 6: Remove the readings teardown from the polling suite

- **Files:** tests/js/store/live/polling.test.js
- **Action:** In `test_a_failed_readings_fetch_keeps_the_last_good_readings`, remove the `t.after` teardown that assigns `readings.value = null`, and the callback's `t` parameter, which only that teardown used (an unused parameter fails lint). The seed, the wire, the `refreshConfig` call and both reads of `readings.value` stay byte-identical, and `readings` stays imported for those reads. The case stays as Task 2's poll coverage. Planning-time evidence that nothing after it depends on the reset: the later cases read `volume.value` and the POST list, and `refreshDevices` re-pulls `/api/config` through `refreshConfig` before anything reads readings. Port procedure on this file. If the after-run shows a later case's outcome changed, the dependency is state this case leaves behind. A conforming test cannot reset it: it has no `readings.value =`, and a seed cannot set `null`. In that event the case is deleted in this commit under a `Deleted:` line naming the owner ruling of 2026-11-06 and the changed case. That line records that Task 2's citation of this case as the poll's coverage no longer holds, and the executor reports the uncovered keep-last-good path at hand-back. No other case is edited to absorb the change.
- **Verify:** the after-run prints `exit=0`; `grep -n -E 'readings\.value *= *[^=]' tests/js/store/live/polling.test.js` prints nothing; `grep -n test_a_failed_readings_fetch_keeps_the_last_good_readings tests/js/store/live/polling.test.js` prints one line, or nothing with the commit's `Deleted:` line on the deletion route; the assert check shows only the teardown's removed lines and the `test(` line losing `t`; lint prints `exit=0`. Testing scope: no behavior changes; the file run is the evidence, and testing stops there.

## Notes

- Plans 1 to 10 run in order, never in parallel. Plans 1 to 6 lease disjoint files; Plans 7 to 10 re-lease files of Plans 1 to 6 and Plan 10 re-leases Plan 7's support files, which sequential order allows. Task 1 here precedes every port (D-06). Plan 2's support helpers precede their callers in Plans 3 and 5 (Phase 2 D-03). Plan 7 Task 1 precedes every await port, and Plan 10's support awaits and seed switch follow every caller.
- Testing policy CI: no CI task is planned. The integrate worktree's `.github/workflows/check.yml` already carries the accepted commands (the Python coverage run, `node .github/cadence/coverage-report-check.mjs --format python --report .coverage.json`, and the JS coverage run at lines 95, branches 90, functions 85) in jobs `check` and `e2e`, and git tracks `.github/cadence/coverage-policy.json` and `coverage-report-check.mjs` there. Coverage thresholds and green CI are Phase 4 (CONTEXT Out list).
- The repo rule to run `/task-check` after an `hqptuner/` edit binds Tasks 2 and 3. `make check` in the integrate worktree is not expected green before Phase 4 (INTG-04), so the executor says the `/task-check` step was skipped and why (`~/dev/CLAUDE.md` 8.2); the edits change no visual surface.
- After Task 2 nothing in production writes the `config` signal. Before it, the push wrote `undefined` there, so no reader saw form metadata from it either (CONTEXT flagged assumption).
- AC6 is run here with `PYTHONPATH=$(pwd)`, which the repo's worktree rule needs for the Python half to test the worktree, not the parent checkout.
- Recalled: Phase 2 `SUMMARY.md` hands the `polling.test.js` push event and `mirror.test.js:25` to this phase; Phase 2 `SUMMARY.md` plan 5 task 5 left `polling.test.js` unmigrated because its asserts read the retired `active` key, which Task 2 resolves for the config case by deletion.
