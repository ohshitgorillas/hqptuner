---
phase: 4
plan: 4
# Phase 4 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against the findings in its goal, the Success Criteria and CONTEXT AC1-AC6.
requirements: []
files:
  - .filepawl.toml
  - hqptuner/api/routes/status.py
  - docs/openapi.json
  - tests/api/test_api_health.py
  - tests/api/test_status_metadata_kept.py
  - tests/api/test_log_tail_fields.py
  - hqptuner/presets/store/export.py
  - tests/presets/test_state_export.py
  - .planning/security/DISPOSITIONS.md
---

# Phase 4: API exposure and authentication - Plan 4: What the API hands out, and the dispositions

## Goal

Findings F-001, F-002, F-003, F-008, F-009, F-024, F-025, F-027 and F-028 are each fixed or carry an owner ruling. This plan fixes F-025 (D-08: the API stops serving license, metadata and log-path fields the UI does not read), finishes F-008 (D-07: the state export never ships a `connection.json` found in a directory it copies), and records every disposition (D-14).

## Must be true when done

- `/api/health` carries no license `name` or `fingerprint`, and still carries `license.valid` and `app_version`, so the System tab's License row and the desktop single-instance probe read as before (AC4, D-08, D-04).
- `/api/status` metadata carries only `samplerate`, `bits`, `sdm`, `filters`, `shapers` and `song`, so no `uri`; `/api/log` carries no `path` (AC4, D-08).
- A state export holds no password from a `connection.json`, and no login secret, placed anywhere under the preset or the backup directory (AC4, D-07).
- `.planning/security/DISPOSITIONS.md` lists all 9 findings, each naming its fixing commit and the check that bites, or quoting the owner's ruling (AC6, ROADMAP criteria 1 to 3).
- `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` pass on the phase's last `dev` commit (AC6, ROADMAP criterion 4).

## Context

- Read in this tree: `hqptuner/api/routes/status.py` `health` passes `readings.license` through whole, `status` passes `readings.status_metadata` whole, and `log_tail` answers `engineread.LogTail` (`path`, `enabled`, `lines`) with `response_model_exclude_none=True`. `hqptuner/engine/trackcontext.py` reads `manager.readings.status_metadata` for its own use, so the filtering happens at the API response and the readings stay whole (D-08). The SPA reads `license.valid` (`hqptuner/static/components/tabs/SystemTab.js` `licenseLabel`), the metadata keys D-08 lists, and the log `lines` (`hqptuner/static/store/logtail.js` `refreshLogTail`). `tests/support/fake_control.py` answers `GetLicense` with `valid`, `name` and `fingerprint`.
- `hqptuner/presets/store/export.py` `_dir_members` copies every file under a store directory except the filter park; `_connection_members` blanks only the record at `cfg.connection_file`. Plan 1 Task 3 put the login secret's file name in `hqptuner/config.py` beside `CONNECTION_STORE`, importable from `presets`.
- D-09 names `fc9803f5` and `307c3e41` (both present in this repo's history, checked at planning). D-10 and D-12 carry the owner's verbatim rulings. The review is tracked at `.planning/security/REPORT.md` (Plan 1 Task 1).
- Out: the daemon backup archive's own members (CONTEXT flagged assumption 7, whether it holds `hqplayerd-auth.xml`): `/api/backup` is behind the login after Plan 1, and D-07 strips only HQPTuner's own export.

## Tasks

### Task 1: `/api/health` stops serving the licensee's name and fingerprint

- **Files:** hqptuner/api/routes/status.py, tests/api/test_api_health.py
- **Action:** `health` answers `license` without its `name` and `fingerprint` attributes, every other attribute kept as the daemon sent it, and a missing license still `null`. Filter in the route, leaving `manager.readings.license` whole. Leave every other `HealthReport` field as it is: `/api/health` is the one open route (Plan 1 Task 7), and the desktop single-instance probe (`hqptuner/desktop.py`) and the Docker HEALTHCHECK read it; F-028's probe stays as it is (D-12).
- **Verify:** Testing scope, REST lane against `tests/support/fake_control.py`'s `GetLicense`: the answer's `license` has no `name`, has no `fingerprint` (two cases), and keeps `valid`. Bite: the first two red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`.

### Task 2: `/api/status` serves only the metadata the page reads

- **Files:** hqptuner/api/routes/status.py, tests/api/test_status_metadata_kept.py
- **Action:** `status` answers `metadata` holding only the keys `samplerate`, `bits`, `sdm`, `filters`, `shapers` and `song` that the daemon sent, a kept list rather than a dropped one, so an attribute a later hqplayerd adds is not served by default; `null` stays `null`. Filter in the route; `manager.readings.status_metadata` and `engine/trackcontext.py` keep the full reading (D-08). `StatusReport.metadata` stays `dict[str, str] | None`, so `docs/openapi.json` does not move.
- **Verify:** Testing scope, REST lane, with the fake control daemon's Status metadata carrying `uri` and one more attribute outside the list: the answer has no `uri`, has not the other attribute, and keeps a listed key with its value. Bite: the first two red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`.

### Task 3: `/api/log` stops serving the log file's path

- **Files:** hqptuner/api/routes/status.py, docs/openapi.json, tests/api/test_log_tail_fields.py
- **Action:** `log_tail` answers `enabled` and `lines` and no `path`. Do it at the response, with a response shape of its own in the API layer or an exclusion on the route, so `engineread.LogTail` and whatever reads its `path` inside HQPTuner keep it (D-08). The SPA reads only `lines`. Regenerate `docs/openapi.json` with `scripts/gates/check_openapi.py --write`, since the response schema loses a property.
- **Verify:** Testing scope, REST lane: a log read answers without `path` and with its `lines`. Bite: the first red against the commit before this one. `scripts/gate.sh .venv/bin/python scripts/gates/check_openapi.py` and `scripts/gate.sh make check` print `exit=0`.

### Task 4: The state export never ships a credential file it finds in a copied directory

- **Files:** hqptuner/presets/store/export.py, tests/presets/test_state_export.py
- **Action:** `_dir_members` leaves out every file named as the connection record is (`CONNECTION_STORE.name`) and every file named as Plan 1's login secret is, at any depth under any store directory it copies (D-07: in the `presets` layer). An operator who points `HQPTUNER_PRESET_DIR` or `HQPTUNER_BACKUP_DIR` at the directory holding them then exports no password and no secret. Left out, not blanked: a file this module did not write is one it cannot promise to blank (the module docstring's own reasoning for a record that does not parse). `_connection_members` keeps blanking the record at `cfg.connection_file` as today. Update the module docstring to state the rule as it now holds.
- **Verify:** Testing scope, store lane (`hqptuner/presets/store/` is a strong area, so the cases go one level deeper than the AC): a `connection.json` holding a password placed in the preset directory, in the backup directory, and in a subdirectory of each, yields an archive whose members carry no byte of that password (four parametrized cases); a login secret file placed the same way yields no member of that name; the configured record at `cfg.connection_file` still ships blanked. Bite: the password and secret cases red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`.

### Task 5: Record every disposition, then prove the phase on CI

- **Files:** .planning/security/DISPOSITIONS.md
- **Action:** Write `.planning/security/DISPOSITIONS.md` with the Write tool, soft-wrapped, one entry per finding for F-001, F-002, F-003, F-008, F-009, F-024, F-025, F-027 and F-028, in a shape phases 5 to 9 can append to (D-14). Each entry gives the finding's ID and title as `.planning/security/REPORT.md` has them, its disposition, and then either the fixing commit hashes (from `git log` of this phase) with the test or check whose red run proved it (ROADMAP criterion 3; the executor reports record the red runs), or the owner's ruling quoted verbatim. F-001: the login and gate commits (Plan 1). F-002: the cookie commit, the gate commit and the cross-site commit (Plans 1 and 3). F-003: fixed by the login with no loopback exemption and no Host allowlist (D-03), naming the gate commit. F-008: the gate commit and Task 4's commit. F-009: fixed, naming `fc9803f5` and `307c3e41` and the login commits, with the `HKCU\Environment` write left in place (D-09). F-024: declined, quoting "asinine" (D-10). F-025: Tasks 1 to 3's commits. F-027: Plan 3's header and docs-route commits. F-028: declined, quoting "why the fuck would it ever do that" and the reason D-12 records, that exploiting it requires code already running on the machine. No commentary beyond that (triviajudge judges every added markdown line).
- **Verify:** Each of the 9 IDs heads exactly one entry; every hash the file names resolves (`git cat-file -e <hash>` exits 0 for each); both rulings appear verbatim; `.venv/bin/python .claude/hooks/md-softwrap.py --check .planning/security/DISPOSITIONS.md` exits 0; `scripts/gate.sh make check` prints `exit=0`. Required jobs `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows`, human-verify: the owner pushes `dev` at this commit and reads the run; all seven pass. A red job goes back to the owner with its failing line, never into a threshold or an exemption (`~/dev/CLAUDE.md` 6.3).
