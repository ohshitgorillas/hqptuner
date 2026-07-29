---
description: Promote the current release commit along dev -> beta -> main in one metered action. Argument: dev|beta|main [--dry-run]
---

Ship the release commit that is already on `dev`:

```
bash scripts/ship.sh $ARGUMENTS
```

One invocation runs the whole promotion — preflight, `make check`, push `dev`, ff-only merges up the chain, `v<version>` tag on a `main` ship, `/srv` submodule pointer bump — because the change budget meters tool calls rather than work, and the same promotion split across five Bash calls trips the leash mid-flight.

**The script does not commit.** Author the release commit first, with `bash scripts/bump.sh <--major|--minor|--patch> ["body"]` — it reads the current version, increments it in both `pyproject.toml` and `hqptuner/__init__.py`, opens the `CHANGELOG.md` heading under `[Unreleased]`, commits `release: <version>`, and prints the diff to review. That is one metered action, which is what leaves the budget for the ship. Which part to bump is the user's call if it is not obvious from what `[Unreleased]` says; the changelog prose itself is written as `Edit` calls beforehand, so the markdown soft-wrap hook sees it. `ship.sh` refuses a dirty tree.

Promotion between branches is the user's call — run this only when asked, and only for the target they named. `--dry-run` prints the plan and touches nothing.

Report **PASS/FAIL per stage**:

- On PASS — state the version, the target branch, and (for `main`) the tag pushed.
- On FAIL — quote the single decisive `FAIL:` line and stop. The script aborts before pushing anything when `make check` is red or a merge is not fast-forward; do not "fix" a non-fast-forward by forcing or by rewriting history.
