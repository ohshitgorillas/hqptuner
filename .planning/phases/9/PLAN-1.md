---
phase: 9
plan: 1
requirements: [SPEC-02]
files:
  - tests/js/store/meter/spectrum-motion.test.js
---

# Phase 9: No trace on the other visualizer effects - Plan 1: Retire the stepped-view trace cases

## Goal

The trace is drawn on the spectrum only, and on none of the other visualizer effects. This plan clears the way: the four store cases that read the SVG trace under Ridges and Flames are invalid under SPEC-02, and they go before the painter stops drawing the trace there, so no commit in this phase lands on a red gate.

## Must be true when done

- `tests/js/store/meter/spectrum-motion.test.js` holds no case that reads the SVG trace under a style other than Trace (AC5).
- The suite's five Trace cases, one per feed, still run and pass unedited in what they assert.

## Context

- D-02 (owner ruling 2026-11-24): the four stepped-view cases (Ridges and Flames over the two FX feeds) are invalid and are removed. No code is shaped to keep them alive, and no replacement is written in this phase.
- D-09: the five Trace cases keep pinning that each paint shows the one frame covering most of its interval. They are not touched in what they assert.
- Recalled: the flame stand-in's fixed pseudo-random sequence (`draws`) was added in v2.0.0 phase 5, plan 3, task 6 (`.planning/_archive-v2.0.0/5/SUMMARY.md`), only so the picture-freeze claim of these cases could hold. It goes with them.
- Out of scope: the source, every other suite, and `tests/js/support/rendered/sourcesection.js`.

## Tasks

### Task 1: Remove the four stepped-view cases and what only they use

- **Files:** tests/js/store/meter/spectrum-motion.test.js
- **Reads:** tests/js/store/meter/spectrum-motion.test.js#STEPPED_VIEWS, tests/js/store/meter/spectrum-motion.test.js#play, tests/js/store/meter/spectrum-motion.test.js#FX_FEEDS, tests/js/store/meter/spectrum-motion.test.js#draws
- **Decisions:** D-02, D-09
- **Action:** Delete the `for (const view of STEPPED_VIEWS)` block that generates the four `test_..._never_leaves_the_<view>_view_as_painted_...` cases. Then delete everything that served only those cases, so eslint, tsc `--checkJs` and knip find nothing unused: `STEPPED_VIEWS`, `FX_FEEDS`, `draws`, `FX_SIZE`, `GLASS`, the `fxPainter` and `rasterCanvas` imports, the `view` parameter of `play` and its `spectrumStyle.value = view` line, the effects canvas and fx painter `play` builds, and the `still` field of `Painted` with the canvas comparison that fills it. `play` may then build its section with no canvas painters (`section(feed.channels)`), since under Trace the effects painter only ever gets the restart's empty paint. Keep the `spectrumStyle.value = TRACE` in `beforeEach` and the `spectrumStyle` import it needs. Rewrite the header comment's paragraph on Ridges and fire, and any other comment that names the effects canvas, so the header describes only what the suite now pins. Write no history into it (repo `CLAUDE.md`, trivia gets cut). Do not touch the five `test_<feed>_shows_each_paint_the_one_frame_that_covers_most_of_its_interval` cases, `heard`, `notTheFrameCoveringMost`, `overlap` or `FEEDS` in what they compute or assert. The source code is not touched in this task.
- **Verify:** `grep -n -e STEPPED_VIEWS -e view_as_painted -e fxPainter -e rasterCanvas tests/js/store/meter/spectrum-motion.test.js` prints nothing, and `grep -n "spectrumStyle.value =" tests/js/store/meter/spectrum-motion.test.js` prints only the `TRACE` assignment in `beforeEach`. Both print matches on the tree before the task. `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/spectrum-motion.test.js` prints `exit=0`, and its log reports 5 tests passed and 0 failed (9 before the task). `scripts/gate.sh make check` prints `exit=0`. Testing scope: this task removes invalid tests and adds none. The evidence is that the five Trace cases pass and the gates find nothing unused. No bite proof applies, since no behavior changes.

## Notes

- Order: this plan precedes Plan 2. After Plan 2, these four cases would fail: `play` keeps only paints whose trace level is finite, so with no trace under Ridges and Flames it keeps no paints and the `some` claim fails. Removing them first keeps every commit green. That puts a pin edit ahead of the code, against the plan-graph habit of pin edits last. The reason is that `make check` gates every commit (`~/dev/CLAUDE.md` 11.4).
- Owner plan point (CONTEXT flagged assumption, Unclear): after this removal, nothing pins Ridges' or Flames' motion in the store lane. This plan writes no replacement case that reads the effects canvas, because D-02 orders none. Whether one is owed is the owner's call.
