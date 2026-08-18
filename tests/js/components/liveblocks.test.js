// Behavioral suite for the LIVE page's movable blocks — the order
// components/live/Layout.js's `LiveBlocks` stacks them in, and what layout-edit
// mode does to each one.
//
// The page renders six blocks top to bottom. The first, LIVE MODE, is locked in
// place; the other five ("hero", "health", "chains", "playback", "matrix") are
// the user's to reorder, and their order lives in store/prefs.js's `liveOrder`.
// The gesture that reorders them is a pointer drag, which SSR never fires and
// which is therefore not reachable here (docs/testing.md, "branches that cannot
// be reached"): what IS observable is the rendered stack for a given store
// state, which is what every case below asks about. The drag itself belongs to
// the playwright hand-back protocol.
//
// A block is identified by what a reader finds inside it, never by position or
// by an index the component hands out: the card it heads ("LIVE MODE", "Rate",
// "Engine health", "Playback", "Matrix profile") or, for the chain group, the
// group element the contract names. A block matching no anchor, or more than
// one, raises rather than being silently mislabelled — a stack measured against
// the wrong names would agree with any order at all.
//
// Policy (docs/testing.md): public API only, one assertion per test, signals
// assigned at their exported surface. Storage is NOT installed in this file:
// these cases are about what renders, and persistence is store/liveorder.test.js.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/liveblocks.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { LiveView } from "../../../hqptuner/static/components/live/View.js";
import { liveEditing } from "../../../hqptuner/static/components/live/Layout.js";
import {
  health,
  engineState,
  engineStatus,
  enums,
  config,
  matrixConfig,
  metadata,
  volume,
  volumeRange,
} from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { liveErrors, liveBusy } from "../../../hqptuner/static/store/live/state.js";
import { liveMode, setLiveOrder, LIVE_BLOCK_ORDER } from "../../../hqptuner/static/store/prefs.js";
import { staticWire } from "../support/wire.js";
import { classes, elements, hasAttr, text } from "../support/markup.js";

const ENUMS = {
  filters: [
    { index: "0", value: "0", name: "none" },
    { index: "1", value: "40", name: "poly-sinc-gauss-long" },
  ],
  shapers: [{ index: "0", value: "0", name: "none" }],
  rates: [
    { index: "0", rate: "0" },
    { index: "1", rate: "96000" },
  ],
  junk_filters: [{ index: "0", value: "0", name: "none" }],
  mode: { name: "PCM" },
};

const METADATA = {
  settings: {
    output: {
      output_mode: { label: "Output mode", tooltip: "Selects default output mode." },
      rate: { label: "Output rate", tooltip: "Output sample rate request, or upper limit." },
      pcm_rate: { label: "PCM", tooltip: "PCM output target rate." },
      sdm_rate: { label: "SDM", tooltip: "SDM output target rate." },
      junk_filter: { label: "High-frequency filter", tooltip: "Playback filters for noise.", options: { 0: "None." } },
    },
    dsp: {
      filter_1x: { label: "1x filter", tooltip: "Oversampling filter for base-rate sources." },
      filter_nx: { label: "Nx filter", tooltip: "Oversampling filter above the base rates." },
      shaper: { label: "Dither", tooltip: "Noise shaping applied at the output word length." },
    },
    volume: { adaptive_volume: { label: "Adaptive volume", tooltip: "Applies the source's ReplayGain 2.0 offset." } },
  },
  filters: { filters: { "poly-sinc-gauss-long": { description: "Gaussian apodizing, very long." } }, aliases: {} },
  shapers: { pcm_dithers: { none: { description: "No dither." } }, sdm_modulators: {} },
};

const STATE = {
  mode: "1",
  filter1x: "0",
  filterNx: "1",
  shaper: "0",
  rate: "1",
  filter_junk: "0",
  adaptive: "0",
  volume: "-10.0",
  active_chain: "pcm",
};

// Total reset: module-level signals outlive a test, so a partial one makes cases
// pass alone and fail in sequence. `staged` is private — it is mirrored from
// whatever the faked /api/config/pending answers, via discardAll().
async function reset() {
  staticWire({ live: {}, http: {} });
  health.value = { reachable: true, info: {} };
  engineState.value = { ...STATE };
  engineStatus.value = null;
  enums.value = ENUMS;
  metadata.value = METADATA;
  volume.value = "-10.0";
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
  config.value = { fields: [{ name: "upnp_freewheel", value: "0" }], file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: [] };
  liveErrors.value = {};
  liveBusy.value = "";
  liveMode.value = false;
  liveEditing.value = false;
  setLiveOrder([...LIVE_BLOCK_ORDER]);
  await discardAll();
}

const page = () => render(html`<${LiveView} />`);

const LOCKED = "LIVE MODE";

// The name a block goes by here, over the anchor a reader finds inside it. The
// keys are the store's own block keys, so a stack read off the page is directly
// comparable with the order the store was given.
/** @type {{ key: string, head?: string, group?: string }[]} */
const ANCHORS = [
  { key: LOCKED, head: "LIVE MODE" },
  { key: "hero", head: "Rate" },
  { key: "health", head: "Engine health" },
  { key: "chains", group: "live-chain-group" },
  { key: "playback", head: "Playback" },
  { key: "matrix", head: "Matrix profile" },
];

const CHAIN_CARDS = ["Narrow filters", "PCM Chain", "SDM Chain"];

/** @param {string} out @returns {import("../support/markup.js").MarkupElement[]} */
const inOrder = (out) => elements(out).sort((a, b) => a.start - b.start);

// A control a head may carry beside its title. Whole subtrees, so the label
// inside one never reaches the title.
const CONTROL_TAGS = new Set(["a", "button", "input", "select", "textarea"]);

// A card head's title: the head's own words, with the disclosure triangle a
// collapsible head carries stripped and any control the head carries beside the
// title removed. The title is the contract; the triangle and the controls are
// the card's own business. Removal is by whole element, never by trimming the
// title's own text, so a head titled "LIVE MODE PRO" still reads as "LIVE MODE
// PRO" and a renamed head still reads as its new name.
/** @param {import("../support/markup.js").MarkupElement} el */
const title = (el) => {
  const bare = elements(el.html)
    .filter((e) => CONTROL_TAGS.has(e.name) && !(e.start === 0 && e.html.length === el.html.length))
    .reduce((markup, e) => markup.replace(e.html, " "), el.html);
  return text({ ...el, html: bare }).replace(/^[^A-Za-z]+/, "");
};

/** @param {string} fragment @returns {string[]} */
const headsIn = (fragment) =>
  inOrder(fragment)
    .filter((el) => classes(el).includes("card-head"))
    .map(title);

/** @param {string} fragment @param {string} token @returns {boolean} */
const carries = (fragment, token) => inOrder(fragment).some((el) => classes(el).includes(token));

/** @param {import("../support/markup.js").MarkupElement} block @returns {string} */
function nameOf(block) {
  const hits = ANCHORS.filter((a) =>
    a.group ? carries(block.html, a.group) : headsIn(block.html).includes(/** @type {string} */ (a.head)),
  );
  if (hits.length !== 1) {
    throw new Error(`a live-block matched ${hits.length} anchors (${hits.map((h) => h.key).join(", ") || "none"})`);
  }
  return hits[0].key;
}

/** @param {string} out @returns {import("../support/markup.js").MarkupElement[]} */
const blocks = (out) => inOrder(out).filter((el) => classes(el).includes("live-block"));

/** The page's blocks top to bottom, by the name each one announces itself as. */
/** @param {string} out @returns {string[]} */
const stack = (out) => blocks(out).map(nameOf);

/** The blocks the user may move: every block but the locked one. */
/** @param {string} out */
const movable = (out) => blocks(out).filter((el) => nameOf(el) !== LOCKED);

/** @param {string} out */
const lockedBlock = (out) => {
  const hit = blocks(out).find((el) => nameOf(el) === LOCKED);
  if (!hit) throw new Error("no LIVE MODE block in the rendered page");
  return hit;
};

/** @param {string} out */
function chainGroup(out) {
  const hit = inOrder(out).find((el) => classes(el).includes("live-chain-group"));
  if (!hit) throw new Error("no live-chain-group in the rendered page");
  return hit;
}

// --- the order the blocks stack in ------------------------------------------------

test("test_a_browser_with_no_stored_order_stacks_the_blocks_in_the_default_order", async () => {
  await reset();
  assert.deepEqual(stack(page()), [LOCKED, "hero", "health", "chains", "playback", "matrix"]);
});

test("test_a_stored_order_stacks_the_movable_blocks_in_that_order", async () => {
  await reset();
  setLiveOrder(["matrix", "playback", "chains", "health", "hero"]);
  assert.deepEqual(stack(page()), [LOCKED, "matrix", "playback", "chains", "health", "hero"]);
});

test("test_live_mode_stands_first_even_when_the_stored_order_names_it", async () => {
  await reset();
  setLiveOrder(["locked", "matrix", "hero", "health", "chains", "playback"]);
  assert.equal(stack(page())[0], LOCKED);
});

test("test_a_stored_order_carrying_an_unknown_key_stacks_the_known_blocks_alone", async () => {
  await reset();
  setLiveOrder(["zznosuchblock", "matrix", "hero", "health", "chains", "playback"]);
  assert.deepEqual(stack(page()), [LOCKED, "matrix", "hero", "health", "chains", "playback"]);
});

test("test_a_stored_order_missing_a_key_still_stacks_that_block_after_the_stored_ones", async () => {
  await reset();
  setLiveOrder(["matrix", "hero"]);
  assert.deepEqual(stack(page()), [LOCKED, "matrix", "hero", "health", "chains", "playback"]);
});

// --- what the chain block encloses ------------------------------------------------

test("test_the_chain_group_encloses_the_narrow_filters_and_both_chain_cards", async () => {
  await reset();
  const inside = headsIn(chainGroup(page()).html);
  assert.deepEqual(
    CHAIN_CARDS.filter((name) => !inside.includes(name)),
    [],
  );
});

// --- layout-edit mode -------------------------------------------------------------

test("test_no_block_is_marked_editing_with_layout_edit_off", async () => {
  await reset();
  const out = page();
  assert.deepEqual(
    blocks(out)
      .filter((el) => classes(el).includes("editing"))
      .map(nameOf),
    [],
  );
});

test("test_every_movable_block_is_marked_editing_with_layout_edit_on", async () => {
  await reset();
  liveEditing.value = true;
  const out = page();
  assert.deepEqual(
    movable(out)
      .filter((el) => !classes(el).includes("editing"))
      .map(nameOf),
    [],
  );
});

test("test_the_live_mode_block_is_not_marked_editing_with_layout_edit_on", async () => {
  await reset();
  liveEditing.value = true;
  assert.equal(classes(lockedBlock(page())).includes("editing"), false);
});

test("test_every_movable_block_is_inert_with_layout_edit_on", async () => {
  await reset();
  liveEditing.value = true;
  const out = page();
  assert.deepEqual(
    movable(out)
      .filter((el) => !hasAttr(el, "inert"))
      .map(nameOf),
    [],
  );
});
