---
status: testing
phase: 11
fields_version: 1
started: 2026-11-15
updated: 2026-11-15
---

## Items

### 1. Agent-tooling gate red on base, green on last commit, wired
expected: scripts/gates/check_agent_tooling.py exits non-zero on an export of the phase base (65274f07~1) and 0 on HEAD; it runs in make lint (make check) and in .pre-commit-config.yaml; on HEAD .claude/settings.json has no pip install * or npx * allow rule and no enabledMcpjsonServers key
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: Gate on a 215a92b6 export: 3 fault lines, rc=1. On HEAD: `[ok] ...`, rc=0. Makefile:25 in `lint`. .pre-commit-config.yaml `agent-tooling` hook. check_gates_wired `[ok]`. No pip/npx allow and no enabledMcpjsonServers in .claude/settings.json.

### 2. Tracked settings deny git commit --no-verify
expected: .claude/settings.json on HEAD has a deny rule covering git commit --no-verify, and the gate checks for it
criterion: AC1
status: skipped
first_pass: fail
source: model
evidence: .claude/settings.json has no `deny` key, and `Bash(git commit *)` at :24 allows `git commit --no-verify`. scripts/gates/check_agent_tooling.py has no deny check. The decline is quoted in the 65274f07 commit body and in DISPOSITIONS.md:306 and :336: "no no verify deny, pip/prettier fine, whatever".
reported: missing: the deny rule and its gate check do not exist. The planning records say the owner declined them, but AC1 and UAT item 2 still require them.
severity: minor
cause: Not a code defect: owner declined the deny rule during plan 1 ("no no verify deny, pip/prettier fine, whatever", 65274f07 body, DISPOSITIONS.md:306,336); AC1 text was not amended to match.
reason: Owner declined the --no-verify deny rule in plan 1 ("no no verify deny, pip/prettier fine, whatever"); owner chose skip in /cad-verify 11

### 3. eqstage refuses non-loopback url and fails on redirect
expected: eqstage exits non-zero and sends no request for a job url not http on 127.0.0.1, localhost or [::1]; it fails rather than follows a 307; both tests fail against pre-fix eqstage
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: eqstage.js:82-89 baseOf allowlist, checked before the first request. The CLI spot-check exited rc=1 naming the url. `redirect: "error"` at post.js:41,61,114 and rows.js:94. Named node run: 10/10 pass for eqstage-url and eqstage-redirect tests.

### 4. hqp_section refuses filenames outside the manual
expected: hqp_section returns an error and no file content for an INDEX.md row whose filename is ../... or absolute; the test fails against pre-fix hqpdoc_tools.py
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: hqpdoc_tools.py:264-265 SectionFileOutsideManualError is raised before the read. tests/test_hqpdoc_section.py parent, absolute and symlink cases pass in the named run. MCP route hqpdoc_mcp.py:129.

### 5. Probe backup directory ownership and mode checked
expected: the probes and restore_pristine.py refuse a backup directory not owned by the current user or with mode wider than 0700; the test fails against the pre-fix probes
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: backup_dir.py:58-75 lstat checks for owner, mode and plain directory. All four scripts refuse before credentials and connection. tests/test_probe_backup_dir.py passes, including the per-script exit-1 case.

### 6. Dispositions F-043 to F-048 and narrowed credential exemption
expected: DISPOSITIONS.md has one entry each for F-043..F-048; fixed parts name commit and red proof; declined parts quote the owner; host actions are Notes; CLAUDE.md and live-daemon SKILL.md exempt only hqplayer/password by value
criterion: AC5
status: pass
first_pass: pass
source: verifier
evidence: Six `### F-04[3-8]` entries, with owner quotes on each declined part and Notes for the host actions. CLAUDE.md:46 and live-daemon SKILL.md:34 exempt only `hqplayer`/`password` by value.

### 7. make check green on HEAD
expected: scripts/gate.sh make check exits 0 on HEAD
criterion: AC6
status: pass
first_pass: pass
source: model
evidence: scripts/gate.sh make check on f14de94b -> exit=0 log=/tmp/gate-make-uLe1vcfp.log (coverage all files 96.40)

### 8. CI check passes (ci: check)
expected: required job check concludes success on the phase's last dev commit
criterion: AC6
status: pending_ci
job: check
commit: 7739ecc7b72dd4783ba3f44093e708214afaa44f
source: model
evidence: GitHub Actions required job; runs only in CI, not on this host

### 9. CI e2e passes (ci: e2e)
expected: required job e2e concludes success on the phase's last dev commit
criterion: AC6
status: pending_ci
job: e2e
commit: 7739ecc7b72dd4783ba3f44093e708214afaa44f
source: model
evidence: GitHub Actions required job; runs only in CI, not on this host

### 10. CI smoke passes (ci: smoke)
expected: required job smoke concludes success on the phase's last dev commit
criterion: AC6
status: pending_ci
job: smoke
commit: 7739ecc7b72dd4783ba3f44093e708214afaa44f
source: model
evidence: GitHub Actions required job; runs only in CI, not on this host

### 11. CI lifecycle-deb passes (ci: lifecycle-deb)
expected: required job lifecycle-deb concludes success on the phase's last dev commit
criterion: AC6
status: pending_ci
job: lifecycle-deb
commit: 7739ecc7b72dd4783ba3f44093e708214afaa44f
source: model
evidence: GitHub Actions required job; runs only in CI, not on this host

### 12. CI lifecycle-rpm passes (ci: lifecycle-rpm)
expected: required job lifecycle-rpm concludes success on the phase's last dev commit
criterion: AC6
status: pending_ci
job: lifecycle-rpm
commit: 7739ecc7b72dd4783ba3f44093e708214afaa44f
source: model
evidence: GitHub Actions required job; runs only in CI, not on this host

### 13. CI smoke-macos passes (ci: smoke-macos)
expected: required job smoke-macos concludes success on the phase's last dev commit
criterion: AC6
status: pending_ci
job: smoke-macos
commit: 7739ecc7b72dd4783ba3f44093e708214afaa44f
source: model
evidence: GitHub Actions required job; runs only in CI, not on this host

### 14. CI smoke-windows passes (ci: smoke-windows)
expected: required job smoke-windows concludes success on the phase's last dev commit
criterion: AC6
status: pending_ci
job: smoke-windows
commit: 7739ecc7b72dd4783ba3f44093e708214afaa44f
source: model
evidence: GitHub Actions required job; runs only in CI, not on this host

### 15. The three write probes still capture the pristine archive after switching to the shared backup directory
expected: behavior wrong: 04c0211e shadows the module function `backup` with a local BackupDir in probe_absent_plugin.py `_run`, so the probe raises TypeError on every run with a safe directory and never writes the pristine archive that restore_pristine reads back (D-18).
origin: verifier
status: pass
first_pass: fail
source: model
evidence: scripts/gate.sh .venv/bin/pytest tests/test_probe_backup_dir.py -q at 7739ecc7 -> 12 passed; test_absent_plugin_probe_keeps_the_daemons_config_in_a_safe_directory red by assertion (None == served config) with the shadowed name restored
reported: behavior wrong: 04c0211e shadows the module function `backup` with a local BackupDir in probe_absent_plugin.py `_run`, so the probe raises TypeError on every run with a safe directory and never writes the pristine archive that restore_pristine reads back (D-18).
severity: major
cause: 04c0211e binds the local name backup in _run (probe_absent_plugin.py:255) to the BackupDir from _backup_dir().prepare(), shadowing module coroutine backup(http) at :115; :278 and :294 then call the BackupDir instance -> TypeError. Only site in scripts/probes. Untested: test_probe_backup_dir.py covers only refusal paths.
fix: 7739ecc7, retest

## Summary

total: 15
passed: 7
failed: 0
pending: 0
pending_ci: 7
skipped: 1
blocked: 0
reworked: 2
