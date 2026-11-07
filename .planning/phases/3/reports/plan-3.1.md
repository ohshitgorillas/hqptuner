PLAN CHECKPOINT: human-verify

Plan: .planning/phases/3/PLAN-3.md

Tasks: 1 of 4 complete; Task 2 committed, its CI run awaits the owner's push of `dev`

| Task | Commit | Note |
|---|---|---|
| 1 - Revert the NotifyIconSettings diagnostic | faeca70d | `git revert b96a5a7f`. `git diff f476c720 -- packaging/windows/smoke.sh` empty, `grep -c NotifyIconSettings` 0, `bash -n` 0, `shellcheck -S warning` 0, `scripts/gate.sh make check` exit=0 |
| 2 - CI probe of the tray registration | b2c33163 | `scripts/probes/probe_tray_registration.py` (new) and one `build-windows` step (`timeout-minutes: 2`, `continue-on-error: true`, after the venv install). Local: `make check` exit=0, `actionlint` prints only the `xcode-27` finding, the forbidden-name grep prints nothing. The probe's pure helpers (documented buffer, readback, field diff) were exercised on Linux; the Windows path has not run. CI run NOT yet made: no run id, no probe output recorded |
| 3 - Arm64 tray fix | not started | gated on Task 2's run establishing the cause, and on the owner's verbatim CHANGELOG entry |
| 4 - Remove the probe, green run | not started | |

Deviations: none

Open items:

- Task 2 needs the owner's push of `dev` (the executor never pushes). After the run, a continuation records in this file the run id, the commit, both rows' full probe output (lines prefixed `probe:`) and the smoke rows' results, then tests the ESTABLISHED conditions in PLAN-3 Task 2 Verify. Any other outcome goes back to the owner with no fix started.
- The probe prints facts only, as `probe:` lines: `layout.*`, `call` (source, NIM code, cbSize, hWnd, uID, uFlags, returned), `differs`, `summary`.
- Task 3 cannot start without the owner-approved CHANGELOG entry (the proposal in PLAN-3 is agent copy only).
- Not a deviation: the probe ends with `os._exit(status)` so pystray's non-daemon setup thread cannot hold the process open.
- Declined: no unit test for the probe, since PLAN-3 Task 2 states it adds no acceptance check.
- In Task 1 the `make check` output was piped through `tail`, against the `gate.sh` rule; the printed `exit=0` is the gate's own, and Task 2's run was not piped.
