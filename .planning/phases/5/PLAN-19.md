---
phase: 5
plan: 19
requirements: [TEST-01]
depends_on: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
files:
  - todo.txt
---

# Phase 5: Untested behaviors covered - Plan 19: Covered strikes and the list reconciled

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan shows the four already-covered behaviors' tests biting, reconciles the list against Plans 1 to 18, makes the owner's four strikes, and runs the phase's two closing gates.

## Must be true when done

- The tests pinning lane.py's `reenumerated`, the dropped equal mode, `presets/store/live.py`'s parent directories and the idle meter loop each turn red under a recorded mutant or break, and those four behaviors are struck from the list as covered.
- The four owner strikes of D-05 are gone from the list.
- Every behavior Plans 1 to 18 covered is gone from the list; any claim an executor raised as a strike candidate is named to the owner and stays on the list until the owner rules.
- `PYTHONPATH=$(pwd) scripts/gate.sh make check` and `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_abuse_bracket.py` both print `exit=0`, and the phase's diff changes no existing assertion line in `tests/`.

## Context

- D-03: the four covered behaviors and their tests: `tests/live/test_live_reenumeration_report.py` (`reenumerated`), `tests/live/test_live_mode_first.py#test_a_mode_the_engine_already_runs_is_not_sent_again` (a staged mode equal to the running one is dropped), `tests/presets/stores/test_store_first_save.py#test_a_first_save_lands_where_neither_the_directory_nor_its_parent_exists` (`hqptuner/presets/store/live.py` creates missing parents), `tests/js/store/meter/loop.test.js` (an idle or stopped loop queues no frame). The `tests/live/` files run on fakes and are not `live`-marked, so `make mutate` runs them.
- D-02: Python bite is a `make mutate` mutant applied with `.venv/bin/mutmut apply <id>`, the cited test run red on an assertion, then `git checkout -- <source>` and `git diff --quiet -- <source>`. Say the footprint before each mutate run (about four cores for several minutes; `~/dev/CLAUDE.md` 3.1) and cap it with `--max-children 4`. JS bite is a deliberate break of the covered line, reverted.
- D-05: the owner's strikes are matrixscope "reads the whole config with no active profile", "all-stations starts off", "pref off returns options in input order, exactly three", and "shaperfit source mode lists SDM before PCM". `todo.txt` is gitignored (`.gitignore:144`), so no commit carries any edit to it; the plan summary records what was struck and why.
- Worktrees: every Python gate and bite command here carries `PYTHONPATH=$(pwd)`. In a `.claude/worktrees/*` tree without it, `hqptuner` resolves to the main checkout's editable install, so a `mutmut apply` written into the worktree's source is never imported and the bite run passes (repo `CLAUDE.md`, Dev). `mutmut run` itself puts `mutants/` first on `sys.path` and drops the working directory from it, so the prefix leaves `make mutate` measuring its mutants.
- `todo.txt` is owner text: strike a claim by deleting its words from its bullet (a bullet left empty goes whole), and reword nothing else.

## Tasks

### Task 1: Show lane.py's two covered behaviors biting and strike them

- **Files:** todo.txt
- **Reads:** hqptuner/lanes/live/lane.py#apply_now, hqptuner/lanes/live/lane.py#apply_mode_first, hqptuner/lanes/live/lane.py#mode_already_running, tests/live/test_live_reenumeration_report.py, tests/live/test_live_mode_first.py
- **Decisions:** D-02, D-03
- **Pins:** tests/live/test_live_reenumeration_report.py, tests/live/test_live_mode_first.py
- **Action:** Run `PYTHONPATH=$(pwd) make mutate MUTATE='--max-children 4 hqptuner.lanes.live.lane.*'`. Pick one mutant of the line computing the report's `reenumerated` value and one of the `mode_already_running` early return in `apply_mode_first`; apply each with `mutmut apply`, run its cited test file, and see it fail on an assertion; revert. Then delete the lane.py claims from the `todo.txt` bullet.
- **Verify:** Under each applied mutant, `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -q <cited file>` prints a non-zero exit with a failed assertion; after the revert `git diff --quiet -- hqptuner/lanes/live/lane.py` succeeds; `grep -c "reenumerated" todo.txt` prints 0. The plan summary names both mutant ids.

### Task 2: Show the live store's parent-directory creation biting and strike it

- **Files:** todo.txt
- **Reads:** hqptuner/presets/store/live.py#_write, tests/presets/stores/test_store_first_save.py#FIRST_SAVES
- **Decisions:** D-02, D-03
- **Pins:** tests/presets/stores/test_store_first_save.py
- **Action:** Run `PYTHONPATH=$(pwd) make mutate MUTATE='--max-children 4 hqptuner.presets.store.live.*'`, pick a mutant of the `mkdir(parents=True, exist_ok=True)` call in `_write`, apply it, run the first-save test, see its `live-snapshots` case fail on an assertion, revert. The mkdir runs inside `saving(...)` (`hqptuner/unwritable.py`), which turns an `OSError` into `StoreUnwritableError`, so a killing mutant may make the case error before its assertion runs; a mutant of `exist_ok` survives on a first save. An error is not bite (`docs/spec/testing.md` rule 8). If no mutant of that call fails the case on an assertion, do not edit the test and do not strike the claim: leave the claim on the list and raise it to the owner as a D-01 question, naming the mutants tried and their results. Then delete the `presets/store/live.py` claim from the `todo.txt` bullet, leaving the matrixscope claims to Task 4.
- **Verify:** Under the applied mutant, `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -q tests/presets/stores/test_store_first_save.py` prints a non-zero exit with the `live-snapshots` case failed; after the revert `git diff --quiet -- hqptuner/presets/store/live.py` succeeds; `grep -c "creates missing parent" todo.txt` prints 0. The plan summary names the mutant id.

### Task 3: Show the idle meter loop's test biting and strike it

- **Files:** todo.txt
- **Reads:** hqptuner/static/store/meter/loop.js#initMeterLoop, tests/js/store/meter/loop.test.js#test_while_the_engine_is_not_playing_the_loop_asks_for_no_animation_frame
- **Decisions:** D-02, D-03
- **Pins:** tests/js/store/meter/loop.test.js
- **Action:** Break `initMeterLoop` so it asks for an animation frame whatever `enginePlaying` reads, run the loop test file, see its two not-playing cases fail on an assertion, revert. Then delete "an idle or stopped loop queues no frame" from the `todo.txt` bullet.
- **Verify:** Under the break, `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/loop.test.js` prints a non-zero exit with both not-playing cases failed; after the revert `git diff --quiet -- hqptuner/static/store/meter/loop.js` succeeds; `grep -c "queues no frame" todo.txt` prints 0.

### Task 4: Reconcile the list with the owner's strikes and the covered claims

- **Files:** todo.txt
- **Reads:** .planning/phases/5/CONTEXT.md#Decisions, todo.txt
- **Decisions:** D-01, D-05
- **Action:** Delete the four D-05 strikes from their bullets. Delete every claim a task of Plans 1 to 18 covered, by a new test or by an existing test whose bite that task recorded; the plan summaries and commit messages are the record of which. A claim an executor raised under D-01 as a strike candidate stays on the list, and the plan summary names each one with its bullet, its source line and the wrong implementation the executor looked for, as a question for the owner. Reword nothing that stays. If the section is left with no claim, its heading line goes too.
- **Verify:** `grep -c "no active profile\|all-stations starts off\|input order, exactly three\|SDM before PCM" todo.txt` prints 0, and every claim still under the "untested behaviors (triaged)" heading is one the plan summary lists as an owner strike candidate. No `git` change results, since `todo.txt` is ignored.

### Task 5: Run the phase's closing gates

- **Reads:** Makefile#check, tests/e2e/test_abuse_bracket.py
- **Decisions:** D-08, D-10
- **Action:** Run the two gates AC6 names and the AC4 check over the whole phase, then remove the `mutants/` working copy the mutation runs left (gitignored, a full copy of the tree). The task writes no tracked file and no `todo.txt` line: its outputs are the three gate results and the removal of `mutants/`, so it declares no file.
- **Verify:** `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0; `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_abuse_bracket.py` prints exit=0; `git diff 7ac93e5b..HEAD -U0 -- tests/` holds no removed line carrying `assert`; `test -e mutants` fails.
