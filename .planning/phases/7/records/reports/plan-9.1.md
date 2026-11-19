PLAN CHECKPOINT: structural

Plan: /home/atom/dev/hqptuner2/.planning/phases/7/PLAN-9.md

Tasks: 0 of 3

| Task | Commit | Note |
|---|---|---|
| 1 - The probes' daemon plumbing lives once | none | Implemented and STAGED on `cadence/phase-7-plan-9`, NOT committed: pre-commit `filepawl tree gate` fails, `scripts/probes: 16 files, cap 15`. Every other hook passes (ruff, black, xenon, vulture, mypy, import-linter, offline pytest, coverage floor, jscpd gate, doc-refs, spelling, gates-wired). |
| 2 - The rate probes share their slot lookup and their restore | none | Not started: it extends `probekit.py`, which cannot land. |
| 3 - One console recorder serves the page captures | none | Edit made in the worktree, UNSTAGED, NOT committed (stopped at the checkpoint, not run through the gates as a commit). `attach_console` stays in `scripts/sweepslide.py`; `scripts/snap.py` drops its copy plus `HTTP_ERROR_STATUS` and four playwright type imports, and imports `attach_console` from `sweepslide`. |

Structural blocker. The lease names `scripts/probes/probekit.py`. `scripts/probes/` already holds 15 files directly (the cap), so a 16th fails the filepawl tree gate. `filepawl accept` does not cover a tree cap and the cap is the owner's. Every alternative needs a path the lease does not name.

Proposal: put the module at `scripts/probes/kit/probekit.py` (new subdirectory, one new file, no existing file moves). Top-level probes then add `sys.path.insert(0, str(Path(__file__).resolve().parent / "kit"))` as `absent_plugin/` already does for its parent; `rate/` probes use `.parent.parent / "kit"`. Lease change: `scripts/probes/probekit.py` becomes `scripts/probes/kit/probekit.py`. Alternatives: move the eight daemon-write probes into a subdirectory with `filepawl mv` (many more lease paths, docstring usage lines change), or the owner raises the cap.

Work state in the worktree `/home/atom/dev/hqptuner/.claude/worktrees/wf_c7309df7-1ab-5` (kept, branch `cadence/phase-7-plan-9`, HEAD still `7ea3e4a1`):
- Staged: `scripts/probes/probekit.py` (new) and the 8 probe edits of Task 1 (absent_plugin, cleanup_profiles, daemon_save_post, iir_q, post_reassert, profile_post_process, switch_post_effect, restore_pristine). Commit message drafted at `/tmp/cad-lYHDYC/msg-task1.txt`. After the move only the module's path and the probes' import path lines change.
- Unstaged: `scripts/snap.py` (Task 3).
- Environment, none of it tracked: `.venv` symlink to `/home/atom/dev/hqptuner2/.venv`; `hqptuner/static/vendor/eqlab` filled with a copy of `core/`, `src/`, `package.json` from `/home/atom/dev/hqptuner` (submodule not initialized in the worktree; without it `doc-refs` fails on `docs/spec/eq-export.md:3`). Commits need `PYTHONPATH=$(pwd)`.

What Task 1 does, for the reader of the continuation: `probekit.py` holds HOST, HTTP_PORT, CONTROL_PORT, OUT, ARCHIVE, SETTLE_*; `CliError`, `credentials`, `connect_state` (Control connect plus `State` read; the idle gate stays inline in every probe), `open_http`, `open_raw`, `restart_daemon`, `settle`, `rpc`, `backup`, `save_pristine`, `working`, `push`, `correction`, `poll_correction`, `await_profile`. jscpd on `--format python` after the change: the only clones left between the Task 1 files are the `main()` and result-printing tails (absent_plugin against cleanup_profiles, daemon_save_post, post_reassert and restore_pristine; daemon_save_post against iir_q; post_reassert against profile_post_process and switch_post_effect), the entry points the plan names. `make lint` (with `VENV=/home/atom/dev/hqptuner2/.venv/bin`): ruff, black, xenon, vulture, mypy, lint-imports pass; `filepawl check` passes; `py_compile` over every Task 1 and Task 3 file passes. No probe was run.

Deviations: none

Open items:
- Structural blocker above (tree cap, lease path).
- Task 3 direction: the plan says "the other script imports it". Kept the definition in `sweepslide.py` and made `snap.py` import it, because `scripts/sweep.py` (outside the lease) imports `attach_console` from `sweepslide` and mypy refuses an implicit re-export. Moving the definition to `snap.py` would need a one-line edit in `sweep.py`.
- Declined as fuller shapes: a shared `run_probe(_run)` wrapper for the `main()` tails (the plan and D-03 keep them as entry points); shared post-process row readers (`_rows`, `_matrix_rows`, `_profile_rows`, `_matrix_body`) in `probekit` (jscpd flags no clone on them).
- `settle` in `absent_plugin` now also retries on `OSError` and its refusal text reads "daemon never came back" in every probe (one shared copy); `restore_pristine` passes its 60 tries explicitly.
- Pre-existing, not touched: `make lint` is red in this worktree at `check_doc_refs.py` until eqlab is present (resolved here by the untracked copy above).
