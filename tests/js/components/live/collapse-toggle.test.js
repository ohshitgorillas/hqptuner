// Behavioral test for the toggle a LIVE card's collapse handle carries, in
// components/live/collapse.js.
//
// The collapsed state is read back through cardCollapse itself: a fresh handle
// over the same disclosure signal reports `open`, and collapsed is its negation.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/live/collapse-toggle.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { cardCollapse } from "../../../../hqptuner/static/components/live/collapse.js";
import { liveHealthOpen } from "../../../../hqptuner/static/store/ui/prefs.js";

test("test_toggling_a_card_twice_collapses_it_then_opens_it", () => {
  const { onToggle } = cardCollapse("health", liveHealthOpen);
  const collapsed = () => !cardCollapse("health", liveHealthOpen).open;
  onToggle();
  const afterFirst = collapsed();
  onToggle();
  const afterSecond = collapsed();
  assert.deepEqual([afterFirst, afterSecond], [true, false]);
});
