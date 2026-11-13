// Behavioral suite for lib/apodscale.js playedMs, the width of playback one
// apodizing bin observed between two Status frames.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/apodscale.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { playedMs } from "../../../hqptuner/static/lib/apodscale.js";

test("test_the_width_is_how_far_the_position_moved", () => {
  assert.equal(playedMs(10, 12.5), 2500);
});

test("test_an_unreadable_position_observed_nothing", () => {
  assert.equal(playedMs(null, 12), 0);
});
