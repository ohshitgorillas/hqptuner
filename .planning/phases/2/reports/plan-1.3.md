PLAN CHECKPOINT: blocked

Plan: .planning/phases/2/PLAN.md

Tasks: 4 of 5

| Task | Commit | Note |
|---|---|---|
| 1 - installer `/LAUNCH` switch | 8af4d8da | `[Run]` entry: `skipifsilent` replaced by `Check: LaunchWanted`. `make check` exit=0. |
| 2 - smoke: silent install without switch starts nothing | fb194bb2 | `running_under` helper and the step 1 check, no sleep. |
| 3 - smoke: installer-started launch at the network address | 65e38396 | New step 2a (installer targets only). BITE PROOF RECORDED (release run 42159800331, dev at fc9803f5): both installer rows fail at the address check after the loopback check: `FAIL: step 2a: address check: the installer-started app at 172.25.176.1 answered 000` (windows-latest x64) and `... at 172.19.224.1 answered 000` (windows-11-arm arm64). |
| 3 fix - lookup | f690dd88 | `running_under` matches all three path spellings; step 2a polls; `describe_lookup` logs; step 4 requires the lookup to find the running binary. |
| 4 - README wording | fc9803f5 | Owner-approved copy, character for character. |
| 4 fix - bundle lookup | 82f86375 | Run 42159800331 bundle row failed at `step 4: the process lookup does not find the running dist/x64/HQPTuner/HQPTuner.exe`: the row passes a relative path and `cygpath -w/-wl/-ws` keep it relative, so no absolute image path started with it. `running_under` and `describe_lookup` now use `cygpath -aw/-awl/-aws`. Other callers of the conversion in `smoke.sh`: the `/DIR=` and `LOCALAPPDATA`/`BROWSER` conversions take `$WORK` paths or `/usr/bin/true` (absolute); `signed` converts `$TARGET` (can be relative) but hands it to `Get-AuthenticodeSignature -LiteralPath`, which PowerShell resolves against its start directory, the shell's cwd, so it is not the same cause and was left. `bash -n`, `shellcheck -S warning` rc=0; `scripts/gate.sh make check` exit=0. |
| 5 - installer sets listen host / CHANGELOG | NOT COMMITTED | Edits are in the working tree, unstaged: `packaging/windows/hqptuner.iss` (ISPP `#define ListenHost "0.0.0.0"` read by `[Registry]` and by new `InitializeSetup`, which calls `SetEnvironmentVariableW` from kernel32 declared as external, returning Integer) and `CHANGELOG.md` (owner entry verbatim under `[Unreleased]` `### Fixed`). `scripts/gate.sh make check` exit=0, but the pre-commit hook `changelog-trivia` (LLM judge, "changelog entries are new work, not repeats") rejects the commit. |

Failing line (shortest decisive): `CHANGELOG.md:9: Cause narration with prior behavior and debugging sequence` ... `1 line(s) narrate history. State what holds now, or delete the remark.` The flagged line is the owner-approved entry, verbatim.

Deviations: none

Open items:

- BLOCKED on Task 5 commit. The owner-approved entry is flagged by the changelog-trivia pre-commit judge for its clause "listened on the PC itself only, until it was quit and started again from the Start Menu". The copy is the owner's spec and cannot be reworded by the executor; the hook cannot be skipped or edited (`~/dev/CLAUDE.md` 2.3, 11.4; `hqptuner/CLAUDE.md`). Needs an owner decision: approve different wording that passes the judge, or rule on the gate.
- Splitting the commit (iss without CHANGELOG) was not done: the plan and `hqptuner/CLAUDE.md` require the user-visible fix and its entry in one commit, and the fix must be the phase's last commit.
- Owner action still owed after Task 5 is committed: push `dev` for the green `smoke-windows` run (AC6), all three rows (x64 installer, arm64 installer, bundle). The bundle row's step 4 lookup fix (82f86375) is also unverified in CI until that push. `SetEnvironmentVariableW` as an Inno Pascal external and `InitializeSetup` inheritance by the `[Run]` child (D-01 premise) are verified only by that run.
- Full suite not run for the final digest: Task 5 is uncommitted. `scripts/gate.sh make check` (the repo's full gate) was green on the working tree.
- `shellcheck smoke.sh` reports SC2016 infos at the PowerShell script text lines (below `-S warning`).
- Declined fuller shape: no poll in step 1's "starts nothing" check.
- Prior report rotated to `plan-1.2.md`.
- Unrelated dirty paths left alone: `.claude/settings.json`, `.idle-last.*.json`, `bug.png`.
