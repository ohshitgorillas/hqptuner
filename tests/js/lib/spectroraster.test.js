// Behavioral suite for lib/spectroraster.js, the spectrogram's colour ramp and
// pixel raster.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/spectroraster.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { rampFrom, rasterize } from "../../../hqptuner/static/lib/spectroraster.js";

// Floor a dark blue, top a warm yellow: apart from each other and from black,
// with a steep last segment so a neighbouring step reads as a different colour.
const RAMP = rampFrom(["#1a2a6c", "#1a2a6c", "#1a2a6c", "#1a2a6c", "#1a2a6c", "#f5d142"]);

const NYQUIST = 22050;
const SPAN = 4000;
const CENTRES = Array.from({ length: 121 }, (_, k) => 20 * 2 ** (k / 12));

// One cell filling the whole strip, every band at full scale.
const VIEW = {
  cells: [{ ms: SPAN, slices: [Float32Array.from(CENTRES, () => 0)], centres: CENTRES, nyquist: NYQUIST }],
  span: SPAN,
  range: 120,
  top: NYQUIST,
  scale: "log",
};

/**
 * The RGB channels of the raster's centre pixel.
 *
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} raster
 * @returns {number[]}
 */
function centreRgb({ width, height, data }) {
  const at = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  return Array.from(data.subarray(at, at + 3));
}

test("test_a_band_at_full_scale_paints_the_ramps_top_colour", () => {
  assert.deepEqual(centreRgb(rasterize(RAMP, VIEW)), RAMP[RAMP.length - 1]);
});
