PLAN COMPLETE

Plan: .planning/phases/9/PLAN-2.md

Tasks: 4 of 4

Full suite: `scripts/gate.sh make check` exit=0 (Makefile target; workflow.test_command is null).

| Task | Commit | Note |
|---|---|---|
| 1 - bytes that are not a readable settings archive never replace a stored copy | f63e2c9c | `is_settings_archive` (list_members) gates `_write_backup`; parametrized red/green test (empty, not-a-zip); two superseded tests replaced |
| 2 - safety copies are dated and the five most recent are kept | 930890d7 | `pre-apply-settings-<UTC stamp>-<serial>.zip`, exclusive create, `copies_to_prune` decision, `KEPT_BACKUPS`; three retention tests red against the single slot; superseded http_apply and audit_wiring tests replaced; CHANGELOG Security bullet verbatim |
| 3 - each user operation writes one copy, before its first restore | 32bd0c24 | `restore.apply` writes the copy from the first pass's backup via `persist_backup_for_restore(backup, held=)`; `switch` replaces `switched`; four tests (plain, loaded-preset, unloaded, pre-apply content) red after Task 2 |
| 4 - the architecture records the safety-copy rule | 9e6fbfc7 | one paragraph in docs/architecture.md after the write-lock paragraph |

Deviations: none

Open items: restore.apply's `switched: bool` became `switch: str | None` (None no switch, empty unload, name load): `.filepawl.toml` holds restore.py at 418 lines and no allowance is approved for this plan, and a second parameter would have grown the file past it; ApplyOps still passes `switch_to` down and restore derives "holds its copy" as `bool(switch)`, which is false for an unload.

Open items: `persist_backup_for_restore` now takes `held` and answers a bool (whether the operation holds its copy), so restore.apply's loop needs no branch (xenon rated `apply` C with an `if`).

Open items: a wall clock that steps backward can date a new copy before five newer ones, and the prune then removes it at once; declined, as the plan names no such case and the dated name is the plan's choice.

Open items: `filepawl accept` was denied by the permission system when filepawl printed "shrank" for restore.py, so restore.py was kept at exactly 418 lines instead; no allowance changed, `.filepawl.toml` untouched.
