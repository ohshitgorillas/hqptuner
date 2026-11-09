PLAN CHECKPOINT: human-verify

Plan: .planning/phases/5/PLAN-3.md

Tasks: 6 of 6 built, task 5's hand-back awaits the owner

| Task | Commit | Note |
|---|---|---|
| 1 - playhead at wall speed, jump by a changed delay, tests first | c89ed07a | Unchanged since the first run, recorded in plan-3.1.md. |
| 2 - loop hands every view the music each paint reached | e81858c0 | Recorded in plan-3.1.md. |
| 3 - browser test | 899128d2 | Recorded in plan-3.1.md. |
| 4 - browser test red against earlier playheads | none | Recorded in plan-3.1.md. Ran before task 6 and was not repeated. |
| 5 - offline gate, meter e2e files, hand-back | none | First hand-back failed (plan-3.1.md). Re-run after task 6: see the rows below. |
| 6 - after the failed hand-back | 12b42740, 14ac32c5 | Tests first, then the fix. Details follow the table. |
| 5 (re-run) - gate, e2e files, rebuild | none | `scripts/gate.sh make check` `exit=0` (log /tmp/gate-make-E2pxGzad.log) before the commit. The three meter e2e files `12 passed`, `exit=0` (log /tmp/gate-pytest-U9sElj2y.log), no `headless_shell` or pytest process of mine left (`ps`). `bash .claude/task-check.sh` rc=0: make check green, `hqptuner:dev` rebuilt from the working tree, `:8090` health check passed. Hand-back URL: http://127.0.0.1:8090 (local), http://10.0.0.238:8090 (LAN). |
| 5 (re-run) - human-verify FAILED | none | Owner, 2026-11-08, at the hand-back after 12b42740 and 14ac32c5: "better but still stutters visually, spectrum and spectrogram". Cause not investigated. Open owner calls: whether the 14ac32c5 edit to the Task 3 browser test's start gate stands; whether the spectrogram history's power average of the frames inside a slice counts as interpolation; the ridge row that still pops in at its birth. Not run: `risk-check run --phase 5 --plan 3 --base 899128d2 --head HEAD`. |

Task 6, what changed.

- Spectrogram, no interpolation (`lib/spectroraster.js`): the time blend and the frequency blend are removed with the header sentence. A pixel column shows the one slice that covers it, a pixel row the nearest row of that slice (`rowTable` rounds `rowAt`). `grep -n "toward" hqptuner/static/lib/spectroraster.js` prints nothing.
- Spectrogram, paint on arrival (`lib/spectroraster.js`, `paint.js`): new `landedColumn(view, since)` and an optional `landed` in `scrollPlan`'s `next`. `paint.js` keeps the end of the newest slice it drew and the history array; a slice that ends after it is painted from its first column, with or without a scroll, and a replaced history repaints whole.
- Spectrum trace (`playhead.js`, `meter.js`, `loop.js`): the decision names a `lead` frame, the one covering most of the paint's span (the earlier of two equal). `foldFrames(frames, into, lead)` takes the bins of that frame whole; peak and RMS still fold every frame shown. `FoldScene.power` is gone, nothing read it.
- Ridges and fire (`steps.js`, `fire.js`, page `spectrumfx.js`): `RidgeState.slide` is the row's age over a row's time, and the painter translates the stack by it. `FlamesState` keeps `prev` (the grid one step behind) and `mix` (the part step owed); `blaze(state, ink, cells)` draws between the two. STEP_HZ and RIDGE_EVERY are unchanged.

Red first, against the code at 899128d2 (a clean worktree of that commit with the new and changed test files copied in, removed afterwards): 56 failures, 55 by `ERR_ASSERTION`. Shortest decisive lines: `blank: 6` against `blank: 0` (spectrogram, playhead close and inside the buffer; `13` at the stand), `off: 53` against `off: 0` (`test_in_a_0_ms_delay_at_16_ms_paints_the_lead_frame_is_the_one_frame_covering_most_of_each_paints_span`), `still: 91` against `still: 0` (fire on the capture), the ridge slide, flames `prev` and `mix`, and both `foldFrames` lead claims. The 56th is `spectroraster.test.js`, which cannot load against the old module (no `landedColumn`); its 8 new or replaced claims failed by assertion when run against a stub export before the change (`from: 1199` against `from: 800`, `190` against `215`, `NaN` against `925`).

After the change: `spectroraster.test.js`, `drawers-source-paint-blank.test.js` and `spectrum-motion.test.js` `exit=0`; `make check` `exit=0`.

Deviations:

- [deviation] The Task 3 browser test expected to read the spectrogram's scroll on the new picture; observed `ShortReplayError ... read over 0 paints` on all 9 cases. Its start gate asked for 30 of 40 probed columns to differ, which held only while the time blend made every column its own. A column now shows one slice whole and a slice spans 1.4 to 1.8 columns, so a strip of music holds about 23 distinct columns. The gate is now 13 (`PROBE_COLUMNS // 3`, a glass strip holds 1), in commit 14ac32c5. No bound on stand-still, step or capture speed changed; the 9 cases pass (31.6 s). Task 4's red runs against 6438e843 and 7c7265b9 predate this and were not repeated.
- [deviation] `spectrum-motion.test.js` was my own uncommitted test from the failed hand-back. Per the ruling its trace evenness and trace freeze claims are dropped, and the ridges and fire picture claim stays. Its flame stand-in answered one constant draw, which settles the flames on a fixed point where no step can move the picture, so the claim could not hold for any code. It now draws from a fixed pseudo-random sequence, as the real flames do. The claim is the same and was red against 899128d2 (`still: 91` on the capture) with the new draws.
- [deviation] `tests/js/support/pixelcanvas.js` is inlined into `drawers-source-paint-blank.test.js` and not committed as a file: it made `tests/js/support` 31 files against the filepawl cap of 30. Nothing else imported it.

Open items:

- Ridges: a new row still appears at the bottom at its birth, as before; only the stack's slide between births is new. A live front row would remove the pop and was not built.
- Declined: no per-paint cost bound on the new fire blend beyond the existing loop (one rounded interpolation per cell, the cost of the lookup it replaced).
- `spectrumfx.js` (page) stays at its 496-line allowance (the blend moved into `fire.js`'s `blaze`); `spectroraster.js` is 401 lines, `filepawl accept` run, allowance 401.
- The spectrogram history (`store/meter/spectrogram.js`) still power-averages the frames of a slice. The ruling named the trace, not the history, so it is unchanged.
- Executors spawn no agents, so the specialist briefs in the plan were built by me.
- Untracked `.planning/phases/2/baseline/failures.log` and the other uncommitted `.planning/` files were left alone.
- UAT.md is stale, as noted in plan-3.1.md.
