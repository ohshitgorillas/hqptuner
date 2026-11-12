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

### F-006 · Staged config values reach hqplayerd.xml unescaped, so a client can add elements the allowlist never named

- Disposition: Fixed
- Commits: `2665a322` (an attribute value is escaped on write and unescaped on read), `87f967e0` (the fixed-volume line escapes its level), `5721909e` (one decision says whether a staged value is among its page's choices), `60611f4f` (the stage route refuses a value its page does not offer), `8eb3e576` (the LIVE route refuses one too, held fields included), `35c6a137` (a staged value with a control character is refused), `1c9453b2` (a value holding a surrogate or U+FFFE/U+FFFF is refused)
- Proof: `tests/engine/http/test_xml_escaping.py::test_a_title_that_closes_the_attribute_adds_no_element`, `tests/engine/http/test_xml_escaping.py::test_a_parked_fixed_level_holding_a_double_hyphen_is_well_formed_xml`, `tests/engine/http/test_page_choices.py::test_a_value_the_page_does_not_offer_is_refused`, `tests/api/surface/test_staged_choices.py::test_a_flag_spelled_on_is_refused_at_stage`, `tests/api/surface/test_staged_choices.py::test_a_held_value_the_page_does_not_offer_is_refused_at_live`, `tests/api/surface/test_staged_control_chars.py::test_a_text_value_with_a_control_character_is_refused`, `tests/api/surface/test_staged_control_chars.py::test_a_text_value_with_a_character_xml_excludes_is_refused`
- Note: `5721909e` is a new decision function; against the code before it, its proof `test_a_value_the_page_does_not_offer_is_refused` fails at collection, since it imports the function the fix adds, and the null stub fails nine cases.

### F-007 · POST /api/restore passes any archive to the daemon with no member filter and no safety copy

- Disposition: Fixed by the member-name rule and the ceilings; the safety copy declined
- Commits: `9803eddd` (an oversized restore upload is refused before it is read), `56b41122` (an archive's declared member sizes are checked before any member is read), `ddc4bbde` (an archive member name outside the observed set is refused)
- Proof: `tests/api/surface/test_restore_members.py::test_an_archive_with_a_member_name_outside_the_backup_shape_is_refused`, `tests/api/surface/test_restore_members.py::test_a_refused_member_name_sends_the_daemon_no_restore_beside_one_that_is_sent`, `tests/api/surface/test_restore_limits.py::test_an_upload_one_byte_over_the_ceiling_is_refused`, `tests/api/surface/test_restore_limits.py::test_an_archive_declaring_more_than_its_ceilings_is_refused`
- Owner ruling: "smells like scope expansion" (on a safety copy taken before an uploaded restore)
- Reason: no safety copy is taken before an uploaded restore; the member-name rule and the ceilings fix the rest of the finding.

### F-008 · /api/state-export and /api/backup hand out configs, backups and logs with no gate

- Disposition: Fixed
- Commits: `a666a057` (both routes sit behind the login), `6f040843` (the export never ships a `connection.json` or login secret found in a directory it copies)
- Proof: `tests/api/login/test_login_gate.py::test_every_api_route_but_health_and_login_refuses_a_caller_with_no_login`, `tests/presets/test_state_export.py::test_a_connection_record_found_in_a_store_directory_ships_no_password`, `tests/presets/test_state_export.py::test_a_login_secret_found_in_a_store_directory_ships_nowhere`

### F-009 · The README says the desktop apps are reachable from that machine only, but they bind all interfaces

- Disposition: Fixed, with the `HKCU\Environment` write left in place
- Commits: `fc9803f5` and `307c3e41` (README corrections), `dcc76891` and `a666a057` (the login)
- Proof: `tests/api/login/test_login_gate.py::test_every_api_route_but_health_and_login_refuses_a_caller_with_no_login`

### F-010 · Control API commands are built by string interpolation, and three client routes feed raw strings into them

- Disposition: Fixed
- Commits: `c8de972d` (a Control API attribute value containing a double quote is refused before any byte is written), `0129d2f7` (POST /api/volume refuses a level that is not a number), `00869dfd` (a profile switch names only a profile the daemon lists)
- Proof: `tests/engine/http/test_control_attr_quote.py::test_a_value_that_closes_the_attribute_is_refused_as_invalid_input`, `tests/engine/http/test_control_attr_quote.py::test_a_value_that_closes_the_attribute_leaves_the_next_command_the_only_one_written`, `tests/api/surface/test_volume_level.py::test_a_level_that_is_not_a_number_is_refused_as_invalid_input`, `tests/matrix/test_profile_switch_known.py::test_a_profile_the_daemon_does_not_list_is_refused_as_invalid_input`
- Note: in `0129d2f7` the `-3"/><Stop/` case was already green, since `c8de972d` refuses a double quote; the `abc` case is the one that fails against the code before it.

### F-011 · Log path and pipeline process strings let a client name any path on the daemon's host

- Disposition: Declined
- Owner ruling: "declined, confirmed by the owner in the D-01 to D-16 lock: the log path and pipeline process strings are fields on the daemon's own 8088 pages, every caller holds the management pair since phase 4 D-01, and refusing absolute paths would break the daemon's own `impulse_N-N.wav` paths and parked filters." (phase 8 D-05, as CONTEXT records it)
- Reason: the strings stay as they are; the staged values that reach the file are escaped and checked against the page's choices under F-006.

### F-012 · Parked filter uploads silently replace daemon files and ride the next apply

- Disposition: Declined
- Owner ruling: "why the fuck do you want to refuse valid user actions? flagrant rule violation"
- Reason: re-uploading a filter under an existing name keeps replacing it (phase 8 D-03).

### F-013 · A value the repository documents as fatal can be staged with no check, and the UI then blames the credentials

- Disposition: Fixed
- Commits: `5721909e` (one decision says whether a staged value is among its page's choices), `60611f4f` (the stage route refuses a value its page does not offer), `f1bcc93c` (a 401 after a normal answer in the same apply is an engine fault, not refused credentials)
- Proof: `tests/api/surface/test_staged_choices.py::test_a_flag_spelled_on_is_refused_at_stage`, `tests/api/surface/test_staged_choices.py::test_an_apply_after_a_refused_value_sends_no_restore`, `tests/engine/http/test_engine_fault_after_answer.py::test_a_401_after_a_restore_answered_is_an_engine_fault`, `tests/engine/http/test_engine_fault_after_answer.py::test_a_401_after_a_restore_answered_leaves_the_credentials_accepted`

### F-014 · An unknown matrix profile name puts the engine in a restart loop

- Disposition: Fixed
- Commits: `00869dfd` (a profile switch names only a profile the daemon lists)
- Proof: `tests/matrix/test_profile_switch_known.py::test_a_profile_the_daemon_does_not_list_is_refused_as_invalid_input`, `tests/matrix/test_profile_switch_known.py::test_a_profile_the_daemon_does_not_list_sends_no_switch_command`

### F-015 · One POST with a malformed host stops HQPTuner at every later start

- Disposition: Fixed
- Commits: `1282d44f` (a malformed host is refused at the save and saved nowhere), `8f108525` (a saved host the validator refuses reads as a corrupt record, so the app starts and the Connection panel opens), `31a88dcc` (a corrupt or invalid record counts as a chosen host)
- Proof: `tests/api/surface/test_startup_bad_host.py::test_a_start_over_a_record_naming_an_invalid_host_serves_the_health_read`, `tests/api/surface/test_startup_bad_host.py::test_the_login_after_such_a_start_succeeds`, `tests/api/surface/test_connection_host_rule.py::test_a_save_naming_an_invalid_host_is_refused_and_writes_nothing`

### F-016 · /api/restore reads the whole upload and decompresses members with no ceiling

- Disposition: Fixed
- Commits: `9803eddd` (an oversized restore upload is refused before it is read), `56b41122` (an archive's declared member sizes are checked before any member is read), `762e8034` (the first-connect archive read carries the same ceilings)
- Proof: `tests/api/surface/test_restore_limits.py::test_an_upload_one_byte_over_the_ceiling_is_refused`, `tests/api/surface/test_restore_limits.py::test_an_archive_declaring_more_than_its_ceilings_is_refused`, `tests/api/surface/test_restore_limits.py::test_an_archive_with_a_corrupt_member_is_refused_with_a_client_error`, `tests/engine/http/test_snapshot_member_ceiling.py::test_a_member_declaring_more_than_the_ceiling_is_refused_unread`, `tests/engine/http/test_snapshot_member_ceiling.py::test_a_connect_over_an_archive_with_a_corrupt_member_stands`

### F-017 · 8088 responses have no size or total-time limit, and each connection save keeps an old client until shutdown

- Disposition: Fixed
- Commits: `52689703` (an 8088 exchange ends at a total deadline on the app's clock), `0f6745f2` (an 8088 reply is read up to a ceiling set for its path), `f3a4d5f3` (the log and release readers carry a ceiling and the total deadline), `8e352b34` (the login's pair check carries both), `e2ae85d3` (a replaced 8088 client is closed once nothing holds it), `87e616ce` (a Control API document has a total deadline), `5b73a1e3` (the Control API scan does work per chunk, not per buffer; a performance change that adds no failing test, its characterization cases hold the behavior)
- Proof: `tests/engine/http/test_http_deadline.py::test_a_config_read_still_dripping_past_the_total_deadline_is_given_up_on`, `tests/engine/http/test_http_ceiling.py::test_a_config_body_one_byte_over_its_ceiling_is_refused`, `tests/engine/http/test_http_ceiling.py::test_a_settings_backup_over_its_ceiling_is_refused`, `tests/engine/http/test_ungated_reader_bounds.py::test_a_log_over_its_ceiling_is_refused`, `tests/api/login/test_login_pair_check.py::test_an_accepted_pair_whose_page_is_over_the_ceiling_does_not_answer`, `tests/engine/http/test_retired_client_closed.py::test_a_client_replaced_while_idle_is_closed_at_once_and_the_one_in_service_is_not`, `tests/engine/test_control_stall.py::test_a_document_still_dripping_past_the_total_deadline_is_given_up_on`
- Note: against the code before `52689703`, `0f6745f2`, `f3a4d5f3` and `8e352b34` their proofs fail at collection, since each imports a constant the fix adds; the assertion-level bite by mutation is in `.planning/phases/6/reports/plan-4.md`.

### F-018 · Several routes do unbounded or event-loop-blocking work per request

- Disposition: Fixed by bounds; moving the bounded archive and XML work onto threads declined
- Commits: `6feb6195` (staged values carry a length and a key-count ceiling), `9803eddd` (an oversized restore upload is refused before it is read), `56b41122` (an archive's declared member sizes are checked before any member is read), `6419c0dc` (`/api/audit` answers at most its cap)
- Proof: `tests/api/surface/test_stage_ceiling.py::test_a_one_mebibyte_value_is_refused_at_stage`, `tests/api/surface/test_stage_ceiling.py::test_ten_thousand_field_names_are_refused_at_stage`, `tests/audit/test_audit_limit_cap.py::test_a_limit_far_above_the_cap_answers_exactly_the_cap`, `tests/api/surface/test_restore_limits.py::test_an_upload_one_byte_over_the_ceiling_is_refused`
- Owner ruling: "Moving the remaining bounded archive and XML work onto threads is declined, confirmed by the owner in the lock, because what it stalls is now bounded and brief; the discovery item was closed under F-020." (phase 8 D-06, as CONTEXT records it). This covers the finding's `/api/matrix/filter` RIFF chunk walk and `/api/backup` recompression clauses.
- Owner ruling: "Q3: decline the state-export clause; no task is added." (on the finding's `/api/state-export` clause, which reads all stores into memory per request)
- Reason: every store `/api/state-export` reads is bounded or user-owned, since favorites, descriptions and the filter park carry ceilings, presets and live snapshots grow only by the user's own saves, and the log lines are capped at 2000; access to the route is F-008's.
- Clauses: staging, fixed by `6feb6195`; state-export, ruled above; audit, fixed by `6419c0dc`; filter walk and `/api/backup` recompression, ruled above, bounded by the upload and archive ceilings of `9803eddd` and `56b41122`; discovery, closed under F-020; favorites, descriptions, the filter park and the inert `/api/meter/feed`, already bounded or inert as the finding itself says.

### F-019 · Whitespace in staged values makes profile and pipeline regexes quadratic on the event loop

- Disposition: Fixed
- Commits: `135c4c1d` (the five whitespace-leading patterns start on a literal), `6feb6195` (staged values carry a length and a key-count ceiling)
- Proof: `tests/api/surface/test_stage_ceiling.py::test_a_one_mebibyte_value_is_refused_at_stage`, `tests/api/surface/test_stage_ceiling.py::test_a_one_mebibyte_live_value_is_refused`
- Note: the anchoring of `135c4c1d` is a performance change held by characterization, which adds no failing test: `tests/matrix/test_anchored_patterns.py` pins the behavior before and after (D-09). The ceiling of `6feb6195` is the proof that fails against the code before the fix.

### F-020 · Discovery trusts spoofed UDP replies and parses them with the stdlib XML parser on the event loop

- Disposition: Fixed
- Commits: `1342e893` (a reply is parsed with defusedxml, and an entity declaration or an unknown encoding is a datagram that is not a reply), `eb260c54` (one sweep keeps and dials at most 32 replies and 64 KiB, and yields on every pass), `a87efb10` (a datagram declaring an encoding the parser refuses, such as shift_jis or idna, is not a reply)
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

### F-026 · Preset names on the Windows build can leave the store or hit NTFS streams and device names

- Disposition: Fixed
- Commits: `fb93582b` (the Windows build refuses a colon or a device name in a stored name), `02d09c02` (a preset path stays inside its store)
- Proof: `tests/api/surface/test_preset_name_reach.py::test_the_windows_build_refuses_a_colon_or_a_device_name`, `tests/api/surface/test_preset_name_reach.py::test_a_windows_store_refuses_to_save_a_new_colon_name`, `tests/api/surface/test_preset_name_reach.py::test_reading_a_preset_that_links_outside_the_store_is_refused`, `tests/api/surface/test_preset_name_reach.py::test_saving_over_a_preset_that_links_outside_the_store_leaves_the_outside_file_alone`
- Note: the Windows refusal is a new surface held by a static discharge; a null stub that ignores the platform fails every `win32` refusal case. The two outside-the-store cases fail against the code before `02d09c02` (`DID NOT RAISE`, and the outside bytes changed).

### F-027 · No browser security headers, one-click engine actions in a frameable page, and API docs that load CDN scripts

- Disposition: Fixed
- Commits: `dfd5eb54` (frame, sniffing and content policy headers), `c4967603` (the docs routes are off in every build)
- Proof: `tests/api/surface/test_page_headers.py::test_the_mount_forbids_framing`, `tests/api/surface/test_docs_routes_off.py::test_the_framework_documentation_routes_answer_not_found`

### F-028 · The single-instance probe trusts any local process that answers with app_version

- Disposition: Declined
- Owner ruling: "why the fuck would it ever do that"
- Reason: exploiting it requires code already running on the machine

### F-032 · Descriptions merged from an uploaded archive skip the write route's limits

- Disposition: Fixed
- Commits: `05d1fdf6` (description entries an archive carries meet the PUT limits)
- Proof: `tests/api/surface/test_restore_descriptions.py::test_a_carried_entry_past_the_put_limits_is_dropped`, `tests/api/surface/test_restore_descriptions.py::test_the_valid_entry_beside_dropped_ones_merges`

### F-033 · A rogue daemon's strings can stall the SPA or, with some settings on, crash its render

- Disposition: Fixed for the own-key lookups; the regex rewrite and the error boundary declined
- Commits: `00e726e1` (the SPA's option lookups read own keys only)
- Proof: `tests/js/store/narrow/inherited-labels.test.js` tests `test_decorate_options_over_an_inherited_label_returns_without_throwing`, `test_narrowing_keeps_an_option_whose_label_is_inherited`
- Owner ruling: "the regex clause (no stall reproduced in V8) and the error-boundary clause (would need fallback copy) are declined, confirmed by the owner in the lock." (phase 8 D-07, as CONTEXT records it)
