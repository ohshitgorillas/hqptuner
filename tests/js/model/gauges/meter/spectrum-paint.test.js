// Behavioral suite for what a spectrum style's paint takes from the spectrum's band surface
// (hqptuner/static/model/gauges/meter/spectrumfx.js): the shown columns as plot fractions at the Range, those fractions
// grouped into the bands the painter draws, and a color suite's ramp as a number of colors base to crown, flat red,
// green and blue triples on the shader's zero to one scale. Each paint hands back the buffers of the paint before it,
// and each is refilled with this paint's values.
//
// Where a level sits on the plot is pinned on `fraction`, how fractions group into a band on `bandTop`, and a suite's
// ramp on `rampOf` and `rampAt`; this suite reads its expected values from those, so it pins the surface that carries
// them to a paint, not the mapping again. The shader reads stop k of an n-color ramp at k / (n - 1) of the way up
// (hqptuner/static/vendor/cava/northern_lights.js), so that is where each color is read from the suite's ramp.
//
// The surface is read off the module namespace with optional access, so a module without a name fails its cases on
// their assertions rather than at load. The palette identifiers are iterated, never asserted.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/meter/spectrum-paint.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { fraction } from "../../../../../hqptuner/static/model/gauges/meter/meter.js";
import * as spectrumModel from "../../../../../hqptuner/static/model/gauges/meter/spectrumfx.js";

/**
 * The spectrum's band surface as a paint uses it.
 *
 * @type {{
 *   ACCENT?: string,
 *   SPECTRUM_PALETTES?: readonly string[],
 *   CHANNEL_MAX?: number,
 *   rampOf?: (suite: string, accent: string) => any,
 *   rampAt?: (ramp: any, at: number) => ArrayLike<number>,
 *   bandTop?: (fracs: ArrayLike<number>, band: number, bands: number) => number,
 *   fractionsOf?: (columns: ArrayLike<number>, range: number, out?: Float32Array) => Float32Array,
 *   bandsOf?: (fracs: ArrayLike<number>, bands: number, out?: Float32Array) => Float32Array,
 *   suiteRamp?: (suite: string, stops: number, accent: string) => Float32Array,
 * }}
 */
const fx = spectrumModel;

//: Two Ranges a user may pick, dB, the second deeper.
const RANGES = [120, 240];
const RANGE = RANGES[0];
//: Shown columns, dBFS, from full scale to below the shallower Range.
const COLUMNS = [0, -12, -45, -90, -150];
//: The top of the plot, a fraction no column of COLUMNS but full scale reaches.
const TOP = 1;
//: Twelve plot fractions, exact in single precision, differing from band to band at three and at four bands.
const FRACS = [0.25, 0.5, 0.75, 0.5, 0.125, 0.25, 0.125, 0.25, 1, 0.75, 0.875, 1];
//: Band counts the twelve fractions divide into evenly.
const BAND_COUNTS = [3, 4];
const BAND_COUNT = BAND_COUNTS[0];
//: Numbers of colors a ramp is asked for, each with a color away from either end.
const STOP_COUNTS = [3, 5];
const STOP_COUNT = STOP_COUNTS[1];
//: Two accents a user may pick.
const BLUE = "#2040e0";
const RED = "#e04020";
//: Components per color in the form a WebGL uniform3fv takes.
const RGB = 3;

const ACCENT = fx.ACCENT ?? "";
const SUITES = (fx.SPECTRUM_PALETTES ?? []).filter((p) => p !== ACCENT);

/**
 * [ok, message] for spreading into ONE assert.ok: as many values as expected, each within `tol` of its own.
 *
 * @param {ArrayLike<number> | undefined} actual
 * @param {number[]} expected
 * @param {number} tol
 * @returns {[boolean, string]}
 */
const nearEach = (actual, expected, tol) => {
  const got = Array.from(actual ?? []);
  return [
    got.length === expected.length && expected.every((e, i) => Math.abs(got[i] - e) <= tol),
    `expected [${expected}] ± ${tol}, got [${got}]`,
  ];
};

/**
 * Each column's plot fraction at `range`, as a single-precision buffer holds it.
 *
 * @param {number[]} columns
 * @param {number} range
 * @returns {number[]}
 */
const fractionsAt = (columns, range) => Array.from(Float32Array.from(columns, (db) => fraction(db, range)));

/**
 * Each band's top read from `fracs`, as a single-precision buffer holds it.
 *
 * @param {number[]} fracs
 * @param {number} bands
 * @returns {number[]}
 */
const topsOf = (fracs, bands) =>
  Array.from(Float32Array.from({ length: bands }, (_, b) => Number(fx.bandTop?.(Float32Array.from(fracs), b, bands))));

/**
 * The suite's ramp read at `stops` evenly spaced points base to crown, flattened, each component on a zero to one scale.
 *
 * @param {string} suite
 * @param {number} stops
 * @param {string} accent
 * @returns {number[]}
 */
const rampReadAt = (suite, stops, accent) => {
  const ramp = fx.rampOf?.(suite, accent);
  const max = Number(fx.CHANNEL_MAX);
  return Array.from({ length: stops * RGB }, (_, i) => {
    const color = fx.rampAt?.(ramp, Math.floor(i / RGB) / (stops - 1)) ?? [];
    return Number(color[i % RGB]) / max;
  });
};

// ── Columns to plot fractions ────────────────────────────────────────────

for (const range of RANGES) {
  test(`test_each_column_becomes_its_plot_fraction_at_a_${range}_db_range`, () => {
    assert.deepEqual(Array.from(fx.fractionsOf?.(COLUMNS, range) ?? []), fractionsAt(COLUMNS, range));
  });
}

test("test_the_fractions_come_back_in_the_buffer_handed_in", () => {
  const out = new Float32Array(COLUMNS.length);
  assert.equal(fx.fractionsOf?.(COLUMNS, RANGE, out), out);
});

test("test_a_handed_fraction_buffer_holds_this_paints_fractions_not_a_louder_earlier_paints", () => {
  const out = new Float32Array(COLUMNS.length).fill(TOP);
  fx.fractionsOf?.(COLUMNS, RANGE, out);
  assert.deepEqual(Array.from(out), fractionsAt(COLUMNS, RANGE));
});

// ── Plot fractions to bands ──────────────────────────────────────────────

for (const bands of BAND_COUNTS) {
  test(`test_each_of_${bands}_bands_takes_the_top_its_fractions_group_to`, () => {
    assert.deepEqual(Array.from(fx.bandsOf?.(Float32Array.from(FRACS), bands) ?? []), topsOf(FRACS, bands));
  });
}

test("test_the_bands_come_back_in_the_buffer_handed_in", () => {
  const out = new Float32Array(BAND_COUNT);
  assert.equal(fx.bandsOf?.(Float32Array.from(FRACS), BAND_COUNT, out), out);
});

test("test_a_handed_band_buffer_holds_this_paints_bands_not_a_louder_earlier_paints", () => {
  const out = new Float32Array(BAND_COUNT).fill(TOP);
  fx.bandsOf?.(Float32Array.from(FRACS), BAND_COUNT, out);
  assert.deepEqual(Array.from(out), topsOf(FRACS, BAND_COUNT));
});

// ── A suite's ramp as the shader takes it ────────────────────────────────

for (const stops of STOP_COUNTS) {
  test(`test_under_accent_${stops}_colors_read_the_blue_accents_ramp_base_to_crown`, () => {
    const tol = 1 / Number(fx.CHANNEL_MAX);
    assert.ok(...nearEach(fx.suiteRamp?.(ACCENT, stops, BLUE), rampReadAt(ACCENT, stops, BLUE), tol));
  });
}

test("test_under_accent_the_colors_follow_the_accent_handed_in_after_another_accents", () => {
  fx.suiteRamp?.(ACCENT, STOP_COUNT, BLUE);
  const tol = 1 / Number(fx.CHANNEL_MAX);
  assert.ok(...nearEach(fx.suiteRamp?.(ACCENT, STOP_COUNT, RED), rampReadAt(ACCENT, STOP_COUNT, RED), tol));
});

for (const suite of SUITES) {
  for (const stops of STOP_COUNTS) {
    test(`test_under_${suite}_${stops}_colors_read_its_ramp_base_to_crown`, () => {
      const tol = 1 / Number(fx.CHANNEL_MAX);
      assert.ok(...nearEach(fx.suiteRamp?.(suite, stops, BLUE), rampReadAt(suite, stops, BLUE), tol));
    });
  }
}
