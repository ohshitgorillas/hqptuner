// The filter primer's fold: what the frequency pane draws where a stream is
// resampled and its copies land back inside the band. Written blind from a
// spec block in a tree holding no implementation, so the red run here is the
// bite proof (docs/testing.md rule 8).
//
// Policy (docs/testing.md): behavior only, public API only, one assertion per
// test, nothing of HQPTuner's stubbed. The alias reading is taken from the
// exported `aliasSpectrumDb` on a grid the test built itself; the drawn fills
// are read out of SVG geometry after rendering `PrimerGraph` to a string,
// driven through the exported signals of store/primergraph.js. Rule 9: every
// element is found by class or `data-*` marking, both wire identifiers, and
// every expected value is a number.
//
// GEOMETRY READ. Inside the pane carrying `data-pane="frequency"`: the source
// wash is `path.primer-wash`, the images fill `path.primer-images`, the output
// fill `path.primer-leak`, the dB grid lines `line.plot-grid` (evenly spaced
// at 30 dB steps), the Nyquist marks `line.primer-nyquist`. A path's `d` is an
// absolute `M x,y L x,y ...` list whose first and last vertices are feet on
// the floor. Larger y is lower dB, so a difference in y between two vertices
// converts to dB through the spacing of two adjacent grid lines. The x of a
// frequency runs linearly from the plot's left edge (0 Hz) to its right edge
// (the faster stream's Nyquist).
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
 * The vertices of a path's `d`, an absolute move/line list of `x,y` pairs.
 *
 * @param {MarkupElement} path
 * @returns {[number, number][]}
 */
function vertices(path) {
  const pts = (attr(path, "d") || "")
    .replace(/[MLZ]/g, " ")
    .split(/\s+/)
    .filter((t) => t !== "")
    .map((pair) => pair.split(",").map(Number));
  if (pts.length === 0 || pts.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)))) {
    throw new Error(`not a list of x,y pairs: ${attr(path, "d")}`);
  }
  return pts.map(([x, y]) => [x, y]);
}

/**
 * The one path of a class in the frequency pane, with its vertices.
 *
 * @param {MarkupElement[]} pane
 * @param {string} klass
 * @returns {[number, number][]}
 */
function fill(pane, klass) {
  const [path] = inside(pane, "path", klass);
  if (!path) throw new Error(`the frequency pane lacks a path.${klass}`);
  return vertices(path);
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
  const xs = fill(pane, "primer-wash").map(([x]) => x);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  return left + ((right - left) * hz) / axisTopHz;
}

/**
 * A fill's top edge at a frequency, as y: the vertex nearest that x with the
 * two floor feet left out. NaN when no vertex comes within four units of the
 * x, so a fill that skips the frequency fails the assertion rather than
 * reading a far-off vertex.
 *
 * @param {MarkupElement[]} pane
 * @param {string} klass
 * @param {number} axisTopHz
 * @param {number} hz
 * @returns {number}
 */
function edgeY(pane, klass, axisTopHz, hz) {
  const x = xOf(pane, axisTopHz, hz);
  const body = fill(pane, klass).slice(1, -1);
  if (body.length === 0) return NaN;
  const nearest = body.reduce((a, b) => (Math.abs(a[0] - x) <= Math.abs(b[0] - x) ? a : b));
  return Math.abs(nearest[0] - x) <= 4 ? nearest[1] : NaN;
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

// 2. The output fill draws what the fold lands on the output band, not the
// output stream whole: at 192 kHz into 96 kHz with a 0.7 ms filter, its top
// edge at 47 kHz, where the short filter's transition lets the fold through,
// sits at least 30 dB above its edge at 13 kHz, deep in the passband. A fill
// carrying the music puts 13 kHz 15 dB above 47 kHz; a fill that skips the
// passband has no vertex at either frequency and reads NaN.

test("test_output_fill_top_edge_rises_from_passband_to_transition_band", () => {
  baseline();
  rate.value = 192000;
  outputRate.value = 96000;
  lengthMs.value = 0.7;
  const pane = frequencyPane();
  const risenDb =
    (edgeY(pane, "primer-leak", 96000, 13000) - edgeY(pane, "primer-leak", 96000, 47000)) / unitsPerDb(pane);
  assert.ok(risenDb >= 30, `the output fill's edge at 47 kHz sits ${risenDb} dB above its edge at 13 kHz`);
});

// 3. The images fill is the source mirrored at the output Nyquist, so at
// 192 kHz into 96 kHz the source's level at 83 kHz lands at 96 - 83 = 13 kHz:
// the images fill's top edge at 13 kHz sits within 0.5 dB of the wash's top
// edge at 83 kHz. Images drawn only above the source's own 96 kHz Nyquist have
// no vertex at 13 kHz and read NaN; an unmirrored copy of the wash sits 8 dB
// off there.

test("test_images_fill_at_13k_matches_the_source_wash_at_its_83k_mirror", () => {
  baseline();
  rate.value = 192000;
  outputRate.value = 96000;
  const pane = frequencyPane();
  const offDb =
    (edgeY(pane, "primer-images", 96000, 13000) - edgeY(pane, "primer-wash", 96000, 83000)) / unitsPerDb(pane);
  assert.ok(Math.abs(offDb) <= 0.5, `the images fill at 13 kHz sits ${offDb} dB off the wash at 83 kHz`);
});

// 4. Upsampling, the output fill starts at the source Nyquist, where the
// images begin: at 44.1 kHz into 176.4 kHz its leftmost vertex is the source
// Nyquist mark at x 213.5 on the pane's viewBox. A fill drawn from 0 Hz across
// the passband, an edge along the floor under the music, starts at the frame's
// left edge instead.

test("test_output_fill_starts_at_the_source_nyquist_when_upsampling", () => {
  baseline();
  rate.value = 44100;
  outputRate.value = 176400;
  const leftmost = Math.min(...fill(frequencyPane(), "primer-leak").map(([x]) => x));
  assert.equal(leftmost, 213.5);
});
