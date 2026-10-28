// Painter suite for hqptuner/static/components/faceplate/page/sourcepaint.js, the Source section half: what a
// `sourcePainter` made on the section's elements paints into them from each meter-loop scene. The level bars show each
// channel's peak and RMS from the Levels floor at the bottom of the trough to 0 dBFS at its top, with the held peak
// mark hidden while nothing has been heard; each part is colored by its own level through the color suite. The VU
// needles turn to each channel's RMS against the VU reference, placed along the VU scale as the meter model places a
// reading, and rest at the bottom of the scale with nothing heard. The trace draws the channels' power average per bin
// as a line over a filled area, in the viewBox 0 0 SW SH: 0 Hz at the left to the top of the frequency span's view at
// the right, 0 dBFS at the top to the page's Range below it at the foot. A paint told no time is an error; a paint
// with no canvas painters still paints the section.
//
// How the bars, needles and trace move over time is the meter models' to decide and their suites' to pin; this suite
// reads only where a paint leaves them after a restart or a long settle.
//
// The section and the scenes are tests/js/support/rendered/sourcesection.js. Colors are compared, never named.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/sourcepaint-section.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { SH, SW } from "../../../../hqptuner/static/components/faceplate/page/sourcepaint.js";
import { scaleShare } from "../../../../hqptuner/static/model/gauges/meter/vu.js";
import {
  meterFloor,
  pageRange,
  spectrumColors,
  spectrumStyle,
  vuReference,
} from "../../../../hqptuner/static/store/ui/prefs.js";
import { freqSpan } from "../../../../hqptuner/static/store/faceplate/view.js";
import { suiteColor } from "../../../../hqptuner/static/model/gauges/meter/spectrumfx.js";
import { accent, accentHex, accentInForce } from "../../../../hqptuner/static/store/ui/theme.js";
import { near } from "../../support/near.js";
import {
  BINS,
  LOUD_DB,
  MID_DB,
  MONO,
  QUIET_DB,
  RANGE,
  SETTLE_S,
  STEP_S,
  angleAt,
  channel,
  hold,
  holds,
  level,
  lineLevel,
  lineY,
  needles,
  nothing,
  paint,
  peaks,
  pointsOf,
  rmses,
  sceneOf,
  section,
  steady,
} from "../../support/rendered/sourcesection.js";

/** @typedef {import("../../support/rendered/sourcesection.js").Section} Section */

//: The middle bin, half Nyquist.
const HALF_BIN = (BINS - 1) / 2;
//: A Range twice as deep as RANGE, and a level half RANGE down, dBFS.
const WIDE_RANGE = 2 * RANGE;
const HALF_RANGE_DB = -RANGE / 2;
//: Levels floors and VU references, as the prefs store holds them.
const FLOOR_60 = "-60";
const FLOOR_90 = "-90";
const REF_18 = "-18";
const REF_14 = "-14";
//: Frequency spans, as the view store holds them.
const FULL = "full";
const HALF = "half";
//: Levels, dBFS: under a 60 dB floor, and two the meter tells apart.
const UNDER_DB = -80;
const SOFT_DB = -45;
const HOT_DB = -10;
//: A level four fifths of the way up a 60 dB trough, dBFS: a share the trough's percentage writes exactly.
const FIFTHS_DB = -12;
//: The power average of a channel at -20 dBFS and one at -40, dBFS: 10·log10((0.01 + 0.0001) / 2).
const PAIR_HOT_DB = -20;
const PAIR_SOFT_DB = -40;
const PAIR_AVERAGE_DB = -22.97;
//: VU readings: at the reference, 10 below it, 4 below it.
const AT_REF_VU = 0;
const TEN_UNDER_VU = -10;
const FOUR_UNDER_VU = -4;
//: The bottom of the VU scale, as a share of it.
const SCALE_BOTTOM = 0;
//: Tolerances: a bar's percentage, a needle's degrees, a trace's dB and y, an x in viewBox units.
const PCT_TOL = 0.5;
const DEG_TOL = 1;
const DB_TOL = 0.5;
const Y_TOL = 1;
const X_TOL = SW / (BINS - 1);
//: A suite whose colors run with level, the Accent suite, a style that draws on a canvas, and an accent preset with
//: two custom accents.
const INFERNO = "inferno";
const ACCENT = "accent";
const BARS = "bars";
const PRESET = "violet";
//: Every palette the spectrum may be painted under, as the store holds them, and two preset accents.
const PALETTES = [ACCENT, "retro", INFERNO, "viridis", "borealis", MONO];
const BLUE = "blue";
const GREEN = "green";
const FIRST_HEX = "#4f9dde";
const SECOND_HEX = "#c03a9b";

const START = {
  floor: meterFloor.value,
  ref: vuReference.value,
  span: freqSpan.value,
  accent: accent.value,
  hex: accentHex.value,
  range: pageRange.value,
  style: spectrumStyle.value,
  colors: spectrumColors.value,
};

afterEach(() => {
  meterFloor.value = START.floor;
  vuReference.value = START.ref;
  freqSpan.value = START.span;
  accent.value = START.accent;
  accentHex.value = START.hex;
  pageRange.value = START.range;
  spectrumStyle.value = START.style;
  spectrumColors.value = START.colors;
});

// ── the level bars ─────────────────────────────────────────────────────

/**
 * The first peak fill's height after one paint of a peak at `peak` dBFS over the Levels floor `floor`.
 *
 * @param {number} peak
 * @param {string} floor
 */
function peakHeight(peak, floor) {
  meterFloor.value = floor;
  const root = section(2);
  paint(root, level(peak, true), STEP_S);
  return peaks(root)[0];
}

test("test_a_peak_half_way_from_a_60_db_floor_to_full_scale_fills_half_the_trough", () => {
  assert.ok(...near(peakHeight(MID_DB, FLOOR_60), 50, PCT_TOL));
});

test("test_the_same_peak_over_a_90_db_floor_fills_two_thirds_of_the_trough", () => {
  assert.ok(...near(peakHeight(MID_DB, FLOOR_90), 200 / 3, PCT_TOL));
});

test("test_a_peak_under_the_levels_floor_fills_none_of_the_trough", () => {
  assert.equal(peakHeight(UNDER_DB, FLOOR_60), 0);
});

test("test_the_bars_follow_the_channels_in_order", () => {
  meterFloor.value = FLOOR_60;
  const root = section(2);
  paint(root, sceneOf([channel(MID_DB, MID_DB, MID_DB), channel(-15, -15, -15)], true), STEP_S);
  assert.deepEqual(peaks(root).map(Math.round), [50, 75]);
});

// ── the held peak mark ─────────────────────────────────────────────────

test("test_the_held_mark_is_hidden_while_nothing_has_been_heard", () => {
  const root = section(2, "visible");
  paint(root, nothing(), STEP_S);
  assert.equal(root.els.holds[0].style.visibility, "hidden");
});

test("test_the_held_mark_shows_once_something_is_heard", () => {
  const root = section(2, "hidden");
  paint(root, level(MID_DB, true), STEP_S);
  assert.notEqual(root.els.holds[0].style.visibility, "hidden");
});

// ── the bars' colors ───────────────────────────────────────────────────

/**
 * The `--lv-ink` of each element of the bag's `part` after a second of a stereo scene, left at `left` dBFS and right
 * at `right`, under `suite`.
 *
 * @param {"peaks" | "rmses" | "holds"} part
 * @param {number} left
 * @param {number} right
 * @param {string} suite
 */
function inks(part, left, right, suite) {
  meterFloor.value = FLOOR_60;
  const root = section(2);
  const scene = (/** @type {boolean} */ restart) =>
    sceneOf([channel(left, left, left), channel(right, right, right)], restart);
  paint(root, scene(true), STEP_S, { suite });
  hold(root, () => scene(false), 1, { suite });
  return root.els[part].map((e) => e.style.getPropertyValue("--lv-ink"));
}

/**
 * Whether a soft and a hot channel's `part` carry two inks, neither empty.
 *
 * @param {"peaks" | "rmses" | "holds"} part
 * @returns {[boolean, string]}
 */
function twoInks(part) {
  const [soft, hot] = inks(part, SOFT_DB, HOT_DB, INFERNO);
  return [new Set([soft, hot, ""]).size === 3, `inks ${JSON.stringify([soft, hot])}`];
}

for (const [part, name] of /** @type {const} */ ([
  ["peaks", "peak_fill"],
  ["rmses", "rms_fill"],
  ["holds", "held_mark"],
])) {
  test(`test_a_${name}_is_colored_by_its_own_level`, () => {
    assert.ok(...twoInks(part));
  });
}

test("test_a_change_of_suite_changes_a_peak_fills_color", () => {
  assert.notEqual(inks("peaks", HOT_DB, HOT_DB, MONO)[0], inks("peaks", HOT_DB, HOT_DB, INFERNO)[0]);
});

/**
 * The first `part`'s ink under Accent, the accent picked being `preset` and the custom accent `hex`.
 *
 * @param {"peaks" | "rmses" | "holds"} part
 * @param {string} preset
 * @param {string} hex
 */
function accentInk(part, preset, hex) {
  accent.value = preset;
  accentHex.value = hex;
  return inks(part, HOT_DB, HOT_DB, ACCENT)[0];
}

for (const [part, name] of /** @type {const} */ ([
  ["peaks", "peak_fill"],
  ["rmses", "rms_fill"],
  ["holds", "held_mark"],
])) {
  test(`test_under_accent_a_${name}_follows_the_accent_in_force`, () => {
    assert.notEqual(accentInk(part, PRESET, FIRST_HEX), accentInk(part, PRESET, SECOND_HEX));
  });
}

test("test_under_accent_with_no_custom_accent_a_peak_fill_follows_the_preset_picked", () => {
  assert.notEqual(accentInk("peaks", BLUE, ""), accentInk("peaks", GREEN, ""));
});

/**
 * A stereo section after one restarting paint of every channel's peak at `opening` dBFS, then a second of each
 * channel's peak at `peak` and RMS at `rms`, under `suite`.
 *
 * @param {number} opening
 * @param {number} peak
 * @param {number} rms
 * @param {string} suite
 */
function barsAfter(opening, peak, rms, suite) {
  meterFloor.value = FLOOR_60;
  const root = section(2);
  const scene = (/** @type {number} */ top, /** @type {boolean} */ restart) =>
    sceneOf([channel(top, rms, rms), channel(top, rms, rms)], restart);
  paint(root, scene(opening, true), STEP_S, { suite });
  hold(root, () => scene(peak, false), 1, { suite });
  return root;
}

/**
 * The first `part`'s ink in `root`, and the color the spectrum draws under `suite`, with the accent in force, at the
 * share of the trough that part stands at, `at` reading that share as a percentage.
 *
 * @param {Section} root
 * @param {"peaks" | "rmses" | "holds"} part
 * @param {(root: Section) => number[]} at
 * @param {string} suite
 * @returns {[string, string]}
 */
function inkAndSpectrum(root, part, at, suite) {
  const ink = root.els[part][0].style.getPropertyValue("--lv-ink");
  return [ink, suiteColor(suite, at(root)[0] / 100, accentInForce())];
}

for (const suite of PALETTES) {
  test(`test_under_${suite}_a_peak_fill_draws_in_the_spectrum_color_at_its_own_height`, () => {
    const root = barsAfter(FIFTHS_DB, FIFTHS_DB, SOFT_DB, suite);
    const [ink, spectrum] = inkAndSpectrum(root, "peaks", peaks, suite);
    assert.equal(ink, spectrum);
  });
}

test("test_under_a_gradient_an_rms_fill_below_its_peak_draws_in_the_spectrum_color_at_its_own_height", () => {
  const root = barsAfter(FIFTHS_DB, FIFTHS_DB, SOFT_DB, INFERNO);
  const [ink, spectrum] = inkAndSpectrum(root, "rmses", rmses, INFERNO);
  assert.equal(ink, spectrum);
});

test("test_under_a_gradient_a_held_mark_above_its_peak_draws_in_the_spectrum_color_at_its_own_height", () => {
  const root = barsAfter(FIFTHS_DB, SOFT_DB, SOFT_DB, INFERNO);
  const [ink, spectrum] = inkAndSpectrum(root, "holds", holds, INFERNO);
  assert.equal(ink, spectrum);
});

// ── the VU needles ─────────────────────────────────────────────────────

/**
 * The needles' angles after a steady stereo run of RMS `left` and `right`, every peak at full scale, under `ref`.
 *
 * @param {number} left
 * @param {number} right
 * @param {string} ref
 */
function needlesAt(left, right, ref) {
  vuReference.value = ref;
  const root = section(2);
  const scene = (/** @type {boolean} */ restart) =>
    sceneOf([channel(0, left, left), channel(0, right, right)], restart);
  paint(root, scene(true), STEP_S);
  hold(root, () => scene(false), SETTLE_S);
  return needles(root);
}

test("test_a_steady_rms_at_the_vu_reference_reads_0_vu", () => {
  assert.ok(...near(needlesAt(-18, -28, REF_18)[0], angleAt(scaleShare(AT_REF_VU)), DEG_TOL));
});

test("test_each_needle_reads_its_own_channel_against_the_reference", () => {
  assert.ok(...near(needlesAt(-18, -28, REF_18)[1], angleAt(scaleShare(TEN_UNDER_VU)), DEG_TOL));
});

test("test_a_change_of_vu_reference_moves_the_reading", () => {
  assert.ok(...near(needlesAt(-18, -18, REF_14)[0], angleAt(scaleShare(FOUR_UNDER_VU)), DEG_TOL));
});

test("test_a_needle_with_nothing_heard_rests_at_the_bottom_of_the_scale", () => {
  const root = steady(MID_DB, 1);
  paint(root, nothing(), STEP_S);
  assert.ok(...near(needles(root)[0], angleAt(SCALE_BOTTOM), DEG_TOL));
});

// ── the trace ──────────────────────────────────────────────────────────

/**
 * The trace line's mean y after one restarting paint of every bin at `db` under a `range` dB Range.
 *
 * @param {number} db
 * @param {number} range
 */
function firstLineY(db, range) {
  const root = section(2);
  paint(root, level(db, true), STEP_S, { range });
  return lineY(root);
}

test("test_a_level_half_the_range_down_draws_the_line_half_way_down_the_plot", () => {
  assert.ok(...near(firstLineY(HALF_RANGE_DB, RANGE), SH / 2, Y_TOL));
});

test("test_the_same_level_on_a_range_twice_as_deep_draws_the_line_a_quarter_of_the_way_down", () => {
  assert.ok(...near(firstLineY(HALF_RANGE_DB, WIDE_RANGE), SH / 4, Y_TOL));
});

test("test_the_line_runs_from_the_left_edge_to_the_right_edge", () => {
  const xs = pointsOf(steady(MID_DB, STEP_S).els.trace).map(([x]) => x);
  assert.deepEqual([Math.round(Math.min(...xs)), Math.round(Math.max(...xs))], [0, SW]);
});

/**
 * The x at which the line stands highest after one paint whose only loud bin is half Nyquist, under span `span`.
 *
 * @param {string} span
 */
function loudBinX(span) {
  freqSpan.value = span;
  const bins = new Float32Array(BINS).fill(QUIET_DB);
  bins[HALF_BIN] = LOUD_DB;
  const root = section(2);
  paint(root, sceneOf([channel(LOUD_DB, LOUD_DB, bins), channel(LOUD_DB, LOUD_DB, bins)], true), STEP_S);
  const pts = pointsOf(root.els.trace);
  return pts.length ? pts.reduce((best, p) => (p[1] < best[1] ? p : best))[0] : Number.NaN;
}

test("test_at_full_span_half_nyquist_sits_half_way_across", () => {
  assert.ok(...near(loudBinX(FULL), SW / 2, X_TOL));
});

test("test_at_half_span_half_nyquist_sits_at_the_right_edge", () => {
  assert.ok(...near(loudBinX(HALF), SW, X_TOL));
});

test("test_the_line_shows_the_channels_power_average_per_bin", () => {
  const root = section(2);
  const pair = [channel(PAIR_HOT_DB, PAIR_HOT_DB, PAIR_HOT_DB), channel(PAIR_SOFT_DB, PAIR_SOFT_DB, PAIR_SOFT_DB)];
  paint(root, sceneOf(pair, true), STEP_S);
  assert.ok(...near(lineLevel(root), PAIR_AVERAGE_DB, DB_TOL));
});

/** A section after one paint of a spectrum sloping from -10 dBFS at 0 Hz to -50 at Nyquist. */
function sloped() {
  const bins = Float32Array.from({ length: BINS }, (_, k) => -10 - (40 * k) / (BINS - 1));
  const root = section(2);
  paint(root, sceneOf([channel(-10, -20, bins), channel(-10, -20, bins)], true), STEP_S);
  return root;
}

/**
 * Points as sorted keys, two decimals.
 *
 * @param {[number, number][]} pts
 */
const keys = (pts) => pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).sort();

test("test_the_area_is_topped_by_the_line", () => {
  const root = sloped();
  const top = pointsOf(root.els.area).filter(([, y]) => y < SH - 1e-6);
  const line = keys(pointsOf(root.els.trace));
  assert.deepEqual(keys(top), line.length ? line : [null]);
});

test("test_the_area_reaches_the_plot_foot_across_its_full_width", () => {
  const foot = pointsOf(sloped().els.area)
    .filter(([, y]) => Math.abs(y - SH) < 1e-6)
    .map(([x]) => x);
  assert.deepEqual(foot.length ? [Math.round(Math.min(...foot)), Math.round(Math.max(...foot))] : [], [0, SW]);
});

// ── what a paint must be handed ────────────────────────────────────────

test("test_a_paint_told_no_time_is_an_error", () => {
  const root = section(2);
  assert.throws(() => root.painter.paint(/** @type {any} */ (level(MID_DB, true)), /** @type {any} */ ({})));
});

test("test_with_no_canvas_painters_the_section_still_paints_under_a_canvas_style", () => {
  meterFloor.value = FLOOR_60;
  const root = section(2);
  paint(root, level(MID_DB, true), STEP_S, { picked: BARS });
  assert.ok(...near(peaks(root)[0], 50, PCT_TOL));
});
