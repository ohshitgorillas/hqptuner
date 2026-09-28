// Suite for the view the METER page's spectrogram paints
// (components/meter/Spectrogram.js `spectroView`), read off its time span.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/meter/spectrogram-view.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { spectroView } from "../../../../hqptuner/static/components/meter/Spectrogram.js";

const BINS = [
  { ms: 1000, n: 2 },
  { ms: 1500, n: 0 },
];

/** @param {string} window */
const fixture = (window) => ({
  cells: [],
  bins: BINS,
  window,
  range: "90",
  geometry: { nyquist: 22050 },
  scale: "log",
});

test("the span is the visible bins' total on the whole-track window and the window's width otherwise", () => {
  assert.deepEqual([spectroView(fixture("all")).span, spectroView(fixture("30")).span], [2500, 30000]);
});
