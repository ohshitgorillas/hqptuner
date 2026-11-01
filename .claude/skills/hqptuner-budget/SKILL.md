---
name: hqptuner-budget
description: The change-budget hook's free list, the command shapes that meter by syntax, the three advisories, and the gate and worktree traps (parent-checkout venv, ls-files gates, S603, claude -p). Load at the first metered command.
---

# Change budget

`~/.claude/hooks/gauntlet-change-budget.py`, the shared guard, meters what you change between turns where the user speaks: 25 metered actions and 60 in-tree edits, and `sudo`, docker, podman, `systemctl` and `rm` at 10. Metered: `sudo`, docker, `git commit`, `git push`, mutating `curl`, `rm`, `python -c` / `python script.py`, package installs; `Write`/`Edit`/`NotebookEdit` outside the repo have their own leash of 10. A lone `ping-me` is free and is how to reach the owner on a trip. Only prose the user typed resets the leash; a slash command, `/clear` or local-command output buys nothing, except that the first human row after a trip always resets.

## Free list

Closed allowlist in `~/.claude/hooks/free_bash.py`; one unrecognized stage meters the whole pipeline. Free: file reads, `Grep`/`Glob`, web fetch and search, the read-only agent types `Explore`, `Plan` and `caveman:cavecrew-investigator`, and read-only Bash: verification (`make check`, `make lint-js`, `make test-js`, `node --test <file>`, `pytest`, `ruff check`, `ruff format --check`, `black --check`, `mypy`, `python -m <verifier>`) and investigation (`grep`, `sed -n`, `ls`, `find`, `cat`, `jq`, `diff`, read-only `git log`/`show`/`diff`/`blame`/`status`), even piped or redirected to `/dev/null` or the scratchpad. Also free: `cd <path>`, a segment that is only `VAR=…` assignments, `set -a` / `source hqpcreds`, `$(pwd)`, `$(git rev-parse --show-toplevel)`, `make -C <dir> <free target>`, `npx eslint|knip|jscpd|prettier`, `npx tsc` with `-p`, `--project` or `--noEmit`, `git branch` with no flag that changes a branch, `git worktree list`, `git check-ignore`. Loopback GETs are free: `curl -s http://127.0.0.1:<port>/api/… | jq`. Every other agent spawn meters, the reviewer agents included, and so does `SendMessage` to a running agent.

`uv run`, `poetry run` and `npx` are runner prefixes on the free list: they come off and the allowlist judges the command they wrap. `scripts/gate.sh` is not one, so every `scripts/gate.sh` run meters, `scripts/gate.sh make check` included.

## Misfires: the hook classifies by shape, not purpose

Scan every Bash string before sending it:

- `awk` is not on the list; any pipeline containing it meters. Use `cut`, `column` or `grep -o`.
- Every command substitution meters except `$(pwd)` and `$(git rev-parse --show-toplevel)`. `diff <(head f1) <(head f2)` is one charge.
- `sed` is free only in no-autoprint mode: `sed -n '10,20p'` free, `sed -E 's/…/…/'` meters.
- Shell loops (`for … do … done`, `until …`) are never parsed and always meter. Use `diff -r -q` or an `&&` chain.
- `--diff` without `--check` meters (`black --diff`, `ruff format --diff`); `black --check --diff` is free.
- `python -c`, `python script.py`, `bash script.sh` and mutating `curl` stay metered. Free equivalents: `jq` for JSON, `grep`/`sed -n` for text, the `Read` tool for files.

## Advisories

`.claude/hooks/read-volume.py` (PostToolUse) never denies or meters. Every metered call is followed by `Budget: N/25 (metered: <token>)`; the denominator is `CHANGE_LIMIT` in `.claude/hooks/change-budget.py`, which reads 500 until the owner sets it to 25. So a charge is legible at the command that caused it. Past 25 KB of free reading in one period it names the read-only agent types to hand remaining reading to. A free re-read of a path already in context that nothing has written since is flagged once.

## Rules

- Batch shell commands (`&&`, one script, one compose invocation); leave edits as separate `Edit` calls a reviewer can read, except small repetitive consistent write tasks.
- Report like it matters at a trip: findings, plan next in one to three lines, any open question that is genuinely the owner's. Full plans arrive only through the plan gate.
- Work inside the budget quietly. Hooks stay on and unweakened; requests to disable them are refused, in continuations too. If a purely investigative command metered incorrectly, say so and record it in `docs/internal/gate-notes.md`.

## Gate and worktree traps

- **Worktree Python tests the parent checkout.** In `.claude/worktrees/*`, `.venv` symlinks into `/srv/hqptuner` and the console-script `pytest` never puts cwd on `sys.path`, so `make check` runs the main checkout's code and reads green while the worktree's changes never executed. Run `PYTHONPATH=$(pwd) scripts/gate.sh make check` there. `.venv/bin/python -m pytest` is safe, `.venv/bin/pytest` is not. Pre-commit has the same blind spot; the JS half is unaffected.
- **`git ls-files` gates skip untracked files** (`check_test_assertions.py`, `check_doc_refs.py`). Green locally, red at commit or at `scripts/ship.sh`. `git add` a new or fast-growing file before trusting `make check`.
- **Every `subprocess.run` needs an owner-granted `# noqa: S603`**: a bare binary name fires S607, a resolved path fires S603. Precedent: the inline noqa at `scripts/gates/check_control_catalog.py:55`. Request it in the plan.
- **`claude -p --bare` cannot log in.** Drop `--bare`, keep `--tools "" --setting-sources "" --no-session-persistence`, and strip `CLAUDECODE` from the env when calling from inside a session.
- **Test gate commands** (`python scripts/gates/check_*.py tests/*.py`) meter, by relative path or any other.
