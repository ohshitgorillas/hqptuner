---
status: testing
phase: 8
fields_version: 1
started: 2026-11-12
updated: 2026-11-12
---

## Items

### 1. Staged XML values escape and round-trip
expected: A staged value containing ", <, & or ' lands in hqplayerd.xml as entity text and get_attr reads back the original value
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: xmledit.py:179-193,207-230; spot-check round-trip True/True; pre-fix set_attr injected <foo>; tests/engine/http/test_xml_escaping.py passes

### 2. Control API values sent raw, double quote refused
expected: A Control API command with &, < or ' in a value is sent unchanged; one with " is refused before any byte is written
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: control.py:334-345 refuses '"' before request(); tests/engine/http/test_control_attr_quote.py passes

### 3. Values outside page choices refused
expected: A staged matrix_enabled of on, or any value not among its page's choices, is refused at /api/config/stage and /api/config/live with nothing written
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: presetconf.check_choices; pending.stage and apply.config_live refuse before any merge, hold or send; tests/api/surface/test_staged_choices.py and tests/engine/http/test_page_choices.py pass

### 4. 401 after a normal answer is an engine fault
expected: A 401 following a normal answer in the same apply is reported as an engine fault and credentials_ok is unchanged
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: restore.py apply() answered-counter check, retract_refusal, readings restored; tests/engine/http/test_engine_fault_after_answer.py passes (3 cases)

### 5. Restore upload ceilings and member names
expected: A restore upload over its ceiling, a member whose declared decompressed size is over its ceiling, and a member name that is absolute, contains .. or a backslash are each refused with nothing sent to the daemon
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: routes/config.py _read_upload and _refuse_unfit_archive; presetzip.check_sizes/check_names; tests/api/surface/test_restore_limits.py, test_restore_members.py, tests/engine/http/test_snapshot_member_ceiling.py pass, each with a no-restore-sent case

### 6. Over-limit archive description dropped
expected: An over-limit description entry in an accepted archive is dropped and the other entries merge
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: descriptions._storable called from merge; tests/api/surface/test_restore_descriptions.py passes

### 7. Staged value length ceiling
expected: A staged value over the length ceiling is refused
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: pending.MAX_VALUE_LENGTH/MAX_STAGED_KEYS, refuse_long_values at stage and live; tests/api/surface/test_stage_ceiling.py passes

### 8. Audit limit cap
expected: /api/audit with a limit over its cap answers at most the cap
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: audit.py tail(min(limit, MAX_LIMIT=1000)); tests/audit/test_audit_limit_cap.py passes

### 9. Profile switch checks a fresh profile list
expected: A profile switch naming a profile absent from a fresh MatrixListProfiles read is refused and no switch command is sent
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: matrixlane.switch_profile re-reads get_matrix_profiles before set_matrix_profile; tests/matrix/test_profile_switch_known.py passes

### 10. Stored names stay in their store; Windows name refusals
expected: A preset, snapshot or mode name resolving outside its store is refused on every platform; under the Windows build a:b and CON are refused while on Linux a:b saves
criterion: AC5
status: pass
first_pass: pass
source: verifier
evidence: PresetStore._path containment, names.validate_stored_name win32 checks wired at every save site; tests/api/surface/test_preset_name_reach.py passes

### 11. constructor option label in Simplified mode
expected: A daemon option labelled constructor renders in Simplified mode without error
criterion: AC5
status: pass
first_pass: pass
source: verifier
evidence: plainnames.js own() and match.js facetOf via Object.hasOwn; tests/js/store/narrow/inherited-labels.test.js 5/5 pass

### 12. Dispositions record covers all 13 findings
expected: .planning/security/DISPOSITIONS.md lists all 13 findings, each fixed one naming its commit and a proof that fails against the pre-fix code, each declined or deferred one quoting the owner's ruling
criterion: AC6
status: pass
first_pass: pass
source: verifier
evidence: 13 Disposition lines; 22 commits on HEAD; 32 proof node ids collect and pass; rulings quoted; bite runs recorded in reports and spot-confirmed

### 13. CI job check passes
expected: Required job check concludes success on the phase's last dev commit (ci: check)
criterion: AC6
status: pass
job: check
commit: 7e5ff6811d8a4134de5d3b309128ea48a1c878ac
first_pass: pass
source: model
evidence: check concluded success at 7e5ff6811d8a4134de5d3b309128ea48a1c878ac

### 14. CI job e2e passes
expected: Required job e2e concludes success on the phase's last dev commit (ci: e2e)
criterion: AC6
status: pass
job: e2e
commit: 7e5ff6811d8a4134de5d3b309128ea48a1c878ac
first_pass: pass
source: model
evidence: e2e concluded success at 7e5ff6811d8a4134de5d3b309128ea48a1c878ac

### 15. CI job smoke passes
expected: Required job smoke concludes success on the phase's last dev commit (ci: smoke)
criterion: AC6
status: pass
job: smoke
commit: 7e5ff6811d8a4134de5d3b309128ea48a1c878ac
first_pass: pass
source: model
evidence: smoke concluded success at 7e5ff6811d8a4134de5d3b309128ea48a1c878ac

### 16. CI job lifecycle-deb passes
expected: Required job lifecycle-deb concludes success on the phase's last dev commit (ci: lifecycle-deb)
criterion: AC6
status: pass
job: lifecycle-deb
commit: 7e5ff6811d8a4134de5d3b309128ea48a1c878ac
first_pass: pass
source: model
evidence: lifecycle-deb concluded success at 7e5ff6811d8a4134de5d3b309128ea48a1c878ac

### 17. CI job lifecycle-rpm passes
expected: Required job lifecycle-rpm concludes success on the phase's last dev commit (ci: lifecycle-rpm)
criterion: AC6
status: pass
job: lifecycle-rpm
commit: 7e5ff6811d8a4134de5d3b309128ea48a1c878ac
first_pass: pass
source: model
evidence: lifecycle-rpm concluded success at 7e5ff6811d8a4134de5d3b309128ea48a1c878ac

### 18. CI job smoke-macos passes
expected: Required job smoke-macos concludes success on the phase's last dev commit (ci: smoke-macos)
criterion: AC6
status: pending_ci
job: smoke-macos
commit: 7e5ff6811d8a4134de5d3b309128ea48a1c878ac
source: model
evidence: required CI job; runs only on the forge, not on this host

### 19. CI job smoke-windows passes
expected: Required job smoke-windows concludes success on the phase's last dev commit (ci: smoke-windows)
criterion: AC6
status: pass
job: smoke-windows
commit: 7e5ff6811d8a4134de5d3b309128ea48a1c878ac
first_pass: pass
source: model
evidence: smoke-windows concluded success at 7e5ff6811d8a4134de5d3b309128ea48a1c878ac

### 20. docs/architecture.md error table describes the restore route's unreadable-archive answer as it was before 56b41122
expected: behavior wrong (normative doc contradicts code) - Plan 2 Task 2 moved an unreadable uploaded archive from archive_unreadable/500 to invalid_input/422 and left the architecture error row unchanged, so the normative rule now names a status the route never answers for an upload
origin: verifier
status: pass
first_pass: fail
source: model
evidence: grep docs/architecture.md -> 286:  archive_unreadable   500   an archive the daemon served that is not a readable zip  ; matches ArchiveUnreadableError code invalid_input (routes/config.py:155-166) and engineconf.py:211 archive_unreadable for daemon-served archives
reported: behavior wrong (normative doc contradicts code) - Plan 2 Task 2 moved an unreadable uploaded archive from archive_unreadable/500 to invalid_input/422 and left the architecture error row unchanged, so the normative rule now names a status the route never answers for an upload
severity: minor
cause: 56b41122 gave ArchiveUnreadableError (hqptuner/api/routes/config.py:155-166) the code invalid_input (422) for an uploaded archive, keeping archive_unreadable (500) only for a daemon-served archive (engineconf.py:210-211); docs/architecture.md:286 was outside every plan's lease and still says archive_unreadable covers an uploaded archive and unparseable descriptions, which the route now logs instead of refusing
fix: 7e5ff681, retest

## Summary

total: 20
passed: 19
failed: 0
pending: 0
pending_ci: 1
skipped: 0
blocked: 0
reworked: 1
