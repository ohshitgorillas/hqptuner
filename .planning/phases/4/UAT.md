---
status: testing
phase: 4
fields_version: 1
started: 2026-11-08
updated: 2026-11-08
ci: 7097145f687d4f8a153259571cd904e567a1b5f8
---

## Items

### 1. Clean start boots and serves (ci: e2e)
expected: From clean state the e2e stack starts the app against the daemon stand-in, logs in, and a primary API query returns real data (ci: e2e)
origin: smoke
status: pass
job: e2e
commit: f8106d223c666f80e2efec3c3e1ea546b9b07209
first_pass: fail
source: model
evidence: e2e concluded success at 3eaf79d88867ac747c372850b07dc659b7282e95
reported: behavior not observed at HEAD: no e2e run covers the phase's last commit
severity: major

### 2. Login gate on every /api route
expected: Without a login cookie every /api route except /api/health answers 401; with the cookie from a successful login each answers as before
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: hqptuner/api/gate.py:78-108 LoginGate, installed in hqptuner/api/factory.py:76; tests/api/login/test_login_gate.py::test_every_api_route_but_health_and_login_refuses_a_caller_with_no_login and ::test_a_login_cookie_opens_the_gate; spot-run passed (exit=0, /tmp/gate-pytest-LxhFyYkX.log). Offline fixtures log in first, so existing route tests are the logged-in 'as before' half.

### 3. Login checks the HQPlayer pair and sets the right cookie
expected: Wrong pair: 401, no Set-Cookie. Correct pair: cookie set. 'Log in every time': cookie has no expiry; 'save password': cookie has an expiry
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: hqptuner/api/login.py login(), hqptuner/api/gate.py:43-60 set_login_cookie; tests/api/login/test_login_route.py::test_a_wrong_pair_is_refused_and_sets_no_cookie and ::test_the_cookie_lasts_as_long_as_the_choice_the_login_made passed in spot-run.

### 4. Cross-site state-changing requests refused
expected: A logged-in POST/PUT/DELETE with a foreign Origin or Sec-Fetch-Site: cross-site answers 403
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: hqptuner/api/crosssite.py:41-56, outermost in factory.py:78; tests/api/surface/test_cross_site_refused.py::test_a_logged_in_write_sent_from_another_site_is_refused (15 cases) passed in spot-run.

### 5. Exposed fields removed
expected: /api/health has no license name or fingerprint; /api/status metadata has no uri; /api/log has no path; a state export holds no password from a connection.json under the preset or backup directory
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: hqptuner/api/routes/status.py:26,29,82-85,104,152,196-218; hqptuner/presets/store/export.py:51-72; tests/api/test_api_health.py and tests/presets/test_state_export.py passed in spot-run.

### 6. Page headers, docs routes off, UI loads logged in (ci: e2e)
expected: Page responses carry frame-ancestors 'none' and X-Content-Type-Options: nosniff; /docs, /redoc, /openapi.json answer 404; a logged-in browser loads the whole UI including the meter feed and both downloads (ci: e2e)
criterion: AC5
status: pass
job: e2e
commit: f8106d223c666f80e2efec3c3e1ea546b9b07209
first_pass: fail
source: model
evidence: e2e concluded success at 3eaf79d88867ac747c372850b07dc659b7282e95
reported: behavior not observed at HEAD: the browser half (UI loads logged in, meter feed, both downloads) has no e2e run after plan 4
severity: major

### 7. DISPOSITIONS.md lists all 9 findings
expected: .planning/security/DISPOSITIONS.md has one entry for each of the 9 findings, each naming a fixing commit that resolves or quoting the owner's ruling
criterion: AC6
status: pass
first_pass: pass
source: verifier
evidence: .planning/security/DISPOSITIONS.md: 9 '### F-' headings, every named commit resolves on dev, both rulings verbatim per CONTEXT D-10/D-12, all named proof tests collected (39).

### 8. Required CI jobs pass on the phase's last dev commit (ci: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows)
expected: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos and smoke-windows all conclude success on the phase's last dev commit
criterion: AC6
status: pass
job: check,e2e,smoke,lifecycle-deb,lifecycle-rpm,smoke-macos,smoke-windows
commit: 7097145f687d4f8a153259571cd904e567a1b5f8
first_pass: fail
source: model
evidence: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows all concluded success at 7097145f687d4f8a153259571cd904e567a1b5f8
reported: missing: the seven required jobs have not run on the phase's last dev commit, because it is not pushed
severity: blocker

### 9. The /api/log path test also holds that the log lines are served
expected: behavior under-tested: plan 4 task 3 Verify requires 'a log read answers without path and with its lines', but the test asserts only the absence of path, so a log read refused with {detail, code} would also pass it
origin: verifier
status: pass
first_pass: fail
source: model
evidence: scripts/gate.sh .venv/bin/pytest -q tests/api/test_api_health.py::test_log_tail_carries_no_log_file_path -> 1 passed; asserts body == {enabled: True, lines: <fake log lines>}, so a refusal body or a path key fails it; make check exit=0 (/tmp/gate-make-wChTi7D3.log)
reported: behavior under-tested: plan 4 task 3 Verify requires 'a log read answers without path and with its lines', but the test asserts only the absence of path, so a log read refused with {detail, code} would also pass it
severity: minor
cause: tests/api/test_api_health.py:104-122 ends in assert "path" not in body only; PLAN-4 task 3 Verify (line 57) requires the read to answer with its lines, so a refused /api/log ({detail, code}) also passes
fix: f8106d22, retest

## Summary

total: 9
passed: 9
failed: 0
pending: 0
skipped: 0
blocked: 0
reworked: 4
