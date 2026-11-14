# Dispositions

Each finding of `.planning/security/REPORT.md` has one entry: its disposition, then the commits that fixed it with the test that proves it, or the owner's decision quoted verbatim.

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
- Owner decision: "smells like scope expansion" (on a safety copy taken before an uploaded restore)
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
- Owner decision: "declined, confirmed by the owner in the D-01 to D-16 lock: the log path and pipeline process strings are fields on the daemon's own 8088 pages, every caller holds the management pair since phase 4 D-01, and refusing absolute paths would break the daemon's own `impulse_N-N.wav` paths and parked filters." (phase 8 D-05, as CONTEXT records it)
- Reason: the strings stay as they are; the staged values that reach the file are escaped and checked against the page's choices under F-006.

### F-012 · Parked filter uploads silently replace daemon files and ride the next apply

- Disposition: Declined
- Owner decision: "why the fuck do you want to refuse valid user actions? flagrant rule violation"
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
- Owner decision: "Moving the remaining bounded archive and XML work onto threads is declined, confirmed by the owner in the lock, because what it stalls is now bounded and brief; the discovery item was closed under F-020." (phase 8 D-06, as CONTEXT records it). This covers the finding's `/api/matrix/filter` RIFF chunk walk and `/api/backup` recompression clauses.
- Owner decision: "Q3: decline the state-export clause; no task is added." (on the finding's `/api/state-export` clause, which reads all stores into memory per request)
- Reason: every store `/api/state-export` reads is bounded or user-owned, since favorites, descriptions and the filter park carry ceilings, presets and live snapshots grow only by the user's own saves, and the log lines are capped at 2000; access to the route is F-008's.
- Clauses: staging, fixed by `6feb6195`; state-export, decided above; audit, fixed by `6419c0dc`; filter walk and `/api/backup` recompression, decided above, bounded by the upload and archive ceilings of `9803eddd` and `56b41122`; discovery, closed under F-020; favorites, descriptions, the filter park and the inert `/api/meter/feed`, already bounded or inert as the finding itself says.

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
- Owner decision: "discovery filling the host field is not a credential leak, because nothing connects until the user presses Save or logs in, with the filled host on screen."
- Reason: the fill stays as it is, and `tests/js/store/setup.test.js` test `test_discovery_fills_a_host_field_the_user_has_not_touched` still pins it. The other half of the remediation, the password again when the host changes, is F-004's fix.

### F-022 · Startup adopts whoever answers host.docker.internal on an unconfigured install

- Disposition: Fixed, with the owner's decision that inside the image an answering alias is still adopted at startup
- Commits: `ffad0a0b` (the image carries a marker and only a marked start probes the alias), `f10726bc` (the discovery fallback asks the alias only in the image), `31a88dcc` (a corrupt or invalid record counts as a chosen host, so it starts no probe), `d4a7bd2e` and `ca7d073b` (code comments, README and changelog say the alias is Docker only)
- Proof: `tests/api/test_discovery_route.py::test_a_zero_search_window_serves_the_daemon_the_host_alias_names_only_in_the_image`, `tests/api/surface/test_alias_marker.py::test_a_start_dials_the_alias_only_in_the_image`, `tests/api/surface/test_startup_bad_host.py::test_a_start_asks_the_container_alias_only_where_no_record_was_chosen`
- Owner decision: "inside the image an answering alias is still adopted at startup as today; no offer"
- Note: `test_a_start_dials_the_alias_only_in_the_image` fails against the code before `ffad0a0b` as a `TypeError`, since the marker is a new field.

### F-023 · connection.json holds the password in plaintext with the default file mode

- Disposition: Fixed, with the password still stored unencrypted
- Commits: `23dcb192` (the file is created with mode 0600, also over a leftover temp file with a wider mode), `0bbc6dc4` (the panel says the stored password is plain text), `e9bc93e8` and `48bb275c` (a Connection save follows the login's pin rule, and the file never receives a value the environment pins or a password the request did not carry)
- Proof: `tests/api/login/test_connection_file_mode.py::test_a_written_record_is_owner_only`, `tests/api/login/test_connection_file_mode.py::test_a_leftover_temp_file_with_a_wider_mode_does_not_pass_it_to_the_record`, `tests/api/surface/test_connection_host_rule.py::test_a_remembering_save_over_a_pinned_password_leaves_it_out_of_the_file`, `tests/js/components/chrome/setup.test.js` test `test_the_remember_choice_carries_a_caption`
- Scope of the protection: mode 0600 protects the file on POSIX. On Windows `os.open`'s mode sets only the read-only bit, so the protection there is the per-user data directory's ACL and no more.

### F-024 · The management password crosses the LAN in cleartext between browser and HQPTuner

- Disposition: Declined
- Owner decision: "asinine"

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
- Owner decision: "why the fuck would it ever do that"
- Reason: exploiting it requires code already running on the machine

### F-029 · Apply lanes aren't serialized, and the shared pending buffer is cleared blind

- Disposition: Fixed for the serialization and the blind clears; the shared buffer's "one client's field applies under another's press" clause declined
- Commits: `42807119` (the staged apply holds one queueing write lock), `8f4edaf8` (preset load and save, engine apply, uploaded restore and speaker apply queue behind the same lock), `382b2250` (an apply clears from the pending buffer only what it applied), `948dff3d` (the filter park releases only the uploads an apply carried)
- Proof: `tests/apply/overlap/test_apply_queue.py::test_a_second_apply_pushes_nothing_while_the_first_is_held_at_the_daemon`, `tests/apply/overlap/test_apply_queue.py::test_a_lane_sends_nothing_to_the_daemon_while_an_apply_is_held`, `tests/apply/overlap/test_apply_keeps_restaged.py::test_a_field_staged_during_the_apply_is_still_staged_after_it`, `tests/apply/overlap/test_apply_keeps_restaged.py::test_a_field_re_staged_during_the_apply_holds_its_new_value_after_it`, `tests/apply/overlap/test_apply_keeps_restaged.py::test_a_live_key_staged_during_the_apply_is_still_staged_after_it`, `tests/matrix/test_park_release.py::test_a_filter_uploaded_during_the_apply_is_still_parked_after_it`
- Owner decision: "Keep shared, decline clause"
- Reason: the pending buffer stays one app-wide object; a buffer per login session would break reload recovery and cross-tab staging, and needs a client identity the app lacks.
- Note: a request that arrives while the lock is held waits and then runs; no refusal was added. `test_a_second_apply_that_waited_answers_success` and `test_a_lane_that_waited_answers_success` guard that; they pass against the code before the lock, so they are not proofs of the fix.
- Residual, not fixed: preset and profile deletes run outside the write lock, so deleting the active preset while an apply's auto-save awaits the daemon's `/backup` brings the deleted preset back (`hqptuner/presets/presetlane.py:290-298`). The owner declined to file it.

### F-030 · The pre-apply safety copy is a single slot that later passes overwrite, and nothing rolls back

- Disposition: Fixed for the single slot, the per-pass overwrite and the unvalidated write; rollback declined
- Commits: `f63e2c9c` (bytes that are not a readable settings archive never replace a stored copy), `930890d7` (safety copies are dated and the five most recent are kept), `32bd0c24` (each staged apply writes one safety copy, before its first restore)
- Proof: `tests/presets/integrity/test_safety_copies.py::test_a_backup_that_is_no_archive_replaces_no_stored_copy`, `tests/presets/integrity/test_safety_copies.py::test_after_six_copies_the_five_most_recent_remain`, `tests/presets/integrity/test_safety_copies.py::test_two_copies_taken_at_the_same_instant_both_exist`, `tests/presets/integrity/test_safety_copies.py::test_the_later_of_two_copies_at_one_instant_survives_the_prune`, `tests/presets/integrity/test_safety_copies.py::test_an_apply_that_takes_two_restore_passes_leaves_one_new_copy`, `tests/presets/integrity/test_safety_copies.py::test_the_copy_an_apply_leaves_holds_the_state_before_its_first_restore`
- Owner decision: "No rollback, decline"
- Reason: an unconverged outcome returns its report and keeps the buffer for a retry, as before; an automatic rollback would be an unasked restart that races a queued apply.
- Note: operations that took no safety copy before (the uploaded restore, a standalone preset save, a speaker apply) still take none; the uploaded restore's safety copy is the one F-007 declined.

### F-031 · JSON and preset stores write in place, so a torn file can leave the app refusing a store

- Disposition: Fixed for the in-place writes and the interleaved writers; the clause "the API can't repair the store and it takes a disk edit" kept as it stands
- Commits: `833793ae` (one fsynced temp-and-rename write, adopted by the connection store), `3149609e` (the six JSON stores write through it), `b1a24b91` (the preset store writes its XML, `store.json` and `active.json` through it), `7ba25a4c` (the park and the safety copy write through it, and the park skips a leftover temp file), `51d22885` (each JSON store serializes its read-modify-write behind one lock), `21f1e1e2` (the preset store takes one lock for its directory), `1f8dcaae` (the park, the safety copy and the connection store each hold their own lock)
- Proof: `tests/test_atomic_write.py::test_a_write_killed_partway_leaves_the_previous_bytes`, `tests/test_atomic_write.py::test_a_refused_rename_leaves_no_temp_file`, `tests/presets/integrity/test_atomic_writes.py::test_a_write_killed_partway_leaves_the_store_reading_the_first_write`, `tests/presets/integrity/test_atomic_writes.py::test_a_preset_store_write_killed_partway_leaves_the_store_answering_the_first_write`, `tests/presets/integrity/test_atomic_writes.py::test_a_safety_copy_killed_partway_leaves_every_stored_copy_alone`, `tests/presets/integrity/test_atomic_writes.py::test_a_park_write_killed_partway_leaves_no_parked_file`, `tests/presets/integrity/test_atomic_writes.py::test_a_temp_file_left_in_the_park_is_not_a_parked_filter`, `tests/presets/integrity/test_store_locks.py::test_two_writes_to_one_json_store_both_land`, `tests/presets/integrity/test_store_locks.py::test_a_first_save_overlapping_an_autosave_toggle_leaves_autosave_on`, `tests/presets/integrity/test_store_locks.py::test_two_uploads_under_one_name_both_stay_parked`
- Owner decision: "already answered these"
- Reason: `read_stamped` keeps refusing an unparseable file with the existing `StoreCorruptError` copy, and writes keep reading first, so no API path overwrites a corrupt store.
- Note: `833793ae` adds the helper module, so its proofs fail at collection against the code before it; the rest fail by assertion against the code before their commits.
- Note: the lock in `NarrowingStore.write`, the safety-copy lock in `PresetOps` and the lock in `ConnectionStore.write` are held by the commits alone, with no behavioral test, because each write replaces the whole document and ends last-wins either way.

### F-032 · Descriptions merged from an uploaded archive skip the write route's limits

- Disposition: Fixed
- Commits: `05d1fdf6` (description entries an archive carries meet the PUT limits)
- Proof: `tests/api/surface/test_restore_descriptions.py::test_a_carried_entry_past_the_put_limits_is_dropped`, `tests/api/surface/test_restore_descriptions.py::test_the_valid_entry_beside_dropped_ones_merges`

### F-033 · A rogue daemon's strings can stall the SPA or, with some settings on, crash its render

- Disposition: Fixed for the own-key lookups; the regex rewrite and the error boundary declined
- Commits: `00e726e1` (the SPA's option lookups read own keys only)
- Proof: `tests/js/store/narrow/inherited-labels.test.js` tests `test_decorate_options_over_an_inherited_label_returns_without_throwing`, `test_narrowing_keeps_an_option_whose_label_is_inherited`
- Owner decision: "the regex clause (no stall reproduced in V8) and the error-boundary clause (would need fallback copy) are declined, confirmed by the owner in the lock." (phase 8 D-07, as CONTEXT records it)

### F-034 · Unpinned build inputs run in the same job as the Apple signing key and notary key

- Disposition: Fixed in the tree; the secret move is the owner's
- Commits: `fe2e7edb` (release build jobs install uv at a pinned version, checked against its SHA-256, in place of the astral.sh script piped into `sh`), `ff28d736` (one hashed uv lock, and `check.yml` installs from it), `c21ed660` (the release build jobs install from the lock), `59a838d7` (macOS signing moves out of the PyInstaller freeze, and `package-macos.sh` signs without `.venv/bin/python`), `bcb093cb` (`build-macos` holds no secrets, and a separate `sign-macos` job in `environment: signing` signs, notarizes and staples)
- Proof: `tests/gates/test_supply_chain.py::test_only_a_fetched_script_piped_into_a_shell_is_a_failure`, `tests/gates/test_supply_chain.py::test_the_release_build_jobs_install_only_from_the_lock`, `tests/gates/test_supply_chain.py::test_the_macos_build_job_reads_no_secret`, `tests/gates/test_supply_chain.py::test_an_apple_secret_in_the_build_job_fails_twice_there`, and the gate's own run against the export of base commit `1025d19c`: `release.yml:49: a downloaded script is piped into a shell: - run: curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh` (also `:225`, `:330`), `release.yml:228: job build-macos: a Python install that does not come from the lock: - run: uv pip install . pyinstaller`, `release.yml:234: job build-macos: the build runs here and reads a secret: MACOS_CERT_P12_BASE64: ${{ secrets.MACOS_CERT_P12_BASE64 }}` (also `:235`, `:236`, `:258`, `:259`). The same gate exits 0 at `11327b55`. The freeze-then-sign split on a macOS runner is proved only by the `smoke-macos --notarized` rows, which this record did not run.
- Note: the owner moves `MACOS_CERT_P12_BASE64`, `MACOS_CERT_PASSWORD`, `NOTARY_KEY_P8_BASE64`, `NOTARY_KEY_ID` and `NOTARY_ISSUER_ID` into the `signing` environment in GitHub settings (D-05). Until then `sign-macos` reads them at repository level and CI stays green.

### F-035 · Apple secrets sit outside the signing environment, and both signing jobs run on ungated dev pushes

- Disposition: Fixed for the repository half; the settings half is the owner's
- Commits: `bcb093cb` (the Apple secrets are read only by `sign-macos`, which names `environment: signing`), `50855578` (`tag-check` runs on every trigger, and `package-windows` and `sign-macos` both need it), `3db3749d` (Linux packaging moves to `package-linux`, in `environment: signing` and behind the check)
- Proof: `tests/gates/test_supply_chain.py::test_a_job_that_imports_the_apple_secrets_sits_in_the_signing_environment`, `tests/gates/test_supply_chain.py::test_every_signing_secret_belongs_to_the_signing_environment`, `tests/gates/test_supply_chain.py::test_package_windows_sits_in_the_signing_environment_and_its_secrets_with_it`, `tests/gates/test_supply_chain.py::test_a_signing_job_waits_on_a_check_that_runs_on_every_trigger`, `tests/gates/test_supply_chain.py::test_a_checkout_whose_apple_secrets_sit_outside_the_signing_environment_exits_nonzero`, `tests/gates/test_supply_chain.py::test_a_checkout_whose_signing_job_waits_on_no_check_exits_nonzero`, and the gate against the base export: `release.yml:234: job build-macos: signs or reads a signing secret and is not in environment: signing`, `release.yml:350: job package-windows: in environment: signing and does not wait on a check that runs on every trigger`. The same gate exits 0 at `11327b55`.
- Scope beyond CONTEXT: CONTEXT names two signing jobs. Plan 4 added a third, `package-linux` in `environment: signing`, so the GPG key never sits in the job that runs PyInstaller (`test_package_linux_sits_in_the_signing_environment`, red against the gate before `91591331` named the job). It also added `sign-image` in `docker.yml`, in a separate `image-signing` environment (`11327b55`, which records the widening of `PACKAGE_WRITERS` as owner-approved). The owner's words for either choice are not recorded in a file of the tree, so none are quoted here.
- Note: the owner sets `signing`'s deployment branch rule to admit `dev` and `v*` tags only (D-04, D-05), and creates `image-signing` with a rule admitting `main`, `beta` and `v*` tags. A `workflow_dispatch` on any other branch then waits on, or is refused by, that rule.

### F-036 · docker.yml passes packages:write to the check job that runs unpinned dev dependencies

- Disposition: Fixed
- Commits: `575b7974` (`docker.yml` grants `contents: read` at the top and to the `check` call, `packages: write` only to the jobs that push, and `check.yml` declares `contents: read` at the top), `ff28d736` (the check job installs from the hashed lock in place of `pip install -e ".[dev]"`)
- Proof: `tests/gates/test_supply_chain.py::test_packages_write_belongs_to_the_job_that_pushes_alone`, `tests/gates/test_supply_chain.py::test_check_declares_contents_read_at_the_top`, `tests/gates/test_supply_chain.py::test_a_checkout_with_packages_write_at_the_top_exits_nonzero`, `tests/gates/test_supply_chain.py::test_a_checkout_with_an_unlocked_install_in_check_exits_nonzero`, and the gate against the base export: `docker.yml:11: packages: write on the workflow level, which does not push a package`, `check.yml:1: no top-level permissions with contents: read`, `check.yml:40: job check: a Python install that does not come from the lock: .venv/bin/pip install -e ".[dev]"`. The same gate exits 0 at `11327b55`.
- Note: the checkout steps keep their default credential persistence. The token they persist is now `contents: read` in every job of `check.yml`.

### F-037 · Published artifacts contain what PyPI and base images serve at build time

- Disposition: Fixed for the lock, the interpreter, the base images and the uv installs; the runtime dependencies' version bounds and the image's missing post-build test are as they were
- Commits: `ff28d736` (one hashed uv lock for the six build targets on Python 3.14, and `check.yml` installs from it), `c21ed660` (`build`, `build-macos` and `build-windows` install from the lock), `9c94a8c1` (the image installs from the lock on Python 3.14 in two stages), `fba47c3d` (the `Dockerfile` bases and the `almalinux:8` build container are pinned by digest), `fe2e7edb` (the `irm | iex` and the two `curl | sh` uv installs become one checksum-verified install)
- Proof: `tests/gates/test_supply_chain.py::test_the_release_build_jobs_install_only_from_the_lock`, `tests/gates/test_supply_chain.py::test_only_a_locked_sync_or_a_triviajudge_install_passes_in_check`, `tests/gates/test_supply_chain.py::test_only_an_image_without_a_full_digest_is_a_dockerfile_failure`, `tests/gates/test_supply_chain.py::test_only_the_build_container_must_carry_a_digest`, `tests/gates/test_supply_chain.py::test_only_a_fetched_script_piped_into_a_shell_is_a_failure`, and the gate against the base export: `release.yml:333: job build-windows: a Python install that does not come from the lock: - run: uv pip install . pyinstaller` (also `:51`, `:228`), `release.yml:41: job build: container almalinux:8 is not pinned to a full sha256 digest`, `Dockerfile:1: python:3.12-slim is not pinned to a full sha256 digest`, `release.yml:330: a downloaded script is piped into a shell: irm https://astral.sh/uv/install.ps1 | iex`. The same gate exits 0 at `11327b55`. The image built from the lock ran Python 3.14.10 and answered `/api/health` 200 under rootless podman; whether `uv sync` works on the Windows runners, the Arm64 runners and in the AlmaLinux container is shown only by the `check`, `smoke`, `smoke-windows` and `smoke-macos` rows.
- Note: `pyproject.toml` still gives the runtime dependencies no version bounds; the lock fixes the versions every build installs. The report's remark that the image gets no post-build test is unchanged, and `debian:12`, `ubuntu:22.04`, `fedora:latest` and `almalinux/8-init` stay on tags (D-11).
- Note: a version bump in `pyproject.toml` makes `uv lock --check` fail, and `uv sync --locked` then fails in `check.yml`, the release jobs and the image. The release bump must run `uv lock` and stage `uv.lock` in the release commit.

### F-038 · The SimplySign installer runs unverified in the step holding the TOTP seed

- Disposition: Fixed
- Commits: `1198b9e9` (the MSI's SHA-256 is compared with a pin beside `$Version` before `msiexec`, and the seed is read into script variables and removed from the environment before the first `Start-Process`)
- Proof: `tests/gates/test_supply_chain.py::test_the_installer_is_hash_checked_against_a_pin_before_msiexec`, `tests/gates/test_supply_chain.py::test_the_seed_leaves_the_environment_before_the_first_start_process`, `tests/gates/test_supply_chain.py::test_a_checkout_whose_login_script_never_checks_the_installer_exits_nonzero`, and the gate against the base export: `simplysign-login.ps1:1: no $InstallerSha256 pinned to a full SHA-256`, `simplysign-login.ps1:101: msiexec runs before the installer's SHA-256 is taken and compared with the pin`, `simplysign-login.ps1:101: the seed is still in the environment at the first Start-Process`. The same gate exits 0 at `11327b55`. `pwsh` is absent on the dev host, so the script itself was not run.
- Note: the pinned hash `8ec420fc27798b86078b7bd02fe7152097e1b3005bab51820eaca8e57df84da3` came from a download of the script's own URL for 9.4.4.92 (273982464 bytes), made during Plan 3 into a fresh scratch directory and deleted unrun. The script downloads only when the runner does not already carry the app, so the hash check runs in CI only on a run whose `package-windows` log shows the download branch; that log was not read for this record.

### F-039 · Secret-bearing jobs trust movable action tags

- Disposition: Fixed
- Commits: `d28a449b` (every remote `uses:` is pinned to a full commit SHA with its tag as a comment, and the gate that holds it), `1335f068` (Dependabot keeps the action pins and the Python lock current)
- Proof: `tests/gates/test_supply_chain.py::test_only_a_remote_action_not_named_by_a_full_sha_is_a_failure`, `tests/gates/test_supply_chain.py::test_a_checkout_exits_nonzero_only_when_an_action_is_named_by_tag`, `tests/gates/test_supply_chain.py::test_the_repos_own_workflows_pass`, and the phase's AC1 run of `scripts/gates/check_supply_chain.py`. Against the export of base commit `1025d19c` it printed `exit=1` and `64 problem(s). Pin every action and image, check every download, install from the lock.`, among them 36 lines of the form `docker.yml:32: docker/login-action@v4 is not pinned to a full 40-hex commit SHA` and `release.yml:377: actions/upload-artifact@v7 is not pinned to a full 40-hex commit SHA`. At `11327b55` it printed `exit=0` and `[ok] all 3 workflows and the Dockerfile pin their remote code`.
- Note: `.github/dependabot.yml` may take effect only once it reaches the default branch (CONTEXT's flagged assumption); until the owner promotes, the updater does nothing. Its two entries are `github-actions` and `uv`, both aimed at `dev`, and the file parses (`yaml.safe_load`); the Dependabot page listing both ecosystems is a check for the owner after promotion. The `Dockerfile` digests are not covered by an entry.

### F-040 · No publisher checksum or signature for deb, rpm or images, with auto-update encouraged

- Disposition: Fixed in the tree; verified at the next `v*` release by the owner's decision (AC4 pending); the setup clauses on `compose.yaml`, `:latest` and Watchtower are as they were
- Commits: `fb3476eb` (each release attaches `SHA256SUMS` beside its assets, and the README says how to check a download), `3db3749d` (Linux packaging runs in `package-linux`, apart from the freeze), `91591331` (the deb and rpm carry GPG signatures through nfpm `signature` blocks, with the public key at `packaging/keys/hqptuner-release.asc` and the README check), `11327b55` (the images are cosign-signed by digest in `sign-image`, with the public key at `packaging/keys/cosign.pub` and the README check)
- Proof: AC4's human-verify, pending until the next `v*` release: `SHA256SUMS` covers every asset, the deb and rpm verify against the published GPG key, and both registries' images pass `cosign verify` against `cosign.pub`. Offline: the checksum step run against four dummy files with `gh` stubbed wrote four lines and `sha256sum --check` printed `OK` four times, and with the dmg removed the step exited 1; `tests/gates/test_supply_chain.py::test_every_signing_secret_belongs_to_the_signing_environment[RELEASE_GPG_PRIVATE_KEY]` and `[RELEASE_GPG_PASSPHRASE]` and `tests/gates/test_supply_chain.py::test_the_linux_build_job_reads_no_secret` failed by assertion before `91591331` and pass after; `tests/gates/test_supply_chain.py::test_a_job_reading_a_cosign_secret_runs_no_build_step` and `tests/gates/test_supply_chain.py::test_a_checkout_whose_cosign_key_sits_in_the_build_job_exits_nonzero` guard the placement of the image key. No gate line of the base export names a missing checksum or signature, since the gate checks where the keys sit and not that a release carries them.
- Note: the owner creates the secrets `RELEASE_GPG_PRIVATE_KEY` and `RELEASE_GPG_PASSPHRASE` in `signing` and `COSIGN_PRIVATE_KEY` and `COSIGN_PASSWORD` in `image-signing` (D-09), in GitHub settings outside the tree; the two public keys were handed over and are committed. The README key URLs point at `main`, so they resolve once the owner promotes. `packaging/keys/hqptuner-release.asc` carries a second, revoked user id beside the live one.

### F-041 · Frozen bundles ship eqlab's src, tests and .claude tree and may serve them over the network

- Disposition: Fixed for the frozen bundles; `spa.py` left unfiltered
- Commits: `21428263` (`hqptuner.spec` leaves eqlab's `src`, `tests`, `.claude` and `.git` out of `static`, and `smoke.sh` checks the installed tree for them)
- Proof: `tests/gates/test_supply_chain.py::test_a_spec_that_keeps_one_eqlab_directory_names_it`, `tests/gates/test_supply_chain.py::test_a_spec_fails_once_per_eqlab_directory_it_keeps`, `tests/gates/test_supply_chain.py::test_a_checkout_whose_spec_leaves_eqlab_in_exits_nonzero`, the `smoke` job's step 2 over the installed tree (AC3), and the gate against the base export: `hqptuner.spec: does not leave out static/vendor/eqlab/src` (also `tests`, `.claude`, `.git`). The same gate exits 0 at `11327b55`. Run by hand against two frozen bundles, the step 2 loop printed `FAIL: step 2: .../static/vendor/eqlab/src is in the package` for the bundle frozen from the old spec and `CLEAN` for the new.
- Note: `hqptuner/api/spa.py` gets no filter (D-15); the SPA references only `vendor/eqlab/core`, which the bundle still carries.

### F-042 · Dev-tool dependencies run on developer hosts and in CI without commit pins

- Disposition: Fixed for filepawl; the triviajudge clause declined
- Commits: `13d92b35` (`filepawl` is pinned to commit `53d93f0807646d4a39a6e05378927ae0787817a8`, which tag `v0.11.0` resolves to), `ff28d736` (`uv.lock` holds that revision, so the CI and release installs take it), `912bcf72` (triviajudge leaves the dev extras, so `.[dev]` and the lock no longer carry it)
- Proof: `git show 1025d19c:pyproject.toml` names `filepawl[mv] @ git+https://github.com/ohshitgorillas/filepawl.git@v0.11.0`, and `pyproject.toml` at `11327b55` names the full 40-hex commit above, which `uv.lock` records as its `rev`. `git ls-remote` named `53d93f0807646d4a39a6e05378927ae0787817a8 refs/tags/v0.11.0^{}` before the pin was written. No gate rule or test holds the pin.
- Owner decision: "it's my app I update it when I fucking want" (D-06), declining a commit pin and a PyPI version-and-hash pin for triviajudge.
- Reason: triviajudge stays outside the hashed lock. `check.yml` installs it in both jobs with `uv pip install --python .venv/bin/python triviajudge`, so it and its own dependencies are resolved at run time and outside the lock; that install is the reach of the decision.
- Note: the report's clause that pre-commit runs hooks labelled as LLM judges, so repository text leaves the host, is not changed by this phase. The report rates it low-risk for a public repository and its remediation names the pins only.
