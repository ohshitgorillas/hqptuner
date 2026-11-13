// Behavioral suite for hqptuner/static/model/gauges/loudness.js: the whole percent of the maximum loudness shelving a
// shelf scale (0 … 1, vendor/eqlab/core/dsp/curves.js shelfScale) applies.
//
// Run: node --test tests/js/model/gauges/loudness.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { percentApplied } from "../../../../hqptuner/static/model/gauges/loudness.js";

test("test_percent_applied_scales_a_share_to_a_percent", () => {
  assert.equal(percentApplied(0.25), 25);
});
