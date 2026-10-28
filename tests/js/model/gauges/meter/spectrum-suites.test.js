// Behavioral suite for the spectrum's color and band surface (hqptuner/static/model/gauges/meter/spectrumfx.js), the
// one home of the spectrum styles' colors. The palette choices are the page accent and the named color suites; a
// suite's ramp is read at a fraction along it, a fraction beyond either end taking that end; under the Accent palette
// the Trace style's trace draws solid in the accent in force and the other parts draw in the accent's shades. A bar's
// band top is read from the plot fractions grouped into bands. Nothing here carries time: the same call answers the
// same way whatever was asked before it.
//
// A suite whose bars draw in one gradient, Retro, gives the Bars style that gradient's stops; a suite whose bars take a
// color per band gives none. Every palette gives the Fade style's halo its stops. Reading a color off a ramp allocates
// nothing, so a paint may read it per bar (timing rule 9): the same color comes back as the same object.
// A painter that colors bar by bar builds a suite's ramp once and reads each color's text off it: the text read at a
// fraction, both ends and fractions beyond them included, is the color the suite gives at that fraction, and a ramp
// keeps its own colors after a ramp for another accent is built.
//
// The surface is read off the module namespace with optional access, so a module without a name fails its cases on
// their assertions rather than at load. The palette identifiers are iterated, never asserted: which suites exist, their
// order and their count are the owner's. The two suites named below are named as the store holds them, for the way
// their bars draw, never for their colors.
//
// How many bands span the plot is a module constant, and a constant is not asserted.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/meter/spectrum-suites.test.js

import test from "node:test";
import assert from "node:assert/strict";

import * as spectrumModel from "../../../../../hqptuner/static/model/gauges/meter/spectrumfx.js";

/** @typedef {[number, string]} Stop */

/**
 * The spectrum's color and band surface.
 *
 * @type {{
 *   ACCENT?: string,
 *   SPECTRUM_PALETTES?: readonly string[],
 *   CHANNEL_MAX?: number,
 *   rampOf?: (suite: string, accent: string) => any,
 *   rampAt?: (ramp: any, at: number) => ArrayLike<number>,
 *   hexAt?: (ramp: any, at: number) => string,
 *   suiteColor?: (suite: string, at: number, accent: string) => string,
 *   traceStops?: (suite: string, accent: string) => Stop[],
 *   suiteLineStops?: (suite: string, accent: string) => Stop[],
 *   suiteBarStops?: (suite: string, accent: string) => Stop[] | null | undefined,
 *   suiteHaloStops?: (suite: string, accent: string) => Stop[],
 *   bandTop?: (fracs: Float32Array, band: number, bands: number) => number,
 * }}
 */
const fx = spectrumModel;

//: Two accents a user may pick, each pure in one component so its shades keep that component on top.
const BLUE = "#2040e0";
const RED = "#e04020";
//: The accent channel order a color is read in.
const R = 0;
const B = 2;
//: Fractions beyond either end of a ramp.
const BELOW = -0.5;
const ABOVE = 1.5;
//: Half way along a ramp, away from either end.
const MID = 0.5;
//: The fractions a ramp is swept at, both ends included.
const SWEEP = Array.from({ length: 11 }, (_, i) => i / 10);
//: Twelve plot fractions grouped into three bands of four.
const BINS = 12;
const BANDS3 = 3;
//: The middle band, and a bin inside it away from its edges, and a bin in the last band away from its edges.
const BAND = 1;
const INSIDE = 5;
const OUTSIDE = 10;
//: Levels as plot fractions, exact in single precision.
const QUIET = 0.25;
const LOUD = 0.75;
//: The suite whose bars draw in one gradient, as the store holds it.
const RETRO = "retro";
//: A suite whose bars take a color per band, as the store holds it.
const INFERNO = "inferno";
//: What a missing export answers in place of its stops, so its absence never reads as a suite with none.
const NO_EXPORT = "no such export";
//: What a missing `hexAt` and a missing `suiteColor` answer, unlike any color and unlike each other.
const NO_HEX_AT = "no hexAt export";
const NO_SUITE_COLOR = "no suiteColor export";
//: The fractions a color is read at: the sweep, both ends included, and a fraction beyond either end.
const READ_AT = [BELOW, ...SWEEP, ABOVE];

const PALETTES = fx.SPECTRUM_PALETTES ?? [];
const SUITES = PALETTES.filter((p) => p !== fx.ACCENT);

/**
 * A CSS color as its red, green and blue components.
 *
 * @param {string} color  `#rgb`, `#rrggbb`, `rgb(...)` or `rgba(...)`
 * @returns {number[]}
 */
function rgbOf(color) {
  const text = String(color).trim().toLowerCase();
  const fn = /^rgba?\(([^)]*)\)$/.exec(text);
  if (fn)
    return fn[1]
      .split(/[\s,/]+/)
      .slice(0, 3)
      .map(Number);
  const hex = text.replace(/^#/, "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/**
 * A ramp's color at a fraction, as plain numbers.
 *
 * @param {string} suite
 * @param {string} accent
 * @param {number} at
 * @returns {number[]}
 */
function rampColor(suite, accent, at) {
  return Array.from(fx.rampAt?.(fx.rampOf?.(suite, accent), at) ?? []);
}

/**
 * The stops a suite's bars draw in under a blue accent, null when it gives none; a module without the export answers
 * NO_EXPORT.
 *
 * @param {string} suite
 * @returns {Stop[] | null | string}
 */
function barStops(suite) {
  return fx.suiteBarStops ? (fx.suiteBarStops(suite, BLUE) ?? null) : NO_EXPORT;
}

/**
 * The stops a palette's Fade halo draws in under a blue accent; a module without the export answers none.
 *
 * @param {string} palette
 * @returns {Stop[]}
 */
function haloStops(palette) {
  return (fx.suiteHaloStops ? fx.suiteHaloStops(palette, BLUE) : null) ?? [];
}

/**
 * The color half way along a palette's ramp, read twice off the one ramp; a module without `rampAt` answers a fresh
 * object each time.
 *
 * @param {string} palette
 * @returns {[unknown, unknown]}
 */
function midColorTwice(palette) {
  const ramp = fx.rampOf?.(palette, BLUE);
  const read = () => (fx.rampAt ? fx.rampAt(ramp, MID) : {});
  return [read(), read()];
}

/**
 * The color text read off a ramp at a fraction, as its components joined; a module without `hexAt` answers NO_HEX_AT.
 *
 * @param {any} ramp
 * @param {number} at
 * @returns {string}
 */
function hexColor(ramp, at) {
  return fx.hexAt ? rgbOf(fx.hexAt(ramp, at)).join() : NO_HEX_AT;
}

/**
 * The color a suite gives at a fraction, as its components joined; a module without `suiteColor` answers
 * NO_SUITE_COLOR.
 *
 * @param {string} suite
 * @param {string} accent
 * @param {number} at
 * @returns {string}
 */
function suiteColorAt(suite, accent, at) {
  return fx.suiteColor ? rgbOf(fx.suiteColor(suite, at, accent)).join() : NO_SUITE_COLOR;
}

/**
 * A flat spectrum at one level, every bin the same.
 *
 * @param {number} level
 * @returns {Float32Array}
 */
function flat(level) {
  return new Float32Array(BINS).fill(level);
}

for (const palette of PALETTES) {
  test(`test_under_${palette}_a_fraction_below_the_ramp_takes_its_bottom_color`, () => {
    assert.deepEqual(rampColor(palette, BLUE, BELOW), rampColor(palette, BLUE, 0));
  });

  test(`test_under_${palette}_a_fraction_above_the_ramp_takes_its_top_color`, () => {
    assert.deepEqual(rampColor(palette, BLUE, ABOVE), rampColor(palette, BLUE, 1));
  });

  test(`test_under_${palette}_no_ramp_component_exceeds_the_channel_maximum`, () => {
    const top = Math.max(...SWEEP.flatMap((at) => rampColor(palette, BLUE, at)));
    assert.ok(top <= (fx.CHANNEL_MAX ?? -1), `top component ${top}, channel maximum ${fx.CHANNEL_MAX}`);
  });

  test(`test_under_${palette}_reading_one_ramp_color_twice_hands_back_one_object`, () => {
    const [first, second] = midColorTwice(palette);
    assert.equal(first, second);
  });

  test(`test_under_${palette}_the_fade_halo_is_given_stops`, () => {
    assert.ok(haloStops(palette).length > 0, `halo stops under ${palette}: ${JSON.stringify(haloStops(palette))}`);
  });
}

for (const palette of PALETTES) {
  for (const at of READ_AT) {
    test(`test_under_${palette}_the_color_read_off_its_ramp_at_${at}_is_the_suite_color_there`, () => {
      assert.equal(hexColor(fx.rampOf?.(palette, BLUE), at), suiteColorAt(palette, BLUE, at));
    });
  }
}

test("test_under_accent_a_ramp_read_after_a_ramp_for_another_accent_keeps_its_own_accents_color", () => {
  const ramp = fx.rampOf?.(fx.ACCENT ?? "", BLUE);
  fx.rampOf?.(fx.ACCENT ?? "", RED);
  const color = hexColor(ramp, MID);
  assert.equal(color, suiteColorAt(fx.ACCENT ?? "", BLUE, MID));
});

test("test_under_retro_the_bars_draw_in_one_gradient_of_more_than_one_color", () => {
  const stops = barStops(RETRO);
  const colors = new Set((Array.isArray(stops) ? stops : []).map(([, c]) => rgbOf(c).join()));
  assert.ok(colors.size > 1, `bar stops under ${RETRO}: ${JSON.stringify(stops)}`);
});

test("test_under_a_suite_coloring_each_band_the_bars_are_given_no_gradient", () => {
  assert.equal(barStops(INFERNO), null);
});

for (const suite of SUITES) {
  test(`test_under_${suite}_the_trace_is_colored_by_level`, () => {
    const colors = new Set((fx.traceStops?.(suite, BLUE) ?? []).map(([, c]) => rgbOf(c).join()));
    assert.ok(colors.size > 1, `trace colors under ${suite}: ${[...colors].join(" | ")}`);
  });
}

test("test_under_accent_the_trace_is_solid_in_the_accent_handed_in", () => {
  const colors = new Set((fx.traceStops?.(fx.ACCENT ?? "", BLUE) ?? []).map(([, c]) => rgbOf(c).join()));
  assert.deepEqual([...colors], [rgbOf(BLUE).join()]);
});

test("test_under_accent_the_ramp_draws_in_the_accents_shades", () => {
  const color = rampColor(fx.ACCENT ?? "", BLUE, MID);
  assert.ok(color[B] > color[R], `mid-ramp color under a blue accent: ${color.join()}`);
});

test("test_under_accent_the_top_line_stop_draws_in_the_accents_shade", () => {
  const stops = fx.suiteLineStops?.(fx.ACCENT ?? "", BLUE) ?? [];
  const color = rgbOf(stops.at(-1)?.[1] ?? "#ff0000");
  assert.ok(color[B] > color[R], `top line stop under a blue accent: ${color.join()}`);
});

test("test_under_accent_a_ramp_follows_its_accent_after_a_ramp_for_another_accent", () => {
  rampColor(fx.ACCENT ?? "", BLUE, MID);
  const color = rampColor(fx.ACCENT ?? "", RED, MID);
  assert.ok(color[R] > color[B], `mid-ramp color under a red accent after a blue one: ${color.join()}`);
});

test("test_a_louder_bin_inside_a_band_raises_its_top", () => {
  const raised = flat(QUIET);
  raised[INSIDE] = LOUD;
  const tops = [fx.bandTop?.(flat(QUIET), BAND, BANDS3), fx.bandTop?.(raised, BAND, BANDS3)];
  assert.ok(Number(tops[1]) > Number(tops[0]), `band top before and after: ${tops.join(" | ")}`);
});

test("test_a_louder_bin_outside_a_band_leaves_its_top", () => {
  const raised = flat(QUIET);
  raised[OUTSIDE] = LOUD;
  assert.equal(fx.bandTop?.(raised, BAND, BANDS3), fx.bandTop?.(flat(QUIET), BAND, BANDS3));
});

test("test_a_quiet_band_after_a_loud_one_sits_at_its_own_level", () => {
  fx.bandTop?.(flat(LOUD), BAND, BANDS3);
  assert.equal(fx.bandTop?.(flat(QUIET), BAND, BANDS3), QUIET);
});
