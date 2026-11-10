PLAN CHECKPOINT: human-verify

Plan: .planning/phases/5/PLAN-3.md

Tasks: 9 of 9 committed and machine-verified. Task 5's (and Task 6's repeated) hand-back is held by the owner's eyes at the URL.

Earlier reports: plan-3.1.md, plan-3.2.md (tasks 1 to 6), plan-3.3.md (the report as of the render-cost checkpoint, tasks 7 to 9 in full detail, including the causes found and the counts). This file is the final state.

| Task | Commit | Note |
|---|---|---|
| 1 to 6 | c89ed07a, e81858c0, 899128d2, 12b42740, 14ac32c5 | See plan-3.1.md and plan-3.2.md. |
| 7 - contract tests, tests first | 3df4d8cf | Fixture `tests/support/fixtures/safari_paint_schedule.json` and the `playhead.test.js` edit. The `tests/js/contracts/` files rode Tasks 8 and 9 and a68d15ce. |
| 8 - the spectrogram picture keeps contracts 3 and 7 | c395ce9f | `lib/spectroraster.js`, `components/faceplate/drawers/source/paint.js` and the eight Task 7 files these tests need. 524 of 524 passed at the time. |
| 9 - unrelated changes cost the meters nothing | 8fc34281, a68d15ce | 8fc34281: the product fix (13 files under `store/` and `components/`). a68d15ce: `render-cost.test.js` with one more `await quiesce(wire); page.settle();` at the end of `booted()`, the edit the owner approved at the checkpoint, made by the coordinator. |
| (not this plan's) | c8e6f319 | `chore(gates): disable triviajudge while it is reworked`, the owner's order; left alone. |

Verified this dispatch, nothing re-done, nothing new committed:

- Task 9 Verify. Predicted `exit=0`, 5 of 5. Observed `exit=0 log=/tmp/gate-node-O8PM44Sn.log`, `# tests 5`, `# pass 5`, `# fail 0` for `tests/js/contracts/render-cost.test.js`. `git ls-files tests/js/contracts` lists all nine Task 7 files; `git status` shows none of them modified or untracked, so every Task 7 file is committed.
- Task 5 e2e. `HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell scripts/gate.sh .venv/bin/pytest -m e2e --no-cov -q` over the three meter e2e files printed `exit=0 log=/tmp/gate-pytest-hwvolmPn.log`, `12 passed, 1 warning in 72.84s`. Recorded PID 1973276; `ps -p` shows it gone. No `headless_shell` left. (The one `python -m hqptuner` on the host, PID 1890114, is 1 day 9 h old and not mine.)
- Task 5 gate and rebuild. `scripts/gate.sh bash .claude/task-check.sh` (it runs `make check` first, so `make check` was not run a second time) printed `exit=0 log=/tmp/gate-bash-A1VUQpFi.log` and `PASS - gate green, hqptuner:dev rebuilt from the working tree and serving.` The log shows `ruff` "All checks passed!", the offline pytest `3655 passed, 147 deselected` and the node suites passing. Recorded PID 1976469; `ps -p` shows it gone; no pytest, node or make left. `curl` on `http://127.0.0.1:8090/` returned 200 after the rebuild.
- Final full suite. `workflow.test_command` is null, so the project's own gate was the suite: that same `make check`, once, `exit=0`, run on HEAD c8e6f319 (the tree's only difference from a68d15ce is the owner's gate-config commit). No repair round was needed.
- `lease-check --phase 5 --plan 3` printed `ok:true`, 0 staged.

Deviations (standing, from earlier dispatches; Task 9's render-cost one is closed by a68d15ce):

- [deviation] The plan's `files:` lease names the `store/`, `components/`, `lib/` and `model/` directories but not `hqptuner/static/app.js`; not edited (`railNow` is a stable computed, so the unchanged `ChainBody` call no longer subscribes to the whole status).
- [deviation] `filepawl`: `hqptuner/static/store/` is at its 15-file cap, so the `stable` helper went into `store/signals.js`; `filepawl accept` cannot raise an allowance, so `spectroraster.js` was held at 401 lines by moving the overhang widening into `paint.js`.
- Task 7's three earlier deviations stand (contract 7's wording read at one column, contract 6's two clauses as one test, the Safari run starting at the first frame's paint). Details in plan-3.3.md.
- Spelling gate: the British spelling of "color" renamed to the American form in Task 7's `spectrogram-columns.test.js`; a spelling change only.

Open items:

- Human-verify, the owner's: watch the meters, the spectrum and the spectrogram at http://10.0.0.238:8090 (LAN; local http://127.0.0.1:8090) during live playback. The container is rebuilt from the tree at c8e6f319 and serves 200. This is Task 5's Verify and the hand-back Task 6 repeats; no agent can satisfy it and no reviewer was dispatched (they are the owner's to commission).
- Trimmed history on a 300 s window: `store/meter/spectrogram.js` drops slices that start more than 300 s before the newest end, which can drop a slice still inside the window by the delay. A whole paint then shows glass over it where the scrolled picture keeps it until it scrolls off, under a column wide at that window. Not reached by the 30 s window the contracts run. A left-edge repaint was declined: it needs a ranged `rasterize` and a fifth parameter the lint caps at four.
- `faceplateAlerts` carries each failure line's `act` closure; `stable` compares by content, so a same-kind same-text line keeps the closure it first held. The closure for a kind clears the same signal each time, so tapping behaves the same.
- Task 7: the fresh-paint comparison runs every 5th paint and the last; contract 5 reaches preact's mangled render hook `options.__r` and a component's `base`; contract 8 (total scroll) is not in the owner-approved list and was not written; no browser lane for the contracts.
- Cost this dispatch: the render-cost file about 1 s on one core; the e2e files about 73 s with a headless chromium; `task-check` minutes of `make check` plus the root-owned rebuild unit. Host load was 9 to 14 from a pytest in `/home/atom/dev/hqptuner` that was not mine (it had ended before `task-check` started). No process of mine remains.
- Not committed: `.planning/` edits and reports, and the owner's untracked files at the repo root (`fuckedspecrogram.jpg`, `spectstutter.json`).
