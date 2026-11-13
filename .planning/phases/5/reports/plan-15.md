PLAN COMPLETE

Plan: .planning/phases/5/PLAN-15.md

Tasks: 7 of 7

| Task | Commit | Note |
|---|---|---|
| 1 Plain pipeline set marks no crosspoint generated | 98024b8c | Red on ERR_ASSERTION when `pipelinesView` drops the `block.rows` guard (every row marked generated); reverted. Contrast: existing `test_a_crossfeed_block_marks_its_crosspoints`. |
| 2 Pipeline set grayed under bypassed Matrix engine | e111fa74 | Red on ERR_ASSERTION (notStrictEqual) when `gray` reads '' whatever the bypass; reverted. Contrast is inside the case (running engine). |
| 3 Nyquist tick at the top at the whole band | 145fc422 | Red on ERR_ASSERTION when `meterGrid` measures `f / top` (also existing from-zero and linear cases); reverted. Contrast: existing half-span 48 kHz case. |
| 4 Time axis ends at 0 | 830a43f0 | Both window cases (30 s, 300 s) red on ERR_ASSERTION when `timeTicks` puts 0 at the start (`unshift({at:0})`); reverted. |
| 5 Tick above the top of the view dropped | 1d1f6247 | Red on ERR_ASSERTION when `freqTicks` draws `khzTicks(nyq * 4)` (also existing 44.1 quarter case); reverted. Contrast: existing quarter-44.1 inside-ticks case. |
| 6 Finished switch no longer busy | 97d65033 | Red on ERR_ASSERTION (only that case) when `busy.value = true` in the `finally` of `store/core/ops.js`; reverted. Contrast: existing in-flight busy case. |
| 7 Next switch clears a refusal | 6e80efb5 | Red on ERR_ASSERTION (only that case) when the success `clear()` is commented out in `store/core/ops.js`; reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` printed exit=0 (log /tmp/gate-make-x94c1BSn.log), run on the tree identical to the committed one; counted as the one full-suite run. |

Deviations:

- [deviation] Task 5 Verify names "the filter that drops ticks above the top from the grid's frequency ticks". No such filter exists: `khzTicks` only drops ticks in the top 15% (`f <= nyq * 0.85`), and ticks never exceed the view's top because `freqTicks` is built from the view's top. Removing the 15% filter cannot produce an above-top tick. The plausible wrong implementation used instead: ticks built from a larger axis than the view (`khzTicks(nyq * 4)`). The test asserts no tick has `at > 1`.

Open items:

- Contrasts for tasks 1, 3, 5 and 6 are existing tests, cited above; no duplicate added (rule 12).
- Order change: the earlier dispatch ran 3-7 before 1-2; this dispatch ran 1 to 7 in order, using the earlier patch as draft work and re-running every bite proof here.
- Tasks 1 and 2 (and 3 and 4, 6 and 7) share a file; each was committed alone by staging the file with the later task's test temporarily removed, then restoring it.
- Static analysis: `workflow.lint_command` null; detect-commands offers no lint or typecheck (ruff and mypy not on PATH). `npx eslint` on all four test files printed exit=0. make check covers ruff, mypy, tsc, knip and jscpd.
- No line holding an assertion was removed: `git diff -U0 6b0a1e0e HEAD -- tests` has 0 removed lines (43 insertions, 4 files).
- The earlier dispatch's report is preserved as plan-15.1.md.
