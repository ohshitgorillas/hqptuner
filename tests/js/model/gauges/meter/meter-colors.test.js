// Behavioral suite for the Source level meter's colours on the meter model (hqptuner/static/model/gauges/meter/meter.js):
// the peak bar, the RMS bar, the held-peak mark and the numeric peak readout take their colours from the palette picked
// for the spectrum. Under a palette that colours the spectrum by level (Retro and the gradients), each bar and the mark
// draw in the colour the spectrum draws at their own level; under Accent they follow the accent in force; and picking
// another palette changes the readout's colour.
//
// A reading is given as fractions of the bar, 0 on the floor and 1 at full scale, and the spectrum's colour at a level
// is read from its own suite surface (hqptuner/static/model/gauges/meter/spectrumfx.js). Both surfaces are read off their
// module namespaces with optional access, so a module without them fails these cases on their assertions.
//
// Run: node --test tests/js/model/gauges/meter/meter-colors.test.js

import test from "node:test";
import assert from "node:assert/strict";

import * as meterModel from "../../../../../hqptuner/static/model/gauges/meter/meter.js";
import * as spectrumModel from "../../../../../hqptuner/static/model/gauges/meter/spectrumfx.js";

/** @typedef {{ peak: number, rms: number, hold: number }} BarReading */
/** @typedef {{ peak: string, rms: string, hold: string, readout: string }} MeterPaint */

/**
 * The meter's colour surface: the colours a reading draws in under a palette with an accent in force.
 *
 * @type {{ fraction: unknown, meterColors?: (palette: string, reading: BarReading, accent: string) => MeterPaint }}
 */
const meter = meterModel;

/**
 * The spectrum's colour surface: the colour a part of the spectrum at a plot fraction draws in under a palette.
 *
 * @type {{ suiteColor?: (suite: string, at: number, accent: string) => string }}
 */
const spectrum = spectrumModel;

//: A reading whose RMS, peak and hold sit at three different levels, each below the next.
/** @type {BarReading} */
const READING = { rms: 0.25, peak: 0.5, hold: 0.75 };
//: Two accents a user may pick, unlike each other.
const BLUE = "#4f9dde";
const GREEN = "#5fd068";
//: The palettes that colour the spectrum by level, as the store holds them.
const BY_LEVEL = ["retro", "inferno", "viridis", "borealis", "mono"];
//: A gradient palette, and a second one unlike it.
const INFERNO = "inferno";
const VIRIDIS = "viridis";
//: The palette that draws in the accent's shades, as the store holds it.
const ACCENT = "accent";
//: The meter's parts that draw at a level of their own.
/** @type {(keyof BarReading)[]} */
const PARTS = ["rms", "hold"];
//: Every part the meter draws.
/** @type {(keyof MeterPaint)[]} */
const ALL_PARTS = ["peak", "rms", "hold", "readout"];

/**
 * The colour the meter draws `part` of `READING` in, lower-cased; a meter without the surface reads as "none".
 *
 * @param {string} palette
 * @param {keyof MeterPaint} part
 * @param {string} accent
 */
const meterColor = (palette, part, accent) =>
  (meter.meterColors?.(palette, READING, accent)?.[part] ?? "none").toLowerCase();

/**
 * The colour the spectrum draws at bar fraction `at` under `palette`, lower-cased; a spectrum without the surface
 * reads as "absent", so it never matches a meter without one.
 *
 * @param {string} palette
 * @param {number} at
 */
const spectrumColor = (palette, at) => (spectrum.suiteColor?.(palette, at, BLUE) ?? "absent").toLowerCase();

for (const palette of BY_LEVEL) {
  test(`test_under_${palette}_the_peak_bar_draws_in_the_spectrum_colour_at_its_level`, () => {
    assert.equal(meterColor(palette, "peak", BLUE), spectrumColor(palette, READING.peak));
  });
}

for (const part of PARTS) {
  test(`test_under_a_gradient_palette_the_${part}_draws_in_the_spectrum_colour_at_its_level`, () => {
    assert.equal(meterColor(INFERNO, part, BLUE), spectrumColor(INFERNO, READING[part]));
  });
}

for (const part of ALL_PARTS) {
  test(`test_under_accent_the_${part}_changes_colour_when_the_accent_does`, () => {
    assert.notEqual(meterColor(ACCENT, part, GREEN), meterColor(ACCENT, part, BLUE));
  });
}

test("test_picking_another_gradient_palette_changes_the_peak_readout_colour", () => {
  assert.notEqual(meterColor(VIRIDIS, "readout", BLUE), meterColor(INFERNO, "readout", BLUE));
});
