---
phase: 9
status: complete
completed: 2026-11-25
---

# Phase 9: No trace on the other visualizer effects - Summary

The page spectrum now draws each part of the SVG trace by style: Trace shows the line, the filled area and the shadow, Fade shows the line alone, and Bars, Ridges, Aurora and Flames show none; the faceplate spec states that rule, and the owner's check passed every style, with Fade reworked during the check.

This is the second run of the phase. The first run's summary is in git at `c6803f7c`; its plans were replaced after the owner ruled that Fade does get a trace.

## What shipped

- `tracePartsOf(picked)`, one answer of line, area and shadow per spectrum style - `hqptuner/static/components/faceplate/page/sourcepaint.js`
- The painter draws each of the three trace paths from its own answer; `showsTrace` and `TRACE_STYLES` are gone - `hqptuner/static/components/faceplate/page/sourcepaint.js`
- The per-style table of trace parts and the painter cases for each style - `tests/js/components/faceplate-page/sourcepaint-section.test.js`
- The trace rule in owner-approved wording, reworded once more for Fade's line-only ruling - `docs/spec/faceplate.md:93`
- By owner order at the eyes-on check, as `/cad-task` `fade-thin-line-dim-halo` (record at `.planning/tasks/fade-thin-line-dim-halo/RECORD.md`): the flames painter in its own module `hqptuner/static/components/faceplate/page/spectrumfire.js`; Fade's halo laid on the plot at 0.5 of its canvas's strength; the halo fading out at every paint rate (`hqptuner/static/model/gauges/meter/steps.js`); the halo starting clear on a change of color suite or accent (`hqptuner/static/components/faceplate/page/spectrumfx.js`)

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | 45344e2f | One function says which parts of the trace each style shows |
| 1 | 2 | 15632c94 | The painter draws each part of the trace as its style says |
| 2 | 1 | c4d30c07 | The faceplate spec says which parts of the trace each style shows |
| 3 | 1 | none | Owner's eyes-on check of all six styles; verification only |
| task | - | b128b897 | The flames painter moves to its own module |
| task | - | 56954610 | Fade's halo is dimmed so its trace can be told from it |
| task | - | 3a672f27 | Fade shows the trace's line alone, over a halo at half strength |
| task | - | 9cc2b681 | Fade's halo fades out at every paint rate |
| task | - | 48230645 | Fade's halo follows a change of color suite |

## Deviations

- [deviation] Plan 3, refuting D-04 and D-05 (and AC7, AC8): they say Fade shows the trace's line and filled area. At the check the owner ruled "kill the fill under the trace", so Fade shows the line alone, with no filled area and no shadow. Done in `3a672f27`, with the spec sentence reworded in owner-approved wording. D-04 and D-05 are annotated in `CONTEXT.md`.
- Run path, not plan content: plans 1 and 2 ran side by side in worktrees and both stopped at a decision. Plan 1 would not rebuild the dev build from a worktree; the owner handed the rebuild to plan 3. Plan 2 waited for owner approval of its sentence, which the owner gave as written. Both were closed by a continuation in the main tree.
- Run path: the owner's Fade orders were carried out by the coordinator as a `/cad-task` between plan 3's checkpoint and its close, so five commits in the phase range are the task's and not a plan's.
- The painter's filepawl allowance was set to 412 by hand in `.filepawl.toml`, by owner ruling of 2026-11-25, because `filepawl accept` only lowers an allowance.

## Open items

- The owner has not yet looked at the last fix, the Fade halo following a change of color suite (`48230645`). Their words on reporting it: "fix that and we're golden."
- Flames: the owner said it "has issues that I want to address in a separate phase"; it passes this round.
- The owner's reports do not name the two color suites; the hand-back named Borealis and Inferno.
- Range keys did not render in the executor's headless captures; the owner's browser is the evidence and the owner raised no defect there.
- No test pins the strength of Fade's halo. The owner ruled it a look, not a behavior.
- Plan 2's executor piped one gate run into `tail`, against the repo rule; exit and log path were captured.
- Plan 1's continuation dispatch was closed in the trace before its usage figures arrived: 28968 tokens, 7 tool calls and 349649 ms are not in the run record.
- The interaction of the plans went unreviewed: the `diff` and `phase_diff` review gates are `off`. Each plan's committed range and each task commit read clean on the risk check.
- `.planning/ROADMAP.md` still names Borealis as a visualizer effect in the phase 9 goal; D-01 governs.
- `CHANGELOG.md` has no entry for the Fade changes; the changelog is the owner's alone until handed back.

## Goal check

Yes, as the owner now reads the goal. `git log --oneline 572852cb..HEAD` shows eight commits. `45344e2f` and `15632c94` make the painter draw each trace part by style, and `3a672f27` narrows Fade to the line: `tracePartsOf` at `hqptuner/static/components/faceplate/page/sourcepaint.js:134` answers whole for `trace`, line only for `fade` and none for the rest. `docs/spec/faceplate.md:93` states the same rule. The dev build serves that code: `cmp` of `http://127.0.0.1:8090/components/faceplate/page/spectrumfx.js` against the working tree file reported no difference at `48230645`. The owner's words at the check are the evidence for the six styles: "The other styles, besides Flames, are fine", Flames "at least passes this round's revisions", and on Fade after the fixes "This is great!". One thing is not yet evidenced: the owner has not seen the final halo fix. The goal's own wording ("on the spectrum only") no longer matches the outcome, since Fade keeps the trace's line by owner ruling.

complete locally, not CI-verified
