PLAN CHECKPOINT: human-verify

Plan: .planning/phases/3/PLAN-2.md

Tasks: 2 of 2

| Task | Commit | Note |
|---|---|---|
| 1 - broken-tray control in step 8 | 3f47ab27 | `app_windows` PowerShell helper (EnumWindows, GetWindowThreadProcessId, IsWindowVisible, Shell_NotifyIconGetRect with uID 0), `titled_window_result`, `tray_registered` (class suffix `SystemTrayIcon`, S_OK), shared `judge_upgraded` (5 s alive check only), `broken_tray_control` called in `upgrade_quit` after `check_upgraded`, `BROKEN_PID` in `cleanup`. Local: `bash -n` 0, `shellcheck -S warning` 0, `scripts/gate.sh make check` exit=0. |
| 2 - judgment requires tray icon and no visible window | f476c720 | `judge_upgraded` now, after the 5 s alive window, runs `app_windows` on the PID, prints the report to stderr, rejects with a finding listing each visible window (title and class), and rejects with a finding when `tray_registered` fails; new `visible_windows` formatter; header comment updated. `check_upgraded` and the control are unchanged (both already call the judgment). Local: `bash -n` 0, `shellcheck -S warning` 0, `scripts/gate.sh make check` exit=0 (twice: pre-commit, and the one post-commit suite run; no `workflow.test_command` is set, so `make check` is the manifest suite). The judgment ran locally against stubbed `app_windows` output: two hidden `SystemTrayIcon` windows at S_OK returned 0; the recorded broken-app report returned 1 naming "Unhandled exception in script" and no tray icon; a visible window beside a registered icon returned 1. The real helper is untested off Windows (no PowerShell here), but it ran on the Task 1 runs and returned the report below. |

Red run record (Task 1, owner push of `dev` at 3f47ab27):

- run id: 42320065153 (release workflow); check workflow run 42320065165 succeeded. Full failed log: /tmp/run42320065153.log
- commit: 3f47ab27
- x64 row (windows-latest, windows-installer, x64) failing line: `FAIL: step 8 (previous release quit): control: the upgraded-app check accepted an install whose tray image is missing`
- arm64 row (windows-11-arm, windows-installer, arm64) failing line: the same FAIL line
- bundle row (windows-11-arm, windows-bundle-x64) passed; step 9 did not run; every other job in the run passed
- helper report for the broken app, x64, PID 6888 (handle, class, visible, tray query, title):
  - 130186 #32770 1 0x80004005 Unhandled exception in script
  - E016C MSCTFIME UI 0 0x80004005 MSCTFIME UI
  - E01FA IME 0 0x80004005 Default IME
- helper report for the broken app, arm64, PID 8436:
  - 700E6 #32770 1 0x80004005 Unhandled exception in script
  - 700EA IME 0 0x80004005 Default IME
  - 40300 MSCTFIME UI 0 0x80004005 MSCTFIME UI
- Reading: all three symptom checks held on both rows (visible dialog window with the exact title, tray query not S_OK for it, no `SystemTrayIcon` window), and the Task 1 judgment accepted the broken app. The failure is the expected one; none of the Task 1 return-to-owner conditions occurred.

Run record (Task 2 commit f476c720, owner push of `dev`):

- run: release 42332087614, check 42332087616 (check, e2e success). Every job passed except `smoke-windows (windows-11-arm, windows-installer, arm64)`, failed after 6 min (inside 15) in step 8 on the HEALTHY upgraded app. Logs: /tmp/run42332087614-arm64.log, /tmp/x64ok.log (x64 job).
- arm64 runner: Windows 11 10.0.26200, image windows-11-vs2026-arm64. Judgment report for PID 2444 (handle, class, visible, tray query, title):
  - 40304 HQPTuner1566336231680SystemTrayIcon 0 0x80004005
  - 100040 HQPTuner1566336231680SystemTrayIcon 0 0x80004005
  - 402FE IME 0 0x80004005 Default IME
- failing line: `FAIL: step 8 (previous release quit): no tray icon is registered for the upgraded app`
- x64 row (Windows Server 2025, image windows-2025-vs2026) passed every check; one of its two pystray windows answered 0x00000000.
- Reading: the plan's stop condition fired (healthy app failing the tray half). The check is not loosened. Cause not established.

Deviation (diagnostic, owner-approved), commit b96a5a7f: `judge_upgraded` also calls a new read-only `notify_icon_settings` helper (inline PowerShell, exe path through `SMOKE_EXE`, script through `SMOKE_SCRIPT`, as `app_windows` does). After the 5 s alive window, and so in steps 8, 9 and the control, it prints to stderr, for `$UPGRADE_APP/HQPTuner.exe` (`cygpath -w -l`, then `GetFullPath`), each subkey of `HKCU\Control Panel\NotifyIconSettings` whose `ExecutablePath` matches case-insensitively (resolved full path, or the raw value), as `notify-icon-settings: subkey <name> IsPromoted=<value>` (`(absent)` when no value), or `notify-icon-settings: no subkey matched (<n> subkeys examined)`; first line `notify-icon-settings: executable <path>`. Evidence only: the output goes to stderr, a helper failure prints one line and is ignored, the pass/fail logic of the judgment is untouched, nothing is written to the registry. Hypothesis under test, unverified: on Windows 11 the icon is registered but sits in the hidden overflow, and `Shell_NotifyIconGetRect` fails for icons there. Local: `bash -n` 0, `shellcheck -S warning` 0, `scripts/gate.sh make check` exit=0. The helper is untested off Windows.

Awaiting: owner push of `dev` at b96a5a7f; read the `notify-icon-settings:` lines on both installer rows. No fix started.

Green run record (Task 2): none yet; the arm64 row is red at f476c720

Deviations: [deviation] diagnostic, owner-approved: NotifyIconSettings evidence added to the shared judgment (b96a5a7f); plan assumption "Shell_NotifyIconGetRect answers S_OK for a healthy app on every runner" refuted on arm64 (Windows 11).

Open items:

- Declined: one PowerShell/C# compile per helper call is accepted (dialog poll up to 20 calls, plus one in each judgment); a single long-lived helper that waits internally is the fuller shape, not built because the Verify needs only a bounded wait.
- Untested until the green run: that a healthy upgraded app has no visible top-level window and that `Shell_NotifyIconGetRect` answers S_OK for pystray's window (plan assumption). The arm64 row's added time (one more helper compile per check_upgraded, so about three per run) is also unmeasured.
- Task 1's final `make check` after the first commit was run through `scripts/gate.sh`; the first Task 2 pre-commit run was piped to `tail` by mistake (its `exit=0` line is gate.sh's own; the post-commit run was unpiped and also `exit=0`).
