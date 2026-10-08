// Behavioral suite for hqptuner/static/store/faceplate/engine.js: the engine row's readings off one Status frame, the
// per-track counter deltas and whether the output buffer applies. Every reading is a number while the engine plays and
// the field carries one, and none (null) otherwise, so each null case is asserted beside the playing value it replaces.
//
// The frame is the wire: every case hands in Status attributes as the daemon sends them, strings.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/engine.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { engineReadings } from "../../../../hqptuner/static/store/faceplate/engine.js";

/** @typedef {Record<string, string>} Frame */

/** A Status frame while playing. @type {Frame} */
const PLAYING = {
  state: "2",
  process_speed: "1.62",
  input_fill: "0.823",
  output_fill: "0.746",
  clips: "3",
  apod: "5410",
};
/** The same frame with the engine stopped. @type {Frame} */
const STOPPED = { ...PLAYING, state: "0" };
/** This track's deltas, as store/health.js counts them. */
const DELTAS = { clips: 2, apod: 12 };

/**
 * The readings for one frame.
 *
 * @param {Frame} frame
 * @param {boolean} [applies]  whether the output buffer applies
 */
const read = (frame, applies = true) => engineReadings(frame, DELTAS, applies);

test("test_a_playing_engine_reads_its_speed_and_a_stopped_one_none", () => {
  assert.deepEqual([read(PLAYING).speed, read(STOPPED).speed], [1.62, null]);
});

test("test_an_empty_speed_field_reads_none", () => {
  assert.deepEqual([read(PLAYING).speed, read({ ...PLAYING, process_speed: "" }).speed], [1.62, null]);
});

test("test_the_buffers_read_as_whole_percents", () => {
  const r = read(PLAYING);
  assert.deepEqual([r.input, r.output], [82, 75]);
});

test("test_a_fill_past_full_reads_as_full", () => {
  assert.equal(read({ ...PLAYING, input_fill: "1.4" }).input, 100);
});

test("test_a_buffer_the_daemon_reports_as_minus_one_reads_none", () => {
  assert.deepEqual([read(PLAYING).input, read({ ...PLAYING, input_fill: "-1" }).input], [82, null]);
});

test("test_an_output_buffer_that_does_not_apply_reads_none", () => {
  assert.deepEqual([read(PLAYING, true).output, read(PLAYING, false).output], [75, null]);
});

test("test_a_stopped_engine_reads_no_buffers", () => {
  const r = read(STOPPED);
  assert.deepEqual([read(PLAYING).input, r.input, r.output], [82, null, null]);
});

test("test_clipping_reads_this_tracks_delta_and_the_total", () => {
  assert.deepEqual(read(PLAYING).clips, { track: 2, total: 3 });
});

test("test_apodizing_reads_this_tracks_delta_and_the_total", () => {
  assert.deepEqual(read(PLAYING).apod, { track: 12, total: 5410 });
});

test("test_a_counter_whose_track_delta_equals_the_total_reads_no_track_count", () => {
  const frame = { ...PLAYING, clips: "5" };
  assert.deepEqual(engineReadings(frame, { ...DELTAS, clips: 5 }, true).clips, { track: null, total: 5 });
});

test("test_a_counter_with_an_unreadable_total_reads_no_track_count", () => {
  assert.deepEqual([read(PLAYING).apod.track, read({ ...PLAYING, apod: "" }).apod.track], [12, null]);
});

test("test_a_stopped_engine_reads_no_counts", () => {
  assert.deepEqual(
    [read(PLAYING).apod, read(STOPPED).apod],
    [
      { track: 12, total: 5410 },
      { track: null, total: null },
    ],
  );
});
