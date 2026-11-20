// Painter suite for hqptuner/static/components/faceplate/page/sourcepaint.js, the canvases and restarts half: what a
// `sourcePainter` made with the effects painter lays on the effects canvas under each picked style, how it leaves that
// painter alone once the style moves away from it, and what starts the section afresh. Under a canvas style (bars,
// ridges, fade, fire) the effects canvas shows the spectrum. When the style moves from a canvas style to trace or to
// aurora, the effects painter receives one empty paint, which clears its canvas, and no spectrum after it, so whatever
// the canvas holds stays. A restart under a canvas style starts the effects canvas afresh, and a change in the number
// of channels starts the held marks afresh.
//
// How the bars, held marks, needles, trace and shadow move over time, and how a restart starts each of them afresh, is
// the meter models' to decide and their suites' to pin. What this suite pins of them is the hand-off: a paint carries
// its wall time in ms, and the bars, the needles and the trace each move by that many ms of their own motion. Each
// case's expected value is written by hand from a fact outside the painter (a fall of 20 dB a second, a time constant
// of 150 ms, the IEC 60268-17 response time), so a painter that hands a model its `dt` a factor of 1000 off fails.
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
import { readFileSync } from "node:fs";

import { scaleShare } from "../../../../hqptuner/static/model/gauges/meter/vu.js";
import {
  meterFloor,
  pageRange,
  spectrumColors,
  spectrumStyle,
  vuReference,
} from "../../../../hqptuner/static/store/ui/prefs.js";
import { near } from "../../support/near.js";
import {
  HOLD_MS,
  LOUD_DB,
  MID_DB,
  QUIET_DB,
  STEP_MS,
  TRACE,
  angleAt,
  apart,
  channel,
  fxCanvas,
  hold,
  holds,
  inkOf,
  level,
  lineLevel,
  needles,
  paint,
  peaks,
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
const WARM_MS = 4 * STEP_MS;
//: Ink the test lays on every pixel of the effects canvas itself, where no painter put it.
const MARK = 0.5;
//: How much of a history may survive a fresh start, or of the test's own ink may be lost: none, up to float noise.
const NONE_TOL = 1e-6;
//: The whole of the test's own ink, as a share of it.
const ALL = 1;

//: What the IEC 60268-17 fixture states of a VU needle's response, and the VU reference the needle cases run against.
const IEC = JSON.parse(
  readFileSync(new URL("../../../support/fixtures/iec60268-17/vu-dynamic-response.json", import.meta.url), "utf8"),
);
const REF_18 = "-18";
const REF_DB = -18;
//: Paints a needle's response is read through, ms apart.
const NEEDLE_FRAME_MS = 10;
//: The reading the standard's response-time clause names, as a share of the VU scale.
const RESPONSE_SHARE = scaleShare(20 * Math.log10(IEC.responseDeflectionPercent / IEC.referenceDeflectionPercent));
//: The earliest and latest the needle may reach it, ms.
const EARLIEST_MS = IEC.responseTimeMs * (1 - IEC.responseTimeTolerancePercent / 100);
const LATEST_MS = IEC.responseTimeMs * (1 + IEC.responseTimeTolerancePercent / 100);
//: A peak bar falls 20 dB in a second; the trace's shown level closes the gap to a new level by 1/e in 150 ms.
const ONE_SECOND_MS = 1000;
const FALL_DB_PER_S = 20;
const SHOWN_TAU_MS = 150;
//: Tolerances: a bar's percentage, a trace line's dB.
const PCT_TOL = 0.5;
const LINE_TOL = 0.5;

const START = {
  vuReference: vuReference.value,
  floor: meterFloor.value,
  range: pageRange.value,
  style: spectrumStyle.value,
  colors: spectrumColors.value,
};

afterEach(() => {
  vuReference.value = START.vuReference;
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
  paint(root, level(LOUD_DB, true), STEP_MS, { picked: style });
  hold(root, () => level(LOUD_DB), WARM_MS, { picked: style });
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
  paint(root, level(LOUD_DB, true), STEP_MS, { picked: BARS });
  hold(root, () => level(LOUD_DB), HOLD_MS, { picked: BARS });
  const laid = inkOf(canvas);
  paint(root, level(LOUD_DB), STEP_MS, { picked: then });
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
  hold(root, () => level(LOUD_DB), HOLD_MS, { picked: then });
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
  paint(root, level(LOUD_DB, true), STEP_MS);
  hold(root, () => level(LOUD_DB), HOLD_MS);
  paint(root, level(QUIET_DB), STEP_MS);
  const before = read(root);
  paint(root, scene(restart), STEP_MS);
  const clean = section(2);
  paint(clean, scene(true), STEP_MS);
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
  paint(root, level(LOUD_DB, true), STEP_MS, { picked: BARS });
  if (history) hold(root, () => level(LOUD_DB), HOLD_MS, { picked: BARS });
  paint(root, level(MID_DB, true), STEP_MS, { picked: BARS });
  return Float32Array.from(canvas.ink);
}

test("test_a_restart_starts_the_effects_canvas_afresh", () => {
  const fresh = restartedCanvas(false);
  const laid = fresh.reduce((a, b) => a + b, 0);
  const left = laid > 0 ? apart(restartedCanvas(true), fresh) / laid : Number.NaN;
  assert.ok(...near(left, 0, NONE_TOL));
});

// ── the wall time a paint carries ──────────────────────────────────────

test("test_a_peak_bar_falls_twenty_db_in_the_second_a_paint_carries", () => {
  meterFloor.value = FLOOR_60;
  const root = section(2);
  paint(root, level(LOUD_DB, true), STEP_MS);
  paint(root, level(QUIET_DB), ONE_SECOND_MS);
  const fallen = LOUD_DB - FALL_DB_PER_S;
  assert.ok(...near(peaks(root)[0], ((fallen - Number(FLOOR_60)) / -Number(FLOOR_60)) * 100, PCT_TOL));
});

test("test_the_trace_closes_1_over_e_of_the_gap_to_a_new_level_in_150_ms", () => {
  const root = section(2);
  paint(root, level(LOUD_DB, true), STEP_MS);
  paint(root, level(MID_DB), SHOWN_TAU_MS);
  assert.ok(...near(lineLevel(root), MID_DB + (LOUD_DB - MID_DB) / Math.E, LINE_TOL));
});

/**
 * The first needle's angle after a steady RMS at the VU reference has been heard for `ms`, in paints NEEDLE_FRAME_MS
 * apart, the needle starting at rest.
 *
 * @param {number} ms
 */
function needleAfter(ms) {
  vuReference.value = REF_18;
  const root = section(1);
  const scene = (/** @type {boolean} */ restart) => sceneOf([channel(0, REF_DB, REF_DB)], restart);
  paint(root, scene(true), 0);
  for (let t = 0; t < ms; t += NEEDLE_FRAME_MS) paint(root, scene(false), NEEDLE_FRAME_MS);
  return needles(root)[0];
}

test("test_a_needle_is_short_of_99_percent_deflection_before_the_earliest_response_time", () => {
  assert.ok(needleAfter(EARLIEST_MS) < angleAt(RESPONSE_SHARE));
});

test("test_a_needle_reaches_99_percent_deflection_by_the_latest_response_time", () => {
  assert.ok(needleAfter(LATEST_MS) >= angleAt(RESPONSE_SHARE));
});
