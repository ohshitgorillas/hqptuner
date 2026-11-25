---
phase: 9
plan: 2
requirements: [SPEC-02]
depends_on: [1]
files:
  - hqptuner/static/components/faceplate/page/sourcepaint.js
  - tests/js/components/faceplate-page/sourcepaint-section.test.js
---

# Phase 9: No trace on the other visualizer effects - Plan 2: The painter draws the trace under the Trace style only

## Goal

The trace is drawn on the spectrum only, and on none of the other visualizer effects. In the page Source section, the line, the filled area and the falling shadow show under the Trace spectrum style and under none of Bars, Ridges, Aurora, Fade and Flames, whatever the color suite.

## Must be true when done

- Whether a style shows the trace is one yes or no per style: Trace yes, and Bars, Ridges, Aurora, Fade and Flames no (AC2).
- Under Bars, Ridges, Fade or Flames, a paint of a playing frame leaves the line (`.strace`), the area (`.sarea`) and the shadow (`.shold`) holding no drawing (AC1).
- Under Trace, a paint of a playing frame draws the line, the area and the shadow (AC3).
- After a switch from Trace to another style, the next paint leaves no trace. After a switch back, the next paint draws it (AC4).
- The level bars, the VU needles and the effects and aurora canvases paint under every style as before. The SVG, its grid, its scales and the Range keys stay under every style as they show today: Ridges already hides its dB grid lines and dB scale labels (`hqptuner/static/css/meter.css:50`), and that does not change.

## Context

- D-01: the trace is withheld by style, under every color suite. The style values are the prefs store's `SPECTRUM_STYLES`: `trace`, `bars`, `ridges`, `aurora`, `fade`, `fire` (Flames).
- D-03, D-06, D-07: withhold only the three paths' drawing. The SVG element and its grid stay, and the three path elements stay in the markup (`SourceMeter.js` `sectionElements` returns null if any is missing, and then the whole painter stops). So `SourceMeter.js` and `meter.css` are not touched.
- D-02 and the flagged assumption on the route: the painter writes empty paths under a style that shows no trace. A CSS rule keyed on `data-style` would keep the paths written and only hidden, which D-02 rules out, and it would leave AC1 unmet at the painter.
- D-04: Fade's own line on the effects canvas stays, since `paintCanvases` and `spectrumfx.js` are not touched. D-09: the existing Trace-style trace tests and the Phase 5 D-09 pin stay untouched.
- The CONTEXT assumption that `CANVAS_STYLES` is pinned by `sourcepaint-motion.test.js` does not hold. That suite declares a local `CANVAS_STYLES` of its own and imports nothing of that name. The source's `CANVAS_STYLES` is unexported, so reshaping it touches no suite.

## Tasks

### Task 1: One yes or no per style for showing the trace

- **Files:** hqptuner/static/components/faceplate/page/sourcepaint.js, tests/js/components/faceplate-page/sourcepaint-section.test.js
- **Reads:** hqptuner/static/components/faceplate/page/sourcepaint.js#CANVAS_STYLES, hqptuner/static/components/faceplate/page/sourcepaint.js#selectedOf, hqptuner/static/store/ui/prefs.js#SPECTRUM_STYLES, docs/spec/testing.md#Core rules
- **Decisions:** D-01, D-05, D-10
- **Action:** Following `docs/spec/testing.md` rule 17, put the decision in an exported function of `sourcepaint.js`. It takes a spectrum style value as the store holds it, and it returns whether that style shows the trace: true for `trace`, false for `bars`, `ridges`, `aurora`, `fade` and `fire`. Define the answer from one per-style source beside `CANVAS_STYLES` and `selectedOf`, where the module already keeps its knowledge of the styles. The color suite plays no part in it (D-01). Write the tests first. The test is a table of the six styles written by hand in the suite, each paired with its expected yes or no. Never derive the table from a source constant (`docs/spec/testing.md` rule 13). Use one assertion per generated case, as the suite's existing `for` sweeps do. Show it red against the pre-change `sourcepaint.js` (rule 8), then make it pass. Aurora's row is the automated half of D-10. Do not wire the function into the painter yet. That is Task 2. The test writer chooses the test's name and shape within these bounds.
- **Verify:** `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/sourcepaint-section.test.js` prints `exit=0`, and its log shows six new passing cases, one per style: Trace yes, and Bars, Ridges, Aurora, Fade and Flames no. The same run with `sourcepaint.js` at the plan's base commit, tests kept, fails on the missing export (the bite proof). Restore the edited file afterwards without bare `git stash`. `scripts/gate.sh make check` prints `exit=0`. Testing scope: the outcome is the six answers, which no existing test covers. The six-row table at the pure-function lane is the smallest check and is sufficient evidence for AC2. Testing stops there. A junk style value is not tested, since the prefs store's `enumPref` never holds one.

### Task 2: The painter writes no trace under a style that shows none

- **Files:** hqptuner/static/components/faceplate/page/sourcepaint.js, tests/js/components/faceplate-page/sourcepaint-section.test.js
- **Reads:** hqptuner/static/components/faceplate/page/sourcepaint.js#sourcePainter, hqptuner/static/components/faceplate/page/sourcepaint.js#paintTrace, hqptuner/static/components/faceplate/page/sourcepaint.js#lookNow, tests/js/support/rendered/sourcesection.js#paint, tests/js/support/rendered/sourcesection.js#pointsOf
- **Decisions:** D-02, D-03, D-06, D-07, D-08, D-09
- **Action:** Wire Task 1's decision into `sourcePainter`'s `paint`. When the paint's style shows no trace, `paintTrace` must leave `els.area`, `els.shadow` and `els.trace` with an empty `d`, on every such paint. That covers the first paint after mount, a restart, and the paint right after a switch away from Trace. Under Trace, the paths are written exactly as now. The route: read the style once per paint from the look `lookNow` already fills, and hand `paintTrace` the existing `NO_COLUMNS` for all three paths under a style that shows no trace. `paintTrace` already writes `""` for the area, the shadow and the line when handed no columns. Keep handing `paintCanvases` the real `line` under every style, since the effects and aurora canvases draw from it (D-04). Leave `paintBars` and the VU needles' paint as they are. Do not remove, hide or restyle the path elements, and do not touch `SourceMeter.js` or `meter.css` (D-06, D-07). Update the module's header comment and `paintTrace`'s comment to say the trace is drawn under the Trace style only. Write the tests first, in this suite through `tests/js/support/rendered/sourcesection.js`'s `section` and `paint` (its `picked` look). They cover three behaviors. First, under each of Bars, Ridges, Fade and Flames, a paint of a playing frame leaves all three paths holding no points (AC1). Second, under Trace, a paint of a playing frame leaves all three holding points (AC3). No existing case reads the shadow. Third, a section painted under Trace and then switched to another style holds no trace on the next paint, and switched back it holds the trace on the next paint (AC4). Show them red against the pre-change painter (rule 8), then make them pass. Do not edit any existing case in this suite, `sourcepaint-motion.test.js`, `spectrum-motion.test.js` or `meter.test.js` (D-09). The test writer chooses names, scenes and values.
- **Verify:** `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/sourcepaint-section.test.js` prints `exit=0` with the new AC1, AC3 and AC4 cases passing. The same new cases run with `sourcepaint.js` at Task 1's commit, tests kept, fail: the AC1 cases and the switch-away half of AC4 find a drawn trace (the bite proof). `scripts/gate.sh npm test` prints `exit=0` with `sourcepaint-motion.test.js`, `spectrum-motion.test.js` and `meter.test.js` unedited. `git diff --stat <base>..HEAD -- hqptuner/static/components/faceplate/page/SourceMeter.js hqptuner/static/css/meter.css` prints nothing. `bash .claude/task-check.sh` passes `make check`, rebuilds `hqptuner:dev` and health-checks `:8090`. Say before running it that the rebuild holds cores for minutes. Testing scope: the outcomes are no trace under the four canvas styles, the full trace under Trace, and a switch both ways. Line and area under Trace are already pinned. The shadow is not, so the AC3 case adds it. Aurora's half is the Task 1 table plus Plan 4's owner check (D-10), since node has no WebGL2. These cases are sufficient. Testing stops there, with no color-suite sweep, because the decision takes no suite.

## Notes

- Caller-side delta: none. The new decision is an export used by `sourcePainter` in the same file and by the suite. No existing call site changes.
- No user-facing text and no `CHANGELOG.md` entry (D-11).
