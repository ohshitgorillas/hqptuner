PLAN COMPLETE

Plan: .planning/phases/5/PLAN-19.md

Tasks: 5 of 5 (Task 2's strike is withheld by the plan's own rule, see Owner questions)

No commits: the plan's only file is `todo.txt`, which is gitignored (`.gitignore:144`), and Task 5 writes no tracked file. `git diff` on `hqptuner/` and `tests/` is clean after every bite.

| Task | Commit | Note |
|---|---|---|
| 1 lane.py bites + strike | none (todo.txt ignored) | `hqptuner.lanes.live.lane.x__reenumerates__mutmut_2` (`&` to `\|`): 5 of 10 cases of `test_live_reenumeration_report.py` fail on `AssertionError: assert True == False`. `hqptuner.lanes.live.lane.x_mode_already_running__mutmut_2` (`==` to `!=`): `test_a_mode_the_engine_already_runs_is_not_sent_again` fails on `assert '0' == '2'` (`state["rate"]`). Both reverted, `git diff --quiet -- hqptuner/lanes/live/lane.py` succeeds. The lane.py bullet is gone, `grep -c reenumerated todo.txt` prints 0. |
| 2 live store bite | none | NOT struck. Mutants of the `mkdir` call in `_write`: `xǁLivePresetStoreǁ_write__mutmut_5` (`parents=None`), `_7` (`parents` dropped), `_9` (`parents=False`) each fail the `live-snapshots` case, but through `StoreUnwritableError` raised in `save(tmp_path)` (test line 52), before the assertion: zero `AssertionError` in each run. `_6` (`exist_ok=None`) and `_10` (`exist_ok=False`) pass all 8 cases. The claim stays on the list as a D-01 question. Source reverted clean. |
| 3 idle meter loop bite + strike | none | Break: `request(run)` made unconditional in `initMeterLoop`. `test_while_the_engine_is_not_playing_the_loop_asks_for_no_animation_frame` and `test_a_status_poll_that_leaves_the_engine_stopped_asks_for_no_animation_frame` both fail on `AssertionError` (`11250 !== 0`); 15 pass, 2 fail. Reverted, `git diff --quiet -- hqptuner/static/store/meter/loop.js` succeeds. "an idle or stopped loop queues no frame" gone, `grep -c "queues no frame" todo.txt` prints 0. |
| 4 reconcile list | none | Four D-05 strikes gone (grep prints 0). Plan 17's owner ruling (the "a string equal to a numeric base does not differ" claim, struck at the wave 1 checkpoint) also gone. Every other claim a task of Plans 1 to 18 covered gone; the `scripts/abuse.sh close` bullet gone as covered by Plan 2 per the dispatch. Three claims remain, listed under Owner questions. |
| 5 closing gates | none | `PYTHONPATH=$(pwd) scripts/gate.sh make check` exit=0 (log /tmp/gate-make-tTnYfFsg.log). `PYTHONPATH=$(pwd) scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_abuse_bracket.py` exit=0, 14 passed (log /tmp/gate-pytest-lpGdeLkK.log). `git diff 7ac93e5b..HEAD -U0 -- tests/` holds 0 removed lines carrying `assert`. `mutants/` removed, `test -e mutants` fails. `make check` is the plan's one full-suite run; it ran after the last `todo.txt` edit and nothing tracked changed since. |

Mutation runs: `make mutate MUTATE='--max-children 4 hqptuner.lanes.live.lane.*'` and the same for `hqptuner.presets.store.live.*`, each about four cores for a few minutes (disclosed before the run).

Owner questions (claims left on `todo.txt`, none struck):

1. `presets/store/live.py:311 creates missing parent directories`. Bullet: "untested behaviors (triaged)", third line. Source: `hqptuner/presets/store/live.py:306`, `self._path.parent.mkdir(parents=True, exist_ok=True)` inside `saving(...)`. The wrong implementation looked for: no `parents`, `parents=False`, `parents=None` (mutants 5, 7, 9). `test_a_first_save_lands_where_neither_the_directory_nor_its_parent_exists[live-snapshots]` goes red on all three, but as `StoreUnwritableError` from the save call, not on its assertion, because `saving` turns the `FileNotFoundError` into an exception before `assert read(tmp_path) == expected` runs. Test not edited. Question: is a case red by an exception raised in the test body accepted as bite for this claim, or does the owner want it reshaped or struck?
2. `faceplate stores: modes alsa line does not name the net bits nor the network line the alsa bits`. Source: Plan 7 Task 5 report (strike candidate raised under D-01). The positive halves (each backend's bits line) are pinned by the existing alsa and network dither tests, which turn red under both `BITS_KEY` breaks; the negative ("does not name the other backend's bits") has no plausible wrong implementation beyond a line naming both. Question: strike it?
3. `narrowing, prefs, meter, guards: shaperfit source mode raises no third row` (the D-05 half, "lists SDM before PCM", is gone). Source: Plan 5 Task 6 report. Wrong implementation looked for: a family judged more than once (`familiesToJudge` returning `["sdm","pcm","sdm","pcm"]`), already turned red by the existing `..._sdm_conflict` and `..._pcm_conflict` kindCount cases; a third distinct kind needs a third `FAMILIES` entry that does not exist. Question: strike it?

Deviations: none

Open items:

- mutmut 3.8.0 in `.venv` crashes its stats pass against pytest 9.2.0 (`AttributeError: 'Function' object has no attribute '_nodeid'`, `mutmut/runners/harness.py:157`; Plan 1 reported the same). Worked around without installing or editing anything: a one-function plugin in `/tmp/mutshim/nodeid_shim.py` (`item._nodeid = item.nodeid` in `pytest_itemcollected`), loaded for the mutate runs only through `PYTHONPATH=$(pwd):/tmp/mutshim PYTEST_PLUGINS=nodeid_shim`. Mutant ids above are mutmut 3.8.0's. The shim is outside the repo and the venv; the permanent fix (pin mutmut or pytest, or a repo-side plugin) is the owner's.
- Order change, said out loud: `mutants/` was removed before the closing gates rather than after, so `make check` could not collect the stale tree copy.
- `git checkout -- <source>` after each bite fired a pre-commit hook that stashed and restored unstaged files ("Stashing unstaged files ... Restored changes"); `git status` showed the working tree intact afterwards.
- Two `python -m hqptuner` processes (pids 1890114, 3745217) were already running before this dispatch; not mine, left alone. Every process this dispatch started (mutmut, pytest, node, make) has exited.
- Lean shape: no test, shim or plugin was committed; `todo.txt` edits were made as deletions of words only.
