// The save popover's setting rows (components/live/Presets.js choiceRows),
// built from the engine's snapshot: one row per setting the snapshot carries.
//
// Run: node --test --import ./tests/js/support/vendor-resolve.js tests/js/components/live/presets-choicerows.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { choiceRows } from "../../../../hqptuner/static/components/live/Presets.js";

const withAdaptive = {
  chain: "pcm",
  fields: { adaptive_volume: { value: "1", name: "1" } },
  autopilot: false,
};

const autopilotOnly = { chain: "pcm", fields: {}, autopilot: false };

test("choiceRows lists a row for each setting the snapshot carries", () => {
  assert.deepEqual(
    [choiceRows(withAdaptive).map((r) => r.value), choiceRows(autopilotOnly).map((r) => r.value)],
    [["autopilot", "adaptive_volume"], ["autopilot"]],
  );
});
