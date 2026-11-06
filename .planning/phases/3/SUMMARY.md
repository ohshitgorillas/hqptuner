---
phase: 3
status: complete
completed: 2026-11-06
---

# Phase 3: Windows upgrade install - Summary

The Windows installer force-closes a running HQPTuner.exe and replaces `{app}\_internal` whole, and `smoke-windows` installs the pinned v1.20.1, upgrades over it quit and running, and fails when the upgraded app does not start.

## What shipped

- Upgrade checks in the Windows smoke: pinned v1.20.1 installer download on the installer rows, step 8 (upgrade over a quit v1.20.1), step 9 (upgrade over a running v1.20.1), install directory gone after the upgrade uninstall - `packaging/windows/smoke.sh`, `.github/workflows/release.yml`
- Fast process checks inside the 15-minute job limit: `ps -W` lookup and `taskkill` stop - `packaging/windows/smoke.sh`
- Installer fix: `CloseApplications=force` and `[InstallDelete]` of `{app}\_internal` - `packaging/windows/hqptuner.iss`
- CHANGELOG entry `- **The Windows app now reinstalls cleanly.**` under `[Unreleased]` `### Fixed` - `CHANGELOG.md`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | cc50fd49 | smoke-windows receives the pinned v1.20.1 installer on the installer rows |
| 1 | 2 | b093c359 | step 8: upgrade over a quit v1.20.1 |
| 1 | 3 | 33eafd97 | step 9: upgrade over a v1.20.1 left running in the tray |
| 1 | 4 | 23f0e888 | install directory gone after an upgrade uninstall |
| 1 | 5 | bb21caaa | process checks use `ps -W` and `taskkill` |
| 1 | 5 (fix) | efa4fe09 | lookup finds a shell-started process (`ps -W` strips `.exe` for tracked children) |
| 1 | 6 | d044116d | installer closes a running HQPTuner.exe and clears `_internal`; CHANGELOG line |

`7f773b94` (removes the read-volume hook) sits inside this range and is not phase work.

## Deviations

- [deviation] Task 5 planned a `timeout-minutes` raise; owner ruling: `smoke-windows` stays at 15 and the process checks were made fast instead. Done as bb21caaa.
- [deviation] Task 5's first lookup failed every row at step 4 in run 42199578574; fixed in efa4fe09.

## Open items

- Task 6 is unverified on Windows: the `CloseApplications=force` and `[InstallDelete]` compile in `package-windows`, and whether `force` closes the windowless tray app, wait on the next push of `dev`. The plan's `[Code]` `PrepareToInstall` fallback applies if step 9 still finds v1.20.1 alive.
- Step 8 passed on the pre-fix installer in red run 42205190797, so only the running path (step 9) was red.
- Untested: whether a silent install over a locked file can hang rather than fail, and whether 15 minutes suffices for the arm64 row once step 9 runs to the end.

## Goal check

Plausibly delivered, pending CI. The red run 42205190797 failed both installer rows at step 9 with `Some applications could not be shut down.` and `User canceled the installation process.` in the Setup log (`/tmp/claude-1000/sw-42205190797/127851246550.log`), and d044116d adds `CloseApplications=force` at `packaging/windows/hqptuner.iss:32`, the setting that turns that silent Abort into a forced close. Success criterion 3 is met by cc50fd49..efa4fe09: that run reached step 9 and failed it on a broken upgrade. Criterion 2 is checked directly by `check_upgraded` (`packaging/windows/smoke.sh:267-270`, `/api/health` at the runner's non-loopback address). Criterion 1 is checked by proxy only: the upgraded process must answer `/api/health` and still be alive 5 s later (`packaging/windows/smoke.sh:256-265`), and no check looks for the tray icon or the "Unhandled exception in script" dialog. Both stay unproven until a green run on d044116d.

complete locally, not CI-verified
