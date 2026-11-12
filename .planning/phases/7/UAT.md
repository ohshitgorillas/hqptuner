---
status: testing
phase: 7
fields_version: 1
started: 2026-11-12
updated: 2026-11-12
---

## Items

### 1. Clean start boots the app
expected: A fresh install started from clean state boots, the service comes up and answers its health route (ci: smoke)
origin: smoke
status: pending_ci
job: smoke
commit: 1044eb6ab9ca68ff79b7288e4b2f66ffaf54b4f0
source: model
evidence: packaging/linux/smoke.sh installs the built package on clean distro images in release.yml; it needs the CI build artifacts and containers, not runnable in this session

### 2. Engine writes refused while the 8088 lane is not ready
expected: With the 8088 lane taken down, its credentials refused or its /config page unread, POST /api/config/live, POST /api/volume, POST /api/livepresets/{name}/apply, POST /api/matrix/profile, POST /api/autopilot and POST /api/config/apply each answer a refusal, and the fake 4321 receives no command
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: readygate.py:62-101 installed at factory.py:78; test_writes_refused_not_ready.py passes; instrumented spot-check: all six routes cmds=0 with refusal codes under each of the three causes, versus 3/2/14/2/0/3 commands while ready.

### 3. Edits stage, Apply is inert, a LIVE edit's refusal shows
expected: In that state POST /api/config/stage succeeds and the edit shows in GET /api/config/pending; clicking Apply sends no apply request; a LIVE edit made then is sent, the readiness gate refuses it, and the refusal shows on that control (D-08 as amended 2026-11-11)
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: Stage open in readygate.py OPEN_WRITES and test_a_staged_edit_is_accepted_while_the_8088_lane_is_down passes; PendingBar.js:186-193,225 inert on !ready with test_apply_is_inert_with_the_configuration_lane_down_and_the_control_lane_up; live-not-ready.test.js (sent, sent during own restart, refusal on the control) passes, 48/48 JS.

### 4. 4321 reads attempted and bounded
expected: In that state /api/state, /api/status, /api/enumerations, GET /api/volume and /api/log reach the fake 4321 rather than being refused, and when that fake does not answer or stalls each returns within its deadline on the test clock
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: GET passes the gate (readygate.py:70-71), loader.poll keeps reading 4321; test_not_ready_reads.py passes: seven reads answered by their own routes, six under the control deadline on the silent virtual clock, /api/log answered on the ordinary clock.

### 5. Every test builder starts both lanes
expected: No builder in tests/support/ or tests/conftest.py starts an app or manager without both fakes answering and the 8088 forms loaded, except unserved_login, and no test asserts a feature succeeding with 8088 down
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: tests/support create_app only via ready_app and unserved_login (apps.py:133,207); conftest Runs.start returns ready_or_raise (conftest.py:217-220); per-file non-ready builders are startup or first-run subjects; no lane-down test asserts a feature succeeding.

### 6. Fake 8088 page matches the captured 6.0.4 page
expected: The fake 8088 /config page and tests/support/fixtures/config-form-6.0.4.html, parsed by formparse, give the same select fields with the same options, and the fake 4321 lists the page's filter, oversampling, dither and modulator IDs
criterion: AC5
status: pass
first_pass: pass
source: verifier
evidence: fake_http.py:125-179 serves the capture; tests/engine/http/test_fake_config_page.py 36 passed (selects, options, 4321 IDs per mode, wire types).

### 7. No comment describes a 4321-only mode
expected: None of the comment and docstring lines listed in D-15 describes a 4321-only mode as supported
criterion: AC6
status: pass
first_pass: pass
source: verifier
evidence: Every D-15 site read and rewritten to the two-lane app (signals.js, PendingBar.js, status.py, factory.py, deps.py, matrix.py, resolve.js, Playback.js, tests/support, test_live_chain.py, pendingbar.test.js, tests/presets suite docstrings); plan-5 sweep grep rerun shows only wire facts and refusals.

### 8. make check green on the last dev commit
expected: scripts/gate.sh make check exits 0 on the phase's last dev commit
criterion: AC7
status: pass
first_pass: pass
source: model
evidence: scripts/gate.sh make check at 6cbe36224d83dc6bcb005a401fff3172f194ed3b -> exit=0 log=/tmp/gate-make-qJf2HeIE.log; pytest 3029 passed, 180 deselected; JS tests 4901 pass 0 fail

### 9. No documentation describes a 4321-only mode as supported (user guide)
expected: behavior wrong - the user guide still states that live settings work without the 8088 credentials, which is the removed 4321-only mode (ROADMAP SC4)
origin: verifier
status: pass
first_pass: fail
source: model
evidence: docs/guide/sections/orientation.tex:6 now reads 'HQPTuner needs them to work at all. Without them the app reads ``Unreachable'' and runs dimmed: edits still stage, but nothing reaches the engine until both of its lanes to the daemon are up.'; grep -rniE 'without (the |them|credentials)|live settings? (still )?work|persistent side|only for the|4321|read-only|one lane|single lane' docs/guide/sections docs/guide/guide.tex matches only that line
reported: behavior wrong - the user guide still states that live settings work without the 8088 credentials, which is the removed 4321-only mode (ROADMAP SC4)
severity: minor
cause: docs/guide/sections/orientation.tex:6 predates phase 7 and still describes credentials as needed only for the persistent side, with live settings working without them; docs/guide/ is gitignored (.gitignore:112), so the phase 7 D-15 site list and plan-5 sweep, both over tracked files, never reached it
fix: uncommitted edit to gitignored docs/guide/sections/orientation.tex:6, owner-approved wording, retest

## Summary

total: 9
passed: 8
failed: 0
pending: 0
pending_ci: 1
skipped: 0
blocked: 0
reworked: 1
