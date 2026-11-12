---
phase: 5
plan: 1
requirements: [TEST-01]
files:
  - tests/matrix/test_matrix_scope.py
  - hqptuner/conf/matrixscope.py
  - tests/engine/test_metering_dial_deadline.py
  - tests/apply/test_volume_config.py
---

# Phase 5: Untested behaviors covered - Plan 1: Python lanes: matrix scope, metering dial, fixed volume

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the Python bullets that need new tests: matrixscope's named-profile refusals, the metering dial's deadline and retry, and the five fixed-volume transitions, and it deletes the dead "no active profile" branch of `matrix_scope`.

## Must be true when done

- Asking for a named matrix profile that is self-closing or never closed is refused, and a test fails when that refusal is removed.
- `matrix_scope` in `hqptuner/conf/matrixscope.py` has no "no active profile" branch, and its `profile` parameter is a `str`.
- A metering dial that never completes is given up after `request_timeout` on the clock and dialed again, and a test fails when either half breaks.
- Enabling, disabling, staging a level alone, an explicit untick and re-enabling fixed volume each have a test at the `presetconf.apply_edits` lane that fails when that transition breaks.
- Each new test's commit names the `make mutate` mutant it kills, and no existing assertion line in `tests/` changed.

## Context

- D-02: these tests characterize existing code, so the bite proof is a mutant, not a revert. Protocol for every task here: run `PYTHONPATH=$(pwd) make mutate MUTATE='--max-children 4 <module glob>'` (say the footprint out loud first: about four cores for several minutes, plus one full offline-suite stats pass; `~/dev/CLAUDE.md` 3.1), pick a mutant of the covered line with `.venv/bin/mutmut show <id>`, run `.venv/bin/mutmut apply <id>`, run the new test file and see it fail on an assertion, then `git checkout -- <source>` and confirm `git diff --quiet -- <source>`. The commit message names each mutant id and the test it turned red. If that mutant was already killed before the new test existed (`.venv/bin/mutmut results` from a run before the test lands lists every survivor), say so in the commit message.
- Worktrees: every Python gate and bite command here carries `PYTHONPATH=$(pwd)`. In a `.claude/worktrees/*` tree without it, `hqptuner` resolves to the main checkout's editable install, so a `mutmut apply` written into the worktree's source is never imported and the bite run passes (repo `CLAUDE.md`, Dev). `mutmut run` itself puts `mutants/` first on `sys.path` and drops the working directory from it, so the prefix leaves `make mutate` measuring its mutants.
- D-01: a negative claim gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate.
- D-06: the metering cases run on the existing `VirtualClock` with `fall_silent()`; no production clock change. D-07: fixed volume is tested at `presetconf.apply_edits` on hand-written XML, never through the 8088 fake.
- D-10: one assertion per test, pure or store lane, `docs/spec/testing.md` binding (read it before writing a test); error types matched, never messages (rule 9).
- Out of scope: the `todo.txt` strikes (Plan 19), any live-daemon test, any new clock seam.

## Tasks

### Task 1: Pin matrixscope's refusal of a bodyless named profile

- **Files:** tests/matrix/test_matrix_scope.py
- **Reads:** hqptuner/conf/matrixscope.py#_profile_body_span, hqptuner/conf/matrixscope.py#matrix_scope, hqptuner/conf/matrixscope.py#ProfileNoBodyError, tests/matrix/test_matrix_scope.py#test_reading_a_matrix_with_no_body_is_refused
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/matrix/test_matrix_scope.py
- **Action:** Behavior the owner wants: scoping a read to a named profile whose `<matrix_profile>` element is self-closing, or opened and never closed, is refused with `ProfileNoBodyError` instead of answered with bytes. Two results, so two cases (the file's existing parametrized live-matrix refusal is the shape to follow, including the trap of a parked, commented body after the self-closing element). Plausible wrong implementations the cases must kill: a scope that reads from the open tag to whatever `</matrix_profile>` comes next (a parked or a later profile's body), and one that falls back to the live matrix. Do this before Task 2 edits the same module, so the mutant apply and revert run on a clean source file.
- **Verify:** `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -q tests/matrix/test_matrix_scope.py` prints exit=0. With a mutant of the `endswith(b"/>") or close == -1` condition in `_profile_body_span` applied by `mutmut apply`, the same run fails on the new cases with an assertion error (`DID NOT RAISE`), and after `git checkout -- hqptuner/conf/matrixscope.py`, `git diff --quiet -- hqptuner/conf/matrixscope.py` succeeds. `git diff -U0 -- tests/matrix/test_matrix_scope.py` removes no assert line. Testing stops at the two refusals; the absent-profile refusal is not part of this bullet.

### Task 2: Delete matrix_scope's dead "no active profile" branch

- **Files:** hqptuner/conf/matrixscope.py
- **Reads:** hqptuner/conf/matrixscope.py#matrix_scope, hqptuner/conf/matrixconf.py#materialize_profile
- **Decisions:** D-05
- **Action:** Remove the `if not profile: return xml` branch from `matrix_scope`, narrow its `profile` parameter from `str | None` to `str`, and drop the docstring clause saying it returns the whole `xml` when no profile is active. The only caller, `materialize_profile` in `hqptuner/conf/matrixconf.py`, already passes a `str` name, so the caller-side delta is zero call sites. Leave `has_profile`, `find_profile_open` and `_profile_body_span` untouched. The `todo.txt` strike of "reads the whole config with no active profile" is Plan 19's, not this task's.
- **Verify:** `grep -n "if not profile" hqptuner/conf/matrixscope.py` prints nothing; `grep -n "def matrix_scope" hqptuner/conf/matrixscope.py` shows `profile: str)`. `PYTHONPATH=$(pwd) scripts/gate.sh make lint` prints exit=0 (strict mypy, vulture and import-linter included), and `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -q tests/matrix` prints exit=0. No test is added: this is a deletion of unreachable code, and the Task 1 cases still pass over the narrowed function.

### Task 3: Pin the metering dial given up at its request_timeout deadline

- **Files:** tests/engine/test_metering_dial_deadline.py
- **Reads:** hqptuner/engine/metering.py#MeteringReader, hqptuner/api/lifespan.py#lifespan, tests/support/virtual_clock.py#VirtualClock, tests/api/test_metering_dial.py, tests/support/fake_metering.py#spawn
- **Decisions:** D-02, D-04, D-06, D-10
- **Pins:** tests/api/test_metering_dial.py
- **Action:** Behavior of `MeteringReader`, which the app constructs with `timeout=cfg.request_timeout`: a dial to the 4322 stream that never completes is given up once its timeout has passed on the clock, neither sooner nor never. A dial that never completes is made with `VirtualClock.fall_silent()`, under which `wait_for` runs out at its deadline; a refused port is the wrong stimulus, since it fails at once and never reaches the deadline. When each dial wait began is readable through `VirtualClock.reply_waits_began()`. Plausible wrong implementations to kill: the dial awaited with no deadline, the deadline taken from a different number than the reader's `timeout`, and a timeout that escapes the loop's handler and ends the reader task. The test writer picks the lane: the reader driven directly on a `VirtualClock` with a playing context and `advisor=True` is the lowest that observes it; the app lane of `tests/api/test_metering_dial.py` is the fallback. No `time.sleep`, no `asyncio.sleep` on a non-zero literal, no literal timeout under 0.5 s (`check_test_clocks`).
- **Verify:** `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -q tests/engine/test_metering_dial_deadline.py` prints exit=0. From `PYTHONPATH=$(pwd) make mutate MUTATE='--max-children 4 hqptuner.engine.metering.*'`, the arg mutant replacing `self._timeout` with `None` in `_stream`'s `self._clock.wait_for(...)` call, applied with `mutmut apply`, turns the new test red on an assertion: under it the wait raises `TypeError` instead of `TimeoutError`, which escapes `run`'s handler and ends the reader task. mutmut 3.8 has no operator for an `except` clause or a tuple's elements, so no mutant of `run`'s exception tuple is sought, and no hand break stands in for one (D-02 allows Python only a `make mutate` mutant). After the revert `git diff --quiet -- hqptuner/engine/metering.py` succeeds. One outcome, one test; the idle and subscriber gating is already pinned by `tests/api/test_metering_dial.py` and is not retested.

### Task 4: Pin a given-up metering dial dialed again after the reconnect backoff

- **Files:** tests/engine/test_metering_dial_deadline.py
- **Reads:** hqptuner/engine/metering.py#MeteringReader, hqptuner/engine/metering.py#RECONNECT_DELAY, tests/support/virtual_clock.py#VirtualClock
- **Decisions:** D-02, D-04, D-06, D-10
- **Pins:** tests/api/test_metering_dial.py
- **Action:** Behavior of `MeteringReader`: a dial given up at its deadline is followed by another dial after the reconnect backoff, the reader neither stopping nor hanging. Same stimulus as Task 3 (`VirtualClock.fall_silent()`), and when each dial wait began is readable through `VirtualClock.reply_waits_began()`. Plausible wrong implementations to kill: no retry ever, a retry with no backoff, and a timeout that escapes the loop's handler and ends the reader task. Same lane and clock constraints as Task 3.
- **Verify:** `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -q tests/engine/test_metering_dial_deadline.py` prints exit=0. From the same `make mutate` run as Task 3, each of these mutants, applied alone with `mutmut apply`, turns the new test red on an assertion: the unary-removal mutant of the `if not self._stop.is_set()` guard before `self._clock.pace` in `run`, under which the reader dials again with no backoff; and the assignment mutant of `delay, wake = RECONNECT_DELAY, self._stop` in `run`'s handler, under which the backoff is never set and no second dial follows. The executor finds each mutant's id with `mutmut show`. `RECONNECT_DELAY = 5.0` itself is a module-level constant, and mutmut 3.8 keeps only mutants inside a function, so no mutant of it is sought and no hand break stands in for one (D-02). After each revert `git diff --quiet -- hqptuner/engine/metering.py` succeeds. One outcome, one test.

### Task 5: Pin the five fixed-volume transitions through an apply

- **Files:** tests/apply/test_volume_config.py
- **Reads:** hqptuner/conf/fixedvol.py#reconcile_fixed, hqptuner/conf/fixedvol.py#_fixed_target, hqptuner/conf/presetconf.py#apply_edits, tests/apply/test_volume_config.py#test_toggling_fixed_volume_leaves_exactly_one_parked_line
- **Decisions:** D-02, D-04, D-07, D-10
- **Pins:** tests/apply/test_volume_config.py
- **Action:** Five behaviors, each its own result, through `presetconf.apply_edits` on hand-written XML and read back from the bytes or `presetconf.read_config`: enabling fixed volume stores the staged level on the live `<fixed>` element; disabling it parks the level in the commented line instead of dropping it; staging the level alone turns the feature on; an explicit `fixed_volume_enabled` untick wins over a level staged beside it; re-enabling after a disable restores the parked level. Follow the file's own convention: the transitions are tested on XML through `presetconf`, never on the 8088 fake's adoption table (the module docstring says why). Plausible wrong implementations to kill: a disable that deletes the line (re-enable then reads 0 dBFS), a level-alone edit that leaves the feature off, and an untick ignored when a level rides with it. The existing parked-line count test stays as it is.
- **Verify:** `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -q tests/apply/test_volume_config.py` prints exit=0. Mutants in `hqptuner/conf/fixedvol.py` (`PYTHONPATH=$(pwd) make mutate MUTATE='--max-children 4 hqptuner.conf.fixedvol.*'`) of `_fixed_target`'s `level_field in fixed_edits or active is not None` line, its `_TRUTHY` read and `reconcile_fixed`'s enabled branch, each applied with `mutmut apply`, turn the matching new test red on an assertion, and `git diff --quiet -- hqptuner/conf/fixedvol.py` succeeds after the revert. `git diff -U0 -- tests/apply/test_volume_config.py` removes no assert line. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0, and `mutants/` is removed once the plan's evidence is recorded.

## Notes

- The plan touches `hqptuner/conf/` and `hqptuner/engine/`, both `testing.strong_areas`; the deeper testing those paths call for is the mutant evidence each task records, and testing stops at the behaviors the bullet names.
- `mutmut apply` writes into the source file; every task reverts with `git checkout -- <source>` before committing, so a source edit and a test land in one commit only in Task 2, which adds no test.
