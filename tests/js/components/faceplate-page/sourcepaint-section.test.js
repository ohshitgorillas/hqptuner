// Painter suite for hqptuner/static/components/faceplate/page/sourcepaint.js, the Source section half: what
// `paintSourceScene` paints into the section from each meter-loop scene. The level bars show each channel's peak and
// RMS from the Levels floor at the bottom of the trough to 0 dBFS at its top, with the held peak mark at the held level;
// a peak jumps up at once and falls back at a steady rate, the RMS integrates, the held mark rises with the peak, stays
// a while, then falls, never below the peak, and is hidden while nothing has been heard; each part is colored by its
// own level through the color suite. The VU needles turn to each channel's RMS against the VU reference, and rest at
// the bottom of the scale with nothing heard. The trace draws the channels' power average per bin as a line over a
// filled area, with a slower shadow never below the line, in the viewBox 0 0 SW SH: 0 Hz at the left to the top of the
// frequency span's view at the right, 0 dBFS at the top to the range below it at the foot. A paint told no time is an
// error; a paint with no painters still paints the section.
//
// The section and the scenes are tests/js/support/rendered/sourcesection.js. A needle's reading is checked against what paintVu
// itself writes for that reading. Colors are compared, never named.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/sourcepaint-section.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { SH, SW, paintSourceScene } from "../../../../hqptuner/static/components/faceplate/page/sourcepaint.js";
import { meterFloor, vuReference } from "../../../../hqptuner/static/store/ui/prefs.js";
import { freqSpan } from "../../../../hqptuner/static/store/faceplate/view.js";
import { accent, accentHex } from "../../../../hqptuner/static/store/ui/theme.js";
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
  TRACE,
  channel,
  hold,
  holds,
  level,
  levelAt,
  lineLevel,
  lineY,
  loudThenQuiet,
  needles,
  nothing,
  oracleAngle,
  paint,
  peaks,
  pointsOf,
  rmses,
  sceneOf,
  section,
  shadowYs,
  steady,
} from "../../support/rendered/sourcesection.js";

/** @typedef {import("../../support/rendered/sourcesection.js").Section} Section */
/** @typedef {import("../../support/rendered/sourcesection.js").Scene} Scene */

//: The middle bin, half Nyquist.
const HALF_BIN = (BINS - 1) / 2;
//: A trace twice as deep as RANGE.
const WIDE_RANGE = 2 * RANGE;
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
//: The power average of a channel at -20 dBFS and one at -40, dBFS: 10·log10((0.01 + 0.0001) / 2).
const PAIR_HOT_DB = -20;
const PAIR_SOFT_DB = -40;
const PAIR_AVERAGE_DB = -22.97;
//: A wall time shorter than a held mark's hold and longer than a peak's attack, s.
const BRIEF_S = 1 / 8;
//: Tolerances: a bar's percentage, a needle's degrees, a trace's dB and y, an x in viewBox units.
const PCT_TOL = 0.5;
const DEG_TOL = 1;
const DB_TOL = 0.5;
const Y_TOL = 1;
const X_TOL = SW / (BINS - 1);
//: A suite whose colors run with level, the Accent suite, and an accent preset with two custom accents.
const INFERNO = "inferno";
const ACCENT = "accent";
const PRESET = "violet";
const FIRST_HEX = "#4f9dde";
const SECOND_HEX = "#c03a9b";

const START = {
  floor: meterFloor.value,
  ref: vuReference.value,
  span: freqSpan.value,
  accent: accent.value,
  hex: accentHex.value,
};

afterEach(() => {
  meterFloor.value = START.floor;
  vuReference.value = START.ref;
  freqSpan.value = START.span;
  accent.value = START.accent;
  accentHex.value = START.hex;
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

test("test_a_peak_jumps_up_to_a_louder_reading_at_once", () => {
  meterFloor.value = FLOOR_60;
  const root = steady(QUIET_DB, 1);
  paint(root, level(LOUD_DB), STEP_S / 2);
  assert.ok(...near(peaks(root)[0], 90, PCT_TOL));
});

/**
 * How far the first peak fill has fallen, in trough percent, `seconds` after a full-scale peak, over a 90 dB floor.
 *
 * @param {number} seconds
 */
function peakFall(seconds) {
  meterFloor.value = FLOOR_90;
  const root = section(2);
  paint(root, level(0, true), STEP_S);
  const top = peaks(root)[0];
  hold(root, () => level(-Infinity), seconds);
  return top - peaks(root)[0];
}

test("test_a_peak_falls_back_at_a_steady_rate", () => {
  assert.ok(...near(peakFall(1) / peakFall(0.5), 2, 0.2));
});

test("test_the_rms_fill_integrates_rather_than_jumping_to_a_new_reading", () => {
  meterFloor.value = FLOOR_60;
  const root = section(2);
  paint(root, level(MID_DB, true), STEP_S / 2);
  const rms = rmses(root)[0];
  assert.ok(rms < 50 - PCT_TOL, `rms fill ${rms}% one short paint after a restart`);
});

test("test_a_steady_rms_settles_at_its_level", () => {
  meterFloor.value = FLOOR_60;
  assert.ok(...near(rmses(steady(MID_DB))[0], 50, PCT_TOL));
});

// ── the held peak mark ─────────────────────────────────────────────────

test("test_the_held_mark_rises_with_the_peak_at_once", () => {
  meterFloor.value = FLOOR_60;
  const root = steady(QUIET_DB, 1);
  paint(root, level(LOUD_DB), STEP_S / 2);
  assert.ok(...near(holds(root)[0], 90, PCT_TOL));
});

test("test_the_held_mark_stays_put_a_while_after_the_peak_falls", () => {
  meterFloor.value = FLOOR_60;
  assert.ok(...near(holds(loudThenQuiet(BRIEF_S))[0], 90, PCT_TOL));
});

test("test_the_held_mark_falls_after_a_long_quiet", () => {
  meterFloor.value = FLOOR_60;
  const held = holds(loudThenQuiet(2 * SETTLE_S))[0];
  assert.ok(held < 90 - 1, `held mark at ${held}% after ${2 * SETTLE_S} s of quiet`);
});

/**
 * Whether the held mark stood at or above the peak fill on every paint of a run of rising and falling peaks, steady
 * and late paints mixed.
 *
 * @returns {[boolean, string]}
 */
function heldNeverUnderPeak() {
  meterFloor.value = FLOOR_60;
  const root = section(2);
  /** @type {string[]} */
  const under = [];
  paint(root, level(MID_DB, true), STEP_S);
  [LOUD_DB, QUIET_DB, MID_DB, -12, QUIET_DB, QUIET_DB, -40, LOUD_DB, UNDER_DB].forEach((db, i) => {
    for (let k = 0; k < 20; k++) {
      paint(root, level(db), i % 3 ? BRIEF_S : STEP_S);
      const [held, peak] = [holds(root)[0], peaks(root)[0]];
      if (Number.isNaN(held) || held < peak - 1e-9) under.push(`held ${held}% under peak ${peak}% at ${db} dBFS`);
    }
  });
  return [under.length === 0, under.slice(0, 3).join("; ")];
}

test("test_the_held_mark_never_falls_below_the_peak", () => {
  assert.ok(...heldNeverUnderPeak());
});

test("test_the_held_mark_is_hidden_while_nothing_has_been_heard", () => {
  const root = section(2, "visible");
  paint(root, nothing(), STEP_S);
  assert.equal(root.table[".lvb .hd"][0].style.visibility, "hidden");
});

test("test_the_held_mark_shows_once_something_is_heard", () => {
  const root = section(2, "hidden");
  paint(root, level(MID_DB, true), STEP_S);
  assert.notEqual(root.table[".lvb .hd"][0].style.visibility, "hidden");
});

// ── the bars' colors ───────────────────────────────────────────────────

/**
 * The `--lv-ink` of each element `sel` reaches after a second of a stereo scene, left at `left` dBFS and right at
 * `right`, under `suite`.
 *
 * @param {string} sel
 * @param {number} left
 * @param {number} right
 * @param {string} suite
 */
function inks(sel, left, right, suite) {
  meterFloor.value = FLOOR_60;
  const root = section(2);
  const scene = (/** @type {boolean} */ restart) =>
    sceneOf([channel(left, left, left), channel(right, right, right)], restart);
  paint(root, scene(true), STEP_S, { suite });
  hold(root, () => scene(false), 1, { suite });
  return root.table[sel].map((e) => e.style.getPropertyValue("--lv-ink"));
}

/**
 * Whether a soft and a hot channel's `sel` parts carry two inks, neither empty.
 *
 * @param {string} sel
 * @returns {[boolean, string]}
 */
function twoInks(sel) {
  const [soft, hot] = inks(sel, SOFT_DB, HOT_DB, INFERNO);
  return [new Set([soft, hot, ""]).size === 3, `inks ${JSON.stringify([soft, hot])}`];
}

for (const [sel, part] of [
  [".lvb .pk", "peak_fill"],
  [".lvb .rm", "rms_fill"],
  [".lvb .hd", "held_mark"],
]) {
  test(`test_a_${part}_is_colored_by_its_own_level`, () => {
    assert.ok(...twoInks(sel));
  });
}

test("test_a_change_of_suite_changes_a_peak_fills_color", () => {
  assert.notEqual(inks(".lvb .pk", HOT_DB, HOT_DB, MONO)[0], inks(".lvb .pk", HOT_DB, HOT_DB, INFERNO)[0]);
});

/**
 * The first peak fill's ink under Accent, the custom accent being `hex`.
 *
 * @param {string} hex
 */
function accentInk(hex) {
  accent.value = PRESET;
  accentHex.value = hex;
  return inks(".lvb .pk", HOT_DB, HOT_DB, ACCENT)[0];
}

test("test_under_accent_a_peak_fill_follows_the_accent_in_force", () => {
  assert.notEqual(accentInk(FIRST_HEX), accentInk(SECOND_HEX));
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
  assert.ok(...near(needlesAt(-18, -28, REF_18)[0], oracleAngle(0), DEG_TOL));
});

test("test_each_needle_reads_its_own_channel_against_the_reference", () => {
  assert.ok(...near(needlesAt(-18, -28, REF_18)[1], oracleAngle(-10), DEG_TOL));
});

test("test_a_change_of_vu_reference_moves_the_reading", () => {
  assert.ok(...near(needlesAt(-18, -18, REF_14)[0], oracleAngle(-4), DEG_TOL));
});

test("test_a_needle_with_nothing_heard_rests_at_the_bottom_of_the_scale", () => {
  const root = steady(MID_DB, 1);
  paint(root, nothing(), STEP_S);
  assert.equal(needles(root)[0], oracleAngle());
});

// ── the trace ──────────────────────────────────────────────────────────

/**
 * The trace line's mean y after one restarting paint of every bin at `db` on a `range` dB trace.
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
  assert.ok(...near(firstLineY(MID_DB, RANGE), SH / 2, Y_TOL));
});

test("test_the_same_level_on_a_range_twice_as_deep_draws_the_line_a_quarter_of_the_way_down", () => {
  assert.ok(...near(firstLineY(MID_DB, WIDE_RANGE), SH / 4, Y_TOL));
});

test("test_the_line_runs_from_the_left_edge_to_the_right_edge", () => {
  const xs = pointsOf(steady(MID_DB, STEP_S), ".strace").map(([x]) => x);
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
  const pts = pointsOf(root, ".strace");
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

test("test_the_shown_level_does_not_drop_at_once_to_a_quieter_reading", () => {
  const shown = lineLevel(loudThenQuiet(STEP_S));
  assert.ok(shown > QUIET_DB + 3, `line at ${shown} dBFS one paint after a ${LOUD_DB} dBFS paint`);
});

test("test_the_shown_level_settles_at_a_quieter_reading", () => {
  assert.ok(...near(lineLevel(loudThenQuiet(SETTLE_S)), QUIET_DB, DB_TOL));
});

/**
 * Where the shadow stands under the line, at each x both hold, as messages; one message where they share no x.
 *
 * @param {Section} root
 * @param {number} k
 */
function shadowUnder(root, k) {
  const line = new Map(pointsOf(root, ".strace").map(([x, y]) => [x.toFixed(3), y]));
  const shared = pointsOf(root, ".shold").filter(([x]) => line.has(x.toFixed(3)));
  if (!shared.length) return [`paint ${k}: no x shared by the line and the shadow`];
  return shared
    .filter(([x, y]) => y > /** @type {number} */ (line.get(x.toFixed(3))) + 1e-6)
    .map(([x, y]) => `paint ${k}: shadow ${y} under line ${line.get(x.toFixed(3))} at x ${x}`);
}

/**
 * Whether the shadow stood at or above the line on every paint of a loud, quiet and mid run, steady and late paints
 * mixed.
 *
 * @returns {[boolean, string]}
 */
function shadowNeverUnderLine() {
  const root = section(2);
  paint(root, level(LOUD_DB, true), STEP_S);
  /** @type {string[]} */
  const bad = [];
  for (let k = 0; k < 64; k++) {
    paint(root, level(k % 16 < 8 ? QUIET_DB : MID_DB), k % 2 ? STEP_S : BRIEF_S);
    bad.push(...shadowUnder(root, k));
  }
  return [bad.length === 0, bad.slice(0, 3).join("; ")];
}

test("test_the_shadow_never_falls_below_the_line", () => {
  assert.ok(...shadowNeverUnderLine());
});

test("test_the_shadow_falls_slower_than_the_line", () => {
  const root = loudThenQuiet(0.25);
  const ys = shadowYs(root);
  const shadow = ys.length ? levelAt(Math.min(...ys)) : Number.NaN;
  assert.ok(shadow > lineLevel(root) + 1, `shadow at ${shadow} dBFS, line at ${lineLevel(root)} dBFS`);
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
  const top = pointsOf(root, ".sarea").filter(([, y]) => y < SH - 1e-6);
  const line = keys(pointsOf(root, ".strace"));
  assert.deepEqual(keys(top), line.length ? line : [null]);
});

test("test_the_area_reaches_the_plot_foot_across_its_full_width", () => {
  const foot = pointsOf(sloped(), ".sarea")
    .filter(([, y]) => Math.abs(y - SH) < 1e-6)
    .map(([x]) => x);
  assert.deepEqual(foot.length ? [Math.round(Math.min(...foot)), Math.round(Math.max(...foot))] : [], [0, SW]);
});

// ── what a paint must be handed ────────────────────────────────────────

test("test_a_paint_told_no_time_is_an_error", () => {
  const untimed = /** @type {any} */ ({ range: RANGE, picked: TRACE, suite: MONO });
  const root = /** @type {any} */ (section(2));
  assert.throws(() => paintSourceScene(root, /** @type {any} */ (level(MID_DB, true)), null, untimed));
});

test("test_with_no_painters_the_section_still_paints", () => {
  meterFloor.value = FLOOR_60;
  const root = section(2);
  paint(root, level(MID_DB, true), STEP_S, { picked: "bars" });
  assert.ok(...near(peaks(root)[0], 50, PCT_TOL));
});
