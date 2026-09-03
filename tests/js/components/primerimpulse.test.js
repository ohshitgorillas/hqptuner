// Behavioral suite for the filter primer's impulse pane (components/primer/Graph.js),
// written blind from a spec block: no graph source was read. The component is
// driven through the exported signals of store/primergraph.js and rendered to a
// string; every reading below is a number pulled out of SVG geometry and
// compared against numbers derived from the store's own computed signals and
// lib/dsp/pulse.js, never a word.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. Rule 9: the elements are found by their classes and
// `data-pane` markings (wire identifiers); the only text read is the numeric
// value of a time tick label.
//
// GEOMETRY READ. Inside the pane carrying `data-pane="impulse"`: the input trace
// is `polyline.plot-trace.ghost` (one vertex per source-rate sample), the output
// trace is `polyline.plot-trace.applied`, the horizontal zero line is the
// `line.plot-zero` whose y1 equals y2, and the time tick labels are
// `text.plot-lbl` without the `plot-axis` class. Larger y is lower on screen.
//
// Every test sets every signal it depends on (signals persist for the life of
// the file) and leaves the store as it found it: `showMe("intro")` after each.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/primerimpulse.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

const { html } = await import("../../../hqptuner/static/lib/dom.js");
const { PrimerGraph } = await import("../../../hqptuner/static/components/primer/Graph.js");
const {
  rate,
  outputRate,
  phase,
  lengthMs,
  rolloff,
  transientUs,
  LENGTH_CHIPS,
  TRANSIENT_CHIPS,
  design,
  pulse,
  showMe,
} = await import("../../../hqptuner/static/store/primergraph.js");
const { filterPulse } = await import("../../../hqptuner/static/lib/dsp/pulse.js");
const { elements, classes, attr, text } = await import("../support/markup.js");

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

test.afterEach(() => {
  showMe("intro");
});

// --- reading the render ---------------------------------------------------------

/** @returns {string} */
const draw = () => render(html`<${PrimerGraph} />`);

/**
 * The outermost element carrying `data-pane="impulse"`.
 *
 * @returns {MarkupElement}
 */
function impulsePane() {
  const hits = elements(draw()).filter((el) => attr(el, "data-pane") === "impulse");
  if (hits.length === 0) throw new Error('no pane "impulse" in the render');
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
 * The vertices of the pane's trace carrying all of `want`.
 *
 * @param {MarkupElement} box
 * @param {string[]} want
 * @returns {[number, number][]}
 */
function vertices(box, want) {
  const [trace] = inside(box, "polyline", ["plot-trace", ...want]);
  if (!trace) throw new Error(`the impulse pane lacks a ${want.join(".")} trace`);
  const pts = pairs(attr(trace, "points") || "");
  if (pts.length < 2) throw new Error(`the ${want.join(".")} trace has fewer than two vertices`);
  return pts;
}

/**
 * The y of the horizontal zero line, and its x span.
 *
 * @param {MarkupElement} box
 * @returns {{ y: number, x1: number, x2: number }}
 */
function zeroLine(box) {
  const flat = inside(box, "line", ["plot-zero"]).find((el) => attr(el, "y1") === attr(el, "y2"));
  if (!flat) throw new Error("the impulse pane lacks a horizontal zero line");
  return { y: num(flat, "y1"), x1: num(flat, "x1"), x2: num(flat, "x2") };
}

/**
 * The vertex whose height above the zero line has the largest magnitude.
 *
 * @param {[number, number][]} pts
 * @param {number} zeroY
 * @returns {{ x: number, height: number }}
 */
function peakVertex(pts, zeroY) {
  return pts
    .map(([x, y]) => ({ x, height: zeroY - y }))
    .reduce((a, b) => (Math.abs(a.height) >= Math.abs(b.height) ? a : b));
}

/**
 * The index of the largest-magnitude sample.
 *
 * @param {ArrayLike<number>} a
 * @returns {number}
 */
function argmaxAbs(a) {
  let at = 0;
  for (let i = 1; i < a.length; i += 1) if (Math.abs(a[i]) > Math.abs(a[at])) at = i;
  return at;
}

/**
 * The largest magnitude in a sample list.
 *
 * @param {ArrayLike<number>} a
 * @returns {number}
 */
const peakAbs = (a) => Math.abs(a[argmaxAbs(a)]);

/**
 * Milliseconds per viewBox unit, from the two outermost time tick labels.
 *
 * @param {MarkupElement} box
 * @returns {number}
 */
function msPerUnit(box) {
  const ticks = inside(box, "text", ["plot-lbl"])
    .filter((el) => !classes(el).includes("plot-axis"))
    .map((el) => ({ x: num(el, "x"), ms: Number(text(el)) }))
    .filter((t) => Number.isFinite(t.ms));
  if (ticks.length < 2) throw new Error("the impulse pane has fewer than two numeric time tick labels");
  const lo = ticks.reduce((a, b) => (a.x <= b.x ? a : b));
  const hi = ticks.reduce((a, b) => (a.x >= b.x ? a : b));
  if (hi.x === lo.x) throw new Error("the outermost time tick labels share an x");
  return (hi.ms - lo.ms) / (hi.x - lo.x);
}

/**
 * The viewBox height of the pane's svg.
 *
 * @param {MarkupElement} box
 * @returns {number}
 */
function viewBoxHeight(box) {
  const [svg] = inside(box, "svg", []);
  if (!svg) throw new Error("the impulse pane lacks an svg");
  const parts = (attr(svg, "viewBox") || "").split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) throw new Error("the svg carries no viewBox");
  return parts[3];
}

// --- the cases ------------------------------------------------------------------

// 1. Minimum phase is causal: the output's peak lands to the right of the
// input's peak by the filter's peak-tap index, in design-rate samples. A
// centroid alignment would draw the response starting before the input.

test("test_minimum_phase_output_peak_trails_input_peak_by_the_peak_tap_delay", () => {
  rate.value = 44100;
  outputRate.value = 176400;
  phase.value = "minimum";
  lengthMs.value = LENGTH_CHIPS.medium;
  rolloff.value = 0.5;
  transientUs.value = TRANSIENT_CHIPS.click;
  const box = impulsePane();
  const zero = zeroLine(box);
  const input = vertices(box, ["ghost"]);
  const output = vertices(box, ["applied"]);
  const sourceSample = input[1][0] - input[0][0];
  const designSample = sourceSample / (outputRate.value / rate.value);
  const shift = peakVertex(output, zero.y).x - peakVertex(input, zero.y).x;
  const expected = argmaxAbs(design.value.h) * designSample;
  assert.ok(
    Math.abs(shift - expected) <= designSample,
    `output peak shifted ${shift} units, expected ${expected} within ${designSample}`,
  );
});

// 2. The time axis is sized from the response, not the tap count: at the Long
// chip the plot spans at most twice the extent of the output's samples above
// 1 percent of its peak.

test("test_long_filter_time_axis_spans_at_most_twice_the_visible_response", () => {
  rate.value = 44100;
  outputRate.value = 176400;
  phase.value = "linear";
  lengthMs.value = LENGTH_CHIPS.long;
  rolloff.value = 0.5;
  transientUs.value = TRANSIENT_CHIPS.click;
  const box = impulsePane();
  const zero = zeroLine(box);
  const plotMs = msPerUnit(box) * (zero.x2 - zero.x1);
  const { y } = filterPulse(design.value.h, pulse.value);
  const floor = 0.01 * peakAbs(y);
  const loud = [...y].map((v, i) => (Math.abs(v) > floor ? i : -1)).filter((i) => i >= 0);
  const extentMs = ((loud[loud.length - 1] - loud[0]) / design.value.designRate) * 1000;
  assert.ok(plotMs <= 2 * extentMs, `plot spans ${plotMs} ms against a ${extentMs} ms response`);
});

// 3. Amplitude is drawn to scale with headroom: the output's peak height is the
// input's peak height times the filter's gain on the pulse, and never reaches
// the top tenth of the viewBox where the title sits.

test("test_output_peak_height_scales_with_filter_gain_and_stays_below_the_title_band", () => {
  rate.value = 44100;
  outputRate.value = 88200;
  phase.value = "linear";
  lengthMs.value = 0.1;
  rolloff.value = 0;
  transientUs.value = 50;
  const box = impulsePane();
  const zero = zeroLine(box);
  const inputPeak = peakVertex(vertices(box, ["ghost"]), zero.y).height;
  const outputPeak = peakVertex(vertices(box, ["applied"]), zero.y).height;
  const gain = peakAbs(filterPulse(design.value.h, pulse.value).y) / peakAbs(pulse.value);
  const R = inputPeak * gain;
  const ceiling = Math.min(1.02 * R, zero.y - 0.1 * viewBoxHeight(box));
  assert.ok(
    outputPeak >= 0.98 * R && outputPeak <= ceiling,
    `output peak height ${outputPeak}, wanted between ${0.98 * R} and ${ceiling}`,
  );
});
