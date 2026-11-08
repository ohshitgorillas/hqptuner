---
status: testing
phase: 5
fields_version: 1
started: 2026-11-08
updated: 2026-11-08
---

## Items

### 1. Service starts clean from scratch
expected: From a clean state the app boots, reaches its daemon and answers one primary request with real data (ci: smoke)
origin: smoke
status: pass
job: smoke
commit: cc21530c32fd3dff3633e378a46a488eb10503a3
first_pass: fail
source: model
evidence: smoke concluded success at cc21530c
reported: missing - CI smoke job has not run on the phase's last dev commit; no automated check of it exists locally
severity: major

### 2. No offline test opens a TCP or UDP socket
expected: With socket_guard registered for every offline test, the whole `not live and not e2e` suite passes and the guard flags no TCP or UDP connect; 8088, 4321/4322, metering and discovery fakes are all reached in-process
status: pass
first_pass: pass
source: verifier
evidence: Guard registered at tests/conftest.py:40; audit-hook spot-check records loopback connect and sendto in an offline window and nothing under live; recorded make check at 64ffd36d 2770 passed with the guard loaded (/tmp/gate-make-VSwBvQdV.log:1155); targeted 7-file run exit=0, 139 passed; no listener or dialer left in offline tests/ except fake_http.py's TCP path.

### 3. App code uses the production request path in tests
expected: Every daemon lane takes a Network at construction and production builds the real one; tests swap only the Network (transport), not the client, request or parsing code
status: pass
first_pass: pass
source: verifier
evidence: Network taken at construction by ConnectionManager (manager.py:86), create_app (factory.py:46,64,67), and every lane reads manager.network (loader.py:48,63; engineread.py:30; login.py:103; routes/discovery.py:35-36; lifespan.py:49,54,104; routes/connection.py:104); desktop.answers takes sockets (desktop.py:172). Production __main__.py:39 passes none, so Network() defaults to asyncio/httpx/UDP.

### 4. Real daemon connections remain only in CI lifecycle, live and e2e
expected: No offline support code under tests/ listens on or dials TCP/UDP except fake_http.spawn's TCP default used by the e2e stack; the only real dialers are live/e2e tests and the CI standin
status: pass
first_pass: pass
source: verifier
evidence: Only TCP serving in tests/support is fake_http.py:600-626, reached by tests/e2e/support/stack.py:385; fake_network binds a never-listening holder only (:63-80); daemon_standin.py present; live markers only in gates/test_tested_release.py and live/test_live_forms.py.

### 5. No gate changed and no exemption added
expected: The phase's diff touches no gate script, threshold, lint config or hook, and adds no noqa, type: ignore, eslint-disable, EXEMPT, pragma or ignore list entry
status: pass
first_pass: fail
source: model
evidence: git diff 59332122^ HEAD over *.py/*.js/*.ts adds no type: ignore, noqa or eslint-disable line (the only EXEMPT hits are socket_guard.py's EXEMPT_MARKS variable naming the live/e2e marks); b82f939e removed the type: ignore at test_discovery_network.py:43; the ruff ignore at pyproject.toml:233 is owner-ruled (session b0cb4135) and recorded as a deviation in SUMMARY.md; make check exit=0 log=/tmp/gate-make-yqJd4109.log
reported: behavior wrong - the phase's diff loosens the ruff lint gate project-wide and adds an inline type: ignore, with no owner ruling recorded
severity: major
cause: Two changes inside the phase range. (a) d2025f73 + 34ff3147 set ruff ignore = [PLR0911, PLR0912, PLR0913, PLR0915, PLR0917] at pyproject.toml:233; owner-directed in session b0cb4135 ("ruff should not be limiting the number of anything anywhere to force arbitrary refactors"), but it contradicts Success Criterion 4 as written and SUMMARY.md omits d2025f73, eb54bd46, 34ff3147 and still describes the check_pair/Search workarounds eb54bd46 removed. (b) cb38f86b added `# type: ignore[arg-type]` at tests/api/test_discovery_network.py:43 on `**fields: object` forwarded into Config(...); no owner approval found in the archive.
fix: b82f939e, retest

### 6. Each changed behavior has a bite-proof test
expected: Every behavior-changing task names a test that is red against the pre-change code and green after
status: pass
first_pass: pass
source: verifier
evidence: Red-by-assertion runs recorded per task in reports/plan-1.md, plan-2.md, plan-4.md; listener bite reproduced here (SO_ACCEPTCONN 1 real, 0 with listen stubbed).

### 7. make check green at the phase's last commit
expected: `scripts/gate.sh make check` exits 0 at HEAD
status: pass
first_pass: pass
source: model
evidence: scripts/gate.sh make check at 0e6c1a47 -> exit=0 log=/tmp/gate-make-te9jVQbR.log

### 8. CI job check passes
expected: Required job `check` concludes success on the phase's last dev commit (ci: check)
status: pass
job: check
commit: cc21530c32fd3dff3633e378a46a488eb10503a3
first_pass: fail
source: model
evidence: check concluded success at cc21530c
reported: missing - not run on the phase's last dev commit
severity: major

### 9. CI job e2e passes
expected: Required job `e2e` concludes success on the phase's last dev commit (ci: e2e)
status: pass
job: e2e
commit: cc21530c32fd3dff3633e378a46a488eb10503a3
first_pass: fail
source: model
evidence: e2e concluded success at cc21530c
reported: missing - not run on the phase's last dev commit, and make test-e2e was never run locally after the TCP paths were reduced to the e2e stack
severity: major

### 10. CI job lifecycle-deb passes
expected: Required job `lifecycle-deb` concludes success on the phase's last dev commit (ci: lifecycle-deb)
status: pass
job: lifecycle-deb
commit: cc21530c32fd3dff3633e378a46a488eb10503a3
first_pass: fail
source: model
evidence: lifecycle-deb concluded success at cc21530c
reported: missing - release.yml job not run on the phase's last commit
severity: major

### 11. CI job lifecycle-rpm passes
expected: Required job `lifecycle-rpm` concludes success on the phase's last dev commit (ci: lifecycle-rpm)
status: pass
job: lifecycle-rpm
commit: cc21530c32fd3dff3633e378a46a488eb10503a3
first_pass: fail
source: model
evidence: lifecycle-rpm concluded success at cc21530c
reported: missing - release.yml job not run on the phase's last commit
severity: major

### 12. CI job smoke-macos passes
expected: Required job `smoke-macos` concludes success on the phase's last dev commit (ci: smoke-macos)
status: pass
job: smoke-macos
commit: cc21530c32fd3dff3633e378a46a488eb10503a3
first_pass: fail
source: model
evidence: smoke-macos concluded success at cc21530c
reported: missing - release.yml job not run on the phase's last commit
severity: major

### 13. CI job smoke-windows passes
expected: Required job `smoke-windows` concludes success on the phase's last dev commit (ci: smoke-windows)
status: skipped
job: smoke-windows
commit: cc21530c32fd3dff3633e378a46a488eb10503a3
first_pass: fail
source: model
evidence: required CI job; not runnable on this host
reported: missing - release.yml job not run on the phase's last commit
severity: major
cause: smoke-windows concluded failure at cc21530c: "FAIL: step 4: GET /api/discover answered 401" (packaging/windows/smoke.sh:648). Pre-existing, not phase 5: a666a057 (phase 4 plan 1) put every /api route but health and login behind the login gate, and the same failure is on 1f585b05 before phase 5. The fix is already planned as phase 4 PLAN-2 task 5 ("smoke-windows logs in before it asks for discovery"), which the roadmap runs after phase 5.
fix: routed to phase 4 PLAN-2 task 5
reason: Owner decision (2026-11-07): set aside so phase 5 completes. The failure (GET /api/discover answered 401) comes from phase 4 plan 1's login gate, not phase 5; its fix stays planned as phase 4 PLAN-2 task 5. Not CI-verified on Windows.

### 14. The clock gate's reading no longer depends on how busy the machine running the suite is
expected: missing - the goal names this outcome but no automated check exercises it; SUMMARY concedes no load comparison was run
origin: verifier
status: skipped
first_pass: fail
source: model
evidence: SUMMARY.md Goal check 'Not shown here'; scripts/gates/check_clock_waits.py judges one run's expired timeouts, and .clock-probe.json holds one idle-host reading (0 expired over 2770 tests).
reported: missing - the goal names this outcome but no automated check exercises it; SUMMARY concedes no load comparison was run
severity: minor
cause: Goal clause never measured: no run compared the clock gate's reading under machine load before and after the phase. It follows by construction only (the offline suite no longer touches the network, guarded by socket_guard). Measuring it means loading this production host.
reason: Owner decision ("proceed" on the proposal): accepted as holding by design. socket_guard shows the offline suite opens no network connection; no load measurement run on the production host.

### 15. Dead fixtures in an offline test file still serve fake_http over TCP
expected: stub - tests/presets/test_switch_drops_profile.py holds zero tests but keeps fixtures that call fake_http.spawn's TCP default and build a ConnectionManager without the network
origin: verifier
status: pass
first_pass: fail
source: model
evidence: 68e63490 removes tests/presets/test_switch_drops_profile.py (test -e: absent); make check exit=0 log=/tmp/gate-make-yqJd4109.log
reported: stub - tests/presets/test_switch_drops_profile.py holds zero tests but keeps fixtures that call fake_http.spawn's TCP default and build a ConnectionManager without the network
severity: minor
cause: Pre-phase dead file: tests/presets/test_switch_drops_profile.py lost its last tests in 657d464b (before phase 5) but keeps night_http_daemon/plain_http_daemon fixtures on fake_http.spawn's TCP default. No test requests them, so no socket opens at run time; not a phase-5 regression.
fix: 68e63490, retest

## Summary

total: 15
passed: 13
failed: 0
pending: 0
skipped: 2
blocked: 0
reworked: 10
