// Behavioral suite for hqptuner/static/store/faceplate/engine.js: the engine row's readings off one Status frame, the
// per-track counter deltas and whether the output buffer applies. Every reading is a number while the engine plays and
// the field carries one, and none (null) otherwise.
//
// The frame is the wire: every case hands in Status attributes as the daemon sends them, strings, and the same frame is
// the latest /api/status on engineStatus. The engine plays only while /api/health reports the connection Ready, so every
// case runs on a Ready connection except the phase cases, which move it away after the frame landed.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/engine.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { engineReadings } from "../../../../hqptuner/static/store/faceplate/engine.js";
import { engineStatus, health } from "../../../../hqptuner/static/store/signals.js";
import { playback } from "../../../../hqptuner/static/store/core/readings.js";

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
/** This track's deltas, as store/health.js counts them. */
const DELTAS = { clips: 2, apod: 12 };

/**
 * The readings for one frame.
 *
 * @param {Frame} frame
 * @param {boolean} [applies]  whether the output buffer applies
 */
const read = (frame, applies = true) => {
  engineStatus.value = { status: { ...frame } };
  return engineReadings(frame, DELTAS, applies, playback.value.playing);
};

/** The lifecycle generation every /api/health reply below carries. */
const GEN = 3;
/** The connection lifecycle phases other than Ready: Down, Reachable and Alarm. */
const NOT_READY = ["Down", "Reachable", "Alarm"];

beforeEach(() => {
  health.value = { phase: "Ready", generation: GEN };
  engineStatus.value = null;
});

test("test_a_playing_engine_reads_its_speed", () => {
  assert.equal(read(PLAYING).speed, 1.62);
});

test("test_a_fill_past_full_reads_as_full", () => {
  assert.equal(read({ ...PLAYING, input_fill: "1.4" }).input, 100);
});

test("test_a_playing_engine_reads_its_input_buffer_fill", () => {
  assert.equal(read(PLAYING).input, 82);
});

test("test_an_output_buffer_that_applies_reads_its_fill", () => {
  assert.equal(read(PLAYING, true).output, 75);
});

test("test_clipping_reads_this_tracks_delta_and_the_total", () => {
  assert.deepEqual(read(PLAYING).clips, { track: 2, total: 3 });
});

test("test_apodizing_reads_this_tracks_delta_and_the_total", () => {
  assert.deepEqual(read(PLAYING).apod, { track: 12, total: 5410 });
});

test("test_a_counter_whose_track_delta_equals_the_total_reads_no_track_count", () => {
  const frame = { ...PLAYING, clips: "5" };
  engineStatus.value = { status: { ...frame } };
  assert.deepEqual(engineReadings(frame, { ...DELTAS, clips: 5 }, true, playback.value.playing).clips, {
    track: null,
    total: 5,
  });
});

// --- readings that read none ---------------------------------------------------------------------------------------

/** @typedef {import("../../../../hqptuner/static/store/faceplate/engine.js").EngineReadings} EngineReadings */

/** @type {[string, Frame, boolean, (r: EngineReadings) => number | null][]} */
const READS_NONE = [
  ["a_stopped_engine_reads_no_speed", { ...PLAYING, state: "0" }, true, (r) => r.speed],
  ["a_stopped_engine_reads_no_input_buffer", { ...PLAYING, state: "0" }, true, (r) => r.input],
  ["a_stopped_engine_reads_no_output_buffer", { ...PLAYING, state: "0" }, true, (r) => r.output],
  ["an_empty_speed_reads_none", { ...PLAYING, process_speed: "" }, true, (r) => r.speed],
  ["a_minus_1_buffer_reads_none", { ...PLAYING, input_fill: "-1" }, true, (r) => r.input],
  ["an_output_buffer_that_does_not_apply_reads_none", PLAYING, false, (r) => r.output],
  ["an_unreadable_total_reads_none", { ...PLAYING, clips: "n/a" }, true, (r) => r.clips.total],
];

for (const [name, frame, applies, field] of READS_NONE) {
  test(`test_${name}`, () => {
    assert.equal(field(read(frame, applies)), null);
  });
}

// --- the connection phase: while it is not Ready the engine counts as not playing, whatever the last frame said ---

for (const phase of NOT_READY) {
  // Break: the engine row reads playing off the frame's state alone and ignores the connection phase.
  test(`test_a_playing_frame_reads_no_speed_once_the_connection_is_not_ready: ${phase}`, () => {
    const seen = [read(PLAYING).speed];
    health.value = { phase, generation: GEN };
    seen.push(engineReadings(PLAYING, DELTAS, true, playback.value.playing).speed);
    assert.deepEqual(seen, [1.62, null]);
  });
}
