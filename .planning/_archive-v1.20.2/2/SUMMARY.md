---
phase: 2
status: complete
completed: 2026-11-06
---

# Phase 2: Windows network access - Summary

The Windows installer now takes a `/LAUNCH` switch and hands `HQPTUNER_LISTEN_HOST=0.0.0.0` to the app it starts, so an installer-started launch answers on the PC's network address, and `smoke-windows` checks that address on every installer row.

## What shipped

- Installer `/LAUNCH` switch: a silent install starts the app only when given it (`Check: LaunchWanted` replaces `skipifsilent`) - `packaging/windows/hqptuner.iss`
- Installer listen host: `#define ListenHost "0.0.0.0"` read by `[Registry]` and by `InitializeSetup`, which sets `HQPTUNER_LISTEN_HOST` in Setup's own environment so the `[Run]` child inherits it - `packaging/windows/hqptuner.iss`
- `smoke-windows` checks: a silent install without `/LAUNCH` starts nothing (step 1); the installer-started app answers at the network address (step 2a); process lookup matches every path spelling and logs what it saw; uninstall waits until the uninstaller is gone - `smoke.sh`
- README: the Mac and Windows sections say "Other devices on your LAN can connect to it" - `README.md:192`, `README.md:204`
- CHANGELOG `[Unreleased]` `### Fixed`: `- **The Windows app now allows connections from other devices on LAN.**` - `CHANGELOG.md`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | 8af4d8da | installer `/LAUNCH` switch |
| 1 | 2 | fb194bb2 | smoke: silent install without the switch starts nothing |
| 1 | 3 | 65e38396 | smoke: installer-started launch checked at the network address |
| 1 | 3 fix | f690dd88 | smoke: process lookup matches all path spellings, polls, logs |
| 1 | 4 | fc9803f5 | README wording |
| 1 | 4 fix | 82f86375 | smoke: bundle lookup gets an absolute image path |
| 1 | 4 correction | 307c3e41 | README wording, owner correction |
| 1 | 5 | 78bba4dd | installer sets the listen host; CHANGELOG entry |
| 1 | 5 fix | 397c076c | smoke: uninstall waits until the uninstaller itself is gone |

Before the phase: `de7958bc` committed the owner's staged phase 1 findings files.

## Deviations

None - plans executed as written.

## Open items

- Signing failed on release run 42165957447 attempt 1 with cause unknown; attempt 2 passed. `packaging/windows/simplysign-login.ps1:146` infers "refused" when no certificate appears and saves nothing on failure, so a repeat would be just as undiagnosable.
- The owner's line "the windows app now reinstalls cleanly" is held for phase 3's changelog.
- The trace holds a stray `phase_start` record against `7f3141ac`; the phase's real anchor is `de7958bc`.
- The `397c076c` uninstall-race cause (Inno's `unins000.exe` handing off to a temp copy and returning at once) is medium confidence, not verified on the runner; the fix waits for both files to be gone either way.
- `shellcheck smoke.sh` reports SC2016 infos at the PowerShell script text lines, below `-S warning`.
- Process note from the executor: the CHANGELOG bullet was written with a python one-off rather than Edit/Write; the landed text is the exact owner string.

## Goal check

The goal is that a fresh Windows install answers on the PC's network address from the first launch on. `8af4d8da` makes the installer start the app on a silent install given `/LAUNCH`, and `78bba4dd` gives that launch `HQPTUNER_LISTEN_HOST=0.0.0.0` through `InitializeSetup`, so the first launch binds beyond loopback. The bite proof shows the check catches the gap: release run 42159800331 had both installer rows fail at `step 2a: address check:` after loopback passed (x64 answered 000 at 172.25.176.1, arm64 at 172.19.224.1). The green proof is release run 42165957447 attempt 2 at `397c076c` (HEAD), where all three `smoke-windows` rows succeeded (`gh run view 42165957447 --attempt 2`: x64 installer, arm64 installer, x64 bundle all `success`). That plausibly delivers the goal for installer-started launches. The check runs on CI runners against their own network address, not from a second device on a LAN, and later launches rely on the `[Registry]` value (HKCU `Environment`, `packaging/windows/hqptuner.iss:46`), which step 2a does not exercise separately.

CI-verified: release run 42165957447 attempt 2, head `397c076c`.
