// Behavioral suite for the shared live-volume signal — `volumeShown`, the
// playback volume that display surfaces (the Loudness plot, the Range bar
// needle) read.
//
// Two sources feed it. `volume` is the engine-reported playback level, a dB
// string off the wire and null before the first poll. `volumeDrag` is the number
// of dB currently being dragged on the playback-volume knob, and null whenever
// no drag is in progress. A drag in progress WINS: what a display surface shows
// while the user is moving the knob is where the knob is, not the level the last
// poll happened to report.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every case
// drives the exported store signals and reads the exported computed — the same
// surface a component has. Nothing is stubbed.
//
// State reset is total on every call: module-level signals outlive a test file,
// so a partial reset makes cases pass alone and fail in sequence.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/volumeshown.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { volume, volumeDrag, volumeShown } from "../../../hqptuner/static/store/signals.js";

// Both sources, always, in the order a poll and a drag would set them.
/** @param {{ level?: string | null, drag?: number | null }} [seams] */
function reset({ level = null, drag = null } = {}) {
  volume.value = level;
  volumeDrag.value = drag;
}

// --- no drag in progress: the engine's own report ----------------------------

test("test_with_no_drag_the_shown_volume_is_the_engine_report", () => {
  reset({ level: "-24" });
  assert.equal(volumeShown.value, "-24");
});

test("test_with_no_drag_and_nothing_polled_yet_nothing_is_shown", () => {
  reset({ level: null });
  assert.equal(volumeShown.value, null);
});

// --- a drag in progress: the knob wins ---------------------------------------

test("test_a_drag_in_progress_is_shown_as_its_number_in_decibels", () => {
  reset({ level: "-24", drag: -33.5 });
  assert.equal(volumeShown.value, "-33.5");
});

test("test_a_drag_in_progress_survives_a_later_engine_report", () => {
  // The daemon keeps polling mid-drag and reports the level it has caught up
  // to; the surface must keep showing the knob, not flicker back to the poll.
  reset({ level: "-24", drag: -33.5 });
  volume.value = "-12";
  assert.equal(volumeShown.value, "-33.5");
});

test("test_a_drag_to_zero_decibels_is_shown_rather_than_the_engine_report", () => {
  // 0 dB is the trap: falsy, so a source picked with `||` shows the engine's
  // level instead of the top of the knob's travel.
  reset({ level: "-24", drag: 0 });
  assert.equal(volumeShown.value, "0");
});

test("test_a_drag_in_progress_shows_even_before_the_first_poll", () => {
  reset({ level: null, drag: -40 });
  assert.equal(volumeShown.value, "-40");
});

// --- the drag ends -----------------------------------------------------------

test("test_a_released_drag_hands_the_display_back_to_the_engine_report", () => {
  reset({ level: "-24", drag: -33.5 });
  volumeDrag.value = null;
  assert.equal(volumeShown.value, "-24");
});
