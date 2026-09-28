// The plot width a primer pane reports: its content width times the plot's
// share of the viewBox, rounded to whole CSS pixels.
import test from "node:test";
import assert from "node:assert/strict";

const { plotPx } = await import("../../../../hqptuner/static/components/primer/measure.js");

test("plotPx scales the content width by the ratio and rounds to whole pixels", () => {
  assert.deepEqual([plotPx(640, 0.9), plotPx(333, 0.9)], [576, 300]);
});
