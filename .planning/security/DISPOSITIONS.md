# Dispositions

Each finding of `.planning/security/REPORT.md` has one entry: its disposition, then the commits that fixed it with the test that proves it, or the owner's ruling quoted verbatim.

### F-001 · No authentication on any API route, and the routes use HQPTuner's stored daemon credential

- Disposition: Fixed
- Commits: `dcc76891` (the login route), `a666a057` (the gate on every `/api` route but health and login)
- Proof: `tests/api/login/test_login_gate.py::test_every_api_route_but_health_and_login_refuses_a_caller_with_no_login`, `tests/api/login/test_login_route.py::test_a_wrong_pair_is_refused_and_sets_no_cookie`

### F-002 · Any website can POST a restore archive or stop the engine through a visitor's browser

- Disposition: Fixed
- Commits: `dcc76891` (the login cookie other sites cannot send), `a666a057` (the gate), `f15feb97` (a cross-site state-changing request is refused with 403)
- Proof: `tests/api/login/test_login_route.py::test_a_correct_pair_sets_a_cookie_scripts_cannot_read_and_other_sites_cannot_send`, `tests/api/surface/test_cross_site_refused.py::test_a_logged_in_write_sent_from_another_site_is_refused`

### F-003 · No Host validation, so DNS rebinding gives a website same-origin read and write on the API

- Disposition: Fixed, by the login with no loopback exemption and no Host allowlist
- Commits: `a666a057` (the gate)
- Proof: `tests/api/login/test_login_gate.py::test_a_caller_on_the_loopback_address_is_refused_like_any_other`

### F-008 · /api/state-export and /api/backup hand out configs, backups and logs with no gate

- Disposition: Fixed
- Commits: `a666a057` (both routes sit behind the login), `6f040843` (the export never ships a `connection.json` or login secret found in a directory it copies)
- Proof: `tests/api/login/test_login_gate.py::test_every_api_route_but_health_and_login_refuses_a_caller_with_no_login`, `tests/presets/test_state_export.py::test_a_connection_record_found_in_a_store_directory_ships_no_password`, `tests/presets/test_state_export.py::test_a_login_secret_found_in_a_store_directory_ships_nowhere`

### F-009 · The README says the desktop apps are reachable from that machine only, but they bind all interfaces

- Disposition: Fixed, with the `HKCU\Environment` write left in place
- Commits: `fc9803f5` and `307c3e41` (README corrections), `dcc76891` and `a666a057` (the login)
- Proof: `tests/api/login/test_login_gate.py::test_every_api_route_but_health_and_login_refuses_a_caller_with_no_login`

### F-024 · The management password crosses the LAN in cleartext between browser and HQPTuner

- Disposition: Declined
- Owner ruling: "asinine"

### F-025 · Licensee name, license fingerprint, playback metadata and the daemon log are served to anyone

- Disposition: Fixed
- Commits: `2b163fd3` (`/api/health` license), `e046dafa` (`/api/status` metadata), `2e9fd4bd` (`/api/log` path)
- Proof: `tests/api/test_api_health.py::test_health_license_carries_no_licensee_name`, `tests/api/test_api_health.py::test_health_license_carries_no_fingerprint`, `tests/api/test_api_health.py::test_status_metadata_leaves_out_an_attribute_the_page_does_not_read`, `tests/api/test_api_health.py::test_log_tail_carries_no_log_file_path`

### F-027 · No browser security headers, one-click engine actions in a frameable page, and API docs that load CDN scripts

- Disposition: Fixed
- Commits: `dfd5eb54` (frame, sniffing and content policy headers), `c4967603` (the docs routes are off in every build)
- Proof: `tests/api/surface/test_page_headers.py::test_the_mount_forbids_framing`, `tests/api/surface/test_docs_routes_off.py::test_the_framework_documentation_routes_answer_not_found`

### F-028 · The single-instance probe trusts any local process that answers with app_version

- Disposition: Declined
- Owner ruling: "why the fuck would it ever do that"
- Reason: exploiting it requires code already running on the machine
