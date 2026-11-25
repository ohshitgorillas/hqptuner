PLAN CHECKPOINT: blocked

Plan: /home/atom/dev/hqptuner2/.planning/phases/9/PLAN-1.md

Tasks: 0 of 1

| Task | Commit | Note |
|---|---|---|
| 1 Remove the four stepped-view cases and what only they use | none | Change made and staged in the worktree on `cadence/phase-9-plan-1`; commit refused by pre-commit hooks for reasons unrelated to the change. |

Task 1 verification (all as predicted):
- `grep -n -e STEPPED_VIEWS -e view_as_painted -e fxPainter -e rasterCanvas tests/js/store/meter/spectrum-motion.test.js` printed nothing.
- `grep -n "spectrumStyle.value =" ...` printed only line 110, the `TRACE` assignment in `beforeEach`.
- `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/spectrum-motion.test.js`: `exit=0`, 5 tests, 5 pass, 0 fail.
- `make check` run in pieces (see below). Python-side ruff, black, xenon, vulture, lint-imports, filepawl and all other `lint` lines after mypy pass. `lint-js` (eslint, prettier, tsc both configs, knip, css gates) exit=0 and `test-js` exit=0 (coverage 97.38 / 92.22 / 91.10) once the `eqlab` submodule was linked in. Offline pytest: 3681 passed, per-file coverage floor ok.

Why the commit is blocked (pre-commit run on the staged file):
1. `suite wall time against its bar` fails: "suite 43.0s, bar 37.7s: +5.3s, escalate to owner (--accept)", judged against `/home/atom/dev/hqptuner/.suite-time.v2.json` ("no bar for this branch yet"). The same gate failed in my `make check` at 44.0s. The change is a JS test file only, so it cannot move the Python suite time. Accepting a bar is the owner's.
2. `tsc (checkJs)`, `knip` and `doc citation gate` fail because the submodule `hqptuner/static/vendor/eqlab` is not initialized in this worktree (`git submodule status` prints `-4e24b8d9...`; its URL is remote, so I did not init it). tsc: `Cannot find module '../../../vendor/eqlab/core/eqimport.js'`; doc-refs: "docs/spec/eq-export.md:3: `hqptuner/static/vendor/eqlab/core/eqimport.js` - no such path". With a temporary symlink to an existing checkout of that submodule, tsc, knip and the JS suite passed; I removed the symlink and restored the empty directory before committing.
3. `mypy` (strict) fails in a full run, 14 errors in `hqptuner/core/{engineread,applyops,loader,manager}.py` ("Cannot determine type of ..."), files this plan does not touch. The pre-commit mypy hook skipped (no Python staged).

I did not use `SKIP=` or `--no-verify`: the owner's red-commit override is scoped to the v2 restructure work, and this is not obviously that work.

Environment left in the worktree: ignored symlinks `.venv` and `node_modules` pointing at the existing checkout's, added only so the gates could run. The staged change is `tests/js/store/meter/spectrum-motion.test.js`; untracked `.planning/records/reads.jsonl` is not mine.

Deviations: none

Open items: pre-existing mypy red in `hqptuner/core` (14 errors); suite-time bar escalation (43-44s vs 37.7s) needs owner `--accept`; worktree has uninitialized `eqlab` submodule so tsc, knip and doc-refs hooks cannot pass here without it.
