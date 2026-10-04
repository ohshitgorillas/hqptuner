// Rendered suite for the v2 entry, hqptuner/static/v2/app.js: the plate it mounts carries the size the window holds
// and the scale that fits it. Under node there is no #app to mount into, so the entry only exports its root.
//
// Not reachable here: the window's resize listener and the document's Escape and outside-click listeners, which the
// plate registers in an effect; server rendering runs no effects. A browser run closes that gap.
//
// Run: node --test tests/js/components/faceplate/plate.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Faceplate } from "../../../../hqptuner/static/v2/app.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/view.js";
import { elements, attr, classes } from "../../support/markup.js";

beforeEach(() => {
  viewport.value = { w: 1080, h: 810 };
});

/** The rendered plate element. */
function plateEl() {
  const found = elements(render(html`<${Faceplate} />`)).find((e) => classes(e).includes("plate"));
  if (!found) throw new Error("the entry rendered no plate");
  return found;
}

test("test_the_plate_carries_the_size_the_window_holds", () => {
  viewport.value = { w: 1200, h: 900 };
  assert.equal(attr(plateEl(), "data-size"), "11");
});

test("test_the_plate_carries_the_largest_size_in_a_larger_window", () => {
  viewport.value = { w: 1400, h: 1100 };
  assert.equal(attr(plateEl(), "data-size"), "13");
});

test("test_a_window_half_the_smallest_size_scales_the_plate_by_half", () => {
  viewport.value = { w: 540, h: 405 };
  assert.match(String(attr(plateEl(), "style")), /scale\(0\.5\)/);
});
