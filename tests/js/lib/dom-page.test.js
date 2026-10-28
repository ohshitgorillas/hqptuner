// Behavioral suite for lib/dom.js page access: the helpers reach a page only through an element's `ownerDocument`
// and that document's `defaultView`, or a document they are handed, and keep gesture state per document.
//
// Every page here is a fake page from tests/js/support/page.js, handed in and never installed: under `node --test`
// there is no `window`, `document`, `ResizeObserver`, `getComputedStyle`, `devicePixelRatio` or `OffscreenCanvas`
// global, so a helper that reads one fails. Where a case needs two pages to tell "this element's page" from "some
// page", it builds two with different answers.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/dom-page.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  makeCanvas as makeCanvasOf,
  observeSize,
  pageOf,
  pixelRatio,
  styleOf,
  userEdit,
  watchGestures,
} from "../../../hqptuner/static/lib/dom.js";
import { fakeClock } from "../support/clock.js";
import { fakePage } from "../support/page.js";

/**
 * `makeCanvas`, its canvas typed as the unit makes it: a canvas element, or an OffscreenCanvas, which has no element
 * members, so a case reading `localName` or `ownerDocument` reads undefined off one.
 *
 * @type {(...args: Parameters<typeof makeCanvasOf>) =>
 *   HTMLCanvasElement | (OffscreenCanvas & { localName?: undefined, ownerDocument?: undefined })}
 */
const makeCanvas = makeCanvasOf;

/**
 * A fresh page holding one range slider, its value already moved to 63 by the browser.
 *
 * @param {number} [dpr]
 */
function sliderPage(dpr = 1) {
  const { clock, advance } = fakeClock();
  const page = fakePage({ clock, dpr, html: '<input type="range" id="s">' });
  const el = page.doc.getElementById("s");
  Object.assign(el, { type: "range", value: "63" });
  return { ...page, el, advance };
}

/** @param {any} el */
const press = (el) => el.dispatchEvent({ type: "pointerdown", button: 0, buttons: 1, bubbles: true });
/** @param {any} el */
const release = (el) => el.dispatchEvent({ type: "pointerup", button: 0, buttons: 0, bubbles: true });

/**
 * How many times the edit ran when `el` was edited through userEdit.
 *
 * @param {any} el
 */
function editRuns(el) {
  let runs = 0;
  userEdit(el, "50", () => {
    runs += 1;
  });
  return runs;
}

test("a press on a slider in a second watched document gives its edit provenance", () => {
  const first = sliderPage();
  const second = sliderPage();
  watchGestures(first.doc);
  watchGestures(second.doc);
  press(second.el);
  assert.equal(editRuns(second.el), 1);
});

test("a release on another page does not end the hold on a slider in this page", () => {
  const here = sliderPage();
  const there = sliderPage();
  watchGestures(here.doc);
  watchGestures(there.doc);
  press(here.el);
  release(there.el);
  assert.equal(editRuns(here.el), 1);
});

test("pageOf gives the document the element lives in", () => {
  sliderPage();
  const page = sliderPage();
  assert.equal(pageOf(page.el).doc, page.doc);
});

test("pageOf gives the window of the document the element lives in", () => {
  sliderPage();
  const page = sliderPage();
  assert.equal(pageOf(page.el).win, page.win);
});

test("observeSize hands fn the content box the element is resized to", () => {
  const page = sliderPage();
  /** @type {number[][]} */
  const boxes = [];
  observeSize(page.el, (rect) => boxes.push([rect.width, rect.height]));
  page.resize(page.el, { width: 120, height: 40 });
  assert.deepEqual(boxes.at(-1), [120, 40]);
});

test("observeSize calls fn again on every resize", () => {
  const page = sliderPage();
  /** @type {number[]} */
  const widths = [];
  observeSize(page.el, (rect) => widths.push(rect.width));
  page.resize(page.el, { width: 120, height: 40 });
  page.resize(page.el, { width: 200, height: 40 });
  assert.deepEqual(widths.slice(-2), [120, 200]);
});

test("observeSize stops calling fn once its unobserve function is called", () => {
  const page = sliderPage();
  let calls = 0;
  const unobserve = observeSize(page.el, () => {
    calls += 1;
  });
  page.advance(16);
  page.resize(page.el, { width: 120, height: 40 });
  const before = calls;
  unobserve();
  page.resize(page.el, { width: 200, height: 40 });
  assert.equal(calls, before);
});

test("observeSize on a page with no ResizeObserver calls fn once", () => {
  const page = sliderPage();
  delete page.win.ResizeObserver;
  let calls = 0;
  observeSize(page.el, () => {
    calls += 1;
  });
  page.advance(100);
  assert.equal(calls, 1);
});

test("observeSize on a page with no ResizeObserver returns a function that does nothing", () => {
  const page = sliderPage();
  delete page.win.ResizeObserver;
  const unobserve = observeSize(page.el, () => {});
  assert.doesNotThrow(() => unobserve());
});

test("styleOf answers what the element's own window computes for it", () => {
  sliderPage();
  const page = sliderPage();
  const computed = { getPropertyValue: () => "" };
  page.win.getComputedStyle = (/** @type {unknown} */ el) => (el === page.el ? computed : null);
  assert.equal(styleOf(page.el), computed);
});

test("pixelRatio is the devicePixelRatio of the window the element lives in", () => {
  sliderPage(2);
  const page = sliderPage(3);
  assert.equal(pixelRatio(page.el), 3);
});

test("makeCanvas makes an OffscreenCanvas of the element's window where it has one", () => {
  const page = sliderPage();
  assert.ok(makeCanvas(page.el, 64, 32) instanceof page.win.OffscreenCanvas);
});

test("makeCanvas sizes the OffscreenCanvas w by h", () => {
  const page = sliderPage();
  const canvas = makeCanvas(page.el, 64, 32);
  assert.deepEqual([canvas.width, canvas.height], [64, 32]);
});

test("makeCanvas on a window with no OffscreenCanvas makes a canvas element", () => {
  const page = sliderPage();
  delete page.win.OffscreenCanvas;
  assert.equal(makeCanvas(page.el, 64, 32).localName, "canvas");
});

test("makeCanvas on a window with no OffscreenCanvas makes the canvas in the element's document", () => {
  sliderPage();
  const page = sliderPage();
  delete page.win.OffscreenCanvas;
  assert.equal(makeCanvas(page.el, 64, 32).ownerDocument, page.doc);
});

test("makeCanvas on a window with no OffscreenCanvas sizes the canvas element w by h", () => {
  const page = sliderPage();
  delete page.win.OffscreenCanvas;
  const canvas = makeCanvas(page.el, 64, 32);
  assert.deepEqual([canvas.width, canvas.height], [64, 32]);
});
