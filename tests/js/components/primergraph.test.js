// Behavioral suite for the filter primer's graph (components/primer/Graph.js),
// written blind from a spec block: no graph source was read. The component is
// driven through the exported signals of store/primergraph.js and rendered to a
// string; the reading below is a number pulled out of SVG geometry, never a word.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. Rule 9: the elements are found by their classes and
// `data-pane` markings (wire identifiers).
//
// GEOMETRY READ. Inside the frequency pane the Nyquist marks are
// `line.primer-nyquist` with `data-mark="source"` (always, first in document
// order) and `data-mark="output"` (when an output rate is set and differs from
// the source rate); the result fill is `path.primer-leak`, absolute coordinates
// only, larger y meaning lower dB. The leak is the fill between the two marks:
// past the output mark the output stream carries its own images at the music's
// level whatever the filter, so that region separates nothing.
//
// Every test leaves the store as it found it: `showMe("intro")` after each.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/primergraph.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

const { html } = await import("../../../hqptuner/static/lib/dom.js");
const { PrimerGraph } = await import("../../../hqptuner/static/components/primer/Graph.js");
const { rate, outputRate, phase, lengthMs, rolloff, transientUs, content, LENGTH_CHIPS, showMe } =
  await import("../../../hqptuner/static/store/primergraph.js");
const { elements, classes, attr } = await import("../support/markup.js");

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

test.afterEach(() => {
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
 * Every "x,y" pair in a points list or an absolute path `d`, as numbers.
 *
 * @param {string} s
 * @returns {[number, number][]}
 */
function pairs(s) {
  const nums = s
    .replace(/[A-DF-Za-df-z]/g, " ")
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
 * The smallest y (highest level) of the leak fill strictly between the source
 * Nyquist mark and the output Nyquist mark.
 *
 * @returns {number}
 */
function leakTop() {
  const box = pane("frequency");
  const marks = inside(box, "line", ["primer-nyquist"]);
  const source = marks.find((el) => attr(el, "data-mark") === "source");
  const output = marks.find((el) => attr(el, "data-mark") === "output");
  const [leak] = inside(box, "path", ["primer-leak"]);
  if (!source || !output || !leak) throw new Error("the frequency pane lacks a Nyquist mark or a leak fill");
  const lo = num(source, "x1");
  const hi = num(output, "x1");
  const between = pairs(attr(leak, "d") || "").filter(([x]) => x > lo && x < hi);
  if (between.length === 0) throw new Error("the leak fill has no vertex between the Nyquist marks");
  return Math.min(...between.map(([, y]) => y));
}

// --- the case -------------------------------------------------------------------

// A longer filter leaks less past source Nyquist: the fill's top edge between
// the source and output marks sits lower (larger y) with the long filter than
// with the short one.

test("test_long_filter_leaks_less_past_nyquist_than_short_filter", () => {
  rate.value = 96000;
  outputRate.value = 192000;
  lengthMs.value = LENGTH_CHIPS.short;
  const short = leakTop();
  lengthMs.value = LENGTH_CHIPS.long;
  const long = leakTop();
  assert.ok(long > short, `long ${long} vs short ${short}`);
});

// --- the controls ---------------------------------------------------------------

/** The inputs the spec fixes unless a line names them. */
function baseline() {
  phase.value = "linear";
  rolloff.value = 0.5;
  transientUs.value = 100;
  content.value = { spurs: false, fakeHires: false, risingNoise: false };
}

/**
 * How many elements of the render carry `data-testid="<id>"`.
 *
 * @param {string} id
 * @returns {number}
 */
const testids = (id) => elements(draw()).filter((el) => attr(el, "data-testid") === id).length;

/**
 * The outermost element carrying `data-testid="<id>"`.
 *
 * @param {string} id
 * @returns {MarkupElement}
 */
function region(id) {
  const hits = elements(draw()).filter((el) => attr(el, "data-testid") === id);
  if (hits.length === 0) throw new Error(`no data-testid="${id}" in the render`);
  return hits.reduce((a, b) => (a.start <= b.start ? a : b));
}

/**
 * How many lit chips the length chip row shows.
 *
 * @returns {number}
 */
const litLengthChips = () =>
  elements(region("primer-chips-length").html).filter((el) => ["seg", "active"].every((c) => classes(el).includes(c)))
    .length;

// The content toggles row exists only for the hi-res sources: absent at 44.1k,
// present once at 96k and at 192k.

test("test_content_row_is_absent_at_cd_rate_and_present_once_at_hires_rates", () => {
  baseline();
  const sweep = [44100, 96000, 192000].map((hz) => {
    rate.value = hz;
    return testids("primer-content");
  });
  assert.deepEqual(sweep, [0, 1, 1]);
});

// A length chip lights whenever the number box beside it reads that chip's own
// figure: one lit at every chip, none lit halfway between the two smallest, and
// none at a figure the box shows as its own. 7.999999999999998 is what a
// log-scaled track returns for the 8 ms tick, so the box reads 8 there and the
// chip has to agree with what the reader can see; 8.25 and 0.501 are figures the
// box shows in full, and no chip claims them.
//
// The expectation is a retyped literal, deliberately: computing it from
// `values.includes(ms)` would restate the exact-equality rule this case exists to
// reject and would score the round-trip probe wrong by construction.

test("test_length_chip_lights_when_the_box_reads_its_own_figure", () => {
  baseline();
  const values = Object.values(LENGTH_CHIPS).sort((a, b) => a - b);
  const probes = [...values, (values[0] + values[1]) / 2, 7.999999999999998, 8.25, 0.501];
  const sweep = probes.map((ms) => {
    lengthMs.value = ms;
    return litLengthChips();
  });
  assert.deepEqual(
    sweep,
    [1, 1, 1, 0, 1, 0, 0],
  );
});

// --- the delay pane ---------------------------------------------------------------

/**
 * The y of the first vertex of the delay pane's trace carrying all of `want`.
 *
 * @param {string[]} want
 * @returns {number}
 */
function delayTraceStartY(want) {
  const [trace] = inside(pane("delay"), "path", ["plot-trace", ...want]);
  if (!trace) throw new Error(`the delay pane lacks a ${want.join(".")} trace`);
  const [first] = pairs(attr(trace, "d") || "");
  if (!first) throw new Error("the delay trace has no vertex");
  return first[1];
}

/**
 * Which phase the delay pane's accent name is marked for: the `data-trace`
 * value of the `text.plot-tlbl` name carrying `applied`. The word inside the
 * name is copy; the marking is contract (docs/testing.md rule 9).
 *
 * @returns {string | undefined}
 */
function appliedTraceName() {
  const names = inside(pane("delay"), "text", ["plot-tlbl", "applied"]).map((el) => attr(el, "data-trace"));
  if (names.length !== 1) throw new Error(`the delay pane carries ${names.length} applied trace names`);
  return names[0];
}

// The delay pane paints the selected phase as the accent trace and names both
// phases: with minimum phase selected the applied trace starts lower on the
// milliseconds axis (larger y) than the ghost and the accent name is the one
// marked `minimum`; with linear selected both readings reverse.

test("test_delay_pane_paints_the_selected_phase_as_the_applied_trace", () => {
  baseline();
  rate.value = 44100;
  outputRate.value = 176400;
  lengthMs.value = 8;
  const sweep = ["minimum", "linear"].map((p) => {
    phase.value = p;
    return [delayTraceStartY(["applied"]) > delayTraceStartY(["ghost"]), appliedTraceName()];
  });
  assert.deepEqual(sweep, [
    [true, "minimum"],
    [false, "linear"],
  ]);
});
