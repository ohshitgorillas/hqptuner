---
phase: 3
status: complete
completed: 2026-11-07
---

# Phase 3: Windows upgrade install - Summary

The Windows installer force-closes a running HQPTuner.exe and replaces `{app}\_internal` whole, and `smoke-windows` upgrades over a quit and a running v1.20.1 and judges the upgraded app directly (alive, no visible window, a registered tray icon) beside a broken-tray control; on the Arm64 installer row the smoke first stops the runner's `WWAHost.exe` first-logon process by PID, and both installer rows pass.

## What shipped

- Upgrade checks in the Windows smoke: pinned v1.20.1 installer download on the installer rows, step 8 (upgrade over a quit v1.20.1), step 9 (upgrade over a running v1.20.1), install directory gone after the upgrade uninstall - `packaging/windows/smoke.sh`, `.github/workflows/release.yml`
- Fast process checks inside the 15-minute job limit: `ps -W` lookup and `taskkill` stop - `packaging/windows/smoke.sh`
- Installer fix: `CloseApplications=force` and `[InstallDelete]` of `{app}\_internal` - `packaging/windows/hqptuner.iss`
- CHANGELOG entry `- **The Windows app now reinstalls cleanly.**` under `[Unreleased]` `### Fixed` - `CHANGELOG.md`
- Direct judgment of the upgraded app in steps 8 and 9 (`judge_upgraded`: alive across 5 s, no visible top-level window, a `SystemTrayIcon` window `Shell_NotifyIconGetRect` answers S_OK for) and a broken-tray control in step 8 that must be rejected naming "Unhandled exception in script" - `packaging/windows/smoke.sh`
- Runner desktop readiness before step 8 (`settle_desktop`, `wwahost_pids`, `taskbar_window`): stops every `WWAHost.exe` by PID, waits 10 s only if it stopped one, then fails the row with its own message if any `WWAHost.exe` remains or no `Shell_TrayWnd` exists - `packaging/windows/smoke.sh`
- The diagnostic tray probe is gone: `release.yml`, `scripts/probes/` and `.filepawl.toml` are as they were at faeca70d.

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
| 4 | 1 | 7e10ea57 | probe reworked to record the runner's desktop around the tray registration |
| 4 | 2 | 68111587 | smoke settles the runner's desktop (stops `WWAHost.exe` by PID) before it judges the tray |
| 4 | 3 | bf1b78af | revert of 7e10ea57 and b2c33163: probe and its `build-windows` step removed |

`7f773b94` (removes the read-volume hook) sits inside this range and is not phase work.

Green run: release 42345897951 and check 42345897932 on `dev` at 0fecc686, every job success.

## Deviations

- [deviation] Plan 1 Task 5 planned a `timeout-minutes` raise; owner ruling: `smoke-windows` stays at 15 and the process checks were made fast instead. Done as bb21caaa.
- [deviation] Plan 1 Task 5's first lookup failed every row at step 4 in run 42199578574; fixed in efa4fe09.
- [deviation] Plan 2 assumed `Shell_NotifyIconGetRect` answers S_OK for a healthy app on every runner; refuted on arm64 (Windows 11 10.0.26200) in release run 42332087614, where both `SystemTrayIcon` windows answered 0x80004005. Owner-approved diagnostic b96a5a7f added; its hypothesis (icon in the Windows 11 overflow) refuted by run 42335254191 (`no subkey matched (0 subkeys examined)`), reverted in faeca70d.
- [deviation] Plan 3 assumed pystray's `NOTIFYICONDATAW` layout causes the arm64 add to fail; refuted by release run 42338900978: layout identical to the documented one on both rows (`differs=none`), and on arm64 both pystray's `NIM_ADD` and the documented-buffer `NIM_ADD` returned 0, while both returned 1 on x64. Plan stopped at its checkpoint, no fix started.
- [deviation] Plan 4 assumed stopping the first-logon processes that own a visible window would let the arm64 add succeed; refuted by release run 42342467036: x64 had the same `SystemPropertiesPerformance.exe` window open and its add succeeded, and on arm64 the add still returned 0 after that window was stopped. `WWAHost.exe` owned no visible window and was never stopped. Owner-approved amendment (28a04c3f): stop `WWAHost.exe` by PID whether or not it owns a window, then wait 10 s.

## Open items

- `reports/plan-2.md` and `reports/plan-3.md` still read `PLAN CHECKPOINT`, so `replay-check` lists both plans outstanding. Plan 4 carried their unfinished work (plan 2's green run, plan 3's Tasks 3 and 4) and the owner ruled that they are not dispatched.
- The arm64 cause rests on remedy-then-success: in run 42345897951 stopping `WWAHost.exe` (PID 7396) came before a successful tray registration. No run in this repo isolates `WWAHost.exe` alone. The outside record is danielchalmers/DesktopClock run 40728539973.
- Each healthy report lists a second `SystemTrayIcon` window at 0x80004005 beside the one at 0x00000000, on x64 and on arm64. The judgment needs one at S_OK. Recorded fact, no cause drawn.
- Whether pystray's `_on_taskbarcreated` re-add matters for real users who start the app before the taskbar is ready: not planned (PLAN-4 Notes).
- The runner image fix (actions/runner-images PR #14673) would make the `WWAHost.exe` stop redundant. Removing the step then needs no approval.
- Step 8 passed on the pre-fix installer in red run 42205190797, so only the running path (step 9) was red for plan 1's fix.
- Untested: whether a silent install over a locked file can hang rather than fail.
- Declined in plan 2: one PowerShell/C# compile per helper call is accepted rather than a long-lived helper.

## Goal check

Delivered on both architectures, by CI evidence. In release run 42345897951 on 0fecc686, both installer rows of `smoke-windows` printed `smoke: OK` (x64 job 128324181855 in 2 min 30 s, arm64 job 128324181883 in 9 min 47 s of 15). On the arm64 row, `step 8 (runner desktop): stopping WWAHost.exe, PID 7396` was followed by `taskbar window 0x1010A, no WWAHost.exe running`. After that, the healthy upgraded app's report showed `30342 HQPTuner2350956357552SystemTrayIcon 0 0x00000000` in step 8 and `100284 HQPTuner2249731034480SystemTrayIcon 0 0x00000000` in step 9 (ROADMAP criterion 1). The step 8 control rejected the broken app on both rows with `the upgraded app shows a visible window: "Unhandled exception in script" (class #32770)`, on arm64 for the first time, so the judgment still fails a broken upgrade (criterion 3). On x64 the readiness step printed `no WWAHost.exe running, nothing stopped`. The bundle row passed (`smoke: OK`, 40 s). Check run 42345897932 (`check`, `e2e`) and every other release job succeeded. Criterion 2 (`/api/health` at the non-loopback address after the upgrade) is not shown by this run's arm64 log: its one non-loopback line, `172.23.16.1:51151 - "GET /api/health HTTP/1.1" 200 OK`, comes before step 8, and after the upgrade only `127.0.0.1` health lines appear. UAT item 7, failing until now, is for `/cad-verify 3` to re-judge.
