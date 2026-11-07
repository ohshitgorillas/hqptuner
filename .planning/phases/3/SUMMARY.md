---
phase: 3
status: partial
completed: 2026-11-07
---

# Phase 3: Windows upgrade install - Summary

The Windows installer force-closes a running HQPTuner.exe and replaces `{app}\_internal` whole, and `smoke-windows` upgrades over a quit and a running v1.20.1 and now judges the upgraded app directly (alive, no visible window, a registered tray icon) beside a broken-tray control; the healthy app fails the tray half on the Arm64 installer row, cause not established.

## What shipped

- Upgrade checks in the Windows smoke: pinned v1.20.1 installer download on the installer rows, step 8 (upgrade over a quit v1.20.1), step 9 (upgrade over a running v1.20.1), install directory gone after the upgrade uninstall - `packaging/windows/smoke.sh`, `.github/workflows/release.yml`
- Fast process checks inside the 15-minute job limit: `ps -W` lookup and `taskkill` stop - `packaging/windows/smoke.sh`
- Installer fix: `CloseApplications=force` and `[InstallDelete]` of `{app}\_internal` - `packaging/windows/hqptuner.iss`
- CHANGELOG entry `- **The Windows app now reinstalls cleanly.**` under `[Unreleased]` `### Fixed` - `CHANGELOG.md`
- Direct judgment of the upgraded app in steps 8 and 9 (`judge_upgraded`: alive across 5 s, no visible top-level window, a `SystemTrayIcon` window `Shell_NotifyIconGetRect` answers S_OK for) and a broken-tray control in step 8 that must be rejected naming "Unhandled exception in script" - `packaging/windows/smoke.sh`
- Diagnostic tray-registration probe, one `build-windows` step (`continue-on-error: true`, `timeout-minutes: 2`), still on `dev` and due for removal - `scripts/probes/probe_tray_registration.py`, `.github/workflows/release.yml`

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
| 2 | 1 | 3f47ab27 | broken-tray control in step 8 (`app_windows`, `tray_registered`, `broken_tray_control`) |
| 2 | 2 | f476c720 | judgment requires a tray icon and no visible window of the upgraded app |
| 2 | 2 (diagnostic) | b96a5a7f | NotifyIconSettings evidence in the judgment (reverted by faeca70d) |
| 3 | 1 | faeca70d | revert of b96a5a7f; `smoke.sh` identical to f476c720 |
| 3 | 2 | b2c33163 | CI probe of the app's tray registration on both Windows architectures |

`7f773b94` (removes the read-volume hook) sits inside this range and is not phase work.

## Deviations

- [deviation] Plan 1 Task 5 planned a `timeout-minutes` raise; owner ruling: `smoke-windows` stays at 15 and the process checks were made fast instead. Done as bb21caaa.
- [deviation] Plan 1 Task 5's first lookup failed every row at step 4 in run 42199578574; fixed in efa4fe09.
- [deviation] Plan 2 assumed `Shell_NotifyIconGetRect` answers S_OK for a healthy app on every runner; refuted on arm64 (Windows 11 10.0.26200) in release run 42332087614, where both `SystemTrayIcon` windows answered 0x80004005. Owner-approved diagnostic b96a5a7f added; its hypothesis (icon in the Windows 11 overflow) refuted by run 42335254191 (`no subkey matched (0 subkeys examined)`), reverted in faeca70d.
- [deviation] Plan 3 assumed pystray's `NOTIFYICONDATAW` layout causes the arm64 add to fail; refuted by release run 42338900978: layout identical to the documented one on both rows (`differs=none`), and on arm64 both pystray's `NIM_ADD` and the documented-buffer `NIM_ADD` returned 0, while both returned 1 on x64. Plan stopped at its checkpoint, no fix started.

## Open items

- The healthy upgraded app fails the tray half of the judgment on the arm64 installer row (`FAIL: step 8 (previous release quit): no tray icon is registered for the upgraded app`, run 42338900978); the cause is not established and the pystray structure candidate is refuted. Owner ruling: replan through `/cad-plan 3 --gaps`.
- Plan 2 stopped incomplete at its Task 2 green run, carried by plan 3; plan 3 stopped incomplete after Task 2: Task 3 (Arm64 tray fix, also awaiting an owner-approved CHANGELOG entry) and Task 4 (remove the probe, green run) not started.
- The tray probe (b2c33163) is still on `dev` in `scripts/probes/probe_tray_registration.py` and `build-windows`; the phase's last commit must not carry it.
- On arm64 the probe's own `NIM_DELETE` also returned 0; on x64 one `SystemTrayIcon` window answers 0x00000000 against two at 0x80004005 on arm64. Recorded facts, no cause drawn.
- Step 8 passed on the pre-fix installer in red run 42205190797, so only the running path (step 9) was red for plan 1's fix.
- Untested: whether a silent install over a locked file can hang rather than fail.
- Declined in plan 2: one PowerShell/C# compile per helper call is accepted rather than a long-lived helper.

## Goal check

Not delivered on Arm64. On x64 the goal is met by CI evidence: in release run 42338900978 the x64 installer row printed `smoke: OK`, so the upgraded app passed the direct judgment f476c720 added (alive across 5 s, no visible window, a tray icon at 0x00000000), and the step 8 control rejected the broken app on "Unhandled exception in script" (`reports/plan-3.md`, Task 2 CI record); the installer fix d044116d (`packaging/windows/hqptuner.iss` `CloseApplications=force`, `[InstallDelete]`) is what steps 8 and 9 exercise there. On the arm64 installer row the same run fails step 8 on the healthy app with `no tray icon is registered for the upgraded app`, so ROADMAP criterion 1 and UAT item 7 stay open for Windows-on-Arm users. The probe refuted the one candidate cause plan 3 tested and established no other, so no fix exists, and the diagnostic probe is still on `dev`. The phase needs a new gap plan.

complete locally, not CI-verified
