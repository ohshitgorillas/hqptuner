---
status: testing
phase: 6
fields_version: 1
started: 2026-11-09
updated: 2026-11-09
---

## Items

### 1. Clean start from a fresh image
expected: The image builds and starts from clean state, /api/health answers 200 (ci: smoke)
origin: smoke
status: pending_ci
job: smoke
commit: 25adaa78d92c5e1709235d8d26d6c8a210e1ece7
source: model
evidence: smoke builds the image and starts it from clean state in CI; no image build or container start from this checkout (CLAUDE.local.md: no container here)

### 2. A login or save to a new host never carries the stored pair
expected: A login naming a new host sends that host only the typed pair and, when accepted, replaces the saved record with that host and pair; a Connection save changing the host without both username and password answers "HQPTuner requires a new username and password when switching host addresses for security; please re-enter your credentials.", saves nothing and sends no request to the new host
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: Save refusal tested in test_connection_host_rule.py (4 incomplete-credential cases, 0 requests to the new host). Login-to-new-host spot-check: every Digest at 127.0.0.1 was built from the typed newpw and none from the stored pw, and the record was replaced with {127.0.0.2, newu, newpw}.

### 3. Invalid hosts are refused, IPv6 is bracketed
expected: Hosts a:b, target:9000/path?x= and fe80::1%eth0 are refused at the Connection save and at login with nothing saved; ::1 is accepted and the 8088 lane requests http://[::1]:8088/...
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: check_host and url_host in conf/httpauth.py. test_host_address.py 24, test_ipv6_urls.py 4, test_login_host.py 3, and the host-rule save cases all pass.

### 4. A bad saved host does not stop the start
expected: With connection.json holding host a:b at start, the app starts, /api/health answers 200, and the SPA shows the Connection panel
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: ConnectionStore.read validates the host and raises StoreCorruptError. test_startup_bad_host.py 6 passed (health 200, login 200, file kept). The panel opens through setup.test.js test_a_request_refused_for_want_of_a_login_opens_the_panel.

### 5. The container alias is probed only in the image
expected: Without the image marker, a start with no saved host and an empty /api/discover sweep send no request to host.docker.internal; with the marker and no saved host, a start still adopts an answering alias (owner ruling 2026-11-08 overruling the offer half of D-04)
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: Dockerfile HQPTUNER_IN_IMAGE=1. _adopt_alias and the discover route are gated on cfg.in_image. test_alias_marker.py, test_discovery_route.py (outside-the-image answers []) and the in-image adoption tests pass.

### 6. 8088 and Control API reads are bounded and replaced clients close
expected: An 8088 response larger than its path's ceiling is refused; an 8088 or 4321 response still dripping past its total deadline on the test clock is abandoned; after a Connection save the replaced 8088 client is closed once its in-flight requests finish
criterion: AC5
status: pass
first_pass: pass
source: verifier
evidence: test_http_ceiling.py 8, test_http_deadline.py 5, test_ungated_reader_bounds.py 6, test_login_pair_check.py 7, test_retired_client_closed.py 5 and test_control_stall.py 13 all pass. holding_http is wired in api/deps and ConnectionManager.run.

### 7. Discovery rejects entities and caps replies
expected: A discovery reply carrying an XML entity declaration is rejected, and one sweep keeps and dials at most the reply cap however many senders answer
criterion: AC6
status: pass
first_pass: pass
source: verifier
evidence: defusedxml parse plus MAX_REPLIES/MAX_BYTES in engine/discovery.py. test_discovery.py 20 passed, including the entity case and flood/byte-cap/yield cases.

### 8. Dispositions record all eight findings
expected: .planning/security/DISPOSITIONS.md lists F-004, F-005, F-015, F-017, F-020, F-021, F-022 and F-023, each naming its fixing commit and a proof test that fails against the pre-fix code
criterion: AC7
status: pass
first_pass: pass
source: verifier
evidence: DISPOSITIONS.md:23-87 has all eight entries. 26 commits resolve as HEAD ancestors. 66 proof nodes collect with no error. The JS proof titles exist and pass. F-021 carries the owner ruling, and F-004/F-005 carry the D-01 residual.

### 9. Required CI jobs pass on the phase's last dev commit
expected: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos and smoke-windows pass on the phase's last dev commit (ci: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows)
criterion: AC7
status: pending_ci
job: check,e2e,smoke,lifecycle-deb,lifecycle-rpm,smoke-macos,smoke-windows
commit: 25adaa78d92c5e1709235d8d26d6c8a210e1ece7
source: model
evidence: required CI jobs run only on GitHub; local make check is green at this commit (2934 pytest passed, 4898 JS pass), which settles nothing for the CI jobs

### 10. connection.json is created owner-only
expected: ConnectionStore.write creates connection.json with mode 0600 on POSIX, also when a wider-mode temp file was left over
status: pass
first_pass: pass
source: verifier
evidence: os.open(..., 0o600) with an O_EXCL create after unlinking the leftover. test_connection_file_mode.py 2 passed under umask 022.

### 11. The Connection panel says the stored password is plain text
expected: The Connection panel shows the owner-approved note that the stored password is unencrypted, and a refused save or login shows the backend's refusal sentence
status: pass
first_pass: pass
source: verifier
evidence: Setup.js data-testid setup-remember-note caption. SAVE_VERDICTS/LOGIN_VERDICTS show the backend's sentence. setup-verdict.test.js 30/30 and chrome/setup.test.js 17/17 pass.

## Summary

total: 11
passed: 9
failed: 0
pending: 0
pending_ci: 2
skipped: 0
blocked: 0
reworked: 0
