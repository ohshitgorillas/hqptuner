// Behavioral suite for the one test of whether the engine plays, in
// store/signals.js: isPlaying on a status frame, and enginePlaying on the
// engineStatus signal (docs/superpowers/specs/meter-loop-idle-design.md,
// Modules). A status frame's `state` is 0 stopped, 1 paused, 2 playing,
// 3 stop requested.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/signals.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { engineStatus, enginePlaying, isPlaying } from "../../../hqptuner/static/store/signals.js";

const STOPPED = 0;
const PAUSED = 1;
const PLAYING = 2;
const STOP_REQUESTED = 3;

// /api/status's `status` block carries every value as a string
// (docs/spec/openapi.json, StatusReport.status), so a real frame's `state`
// is "2", not 2; isPlaying admits both (`state?: number | string`).
const AS_SENT = String;

afterEach(() => {
  engineStatus.value = null;
});

/**
 * Stand in for /api/status's last report, carrying the given `status` block.
 *
 * @param {unknown} status
 */
function report(status) {
  engineStatus.value = /** @type {any} */ ({ status });
}

// Break: compare `state` to anything but playing, or return a constant.
test("test_is_playing_says_true_for_a_frame_whose_state_is_playing", () => {
  assert.equal(isPlaying({ state: PLAYING }), true);
});

// Break: compare `state` strictly to the number PLAYING, so a status frame as
// /api/status sends it, with `state` "2", never reads as playing.
test("test_is_playing_says_true_for_a_frame_whose_state_is_playing_as_a_string", () => {
  assert.equal(isPlaying({ state: AS_SENT(PLAYING) }), true);
});

for (const [name, state] of /** @type {const} */ ([
  ["stopped", STOPPED],
  ["paused", PAUSED],
  ["stop_requested", STOP_REQUESTED],
])) {
  // Break: treat any non-stopped state, or any truthy state, as playing.
  test(`test_is_playing_says_false_for_a_frame_whose_state_is_${name}`, () => {
    assert.equal(isPlaying({ state }), false);
  });

  // Break: treat any string state, or any non-stopped string state, as playing.
  test(`test_is_playing_says_false_for_a_frame_whose_state_is_${name}_as_a_string`, () => {
    assert.equal(isPlaying({ state: AS_SENT(state) }), false);
  });
}

// Break: read a frame without a `state` as playing.
test("test_is_playing_says_false_for_a_frame_with_no_state", () => {
  assert.equal(isPlaying({}), false);
});

// Break: throw on, or say playing for, a null frame.
test("test_is_playing_says_false_for_a_null_frame", () => {
  assert.equal(isPlaying(null), false);
});

// Break: throw on, or say playing for, an undefined frame.
test("test_is_playing_says_false_for_an_undefined_frame", () => {
  assert.equal(isPlaying(undefined), false);
});

// Break: read enginePlaying from anything but engineStatus's `status` block.
test("test_engine_playing_is_true_when_the_last_status_block_says_playing", () => {
  report({ state: AS_SENT(PLAYING) });
  assert.equal(enginePlaying.value, true);
});

// Break: latch enginePlaying once it has been true.
test("test_engine_playing_follows_the_last_report_from_playing_to_stopped", () => {
  report({ state: AS_SENT(PLAYING) });
  const before = enginePlaying.value;
  report({ state: AS_SENT(STOPPED) });
  assert.deepEqual([before, enginePlaying.value], [true, false]);
});

// Break: say playing for a paused engine.
test("test_engine_playing_is_false_when_the_last_status_block_says_paused", () => {
  report({ state: AS_SENT(PAUSED) });
  assert.equal(enginePlaying.value, false);
});

// Break: throw on, or say playing for, an engineStatus with no report yet.
test("test_engine_playing_is_false_with_no_status_report", () => {
  engineStatus.value = null;
  assert.equal(enginePlaying.value, false);
});

// Break: throw on, or say playing for, a report whose `status` block is missing.
test("test_engine_playing_is_false_when_the_report_has_no_status_block", () => {
  report(null);
  assert.equal(enginePlaying.value, false);
});

// Break: read `state` from the top of the report instead of its `status` block.
test("test_engine_playing_ignores_a_playing_state_outside_the_status_block", () => {
  engineStatus.value = /** @type {any} */ ({ state: AS_SENT(PLAYING), status: { state: AS_SENT(STOPPED) } });
  assert.equal(enginePlaying.value, false);
});
