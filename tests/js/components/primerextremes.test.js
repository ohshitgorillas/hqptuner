// Behavioral suite for the filter primer graph (components/primer/Graph.js) at
// the extremes of its inputs, written blind from a spec block: no graph source
// was read. The component is driven through the exported signals of
// store/primergraph.js and rendered to a string; every reading below is a number
// pulled out of SVG geometry or out of the store's own computed grid and tap
// list, never a word.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. Rule 9: the elements are found by their classes and their
// `data-pane` markings, both wire identifiers; the only text read is the numeric
// value of an amplitude tick label.
//
// GEOMETRY READ. Inside the pane carrying `data-pane="frequency"` (viewBox
// 0 0 800 240): the filter magnitude is `polyline.plot-trace.applied`, the
// result fill `path.primer-leak` with its top edge `polyline.primer-leak-edge`,
// the dB tick lines `line.plot-grid` at 0, -30, -60, -90 and -120 dB (topmost
// is 0 dB, lowest -120, linear between). The plot's left edge is x=30, its
// width 734 viewBox units, and the x axis runs 0 to 88200 Hz at 44.1 kHz into
// 176.4 kHz.
//
// Inside the pane carrying `data-pane="impulse"` (viewBox 0 0 400 240): the
// output band is `path.primer-band`; the amplitude tick labels are the `text`
// elements in the gutter left of the plot, reading 1, 0.5, 0, -0.5, -1, and the
// horizontal `line.plot-zero` is level 0. Larger y is lower on screen.
//
// A path's vertices are the x,y pairs after its M and L commands; Z is ignored.
//
// Every test sets every signal it depends on (signals persist for the life of
// the file) and leaves the store as it found it: `freqPx` and `plotPx` back to
// 0 and `showMe("intro")` after each.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/primerextremes.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

const { html } = await import("../../../hqptuner/static/lib/dom.js");
const { PrimerGraph } = await import("../../../hqptuner/static/components/primer/Graph.js");
const { rate, outputRate, phase, lengthMs, rolloff, transientUs, spectrum, design, freqPx, plotPx, showMe } =
  await import("../../../hqptuner/static/store/primergraph.js");
const { elements, classes, attr, text } = await import("../support/markup.js");

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

test.afterEach(() => {
  freqPx.value = 0;
  plotPx.value = 0;
  showMe("intro");
});

// --- reading the render ---------------------------------------------------------

/** @returns {string} */
const draw = () => render(html`<${PrimerGraph} />`);

/**
 * The outermost element carrying `data-pane="<name>"`.
 *
 * @param {string} name
 * @returns {MarkupElement}
 */
function pane(name) {
  const hits = elements(draw()).filter((el) => attr(el, "data-pane") === name);
  if (hits.length === 0) throw new Error(`no pane "${name}" in the render`);
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
 * The one element inside a pane matching tag and classes.
 *
 * @param {MarkupElement} box
 * @param {string} tag
 * @param {string[]} want
 * @returns {MarkupElement}
 */
function only(box, tag, want) {
  const hits = inside(box, tag, want);
  if (hits.length !== 1) throw new Error(`${hits.length} <${tag}> carrying ${want.join(".")} in the pane, wanted one`);
  return hits[0];
}

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
 * The vertices of a path's `d`: the x,y pairs after its M and L commands, with
 * Z ignored. Any other command is a shape this suite does not read.
 *
 * @param {string} d
 * @returns {[number, number][]}
 */
function pathVertices(d) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  /** @type {number[]} */
  const nums = [];
  for (const t of tokens) {
    if (t === "M" || t === "L") continue;
    if (t === "Z" || t === "z") continue;
    if (/[a-zA-Z]/.test(t)) throw new Error(`path command ${t} is not one of M, L, Z: ${d}`);
    nums.push(Number(t));
  }
  if (nums.length % 2 !== 0) throw new Error(`path carries an odd number of coordinates: ${d}`);
  /** @type {[number, number][]} */
  const out = [];
  for (let i = 0; i < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/**
 * The vertices of an element's points list.
 *
 * @param {MarkupElement} el
 * @returns {[number, number][]}
 */
const pointsOf = (el) => pairs(attr(el, "points") || "");

/**
 * The frequency pane's dB reading of a y, off its tick lines: the topmost
 * `line.plot-grid` is 0 dB, the lowest -120 dB, linear between.
 *
 * @param {MarkupElement} box
 * @returns {(y: number) => number}
 */
function dbReader(box) {
  const ys = inside(box, "line", ["plot-grid"]).map((el) => num(el, "y1"));
  if (ys.length < 2) throw new Error("the frequency pane lacks dB tick lines");
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return (y) => (-120 * (y - top)) / (bottom - top);
}

/** The x axis of the frequency pane at 44.1 kHz into 176.4 kHz, in Hz. */
const AXIS_HZ = 88200;
const PLOT_LEFT = 30;
const PLOT_WIDTH = 734;

/**
 * The frequency a frequency-pane x stands for.
 *
 * @param {number} x
 * @returns {number}
 */
const hzOf = (x) => ((x - PLOT_LEFT) / PLOT_WIDTH) * AXIS_HZ;

/**
 * The impulse pane's level reading of a y, off its amplitude axis: the
 * horizontal zero line is level 0 and the tick labelled 1 is level 1.
 *
 * @param {MarkupElement} box
 * @returns {(y: number) => number}
 */
function levelReader(box) {
  const flat = inside(box, "line", ["plot-zero"]).find((el) => attr(el, "y1") === attr(el, "y2"));
  if (!flat) throw new Error("the impulse pane lacks a horizontal zero line");
  const zeroY = num(flat, "y1");
  const left = num(flat, "x1");
  const one = inside(box, "text", []).find((el) => num(el, "x") < left && Number(text(el)) === 1);
  if (!one) throw new Error("the impulse pane has no amplitude tick label reading 1");
  const oneY = num(one, "y");
  return (y) => (zeroY - y) / (zeroY - oneY);
}

/**
 * The spec's state: 44.1 kHz into 176.4 kHz, linear phase, roll-off 0.5 on a
 * 3 us transient, at the given length.
 *
 * @param {number} ms
 * @returns {void}
 */
function state(ms) {
  rate.value = 44100;
  outputRate.value = 176400;
  phase.value = "linear";
  rolloff.value = 0.5;
  transientUs.value = 3;
  lengthMs.value = ms;
}

// --- the cases ------------------------------------------------------------------

// 1. The result fill and its edge are one vertex list: at 2 ms on a 1040 px
// plot the `polyline.primer-leak-edge` runs exactly the `path.primer-leak`'s
// vertices with the path's two feet on the floor (its first and last vertex)
// removed. An edge reduced separately from the fill, or drawn from a different
// grid, parts from the fill's top and shows a seam between the two.

test("test_result_edge_runs_the_result_fills_vertices_between_its_two_feet", () => {
  state(2);
  freqPx.value = 1040;
  const box = pane("frequency");
  const fill = pathVertices(attr(only(box, "path", ["primer-leak"]), "d") || "");
  const edge = pointsOf(only(box, "polyline", ["primer-leak-edge"]));
  if (fill.length < 3) throw new Error(`the result fill carries ${fill.length} vertices, wanted three or more`);
  assert.deepEqual(edge, fill.slice(1, -1));
});

// 2. Reduction keeps the peaks: on a 250 px plot every filter trace vertex
// between 25 and 40 kHz sits within 2 dB of the largest grid magnitude within
// 250 Hz of it. Sampling one grid point per column instead of keeping the
// column's peak drops the stop-band lobes' tops and draws the filter tens of dB
// better than it is.

test("test_reduced_filter_trace_keeps_the_stopband_peaks_of_its_grid", () => {
  state(2);
  freqPx.value = 250;
  const box = pane("frequency");
  const db = dbReader(box);
  const { freqsHz, filterDb } = spectrum.value;
  const seen = pointsOf(only(box, "polyline", ["plot-trace", "applied"]))
    .map(([x, y]) => ({ hz: hzOf(x), db: db(y) }))
    .filter((v) => v.hz >= 25000 && v.hz <= 40000);
  if (seen.length === 0) throw new Error("the filter trace has no vertex between 25 and 40 kHz");
  const gaps = seen.map((v) => {
    let peak = -Infinity;
    for (let i = 0; i < freqsHz.length; i += 1) {
      if (Math.abs(freqsHz[i] - v.hz) <= 250 && filterDb[i] > peak) peak = filterDb[i];
    }
    if (peak === -Infinity) throw new Error(`no grid point within 250 Hz of ${v.hz} Hz`);
    return Math.abs(v.db - peak);
  });
  const worst = Math.max(...gaps);
  assert.ok(worst <= 2, `a vertex sits ${worst} dB from the peak of its grid neighbourhood, wanted within 2`);
});

// 3. The output band at 12 ms on a 250 px plot spans levels 0.99 down to
// -0.21 on the amplitude axis: the band's top is the output's peak and its
// bottom the deepest pre-ring. A band drawn from a decimated sample list, or
// one reading the frame's edge as full scale, moves one or both extremes.

test("test_output_band_spans_the_outputs_peak_and_deepest_ring", () => {
  state(12);
  plotPx.value = 250;
  const box = pane("impulse");
  const level = levelReader(box);
  const levels = pathVertices(attr(only(box, "path", ["primer-band"]), "d") || "").map(([, y]) => level(y));
  if (levels.length === 0) throw new Error("the output band carries no vertices");
  const hi = Math.max(...levels);
  const lo = Math.min(...levels);
  assert.ok(
    Math.abs(hi - 0.99) <= 0.02 && Math.abs(lo + 0.21) <= 0.02,
    `the band spans levels [${hi}, ${lo}], wanted [0.99, -0.21] each within 0.02`,
  );
});

// 4. The store's filter magnitude at 50 ms is the filter's own transform: at
// every grid point between 22.15 and 25 kHz where the direct sum over the taps
// is above -170 dB, `spectrum.value.filterDb` agrees with it within 0.1 dB. A
// magnitude computed from a truncated or a zero-padded-then-interpolated tap
// list smears the first stop-band lobes there by whole dB.

test("test_filter_magnitude_matches_the_direct_transform_of_its_taps", () => {
  state(50);
  freqPx.value = 0;
  const { freqsHz, filterDb } = spectrum.value;
  const { h, designRate } = design.value;
  let worst = 0;
  let checked = 0;
  for (let i = 0; i < freqsHz.length; i += 1) {
    const f = freqsHz[i];
    if (f < 22150 || f > 25000) continue;
    let re = 0;
    let im = 0;
    const w = (-2 * Math.PI * f) / designRate;
    for (let n = 0; n < h.length; n += 1) {
      re += h[n] * Math.cos(w * n);
      im += h[n] * Math.sin(w * n);
    }
    const direct = 20 * Math.log10(Math.hypot(re, im));
    if (direct <= -170) continue;
    checked += 1;
    worst = Math.max(worst, Math.abs(filterDb[i] - direct));
  }
  if (checked === 0) throw new Error("no grid point between 22.15 and 25 kHz sits above -170 dB");
  assert.ok(
    worst <= 0.1,
    `filterDb sits ${worst} dB from the direct transform over ${checked} points, wanted within 0.1`,
  );
});
