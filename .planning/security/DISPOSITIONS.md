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

### F-004 · POST /api/connection sends a Digest response for the stored password to any host a caller names

- Disposition: Fixed, with the residual the owner accepted in D-01
- Commits: `e2433432` (a Connection save that changes the host is refused unless the request carries both the username and the password, and sends nothing to the new host)
- Proof: `tests/api/surface/test_connection_host_rule.py::test_a_save_changing_the_host_without_both_credentials_is_refused_and_sends_nothing`
- Residual accepted by the owner: "a caller who can reach the app before login can still retarget it to a server they control, so the owner re-enters the real host and pair, and can still learn through the login whether another host answers; no stored credential leaves either way."

### F-005 · An unvalidated connection host lets a caller read HTTP services HQPTuner can reach

- Disposition: Fixed, with the residual the owner accepted in D-01
- Commits: `e3f609bf` (one validator decides whether a string is a daemon host), `1282d44f` (the Connection save and the login refuse an invalid host and save nothing), `a9c84d22` (every 8088 URL brackets an IPv6 host), `de918df3` (a refused save or login shows the backend's sentence), `1382ae4d` (the daemon link brackets an IPv6 host)
- Proof: `tests/engine/http/test_host_address.py::test_a_string_that_is_no_host_is_refused`, `tests/api/surface/test_connection_host_rule.py::test_a_save_naming_an_invalid_host_is_refused_and_writes_nothing`, `tests/api/login/test_login_host.py::test_a_login_naming_an_invalid_host_is_refused_with_no_cookie_no_record_and_no_request`, `tests/engine/http/test_ipv6_urls.py::test_the_config_client_brackets_an_ipv6_host`, `tests/js/store/setup-verdict.test.js` test `test_a_refused_save_carries_the_backends_sentence_unchanged`, `tests/js/components/chrome/setup.test.js` test `test_the_daemon_link_for_an_IPv6_host_field_is_the_url_the_browser_follows`
- Residual accepted by the owner: "a caller who can reach the app before login can still retarget it to a server they control, so the owner re-enters the real host and pair, and can still learn through the login whether another host answers; no stored credential leaves either way."

### F-008 · /api/state-export and /api/backup hand out configs, backups and logs with no gate

- Disposition: Fixed
- Commits: `a666a057` (both routes sit behind the login), `6f040843` (the export never ships a `connection.json` or login secret found in a directory it copies)
- Proof: `tests/api/login/test_login_gate.py::test_every_api_route_but_health_and_login_refuses_a_caller_with_no_login`, `tests/presets/test_state_export.py::test_a_connection_record_found_in_a_store_directory_ships_no_password`, `tests/presets/test_state_export.py::test_a_login_secret_found_in_a_store_directory_ships_nowhere`

### F-009 · The README says the desktop apps are reachable from that machine only, but they bind all interfaces

- Disposition: Fixed, with the `HKCU\Environment` write left in place
- Commits: `fc9803f5` and `307c3e41` (README corrections), `dcc76891` and `a666a057` (the login)
- Proof: `tests/api/login/test_login_gate.py::test_every_api_route_but_health_and_login_refuses_a_caller_with_no_login`

### F-015 · One POST with a malformed host stops HQPTuner at every later start

- Disposition: Fixed
- Commits: `1282d44f` (a malformed host is refused at the save and saved nowhere), `8f108525` (a saved host the validator refuses reads as a corrupt record, so the app starts and the Connection panel opens), `31a88dcc` (a corrupt or invalid record counts as a chosen host)
- Proof: `tests/api/surface/test_startup_bad_host.py::test_a_start_over_a_record_naming_an_invalid_host_serves_the_health_read`, `tests/api/surface/test_startup_bad_host.py::test_the_login_after_such_a_start_succeeds`, `tests/api/surface/test_connection_host_rule.py::test_a_save_naming_an_invalid_host_is_refused_and_writes_nothing`

### F-017 · 8088 responses have no size or total-time limit, and each connection save keeps an old client until shutdown

- Disposition: Fixed
- Commits: `52689703` (an 8088 exchange ends at a total deadline on the app's clock), `0f6745f2` (an 8088 reply is read up to a ceiling set for its path), `f3a4d5f3` (the log and release readers carry a ceiling and the total deadline), `8e352b34` (the login's pair check carries both), `e2ae85d3` (a replaced 8088 client is closed once nothing holds it), `87e616ce` (a Control API document has a total deadline), `5b73a1e3` (the Control API scan does work per chunk, not per buffer; a performance change that adds no failing test, its characterization cases hold the behavior)
- Proof: `tests/engine/http/test_http_deadline.py::test_a_config_read_still_dripping_past_the_total_deadline_is_given_up_on`, `tests/engine/http/test_http_ceiling.py::test_a_config_body_one_byte_over_its_ceiling_is_refused`, `tests/engine/http/test_http_ceiling.py::test_a_settings_backup_over_its_ceiling_is_refused`, `tests/engine/http/test_ungated_reader_bounds.py::test_a_log_over_its_ceiling_is_refused`, `tests/api/login/test_login_pair_check.py::test_an_accepted_pair_whose_page_is_over_the_ceiling_does_not_answer`, `tests/engine/http/test_retired_client_closed.py::test_a_client_replaced_while_idle_is_closed_at_once_and_the_one_in_service_is_not`, `tests/engine/test_control_stall.py::test_a_document_still_dripping_past_the_total_deadline_is_given_up_on`
- Note: against the code before `52689703`, `0f6745f2`, `f3a4d5f3` and `8e352b34` their proofs fail at collection, since each imports a constant the fix adds; the assertion-level bite by mutation is in `.planning/phases/6/reports/plan-4.md`.

### F-020 · Discovery trusts spoofed UDP replies and parses them with the stdlib XML parser on the event loop

- Disposition: Fixed
- Commits: `1342e893` (a reply is parsed with defusedxml, and an entity declaration or an unknown encoding is a datagram that is not a reply), `eb260c54` (one sweep keeps and dials at most 32 replies and 64 KiB, and yields on every pass)
- Proof: `tests/engine/test_discovery.py::test_a_non_reply_datagram_raises_notareply`, `tests/engine/test_discovery.py::test_a_sweep_against_a_flood_of_senders_keeps_and_dials_at_most_the_reply_cap`, `tests/engine/test_discovery.py::test_a_sweep_waits_on_the_sleep_it_was_handed_once_per_datagram_it_reads`, `tests/engine/test_discovery.py::test_a_sweep_against_large_replies_stops_at_the_byte_cap`

### F-021 · A LAN discovery impostor can fill the host field, then receive the stored password's Digest response and supply a phishing link

- Disposition: Declined
- Owner ruling: "discovery filling the host field is not a credential leak, because nothing connects until the user presses Save or logs in, with the filled host on screen."
- Reason: the fill stays as it is, and `tests/js/store/setup.test.js` test `test_discovery_fills_a_host_field_the_user_has_not_touched` still pins it. The other half of the remediation, the password again when the host changes, is F-004's fix.

### F-022 · Startup adopts whoever answers host.docker.internal on an unconfigured install

- Disposition: Fixed, with the owner's ruling that inside the image an answering alias is still adopted at startup
- Commits: `ffad0a0b` (the image carries a marker and only a marked start probes the alias), `f10726bc` (the discovery fallback asks the alias only in the image), `31a88dcc` (a corrupt or invalid record counts as a chosen host, so it starts no probe), `d4a7bd2e` and `ca7d073b` (code comments, README and changelog say the alias is Docker only)
- Proof: `tests/api/test_discovery_route.py::test_a_zero_search_window_serves_the_daemon_the_host_alias_names_only_in_the_image`, `tests/api/surface/test_alias_marker.py::test_a_start_dials_the_alias_only_in_the_image`, `tests/api/surface/test_startup_bad_host.py::test_a_start_asks_the_container_alias_only_where_no_record_was_chosen`
- Owner ruling: "inside the image an answering alias is still adopted at startup as today; no offer"
- Note: `test_a_start_dials_the_alias_only_in_the_image` fails against the code before `ffad0a0b` as a `TypeError`, since the marker is a new field.

### F-023 · connection.json holds the password in plaintext with the default file mode

- Disposition: Fixed, with the password still stored unencrypted
- Commits: `23dcb192` (the file is created with mode 0600, also over a leftover temp file with a wider mode), `0bbc6dc4` (the panel says the stored password is plain text), `e9bc93e8` and `48bb275c` (a Connection save follows the login's pin rule, and the file never receives a value the environment pins or a password the request did not carry)
- Proof: `tests/api/login/test_connection_file_mode.py::test_a_written_record_is_owner_only`, `tests/api/login/test_connection_file_mode.py::test_a_leftover_temp_file_with_a_wider_mode_does_not_pass_it_to_the_record`, `tests/api/surface/test_connection_host_rule.py::test_a_remembering_save_over_a_pinned_password_leaves_it_out_of_the_file`, `tests/js/components/chrome/setup.test.js` test `test_the_remember_choice_carries_a_caption`
- Scope of the protection: mode 0600 protects the file on POSIX. On Windows `os.open`'s mode sets only the read-only bit, so the protection there is the per-user data directory's ACL and no more.

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
