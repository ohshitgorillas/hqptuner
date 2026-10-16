// Behavioral suite for the meter model's bin math (hqptuner/static/model/gauges/meter/meter.js), written from
// docs/spec/protocol.md (the feed's `frame` event), docs/spec/architecture.md §8.3 (the stride fold) and
// docs/spec/faceplate-spec.md (the Source section's frequency span and range). The model is time-free: nothing here
// hands it a dt, a clock or a wall time, and every case runs on values the test writes.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/meter/meter-math.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeBins,
  foldFrames,
  fraction,
  pickBins,
  spanShare,
  traceColumns,
} from "../../../../../hqptuner/static/model/gauges/meter/meter.js";
import { near } from "../../../support/near.js";

//: Tolerance for a power average written here to three places and possibly stored in a Float32Array.
const DB_EPS = 1e-3;
//: A level whose power is negligible beside any level the tests fold it with: the wire's own floor, 300 dB down.
const SILENT = -300;
//: A loud level, and that level less half its power and less two thirds of it (10·log10(1/2), 10·log10(1/3)).
const LOUD = -10;
const LOUD_HALF_POWER = -13.0103;
const LOUD_THIRD_POWER = -14.7712;

/**
 * [ok, message] for spreading into ONE assert.ok: as many values as written, each within `tol` of its own.
 *
 * @param {ArrayLike<number>} actual
 * @param {number[]} expected
 * @param {number} tol
 * @returns {[boolean, string]}
 */
const nearEach = (actual, expected, tol) => [
  actual.length === expected.length && expected.every((e, i) => Math.abs(actual[i] - e) <= tol),
  `expected [${expected}] ± ${tol}, got [${Array.from(actual)}]`,
];

/**
 * The base64 string the feed sends for these bytes.
 *
 * @param {number[]} bytes
 */
const wire = (bytes) => Buffer.from(Uint8Array.from(bytes)).toString("base64");

/**
 * One channel of a decoded feed frame.
 *
 * @param {number} peak  dBFS
 * @param {number} rms  dBFS
 * @param {number[]} bins  dBFS
 */
const channel = (peak, rms, bins) => ({ peak, rms, bins: Float32Array.from(bins) });

/**
 * A decoded feed frame of these channels.
 *
 * @param {ReturnType<typeof channel>[]} channels
 */
const frame = (channels) => ({ channels, ms: 21.333 });

// ── Decoding the wire's bins ─────────────────────────────────────────────

test("test_each_bin_reads_its_count_of_half_db_steps_below_full_scale_in_bin_order", () => {
  // Counts 1, 40, 600, two bytes each, low byte first.
  assert.deepEqual(Array.from(decodeBins(wire([1, 0, 40, 0, 0x58, 0x02]))), [-0.5, -20, -300]);
});

test("test_a_bin_count_reads_its_low_byte_first", () => {
  // 0x012c is 300 steps; read high byte first it would be 0x2c01.
  assert.deepEqual(Array.from(decodeBins(wire([0x2c, 0x01]))), [-150]);
});

test("test_a_padded_bin_string_decodes_every_bin_and_no_more", () => {
  // Five bins are ten bytes, which base64 pads.
  assert.deepEqual(Array.from(decodeBins(wire([2, 0, 4, 0, 6, 0, 8, 0, 10, 0]))), [-1, -2, -3, -4, -5]);
});

// ── Folding the frames a paint covers ────────────────────────────────────

//: Three frames of two channels: channel 0's loudest peak is in the middle frame, channel 1's in the first.
const PEAK_FRAMES = [
  frame([channel(-20, LOUD, [LOUD]), channel(-3, LOUD, [LOUD])]),
  frame([channel(-6, LOUD, [LOUD]), channel(-40, LOUD, [LOUD])]),
  frame([channel(-30, LOUD, [LOUD]), channel(-12, LOUD, [LOUD])]),
];

test("test_a_folded_peak_is_each_channels_loudest_peak_over_the_frames", () => {
  assert.deepEqual(
    foldFrames(PEAK_FRAMES).channels.map((c) => c.peak),
    [-6, -3],
  );
});

test("test_a_folded_rms_of_a_loud_and_a_silent_frame_holds_half_the_loud_frames_power", () => {
  const folded = foldFrames([frame([channel(LOUD, LOUD, [LOUD])]), frame([channel(SILENT, SILENT, [SILENT])])]);
  assert.ok(...near(folded.channels[0].rms, LOUD_HALF_POWER, DB_EPS));
});

test("test_a_folded_rms_averages_power_over_every_frame_handed_in", () => {
  const folded = foldFrames([
    frame([channel(LOUD, LOUD, [LOUD])]),
    frame([channel(SILENT, SILENT, [SILENT])]),
    frame([channel(SILENT, SILENT, [SILENT])]),
  ]);
  assert.ok(...near(folded.channels[0].rms, LOUD_THIRD_POWER, DB_EPS));
});

test("test_a_folded_rms_takes_no_power_from_another_channel", () => {
  const folded = foldFrames([
    frame([channel(LOUD, LOUD, [LOUD]), channel(-40, -40, [-40])]),
    frame([channel(LOUD, LOUD, [LOUD]), channel(-40, -40, [-40])]),
  ]);
  assert.ok(...near(folded.channels[1].rms, -40, DB_EPS));
});

test("test_each_folded_bin_is_the_power_average_of_that_bin_alone", () => {
  const folded = foldFrames([frame([channel(LOUD, LOUD, [LOUD, -40])]), frame([channel(LOUD, LOUD, [SILENT, -40])])]);
  assert.ok(...nearEach(folded.channels[0].bins, [LOUD_HALF_POWER, -40], DB_EPS));
});

test("test_a_fold_carries_no_peak_from_the_fold_before_it", () => {
  const quiet = [frame([channel(-50, -60, [-60])])];
  const first = foldFrames(quiet).channels[0].peak;
  foldFrames([frame([channel(-1, -3, [-3])])]);
  assert.equal(foldFrames(quiet).channels[0].peak, first);
});

// ── Picking a channel's bins ─────────────────────────────────────────────

test("test_a_channel_index_picks_that_channels_bins", () => {
  const picked = pickBins(frame([channel(-1, -10, [-10, -40]), channel(-2, -20, [-20, -30])]), "1");
  assert.deepEqual(Array.from(picked), [-20, -30]);
});

// ── Tracing bins into drawing columns ────────────────────────────────────

test("test_each_column_reads_the_loudest_bin_under_it_low_frequencies_first", () => {
  // Nine bins from 0 Hz to Nyquist: a tone low in the lower half, a quieter one high in the upper half.
  const bins = Float32Array.from([-50, -6, -50, -50, -50, -50, -50, -30, -50]);
  assert.deepEqual(Array.from(traceColumns(bins, 2)), [-6, -30]);
});

test("test_a_trace_has_as_many_columns_as_asked_for", () => {
  const bins = Float32Array.from([-50, -6, -50, -50, -50, -50, -50, -30, -50]);
  assert.deepEqual([traceColumns(bins, 3).length, traceColumns(bins, 7).length], [3, 7]);
});

// ── Frequency spans ──────────────────────────────────────────────────────

/** @type {{ span: string, share: number }[]} */
const SPANS = [
  { span: "full", share: 1 },
  { span: "half", share: 0.5 },
  { span: "quarter", share: 0.25 },
];

for (const { span, share } of SPANS) {
  test(`test_the_${span}_span_takes_its_share_of_the_band`, () => {
    assert.equal(spanShare(span), share);
  });
}

// ── Where a level sits on the plot ───────────────────────────────────────

test("test_full_scale_sits_at_the_top_of_the_plot_at_every_range", () => {
  assert.deepEqual([fraction(0, 120), fraction(0, 300)], [1, 1]);
});

test("test_a_level_sits_its_depth_below_full_scale_over_the_range_down_from_the_top", () => {
  assert.deepEqual([fraction(-30, 120), fraction(-60, 120), fraction(-90, 120)], [0.75, 0.5, 0.25]);
});

test("test_the_same_level_sits_higher_on_a_deeper_range", () => {
  assert.deepEqual([fraction(-60, 120), fraction(-60, 240)], [0.5, 0.75]);
});
