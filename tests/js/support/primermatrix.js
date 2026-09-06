// The filter primer's whole state matrix, rendered once and reduced to the few
// facts the sweeping suites ask about: tests/js/components/primermatrix.test.js,
// and the one point test that was widened onto it, the axis-span case in
// tests/js/components/primerimpulse.test.js.
//
// A point test is only widened onto this matrix where its expected values are an
// anchor the sweep carries with it — the axis span is compared against the length
// the caller set. A test whose reading would have to be compared against another
// reading of the same render is left alone: over 648 states that is still a round
// trip, and a pair of matching errors passes it at every one of them.
//
// The matrix is generated from the store's OWN enumeration — `RATES`, whatever
// `outputFactors(hz)` offers at each rate, both phases, and every value of
// `LENGTH_CHIPS`, `ROLLOFF_CHIPS` and `TRANSIENT_CHIPS` — never from a list
// written out here. A hand-written list of states goes stale the moment a chip
// is added and then reports a green sweep over states that no longer exist.
//
// The sweep is 648 renders, so it runs once and is cached at module scope: every
// test in a file reads the same reduction. Each state is reduced as it is
// rendered rather than kept whole, because keeping every vertex of every trace
// of every state is hundreds of megabytes; what survives is a handful of counts
// and two small string sets.
//
// SPEC FACTS about the markup, in the sense tests/js/support/primeredit.js uses
// that phrase: these are the contract this fixture reads against, not an
// inference from what the component happens to emit. Extraction that finds
// anything else throws, so a changed contract fails loudly here instead of
// quietly reducing to a shape the predicates happen to accept.
//
//   - A pane is the outermost element carrying `data-pane`, whose value is one
//     of `impulse`, `delay`, `frequency`.
//   - Every pane holds exactly one `<svg>`. The impulse and delay panes are 400
//     viewBox units wide and the frequency pane 800; all three are 240 tall.
//   - A trace carries the class `plot-trace` and is either a `<polyline>` whose
//     `points` is a space-separated list of `x,y` pairs or a `<path>` whose `d`
//     is a move/line list of the same pairs. A path's `d` may be empty, and an
//     empty trace draws no vertices. The trace a pane derives from the filter
//     also carries `applied`.
//   - A fill is a `<path>` carrying `primer-wash`, `primer-images` or
//     `primer-leak`, whose `d` is likewise a list of `x,y` pairs.
//   - A layer is NAMED by a `<text data-layer="<key>">`, which only the frequency
//     pane emits, and DRAWN by the class it corresponds to: `music` by
//     `primer-wash`, `images` by `primer-images`, `output` by `primer-leak`,
//     `filter` by `polyline.plot-trace.applied`.
//   - The plot rectangle insets by 30 on the left and 36 on the right, so x runs
//     30..364 in the impulse and delay panes and 30..764 in the frequency pane.
//     y runs 24..220, except in the frequency pane, whose top 15 units are a
//     legend band, so 39..220.
//   - Coordinates are printed to one decimal. A vertex is inside the rectangle
//     within 1e-6, boundaries inclusive; an edge is REACHED within one plot
//     column, which is one viewBox unit where the page has measured nothing.
//
// READINGS TAKEN where the spec left a choice, stated so they can be argued with
// rather than discovered:
//   - A layer counts as DRAWN when its element is present, whatever its `d`
//     holds: "drawn by the class it corresponds to" is about the element, and an
//     empty `d` is explicitly a thing a present trace may carry.
//   - An applied trace "reaches both edges" when its leftmost vertex is within a
//     plot column of the rectangle's left edge AND its rightmost within a column
//     of the right edge. A FILL reaches both edges by the same rule, read off
//     the same coordinate list, and the layers whose fill does so are reported
//     as `spanned` beside the layers that are merely `drawn`.
//   - Panes are keyed by their `data-pane` value as the render gives it. An
//     unrecognized value is recorded rather than thrown on, and a render with no
//     panes yields no keys at all, which is what the pane-keyed assertions in
//     the suites are shaped to catch.
//
// SSR NOTE: preact-render-to-string emits an empty-string attribute bare, so an
// empty `d` arrives as ` d` and not as `d=""`. Presence is therefore asked with
// `hasAttr` and the value defaulted, or every empty trace would read as a path
// carrying no `d` at all.

import { render } from "preact-render-to-string";

import { elements, classes, attr, hasAttr } from "./markup.js";

const { html } = await import("../../../hqptuner/static/lib/dom.js");
const { PrimerGraph } = await import("../../../hqptuner/static/components/primer/Graph.js");
const {
  RATES,
  LENGTH_CHIPS,
  ROLLOFF_CHIPS,
  TRANSIENT_CHIPS,
  rate,
  outputRate,
  phase,
  lengthMs,
  rolloff,
  transientUs,
  plotPx,
  freqPx,
  outputFactors,
  outputRateFor,
  showMe,
} = await import("../../../hqptuner/static/store/primergraph.js");

/** @typedef {import("./markup.js").MarkupElement} MarkupElement */

/** Coordinates are printed to one decimal, so containment is asked within this. */
const TOL = 1e-6;

const VIEWBOX = { impulse: "0 0 400 240", delay: "0 0 400 240", frequency: "0 0 800 240" };

const RECT = {
  impulse: { x0: 30, x1: 364, y0: 24, y1: 220 },
  delay: { x0: 30, x1: 364, y0: 24, y1: 220 },
  frequency: { x0: 30, x1: 764, y0: 39, y1: 220 },
};

const FILL_LAYER = { "primer-wash": "music", "primer-images": "images", "primer-leak": "output" };

// The sweep runs with the page having measured nothing — `plotPx` and `freqPx`
// left at 0, which is where the store starts and where the suites put them back.
// One plot column is therefore one viewBox unit, which is the tolerance an edge
// is reached within. Measured: the impulse and delay geometry is identical at 0
// and at a measured 640, so the sweep loses no state by staying unmeasured.
/** The plot widths the page reports once it has measured; 0 means unmeasured. */
const PX = 0;

/** One plot column, in viewBox units, the page having measured nothing. */
const COLUMN = 1;

const PHASES = ["linear", "minimum"];

/**
 * @typedef {{
 *   traces: number,
 *   applied: number,
 *   outside: number,
 *   short: number,
 *   named: string[],
 *   drawn: string[],
 *   spanned: string[],
 * }} PaneRead
 */

/**
 * @typedef {{
 *   name: string,
 *   hz: number,
 *   outHz: number | null,
 *   ph: string,
 *   len: number,
 *   panes: Record<string, PaneRead>,
 * }} StateRead
 */

// --- coordinates ----------------------------------------------------------------

/**
 * The `x,y` pairs of a coordinate list, moves and lines stripped.
 *
 * @param {string} s
 * @param {string} where
 * @returns {[number, number][]}
 */
function pairs(s, where) {
  if (!/^[MLZmlz0-9eE+\-.,\s]*$/.test(s)) throw new Error(`${where} is not a move/line list of x,y pairs: ${s}`);
  const nums = s
    .replace(/[MLZmlz]/g, " ")
    .split(/[\s,]+/)
    .filter((t) => t !== "")
    .map(Number);
  if (nums.some((v) => !Number.isFinite(v)) || nums.length % 2 !== 0)
    throw new Error(`${where} is not a list of x,y pairs: ${s}`);
  /** @type {[number, number][]} */
  const out = [];
  for (let i = 0; i < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/**
 * The coordinate attribute a drawn element carries, "" when it carries an empty
 * one, throwing when it carries none at all.
 *
 * @param {MarkupElement} el
 * @returns {string}
 */
function coords(el) {
  const name = el.name === "polyline" ? "points" : "d";
  if (!hasAttr(el, name)) throw new Error(`<${el.name}> carries no ${name}`);
  return attr(el, name) || "";
}

// --- reading one pane -----------------------------------------------------------

/**
 * @param {MarkupElement} el
 * @param {string} klass
 * @returns {boolean}
 */
const has = (el, klass) => classes(el).includes(klass);

/**
 * The pane's viewBox, checked against the contract.
 *
 * @param {MarkupElement[]} own
 * @param {string} key
 * @returns {void}
 */
function checkViewBox(own, key) {
  const svgs = own.filter((el) => el.name === "svg");
  if (svgs.length !== 1) throw new Error(`pane "${key}" holds ${svgs.length} <svg>, not one`);
  const box = attr(svgs[0], "viewBox");
  if (box !== VIEWBOX[/** @type {keyof typeof VIEWBOX} */ (key)]) throw new Error(`pane "${key}" has viewBox "${box}"`);
}

/**
 * Every trace in a pane.
 *
 * @param {MarkupElement[]} own
 * @param {string} key
 * @returns {MarkupElement[]}
 */
const tracesOf = (own, key) =>
  own
    .filter((el) => has(el, "plot-trace"))
    .map((el) => {
      if (el.name !== "polyline" && el.name !== "path")
        throw new Error(`a trace in pane "${key}" is a <${el.name}>, not a <polyline> or <path>`);
      return el;
    });

/**
 * The layers one fill stands for, by the class each layer corresponds to.
 *
 * @param {MarkupElement} el
 * @returns {string[]}
 */
const fillLayers = (el) =>
  Object.entries(FILL_LAYER)
    .filter(([c]) => has(el, c))
    .map(([, layer]) => layer);

/**
 * The layers a pane draws, by the class each layer corresponds to.
 *
 * @param {MarkupElement[]} traces
 * @param {MarkupElement[]} fills
 * @returns {string[]}
 */
function drawnLayers(traces, fills) {
  const drawn = fills.flatMap(fillLayers);
  if (traces.some((el) => el.name === "polyline" && has(el, "applied"))) drawn.push("filter");
  return drawn;
}

/**
 * The layers a pane names.
 *
 * @param {MarkupElement[]} own
 * @param {string} key
 * @returns {string[]}
 */
const namedLayers = (own, key) =>
  own
    .filter((el) => el.name === "text" && attr(el, "data-layer") !== undefined)
    .map((el) => {
      const v = attr(el, "data-layer");
      if (!v) throw new Error(`a layer name in pane "${key}" is empty`);
      return v;
    });

/**
 * Whether a trace reaches both edges of the plot rectangle, within a column.
 *
 * @param {[number, number][]} pts
 * @param {{ x0: number, x1: number }} rect
 * @param {number} column
 * @returns {boolean}
 */
function spans(pts, rect, column) {
  if (pts.length === 0) return false;
  const xs = pts.map(([x]) => x);
  return Math.abs(Math.min(...xs) - rect.x0) <= column && Math.abs(Math.max(...xs) - rect.x1) <= column;
}

/**
 * One pane reduced to the facts the behaviors ask about.
 *
 * @param {MarkupElement[]} own
 * @param {string} key
 * @returns {PaneRead}
 */
function readPane(own, key) {
  checkViewBox(own, key);
  const rect = RECT[/** @type {keyof typeof RECT} */ (key)];
  const traces = tracesOf(own, key);
  const fills = own.filter((el) => el.name === "path" && Object.keys(FILL_LAYER).some((c) => has(el, c)));
  const applied = traces.filter((el) => has(el, "applied"));

  let outside = 0;
  for (const el of [...traces, ...fills]) {
    const pts = pairs(coords(el), `<${el.name}> in pane "${key}"`);
    outside += pts.filter(
      ([x, y]) => x < rect.x0 - TOL || x > rect.x1 + TOL || y < rect.y0 - TOL || y > rect.y1 + TOL,
    ).length;
  }
  const short = applied.filter((el) => !spans(pairs(coords(el), `<${el.name}>`), rect, COLUMN)).length;
  const spanned = fills
    .filter((el) => spans(pairs(coords(el), `<${el.name}> in pane "${key}"`), rect, COLUMN))
    .flatMap(fillLayers);

  return {
    traces: traces.length,
    applied: applied.length,
    outside,
    short,
    named: [...new Set(namedLayers(own, key))].sort(),
    drawn: [...new Set(drawnLayers(traces, fills))].sort(),
    spanned: [...new Set(spanned)].sort(),
  };
}

/**
 * Every pane of one render, keyed by its `data-pane` value.
 *
 * @param {string} out
 * @returns {Record<string, PaneRead>}
 */
function readPanes(out) {
  const all = elements(out);
  /** @type {Record<string, MarkupElement>} */
  const outermost = {};
  for (const el of all) {
    const key = attr(el, "data-pane");
    if (key === undefined) continue;
    if (!outermost[key] || el.start < outermost[key].start) outermost[key] = el;
  }
  /** @type {Record<string, PaneRead>} */
  const panes = {};
  for (const [key, box] of Object.entries(outermost)) {
    const end = box.start + box.html.length;
    const own = all.filter((el) => el.start >= box.start && el.start < end && el !== box);
    panes[key] =
      key in RECT
        ? readPane(own, key)
        : { traces: 0, applied: 0, outside: 0, short: 0, named: [], drawn: [], spanned: [] };
  }
  return panes;
}

// --- the sweep ------------------------------------------------------------------

/** @typedef {{ hz: number, factor: number | string, ph: string, len: number, roll: number, tr: number }} MatrixState */

/**
 * Every state of one source rate and one output factor.
 *
 * @param {number} hz
 * @param {number | string} factor
 * @returns {MatrixState[]}
 */
function chainStates(hz, factor) {
  /** @type {MatrixState[]} */
  const out = [];
  for (const ph of PHASES)
    for (const len of Object.values(LENGTH_CHIPS))
      for (const roll of Object.values(ROLLOFF_CHIPS))
        for (const tr of Object.values(TRANSIENT_CHIPS)) out.push({ hz, factor, ph, len, roll, tr });
  return out;
}

/**
 * The states of the matrix, in the store's own enumeration order.
 *
 * @returns {MatrixState[]}
 */
const states = () =>
  RATES.flatMap((/** @type {number} */ hz) => outputFactors(hz).flatMap((factor) => chainStates(hz, factor)));

/**
 * The stable short name of one state: source rate, output factor, phase, length,
 * roll-off, transient.
 *
 * @param {MatrixState} s
 * @returns {string}
 */
const stateName = (s) => `${s.hz}/${s.factor}/${s.ph}/${s.len}/${s.roll}/${s.tr}`;

/**
 * Every state of the matrix as inputs, without rendering any of them: for a
 * suite that reads something this fixture does not reduce and drives the render
 * itself.
 *
 * @returns {(MatrixState & { name: string, outHz: number | null })[]}
 */
export const matrixStates = () =>
  states().map((s) => ({
    ...s,
    name: stateName(s),
    outHz: outputRateFor(s.hz, s.factor),
  }));

/**
 * One state put on the store's signals, so the next render draws it.
 *
 * @param {MatrixState} s
 * @returns {void}
 */
export function applyState(s) {
  rate.value = s.hz;
  outputRate.value = outputRateFor(s.hz, s.factor);
  phase.value = s.ph;
  lengthMs.value = s.len;
  rolloff.value = s.roll;
  transientUs.value = s.tr;
}

/** @type {StateRead[] | null} */
let cached = null;

/**
 * Every state of the matrix, rendered once and reduced. Cached: the sweep is 648
 * renders and every behavior reads the same one.
 *
 * @returns {StateRead[]}
 */
function matrixSweep() {
  if (cached) return cached;
  plotPx.value = PX;
  freqPx.value = PX;
  cached = matrixStates().map((s) => {
    applyState(s);
    return { ...s, panes: readPanes(render(html`<${PrimerGraph} />`)) };
  });
  return cached;
}

/**
 * The names of the states in which one pane fails a predicate, keyed by the pane
 * names the render actually carried — no key at all where nothing was rendered,
 * which is what makes a blank graph fail rather than pass every quantifier
 * vacuously.
 *
 * @param {(p: PaneRead, s: StateRead, key: string) => boolean} fails
 * @returns {Record<string, string[]>}
 */
export function failingByPane(fails) {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const s of matrixSweep())
    for (const [key, pane] of Object.entries(s.panes)) {
      out[key] ||= [];
      if (fails(pane, s, key)) out[key].push(s.name);
    }
  for (const key of Object.keys(out)) out[key].sort();
  return out;
}

/** The store put back the way the sweep found it. */
export function restore() {
  plotPx.value = 0;
  freqPx.value = 0;
  showMe("intro");
}
