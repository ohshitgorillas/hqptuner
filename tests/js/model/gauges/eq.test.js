// Behavioral suite: a pipeline's band count.

import test from "node:test";
import assert from "node:assert/strict";

import { peqCount } from "../../../../hqptuner/static/model/gauges/eq.js";

/**
 * A stage record as the tables below write it.
 *
 * @typedef {{ kind: string, type?: string, f?: number, g?: number, q?: number, t?: number }} Rec
 */

//: A pipeline holding a delay, an old peak, a low-pass and an old high shelf, gain in Lin.
/** @type {Rec} */
const DELAY = { kind: "delay", t: 0.001 };
/** @type {Rec} */
const LP = { kind: "iir", type: "lp", f: 120, q: 0.707 };
const PIPE = {
  src: 0,
  mix: 0,
  gain: 0.5,
  unit: "Lin",
  stages: [
    DELAY,
    { kind: "iir", type: "peak", f: 41, g: -8.5, q: 4.3 },
    LP,
    { kind: "iir", type: "hshelf", f: 8000, g: -1.5, q: 0.7 },
  ],
};

//: Two band stages: a peak and a high shelf.
/** @type {Rec[]} */
const NEW = [
  { kind: "iir", type: "peak", f: 200, g: 2.6, q: 3.5 },
  { kind: "iir", type: "hshelf", f: 4000, g: 1.2, q: 0.7 },
];

test("test_peq_count_counts_peak_and_shelf_stages_only", () => {
  assert.equal(peqCount(PIPE.stages), 2);
});

test("test_peq_count_skips_a_convolution_stage", () => {
  assert.equal(peqCount([{ kind: "conv" }, ...NEW]), 2);
});
