PLAN CHECKPOINT: human-verify

Plan: .planning/phases/2/PLAN.md

Tasks: 3 of 5

| Task | Commit | Note |
|---|---|---|
| 1 - installer `/LAUNCH` switch | 8af4d8da | `[Run]` entry: `skipifsilent` replaced by `Check: LaunchWanted` (`not WizardSilent` or a `/LAUNCH` argument, matched with `CompareText` over `ParamStr`). `scripts/gate.sh make check` exit=0. ISCC compile happens only in CI `package-windows`. |
| 2 - smoke: silent install without switch starts nothing | fb194bb2 | `running_under` helper (CIM `Win32_Process`, dir via env, `cygpath -wl` so 8.3 short temp paths cannot defeat the prefix match) and the step 1 check, no sleep. `bash -n` and `shellcheck -S warning` exit 0; `make check` exit=0. Characterization of `skipifsilent` behavior: no pre-change state to fail against, so no rule 8 red run. |
| 3 - smoke: installer-started launch at the network address | 65e38396 | New step 2a (installer targets only): uninstall the step 1 install, reinstall with `/LAUNCH` under `env -u HQPTUNER_LISTEN_HOST`, own `LOCALAPPDATA` and `BROWSER`; exactly one process by `running_under`, loopback health wait (30 tries, dies if PID gone), then the address check dying with `step 2a: address check: ...`; stop by Windows PID and confirm gone (10 tries). `cleanup` also stops that PID. Step 7 uninstall factored into `uninstall`. Header comment updated. `bash -n`, `shellcheck -S warning` exit 0; `make check` exit=0. |
| 4 - README wording | not started | Needs owner-approved verbatim wording (agent proposals only so far). |
| 5 - installer sets listen host / CHANGELOG | not started | Needs owner-approved Fixed entry, and Task 3 red smoke-windows run recorded first. |

Deviations: none

Open items:

- Task 3 bite proof pending (owner): push `dev` at 65e38396 (carries Tasks 1 to 3), read `smoke-windows`; expected red on both installer rows at `step 2a: address check:` after the loopback health check passed, bundle row green. A failure elsewhere (process lookup, loopback never answering, ISCC error) is not the bite proof. If it runs green, D-01's premise is wrong.
- Task 4: owner must approve README wording (Windows and Mac sections). Task 5: owner must approve the CHANGELOG Fixed entry.
- `shellcheck smoke.sh` now reports five SC2016 infos (was two): the new PowerShell script-text lines carry `$` in single quotes by design. Below `-S warning`, so the gate level is unchanged.
- Task 2/3 file split: Task 2 and 3 edit the same file; the Task 3 commit carries the `uninstall` refactor of step 7.
- Declined fuller shapes: no retry/poll window for the process lookup (immediate lookup per plan); no extra switches tested beyond `/LAUNCH`.
