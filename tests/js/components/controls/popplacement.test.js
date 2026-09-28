// Behavioral suite for the combobox pop's vertical placement arithmetic: where
// the pop goes and how tall it may grow, for a trigger rect, the pop's natural
// height and the viewport height.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/controls/popplacement.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { verticalPlacement } from "../../../../hqptuner/static/components/controls/combopop.js";

test("test_a_pop_with_no_room_below_opens_upward_and_ends_just_above_its_trigger", () => {
  // 66px below the trigger against a 300px list, 696px above it.
  const trigger = { top: 700, bottom: 730 };
  const placed = verticalPlacement(trigger, 300, 800);
  assert.equal(placed.top + placed.maxHeight, trigger.top - 4);
});
