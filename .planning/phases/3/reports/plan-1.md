PLAN COMPLETE

Plan: .planning/phases/3/PLAN.md

Tasks: 6 of 6

| Task | Commit | Note |
|---|---|---|
| 1 smoke-windows receives pinned v1.20.1 installer | cc50fd49 | `--previous` arg in smoke.sh; release.yml downloads to `previous/setup.exe` on installer rows via one `PREVIOUS_VERSION` env line |
| 2 upgrade over quit v1.20.1 | b093c359 | step 8 `upgrade_quit`; shared helpers; `uninstall` takes an optional directory |
| 3 upgrade over running v1.20.1 | 33eafd97 | step 9 `upgrade_running`; previous-PID-gone check before the upgraded-app lookup |
| 4 install directory gone after upgrade uninstall | 23f0e888 | `uninstall_upgraded`, 10 s bounded wait |
| 5 smoke fits 15 minutes (replaces the timeout raise) | bb21caaa | `ps -W` based lookups, `taskkill`, cached `lan_address`; `timeout-minutes` stays 15 |
| 5 fix: lookup finds a shell-started process | efa4fe09 | ps.cc strips `.exe` for tracked processes; `running_under` matches both spellings; `<defunct>` dropped |
| 6 installer fix and changelog | d044116d | `CloseApplications=force` in `[Setup]`; `[InstallDelete]` `filesandordirs` `{app}\_internal`; CHANGELOG bullet `- **The Windows app now reinstalls cleanly.**` verbatim under `[Unreleased]` `### Fixed` |

Bite proof (AC3, D-09), run 42205190797 on 7f773b94: smoke-windows bundle row passed; both installer rows (jobs 127851246550 x64, 127851246495 arm64) steps 1-8 passed (fresh install, quit-first upgrade path), then failed at step 9 (upgrade over v1.20.1 left running): `FAIL: step 9 (previous release running): the installer failed over the previous release`. Decisive Setup log lines: "Shutting down applications using our files." / "Some applications could not be shut down." / "Defaulting to Abort for suppressed message box (Abort/Retry/Ignore)" / "User canceled the installation process." / "Rolling back changes." The lookup then found v1.20.1 PID 3688 (`ps -W` line `.../upgrade-running/app/HQPTuner`) still alive. So the cause on the running path is Setup being unable to close the windowless tray app under the default CloseApplications; the quit-first path did not reproduce in this run.

Deviations:
- [deviation] Task 5 asserted a `timeout-minutes` raise (proposal 35); owner ruling: `smoke-windows` stays at 15 and the smoke's Windows process checks are made fast instead. Done as bb21caaa.
- (none for Task 6) The plan's `[Code]` `PrepareToInstall` fallback was not used: the CI evidence shows only that the default `yes` fails to close the app, not that `force` fails. It is the fallback if the green run still shows a v1.20.1 process alive at step 9.

Open items:
- Task 6 is untestable on this host (no ISCC, no Windows runner): `package-windows` compile of `CloseApplications=force` and `[InstallDelete]`, and whether `force` closes the windowless pystray app, are unverified until the owner's push of `dev` (AC1, AC2, AC4, AC6 are CI evidence). Local: `scripts/gate.sh make check` exit=0 (before and after commit; this is the plan's one full-suite run, no `workflow.test_command` set, ran the Makefile `check` target); lease-check ok; `changelog-style` passed.
- Step 8 (quit-first upgrade) passed on the pre-fix installer in the red run, so AC1 was not itself red; AC3 rests on the running path (step 9), per the plan's flagged assumption.
- Untested: whether a silent install over a locked file can hang instead of failing; whether 15 minutes suffices for the arm64 row once step 9 completes (the red run aborted step 9 early).
- Commit 7f773b94 (read-volume hook) left alone. Uncommitted and untouched: `.idle-last.*.json`, `bug.png`, `.planning/phases/3/reports/` (the previous checkpoint report rotated to `plan-1.1.md`).
- Next: owner pushes `dev` for the green run (AC6).
