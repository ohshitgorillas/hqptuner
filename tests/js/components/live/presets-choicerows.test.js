// The save popover's setting rows (components/live/Presets.js choiceRows),
// built from the engine's snapshot: one row per setting the snapshot carries.
//
// Run: node --test --import ./tests/js/support/vendor-resolve.js tests/js/components/live/presets-choicerows.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { choiceRows } from "../../../../hqptuner/static/components/live/Presets.js";

// The `autopilot` member is not a setting: rows come from `fields` alone.
const withAdaptive = {
  chain: "pcm",
  fields: { adaptive_volume: { value: "1", name: "1" } },
  autopilot: false,
};

const withDither = { chain: "pcm", fields: { dither: { value: "5", name: "NS5" } } };

test("choiceRows lists a row for each setting the snapshot carries", () => {
  assert.deepEqual(
    [choiceRows(withAdaptive).map((r) => r.value), choiceRows(withDither).map((r) => r.value)],
    [["adaptive_volume"], ["dither"]],
  );
});
