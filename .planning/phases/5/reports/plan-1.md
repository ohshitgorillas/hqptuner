PLAN COMPLETE

Plan: /home/atom/dev/hqptuner2/.planning/phases/5/PLAN-1.md

Tasks: 5 of 5

| Task | Commit | Note |
|---|---|---|
| 1 Pin matrixscope's refusal of a bodyless named profile | b53ccd36 | mutants x__profile_body_span__mutmut_18, _20, _14 each red on DID NOT RAISE; all survived before the test |
| 2 Delete matrix_scope's dead no-profile branch | 4eda6128 | make lint exit=0, tests/matrix 159 passed |
| 3 Pin the metering dial given up at request_timeout | 2e09ec6a | _stream__mutmut_3 red on assert True is False; run__mutmut_22 red on assert False is True |
| 4 Pin a given-up dial dialed again after the backoff | 2fa9d5b9 | run__mutmut_17 and run__mutmut_22 red on the dial-wait tuple |
| 5 Pin the five fixed-volume transitions | 846d3652 | fixedvol mutants _fixed_target 4/5/8/9/17/18, reconcile_fixed 23/27, _remembered_level 1 each red on an assertion |

Full suite: `make check` (workflow.test_command is null, so the Makefile target) exit=0, 3674 passed offline, JS suite and coverage green.

Deviations: none

Open items:

- The main venv's mutmut 3.8.0 crashes on its own stats pass against pytest 9.2.0 (`AttributeError: 'Function' object has no attribute '_nodeid'`, mutmut/runners/harness.py:157). The mutation run used the other existing venv, mutmut 3.7.0 with pytest 9.1.1, via `make mutate VENV=/home/atom/dev/hqptuner/.venv/bin`. Mutant ids in the commits are 3.7.0's. Nothing was installed.
- Mutant `hqptuner.engine.metering.xǁMeteringReaderǁrun__mutmut_22` (the backoff guard inverted) spins the event loop on the existing suite; one mutmut child sat at 100% of a core for about 5 minutes until I killed it by PID (684293, confirmed gone). The new retry test kills it on an assertion, in 0.05 s.
- Equivalent survivors left alone: `_fixed_target` mutants 6 (`.upper()`), 11 (`active is None`) and 12 (`current = None`). The `or active is not None` clause in `_fixed_target` cannot change the result, since `reconcile_fixed` is only called with at least one of the two fields staged. Owner may want it struck as dead code.
- The worktree had no `.venv`, `node_modules` or populated `hqptuner/static/vendor/eqlab` submodule. I symlinked `.venv` and `node_modules` to the main checkout's, and copied `core/`, `src/` and `package.json` of the eqlab submodule from the main checkout so the doc-refs hook could pass. All untracked or ignored; nothing of it is committed.
- `mutants/` is left in the worktree (gitignored): the host hook blocks `rm -rf`, and the plan asks for its removal.
- Lean shape: Task 3 and 4 use the reader directly on a `VirtualClock`, not the app lane; no production code or clock seam changed.
