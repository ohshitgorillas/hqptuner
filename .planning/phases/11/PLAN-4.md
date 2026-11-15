---
phase: 11
plan: 4
# Phase 11 maps no requirement ID (ROADMAP: "Requirements: None"); this plan fixes F-048 (CONTEXT AC4).
requirements: []
files:
  - scripts/probes/backup_dir.py
  - scripts/probes/restore_pristine.py
  - scripts/probes/probe_post_reassert.py
  - scripts/probes/probe_profile_post_process.py
  - scripts/probes/absent_plugin/probe_absent_plugin.py
  - tests/test_probe_backup_dir.py
---

# Phase 11: Agent tooling and repo guards - Plan 4: The probe backup directory is private and checked

## Goal

Findings F-043, F-044, F-045, F-046, F-047 and F-048 are each fixed or carry an owner decision. This plan fixes F-048: the pristine-archive directory the write probes and `restore_pristine.py` share is user-owned, mode `0700`, and checked before any read or write.

## Must be true when done

- One shared module decides where the probe backup directory is and whether it is safe. It creates the directory with mode `0700` when absent, and refuses one that is not owned by the current user or whose mode grants any group or other bit (D-18).
- `restore_pristine.py` and the three writers (`probe_post_reassert.py`, `probe_profile_post_process.py`, `absent_plugin/probe_absent_plugin.py`) use that module and refuse an unsafe directory before reading credentials, before any connection and before reading or writing the archive (D-18, AC4).
- Every test runs offline against a temporary directory, and no probe runs against the production hqplayerd (D-19).
- Tests fail by assertion against the pre-fix probes and `restore_pristine.py` (AC4, D-10).

## Context

- Locked: D-18 (one shared scheme, a fixed user-owned directory with mode `0700`, its owner and mode checked before any read or write; a per-run `mkdtemp` is rejected because `restore_pristine.py` must find an earlier run's archive), D-19 (offline proof only).
- Location, chosen here and open to the owner: the directory stays at the path the four scripts use today, `<PROBE_OUT or tempfile.gettempdir()>/hqptuner-probe`, so `PROBE_OUT` keeps working and the restore finds the archive where the writers put it. Only the creation mode and the check are new.
- All four scripts check `HQPTUNER_HQP_USERNAME` and `HQPTUNER_HQP_PASSWORD` first in `_run`, before any `ControlClient` connect. The tests rely on that: they run with both variables removed from the environment, so the pre-fix code stops at the credential check and never dials the daemon. The host's ambient shell exports them, so removing them is mandatory (`live-daemon` skill).
- The socket guard (`tests/support/socket_guard.py`) records a connect but does not block it, so the credential removal above is what keeps a red run off the production daemon.
- Out of scope: any other probe, and running any probe script, before or after the fix (D-19).

## Tasks

### Task 1: A shared check makes the backup directory private, and `restore_pristine.py` refuses an unsafe one

- **Files:** scripts/probes/backup_dir.py, scripts/probes/restore_pristine.py, tests/test_probe_backup_dir.py
- **Reads:** scripts/probes/restore_pristine.py#_run, scripts/probes/restore_pristine.py#ARCHIVE, scripts/probes/restore_pristine.py#main, tests/test_eqtools_mcp.py#_load
- **Decisions:** D-18, D-19
- **Action:** Write the tests first. Then add `scripts/probes/backup_dir.py`, a stdlib-only module. It resolves the directory from `PROBE_OUT` or the temp directory, as today. It creates the directory with mode `0700` when absent, and it returns one typed result saying whether the directory is safe and why not (`docs/testing.md` rule 17). Unsafe means a directory not owned by `os.getuid()` or a mode with any group or other bit set. Check owner and mode with a stat that does not follow a symlink, so a planted link is judged by its own owner. Make `restore_pristine.py` take its archive path from this module and refuse an unsafe directory as the first thing `_run` does, before the credential check. Raise its existing `CliError` with a message naming the directory, so `main` returns 1 without reading the archive. Do not run `restore_pristine.py` or any probe (D-19).
- **Verify:** Testing scope: the outcomes are a refusal for a foreign-owned directory, a refusal for a directory wider than `0700`, acceptance of a private one, and creation at `0700` when absent. Nothing covers them today. Take the smallest set over the shared module. Simulating a foreign owner offline by substituting the uid source is acceptable. Add one `restore_pristine.py` case: its `main` returns 1 and its refusal names the directory when the directory holding an archive has mode `0755`. That case runs with both `HQPTUNER_HQP_*` credential variables removed, `PROBE_OUT` pointing into `tmp_path`, and the module loaded fresh after the environment is set. Stop there. The shared module is a new surface, so its tests show bite against a null stub (rule 8). The `restore_pristine.py` case fails by assertion against the pre-fix script, whose refusal names the missing credentials and not the directory. Record both in the commit message. `scripts/gate.sh .venv/bin/pytest tests/test_probe_backup_dir.py -q` passes with no socket-guard error, and `scripts/gate.sh make check` exits 0.

### Task 2: The three write probes use the shared check before they write the archive

- **Files:** scripts/probes/probe_post_reassert.py, scripts/probes/probe_profile_post_process.py, scripts/probes/absent_plugin/probe_absent_plugin.py, tests/test_probe_backup_dir.py
- **Reads:** scripts/probes/probe_post_reassert.py#_run, scripts/probes/probe_profile_post_process.py#_run, scripts/probes/absent_plugin/probe_absent_plugin.py#_run, scripts/probes/absent_plugin/probe_absent_plugin.py#OUT
- **Decisions:** D-18, D-19
- **Action:** Write the tests first. Then replace each writer's `OUT` expression and its `OUT.mkdir(parents=True, exist_ok=True)` with the shared module from Task 1. Each writer refuses an unsafe directory as the first thing `_run` does, before the credential check, through its existing `CliError` and with a message naming the directory. Each writes `pristine-settings.zip` only into a directory the check passed. `absent_plugin/probe_absent_plugin.py` sits one directory below `backup_dir.py`. Reach the module from there without a new `noqa`, `type: ignore`, per-file ignore, or a change to `mypy_path` or the pytest `pythonpath`. Settle the route before writing the import: the two top-level writers use a plain `import backup_dir`, which resolves from the script's own directory at run time and from mypy's directory crawl, since `scripts/probes` has no `__init__.py`. For `absent_plugin/probe_absent_plugin.py`, try loading `backup_dir.py` by file path with `importlib.util.spec_from_file_location` relative to `Path(__file__).parent.parent`, which needs no `sys.path` edit and no `noqa`; it is clean only if ruff, black and strict mypy pass with no suppression. Tests load each script by file path the same way, after the environment is set. If no clean route exists, stop and put the options to the owner as a blocking question, since each of those is an exemption or a config change the owner must approve first. Do not run any probe (D-19).
- **Verify:** Testing scope: the outcome is that each writer refuses an unsafe directory before anything else. Add one case per writer, run like Task 1's `restore_pristine.py` case: credentials removed, `PROBE_OUT` in `tmp_path` holding a `hqptuner-probe` directory at mode `0755`, the module loaded fresh. The case asserts that `main` returns 1 with a refusal naming the directory. Stop there. Each case fails by assertion against its pre-fix writer, whose refusal names the missing credentials; record that red run in the commit message. `scripts/gate.sh .venv/bin/pytest tests/test_probe_backup_dir.py -q` passes with no socket-guard error. `grep -n "hqptuner-probe\"" scripts/probes/*.py scripts/probes/absent_plugin/*.py` shows the directory name only in `backup_dir.py` (the profile name `PROFILE = "hqptuner-probe"` in `probe_profile_post_process.py` is a daemon profile, not this directory, and stays). `scripts/gate.sh make check` exits 0.

## Notes

- Plan shape: CONTEXT's example groups "the scripts and probes" as one slice. This plan and Plan 3 share no file and no ordering, so they are two plans that can run in parallel.
- The directory keeps its current location, a choice this plan makes (see Context). A second local user who pre-creates `hqptuner-probe` in a shared `/tmp` can now only make the probes refuse to run; the operator then sets `PROBE_OUT`. Plan 6 records that in the F-048 entry.
