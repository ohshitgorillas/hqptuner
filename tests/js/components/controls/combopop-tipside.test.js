// Behavioral suite for the combobox tip's side choice: which side of the pop
// the tip sits on and how wide it may grow, for the pop's edges and the
// viewport width.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/controls/combopop-tipside.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { tipSide } from "../../../../hqptuner/static/components/controls/combopop.js";

test("test_a_tip_takes_the_side_away_from_the_near_viewport_edge_and_sizes_to_its_room", () => {
  // Near the right edge: 284px of room left, 4px right. Near the left edge: the mirror.
  assert.deepEqual(
    [tipSide(300, 980, 1000), tipSide(20, 700, 1000)],
    [
      { left: true, maxWidth: 284 },
      { left: false, maxWidth: 284 },
    ],
  );
});
