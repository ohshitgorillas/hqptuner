PLAN CHECKPOINT: blocked

Plan: /home/atom/dev/hqptuner2/.planning/phases/7/PLAN-7.md

Tasks: 0 of 5

| Task | Commit | Note |
|---|---|---|
| 1 - One relay serves both server-sent event streams | none | Work done and staged on `cadence/phase-7-plan-7`, not committed: the pre-commit hook fails on baseline red (below), and the one way past it was refused. |

Task 1 evidence (staged diff: `hqptuner/api/push.py`, `hqptuner/api/routes/meter.py`):

- `relay(feed: Feed)` plus a `Feed` Protocol (subscribe, unsubscribe) now live once in `push.py`; `push` and `meter_feed` both call it; `_events` is gone from both files. Two call sites, one per file.
- `npx jscpd --format python`: 152 clones before, 151 after; the `push.py` self-pair against `routes/meter.py` is gone.
- `pytest -m "not live" -q tests/api`: 340 passed before, 340 passed after.
- `make lint`: red before and after with the same 14 mypy errors (`hqptuner/core/engineread.py`, `applyops.py`, `loader.py`, `manager.py`: `Cannot determine type of "phase"` and kin). Every gate after mypy, run by hand, passes except `check_doc_refs.py` (`docs/spec/eq-export.md:3` names `hqptuner/static/vendor/eqlab/core/eqimport.js` and `eqexport.js`, no such path in this worktree). Both are at HEAD `7ea3e4a1`, in files this plan does not touch.
- `bash .claude/task-check.sh`: exits 1 at its `make check` step on that same mypy red, before any rebuild is requested.
- Pre-commit with `PYTHONPATH=$(pwd)` (the worktree's venv is a symlink to the parent checkout's, which has no `hqptuner/fields`): every hook passes except `mypy` and `doc-refs`. Without `PYTHONPATH` more hooks fail (field-structure, openapi) for that environment reason alone.
- `SKIP=mypy,doc-refs git commit` was denied by the auto-mode classifier ("Undermining Oversight"), although the repo CLAUDE.md grants red commits for the v2 restructure. Not worked around.

Deviations: [deviation] The plan asserts `make lint` and `bash .claude/task-check.sh` pass (Verify of tasks 1, 3, 5, and `make lint` in tasks 2 and 4). Observed: both red at HEAD before any change, on 14 mypy errors in `hqptuner/core/*` and 2 doc-ref errors, none from this plan. The same red is expected on every later task.

Open items:

- Baseline red to clear or waive: mypy `[has-type]` x14 in `hqptuner/core/{engineread,applyops,loader,manager}.py`; `check_doc_refs.py` x2 on `docs/spec/eq-export.md:3`.
- The worktree needs `PYTHONPATH=$(pwd)` on every gate and on `git commit`; `.venv` and `node_modules` are symlinks to `/home/atom/dev/hqptuner` (ignored, uncommitted).
- Tasks 2 to 5 not started.
