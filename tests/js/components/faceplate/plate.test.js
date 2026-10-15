// Rendered suite for the entry, hqptuner/static/app.js: the plate it mounts carries the format the window holds.
// Under node there is no #app to mount into, so the entry only exports its root.
//
// Not reachable here: the window's resize listener and the document's Escape and outside-click listeners, which the
// plate registers in an effect; server rendering runs no effects. A browser run closes that gap.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/plate.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Faceplate } from "../../../../hqptuner/static/app.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/plate.js";
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

test("test_the_plate_carries_the_format_the_window_holds", () => {
  viewport.value = { w: 1200, h: 900 };
  assert.equal(attr(plateEl(), "data-size"), "normal");
});
