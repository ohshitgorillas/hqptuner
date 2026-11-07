PLAN CHECKPOINT: decision

Plan: .planning/phases/3/PLAN-3.md

Tasks: 2 of 4 committed. Task 2's run does NOT establish the cause. Task 3 not started, no fix started.

| Task | Commit | Note |
|---|---|---|
| 1 - Revert the NotifyIconSettings diagnostic | faeca70d | `git revert b96a5a7f`. `git diff f476c720 -- packaging/windows/smoke.sh` empty, `grep -c NotifyIconSettings` 0, `bash -n` 0, `shellcheck -S warning` 0, `scripts/gate.sh make check` exit=0 |
| 2 - CI probe of the tray registration | b2c33163 | Probe script + one `build-windows` step. Local checks green (see earlier record, `plan-3.1.md`). CI run recorded below. ESTABLISHED conditions: NOT met on arm64 |
| 3 - Arm64 tray fix | not started | cause not established; also no owner-approved CHANGELOG entry has reached the executor |
| 4 - Remove the probe, green run | not started | |

## Task 2 CI record

- Run: release 42338900978 on `dev` at commit b2c33163ce019092c01232cf27fb84d46ac75664 (the pushed head). Conclusion: failure. Check run 42338900983: success.
- Jobs: both `build-windows` rows success (x64 job 128301966874, arm64 job 128301967037); `package-windows` success; all `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` success; `tag-check` and `publish` skipped.
- smoke-windows rows:
  - `windows-11-arm, windows-bundle-x64` (128302621632): success.
  - `windows-latest, windows-installer, x64` (128302621651): success, `smoke: OK`. Step 8 control: window `#32770` "Unhandled exception in script", rejected (control passes). Step 8 healthy judgment lines: `HQPTuner1817784068352SystemTrayIcon` windows, one at `0x00000000`.
  - `windows-11-arm, windows-installer, arm64` (128302621669): FAILURE. Failing line: `FAIL: step 8 (previous release quit): no tray icon is registered for the upgraded app`. Judgment windows of PID 4616: `HQPTuner1688242628864SystemTrayIcon` x2 (502D6, 502DC), both visible=0, both `0x80004005`; `IME` 402F8. Steps 8's control did not run, since the healthy judgment failed first.
- Logs (outside the repo): `/tmp/p3run/x64.log`, `/tmp/p3run/arm.log`, `/tmp/p3run/smoke-x64.log`, `/tmp/p3run/smoke-arm.log`.

### Probe output, x64 row (windows-latest, build-windows job 128301966874)

```
probe: machine=AMD64
probe: platform=Windows-2025Server-10.0.26100-SP0
probe: pointer_bits=64
probe: python=3.14.10 (tags/v3.14.10:b703b2c, Oct 25 2026, 17:36:52) [MSC v.1944 64 bit (AMD64)]
probe: pystray=0.19.5
probe: pillow=13.0.0
probe: layout.sizeof=pystray=976 documented=976
probe: layout.cbSize=pystray_offset=0 documented_offset=0 pystray_size=4 documented_size=4
probe: layout.hWnd=pystray_offset=8 documented_offset=8 pystray_size=8 documented_size=8
probe: layout.uID=pystray_offset=16 documented_offset=16 pystray_size=4 documented_size=4
probe: layout.uFlags=pystray_offset=20 documented_offset=20 pystray_size=4 documented_size=4
probe: layout.uCallbackMessage=pystray_offset=24 documented_offset=24 pystray_size=4 documented_size=4
probe: layout.hIcon=pystray_offset=32 documented_offset=32 pystray_size=8 documented_size=8
probe: layout.szTip=pystray_offset=40 documented_offset=40 pystray_size=256 documented_size=256
probe: layout.dwState=pystray_offset=296 documented_offset=296 pystray_size=4 documented_size=4
probe: layout.dwStateMask=pystray_offset=300 documented_offset=300 pystray_size=4 documented_size=4
probe: layout.szInfo=pystray_offset=304 documented_offset=304 pystray_size=512 documented_size=512
probe: layout.uVersion=pystray_offset=816 documented_offset=816 pystray_size=4 documented_size=4
probe: layout.szInfoTitle=pystray_offset=820 documented_offset=820 pystray_size=128 documented_size=128
probe: layout.dwInfoFlags=pystray_offset=948 documented_offset=948 pystray_size=4 documented_size=4
probe: layout.guidItem=pystray_offset=952 documented_offset=952 pystray_size=16 documented_size=16
probe: layout.hBalloonIcon=pystray_offset=968 documented_offset=968 pystray_size=8 documented_size=8
probe: call=source=pystray code=NIM_MODIFY cbSize=976 hWnd=0x1400a6 uID=0 uFlags=0x2 returned=0
probe: call=source=pystray code=NIM_ADD cbSize=976 hWnd=0x1400a6 uID=0 uFlags=0x7 returned=1
probe: call=source=probe code=NIM_DELETE cbSize=976 hWnd=0x1400a6 uID=0 uFlags=0x7 returned=1
probe: differs=none
probe: call=source=probe code=NIM_ADD cbSize=976 hWnd=0x1400a6 uID=0 uFlags=0x7 returned=1
probe: call=source=probe code=NIM_DELETE cbSize=976 hWnd=0x1400a6 uID=0 uFlags=0x7 returned=1
probe: call=source=pystray code=NIM_DELETE cbSize=976 hWnd=0x1400a6 uID=0 uFlags=0x0 returned=0
probe: summary=setup_exception=False pystray_add=1 documented_add=1 differing_fields=0 watchdog_fired=False
```

### Probe output, arm64 row (windows-11-arm, build-windows job 128301967037)

```
probe: machine=ARM64
probe: platform=Windows-11-10.0.26200-SP0
probe: pointer_bits=64
probe: python=3.14.10 (tags/v3.14.10:b703b2c, Oct 25 2026, 18:26:59) [MSC v.1944 64 bit (ARM64)]
probe: pystray=0.19.5
probe: pillow=13.0.0
probe: layout.sizeof=pystray=976 documented=976
probe: layout.cbSize=pystray_offset=0 documented_offset=0 pystray_size=4 documented_size=4
probe: layout.hWnd=pystray_offset=8 documented_offset=8 pystray_size=8 documented_size=8
probe: layout.uID=pystray_offset=16 documented_offset=16 pystray_size=4 documented_size=4
probe: layout.uFlags=pystray_offset=20 documented_offset=20 pystray_size=4 documented_size=4
probe: layout.uCallbackMessage=pystray_offset=24 documented_offset=24 pystray_size=4 documented_size=4
probe: layout.hIcon=pystray_offset=32 documented_offset=32 pystray_size=8 documented_size=8
probe: layout.szTip=pystray_offset=40 documented_offset=40 pystray_size=256 documented_size=256
probe: layout.dwState=pystray_offset=296 documented_offset=296 pystray_size=4 documented_size=4
probe: layout.dwStateMask=pystray_offset=300 documented_offset=300 pystray_size=4 documented_size=4
probe: layout.szInfo=pystray_offset=304 documented_offset=304 pystray_size=512 documented_size=512
probe: layout.uVersion=pystray_offset=816 documented_offset=816 pystray_size=4 documented_size=4
probe: layout.szInfoTitle=pystray_offset=820 documented_offset=820 pystray_size=128 documented_size=128
probe: layout.dwInfoFlags=pystray_offset=948 documented_offset=948 pystray_size=4 documented_size=4
probe: layout.guidItem=pystray_offset=952 documented_offset=952 pystray_size=16 documented_size=16
probe: layout.hBalloonIcon=pystray_offset=968 documented_offset=968 pystray_size=8 documented_size=8
probe: call=source=pystray code=NIM_MODIFY cbSize=976 hWnd=0xd00f2 uID=0 uFlags=0x2 returned=0
probe: call=source=pystray code=NIM_ADD cbSize=976 hWnd=0xd00f2 uID=0 uFlags=0x7 returned=0
probe: differs=none
probe: call=source=probe code=NIM_ADD cbSize=976 hWnd=0xd00f2 uID=0 uFlags=0x7 returned=0
probe: call=source=probe code=NIM_DELETE cbSize=976 hWnd=0xd00f2 uID=0 uFlags=0x7 returned=0
probe: call=source=pystray code=NIM_DELETE cbSize=976 hWnd=0xd00f2 uID=0 uFlags=0x0 returned=0
probe: summary=setup_exception=False pystray_add=0 documented_add=0 differing_fields=0 watchdog_fired=False
```

## Judgment of the ESTABLISHED conditions (PLAN-3 Task 2 Verify, as written)

On x64, all hold: no setup exception (`setup_exception=False`), pystray's `NIM_ADD` returned 1, the documented-buffer add returned 1.

On arm64:

| Condition | Record | Holds |
|---|---|---|
| interpreter native ARM64 with 8-byte pointers | `machine=ARM64`, `pointer_bits=64`, `[MSC v.1944 64 bit (ARM64)]` | yes |
| no exception raised before pystray's `NIM_ADD` | `setup_exception=False` | yes |
| pystray's add returned 0 | `code=NIM_ADD ... source=pystray returned=0` | yes |
| documented-buffer add with the same values returned nonzero | `source=probe code=NIM_ADD ... returned=0` | NO |
| record names at least one differing field | `differs=none`, `differing_fields=0` | NO |

The conditions do not hold. Per the plan's listed outcomes this is "both adds failing on arm64, which refutes the structure as the cause" and also "identical bytes" (here with identical results, both 0). The structure's layout is identical on both rows, to the byte, and the add fails on arm64 with the documented buffer too. The candidate cause (pystray's structure) is refuted by the record. No cause is established by this record. No explanation about the runner's tray host is put forward (owner ruling). Task 3 does not start; no fix is started; the probe stays on `dev` (b2c33163) for the owner's ruling.

Only facts additionally visible in the record, stated without a cause: on arm64 the probe's own `NIM_DELETE` also returned 0, and the smoke judgment on arm64 lists two `SystemTrayIcon` windows both answering `0x80004005`, while on x64 the same job lists one at `0x00000000`.

Deviations:

- [deviation] PLAN-3 asserts (Task 2 Verify, Context "Expectation, not fact") that the structure is the candidate cause and that the arm64 documented-buffer add returns nonzero with at least one differing field. Actual: layout identical on both rows, `differs=none`, documented-buffer add returned 0 on arm64. Done: stopped at the checkpoint, no fix started.

Open items:

- Owner ruling needed: the cause of arm64 step 8's tray failure is not established; the record refutes the structure candidate. No Task 3 or Task 4 work.
- The probe (b2c33163) remains on `dev`; Task 4 removes it, and PLAN-3 stays gated by the owner's ruling.
- Task 3 additionally has no owner-approved CHANGELOG entry (the proposal in PLAN-3 is agent copy).
- The prior record of this plan (Tasks 1 and 2 before the run) is at `reports/plan-3.1.md`.
