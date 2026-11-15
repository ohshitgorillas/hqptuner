PLAN COMPLETE

Plan: /home/atom/dev/hqptuner/.planning/phases/11/PLAN-4.md

Tasks: 2 of 2

| Task | Commit | Note |
|---|---|---|
| 1 shared backup_dir module, restore_pristine refuses unsafe dir | 96ba7d4f | tests/test_probe_backup_dir.py; red vs null stub (6 of 7 by assertion) and vs pre-fix restore_pristine (assert (1, False) == (1, True)) |
| 2 three write probes use the shared check | 04c0211e | one case per writer, each red by assertion vs pre-fix writer; absent_plugin loads backup_dir by file path (importlib), no suppression |

Full suite: `scripts/gate.sh make check` exit=0 (workflow.test_command is null; ran the Makefile's `check`), run once after the last commit. Per-task runs were the new test file, ruff, black, mypy and vulture.

Deviations: none

Open items:

- No probe was run, before or after the fix (D-19). Tests run with both `HQPTUNER_HQP_*` variables removed.
- The worktree had no `.venv`, `node_modules` or eqlab submodule content. Set up untracked and gitignored: `.venv/bin` wrapper scripts that prepend the worktree to PYTHONPATH and exec the main venv's tools (pre-commit's `env PYTHONPATH=scripts:...` otherwise drops the worktree and the coverage floor reads every hqptuner file at 0%), a symlinked `node_modules`, and eqlab files copied from the main tree. No hook edited.
- `Verify:` asked for `make check` per task; run once at the end per the contract's single-suite rule. Pre-commit also ran the offline gates on each commit.
- Declined: a uid parameter beyond `prepare(uid=None)`, a configurable mode, and a shared helper that raises `CliError` (each script keeps its own two-line `if backup.problem: raise CliError(...)`, since `CliError` is per-script).
- Location is unchanged at `<PROBE_OUT or tempdir>/hqptuner-probe`, open to the owner as the brief states.
