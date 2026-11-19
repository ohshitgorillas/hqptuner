PLAN CHECKPOINT: blocked

Plan: /home/atom/dev/hqptuner2/.planning/phases/7/PLAN-8.md

Tasks: 0 of 4

| Task | Commit | Note |
|---|---|---|
| 1 - The junk-burst feature helpers live once | none | Work done and staged on `cadence/phase-7-plan-8` (8 files), not committed: the pre-commit hook fails on three gates that are red before this plan touches anything (below). Commit message is ready: `refactor(7-8): the junk-burst feature helpers live once`. |

Task 1 evidence (staged: `scripts/junkburst/features/{jbcurves,jbtilt,jbflip,jbloao,jbmirror,jbveto,jbquiet}.py`, `scripts/junkburst/jbpolicy.py`):

- Shared homes: `span_level_db` in `jbcurves` (band span level, called by `band_level_db` and `jbtilt.full_band_level_db`); `album_groups`, `held_out_folds`, `cut_over`, `loao_calls`, `loao_total`, `count_wrong` in `jbloao` (called by `jbloao`, `jbpolicy._loao_calls`, `jbflip`, `jbmirror.veto_loao_any`, `jbveto.veto_loao`); `label_deciles`, `album_readings`, `append_finite`, `fill_medians` in `jbmirror` (called by `jbmirror`, `jbveto`, `jbquiet`); `wrong_side_row` and the now public `veto_forces_real` in `jbpolicy` (called by `jbpolicy` twice, `jbflip` twice).
- `npx jscpd --format python` before and after: every Task 1 pair is gone (jbcurves~jbtilt, jbflip self and jbflip~jbpolicy, jbloao~jbpolicy, jbmirror~jbveto twice, jbmirror~jbquiet). Left: `jbcurves.py` ~ `hqptuner/engine/blockstats.py` [46:113-64:8], the numpy mirror of the scoring code (skill "Engine port"; `blockstats.py` untouched).
- `ruff`, `black`, `xenon`, `vulture`, `lint-imports`: pass. `mypy`: 14 errors, all in `hqptuner/core/{engineread,applyops,loader,manager}.py`, none in `scripts/` or `tests/`.
- `pytest -m "not live" -q tests/test_jbderived.py`: 3 passed. The pre-commit hook also ran the whole offline suite: passed.
- Verify (4), report byte-identity: the corpus `/srv/hqptuner/state/junkburst/` does not exist on this host, so the named run could not use it. I built a deterministic synthetic corpus (24 bursts, 9 albums, seeded numpy, the stamps and album names the code names outright) and a harness that points `jbconfig` at it, both under `/tmp/cad-lYHDYC/h/` and `/tmp/cad-lYHDYC/corpus`, not in the repo. Seven runs (`junkburst_blocks report`, `report --labels`, `jbrunning`, `jbframeonly`, `jbframesteprun`, `jbimagesrun`, `junkburst_print`): 13 output files, byte-identical before and after (paths normalized); two baseline runs are identical to each other. Footprint: one niced python process at a time, about 60 s for the seven runs, under 1 GB.

Pre-commit failures (`PYTHONPATH=$(pwd)`, staged diff of the 8 files; log `/tmp/cad-lYHDYC/gate-pre-commit-K6yU5xfV.log`):

- `mypy`: the 14 errors above (`Cannot determine type of "phase"` and kin), red at HEAD `7ea3e4a1` before any edit.
- `doc-refs`: `docs/spec/eq-export.md:3` names `hqptuner/static/vendor/eqlab/core/eqimport.js` and `eqexport.js`; the `eqlab` submodule is not checked out in this worktree (`git submodule status` shows `-4e24b8d9...`), and checking it out needs the network.
- `suite-time`: `suite 43.2s, bar 37.7s: +5.5s, escalate to owner (--accept)`, with the host at load average near 10 from other executors. This is not mine to accept.

I did not use `SKIP=` or `--no-verify`. The repo `CLAUDE.md` grants red commits for the v2 restructure, but the plan-7 executor's `SKIP=mypy,doc-refs git commit` was refused by the auto-mode classifier and I took that as the answer.

Deviations: [deviation] The plan asserts `make lint` passes (Verify (2) of every task) and a commit can land. Observed: `make lint` stops at mypy with 14 errors in `hqptuner/core/*`, and the commit hook fails on mypy, doc-refs and suite-time, none from this plan. The same will hold for tasks 2 to 4.

Open items:

- Needed to continue: the owner's decision on the three gates (clear or waive mypy x14, submodule `eqlab` in worktrees, `suite-time` bar under host load), or a commit by the owner of the staged Task 1 work. Tasks 2 to 4 not started.
- The worktree needs `PYTHONPATH=$(pwd)`; `.venv` and `node_modules` are symlinks I made to `/home/atom/dev/hqptuner` (ignored, uncommitted).
- Corpus absent at `/srv/hqptuner/state/junkburst/`: Verify (4) of tasks 2 and 3 will also use the synthetic harness. Harness: `/tmp/cad-lYHDYC/h/run_all.sh <tag>` then `/tmp/cad-lYHDYC/h/compare.sh <tag>` against `/tmp/cad-lYHDYC/base`.
- Seen, not touched: `jbframeonly`, `jbframesteprun`, `jbimagesrun`, `jbrunning` write their reports to `scripts/.junkburst-report-*.md` (`parents[2]` of `views/` is `scripts/`), not the repo root the skill names; `jbpolicyyield._yield_veto_forces_real` repeats `veto_forces_real` and is outside this plan's lease.
