---
phase: 9
status: partial
completed: 2026-11-25
---

# Phase 9: No trace on the other visualizer effects - Summary

The spectrum painter now draws the SVG trace (line, area, shadow) under the Trace style only, with one yes or no per style, a spec sentence stating the rule and the stepped-view trace test cases retired; the owner's check then ruled that Fade does get a trace, so the Fade half goes back to planning.

## What shipped

- `showsTrace(picked)`, one yes or no per spectrum style, backed by `TRACE_STYLES` - `hqptuner/static/components/faceplate/page/sourcepaint.js`
- The painter hands `paintTrace` no columns for the line and the shadow under any style where `showsTrace` is false; the canvases still get the real line - `hqptuner/static/components/faceplate/page/sourcepaint.js`
- A six-row style table and 24 painter cases (Bars, Ridges, Fade, Flames show none; Trace shows all three; switching away and back) - `tests/js/components/faceplate-page/sourcepaint-section.test.js`
- The four stepped-view trace cases and what only they used removed; the five Trace cases unedited - `tests/js/store/meter/spectrum-motion.test.js`
- The owner-approved trace rule sentence, verbatim - `docs/spec/faceplate.md:93`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | e1098576 | Retire the stepped-view trace cases |
| 2 | 1 | c6a13290 | One yes or no per spectrum style for showing the trace |
| 2 | 2 | fd8296c8 | The painter draws the trace under the Trace style only |
| 3 | 1 | e5ad6548 | The trace rule sentence in the faceplate spec |
| 4 | 1 | none | Owner check done; not met as written for Fade |

## Deviations

- [deviation] Plan 4: the plan asserted (D-01, D-03, D-04, SPEC-02 as reworded) that Fade shows no trace line, fill or shadow. At the hand-back URL the owner answered, verbatim: "y'know what, that's my mistake... Fade does get a trace. the rest pass." Coordinator's reading, an interpretation and not the owner's words: the Fade style should show the SVG trace, so the phase rule that Fade shows none was the owner's own mistake. Nothing was changed in code, tests or spec; the finding goes back to planning with the style named, Fade. No commit.
- Run path, not plan content: plans 1 and 3 first ran side by side in worktrees and both stopped with nothing committed. Plan 1 was refused by pre-commit in its worktree (the `hqptuner/static/vendor/eqlab` submodule was uninitialized there, and the suite ran 43.0s against a 37.7s bar while both executors ran gates); plan 3 stopped for owner approval of its sentence. Both then ran one at a time in the main tree, where pre-commit passed unbypassed. The first runs' reports are `records/reports/plan-1.1.md`, `plan-3.1.md` and `plan-4.1.md`.

## Open items

- Fade ruling goes back to planning. Under the coordinator's reading above, these currently say Fade shows no trace and would change: `TRACE_STYLES` and the painter in `hqptuner/static/components/faceplate/page/sourcepaint.js`, the style table in `hqptuner/static/store/ui/prefs.js` (around :176-178), the style-table and painter tests under `tests/js/components/faceplate-page/`, the sentence at `docs/spec/faceplate.md:93`, `docs/spec/design-system.md:34-35`, `todo.txt:18`, CONTEXT D-01, D-03 and D-04, and the phase goal wording. Spec and user-facing wording changes need owner-approved copy. CONTEXT.md was not annotated here, because the reading is not yet confirmed by the owner.
- Plan 4 task 1 is not done as written: its Verify requires no trace under Fade.
- The owner's reply ("the rest pass") does not name the second color suite the check asked for beside Borealis.
- Plan 4's own captures were taken with hqplayerd idle; the owner's check with music playing is the AC7 evidence, and Aurora's D-10 evidence is the owner's eyes.
- Plan 2: `npm test`, named in task 2's Verify, does not exist (`package.json` has no `test` script); the JS suite ran as `make test-js` inside `make check`.
- Plan 2: one `scripts/gate.sh` run was piped through `head` by mistake in task 1, against the repo rule; its log was read in full afterward.
- Plan 3, out of scope and untouched: Flames is missing from the style list on the Source item's first line in `docs/spec/faceplate.md`.
- The interaction of the plans went unreviewed: the `diff` and `phase_diff` review gates are `off`. Each plan's committed range read clean on the risk check.

## Goal check

Partly. `git log --oneline 62643aaa..HEAD` shows four commits: `c6a13290` and `fd8296c8` make the painter draw the trace under the Trace style only, `e5ad6548` states the rule at `docs/spec/faceplate.md:93`, and `e1098576` retires the test cases that read the trace under other styles. The dev build serves that painter: `cmp` of `http://127.0.0.1:8090/components/faceplate/page/sourcepaint.js` against the working tree file reported no difference. The owner's check passed Bars, Ridges, Aurora, Flames and Trace ("the rest pass"), so the goal as written is delivered for those. It is not delivered as the owner now wants it: the owner ruled "Fade does get a trace", and the commits withhold it under Fade (plan 2's report: 12 cases over Bars, Ridges, Fade, Flames holding no drawing). The goal wording itself is what the ruling changes.

complete locally, not CI-verified
