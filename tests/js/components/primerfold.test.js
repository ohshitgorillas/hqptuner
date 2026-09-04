// The filter primer's fold: what the frequency pane draws where a stream is
// resampled and its copies land back inside the band. Written blind from a
// spec block in a tree holding no implementation, so the red run here is the
// bite proof (docs/testing.md rule 8).
//
// Policy (docs/testing.md): behavior only, public API only, one assertion per
// test, nothing of HQPTuner's stubbed. The alias reading is taken from the
// exported `aliasSpectrumDb` on a grid the test built itself; the drawn layers
// are read out of SVG geometry after rendering `PrimerGraph` to a string,
// driven through the exported signals of store/primergraph.js. Rule 9: every
// element is found by class or `data-*` marking, both wire identifiers, and
// every expected value is a number.
//
// GEOMETRY READ. Inside the pane carrying `data-pane="frequency"`: the source
// wash is `path.primer-wash`, the images layer `path.primer-images` (a fill
// with floor feet when upsampling, an open curve with none when decimating),
// the output fill `path.primer-leak` with its stroked top edge
// `polyline.primer-leak-edge`, the dB grid lines `line.plot-grid` (evenly
// spaced at 30 dB steps), the Nyquist marks `line.primer-nyquist` told apart
// by `data-mark`. A path's `d` is an absolute `M x,y L x,y ...` list; a
// polyline's `points` is the same list bare. A foot is an endpoint that shares
// its x with its neighbour, a vertical drop to the floor. Larger y is lower
// dB, so a difference in y converts to dB through the spacing of two adjacent
// grid lines. The x of a frequency runs linearly from the plot's left edge
// (0 Hz) to its right edge (the faster stream's Nyquist).
//
// Every test sets every signal it depends on (signals persist for the life of
// the file) and leaves the store as it found it: `freqPx` back to 0 and
// `showMe("intro")` after each.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/primerfold.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

const { html } = await import("../../../hqptuner/static/lib/dom.js");
const { PrimerGraph } = await import("../../../hqptuner/static/components/primer/Graph.js");
const { aliasSpectrumDb } = await import("../../../hqptuner/static/lib/dsp/spectrum.js");
const { rate, outputRate, phase, lengthMs, rolloff, transientUs, content, freqPx, showMe } =
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
 * Every element inside the outermost element carrying `data-pane="frequency"`.
 *
 * @returns {MarkupElement[]}
 */
function frequencyPane() {
  const hits = elements(draw()).filter((el) => attr(el, "data-pane") === "frequency");
  if (hits.length === 0) throw new Error('no pane "frequency" in the render');
  return elements(hits.reduce((a, b) => (a.start <= b.start ? a : b)).html);
}

/**
 * The elements of a pane with a tag and a class token.
 *
 * @param {MarkupElement[]} pane
 * @param {string} tag
 * @param {string} klass
 * @returns {MarkupElement[]}
 */
const inside = (pane, tag, klass) => pane.filter((el) => el.name === tag && classes(el).includes(klass));

/**
 * The vertices of a coordinate list: a path's `d` (absolute moves and lines)
 * or a polyline's `points`.
 *
 * @param {string} list
 * @returns {[number, number][]}
 */
function vertices(list) {
  const pts = list
    .replace(/[MLZ]/g, " ")
    .split(/\s+/)
    .filter((t) => t !== "")
    .map((pair) => pair.split(",").map(Number));
  if (pts.length === 0 || pts.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)))) {
    throw new Error(`not a list of x,y pairs: ${list}`);
  }
  return pts.map(([x, y]) => [x, y]);
}

/**
 * The one element of a tag and class in the frequency pane, with the vertices
 * of its coordinate list.
 *
 * @param {MarkupElement[]} pane
 * @param {string} tag
 * @param {string} klass
 * @returns {[number, number][]}
 */
function layer(pane, tag, klass) {
  const [el] = inside(pane, tag, klass);
  if (!el) throw new Error(`the frequency pane lacks a ${tag}.${klass}`);
  return vertices(attr(el, tag === "path" ? "d" : "points") || "");
}

/**
 * Screen units per dB, from two adjacent dB grid lines 30 dB apart.
 *
 * @param {MarkupElement[]} pane
 * @returns {number}
 */
function unitsPerDb(pane) {
  const ys = [...new Set(inside(pane, "line", "plot-grid").map((el) => Number(attr(el, "y1"))))].sort((a, b) => a - b);
  if (ys.length < 2 || ys.some((v) => !Number.isFinite(v)))
    throw new Error("the frequency pane lacks two dB grid lines");
  return (ys[1] - ys[0]) / 30;
}

/**
 * The x a frequency lands on: linear from the left plot edge (0 Hz) to the
 * right plot edge, which is the faster stream's Nyquist. The two edges are the
 * extreme x of the source wash, whose feet stand at 0 Hz and the axis top.
 *
 * @param {MarkupElement[]} pane
 * @param {number} axisTopHz
 * @param {number} hz
 * @returns {number}
 */
function xOf(pane, axisTopHz, hz) {
  const xs = layer(pane, "path", "primer-wash").map(([x]) => x);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  return left + ((right - left) * hz) / axisTopHz;
}

/**
 * A list's vertices with its floor feet left out: an endpoint sharing its x
 * with the vertex beside it is a vertical drop to the floor, not part of the
 * curve. An open curve keeps both of its ends.
 *
 * @param {[number, number][]} pts
 * @returns {[number, number][]}
 */
function curveOf(pts) {
  const first = pts.length > 1 && pts[0][0] === pts[1][0] ? 1 : 0;
  const last = pts.length > 1 && pts[pts.length - 1][0] === pts[pts.length - 2][0] ? pts.length - 1 : pts.length;
  return pts.slice(first, last);
}

/**
 * A layer's top edge at a frequency, as y: the curve vertex nearest that x.
 * NaN when no vertex comes within four units of the x, so a layer that skips
 * the frequency fails the assertion rather than reading a far-off vertex.
 *
 * @param {MarkupElement[]} pane
 * @param {string} klass
 * @param {number} axisTopHz
 * @param {number} hz
 * @returns {number}
 */
function edgeY(pane, klass, axisTopHz, hz) {
  const x = xOf(pane, axisTopHz, hz);
  const body = curveOf(layer(pane, "path", klass));
  if (body.length === 0) return NaN;
  const nearest = body.reduce((a, b) => (Math.abs(a[0] - x) <= Math.abs(b[0] - x) ? a : b));
  return Math.abs(nearest[0] - x) <= 4 ? nearest[1] : NaN;
}

/**
 * The x of the Nyquist mark carrying `data-mark="<name>"`, to a tenth of a
 * viewBox unit.
 *
 * @param {string} name
 * @returns {number}
 */
function markX(name) {
  const [mark] = inside(frequencyPane(), "line", "primer-nyquist").filter((el) => attr(el, "data-mark") === name);
  if (!mark) throw new Error(`the frequency pane lacks a Nyquist mark "${name}"`);
  const x = Number(attr(mark, "x1"));
  if (!Number.isFinite(x)) throw new Error(`the "${name}" mark carries no numeric x1`);
  return Math.round(x * 10) / 10;
}

/** The inputs every case fixes unless it names them. */
function baseline() {
  phase.value = "linear";
  rolloff.value = 0.5;
  transientUs.value = 100;
  content.value = { spurs: false, fakeHires: false, risingNoise: false };
  lengthMs.value = 2;
  freqPx.value = 640;
}

// --- the cases ------------------------------------------------------------------

// 1. The alias reading at a frequency is what lands there from elsewhere, the
// frequency's own content left out. On a 192 kHz stream flat at -120 dB taken
// to 96 kHz, a -20 dB tone at 60 kHz reflects at the 48 kHz output Nyquist
// onto 36 kHz, so the alias at 36 kHz reads near -20; the same tone placed at
// 36 kHz itself is that frequency's own content and the alias there stays at
// the floor. A reading that is the fold itself counts the tone in both
// placements, reads -20 twice, and closes the gap to 0.

test("test_alias_reading_leaves_out_the_frequency_own_content", () => {
  const step = 100;
  const freqsHz = Array.from({ length: 961 }, (_, i) => i * step);
  /** @param {number} toneHz */
  const aliasAt36k = (toneHz) => {
    const levels = new Float64Array(freqsHz.length).fill(-120);
    levels[toneHz / step] = -20;
    return aliasSpectrumDb(levels, freqsHz, 192000, 96000)[36000 / step];
  };
  const gap = aliasAt36k(60000) - aliasAt36k(36000);
  assert.ok(
    gap >= 90,
    `the alias at 36 kHz reads ${aliasAt36k(60000)} with the tone at 60 kHz, ${aliasAt36k(36000)} at 36 kHz`,
  );
});

// 2. The images layer is the source mirrored at the output Nyquist, so at
// 192 kHz into 96 kHz the source's level at 83 kHz lands at 96 - 83 = 13 kHz:
// the images curve at 13 kHz sits within 0.5 dB of the wash's top edge at
// 83 kHz. Images drawn only above the source's own 96 kHz Nyquist have no
// vertex at 13 kHz and read NaN; an unmirrored copy of the wash sits 8 dB off
// there.

test("test_images_fill_at_13k_matches_the_source_wash_at_its_83k_mirror", () => {
  baseline();
  rate.value = 192000;
  outputRate.value = 96000;
  const pane = frequencyPane();
  const offDb =
    (edgeY(pane, "primer-images", 96000, 13000) - edgeY(pane, "primer-wash", 96000, 83000)) / unitsPerDb(pane);
  assert.ok(Math.abs(offDb) <= 0.5, `the images fill at 13 kHz sits ${offDb} dB off the wash at 83 kHz`);
});

// 3. Upsampling, the output fill's stroked edge begins at the source Nyquist
// and begins on the curve: at 44.1 kHz into 176.4 kHz its leftmost vertex is
// at x 213.5, the source Nyquist mark, and every vertex it carries at that x
// lies within 3 dB of the others. An edge carrying the floor foot at the mark
// and rising from it as a vertical accent has two vertices at 213.5 some 64 dB
// apart; an edge begun a step right of the mark, or drawn from 0 Hz along the
// floor, has a leftmost x other than 213.5.

test("test_output_edge_begins_on_the_curve_at_the_source_nyquist_when_upsampling", () => {
  baseline();
  rate.value = 44100;
  outputRate.value = 176400;
  const pane = frequencyPane();
  const pts = layer(pane, "polyline", "primer-leak-edge");
  const leftmost = Math.min(...pts.map(([x]) => x));
  const ys = pts.filter(([x]) => x === leftmost).map(([, y]) => y);
  const spreadDb = (Math.max(...ys) - Math.min(...ys)) / unitsPerDb(pane);
  assert.deepEqual(
    [leftmost, spreadDb <= 3],
    [213.5, true],
    `the edge's vertices at x ${leftmost} span ${spreadDb} dB`,
  );
});

// 4. Decimating, the images layer is an open curve, not a fill closed to the
// floor: at 192 kHz into 96 kHz its lowest vertex sits within 12 dB of its
// highest. A copy closed to the floor plants two feet 90 dB under its curve.

test("test_images_layer_when_decimating_is_a_curve_without_floor_feet", () => {
  baseline();
  rate.value = 192000;
  outputRate.value = 96000;
  const pane = frequencyPane();
  const ys = layer(pane, "path", "primer-images").map(([, y]) => y);
  const spreadDb = (Math.max(...ys) - Math.min(...ys)) / unitsPerDb(pane);
  assert.ok(spreadDb <= 12, `the images layer spans ${spreadDb} dB from its highest vertex to its lowest`);
});

// 5. The audible mark stands at 22 kHz on whichever axis the chain draws: x
// 198.2 on the 0 to 96 kHz axis of 192 kHz into 96 kHz, x 213.1 on the 0 to
// 88.2 kHz axis of 44.1 kHz into 176.4 kHz. A mark on the 20 kHz tick lands at
// 182.9 then 196.5; a mark fixed whatever the rates lands at 198.2 on both.

test("test_audible_mark_stands_at_22k_on_the_axis_the_chain_draws", () => {
  baseline();
  const sweep = [
    [192000, 96000],
    [44100, 176400],
  ].map(([source, out]) => {
    rate.value = source;
    outputRate.value = out;
    return markX("audible");
  });
  assert.deepEqual(sweep, [198.2, 213.1]);
});
