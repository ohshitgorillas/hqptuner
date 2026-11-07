PLAN CHECKPOINT: human-verify

Plan: .planning/phases/3/PLAN-4.md

Tasks: 1 of 3 committed. Task 1 is committed and stops at its human-verify checkpoint: the owner pushes, then the CI record of the runner's desktop decides Task 2.

| Task | Commit | Note |
|---|---|---|
| 1 - CI record of the runner's desktop around the tray registration | 7e10ea57 | Probe rewritten, `release.yml` step renamed with `timeout-minutes: 4`, `.filepawl.toml` allowance entry (494 lines). Re-run before commit: `scripts/gate.sh make check` exit=0; `actionlint` prints only the `xcode-27` finding. `lease-check --phase 3 --plan 4` ok:true on 3 staged paths. Pre-commit hooks passed. |
| 2 - Smoke readiness step | not started | waits on Task 1's CI record |
| 3 - Remove the probe, green run | not started | |

Need: owner pushes 7e10ea57 and runs the release workflow; the probe step's log (`probe:`, `snapshot.*`, `call`, `summary` lines) is the input to Task 2. Uncommitted and left alone: `.planning/phases/3/PLAN-4.md` (lease line, coordinator's), this report, `.idle-last.*.json`, `bug.png`.

## Precondition for Task 1 (lifted)

Owner word, given this session, verbatim: "That's not what I ruled. I ruled against an increase in time for the runner, which forced the agent to restructure it to be faster. I don't care about the internal mechanisms that run, I just don't want it taking 15 fucking minutes to finish." The owner does not object to probing `Shell_TrayWnd`, `explorer.exe` or the runner's tray host; that lifts plan 3's ruling. The owner's real ruling is about runtime: every wait in the probe and in Task 2's readiness step stays as short as the plan's purpose allows, and the arm64 installer row stays well inside its 15 minutes. The probe's waits: rung 1 and rung 2 each wait at most 20 s, polling every 0.5 s, and return at once when any add has succeeded (on x64 the first pystray add succeeds, so rung 1 does not wait); watchdog 90 s; step limit 4 min.

## Probe as built (for the record run)

`probe:` lines: `machine`, `platform`, `pointer_bits`, `python`, `pystray`, `pillow`; `session` (probe's own session id); `snapshot.{initial,after_rung1,after_rung2}.{Shell_TrayWnd,TrayNotifyWnd,process,window,first_logon_open}`; `call` (time, rung, source, NIM code, returned, `last_error=` on any add returning 0); `rung1.waited_seconds`, `rung2.stop` (PID and result), `rung2.waited_seconds`; `summary` with `pystray_first_add`, `first_success=<rung>/<pystray|probe>`, `own_rung1`, `own_rung2`, `stopped`, `explorer_in_probe_session`, `watchdog_fired`. Layout comparison and byte diff removed. Windows-only calls go through `pystray._util.win32.windll.LoadLibrary` (private DLL handles, so pystray's own function types are untouched); mypy strict and ruff pass with no exemption.

Deviations: none
Open items: declined a rung-1 skip flag for x64 - `wait_for_add` already returns at once when an add has succeeded, so x64 does not wait; no extra branch needed.
