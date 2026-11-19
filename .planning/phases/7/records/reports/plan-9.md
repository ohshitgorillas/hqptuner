PLAN COMPLETE

Plan: .planning/phases/7/PLAN-9.md

Tasks: 3 of 3

| Task | Commit | Note |
|---|---|---|
| 1 - The probes' daemon plumbing lives once | f067131e | Earlier executor's staged work applied here; module at `scripts/probes/kit/probekit.py` (owner-approved path); seven top-level probes add `sys.path.insert(0, .../ "kit")`, absent_plugin uses `.parent.parent / "kit"`. `make lint` exit 0, py_compile passes, jscpd leaves only the `main()` and result-printing tails between these files, named in the commit message. |
| 2 - The rate probes share their slot lookup and their restore | 3983688b | `index_of`, `mode_index`, `PIN_TARGETS`, `connect_playing`, `restore_live` added to probekit; the three rate probes call them. jscpd leaves one clone, effect~source_effect (usage docstring tail plus the import header that reaches `kit/`), named in the commit message. `make lint` exit 0, py_compile passes. |
| 3 - One console recorder serves the page captures | 9f8c1b5f | Earlier executor's `scripts/snap.py` edit applied: `attach_console` stays in `sweepslide.py`, `snap.py` imports it. jscpd: no snap~sweepslide clone. `make lint` exit 0, py_compile passes. |

Full suite: `scripts/gate.sh make check` (the project's Makefile target; `workflow.test_command` is null). Lint half passes; offline pytest `3676 passed`; JS suite `# pass 5632`, `# fail 12`. The 12 failures are exactly the phase baseline: 8 in `playhead-lag.test.js`, 3 in `playhead-motion.test.js`, 1 in `playhead-scroll.test.js` (e.g. `not ok 2211 - test_a_start_stands_one_delay_behind_the_line_when_the_paint_ran_9_ms_after_the_arrival`). Phase 8's tables, not a regression of this plan; this plan touches no JS.

Deviations: none

Open items:
- 12 JS tests red in the three playhead files, the coordinator-verified phase baseline (phase 8's tables, not touched).
- Task 3 direction: the definition of `attach_console` stays in `scripts/sweepslide.py` and `snap.py` imports it, because `scripts/sweep.py` (outside the lease) already imports it from `sweepslide`.
- Declined as fuller shapes: a shared `run_probe(_run)` wrapper for the `main()` tails (the plan and D-03 keep them as entry points); shared post-process row readers (`_rows`, `_matrix_rows`, `_profile_rows`, `_matrix_body`; jscpd flags no clone on them).
- `settle` in `absent_plugin` now also retries on `OSError`; its refusal text reads "daemon never came back" in every probe (one shared copy); `restore_pristine` passes its 60 tries explicitly. The rate probes' `SETTLE` constant is now `probekit.SETTLE_WAIT` (same 1.0).
- Remaining clone effect~source_effect is the import header, which needs the `sys.path.insert` line the owner approved for reaching `kit/`.
- Report 1 rotated to `plan-9.1.md`. The earlier worktree was left untouched.
