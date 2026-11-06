# Phase 3: Windows upgrade install - Context

Gathered: 2026-11-06

Feeds: /cad-plan 3

## Scope boundary

In: reproducing the upgrade `FileNotFoundError` in smoke-windows by installing the published v1.20.1 and then the new build over it, on two paths (v1.20.1 quit first, and v1.20.1 left running in the tray); the installer fix that closes a running `HQPTuner.exe` and clears `{app}\_internal` before the copy; an uninstall after an upgrade that still removes the whole install; and the owner-approved `CHANGELOG.md` entry.

Out: any fallback or error handling around the tray image in `hqptuner/desktop.py`; changing `AppId`, `DefaultDirName`, `PrivilegesRequired` or the architecture `[Files]` entries; changing phase 2's listen-host env, HKCU write or `/LAUNCH`; the upgrade step on the bundle-only `windows-bundle-x64` row; a human check on a Windows 11 PC (the owner has none available).

Deferred: None

Plan shape: one plan (the smoke upgrade steps land and run red on an owner push before the installer fix lands)

## Durable decisions

- D-01 (Fix home): the fix lives in the installer, which closes a running `HQPTuner.exe` and clears `{app}\_internal` before it copies files; the tray load in `hqptuner/desktop.py` gets no fallback, because a missing bundled image is a broken install and a trayless start would hide it. Rejected: catching the error in `desktop.py`. Evidence: `hqptuner/desktop.py:229-236`, `hqptuner/paths.py:54-66`, `packaging/windows/hqptuner.iss:40-42`, `~/dev/CLAUDE.md` 6.3.
- D-02 (Supported upgrade): an upgrade over a running tray app is supported and tested alongside the quit-first path `README.md:208` documents, since most tray users leave the app running. Rejected: quit-first only. Evidence: `README.md:208`, `packaging/windows/hqptuner.iss` (no `CloseApplications`, `RestartApplications` or `AppMutex`), `hqptuner/desktop.py` (single-instance check is a port probe, not a mutex).

## Decisions

- D-03 (Root cause): the cause is not known from the code; every tag from v1.17.0 to v1.20.1 ships the same `hqptuner/data/tray.png`, `hqptuner.spec` datas entry and `[Files]` entries, and nothing under `hqptuner/` deletes inside `bundled()`. The smoke upgrade steps land first and must run red on an owner push before the installer fix lands. Evidence: `hqptuner/desktop.py:229-236`, `hqptuner.spec`, `packaging/windows/hqptuner.iss:40-42`, `hqptuner/presets/store/presets.py:255`, `hqptuner/presets/store/filterpark.py:189`.
- D-04 (Installer identity): `AppId`, `DefaultDirName={autopf}\HQPTuner`, `PrivilegesRequired=lowest` and both architecture-checked `[Files]` entries stay unchanged, and the fix only adds to how an existing `{app}` is treated. Evidence: `packaging/windows/hqptuner.iss:17-42`, `.planning/PROJECT.md:49`.
- D-05 (Phase 2 behavior): `InitializeSetup` setting `HQPTUNER_LISTEN_HOST` in Setup's own environment, the HKCU `Environment` write and `/LAUNCH` stay as they are on the upgrade path. Evidence: `packaging/windows/hqptuner.iss:44-86`, `.planning/phases/2/CONTEXT.md` D-01, D-02.
- D-06 (Previous release): the upgrade steps install the published `HQPTuner-1.20.1-setup.exe` from the v1.20.1 GitHub release, pinned by version, and a later phase bumps the pin. Rejected: resolving the newest other release at smoke time. Evidence: `.github/workflows/release.yml:354-387,431`, `packaging/windows/hqptuner.iss:34`.
- D-07 (Matrix rows): the upgrade steps run on the two installer rows, x64 on `windows-latest` and arm64 on `windows-11-arm`; the bundle-only row keeps its current path. Evidence: `.github/workflows/release.yml:357-372`, `packaging/windows/hqptuner.iss:41-42`.
- D-08 (Smoke shape): v1.20.1 predates `/LAUNCH` (8af4d8da), so the smoke starts the v1.20.1 app itself and tracks it by PID; the upgraded app is checked for `/api/health` at `lan_address` and for still running after its tray is built, since a health-only check passes on this bug. The upgrade is its own previous-then-current sequence into the same `/DIR`, and the fresh-install steps 1, 2a and 7 stay intact. Evidence: `packaging/windows/smoke.sh:127-152,150-188,236-241,243-252`, `hqptuner/desktop.py:258-281`.
- D-09 (Bite proof): the red run is smoke-windows with the upgrade steps against the pre-fix `hqptuner.iss`, on an owner push to `dev`; if CI does not reproduce the failure, the plan goes back to the owner rather than shipping a fix without a red run. Evidence: `.github/workflows/release.yml:3-14`, `docs/testing.md:29` (rule 8).
- D-10 (User-facing text): the fix ships with an owner-approved `CHANGELOG.md` `[Unreleased]` Fixed entry; `README.md:208` changes only if the quit-first instruction changes, and then only in owner-approved wording. Evidence: `CHANGELOG.md:5-9`, `README.md:200-208`, `CLAUDE.md` copy rule.

## Acceptance criteria

- [ ] AC1: in smoke-windows, after v1.20.1 is installed and its app stopped by PID, the new installer run over it into the same `/DIR` leaves an upgraded app that is still running after its tray is built and answers `/api/health` at the runner's non-loopback address (ci: smoke-windows)
- [ ] AC2: in smoke-windows, with the v1.20.1 app left running during the new install, no v1.20.1 process remains when the install finishes, and the upgraded app is still running after its tray is built and answers `/api/health` at the non-loopback address (ci: smoke-windows)
- [ ] AC3: a smoke-windows run with the upgrade steps against the pre-fix `hqptuner.iss` fails at an upgrade step (ci: smoke-windows)
- [ ] AC4: after the upgrade, the uninstaller leaves no `{app}` directory (ci: smoke-windows)
- [ ] AC5: `CHANGELOG.md` `[Unreleased]` has a Fixed entry for the upgrade fix matching the owner-approved wording
- [ ] AC6: `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` all report success on the phase's last `dev` commit once the owner pushes it (ci: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows)

## Flagged assumptions

- Whether the reporter's v1.20.1 app was running during the upgrade is unknown - Unclear; if wrong: the path that matches the report may not be the one that runs red, and AC3 may rest on the other path alone.
- A smoke-windows runner reproduces the `FileNotFoundError` on at least one upgrade path - Unclear; if wrong: AC3 has no red run and the plan goes back to the owner (D-09).
- "Still running after its tray is built" on CI stands in for "tray icon shows and no Unhandled exception in script dialog" on a real Windows 11 PC; the owner has no Windows 11 PC to check by hand - Likely; if wrong: a windowed PyInstaller error dialog keeps the process alive, and AC1 or AC2 passes on a broken build.
- Inno Setup's Restart Manager, on a silent per-user install, can close a windowless pystray app, or a `[Code]` stop by PID or image name is needed - Unclear (research); if wrong: the close step in D-01 does nothing on the running-app path.
- `[InstallDelete]` (or an equivalent `[Code]` clear) on `{app}\_internal` coexists with uninstall logging, so a later uninstall still removes everything - Likely (research); if wrong: AC4 fails or files are orphaned.
- A running PyInstaller one-folder app or Pillow holds files under `_internal` open or locked, which is how an upgrade over a running app can leave the bundle partial - Unclear (research); if wrong: the running-app path is not the cause and only the clear step matters.
- `gh` is on PATH under Git Bash on `windows-latest` and `windows-11-arm`, and `GH_TOKEN` with `contents: read` is enough to download the v1.20.1 asset - Likely (research); if wrong: the smoke goes red for a reason unrelated to the app.
