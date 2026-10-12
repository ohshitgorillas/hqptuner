// Rendered suite for the frequency span in the Display popover, in the frame the entry composes
// (hqptuner/static/app.js): the panel the Source header's Display trigger opens offers the span of the band the page's
// spectrum shows, Full, a half or a quarter of the band up to the source Nyquist. A pick sets the span, and the panel
// lights the one in force. What a span does to the spectrum and its axis is the store's
// (tests/js/store/faceplate-page/meter-span.test.js, tests/js/store/meter/loop-span.test.js).
//
// The panel is found as the `div` carrying the popover's id in `data-pop`; its span options by their values in `data-v`,
// the store's own identifiers for the span. An option shows lit when it carries the `on` class or reads pressed or
// checked for assistive technology. A pick is fired through the vnode seam (tests/js/support/vnodeseam.js), since server
// rendering fires no events.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/display-span.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import "../../support/domseam.js";
import { useStorage } from "../../support/storage.js";
import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Faceplate } from "../../../../hqptuner/static/app.js";
import {
  body,
  freqSpan,
  openPopover,
  openStage,
  setFreqSpan,
} from "../../../../hqptuner/static/store/faceplate/view.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements } from "../../support/markup.js";

/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */
/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

//: The Display popover's id, which its trigger and its panel both carry as `data-pop`.
const DISPLAY = "display";

// The spans the popover offers, as the store holds them: the whole band, its lower half, its lower quarter.
const FULL = "full";
const HALF = "half";
const QUARTER = "quarter";
const SPANS = [FULL, HALF, QUARTER];

beforeEach(() => {
  useStorage();
  body.value = "chain";
  openStage.value = null;
  setFreqSpan(FULL);
  openPopover.value = DISPLAY;
});

/**
 * Pick the option carrying value `v`, or nothing when no button in the frame carries it.
 *
 * @param {string} v
 */
function pick(v) {
  const { seen } = renderTree(html`<${Faceplate} />`);
  const hit = seen.find((/** @type {VNode} */ n) => n.type === "button" && n.props?.["data-v"] === v);
  const fn = hit?.props.onClick;
  if (typeof fn === "function") fn({ preventDefault() {}, stopPropagation() {} });
}

/**
 * Whether a button shows lit.
 *
 * @param {MarkupElement} b
 */
const lit = (b) =>
  classes(b).includes("on") || attr(b, "aria-pressed") === "true" || attr(b, "aria-checked") === "true";

/** The span options the Display panel shows lit, by value. */
function litSpans() {
  const panel = elements(render(html`<${Faceplate} />`)).find(
    (e) => e.name === "div" && attr(e, "data-pop") === DISPLAY,
  );
  return panel
    ? elements(panel.html)
        .filter((e) => e.name === "button" && SPANS.includes(attr(e, "data-v") ?? "") && lit(e))
        .map((e) => attr(e, "data-v"))
    : [];
}

for (const span of SPANS) {
  // Start from another span, so the pick has something to move.
  const other = span === QUARTER ? HALF : QUARTER;

  test(`test_picking_the_${span}_span_in_the_display_popover_sets_it`, () => {
    setFreqSpan(other);
    pick(span);
    assert.equal(freqSpan.value, span);
  });

  test(`test_the_display_popover_lights_only_the_${span}_span_while_it_is_in_force`, () => {
    setFreqSpan(span);
    assert.deepEqual(litSpans(), [span]);
  });
}
