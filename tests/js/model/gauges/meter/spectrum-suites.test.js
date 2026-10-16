// Behavioral suite for the spectrum's color and band surface (hqptuner/static/model/gauges/meter/spectrumfx.js), the
// one home of the spectrum styles' colors. The palette choices are the page accent and the named color suites; a
// suite's ramp is read at a fraction along it, a fraction beyond either end taking that end; under the Accent palette
// the Trace style's trace draws solid in the accent in force and the other parts draw in the accent's shades. A bar's
// band top is read from the plot fractions grouped into bands. Nothing here carries time: the same call answers the
// same way whatever was asked before it.
//
// The surface is read off the module namespace with optional access, so a module without a name fails its cases on
// their assertions rather than at load. The palette identifiers are iterated, never asserted: which suites exist, their
// order and their count are the owner's.
//
// The bars' and the halo's stops have no case here: no caller names the export that gives them, so the test cannot
// reach them by a name that is contract. How many bands span the plot is a module constant, and a constant is not
// asserted.
//
// Run: node --test tests/js/model/gauges/meter/spectrum-suites.test.js

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
 *   traceStops?: (suite: string, accent: string) => Stop[],
 *   suiteLineStops?: (suite: string, accent: string) => Stop[],
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
}

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
