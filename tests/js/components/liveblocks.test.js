// Behavioral suite for the LIVE page's movable blocks — the order
// components/live/Layout.js's `LiveBlocks` stacks them in, and what layout-edit
// mode does to each one.
//
// The page renders five blocks top to bottom. The first, LIVE MODE, is locked in
// place; the other four ("health", "chains", "playback", "matrix") are
// the user's to reorder, and their order lives in store/prefs.js's `liveOrder`.
// The gesture that reorders them is a pointer drag. The POINTER half of it —
// pointerdown, the moves, the release — is not reachable here: SSR never fires
// an event handler (docs/testing.md, "branches that cannot be reached"), and it
// belongs to the playwright hand-back protocol. What IS reachable is the drag's
// own public surface, `setDrag` / `endDrag` and the two pure functions the
// handlers do their arithmetic with, plus the rendered page for a given drag
// state: where the drop indicator lands, which block is marked as being dragged,
// and that the stack does NOT move until the drop.
//
// A block is identified by the machine identity of what it encloses, never by
// position, by an index the component hands out, or by the words in a head
// (docs/testing.md rule 9): the `data-card` of the card inside it, or, for the
// chain group, the group element the contract names. A block matching no anchor, or more than
// one, raises rather than being silently mislabeled — a stack measured against
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
import {
  setLiveEditing,
  dragKey,
  dropAt,
  setDrag,
  endDrag,
  dropIndex,
  reorder,
} from "../../../hqptuner/static/components/live/Layout.js";
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
import { classes, elements, hasAttr } from "../support/markup.js";

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
// `order: false` leaves the block order alone, for the one case that asks what a
// browser with nothing stored stacks: touching `setLiveOrder` there would answer
// the question with the answer. That case is declared FIRST in this file for the
// same reason — module state outlives a test, so once any case has set an order
// the untouched-load state is gone for good.
/** @param {{ order?: boolean }} [opts] */
async function reset({ order = true } = {}) {
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
  setLiveEditing(false);
  dragKey.value = null;
  dropAt.value = null;
  if (order) setLiveOrder([...LIVE_BLOCK_ORDER]);
  await discardAll();
}

const page = () => render(html`<${LiveView} />`);

// The block that cannot be moved. An internal name for it, not a rendered one.
const LOCKED = "locked";

// The four blocks the user may move, in the order a browser with nothing stored
// stacks them. Spelled out rather than read from `LIVE_BLOCK_ORDER`, so the
// default is pinned here instead of being re-asserted from the store's own copy.
const MOVABLE = ["health", "chains", "playback", "matrix"];

// The name a block goes by here, over the anchor a reader finds inside it — the
// id of a card it encloses, or the class of the group it is (docs/testing.md
// rule 9: never the words in a head). The keys are the store's own block keys,
// so a stack read off the page is directly comparable with the order the store
// was given.
/** @type {{ key: string, card?: string, group?: string }[]} */
const ANCHORS = [
  { key: LOCKED, card: "live-mode" },
  { key: "health", card: "live-engine-health" },
  { key: "chains", group: "live-chain-group" },
  { key: "playback", card: "live-playback" },
  { key: "matrix", card: "matrix-profile" },
];

const CHAIN_CARDS = ["narrow-filters", "live-pcm-chain", "live-sdm-chain"];

/** @param {string} out @returns {import("../support/markup.js").MarkupElement[]} */
const inOrder = (out) => elements(out).sort((a, b) => a.start - b.start);

// The ids of the cards a fragment encloses, in document order.
/** @param {string} fragment @returns {string[]} */
const cardsIn = (fragment) => [...fragment.matchAll(/<section[^<>]*\sdata-card="([^"]*)"/g)].map((m) => m[1]);

/** @param {string} fragment @param {string} token @returns {boolean} */
const carries = (fragment, token) => inOrder(fragment).some((el) => classes(el).includes(token));

/** @param {import("../support/markup.js").MarkupElement} block @returns {string} */
function nameOf(block) {
  const hits = ANCHORS.filter((a) =>
    a.group ? carries(block.html, a.group) : cardsIn(block.html).includes(/** @type {string} */ (a.card)),
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

// FIRST, and the only case that does not set an order: this file installs no
// storage, so the module's load-time state IS the no-stored-order state, and it
// survives only until something writes it.
test("test_a_browser_with_no_stored_order_stacks_the_blocks_in_the_default_order", async () => {
  await reset({ order: false });
  assert.deepEqual(stack(page()), [LOCKED, ...MOVABLE]);
});

test("test_a_stored_order_stacks_the_movable_blocks_in_that_order", async () => {
  await reset();
  setLiveOrder(["matrix", "playback", "chains", "health"]);
  assert.deepEqual(stack(page()), [LOCKED, "matrix", "playback", "chains", "health"]);
});

// Against the default order reversed, so the stored order is as hostile to LIVE
// MODE standing first as a stored order can be.
test("test_live_mode_stands_first_whatever_the_stored_order", async () => {
  await reset();
  setLiveOrder([...MOVABLE].reverse());
  assert.equal(stack(page())[0], LOCKED);
});

test("test_a_stored_order_carrying_an_unknown_key_stacks_the_known_blocks_alone", async () => {
  await reset();
  setLiveOrder(["zznosuchblock", "matrix", "health", "chains", "playback"]);
  assert.deepEqual(stack(page()), [LOCKED, "matrix", "health", "chains", "playback"]);
});

test("test_a_stored_order_missing_a_key_still_stacks_that_block_after_the_stored_ones", async () => {
  await reset();
  setLiveOrder(["matrix"]);
  assert.deepEqual(stack(page()), [LOCKED, "matrix", "health", "chains", "playback"]);
});

// --- what the chain block encloses ------------------------------------------------

test("test_the_chain_group_encloses_the_narrow_filters_and_both_chain_cards", async () => {
  await reset();
  const inside = cardsIn(chainGroup(page()).html);
  assert.deepEqual(
    CHAIN_CARDS.filter((id) => !inside.includes(id)),
    [],
  );
});

// --- layout-edit mode -------------------------------------------------------------

// "No block carries the mark" is stated as one explicit `false` per block, not
// as an empty filtered list: a page that rendered no blocks at all would answer
// an empty list too, and would pass a question it never faced.
const UNMARKED_BLOCKS = [LOCKED, ...MOVABLE].map(() => false);
const UNMARKED_MOVABLE = MOVABLE.map(() => false);

test("test_no_block_is_marked_editing_with_layout_edit_off", async () => {
  await reset();
  const out = page();
  assert.deepEqual(
    blocks(out).map((el) => classes(el).includes("editing")),
    UNMARKED_BLOCKS,
  );
});

// Stated positively — "the marked ones are ALL FOUR of them" — so a page that
// rendered no movable blocks at all fails here instead of passing on an empty
// list. Edit mode is entered through `setLiveEditing`, the verb the button
// calls, so a `setLiveEditing` that never turns edit mode on is red here.
test("test_every_movable_block_is_marked_editing_with_layout_edit_on", async () => {
  await reset();
  setLiveEditing(true);
  const out = page();
  assert.deepEqual(
    movable(out)
      .filter((el) => classes(el).includes("editing"))
      .map(nameOf),
    MOVABLE,
  );
});

test("test_the_live_mode_block_is_not_marked_editing_with_layout_edit_on", async () => {
  await reset();
  setLiveEditing(true);
  assert.equal(classes(lockedBlock(page())).includes("editing"), false);
});

test("test_every_movable_block_is_inert_with_layout_edit_on", async () => {
  await reset();
  setLiveEditing(true);
  const out = page();
  assert.deepEqual(
    movable(out)
      .filter((el) => hasAttr(el, "inert"))
      .map(nameOf),
    MOVABLE,
  );
});

// The mirror of the case above, and the one that says `inert` is the EDIT
// MODE's doing: a page that inerted the movable blocks unconditionally would
// leave every LIVE block permanently untouchable and satisfy the case above.
test("test_no_movable_block_is_inert_with_layout_edit_off", async () => {
  await reset();
  const out = page();
  assert.deepEqual(
    movable(out).map((el) => hasAttr(el, "inert")),
    UNMARKED_MOVABLE,
  );
});

// LIVE MODE is the one block edit mode does not take away: inerting it would
// freeze the LIVE mode toggle itself for as long as the user has the layout
// open.
test("test_the_live_mode_block_is_not_inert_with_layout_edit_on", async () => {
  await reset();
  setLiveEditing(true);
  assert.equal(hasAttr(lockedBlock(page()), "inert"), false);
});

// --- dragging a block: where it would land ----------------------------------------
// The pointer half is out of reach (see the header); the arithmetic it does is
// not. `dropIndex` turns a pointer Y into a target index against the OTHER
// blocks' midpoints, and `reorder` turns that index into the new order. Both are
// pure, so they are asked directly.

// Three blocks' midpoints, 100 apart: any Y below reads unambiguously as "above
// all of them", any Y above as "below all of them".
const MIDS = [100, 200, 300];

test("test_a_pointer_above_every_block_drops_at_the_top", () => {
  assert.equal(dropIndex(MIDS, 40), 0);
});

test("test_a_pointer_drops_after_the_blocks_whose_midpoints_it_has_passed", () => {
  assert.equal(dropIndex(MIDS, 250), 2);
});

test("test_a_pointer_below_every_block_drops_at_the_end", () => {
  assert.equal(dropIndex(MIDS, 900), 3);
});

test("test_a_pointer_over_a_page_with_no_other_blocks_drops_at_the_top", () => {
  assert.equal(dropIndex([], 900), 0);
});

test("test_reorder_moves_a_block_further_down_the_list", () => {
  assert.deepEqual(reorder([...MOVABLE], "health", 2), ["chains", "playback", "health", "matrix"]);
});

test("test_reorder_moves_a_block_further_up_the_list", () => {
  assert.deepEqual(reorder([...MOVABLE], "matrix", 1), ["health", "matrix", "chains", "playback"]);
});

test("test_reorder_onto_a_blocks_own_place_leaves_the_order_alone", () => {
  assert.deepEqual(reorder([...MOVABLE], "chains", 1), MOVABLE);
});

test("test_reorder_of_a_block_the_order_does_not_carry_leaves_the_order_alone", () => {
  assert.deepEqual(reorder([...MOVABLE], "zznosuchblock", 1), MOVABLE);
});

test("test_reorder_at_the_end_of_the_shortened_list_puts_the_block_last", () => {
  assert.deepEqual(reorder([...MOVABLE], "health", 3), ["chains", "playback", "matrix", "health"]);
});

// --- dragging a block: what the page shows -----------------------------------------
// The layout is frozen for the duration: the pointer only picks a target, an
// indicator marks it, and the order is applied on release. So the questions here
// are how many indicators there are, where the one is, which block is marked as
// being dragged, and what the stack does — which is nothing, until the drop.

const LINE = "live-drop-line";

/** @param {string} out */
const dropLines = (out) => inOrder(out).filter((el) => classes(el).includes(LINE));

// The blocks top to bottom with the drop indicator standing where it renders
// among them, so "immediately before the third block" is one readable sequence
// rather than a pair of indices.
const MARK = "<drop indicator>";
/** @param {string} out @returns {string[]} */
const withDropLine = (out) =>
  inOrder(out)
    .filter((el) => classes(el).includes("live-block") || classes(el).includes(LINE))
    .map((el) => (classes(el).includes(LINE) ? MARK : nameOf(el)));

// Stated as the whole stack with no indicator standing anywhere in it, rather
// than as an empty list of indicators: a page rendering no blocks at all shows
// no indicator either, and would pass the emptier question.
test("test_with_no_drag_in_progress_the_page_shows_no_drop_indicator", async () => {
  await reset();
  setLiveEditing(true);
  assert.deepEqual(withDropLine(page()), [LOCKED, ...MOVABLE]);
});

test("test_a_drag_in_progress_shows_exactly_one_drop_indicator", async () => {
  await reset();
  setLiveEditing(true);
  setDrag("chains", 2);
  assert.equal(dropLines(page()).length, 1);
});

// The LAST block is the one dragged, so the target index counts the same blocks
// whether or not the dragged one is counted: index 1 is before "chains" either
// way, and the case pins the placement rather than the counting convention.
test("test_the_drop_indicator_stands_immediately_before_the_block_at_the_target", async () => {
  await reset();
  setLiveEditing(true);
  setDrag("matrix", 1);
  assert.deepEqual(withDropLine(page()), [LOCKED, "health", MARK, "chains", "playback", "matrix"]);
});

// Three is the length of the list with the dragged block lifted out of it: the
// end.
test("test_a_drag_targeting_the_end_stands_the_drop_indicator_after_the_last_block", async () => {
  await reset();
  setLiveEditing(true);
  setDrag("health", 3);
  assert.deepEqual(withDropLine(page()), [LOCKED, ...MOVABLE, MARK]);
});

test("test_the_block_being_dragged_is_the_one_marked_as_dragging", async () => {
  await reset();
  setLiveEditing(true);
  setDrag("chains", 0);
  assert.deepEqual(
    blocks(page())
      .filter((el) => classes(el).includes("dragging"))
      .map(nameOf),
    ["chains"],
  );
});

test("test_the_blocks_keep_their_stored_order_while_a_drag_is_in_progress", async () => {
  await reset();
  setLiveOrder(["matrix", "playback", "chains", "health"]);
  setLiveEditing(true);
  setDrag("matrix", 3);
  assert.deepEqual(stack(page()), [LOCKED, "matrix", "playback", "chains", "health"]);
});

test("test_ending_a_drag_stacks_the_dragged_block_at_the_target", async () => {
  await reset();
  setLiveEditing(true);
  setDrag("health", 2);
  endDrag();
  assert.deepEqual(stack(page()), [LOCKED, "chains", "playback", "health", "matrix"]);
});

test("test_ending_a_drag_takes_the_drop_indicator_away", async () => {
  await reset();
  setLiveEditing(true);
  setDrag("health", 2);
  endDrag();
  assert.deepEqual(dropLines(page()), []);
});

// The block that was lifted is put back down: a block still marked `dragging`
// after the drop stays visibly lifted and faded for good.
test("test_ending_a_drag_leaves_no_block_marked_as_dragging", async () => {
  await reset();
  setLiveEditing(true);
  setDrag("health", 2);
  endDrag();
  assert.deepEqual(
    blocks(page()).map((el) => classes(el).includes("dragging")),
    UNMARKED_BLOCKS,
  );
});
