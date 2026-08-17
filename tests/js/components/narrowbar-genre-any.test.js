// Behavioral suite for the inert genre rows: a genre choice row that can no
// longer change what the dropdowns offer renders as an unavailable control
// rather than as a live one. The rule the bar applies is a conjunction — the
// narrowing genre selection includes "any", the genre combine mode is "and",
// and the row is not the "any" row itself — so each of the three terms is
// entered on its own and pinned to leave every row live.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. State is driven by assigning the exported source signals
// the real payloads carry — the engine's `<GetFilters/>` enumeration
// (protocol.md:226) and the static name-keyed overlay from /api/metadata — and
// by resetNarrowing() plus the narrowing module's own genre signals.
//
// A popover renders nothing until it is open, and it opens on its button's
// click handler; preact-render-to-string never fires one and there is no DOM
// here, so a facet is opened the way tests/js/components/narrowbar.test.js
// opens one: by invoking the onClick the button carries, collected through
// preact's own `options.vnode` creation hook (the renderer's public seam,
// third-party surface). Which facet is open is a module private that outlives a
// test and resetNarrowing() does not touch, so the click is a TOGGLE and the
// starting state is read off the screen rather than assumed.
//
// Rows are never named by a hard-coded caption: the caption a genre value wears
// is looked up by picking that value and reading back which row renders checked,
// so a reworded genre label moves these cases with it instead of failing them.
//
// Reading taken where the spec was silent: "MultiSelect with no `off` prop
// renders every checkbox enabled" is exercised through the FOCUS facet, the
// bar's other multi-select, on the reading that the spec's inertness rule names
// the genre multi-select alone. The spec's fifth MultiSelect behaviour —
// clicking an off row leaves the bound array alone — is NOT covered here: a
// disabled control receives no click at all in a browser, so there is nothing
// SSR can deliver that would answer the question honestly, and inventing a
// handler invocation would test a path a pointer never takes.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-genre-any.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { options } from "preact";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { NarrowBar } from "../../../hqptuner/static/components/NarrowBar.js";
import { config, matrixConfig, enums, metadata, engineState } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { resetNarrowing, nGenre, nGenreMode } from "../../../hqptuner/static/store/narrowing.js";
import { staticWire } from "../support/wire.js";

/** @typedef {import("../support/wheel.js").VNode} VNode */

/**
 * A vnode whose props carry a click handler, as `buttonsIn` selects for.
 *
 * @typedef {{
 *   type: string | Function,
 *   props: import("../support/wheel.js").VNodeProps & { onClick: (event: unknown) => void },
 * }} ClickableVNode
 */

// Filters in the engine's own description format, `"<q>/5 [focus, ...] <glyph>
// <ratio>"` with the PCM glyph, plus the static overlay's genre tags. The three
// genre values these cases speak about — rock, jazz and the manual's "any"
// escape hatch — each have a filter carrying them.
const FILTERS = [
  { index: "0", name: "gauss-rock", value: "0", arg: 0, description: "4/5 transients ⥮ Int", apodizing: false },
  { index: "1", name: "gauss-jazz", value: "1", arg: 1, description: "5/5 timbre, space ⥮ Any", apodizing: true },
  { index: "2", name: "gauss-any", value: "2", arg: 0, description: "5/5 timbre ⥮ Any", apodizing: false },
];

const OVERLAY = {
  "gauss-rock": { genre: ["rock"] },
  "gauss-jazz": { genre: ["jazz"] },
  "gauss-any": { genre: ["any"] },
};

/** @returns {Promise<void>} */
async function reset() {
  staticWire();
  engineState.value = {};
  enums.value = { filters: FILTERS };
  metadata.value = {
    settings: {},
    filters: { filters: OVERLAY, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  config.value = { fields: [], file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: [] };
  resetNarrowing();
  await discardAll();
}

// --- rendering, clicking, reading ---------------------------------------------

// One render, with every vnode preact builds along the way. `options.vnode` is
// preact's own creation hook; it is restored even if the render throws.
/** @returns {{ out: string, seen: VNode[] }} */
function renderBar() {
  /** @type {VNode[]} */
  const seen = [];
  const previous = options.vnode;
  options.vnode = (/** @type {VNode} */ vnode) => {
    seen.push(vnode);
    if (previous) previous(vnode);
  };
  try {
    return { out: render(html`<${NarrowBar} />`), seen };
  } finally {
    options.vnode = previous;
  }
}

/**
 * Every button inside one vnode, in document order.
 *
 * @param {unknown} node
 * @param {ClickableVNode[]} [found]
 * @returns {ClickableVNode[]}
 */
function buttonsIn(node, found = []) {
  if (Array.isArray(node)) {
    for (const kid of node) buttonsIn(kid, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  const v = /** @type {VNode} */ (node);
  if (v.type === "button" && v.props && typeof v.props.onClick === "function")
    found.push(/** @type {ClickableVNode} */ (node));
  return buttonsIn(v.props && v.props.children, found);
}

/**
 * One click on the given facet's own button, as a pointer would land on it.
 * Anything other than exactly one match throws rather than clicking something
 * else: a restructured bar must fail loudly, not open the wrong facet.
 *
 * @param {string} name
 * @returns {void}
 */
function clickFacet(name) {
  const blocks = renderBar().seen.filter((v) => v && v.props && v.props["data-multi"] === name);
  if (blocks.length !== 1) throw new Error(`expected one ${name} facet, found ${blocks.length}`);
  const buttons = buttonsIn(blocks[0]);
  if (buttons.length !== 1) throw new Error(`expected one button for ${name}, found ${buttons.length}`);
  buttons[0].props.onClick({ preventDefault() {}, stopPropagation() {} });
}

/**
 * One facet's own block, so nothing is read off the rest of the bar.
 *
 * @param {string} out
 * @param {string} name
 * @returns {string}
 */
function facet(out, name) {
  const start = out.indexOf(`data-multi="${name}"`);
  if (start < 0) throw new Error(`no facet block for ${name} in the rendered bar`);
  const rest = out.slice(start + 1);
  const ends = ["data-multi=", "narrow-switchcols"].map((m) => rest.indexOf(m)).filter((i) => i >= 0);
  return ends.length ? rest.slice(0, Math.min(...ends)) : rest;
}

/**
 * The choice rows of one facet's popover: an input and the label beside it. A
 * shut popover renders none.
 *
 * @param {string} block
 * @returns {{ type: string, label: string }[]}
 */
const rows = (block) =>
  [...block.matchAll(/<input[^>]*\btype="([^"]*)"[^>]*>\s*<span class="opt-label">([\s\S]*?)<\/span>/g)].map((m) => ({
    type: m[1],
    label: m[2],
  }));

/**
 * The named facet's own block, with its popover open.
 *
 * @param {string} name
 * @returns {string}
 */
function open(name) {
  clickFacet(name);
  const block = () => facet(renderBar().out, name);
  if (rows(block()).length === 0) clickFacet(name);
  return block();
}

/**
 * The labels of the rows whose input renders checked.
 *
 * @param {string} block
 * @returns {string[]}
 */
const checkedRows = (block) =>
  [...block.matchAll(/<input([^>]*)>\s*<span class="opt-label">([\s\S]*?)<\/span>/g)]
    .filter((m) => /\bchecked\b/.test(m[1]))
    .map((m) => m[2]);

/**
 * One row of an open popover: the `<label>` element wrapping the input and the
 * caption beside it.
 *
 * @param {string} block
 * @param {string} label
 * @returns {string}
 */
function rowOf(block, label) {
  const at = block.indexOf(`<span class="opt-label">${label}</span>`);
  if (at < 0) throw new Error(`no row captioned "${label}" in this popover`);
  const start = block.lastIndexOf("<label", at);
  if (start < 0) throw new Error(`the "${label}" row is not wrapped in a label element`);
  const end = block.indexOf("</label>", at);
  return block.slice(start, end < 0 ? undefined : end + "</label>".length);
}

/**
 * Whether an element's opening tag carries a bare or valued `disabled`.
 *
 * @param {string} tag
 * @returns {boolean}
 */
const isDisabled = (tag) => /\sdisabled(\s|=|\/|>)/.test(tag);

/**
 * Whether the checkbox of one row renders unavailable.
 *
 * @param {string} block
 * @param {string} label
 * @returns {boolean}
 */
function rowIsDisabled(block, label) {
  const input = /<input[^>]*>/.exec(rowOf(block, label));
  if (!input) throw new Error(`the "${label}" row carries no input`);
  return isDisabled(input[0]);
}

/**
 * Whether one row's `<label>` element carries the inert marker.
 *
 * @param {string} block
 * @param {string} label
 * @returns {boolean}
 */
function rowIsMarkedOff(block, label) {
  const tag = /<label[^>]*>/.exec(rowOf(block, label));
  if (!tag) throw new Error(`the "${label}" row has no opening label tag`);
  const names = (/class="([^"]*)"/.exec(tag[0]) || ["", ""])[1].split(/\s+/);
  return names.includes("off");
}

/**
 * How many rows of an open popover render an unavailable checkbox.
 *
 * @param {string} block
 * @returns {number}
 */
const disabledRowCount = (block) => rows(block).filter((r) => rowIsDisabled(block, r.label)).length;

// The caption a genre value wears, discovered rather than hard-coded: the value
// is picked under the OR mode (which marks nothing inert), and the row that
// comes back checked is that value's own row.
/** @type {Map<string, string>} */
const captions = new Map();

/**
 * @param {string} value
 * @returns {Promise<string>}
 */
async function captionFor(value) {
  const known = captions.get(value);
  if (known) return known;
  await reset();
  nGenreMode.value = "or";
  nGenre.value = [value];
  const [caption] = checkedRows(open("genre"));
  if (!caption) throw new Error(`no genre row is bound to "${value}"`);
  captions.set(value, caption);
  return caption;
}

/**
 * The genre popover, open, under a stated selection and combine mode.
 *
 * @param {string[]} selection
 * @param {string} mode
 * @returns {Promise<string>}
 */
async function genrePopover(selection, mode) {
  await reset();
  nGenreMode.value = mode;
  nGenre.value = selection;
  return open("genre");
}

// --- all three terms hold: every other genre row goes inert -----------------------

test("test_with_any_picked_and_the_and_mode_the_rock_row_is_disabled", async () => {
  const rock = await captionFor("rock");
  assert.equal(rowIsDisabled(await genrePopover(["any"], "and"), rock), true);
});

test("test_with_any_picked_and_the_and_mode_the_rock_row_is_marked_off", async () => {
  const rock = await captionFor("rock");
  assert.equal(rowIsMarkedOff(await genrePopover(["any"], "and"), rock), true);
});

// --- the "any" row itself stays live, so the user can give the escape hatch back ---

test("test_with_any_picked_and_the_and_mode_the_any_row_is_not_disabled", async () => {
  const any = await captionFor("any");
  assert.equal(rowIsDisabled(await genrePopover(["any"], "and"), any), false);
});

test("test_with_any_picked_and_the_and_mode_the_any_row_is_not_marked_off", async () => {
  const any = await captionFor("any");
  assert.equal(rowIsMarkedOff(await genrePopover(["any"], "and"), any), false);
});

// --- drop one term at a time: every row stays live --------------------------------

test("test_with_any_picked_and_the_or_mode_the_rock_row_is_not_disabled", async () => {
  const rock = await captionFor("rock");
  assert.equal(rowIsDisabled(await genrePopover(["any"], "or"), rock), false);
});

test("test_with_any_picked_and_the_or_mode_the_rock_row_is_not_marked_off", async () => {
  const rock = await captionFor("rock");
  assert.equal(rowIsMarkedOff(await genrePopover(["any"], "or"), rock), false);
});

test("test_with_jazz_picked_and_the_and_mode_the_rock_row_is_not_disabled", async () => {
  const rock = await captionFor("rock");
  assert.equal(rowIsDisabled(await genrePopover(["jazz"], "and"), rock), false);
});

test("test_with_jazz_picked_and_the_and_mode_the_rock_row_is_not_marked_off", async () => {
  const rock = await captionFor("rock");
  assert.equal(rowIsMarkedOff(await genrePopover(["jazz"], "and"), rock), false);
});

test("test_with_no_genre_picked_and_the_and_mode_the_rock_row_is_not_disabled", async () => {
  const rock = await captionFor("rock");
  assert.equal(rowIsDisabled(await genrePopover([], "and"), rock), false);
});

test("test_with_no_genre_picked_and_the_and_mode_the_rock_row_is_not_marked_off", async () => {
  const rock = await captionFor("rock");
  assert.equal(rowIsMarkedOff(await genrePopover([], "and"), rock), false);
});

// --- the bar's other multi-select carries no inertness rule -----------------------

test("test_the_focus_popover_disables_no_row", async () => {
  await reset();
  assert.equal(disabledRowCount(open("focus")), 0);
});
