# Gate notes

Commands that metered against the change budget but are read-only, for later review of `.claude/hooks/free_bash.py`.

Everything below is resolved as of 2026-08-04 — see the Resolution section at the end for what changed and what deliberately did not.

## 2026-08-03

Running the JS test suite directly is metered, while the make target that runs the identical command is free:

```
node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqlab/eqlab-metrics-side.test.js
node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqlab/
node --import $WT/tests/js/support/vendor-resolve.js --test $WT/tests/js/eqlab/eqlab-plot.test.js
```

`make test-js` is free and expands to exactly the first form with a wider glob (`Makefile:49`). Running one file, or a file inside a worktree, is the narrower operation and the only way to test a single file — `make test-js` has no file argument.

Also metered, read-only file comparison:

```
for f in <paths>; do diff -q "$f" ".claude/worktrees/wheel-guard/$f"; done
diff -u .claude/worktrees/wheel-guard/hqptuner/static/lib/dom.js hqptuner/static/lib/dom.js
```

`diff` reads two paths and writes nothing. `grep`, `cat` and `sed -n` over the same files are free; `diff` is the correct tool for the comparison and costs a budget slot.

Uncertain which of the above the hook actually charged — the trip reported a count, not a list. Worth having the hook name the metered stage.

## 2026-08-04

Six read-only investigation commands (git history archaeology + grep) tripped the budget. `git log` / `git show --stat` appear absent from the free list:

```
git -C /srv/hqptuner log --oneline --all -20 && git -C /srv/hqptuner log --all --oneline --grep -i -E 'tooltip|hover|tip|revert' | head -30
git -C /srv/hqptuner log --all --oneline -i --grep='tooltip' ; git -C /srv/hqptuner log --all --oneline -i --grep='hover' ; git -C /srv/hqptuner log --all --oneline -i --grep='revert'
git -C /srv/hqptuner log --all --oneline -i --grep='filter desc' --grep='description' ; ls /srv/hqptuner/hqptuner/static/components/ | head -40 ; grep -rn -i 'option.*title\|title=.*option' /srv/hqptuner/hqptuner/static/components/ | head
git -C /srv/hqptuner show ec903fc --stat ; git -C /srv/hqptuner log --all --oneline -- hqptuner/static/components/Field.js | head -20
git -C /srv/hqptuner log --all --oneline -S 'option title' ; git -C /srv/hqptuner log --all --oneline -S 'title:' -- hqptuner/static/components/Field.js hqptuner/static/components/controls 2>/dev/null | head ; grep -rn 'option' /srv/hqptuner/hqptuner/static/components/Field.js | head
git -C /srv/hqptuner log --all --oneline -- hqptuner/static/components/controls | head -20 ; ls /srv/hqptuner/hqptuner/static/components/controls ; git -C /srv/hqptuner log -S 'title' --oneline --all -- hqptuner/static/components/controls | head
```

All read-only: `git log`, `git show --stat`, `grep`, `ls`. History archaeology is pure investigation; `git log`/`git show` (read-only forms) belong on the free list.

## Resolution — 2026-08-04

`git` is free as a pipeline head when the subcommand is one of `GIT_READ_SUBCMDS` (`log show diff status blame shortlog rev-parse rev-list ls-files ls-tree cat-file describe name-rev whatchanged`), reached through only `-C <path>`, `--git-dir=`, `--work-tree=` and the flags in `GIT_GLOBAL_FLAGS`. `-c k=v` is excluded on purpose: it can define an alias or a textconv filter that executes. `branch`, `tag`, `stash`, `reflog`, `notes` and `config` are excluded because each has a mutating flag form.

`node` is free as a pipeline head when `--test` is present and no `-e`/`--eval`/`-p`/`--print`/`-i` is — the same trust level `pytest` already has, and the only way to run one JS test file (`make test-js` takes no file argument).

`diff` was already free (`READERS`); what metered was the `for … do … done` wrapper, whose `;`-split leaves `for f in <paths>` as a segment head. Shell loops stay unparsed and stay metered — the free alternatives are `diff -r -q dirA dirB` or `&&`-chained `diff` calls.

The denial now names the calls it charged: `evaluate()` collects a `Tool(first 70 chars)` label per CHANGE-class block and appends `Metered: …` to the reason, so a trip no longer reports a bare count.

Cases are pinned in `ALLOWLIST_CASES` in `.claude/hooks/budget_selftest.py`, which is where the hook's self-test moved so `change-budget.py` stays under the 500-line gate; run it with `python3 .claude/hooks/budget_selftest.py`.

The host's own budget hook (`~/.claude/hooks/command-burst-guard.py`) loads a separate copy of `free_bash.py`. `project_owns_budget()` there stands that guard down for any project shipping `.claude/hooks/change-budget.py`, so exactly one hook meters a call in this repo.

## 2026-09-05

`ruff format --check` reports and writes nothing:

```
ruff format --check hqptuner
```

## Resolution — 2026-09-05

`ruff` and `black` share one branch, free when `--check` is present, plus `ruff check` in its own right. `ruff format --diff` and `black --diff` meter, `--check` being the free form throughout. Pinned in `ALLOWLIST_CASES` as `ruff format --check` free and `ruff format` metered.

`read-volume.py`'s counter line carries a `Rule:` clause naming the standing ruling a metered call walks into. One entry: a `pair.sh merge`, whose failure `make check` in the combined tree answers for free. The table is `.claude/hooks/metered_rules.py`; run it with `python3 .claude/hooks/read-volume.py --self-test`.

Writes under `.claude/worktrees/` resolve inside the repo root, so `classify()` returns `edit` and they are free, which is why no rule covers them.

## 2026-09-05, second pass

The test-writer's instructed gate commands metered, and the lane hook then read them as shell writes naming `tests/`:

```
.venv/bin/python scripts/gates/check_test_assertions.py tests/*.py
.venv/bin/python scripts/gates/check_no_copy_assertions.py tests/*.py
```

`SendMessage` rounds to a reviewer counted toward the leash, a background task notification reset it, and a `plan-reviewer` spawn cost an action while a `spec-reviewer` spawn did not.

## Resolution — 2026-09-05, second pass

A `python` head is free when its first argument is the literal relative path `scripts/gates/check_<name>.py` (`GATE_SCRIPT` in `free_bash.py`): the repo's own verifiers, the same scripts `make check` runs. Relative only, so it resolves against the command's cwd; an absolute or out-of-tree path ending in that suffix meters. The judgment is syntactic, so a script planted under a scratch cwd at that path would run free, the same edge `cd <path> &&` and `make -C <dir>` already carry. `check_md_trivia.py` comes along, which frees its `claude` CLI call and cache write from any agent's shell.

`HARNESS_TOOLS` (`SendMessage`, `Skill`, `Monitor`, `TaskStop`) classify free beside `FREE_TOOLS`, on the `FREE_SPAWN_AGENTS` reasoning: the recipient's tool calls are metered in its own context. `FREE_SPAWN_AGENTS` now holds all six chain agents. `task-notification` is stripped with the other harness wrappers, so a notification row is not the user speaking. Pinned in `budget_selftest.py`.
