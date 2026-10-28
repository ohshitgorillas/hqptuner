// Painter suite for hqptuner/static/components/faceplate/page/sourcepaint.js, the canvases and restarts half: what a
// `sourcePainter` made with the effects painter lays on the effects canvas under each picked style, how it leaves that
// painter alone once the style moves away from it, and what starts the section afresh. Under a canvas style (bars,
// ridges, fade, fire) the effects canvas shows the spectrum. When the style moves from a canvas style to trace or to
// aurora, the effects painter receives one empty paint, which clears its canvas, and no spectrum after it, so whatever
// the canvas holds stays. A restart under a canvas style starts the effects canvas afresh, and a change in the number
// of channels starts the held marks afresh.
//
// How the bars, held marks, needles, trace and shadow move over time, and how a restart starts each of them afresh, is
// the meter models' to decide and their suites' to pin.
//
// Not reached here: the aurora painter's own canvas. It needs WebGL2, which node lacks, and the only fake of it is
// private to the aurora suite; a WebGL2 fake in tests/js/support would close it.
//
// The section and the scenes are tests/js/support/rendered/sourcesection.js. The effects canvas is tests/js/support/raster.js
// under the real fxPainter, handed its random source and its canvas maker, and is read by its ink.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/sourcepaint-motion.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { meterFloor, pageRange, spectrumColors, spectrumStyle } from "../../../../hqptuner/static/store/ui/prefs.js";
import { near } from "../../support/near.js";
import {
  LOUD_DB,
  MID_DB,
  QUIET_DB,
  STEP_S,
  TRACE,
  apart,
  channel,
  fxCanvas,
  hold,
  holds,
  inkOf,
  level,
  paint,
  sceneOf,
  section,
} from "../../support/rendered/sourcesection.js";

/** @typedef {import("../../support/rendered/sourcesection.js").Reader} Reader */
/** @typedef {import("../../support/rendered/sourcesection.js").Scene} Scene */
/** @typedef {import("../../support/rendered/sourcesection.js").Section} Section */

//: The Levels floor, as the prefs store holds it.
const FLOOR_60 = "-60";
//: Spectrum styles, as the store holds them.
const BARS = "bars";
const CANVAS_STYLES = [BARS, "ridges", "fade", "fire"];
//: The styles that do not draw on the effects canvas, each one a style can leave bars for.
const LEFT_FOR = [TRACE, "aurora"];
//: Paints of a canvas style before its canvas is read.
const WARM_S = 4 * STEP_S;
//: Ink the test lays on every pixel of the effects canvas itself, where no painter put it.
const MARK = 0.5;
//: How much of a history may survive a fresh start, or of the test's own ink may be lost: none, up to float noise.
const NONE_TOL = 1e-6;
//: The whole of the test's own ink, as a share of it.
const ALL = 1;

const START = {
  floor: meterFloor.value,
  range: pageRange.value,
  style: spectrumStyle.value,
  colors: spectrumColors.value,
};

afterEach(() => {
  meterFloor.value = START.floor;
  pageRange.value = START.range;
  spectrumStyle.value = START.style;
  spectrumColors.value = START.colors;
});

// ── the effects canvas ─────────────────────────────────────────────────

/**
 * Whether the effects canvas holds ink after a short loud run in `style`.
 *
 * @param {string} style
 */
function inked(style) {
  const { canvas, fx } = fxCanvas();
  const root = section(2, "", { fx, aurora: null });
  paint(root, level(LOUD_DB, true), STEP_S, { picked: style });
  hold(root, () => level(LOUD_DB), WARM_S, { picked: style });
  return inkOf(canvas) > 0;
}

for (const style of CANVAS_STYLES) {
  test(`test_the_${style}_style_draws_on_the_effects_canvas`, () => {
    assert.equal(inked(style), true);
  });
}

// ── leaving the effects painter alone ──────────────────────────────────

/**
 * A section and its effects canvas after a second of loud bars paints and then one paint under `then`, with the ink
 * the bars paints had laid.
 *
 * @param {string} then
 */
function leftFor(then) {
  const { canvas, fx } = fxCanvas();
  const root = section(2, "", { fx, aurora: null });
  paint(root, level(LOUD_DB, true), STEP_S, { picked: BARS });
  hold(root, () => level(LOUD_DB), 1, { picked: BARS });
  const laid = inkOf(canvas);
  paint(root, level(LOUD_DB), STEP_S, { picked: then });
  return { root, canvas, laid };
}

/**
 * The ink the effects canvas holds after the test marks it, once the style has left bars for `then`, and then a second
 * of loud paints under `then`, as a share of the mark; NaN where the bars paints laid no ink.
 *
 * @param {string} then
 */
function markLeftAfter(then) {
  const { root, canvas, laid } = leftFor(then);
  canvas.ink.fill(MARK);
  const marked = inkOf(canvas);
  hold(root, () => level(LOUD_DB), 1, { picked: then });
  return laid > 0 ? inkOf(canvas) / marked : Number.NaN;
}

for (const then of LEFT_FOR) {
  test(`test_when_the_style_leaves_bars_for_${then}_the_effects_canvas_is_cleared`, () => {
    const { canvas, laid } = leftFor(then);
    assert.ok(...near(laid > 0 ? inkOf(canvas) / laid : Number.NaN, 0, NONE_TOL));
  });

  test(`test_once_the_style_has_left_bars_for_${then}_the_effects_canvas_is_left_alone`, () => {
    assert.ok(...near(markLeftAfter(then), ALL, NONE_TOL));
  });
}

// ── starting afresh ────────────────────────────────────────────────────

/**
 * How much of a loud history survives a paint of `scene(restart)`: the distance of `read` from a fresh section's after
 * that scene, over that distance before it.
 *
 * @param {Reader} read
 * @param {(restart: boolean) => Scene} scene
 * @param {boolean} restart
 */
function survives(read, scene, restart) {
  meterFloor.value = FLOOR_60;
  const root = section(2);
  paint(root, level(LOUD_DB, true), STEP_S);
  hold(root, () => level(LOUD_DB), 1);
  paint(root, level(QUIET_DB), STEP_S);
  const before = read(root);
  paint(root, scene(restart), STEP_S);
  const clean = section(2);
  paint(clean, scene(true), STEP_S);
  return apart(read(root), read(clean)) / apart(before, read(clean));
}

test("test_a_change_in_the_number_of_channels_starts_the_held_marks_afresh", () => {
  const mono = (/** @type {boolean} */ r) => sceneOf([channel(MID_DB, MID_DB, MID_DB)], r);
  const first = (/** @type {Section} */ root) => holds(root).slice(0, 1);
  assert.ok(...near(survives(first, mono, false), 0, NONE_TOL));
});

/**
 * The effects canvas after a loud bars paint, a second more of them where `history` holds, then a restarting mid paint.
 *
 * @param {boolean} history
 */
function restartedCanvas(history) {
  const { canvas, fx } = fxCanvas();
  const root = section(2, "", { fx, aurora: null });
  paint(root, level(LOUD_DB, true), STEP_S, { picked: BARS });
  if (history) hold(root, () => level(LOUD_DB), 1, { picked: BARS });
  paint(root, level(MID_DB, true), STEP_S, { picked: BARS });
  return Float32Array.from(canvas.ink);
}

test("test_a_restart_starts_the_effects_canvas_afresh", () => {
  const fresh = restartedCanvas(false);
  const laid = fresh.reduce((a, b) => a + b, 0);
  const left = laid > 0 ? apart(restartedCanvas(true), fresh) / laid : Number.NaN;
  assert.ok(...near(left, 0, NONE_TOL));
});
