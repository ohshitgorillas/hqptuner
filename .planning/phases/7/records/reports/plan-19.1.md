PLAN CHECKPOINT: human-verify

Plan: .planning/phases/7/PLAN-19.md

Tasks: 1 of 2

| Task | Commit | Note |
|---|---|---|
| 1 - Every gate and suite stands where the phase leaves it | none (nothing to commit) | threshold unchanged at 0.18; all four Verify items met, see below |
| 2 - The owner sees the reshaped surfaces on the rebuilt dev build | none | CHECKPOINT human-verify: blocked on the owner's ruling on the rebuild |

## Task 1 evidence

1. `scripts/gate.sh make check`: exit=2, log `/tmp/gate-make-Wncr8jQY.log`. ruff, black, mypy, import-linter pass; pytest `3681 passed, 164 deselected`. JS suite `# tests 5653 / # pass 5641 / # fail 12`. The 12 `not ok` lines (2218-2224, 2230, 2249, 2252, 2253, 2257) are all located in `playhead-lag` (8), `playhead-motion` (3) and `playhead-scroll` (1) test files under `tests/js/model/gauges/`. `git diff 503ddec8 --stat -- <the three files>` prints nothing.
2. `scripts/gate.sh make jscpd`: exit=0, per format python 15 clones (156 lines, 0.18%), javascript 11 clones (0.10%), css 0. `npx jscpd --format python --threshold 0.17` exits 1 (log `/tmp/gate-npx-UdiqkoCj.log`, "too many duplicates"); at 0.18 exits 0. So the floor is 0.18, equal to the current `.jscpd.json` threshold: no change, no commit. `scripts/gate.sh npx jscpd` (all formats): exit=0, `Found 26 clones` (<= 43), log `/tmp/gate-npx-V1BsO0YN.log`.
3. `scripts/gate.sh make test-e2e` with `hqpcreds` sourced (so `HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell`): exit=0, `164 passed, 3681 deselected in 643.65s`, log `/tmp/gate-make-AxDLuwwa.log`. The three named e2e files are in the run.
4. `drawers-source-paint-blank.test.js`: exit=0, log `/tmp/gate-node-H82jf2Qt.log`.

## Task 2 evidence

`bash .claude/task-check.sh` ran once: stopped at `[1/3] make check` with `FAIL: make check is red - fix before any rebuild.`, the same 12 `not ok` lines (5653 tests, 12 fail). No rebuild trigger was written (`state/rebuild.request` absent). No dev build exists for this tree, so no snap.py captures were taken and no URL was handed over.

## Blocking question for the owner (6.1)

- Cause: `make check` is red on the 12 phase 8 playhead tables (UAT item 13), so `task-check.sh` never reaches its rebuild step.
- Evidence: `/tmp/gate-make-Wncr8jQY.log` and `/tmp/taskcheck-plan19.out`, 12 `not ok` lines in the three phase 8 table files; the same 12, nothing else.
- Confidence: high; both runs match, and the three test files are byte-identical to 503ddec8.
- Question: may `hqptuner:dev` be rebuilt from this tree through the trigger and health check `task-check.sh` runs after its gate (steps 2 and 3, writing `state/rebuild.request`), or will the owner rebuild it? On a yes, an executor rebuilds, takes its own `scripts/snap.py` captures read element by element, and hands the URL (http://10.0.0.238:8090) with the surfaces to check: plan 3, Source page meters, every spectrum style and the aurora while music plays; plan 2, the Source drawer spectrogram scrolling; plan 6, each of the nine popovers, the Visual settings drawer and the matrix plot. Then the owner reports UAT items 8, 9, 10.

Deviations: none

Open items:

- Gate-conduct slip: the first `make check` run was piped into `tail -40` (repo rule: a gate is never piped). `scripts/gate.sh` still kept the whole log, and every conclusion above is read from that log.
- `make test-e2e` needs `hqpcreds` sourced (`HQPTUNER_CHROMIUM`); without it all 150 browser tests error at launch (`~/.cache/ms-playwright/chromium-1248` missing). It also runs about 644 s, over the 600 s tool watchdog, so it was run detached (PID 43290, ended, verified with `ps -p`).
- Verify item (2) wording "fails at 0.01 below": at 0.17 the python run exits 1 as required.
