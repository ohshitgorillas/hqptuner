PLAN COMPLETE

Plan: /home/atom/dev/hqptuner2/.planning/phases/5/PLAN-7.md

Tasks: 5 of 5

| Task | Commit | Note |
|---|---|---|
| 1 Loudness no needle without volume | f3fa34a7 | red under `isBlank(v) ? 0`: actual 0, expected null |
| 2 No dot on shown side | f3fa34a7 | red under sideDots dropping `s !== shown`: test_the_shown_side_holding_an_edit_carries_no_dot |
| 3 Drag stages nothing | f3fa34a7 | red under dragHandle calling edit(): `1 !== 0` |
| 4 No active bound after drop | f3fa34a7 | red under dropBound not clearing draft: `'high' !== null` |
| 5 Dither line / zero DAC bits | 021bfcee | zero case red under `bits >= 0` (`true !== false`); existing alsa/network dither tests already red under both BITS_KEY breaks, no duplicate added (rule 12) |

Final suite: `PYTHONPATH=$(pwd) scripts/gate.sh make check` exit=0 (log /tmp/gate-make-skqq3uol.log).

Deviations:

- [deviation] Task 4 Verify names a break in `dropHandle`; the active bound lives in `dropBound` (draft signal), `dropHandle` touches no bound. Applied the break to `dropBound` (removed `draft.value = null`), test red on assertion; the test drives `moveBound` + `dropBound`.
- [deviation] Task 5 asked for ALSA-not-network and network-not-ALSA cases that bite under BITS_KEY breaks. The existing alsa and network dither tests already turn red under both breaks (D-01 / rule 12), so no duplicate was written. The "does not name the other backend's bits" negative has no plausible wrong implementation (a line naming both), so it is an owner strike candidate. The zero case asserts the zero line carries no "0" digit, because the plan's suggested relations (differs from a set-bits line, equals the no-bits-key line) stay green under `bits >= 0`.

Open items:

- Tasks 1-4 share one commit (f3fa34a7), since they touch one file and hunk splitting is interactive.
- Worktree had no `.venv`, `node_modules` or populated `hqptuner/static/vendor/eqlab` submodule, so pre-commit failed on missing tools. Set up (all gitignored or an uninitialized submodule path, none in any commit): symlinks `.venv` and `node_modules` to the main tree, and copied the main tree's eqlab files into the worktree's empty submodule dir.
- Two bite probes were piped/redirected from `scripts/gate.sh` (`| head -3`, `> /dev/null`) against the repo rule; logs were kept under /tmp and read afterwards.
- Under the dropBound break the leftover draft staged inside `beforeEach`'s `dropBound()` and also turned test_dragging_a_plot_handle_stages_nothing red; a side effect of that break only, green with real code.
