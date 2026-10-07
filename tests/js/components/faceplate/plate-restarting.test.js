// Rendered suite for hqptuner/static/components/faceplate/Plate.js: the plate marks itself with `data-restarting`
// while the engine restarts, and carries no such mark otherwise.
//
// The engine's restart state is driven by assigning the exported `engineRestarting` signal; no store function is
// stubbed.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/plate-restarting.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Plate } from "../../../../hqptuner/static/components/faceplate/Plate.js";
import { engineRestarting } from "../../../../hqptuner/static/store/enginewrite.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/view.js";
import { elements, classes, hasAttr } from "../../support/markup.js";

const DESIGN_SIZE = { w: 1080, h: 810 };
const RESTARTING_MARK = "data-restarting";

beforeEach(() => {
  viewport.value = { ...DESIGN_SIZE };
  engineRestarting.value = false;
});

/**
 * Whether the rendered plate carries the restarting mark while the engine's restart state is `restarting`.
 *
 * @param {boolean} restarting
 * @returns {boolean}
 */
function plateMarked(restarting) {
  engineRestarting.value = restarting;
  const plate = elements(render(html`<${Plate} />`)).find((e) => classes(e).includes("plate"));
  if (!plate) throw new Error("Plate rendered no .plate element");
  return hasAttr(plate, RESTARTING_MARK);
}

test("test_the_plate_carries_the_restarting_mark_only_while_the_engine_restarts", () => {
  assert.deepEqual([plateMarked(true), plateMarked(false)], [true, false]);
});
