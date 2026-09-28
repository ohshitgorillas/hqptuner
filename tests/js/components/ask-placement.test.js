// The ask panel stays inside its card on the right and inside the 8px margin
// on the left, and never drops below the pending bar.

import test from "node:test";
import assert from "node:assert/strict";

import { anchorPlacement } from "../../../hqptuner/static/components/Ask.js";

const VIEW = { vw: 1200, vh: 800, barTop: 740, popW: 320, popH: 200 };

test("the panel is held inside the card, the margin and the pending bar", () => {
  const nearRight = { ...VIEW, anchor: { left: 1000, bottom: 300 }, card: { left: 600, right: 1180 } };
  const nearLeft = { ...VIEW, anchor: { left: 2, bottom: 700 }, card: { left: 0, right: 580 } };
  assert.deepEqual(
    [anchorPlacement(nearRight), anchorPlacement(nearLeft)],
    [
      { left: 860, top: 300 },
      { left: 8, top: 532 },
    ],
  );
});
