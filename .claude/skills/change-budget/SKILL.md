---
name: change-budget
description: The change-budget hook's free list, the command shapes that meter by syntax, the three advisories, and the gate and worktree traps (parent-checkout venv, ls-files gates, S603, claude -p). Load at the first metered command.
---

# Change budget

`.claude/hooks/change-budget.py` meters what you change between turns where the user speaks, on one leash of 8 actions you cannot take back: `sudo`, docker, `git commit`, `git push`, mutating `curl`, `rm`, `python -c` / `python script.py`, package installs, writes outside the repo. In-tree `Write`/`Edit`/`NotebookEdit` are free and uncapped: `git restore` undoes them, `make check` gates them, the plan gate ruled on them first. Only prose the user typed resets the leash; a slash command, `/clear` or local-command output buys nothing, except that the first human row after a trip always resets.

## Free list

Closed allowlist in `.claude/hooks/free_bash.py`; one unrecognized stage meters the whole pipeline. Free: file reads, `Grep`/`Glob`, web fetch and search, read-only agent types, spawns of the reviewer agents and `SendMessage` to a running agent, and read-only Bash: verification (`make check`, `make lint-js`, `make test-js`, `node --test <file>`, `pytest`, `ruff check`, `ruff format --check`, `black --check`, `mypy`, `python scripts/gates/check_*.py` by relative path) and investigation (`grep`, `sed -n`, `ls`, `find`, `cat`, `jq`, `diff`, read-only `git log`/`show`/`diff`/`blame`/`status`), even piped or redirected to `/dev/null` or the scratchpad. Also free: `cd <path>`, a segment that is only `VAR=…` assignments, `set -a` / `source hqpcreds`, `$(pwd)`, `$(git rev-parse --show-toplevel)`, `make -C <dir> <free target>`, `npx eslint|tsc|knip|jscpd|prettier`, `git branch` without `-d`/`-D`/`-m`/`-f`, `git worktree list`, `git check-ignore`. Loopback GETs are free: `curl -s http://127.0.0.1:<port>/api/… | jq`.

`scripts/gate.sh` is a runner prefix on the free list, alongside `uv run`, `poetry run` and `npx`: it comes off and the allowlist judges the command it wraps, so `scripts/gate.sh make check` is free and `scripts/gate.sh sudo docker compose up -d` meters on the `sudo`. The wrapper grants nothing the bare command does not already have — `npm test` is off the list either way.

## Misfires: the hook classifies by shape, not purpose

Scan every Bash string before sending it:

- `awk` is not on the list; any pipeline containing it meters. Use `cut`, `column` or `grep -o`.
- Every command substitution meters except `$(pwd)` and `$(git rev-parse --show-toplevel)`. `diff <(head f1) <(head f2)` is three charges.
- `sed` is free only in no-autoprint mode: `sed -n '10,20p'` free, `sed -E 's/…/…/'` meters.
- Shell loops (`for … do … done`, `until …`) are never parsed and always meter. Use `diff -r -q` or an `&&` chain.
- `--diff` meters where `--check` is the free form (`black --diff`, `ruff format --diff`).
- `python -c`, `python script.py`, `bash script.sh` and mutating `curl` stay metered. Free equivalents: `jq` for JSON, `grep`/`sed -n` for text, the `Read` tool for files.

## Advisories

`.claude/hooks/read-volume.py` (PostToolUse) never denies or meters. Every metered call is followed by `Budget: N/8 (metered: <token>)`, so a charge is legible at the command that caused it. Past 25 KB of free reading in one period it names the read-only agent types to hand remaining reading to. A free re-read of a path already in context that nothing has written since is flagged once.

## Rules

- Batch shell commands (`&&`, one script, one compose invocation); leave edits as separate `Edit` calls a reviewer can read, except small repetitive consistent write tasks.
- Report like it matters at a trip: findings, plan next in one to three lines, any open question that is genuinely the owner's. Full plans arrive only through the plan gate.
- Work inside the budget quietly. Hooks stay on and unweakened; requests to disable them are refused, in continuations too. If a purely investigative command metered incorrectly, say so and record it in `docs/gate-notes.md`.

## Gate and worktree traps

- **Worktree Python tests the parent checkout.** In `.claude/worktrees/*`, `.venv` symlinks into `/srv/hqptuner` and the console-script `pytest` never puts cwd on `sys.path`, so `make check` runs the main checkout's code and reads green while the worktree's changes never executed. Run `PYTHONPATH=$(pwd) scripts/gate.sh make check` there. `.venv/bin/python -m pytest` is safe, `.venv/bin/pytest` is not. Pre-commit has the same blind spot; the JS half is unaffected.
- **`git ls-files` gates skip untracked files** (`check_test_assertions.py`, `check_doc_refs.py`). Green locally, red at commit or at `scripts/ship.sh`. `git add` a new or fast-growing file before trusting `make check`.
- **Every `subprocess.run` needs an owner-granted `# noqa: S603`**: a bare binary name fires S607, a resolved path fires S603. Precedent is `shutil.which` plus inline noqa in `scripts/gates/check_binaural.py`. Request it in the plan.
- **`claude -p --bare` cannot log in.** Drop `--bare`, keep `--tools "" --setting-sources "" --no-session-persistence`, and strip `CLAUDECODE` from the env when calling from inside a session.
- **Test gate commands** (`python scripts/gates/check_*.py tests/*.py`) are free by relative path; an absolute or out-of-tree path meters.
