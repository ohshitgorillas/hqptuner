---
phase: 4
plan: 3
requirements: [INTG-05]
files:
  - hqptuner/
  - tests/
  - scripts/
  - docs/
  - .github/
  - types/
  - eslint.config.js
  - .filepawl.toml
  - .gitignore
  - Makefile
  - .pre-commit-config.yaml
  - pyproject.toml
  - .planning/CAPTURE.md
  - .planning/config.json
  - .planning/phases/4/baseline/v2-check.txt
  - .planning/phases/4/baseline/audit.txt
  - .planning/phases/4/baseline/task-check.txt
---

# Phase 4: Integrate into v2 - Plan 3: Merge into v2 and the v2 check

## Goal

`rebuild/integrate` is merged into `v2` by a `--no-ff` merge commit (design step 13), and `scripts/gate.sh make check` exits 0 on `v2` after it.

## Must be true when done

- `git merge-base --is-ancestor rebuild/integrate v2` exits 0, and the merge commit on `v2` has two parents, `v2`'s prior HEAD first, and the subject `merge: rebuild/integrate into v2`.
- `.planning/CAPTURE.md` and `.planning/config.json` are committed on `v2` by name, the read-volume hook todo checked off, before the `v2` check runs.
- `scripts/gate.sh make check` in `/home/atom/dev/hqptuner2` on `v2` prints `exit=0`, recorded in `.planning/phases/4/baseline/v2-check.txt`.
- `planning.mjs test-policy check --root .` returns `ok:true` on `v2`, so the accepted coverage commands are in a `v2` workflow file.
- No commit of the phase changes a coverage threshold, adds a gate exemption, or contains `uv.lock`, `.planning/reads.jsonl` or `.planning/phases/2/baseline/failures.log`, as `.planning/phases/4/baseline/audit.txt` records.

## Context

- Plans 1 and 2 are done first, and `.planning/phases/4/baseline/integrate-final.txt` shows integrate green at its final commit. This plan runs in the main checkout `/home/atom/dev/hqptuner2` on `v2`, not in a Cadence worktree: D-01 makes the merge from the main checkout.
- D-01: a `--no-ff` merge commit on `v2`, subject `merge: rebuild/integrate into v2`, message passing `scripts/gates/check_commit_msg.py` (no dated, iteration, discovery or process narration). A fast-forward is impossible (merge base `21e65b20`). Merging `v2` into integrate is rejected. Precedents for the message shape: `daadaa93`, `87afaf02`.
- D-07, re-run at planning: `git merge-tree --write-tree v2 rebuild/integrate` at `v2` `eb290159` and integrate `fe97fb16` prints one line, tree `17e2ed83`, no conflicts. That tree carries `hqptuner/lanes/__init__.py`, which `v2` lacks (`38b7e28e`) and `hqptuner/presets/__init__.py` imports, so the merge repairs the red `v2` suite. It changes 626 paths against `v2`, all under the directories and root files this plan's `files:` list declares; it changes nothing under `.planning/`, and integrate's `.planning/config.json` equals `v2`'s.
- Hooks: `core.hooksPath` is `~/.config/git/hooks`, which chains `commit-msg`, `pre-commit`, `post-checkout` and `reference-transaction` to the repo's own and has no `pre-merge-commit`. The merge commit runs `commit-msg` only. An ordinary commit on `v2` runs `pre-commit`, whose `pytest-offline` hook is `always_run: true` (`.pre-commit-config.yaml`), so it fails on `v2` until the merge lands. That is why D-08's commit follows the merge. `--no-verify` and `SKIP=` are not used.
- D-08 and D-09: `.planning/CAPTURE.md` and `.planning/config.json` are committed by name before the `v2` check; the read-volume todo is done (`451eaefe`) and checked off in that commit. `uv.lock`, integrate's `.planning/reads.jsonl`, `.planning/phases/2/baseline/failures.log` and stash `b23a78f0` are untouched.
- Footprint for the `v2` check (`~/dev/CLAUDE.md` 3.1), named before it starts: as Plan 1 Context, `pytest-offline` about 39 s on one core, then `test-js` at node's default concurrency, up to 17 processes, run under `nice -n 19` as Plan 1 Context sets. D-06: it writes `.suite-time.v2.json` and `.idle-last.v2.json` into `/home/atom/dev/hqptuner/`; a firing idle or suite-time gate is evidence and those files are not edited, deleted or re-baselined (6.3).

## Tasks

### Task 1: Merge `rebuild/integrate` into `v2`

- **Files:** hqptuner/, tests/, scripts/, docs/, .github/, types/, eslint.config.js, .filepawl.toml, .gitignore, Makefile, .pre-commit-config.yaml, pyproject.toml
- **Action:** In `/home/atom/dev/hqptuner2` on `v2`, re-run `git merge-tree --write-tree v2 rebuild/integrate` first, since both branches have moved since planning. Proceed only if it prints a single tree line, `git cat-file -e <tree>:hqptuner/lanes/__init__.py` succeeds, and `git diff --name-only v2 <tree>` lists no path outside this task's `Files:` and none under `.planning/`; otherwise stop and return what the preview printed. Copy `.planning/CAPTURE.md` and `.planning/config.json` to `${CLAUDE_SCRATCH:-/tmp}` first, since they are dirty and must survive an aborted merge. Write the merge message to a file: the D-01 subject, a body stating what the merge carries onto `v2` (the rebuilt modules and frontend, the ported JS suite, the CI coverage gate and its report check) in present-tense statements that pass `scripts/gates/check_commit_msg.py`, and the Co-Authored-By trailer. Check the file with `.venv/bin/python scripts/gates/check_commit_msg.py <file>` before merging. Run `git merge --no-ff -F <file> rebuild/integrate`. If `commit-msg` refuses, fix the message, not the hook; if the merge stops for any other reason, `git merge --abort`, confirm the two copied files still match their copies, and return the decisive line. Stage nothing by hand and do not touch the two dirty `.planning` files.
- **Verify:** `git merge-base --is-ancestor rebuild/integrate v2` exits 0; `git log -1 --format='%P%n%s' v2` prints two parent hashes, the first the `v2` HEAD before the merge, and the subject `merge: rebuild/integrate into v2`; `git rev-parse v2^{tree}` equals the tree the preview printed; `node /home/atom/.claude/plugins/cache/cadence/cadence/3.11.1/cadence-core/bin/planning.mjs test-policy check --root .` returns `"ok":true`; `git status --short` still shows ` M .planning/CAPTURE.md`, ` M .planning/config.json` and `?? .planning/phases/2/baseline/failures.log`. Testing scope: no test; the merge is proved by git and the policy check.

### Task 2: Commit the dirty planning files on `v2`

- **Files:** .planning/CAPTURE.md, .planning/config.json
- **Action:** In `.planning/CAPTURE.md`, check off the todo about the read-volume hook removal (the `- [ ]` line naming `.claude/hooks/read-volume.py`), changing its checkbox and nothing else; the other lines stay as they are. Keep `.planning/config.json`'s working-tree values as they are. Its arrays are spread across lines, which the `prettier` pre-commit hook (`npx prettier --write`, files `\.(js|json)$`) rewrites, failing the commit with modified files: run `npx prettier --write .planning/config.json` before staging, then confirm with `node -e` that the formatted file parses to a value deep-equal to the scratch copy Task 1 saved, so only whitespace changed. Commit the two files by name on `v2` with a message that passes `scripts/gates/check_commit_msg.py`. The `pre-commit` hooks run in full, `pytest-offline` included (about 39 s on one core, named before the commit): a hook failure is fixed or returned, never skipped.
- **Verify:** `git show --name-only --format= HEAD` lists exactly `.planning/CAPTURE.md` and `.planning/config.json`; `git diff HEAD~1 HEAD -- .planning/CAPTURE.md` changes only the read-volume todo's checkbox from `[ ]` to `[x]` on top of the working-tree content; the committed `.planning/config.json` parses deep-equal to the Task 1 scratch copy and passes `npx prettier --check`; `git status --short` shows only `?? .planning/phases/2/baseline/failures.log`. Testing scope: no test; the commit's own hooks are the check.

### Task 3: Run `make check` on `v2`

- **Files:** .planning/phases/4/baseline/v2-check.txt
- **Action:** In `/home/atom/dev/hqptuner2` on `v2`, with no `PYTHONPATH`, name the footprint in Context and run `nice -n 19 scripts/gate.sh make check` once. Read the log it names. Write `.planning/phases/4/baseline/v2-check.txt` with the command, the `v2` commit, the `exit=` line and log path, the pytest and node summary counts, the JS `# all files` row, and every failing gate's shortest decisive line. A red result is recorded and returned to the orchestrator: a `v2`-only failure needs a fix commit whose files no plan declares, and nothing in a gate, threshold or record file changes to turn it green.
- **Verify:** `.planning/phases/4/baseline/v2-check.txt` quotes `exit=0` at the commit `git rev-parse v2` printed when it ran, and the log path it names exists. Testing scope: no new test; one gate log on `v2`.

### Task 4: Audit the phase's commits

- **Files:** .planning/phases/4/baseline/audit.txt
- **Action:** Check AC5 over the phase's commits: integrate's `fe97fb16..rebuild/integrate` and `v2`'s first-parent, non-merge commits in `eb290159..v2`. Record in `.planning/phases/4/baseline/audit.txt` the two ranges and the result of each check: no change to the `--test-coverage-lines`, `--test-coverage-branches` or `--test-coverage-functions` values in `Makefile` or to `.github/cadence/coverage-policy.json`; no added line carrying an exemption marker (`EXEMPT`, `PRECOMMIT_EXEMPT`, a CSS `-exempt:` or `history-ok:` pragma, `noqa`, `type: ignore`, `eslint-disable`, a `per-file-ignores` or vulture `ignore_names` entry, a loosened `[tool.importlinter]` contract, a raised threshold, a skip-list path); no commit naming `uv.lock`, `.planning/reads.jsonl` or `.planning/phases/2/baseline/failures.log`. Quote any hit with its commit and line. A hit is returned to the orchestrator, not reverted here.
- **Verify:** `git log --name-only --format= fe97fb16..rebuild/integrate` and `git log --first-parent --no-merges --name-only --format= eb290159..v2` contain none of the three paths; `git diff fe97fb16 rebuild/integrate -- Makefile .github/cadence/coverage-policy.json` prints nothing; the record states each check's result. Testing scope: no test; git output is the evidence.

### Task 5: Rebuild the dev container from `v2` and hand it back

- **Files:** .planning/phases/4/baseline/task-check.txt
- **Action:** The merge changes 168 files under `hqptuner/` on `v2`, and the repo `CLAUDE.md` requires `/task-check` and the hand-back URL after any edit there, with the owner's eyes on every visual change before it is called done. Load the `opal-hqptuner` skill for the rebuild trigger paths and the hand-back URL, and the `hand-back` skill. In `/home/atom/dev/hqptuner2` on `v2`, name the footprint (Context, plus the container rebuild), then run `nice -n 19 bash .claude/task-check.sh` once. Write `.planning/phases/4/baseline/task-check.txt` with the command, the `v2` commit, the script's exit code and its last status line, and the hand-back URL. A red gate, a failed rebuild or a failed health check is recorded and returned, never retried past or absorbed. Return the hand-back URL to the orchestrator, which puts it in front of the owner; this task does not call the phase done.
- **Verify:** `.planning/phases/4/baseline/task-check.txt` records exit 0 at the commit `git rev-parse v2` printed, and `curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:8090/` prints `200`. Testing scope: no new test; the task-check run and the health check are the evidence, and the owner's look at the URL is the final say.

## Notes

- CI (AC6, D-10) is read by the owner: the owner opens a pull request from `v2`, and green `check` and `e2e` jobs on it count. No task pushes, publishes a branch or opens a pull request (`~/dev/CLAUDE.md` 11.2).
- The merge brings 168 changed files under `hqptuner/` onto `v2`; Task 5 runs the repo's `/task-check` on it and returns the hand-back URL for the owner.
