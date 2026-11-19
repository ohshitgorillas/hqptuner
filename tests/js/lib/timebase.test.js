// Behavioral suite for lib/timebase.js, the browser's one time base: whole samples to ms at a rate, ms to the seconds a
// vendor shader counts in, and a frame's start
// and end, where a frame with no stamp reads as NaN and a frame with no converted end ends where its start plus its
// length says.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/timebase.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { endOf, msToSeconds, samplesToMs, startOf } from "../../../hqptuner/static/lib/timebase.js";

test("test_one_second_of_samples_is_1000_ms", () => {
  assert.equal(samplesToMs(176400, 176400), 1000);
});

test("test_2500_ms_is_2_point_5_seconds", () => {
  assert.equal(msToSeconds(2500), 2.5);
});

test("test_samples_at_no_rate_are_no_time", () => {
  assert.ok(Number.isNaN(samplesToMs(1000, NaN)));
});

test("test_a_frame_with_no_stamp_starts_nowhere", () => {
  assert.ok(Number.isNaN(startOf({ ms: 20 })));
});

test("test_a_frame_with_no_stamp_ends_nowhere", () => {
  assert.ok(Number.isNaN(endOf({ ms: 20 })));
});

test("test_a_frame_with_no_converted_end_ends_at_its_start_plus_its_length", () => {
  assert.equal(endOf({ at: 5000, ms: 17.5 }), 5017.5);
});

test("test_a_frame_with_a_converted_end_ends_there", () => {
  assert.equal(endOf({ at: 5000, ms: 17.5, end: 5017.75 }), 5017.75);
});
