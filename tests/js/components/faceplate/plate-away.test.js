// Rendered suite for hqptuner/static/components/faceplate/Plate.js: the plate marks itself with `data-away` while
// HQPlayer has no connection to HQPTuner, and carries no such mark while it has one.
//
// Driven by assigning the health reading the poll writes; no store function is stubbed.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/plate-away.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Plate } from "../../../../hqptuner/static/components/faceplate/Plate.js";
import { health } from "../../../../hqptuner/static/store/signals.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/plate.js";
import { elements, classes, hasAttr } from "../../support/markup.js";

const DESIGN_SIZE = { w: 1080, h: 810 };
const AWAY_MARK = "data-away";

beforeEach(() => {
  viewport.value = { ...DESIGN_SIZE };
  health.value = { phase: "Ready", info: {} };
});

/**
 * Whether the rendered plate carries the away mark while health reads `phase`.
 *
 * @param {string} phase
 * @returns {boolean}
 */
function plateMarked(phase) {
  health.value = { phase, info: {} };
  const plate = elements(render(html`<${Plate} />`)).find((e) => classes(e).includes("plate"));
  if (!plate) throw new Error("Plate rendered no .plate element");
  return hasAttr(plate, AWAY_MARK);
}

test("test_the_plate_carries_the_away_mark_while_hqplayer_is_down", () => {
  assert.equal(plateMarked("Down"), true);
});

test("test_the_plate_carries_no_away_mark_once_hqplayer_is_back", () => {
  plateMarked("Down");
  assert.equal(plateMarked("Reachable"), false);
});
