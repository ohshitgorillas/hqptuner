---
phase: 9
plan: 1
requirements: [SPEC-02]
files:
  - hqptuner/static/components/faceplate/page/sourcepaint.js
  - tests/js/components/faceplate-page/sourcepaint-section.test.js
  - .filepawl.toml
---

# Phase 9: No trace on the other visualizer effects - Plan 1: Fade draws the trace's line and fill

## Goal

The trace is drawn whole on the spectrum, its line and fill on Fade, and on none of the other visualizer effects. In the page Source section, Trace shows the line, the filled area and the falling shadow; Fade shows the line and the filled area and no shadow; Bars, Ridges, Aurora and Flames show none of the three, whatever the color suite.

## Must be true when done

- Which parts of the trace a style shows is stated per style and per part: Trace the line, the area and the shadow; Fade the line and the area; Bars, Ridges, Aurora and Flames none (AC2).
- Under Fade, a paint of a playing frame draws the line (`.strace`) and the area (`.sarea`) and leaves the shadow (`.shold`) with no drawing (AC8).
- Under Bars, Ridges or Flames, a paint of a playing frame still leaves all three paths with no drawing (AC1), and under Trace it still draws all three (AC3).
- A switch from Trace to Bars still leaves no trace on the next paint, and a switch back still draws it (AC4).
- The level bars, the VU needles, Fade's own line on the effects canvas and the aurora canvas paint as before; the SVG, its grid, scales and Range keys stay under every style.

## Context

- The tree at HEAD already withholds the whole trace under every style but Trace: `TRACE_STYLES` and `showsTrace` in `sourcepaint.js`, wired in `sourcePainter`'s `paint`, pinned by a six-row `showsTrace` table and by the Bars/Ridges/Fade/Flames leaves-empty cases in `sourcepaint-section.test.js`. This plan changes only the Fade answer and the rule's shape (D-04, D-05 as reworded).
- The route stays the painter writing empty paths (D-02, D-06, D-07): `SourceMeter.js` and `meter.css` are not touched, and the path elements stay in the markup.
- `sourcepaint-motion.test.js` declares its own local `CANVAS_STYLES` and imports nothing of that name from the source, so the CONTEXT assumption that reshaping the source's style sets touches that suite does not hold; it is not edited.
- Out: Fade's own canvas line and why it reads fat at the hand-back URL (flagged assumption, out of phase); `spectrumfx.js`; the Source drawer; every user-facing string; `CHANGELOG.md`.

## Tasks

### Task 1: The per-style, per-part trace rule

- **Files:** hqptuner/static/components/faceplate/page/sourcepaint.js, tests/js/components/faceplate-page/sourcepaint-section.test.js, .filepawl.toml
- **Reads:** hqptuner/static/components/faceplate/page/sourcepaint.js#showsTrace, hqptuner/static/components/faceplate/page/sourcepaint.js#CANVAS_STYLES, hqptuner/static/components/faceplate/page/sourcepaint.js#selectedOf, hqptuner/static/store/ui/prefs.js#SPECTRUM_STYLES, docs/spec/testing.md
- **Decisions:** D-01, D-03, D-05, D-10
- **Action:** Following `docs/spec/testing.md` rule 17, put the reworded D-05 decision in a new exported function of `sourcepaint.js`, beside `CANVAS_STYLES` and `selectedOf`, where the module keeps its knowledge of the styles. Given a spectrum style value as the prefs store holds it (`trace`, `bars`, `ridges`, `aurora`, `fade`, `fire`), it answers, separately for each of the three trace parts (the line, the filled area, the shadow), whether that style shows it: `trace` all three; `fade` the line and the area, not the shadow; `bars`, `ridges`, `aurora` and `fire` none. The color suite plays no part (D-01). The name and the return shape are the executor's, so long as each part's answer can be read on its own. Write the test first: a hand-written table in `sourcepaint-section.test.js` of the six styles, each row naming the expected answer for each of the three parts, never derived from a source constant (`docs/spec/testing.md` rule 13), one assertion per generated case as the suite's existing `for` sweeps do. Show it red against the unchanged `sourcepaint.js` (rule 8), then make it pass. Aurora's row is the automated half of D-10. Leave `showsTrace`, `TRACE_STYLES`, the existing `showsTrace` table and the painter untouched in this task: the painter still follows `showsTrace` until Task 2, and the `showsTrace` table still holds true of `showsTrace` and keeps its export in use for knip. Run `filepawl accept` without asking if filepawl prints it.
- **Verify:** `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/sourcepaint-section.test.js` prints `exit=0`, and its log shows the new per-part cases passing: three for Trace shown, two for Fade's line and area shown and one for Fade's shadow not shown, and twelve not-shown answers for Bars, Ridges, Aurora and Flames. Before the function exists, the same run with the new table in place fails on the missing export (the bite proof, taken before the code is written, with no bare `git stash`). `scripts/gate.sh make check` prints `exit=0`. Testing scope: the outcome is eighteen answers, of which none is covered (the `showsTrace` table answers one yes or no per style and calls Fade's line hidden). The six-row table at the pure-function lane is the smallest check and is sufficient evidence for AC2; testing stops there. A junk style is not tested, since `enumPref` never holds one.

### Task 2: The painter draws each part of the trace as the rule says

- **Files:** hqptuner/static/components/faceplate/page/sourcepaint.js, tests/js/components/faceplate-page/sourcepaint-section.test.js, .filepawl.toml
- **Reads:** hqptuner/static/components/faceplate/page/sourcepaint.js#sourcePainter, hqptuner/static/components/faceplate/page/sourcepaint.js#paintTrace, hqptuner/static/components/faceplate/page/sourcepaint.js#lookNow, tests/js/support/rendered/sourcesection.js#paint, tests/js/support/rendered/sourcesection.js#pointsOf
- **Decisions:** D-02, D-03, D-04, D-06, D-07, D-08, D-09
- **Action:** Make `sourcePainter`'s `paint` follow Task 1's rule in place of `showsTrace`, part by part, on every paint (the first after mount, a restart, and the paint right after a switch): each of `els.trace`, `els.area` and `els.shadow` is written from the paint's columns where the picked style shows that part, and left with an empty `d` where it does not. Under Fade that writes the line and the area and leaves the shadow empty. `paintTrace` today derives the area from the line's columns; each path must follow its own answer, and whether `paintTrace` takes the parts' answers or the painter keeps handing it `NO_COLUMNS` is the executor's call, so long as no part's answer is ignored. Keep handing `paintCanvases` the real `line` under every style, since the effects and aurora canvases draw from it (D-04: Fade's own canvas line stays). Leave `paintBars`, the VU paint, `SourceMeter.js` and `meter.css` as they are (D-06, D-07). Remove `showsTrace`, and `TRACE_STYLES` if nothing else reads it, together with the `showsTrace` style table in the suite: its Fade row states the rule the owner reversed at UAT (D-04), and the function is gone. Retire the two cases the leaves-empty sweep generates for Fade's line and area (`test_under_fade_a_playing_paint_leaves_the_trace_empty` and `test_under_fade_a_playing_paint_leaves_the_area_empty`) for the same reason; keep Fade's shadow case, which still holds. Every other existing case in the suite stays unedited (D-09), as do `sourcepaint-motion.test.js`, `spectrum-motion.test.js` and `meter.test.js`. Write the new test first, through `tests/js/support/rendered/sourcesection.js`'s `section` and `paint` with its `picked` look: under Fade, a paint of a playing frame leaves the line and the area holding points (AC8, with the kept shadow case as its other half). Show it red against Task 1's commit (rule 8), then make it pass. Update the module header comment, the `paintTrace` comment and the suite's style-table comment so none still says the trace is drawn under the Trace style only. Run `filepawl accept` without asking if filepawl prints it. The test writer chooses names, scenes and values.
- **Verify:** `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/sourcepaint-section.test.js` prints `exit=0`, with the new Fade line and area cases passing, `test_under_fade_a_playing_paint_leaves_the_shadow_empty` passing, the Bars, Ridges and Flames leaves-empty cases, the three Trace draws cases and the six switch cases passing unedited. The new Fade cases run against Task 1's commit fail, finding empty paths (the bite proof). `grep -n "showsTrace" hqptuner/static tests/js -r` prints nothing. `git diff --stat <plan base>..HEAD -- hqptuner/static/components/faceplate/page/SourceMeter.js hqptuner/static/css/meter.css tests/js/components/faceplate-page/sourcepaint-motion.test.js tests/js/store/meter/spectrum-motion.test.js tests/js/components/faceplate-page/meter.test.js` prints nothing. `scripts/gate.sh make test-js` prints `exit=0`. `bash .claude/task-check.sh` passes `make check`, rebuilds `hqptuner:dev` and health-checks `:8090`; say before running it that the rebuild holds cores for minutes. Testing scope: the new outcome is Fade's line and area drawn; Fade's shadow withheld, Bars/Ridges/Flames withheld, Trace whole and the Bars switch both ways are already pinned and stay. Two new cases are sufficient evidence for AC8; testing stops there, with no color-suite sweep (the rule takes no suite) and no Aurora paint case (D-10).

## Notes

- Caller-side delta: none outside this file. `showsTrace` has one caller, `sourcePainter` in the same module, plus the suite's table; both move to the new rule. No other module imports it (grep of `hqptuner/static` and `tests/js`).
- `.filepawl.toml` is declared only so a `filepawl accept` the gate prints can land; if filepawl prints nothing, it stays untouched.
- No user-facing text and no `CHANGELOG.md` entry (D-11).
