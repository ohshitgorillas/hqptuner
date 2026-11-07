PLAN CHECKPOINT: human-verify

Plan: .planning/phases/2/PLAN.md

Tasks: 4 of 5

| Task | Commit | Note |
|---|---|---|
| 1 - installer `/LAUNCH` switch | 8af4d8da | `[Run]` entry: `skipifsilent` replaced by `Check: LaunchWanted`. `make check` exit=0. |
| 2 - smoke: silent install without switch starts nothing | fb194bb2 | `running_under` helper and the step 1 check, no sleep. |
| 3 - smoke: installer-started launch at the network address | 65e38396 | New step 2a (installer targets only); address check dies with `step 2a: address check: ...`. |
| 3 fix - lookup | f690dd88 | Run 42157692815 failed at `step 2a: expected one HQPTuner.exe started by the installer, found: ''` (not the bite proof). `running_under` now matches the install directory in all three spellings (`cygpath -w`, `-wl`, `-ws`); before it matched only `-wl`, but the installer is given `/DIR=$(cygpath -w ...)` and a process keeps the spelling it was started with, so a short 8.3 temp path (RUNNER~1) would never match. Step 2a polls the lookup, 10 tries 1 s apart (the `[Run]` entry is `nowait`). New `describe_lookup` prints, on any lookup failure (step 1 hit, step 2a miss or multiple, step 4 miss), the three spellings and every process named like `*HQPTuner*` with PID, parent PID, name and image path. Step 4 now requires `running_under "$APP"` to find the running binary, in all three rows, so step 1's empty answer is proven non-blind on any green run. `cleanup` stops every PID in `INSTALLED_PID`. `bash -n`, `shellcheck -S warning` exit 0; `make check` exit=0. No local test (the helper is Windows-only, PowerShell/CIM); no sleeps added to tests. |
| 4 - README wording | fc9803f5 | Windows and Mac sentences replaced with the owner-approved copy, character for character. `grep -cE "reachable from that (PC\|Mac) only"` prints 0; `md-softwrap.py --check README.md` rc=0 (run via `python3`, the hook file is not executable); `make check` exit=0. |
| 5 - installer sets listen host / CHANGELOG | not started | Waits for the Task 3 red run to be recorded. Approved entry: "- **The Windows app answers other devices from its first launch.** The app the installer starts at the end of setup listened on the PC itself only, until it was quit and started again from the Start Menu." |

Deviations: none

Open items:

- Cause of run 42157692815's empty lookup is NOT established. The CI log's post-job cleanup shows "Terminate orphan process: pid (10100) (HQPTuner)", so the app was running; the lookup missed it. Candidates now covered: path spelling (8.3 short vs long), start lag (poll). Not excluded: some other mismatch (for example `ExecutablePath` null). If the next run fails at the lookup again, the log carries the `lookup under:` / `process ... image [...]` lines to diagnose from.
- Task 3 bite proof pending (owner): push `dev` at fc9803f5 and read `smoke-windows`; expected red on both installer rows at `step 2a: address check:` after the loopback health check passed, bundle row green (step 4's lookup check passes there). A failure elsewhere is not the bite proof. If it runs green, D-01's premise is wrong.
- Task 5 starts after the red run is recorded.
- `shellcheck smoke.sh` reports SC2016 infos at the PowerShell script text lines (below `-S warning`).
- Declined fuller shape: no poll in step 1's "starts nothing" check (immediate lookup; a start delayed past the installer's exit would not be seen there).
