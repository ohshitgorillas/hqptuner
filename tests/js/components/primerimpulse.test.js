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
// `line.plot-zero` whose y1 equals y2, and the vertical zero rule is the one
// whose x1 equals x2. Larger y is lower on screen.
//
// Tick labels are all `text.plot-lbl`, split by where they sit against the plot
// rectangle, whose left edge is the horizontal zero line's x1 and whose bottom
// edge is the lower end of the vertical zero rule: the time ticks are the ones
// below that bottom edge (and, as before, without the `plot-axis` class), the
// amplitude ticks the rest, drawn in the gutter left of the plot. Trace names
// are `text.plot-tlbl` carrying the `ghost` or the `applied` class.
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
  sourcePulse,
  plotPx,
  showMe,
} = await import("../../../hqptuner/static/store/primergraph.js");
const { filterPulse } = await import("../../../hqptuner/static/lib/dsp/pulse.js");
const { elements, classes, attr, text } = await import("../support/markup.js");

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

test.afterEach(() => {
  plotPx.value = 0;
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
 * The x of the vertical zero rule, and its y span.
 *
 * @param {MarkupElement} box
 * @returns {{ x: number, y1: number, y2: number }}
 */
function zeroRule(box) {
  const upright = inside(box, "line", ["plot-zero"]).find((el) => attr(el, "x1") === attr(el, "x2"));
  if (!upright) throw new Error("the impulse pane lacks a vertical zero rule");
  return { x: num(upright, "x1"), y1: num(upright, "y1"), y2: num(upright, "y2") };
}

/**
 * The width of the plot in milliseconds, read off the time tick labels.
 *
 * @param {MarkupElement} box
 * @returns {number}
 */
function spanMs(box) {
  const zero = zeroLine(box);
  return msPerUnit(box) * (zero.x2 - zero.x1);
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
 * The plot rectangle's left edge and its bottom edge: the horizontal zero line
 * spans the plot's width, the vertical zero rule spans its height.
 *
 * @param {MarkupElement} box
 * @returns {{ left: number, bottom: number }}
 */
function plotEdges(box) {
  const rule = zeroRule(box);
  return { left: zeroLine(box).x1, bottom: Math.max(rule.y1, rule.y2) };
}

/**
 * The pane's amplitude tick labels: the `text.plot-lbl` elements that are not
 * the time ticks, which are the ones below the plot rectangle's bottom edge.
 *
 * @param {MarkupElement} box
 * @returns {MarkupElement[]}
 */
const amplitudeTicks = (box) => inside(box, "text", ["plot-lbl"]).filter((el) => num(el, "y") <= plotEdges(box).bottom);

/**
 * Milliseconds per viewBox unit, from the two outermost time tick labels. Time
 * ticks are the `text.plot-lbl` elements drawn below the plot rectangle's
 * bottom edge; the amplitude ticks, drawn left of the plot, are not among them.
 *
 * @param {MarkupElement} box
 * @returns {number}
 */
function msPerUnit(box) {
  const bottom = plotEdges(box).bottom;
  const ticks = inside(box, "text", ["plot-lbl"])
    .filter((el) => !classes(el).includes("plot-axis") && num(el, "y") > bottom)
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

// 2. The time axis spans exactly the filter's length: a 12 ms filter draws a
// 12 ms axis. A span rounded up to a round figure (1, 2, 5 or 10 times a power
// of ten) would draw this filter on a 20 ms axis, and the frame would jump as
// the Length slider crossed each round figure.

test("test_axis_span_equals_the_filter_length_at_linear_phase", () => {
  rate.value = 44100;
  outputRate.value = 176400;
  phase.value = "linear";
  lengthMs.value = 12;
  rolloff.value = 0.5;
  transientUs.value = 3;
  const span = spanMs(impulsePane());
  assert.ok(Math.abs(span - lengthMs.value) < 0.1, `axis spans ${span} ms, wanted ${lengthMs.value}`);
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
  const gain = peakAbs(filterPulse(design.value.h, pulse.value).y) / peakAbs(sourcePulse.value);
  const R = inputPeak * gain;
  const ceiling = Math.min(1.02 * R, zero.y - 0.1 * viewBoxHeight(box));
  assert.ok(
    outputPeak >= 0.98 * R && outputPeak <= ceiling,
    `output peak height ${outputPeak}, wanted between ${0.98 * R} and ${ceiling}`,
  );
});

// 5. Minimum phase gets an asymmetric frame: the filter's whole reach runs to
// the right of time zero, and to its left the plot reserves exactly the input's
// own half extent, half of the source pulse's length in samples. At a 3 us
// transient that is one source sample, 0.0227 ms. A fixed tenth of the span
// would begin the plot 0.5 ms before zero, an empty strip whose width follows
// the filter length rather than the input's width.

test("test_minimum_phase_plot_begins_the_inputs_own_half_extent_before_time_zero", () => {
  rate.value = 44100;
  outputRate.value = 176400;
  phase.value = "minimum";
  lengthMs.value = 3.7;
  rolloff.value = 0.5;
  transientUs.value = 3;
  const box = impulsePane();
  const leadMs = msPerUnit(box) * (zeroRule(box).x - zeroLine(box).x1);
  const halfMs = (1000 * ((sourcePulse.value.length - 1) / 2)) / rate.value;
  assert.ok(Math.abs(leadMs - halfMs) < 0.005, `plot begins ${leadMs} ms before zero, wanted ${halfMs}`);
});

// 6. The input trace carries one vertex per source sample, so the ghost is the
// source pulse itself: at a 30 us transient that is 21 vertices. One vertex per
// rendered plot column would draw 355 of them here, and would move the input's
// drawn peak height whenever the phase toggle moved.

test("test_input_trace_carries_one_vertex_per_source_sample", () => {
  rate.value = 44100;
  outputRate.value = 176400;
  phase.value = "linear";
  lengthMs.value = 8;
  rolloff.value = 0.5;
  transientUs.value = 30;
  const drawn = vertices(impulsePane(), ["ghost"]).length;
  assert.equal(drawn, sourcePulse.value.length);
});

// 7. The output trace is reduced to the plot width the pane reports, so the
// picture resolves to the window it is drawn in. At 8 ms and 4x the frame holds
// 1411 output samples: the trace carries 830 vertices while nothing has been
// measured, 726 at a reported width of 250, and 1411 at 1000, where a vertex per
// sample is all there is left to draw. A column count taken from the SVG's own
// coordinate system draws 830 at all three, which is the same point list at a
// 640 px window as at a 1280 px one.

test("test_output_trace_vertex_count_follows_the_reported_plot_width", () => {
  rate.value = 44100;
  outputRate.value = 176400;
  phase.value = "linear";
  lengthMs.value = 8;
  rolloff.value = 0.5;
  transientUs.value = 3;
  const drawn = (/** @type {number} */ px) => {
    plotPx.value = px;
    return vertices(impulsePane(), ["applied"]).length;
  };
  assert.deepEqual([drawn(0), drawn(250), drawn(1000)], [830, 726, 1411]);
});

/**
 * The spec's filtered state: 44.1 kHz source, 4x output, a 3.7 ms linear-phase
 * filter at roll-off 0.62 on a 17 us transient.
 *
 * @returns {void}
 */
function filteredState() {
  rate.value = 44100;
  outputRate.value = 176400;
  phase.value = "linear";
  lengthMs.value = 3.7;
  rolloff.value = 0.62;
  transientUs.value = 17;
}

// 8. The amplitude axis reads unit input, not the plot rectangle: the tick
// labelled 1 is drawn at the height the input's own unit peak reaches. An axis
// spread across the whole plot rectangle puts 1 on the top edge, a tenth of the
// frame above the peak it is supposed to measure, and a unit input then reads
// as never reaching full scale.

test("test_the_amplitude_tick_labelled_one_sits_at_the_input_peaks_height", () => {
  filteredState();
  const box = impulsePane();
  const zero = zeroLine(box);
  const one = amplitudeTicks(box).find((el) => Number(text(el)) === 1);
  if (!one) throw new Error("the impulse pane has no amplitude tick label reading 1");
  const peakY = zero.y - peakVertex(vertices(box, ["ghost"]), zero.y).height;
  const slack = 0.03 * viewBoxHeight(box);
  assert.ok(
    Math.abs(num(one, "y") - peakY) <= slack,
    `the tick labelled 1 sits at y ${num(one, "y")}, the input peak at y ${peakY}, slack ${slack}`,
  );
});

// 9. Trace names are drawn per trace actually drawn: with a filter there are two
// traces and two names, one ghost and one applied; with no oversampling the
// output IS the input's own array, one trace is drawn and one name goes with it.
// Naming both unconditionally stacks two names on the same pixels there and
// claims two traces where the pane draws one.

test("test_trace_names_are_two_with_a_filter_and_one_without_oversampling", () => {
  filteredState();
  const withFilter = inside(impulsePane(), "text", ["plot-tlbl"]);
  outputRate.value = 44100;
  const flat = inside(impulsePane(), "text", ["plot-tlbl"]).length;
  assert.deepEqual(
    [
      withFilter.filter((el) => classes(el).includes("ghost")).length,
      withFilter.filter((el) => classes(el).includes("applied")).length,
      flat,
    ],
    [1, 1, 1],
  );
});

// 10. The amplitude labels fit in the gutter they are drawn in: every one of
// them is left of the plot rectangle and still on the pane, at an x of zero or
// more. Adding the axis over the pane's present 10-unit left gutter renders the
// widest labels at negative x, clipped off the pane's left edge.

test("test_every_amplitude_tick_label_is_drawn_left_of_the_plot_and_inside_the_pane", () => {
  filteredState();
  const box = impulsePane();
  const left = plotEdges(box).left;
  const xs = amplitudeTicks(box).map((el) => num(el, "x"));
  if (xs.length === 0) throw new Error("the impulse pane has no amplitude tick labels");
  assert.ok(
    xs.every((x) => x >= 0 && x < left),
    `amplitude ticks at x ${xs.join(", ")}, wanted every one between 0 and the plot's left edge ${left}`,
  );
});
