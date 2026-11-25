# Phase 9: No trace on the other visualizer effects - Context

Gathered: 2026-11-24

Feeds: /cad-plan 9

## Scope boundary

In: the page Source section's SVG trace (line, filled area and falling shadow) shows whole under the Trace spectrum style only; under Fade the line and the filled area show and the falling shadow does not; under Bars, Ridges, Aurora and Flames none of it shows, whatever the color suite; the four cases in `tests/js/store/meter/spectrum-motion.test.js` that read the SVG trace under Ridges and Flames are removed; `docs/spec/faceplate.md` states the rule.

Out: Fade's own sharp line on the effects canvas; the grid lines, scales and Range keys; the Source drawer's spectrum and spectrogram; the Display popover's labels and captions and any other user-facing text; any `CHANGELOG.md` entry; the meter loop's frame contract (Phase 5 D-09); the missing Flames in the style list at `docs/spec/faceplate.md:91`.

Deferred: None

Plan shape: multiple plans (owner: big, planning splits the work into several plans inside this phase).

## Durable decisions

- D-01 (what the words mean): "the spectrum" is the Trace spectrum style, the default, and "the other visualizer effects" are the five other styles in the Display popover: Bars, Ridges, Aurora, Fade and Flames (`fire`). Borealis is a color suite, not a style, so the trace is withheld by style, under every color suite. Hiding it only under Aurora, and hiding it whenever the Borealis suite is picked, were the alternatives. SPEC-02 was reworded to match (owner approval 2026-11-24). Evidence: owner confirmation 2026-11-24; `hqptuner/static/components/faceplate/page/DisplayOptions.js:43-60`, `hqptuner/static/components/faceplate/page/sourcepaint.js:303-316` (`paintTrace` runs on every paint whatever the style), `hqptuner/static/store/ui/prefs.js:176-178`, `docs/spec/design-system.md:34-35`, `todo.txt:18`.
- D-02 (invalid tests go, owner ruling 2026-11-24): the four stepped-view cases in `tests/js/store/meter/spectrum-motion.test.js` (Ridges and Flames over the two FX feeds) read the SVG trace's level under styles that must show no trace, so they are invalid and are removed. The code is not shaped to keep them green: no route is chosen because it keeps the paths written under those styles for those tests' sake. Keeping the paths written and only hidden, and taking the four cases back to the owner mid-phase, were the alternatives. Evidence: owner answer 2026-11-24 ("remove the ... tests, do not patch the ... code to keep invalid tests alive"); `tests/js/store/meter/spectrum-motion.test.js:13-15,151,160-191,255-263`, `tests/js/support/rendered/sourcesection.js:182-190`.

## Decisions

- D-03 (what the trace is): the trace is all three SVG paths drawn through the level gradient: the line (`.strace`), the filled area (`.sarea`) and the slower-falling shadow (`.shold`). The dB and kHz grid lines (`.sgridl`), the scales and the Range keys stay under every style. Evidence: owner confirmation 2026-11-24; `hqptuner/static/components/faceplate/page/SourceMeter.js:134-151,168-177`, `hqptuner/static/css/meter.css:44-50`.
- D-04 (Fade, owner ruling at UAT 2026-11-24, replaces the earlier D-04): Fade shows the SVG trace's line (`.strace`) and filled area (`.sarea`), the part that tracks the music, and does not show the falling shadow (`.shold`). Fade's own sharp line, stroked on the effects canvas over its halo, is part of the Fade effect and stays. The earlier D-04 withheld the whole SVG trace under Fade; the owner called that their own mistake. Where D-01, D-08 and D-11 say the trace shows under the Trace style only, read them with this exception. Evidence: owner at the hand-back URL ("Fade does get a trace. the rest pass."), then owner answer 2026-11-24 ("Fade gets the tracking line and fill"); `.planning/phases/9/UAT.md` item 7; `hqptuner/static/components/faceplate/page/sourcepaint.js:74,128-129,320-327` (one yes or no per style withholds line and shadow together), `hqptuner/static/components/faceplate/page/spectrumfx.js:1-9,317-339`.
- D-05 (the rule's shape, reworded for D-04): which parts of the trace a style shows is stated per style: Trace shows the line, the filled area and the shadow; Fade shows the line and the filled area; Bars, Ridges, Aurora and Flames show none. It is tested with a hand-written table of the six styles at the lowest lane that observes it. The earlier D-05 was one yes or no per style, which cannot say Fade's answer. Evidence: owner confirmation 2026-11-24 and the D-04 ruling; `hqptuner/static/components/faceplate/page/sourcepaint.js:72-129`, `docs/spec/testing.md` rules 15 and 17.
- D-06 (the SVG stays): the SVG element stays visible under every style; it holds the grid, carries `role="img" aria-label="Spectrum"` and takes the crosshair pointer. Only the three trace paths are withheld. Evidence: `hqptuner/static/components/faceplate/page/SourceMeter.js:168-176`, `hqptuner/static/css/meter.css:41,47-49`.
- D-07 (the paths stay in the markup): the three path elements stay in the markup under every style, since the element lookup returns `null` when any of them is missing and the whole Source painter, level bars and VU needles included, then stops. Evidence: `hqptuner/static/components/faceplate/page/SourceMeter.js:288-303`.
- D-08 (switching): after a switch from Trace to another style the next paint shows no trace, and after a switch back the next paint shows it. Evidence: owner confirmation 2026-11-24; `hqptuner/static/components/faceplate/page/sourcepaint.js:256-286`.
- D-09 (tests that stay): the trace tests that paint under the Trace style keep pinning that the spectrum draws its trace, and Phase 5 D-09 ("no trace before the feed covers the delay") stays pinned at the meter loop and is untouched. Evidence: `tests/js/support/rendered/sourcesection.js:244-246`, `tests/js/components/faceplate-page/sourcepaint-section.test.js:346-430`, `tests/js/components/faceplate-page/sourcepaint-motion.test.js:241-246`, `tests/js/components/faceplate-page/meter.test.js:181-190`, `.planning/_archive-v2.0.0/5/CONTEXT.md`.
- D-10 (Aurora): Aurora's shader canvas needs WebGL2, which node lacks, so no trace under Aurora rests on the style table test and the owner's eyes at the hand-back URL. Evidence: owner answer 2026-11-24 (AC7 is an owner's eyes check); `tests/js/components/faceplate-page/sourcepaint-motion.test.js:15-16`, `hqptuner/static/components/faceplate/page/aurora.js:144`.
- D-11 (docs and copy): no user-facing text changes and no `CHANGELOG.md` entry. The rule that the trace shows under the Trace style only goes in `docs/spec/faceplate.md`, which owns the Spectrum style rule, and in the commit message. Evidence: owner confirmation 2026-11-24; `docs/spec/faceplate.md:91`, `hqptuner/static/components/faceplate/page/DisplayOptions.js:172-173`.
- D-12 (surface): only the page Source section draws a style-picked trace; the Source drawer's spectrum and spectrogram do not read `spectrumStyle`. Evidence: grep of `hqptuner/static/components` for `spectrumStyle|strace|sarea` matches only `page/SourceMeter.js`, `page/sourcepaint.js` and `page/DisplayOptions.js`.

## Acceptance criteria

- [ ] AC1: With the spectrum style set to Bars, Ridges or Flames, a paint of a playing frame leaves the three trace paths (`.strace`, `.sarea`, `.shold`) in the page Source section with no drawing. (ci: check)
- [ ] AC2: A test states, style by style, which parts of the trace show: Trace the line, the filled area and the shadow; Fade the line and the filled area; Bars, Ridges, Aurora and Flames none. (ci: check)
- [ ] AC3: With the spectrum style set to Trace, a paint of a playing frame draws the line, the filled area and the shadow. (ci: check)
- [ ] AC4: After a switch from Trace to Bars, Ridges or Flames, the next paint leaves no trace; after a switch back, the next paint draws it. (ci: check)
- [ ] AC5: `tests/js/store/meter/spectrum-motion.test.js` holds no case that reads the SVG trace under a style other than Trace.
- [ ] AC6: `docs/spec/faceplate.md` states which parts of the trace show under which style, as D-05 lists them.
- [ ] AC7: At the hand-back URL, with the Borealis colors and one other color suite: under Bars, Ridges, Aurora and Flames no trace line, fill or shadow is visible; under Fade the line and the fill are visible and the shadow is not; under Trace all three are visible. (human-verify: needs owner's eyes)
- [ ] AC8: With the spectrum style set to Fade, a paint of a playing frame draws the line and the filled area and leaves the shadow (`.shold`) with no drawing. (ci: check)

## Flagged assumptions

- How the trace is withheld (the painter writing empty paths, or a rule keyed on the style) is the planner's call under D-02, D-06 and D-07 - Likely; if wrong: a route that leaves the paths drawn fails AC1.
- Removing the four cases under D-02 leaves Ridges and Flames with no stepped-view motion case, and whether a replacement that reads the effect's own canvas is owed is not settled - Unclear; if wrong: Ridges and Flames motion is unpinned after the phase, and the gap goes to the owner as a plan point.
- The sentence added to `docs/spec/faceplate.md` is the owner's to approve before it lands, as the Phase 7 spec amendment was - Likely; if wrong: the planner writes it.
- `CANVAS_STYLES` in `sourcepaint.js` is pinned by `sourcepaint-motion.test.js`, so moving or reshaping it for D-05 may touch that suite - Unclear; if wrong: a suite the plan did not name goes red.
- Under Fade at the hand-back URL the owner sees no crisp line, or only a "ridiculously fat" one (owner, 2026-11-24), though `hqptuner/static/components/faceplate/page/spectrumfx.js:126-128,335-339` strokes a 1.5 px line over a 6 px halo blurred 2 px. Why the canvas line does not read as crisp is not diagnosed and is out of this phase; D-04's SVG line and fill are what give Fade its visible trace - Unclear; if wrong: the SVG line returns and Fade still reads fat, which goes to the owner at AC7.
- `.planning/ROADMAP.md` still names Borealis as a visualizer effect in the Phase 9 goal and criterion 1 - Confident; if wrong: nothing, D-01 and SPEC-02 govern.
