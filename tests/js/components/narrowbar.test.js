// Behavioral suite for the narrowing bar's rendered controls
// (components/NarrowBar.js). Length is a facet a filter carries exactly ONE
// of, so its popover offers its values as a single choice — radio rows, not
// the checkbox rows the set-valued facets (genre, focus) use — plus a row that
// clears the facet again. Last, the count chip on a row previews the click
// that row would perform, which on a value already picked is an UNPICK.
//
// Policy (docs/testing.md): public API only, one assertion per test, no store
// function stubbed. State is driven by assigning the exported source signals the
// real payloads carry — the engine's `<GetFilters/>` enumeration
// (protocol.md:226) and the static name-keyed overlay from /api/metadata — and
// by resetNarrowing(), the module's own public reset.
//
// A popover renders nothing until it is open, and it opens on its button's
// click handler; preact-render-to-string never fires one and there is no DOM
// here, so a facet is opened the way a caller opens one: by invoking the onClick
// the button carries, collected through preact's own `options.vnode` creation
// hook (the renderer's public seam, third-party surface — nothing of HQPTuner's
// is stubbed or widened). The result is read back off the re-rendered HTML, as
// the browser shows it.
//
// That route, and reading the rows back out of the emitted HTML, couples these
// cases to the bar's element structure — the `data-multi` block a facet lives
// in, the button inside it, and the `opt-label` / `opt-count` spans beside each
// input. Accepted: SSR is the house pattern for component suites and there is no
// browser harness on this host. A markup change will fail these cases for a
// reason that is not a regression; check the shape before reading the failure as
// one.
//
// NOT covered here: which row is marked checked, and what clicking a row does to
// the facet signals — the store suite (tests/js/store/narrowing.test.js) pins the
// effect of every facet value on the offered filters, which is the observable
// contract; the checked mark is the same fact rendered.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { options } from "preact";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { NarrowBar } from "../../../hqptuner/static/components/NarrowBar.js";
import { config, matrixConfig, enums, metadata, engineState } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { resetNarrowing, nFocus } from "../../../hqptuner/static/store/narrowing.js";
import { showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { staticWire } from "../support/wire.js";

/** @typedef {import("../support/wheel.js").VNode} VNode */

/**
 * One filter as the engine's own `<GetFilters/>` enumeration reports it
 * (protocol.md:226).
 *
 * @typedef {{
 *   index: string,
 *   name: string,
 *   value: string,
 *   arg: number,
 *   description: string,
 *   apodizing: boolean,
 * }} EngineFilter
 */

/**
 * A vnode whose props carry a click handler, as `buttonsIn` selects for.
 *
 * @typedef {{
 *   type: string | Function,
 *   props: import("../support/wheel.js").VNodeProps & { onClick: (event: unknown) => void },
 * }} ClickableVNode
 */

// A handful of filters in the engine's own description format,
// `"<q>/5 [focus, ...] <glyph> <ratio>"` with the PCM glyph and the engine's
// abbreviated ratio tail, plus the static overlay's genre tags.
const FILTERS = [
  { index: "0", name: "gauss-short", value: "0", arg: 0, description: "4/5 transients ⥮ Int", apodizing: false },
  { index: "1", name: "gauss-plain", value: "1", arg: 1, description: "5/5 timbre, space ⥮ Any", apodizing: true },
  { index: "2", name: "gauss-long", value: "2", arg: 0, description: "5/5 timbre ⥮ 2^x", apodizing: false },
];

const OVERLAY = {
  "gauss-short": { genre: ["jazz"] },
  "gauss-plain": { genre: ["any"] },
  "gauss-long": { genre: ["classical", "jazz"] },
};

// The counts on a facet row are counts of a DROPDOWN's options, so a case that
// reads one hands the chain's two filter fields the options the /config form
// serves. `engineState.mode` picks the active chain; PCM unless it says SDM.
const FOCUS_FILTERS = [
  { index: "0", name: "gauss-a", value: "0", arg: 1, description: "5/5 timbre, transients ⥮ Any", apodizing: true },
  { index: "1", name: "gauss-b", value: "1", arg: 1, description: "5/5 timbre ⥮ Any", apodizing: true },
  { index: "2", name: "gauss-c", value: "2", arg: 1, description: "5/5 transients ⥮ Any", apodizing: true },
];

/** @param {EngineFilter[]} filters */
const chainFields = (filters) => {
  const opts = filters.map((f) => ({ value: f.value, label: f.name }));
  // The daemon's PCM chain names its two filter slots `filter1x` and `filter`.
  return [
    { name: "filter1x", value: "0", options: opts },
    { name: "filter", value: "0", options: opts },
  ];
};

/**
 * @param {{ filters?: EngineFilter[], fields?: Record<string, unknown>[] }} [scenario]
 * @returns {Promise<void>}
 */
async function reset({ filters = FILTERS, fields = [] } = {}) {
  staticWire();
  engineState.value = {};
  enums.value = { filters };
  metadata.value = {
    settings: {},
    filters: { filters: OVERLAY, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  config.value = { fields, file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: [] };
  resetNarrowing();
  await discardAll();
}

// --- rendering, clicking, reading ---------------------------------------------

// One render, with every vnode preact builds along the way. `options.vnode` is
// preact's own creation hook; it is restored even if the render throws, so no
// case can poison the next.
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

// Every button inside one vnode, in document order.
/**
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

// One click on the given facet's own button, as a pointer would land on it. The
// facet is found by its block rather than by the button's wording, which is the
// current selection and changes as cases pick values. Anything other than
// exactly one match throws rather than clicking something else: a restructured
// bar must fail loudly, not open the wrong facet.
/**
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

// The named facet's own block, with its popover open. Which facet is open is a
// module private that outlives a test and resetNarrowing() does not touch, so
// the click is a TOGGLE: a case that finds the popover shut after clicking is
// looking at one its predecessor left open, and clicks again. Same discipline as
// the LiveView collapse suite — the starting state is read off the screen, never
// assumed.
/**
 * @param {string} name
 * @returns {string}
 */
function open(name) {
  clickFacet(name);
  const block = () => facet(renderBar().out, name);
  if (rows(block()).length === 0) clickFacet(name);
  return block();
}

// One facet's own block, so nothing is read off the rest of the bar — the facet
// BUTTON carries the same "Any length" wording as the row that clears it, and
// every other facet has rows of its own.
/**
 * @param {string} out
 * @param {string} name
 * @returns {string}
 */
function facet(out, name) {
  const start = out.indexOf(`data-multi="${name}"`);
  if (start < 0) throw new Error(`no facet block for ${name} in the rendered bar`);
  const rest = out.slice(start + 1);
  // The block ends where the next facet begins, or where the facet row itself
  // ends and the switch columns start.
  const ends = ["data-multi=", "narrow-switchcols"].map((m) => rest.indexOf(m)).filter((i) => i >= 0);
  return ends.length ? rest.slice(0, Math.min(...ends)) : rest;
}

// The choice rows of one facet's popover: an input and the label beside it. A
// shut popover renders none.
/** @param {string} block */
const rows = (block) =>
  [...block.matchAll(/<input[^>]*\btype="([^"]*)"[^>]*>\s*<span class="opt-label">([\s\S]*?)<\/span>/g)].map((m) => ({
    type: m[1],
    label: m[2],
  }));

// The count chip on one named row. Its text is the active chain's pair of
// counts, "<1x>/<Nx>", so a case reads the half it means rather than the string.
/**
 * @param {string} block
 * @param {string} label
 * @returns {string}
 */
function chip(block, label) {
  const m = new RegExp(`<span class="opt-label">${label}</span><span class="opt-count[^"]*">([^<]*)</span>`).exec(
    block,
  );
  if (!m) throw new Error(`no count chip on the ${label} row`);
  return m[1];
}

/** @param {string} text */
const nxCount = (text) => Number(text.split("/")[1]);

/** @param {string} block */
const rowLabels = (block) => rows(block).map((r) => r.label);

/** @param {string} block */
const rowKinds = (block) => [...new Set(rows(block).map((r) => r.type))].sort();

// --- single choice --------------------------------------------------------------

test("test_the_length_facet_offers_its_values_as_radio_rows", async () => {
  await reset();
  assert.deepEqual(rowKinds(open("length")), ["radio"]);
});

// The single-select ratio popover and its upsample-only checkbox are gone —
// three boolean rate-narrowing switches replaced them at the store level
// (tests/js/store/narrowing-rate.test.js); their rendered controls are not
// specified here.

// --- the row that gives the facet back ------------------------------------------
// A shut popover has no rows at all, so the row is read from the OPEN one; the
// button's own "Any length" wording sits outside `rows()`.

test("test_the_length_popover_offers_a_row_that_clears_the_facet", async () => {
  await reset();
  assert.ok(rowLabels(open("length")).includes("Any length"));
});

// --- a row's count previews the click it would perform ----------------------------
//
// The chip beside a row says what the dropdowns would offer if that row were
// clicked, so on a row already picked it must answer for the selection WITHOUT
// it — clicking a picked value unpicks it. Focus at ["timbre"] leaves two of the
// three fixture filters (gauss-a, gauss-b); unpicking it leaves all three, so
// the two readings are different numbers and only the unpick preview is 3.

test("test_the_count_on_a_picked_facet_row_previews_unpicking_it", async () => {
  await reset({ filters: FOCUS_FILTERS, fields: chainFields(FOCUS_FILTERS) });
  nFocus.value = ["timbre"];
  assert.equal(nxCount(chip(open("focus"), "Timbre")), 3);
});

// --- the intro caption follows the setting-descriptions pref ----------------------
// The card's intro caption is a setting description, so it obeys the master
// "Setting descriptions" pref alone. The keep-option pref governs OPTION
// descriptions only, so the caption stays hidden under master OFF even in the
// keep-ON state where option descriptions still show.

const CAPTION = "Reduce the number of filters in the dropdowns below";

test("test_the_intro_caption_renders_while_the_descriptions_pref_is_on", async () => {
  await reset();
  showDescriptions.value = true;
  keepOptionDescriptions.value = false;
  assert.ok(render(html`<${NarrowBar} />`).includes(CAPTION));
});

test("test_the_intro_caption_is_absent_with_the_master_pref_off_even_with_keep_option_on", async () => {
  await reset();
  showDescriptions.value = false;
  keepOptionDescriptions.value = true;
  assert.equal(render(html`<${NarrowBar} />`).includes(CAPTION), false);
});
