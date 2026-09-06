// Behavioral suite for the filter primer's frequency pane (components/primer/Graph.js),
// written blind from a spec block: no graph source was read. The component is
// driven through the exported signals of store/primergraph.js and rendered to a
// string; every reading below is a number pulled out of SVG geometry or out of
// the store's own computed grid, never a word.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. Rule 9: the elements are found by their classes and their
// `data-pane` markings, both wire identifiers.
//
// GEOMETRY READ. Inside the pane carrying `data-pane="frequency"`: the filter
// magnitude is `polyline.plot-trace.applied`, the result fill is
// `path.primer-leak`, the dB tick lines are `line.plot-grid` (the topmost being
// 0 dB). Larger y is lower on screen, so the highest point of a trace is its
// smallest y.
//
// The pane reports the width of its plot rectangle in CSS pixels through the
// store's `freqPx` signal, 0 until the page has measured it; the tests below
// drive it directly.
//
// Every test sets every signal it depends on (signals persist for the life of
// the file) and leaves the store as it found it: `freqPx` back to 0 and
// `showMe("intro")` after each.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/primerfrequency.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

const { html } = await import("../../../hqptuner/static/lib/dom.js");
const { PrimerGraph } = await import("../../../hqptuner/static/components/primer/Graph.js");
const { rate, outputRate, phase, lengthMs, rolloff, transientUs, content, spectrum, freqPx, showMe } =
  await import("../../../hqptuner/static/store/primergraph.js");
const { elements, classes, attr } = await import("../support/markup.js");

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

test.afterEach(() => {
  freqPx.value = 0;
  showMe("intro");
});

// --- reading the render ---------------------------------------------------------

/** @returns {string} */
const draw = () => render(html`<${PrimerGraph} />`);

/**
 * The outermost element carrying `data-pane="frequency"`.
 *
 * @returns {MarkupElement}
 */
function frequencyPane() {
  const hits = elements(draw()).filter((el) => attr(el, "data-pane") === "frequency");
  if (hits.length === 0) throw new Error('no pane "frequency" in the render');
  return hits.reduce((a, b) => (a.start <= b.start ? a : b));
}

/**
 * Every element inside a pane whose class list carries all of `want`.
 *
 * @param {MarkupElement} box
 * @param {string} tag
 * @param {string[]} want
 * @returns {MarkupElement[]}
 */
const inside = (box, tag, want) =>
  elements(box.html).filter((el) => el.name === tag && want.every((c) => classes(el).includes(c)));

/**
 * @param {MarkupElement} el
 * @param {string} name
 * @returns {number}
 */
function num(el, name) {
  const v = Number(attr(el, name));
  if (!Number.isFinite(v)) throw new Error(`<${el.name}> carries no numeric ${name}`);
  return v;
}

/**
 * Every "x,y" pair in a points list, as numbers.
 *
 * @param {string} s
 * @returns {[number, number][]}
 */
function pairs(s) {
  const nums = s
    .split(/[\s,]+/)
    .filter((t) => t !== "")
    .map(Number);
  if (nums.some((v) => !Number.isFinite(v)) || nums.length % 2 !== 0) throw new Error(`not a list of x,y pairs: ${s}`);
  /** @type {[number, number][]} */
  const out = [];
  for (let i = 0; i < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/**
 * The vertices of the pane's filter magnitude trace.
 *
 * @returns {[number, number][]}
 */
function filterVertices() {
  const [trace] = inside(frequencyPane(), "polyline", ["plot-trace", "applied"]);
  if (!trace) throw new Error("the frequency pane lacks an applied filter trace");
  const pts = pairs(attr(trace, "points") || "");
  if (pts.length < 2) throw new Error("the applied filter trace has fewer than two vertices");
  return pts;
}

/**
 * The y of the topmost dB tick line in the pane, which is the 0 dB tick.
 *
 * @returns {number}
 */
function zeroDbY() {
  const ticks = inside(frequencyPane(), "line", ["plot-grid"]).map((el) => num(el, "y1"));
  if (ticks.length === 0) throw new Error("the frequency pane lacks dB tick lines");
  return Math.min(...ticks);
}

/**
 * The inputs the spec fixes for every line below unless the line says otherwise.
 *
 * @returns {void}
 */
function baseline() {
  phase.value = "linear";
  rolloff.value = 0.5;
  transientUs.value = 100;
  content.value = { spurs: false, fakeHires: false, risingNoise: false };
  rate.value = 44100;
  outputRate.value = 352800;
  lengthMs.value = 2;
}

// --- the cases ------------------------------------------------------------------

// 2. The trace is reduced to the pixels the page gives it, not handed the grid
// whole: on a 200 px plot the drawn vertex count is under a fifth of the grid
// the pane is drawn on (3201 grid points, 600 vertices). Handing the polyline
// every grid point, or reducing to the SVG's own 734 coordinate units, both
// land above that bound.

test("test_filter_trace_carries_far_fewer_vertices_than_the_grid_it_is_drawn_on", () => {
  baseline();
  freqPx.value = 200;
  const grid = spectrum.value.freqsHz.length;
  const drawn = filterVertices().length;
  assert.ok(drawn < grid / 5, `the trace carries ${drawn} vertices against ${grid} grid points`);
});

// 3. Passband ripple is drawn where it lands, not clamped: a 0.1 ms filter
// ripples above unity, so the trace's highest point sits strictly above the
// 0 dB tick line. Clamping the reading to 0 dB first flattens it onto the tick.

test("test_passband_ripple_draws_above_the_zero_db_tick", () => {
  baseline();
  lengthMs.value = 0.1;
  freqPx.value = 640;
  const top = Math.min(...filterVertices().map(([, y]) => y));
  assert.ok(top < zeroDbY(), `the trace tops out at y ${top}, the 0 dB tick sits at y ${zeroDbY()}`);
});

// 4. The result fill is drawn only where the chain resamples: one
// `path.primer-leak` at 96 kHz into 192 kHz, none at 96 kHz with no
// oversampling, where the result is the source itself and painting it over the
// wash and its images would flatten the two to one opacity.

test("test_result_fill_is_drawn_only_where_the_chain_resamples", () => {
  baseline();
  rate.value = 96000;
  freqPx.value = 640;
  const counts = [192000, null].map((hz) => {
    outputRate.value = hz;
    return inside(frequencyPane(), "path", ["primer-leak"]).length;
  });
  assert.deepEqual(counts, [1, 0]);
});
