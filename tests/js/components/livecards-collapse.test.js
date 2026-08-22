// Behavioral suite for the LIVE page's four non-chain cards becoming
// collapsible — "Narrow filters", "Playback", "Engine health" and "Matrix
// profile" (components/live/View.js): that each offers a head a pointer can
// press, that each starts open, that pressing one closes it and takes its body
// off the page, that pressing it again brings the body back, that one card's
// disclosure is its own, and that a poll bringing back identical engine state
// leaves a hand-toggled card alone.
//
// The chain cards (PCM/SDM) are livecollapse.test.js's and are not touched here.
//
// The Output tab's own "Narrow filters" card is the scope anchor: NarrowBar is
// shared between the two pages, so the last two cases pin that the Output tab's
// copy is NOT a disclosure — its head is no button and its body stands whatever
// the LIVE page's copy is doing.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. The page is driven by assigning the exported store signals the
// shapes /api/state, /api/enumerations, /api/config and /api/matrix actually
// serve; nothing of HQPTuner's is stubbed.
//
// There is no exported disclosure API and there is no DOM here, so a card is
// toggled the way a caller toggles one: by invoking the onClick its head element
// carries, collected through preact's own `options.vnode` hook — the renderer's
// public seam, third-party surface, not ours. State is read back off the card
// section's own class list and its rendered body, as the browser shows both.
//
// The Reset case models the one thing SSR cannot: bubbling. A pointer landing on
// the Reset button inside the head would reach the head button too, so the click
// below is replayed to the head unless the handler stops it — which is exactly
// the difference between a Reset that collapses the card and one that does not.
//
// Every "poll" carries state identical in CONTENT to what is displayed and
// FRESH in identity, which is what /api/state hands over on a quiet engine;
// writing the same object reference to a signal does not notify, and the
// notification is the whole point (docs/testing.md, harness facts).
//
// Disclosure is persisted through store/prefs.js: the storage cases here read
// the fake localStorage for what a TOGGLE writes, under the card's own key. What
// a stored value does at LOAD — and what an unusable storage does — is
// tests/js/store/livecollapse-prefs.test.js and
// tests/js/store/livecollapse-prefs-broken.test.js, which each need the module
// imported into an environment their own case has already staged.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/livecards-collapse.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { options } from "preact";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { LiveView } from "../../../hqptuner/static/components/live/View.js";
import { Output } from "../../../hqptuner/static/components/tabs/OutputTab.js";
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
import {
  liveMode,
  showDescriptions,
  keepOptionDescriptions,
  setLiveCardOpen,
} from "../../../hqptuner/static/store/prefs.js";
import { resetNarrowing, narrowingActive, nFocus } from "../../../hqptuner/static/store/narrow/state.js";
import { narrowOptions } from "../../../hqptuner/static/store/narrow/match.js";
import { staticWire } from "../support/wire.js";
import { attr, classes, elements } from "../support/markup.js";
import { useStorage, dropStorage } from "../support/storage.js";

/** @typedef {import("../support/wheel.js").VNode} VNode */
/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// --- the wire shapes ----------------------------------------------------------

// The engine's own `<GetFilters/>` enumeration (protocol.md:226): rated so no
// narrowing facet at its default trims the list, and carrying the facet prose
// the narrow bar builds its switch groups from. The two REAL filters carry
// different focus sets, so a focus pick demonstrably trims this fixture — which
// is what the Reset cases below need to be about anything
// (`test_the_focus_facet_trims_…`). `none` is the engine's no-filter entry and
// survives every narrowing, so it is not one of the two.
const FILTERS = [
  { index: "0", value: "0", name: "none", arg: 1, description: "5/5 timbre ⥮ Any" },
  { index: "1", value: "40", name: "poly-sinc-gauss-long", arg: 1, description: "5/5 transients ⥮ Any" },
  { index: "2", value: "25", name: "sinc-M", arg: 1, description: "5/5 timbre ⥮ Any" },
];

// The filter dropdown's options, as the page builds them from that enumeration:
// the pair `narrowOptions` filters, labeled by filter name.
const FILTER_OPTIONS = () => FILTERS.map((f) => ({ value: f.value, label: f.name }));
const ENUMS = () => ({
  filters: FILTERS,
  shapers: [{ index: "0", value: "0", name: "none" }],
  rates: [
    { index: "0", rate: "0" },
    { index: "1", rate: "96000" },
  ],
  junk_filters: [
    { index: "0", value: "0", name: "none" },
    { index: "1", value: "1", name: "iir-15khz" },
  ],
  mode: { name: "PCM" },
});

// settings.json's per-control prose, cut to a sentence each, plus the two
// name-keyed overlays a selection's description comes from.
const METADATA = () => ({
  settings: {
    output: {
      output_mode: { label: "Output mode", tooltip: "Selects default output mode." },
      rate: { label: "Output rate", tooltip: "Output sample rate request, or upper limit." },
      pcm_rate: { label: "PCM", tooltip: "PCM output target rate." },
      sdm_rate: { label: "SDM", tooltip: "SDM output target rate." },
      junk_filter: {
        label: "High-frequency filter",
        tooltip: "Playback filters for noise.",
        options: { 0: "No filtering.", 1: "A 15 kHz IIR filter." },
      },
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
});

const STATE = () => ({
  mode: "1",
  filter1x: "0",
  filterNx: "1",
  shaper: "0",
  rate: "1",
  filter_junk: "1",
  adaptive: "0",
  volume: "-10.0",
  active_chain: "pcm",
});

// A profile the engine has loaded, so the matrix card has something to show.
const MATRIX = () => ({
  fields: [],
  file_profiles: { Room: { rows: [], post: {} } },
  live_profiles: [],
});

const CONFIG = () => ({
  fields: [{ name: "upnp_freewheel", value: "0" }],
  file: { mode: "pcm" },
  active: "",
  profiles: null,
});

// --- rendering, clicking, reading ---------------------------------------------

// One render, with every vnode preact builds along the way. `options.vnode` is
// preact's own creation hook (the seam its devtools use); it is restored even if
// the render throws, so no case can poison the next.
function renderPage() {
  /** @type {VNode[]} */
  const seen = [];
  const previous = options.vnode;
  options.vnode = (/** @type {VNode} */ vnode) => {
    seen.push(vnode);
    if (previous) previous(vnode);
  };
  try {
    return { out: render(html`<${LiveView} />`), seen };
  } finally {
    options.vnode = previous;
  }
}

const page = () => renderPage().out;
const outputTab = () => render(html`<${Output} />`);

/**
 * What a vnode reads, children and all.
 *
 * @param {unknown} node
 * @returns {string}
 */
function vnodeText(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(vnodeText).join("");
  const props = /** @type {VNode} */ (node).props;
  return vnodeText(props && props.children);
}

// The card SECTION carrying an id, which is the element the disclosure state is
// rendered on. Anything other than exactly one match throws rather than
// measuring some other card. Cards are addressed by `data-card` and never by
// the words in their heads (docs/testing.md rule 9).
/**
 * @param {string} out
 * @param {string} id
 * @returns {MarkupElement}
 */
function cardOf(out, id) {
  const hits = elements(out).filter((el) => el.name === "section" && attr(el, "data-card") === id);
  if (hits.length !== 1) throw new Error(`expected one card identified "${id}", found ${hits.length}`);
  return hits[0];
}

// The head element of a card, whatever tag carries it.
/**
 * @param {string} out
 * @param {string} id
 * @returns {MarkupElement}
 */
function headOf(out, id) {
  const hits = elements(cardOf(out, id).html).filter((el) => classes(el).includes("card-head"));
  if (hits.length !== 1) throw new Error(`expected one head in the card identified "${id}", found ${hits.length}`);
  return hits[0];
}

/**
 * A card's disclosure, off its own section's class list: "open", "closed", or
 * "" for a section that says neither.
 *
 * @param {string} out
 * @param {string} id
 * @returns {string}
 */
function disclosure(out, id) {
  const marks = classes(cardOf(out, id)).filter((c) => c === "open" || c === "closed");
  return marks.length === 1 ? marks[0] : "";
}

/**
 * Whether a card renders a body at all: anything inside its section other than
 * the head itself.
 *
 * @param {string} out
 * @param {string} id
 * @returns {boolean}
 */
function hasBody(out, id) {
  const frag = cardOf(out, id).html;
  const inner = frag.slice(frag.indexOf(">") + 1, frag.lastIndexOf("<"));
  return inner.replace(headOf(out, id).html, "").trim() !== "";
}

/**
 * Every button vnode the page built that carries a click handler.
 *
 * @returns {VNode[]}
 */
const clickables = () =>
  renderPage().seen.filter((v) => v && v.type === "button" && v.props && typeof v.props.onClick === "function");

/**
 * The named card's head, as the button a pointer would land on.
 *
 * The ONE lookup in this file still made by wording: a head button's vnode
 * carries no identity of its own — `data-card` rides the section, which the
 * flat vnode list gives no way back to — so a press cannot yet be aimed at a
 * card by id. Every question ABOUT the rendered card is asked by id above.
 *
 * @param {string} title
 * @returns {VNode}
 */
function headButton(title) {
  const hits = clickables().filter((v) => vnodeText(v).includes(title));
  if (hits.length !== 1) throw new Error(`expected one clickable head for "${title}", found ${hits.length}`);
  return hits[0];
}

/**
 * One press on a card's head.
 *
 * @param {string} title
 * @returns {void}
 */
function clickHead(title) {
  const onClick = /** @type {(event: object) => void} */ (headButton(title).props.onClick);
  onClick({ preventDefault() {}, stopPropagation() {} });
}

// --- the poll -----------------------------------------------------------------

// One pass of the page's own polling loop: every signal it feeds gets a FRESH
// object, whether or not the daemon said anything new.
function poll() {
  health.value = { reachable: true, info: {} };
  engineState.value = STATE();
  engineStatus.value = null;
  enums.value = ENUMS();
  config.value = CONFIG();
  matrixConfig.value = MATRIX();
  volume.value = "-10.0";
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
  page(); // the browser re-renders on a signal change; SSR has to be told to
}

// Total reset of everything the page reads, disclosure included: the four cards
// are put back OPEN through the store's own setter, so a case asking about the
// default asserts the default rather than inheriting whatever its predecessor
// left behind (module-level signals outlive a test).
async function reset() {
  for (const card of CARDS) setLiveCardOpen(card.key, true);
  staticWire({ live: {}, http: {} });
  metadata.value = METADATA();
  liveErrors.value = {};
  liveBusy.value = "";
  liveMode.value = true;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  resetNarrowing();
  poll();
  await discardAll();
}

// Bring a card to the disclosure a case starts from, by pressing its head when
// what is on screen is not it — the only route a user has. A press that does not
// land is an error, not something to press harder at.
/**
 * @param {{ title: string, card: string }} card
 * @param {string} want
 * @returns {void}
 */
function ensure(card, want) {
  if (disclosure(page(), card.card) === want) return;
  clickHead(card.title);
  const now = disclosure(page(), card.card);
  if (now !== want) throw new Error(`"${card.card}" would not go ${want}: it is ${now}`);
}

// The four cards: the name the store's setter addresses each by, the id its
// section carries, and the title a press is aimed at (see `headButton`).
/** @type {{ title: string, card: string, key: "narrow" | "playback" | "health" | "matrix" }[]} */
const CARDS = [
  { title: "Narrow filters", card: "narrow-filters", key: "narrow" },
  { title: "Playback", card: "live-playback", key: "playback" },
  { title: "Engine health", card: "live-engine-health", key: "health" },
  { title: "Matrix profile", card: "matrix-profile", key: "matrix" },
];

/** @param {string} id */
const slug = (id) => id.replace(/\W+/g, "_");

// The two cards named on their own below.
const NARROW = CARDS[0];
const PLAYBACK = CARDS[1];

afterEach(dropStorage);

// --- every card offers a head to press ----------------------------------------

for (const { card } of CARDS) {
  test(`test_the_${slug(card)}_card_head_is_a_button`, async () => {
    await reset();
    assert.equal(headOf(page(), card).name, "button");
  });
}

// --- and starts open ----------------------------------------------------------

for (const { card } of CARDS) {
  test(`test_the_${slug(card)}_card_starts_open`, async () => {
    await reset();
    assert.equal(disclosure(page(), card), "open");
  });
}

// --- pressing a head closes the card, body and all ------------------------------
// The class and the body are separate promises: a card that carried `closed`
// while still rendering its body would pass the first and fail the second.

for (const entry of CARDS) {
  test(`test_pressing_the_${slug(entry.card)}_head_closes_the_card`, async () => {
    await reset();
    ensure(entry, "open");
    clickHead(entry.title);
    assert.equal(disclosure(page(), entry.card), "closed");
  });
}

for (const entry of CARDS) {
  test(`test_a_closed_${slug(entry.card)}_card_renders_no_body`, async () => {
    await reset();
    ensure(entry, "closed");
    assert.equal(hasBody(page(), entry.card), false);
  });
}

// --- pressing it again brings the body back --------------------------------------

for (const entry of CARDS) {
  test(`test_pressing_the_${slug(entry.card)}_head_again_reopens_the_card`, async () => {
    await reset();
    ensure(entry, "closed");
    clickHead(entry.title);
    assert.equal(disclosure(page(), entry.card), "open");
  });
}

for (const entry of CARDS) {
  test(`test_a_reopened_${slug(entry.card)}_card_renders_its_body`, async () => {
    await reset();
    ensure(entry, "closed");
    clickHead(entry.title);
    assert.equal(hasBody(page(), entry.card), true);
  });
}

// --- one card's disclosure is its own ---------------------------------------------

for (const entry of CARDS) {
  test(`test_closing_the_${slug(entry.card)}_card_leaves_the_other_three_open`, async () => {
    await reset();
    for (const other of CARDS) ensure(other, "open");
    clickHead(entry.title);
    const out = page();
    const others = CARDS.filter((c) => c.card !== entry.card);
    assert.deepEqual(
      others.map((c) => disclosure(out, c.card)),
      others.map(() => "open"),
    );
  });
}

// --- a poll that changes nothing leaves the user's card alone ----------------------
// The defect class livecollapse.test.js pins for the chain cards: the page
// re-fetches twice a second, and a poll bringing back the SAME engine state must
// not snap a hand-toggled card back.

for (const entry of CARDS) {
  test(`test_a_hand_closed_${slug(entry.card)}_card_survives_a_poll_of_unchanged_state`, async () => {
    await reset();
    ensure(entry, "closed");
    poll();
    poll();
    assert.equal(disclosure(page(), entry.card), "closed");
  });
}

// --- the narrowing Reset is not a toggle ------------------------------------------
// Reset sits INSIDE the head, so a pointer press on it reaches the head button
// too unless the handler stops the event. `pressReset` replays the press the way
// the DOM would, and the two cases below ask what a user sees afterwards: the
// narrowing gone, and the card still open.

/**
 * One press on the narrowing Reset, replayed to the head it sits in unless the
 * press is stopped there.
 *
 * @returns {void}
 */
function pressReset() {
  const hits = clickables().filter((v) => String(v.props.class || v.props.className || "").includes("narrow-reset"));
  if (hits.length !== 1) throw new Error(`expected one narrowing Reset, found ${hits.length}`);
  let stopped = false;
  const event = {
    preventDefault() {},
    stopPropagation() {
      stopped = true;
    },
  };
  /** @type {(event: object) => void} */ (hits[0].props.onClick)(event);
  if (!stopped) /** @type {(event: object) => void} */ (headButton("Narrow filters").props.onClick)(event);
}

// The narrowed starting point the two Reset cases press from: one focus pick,
// which the fixture above demonstrably trims on (the case below). A press with
// nothing narrowed would clear nothing and pass for free, so the precondition is
// checked here and raises rather than being pressed through.
/** @returns {void} */
function narrowTheFilters() {
  nFocus.value = ["transients"];
  if (!narrowingActive.value) throw new Error("the focus pick left the page unnarrowed");
}

test("test_the_focus_facet_trims_the_pages_filter_list", async () => {
  await reset();
  nFocus.value = ["transients"];
  assert.deepEqual(
    narrowOptions(FILTER_OPTIONS(), "nx", "pcm_filter_nx").map((o) => o.label),
    ["none", "poly-sinc-gauss-long"],
  );
});

test("test_the_narrowing_reset_clears_the_narrowing", async () => {
  await reset();
  narrowTheFilters();
  ensure(NARROW, "open");
  pressReset();
  assert.equal(narrowingActive.value, false);
});

test("test_the_narrowing_reset_leaves_its_card_open", async () => {
  await reset();
  narrowTheFilters();
  ensure(NARROW, "open");
  pressReset();
  assert.equal(disclosure(page(), NARROW.card), "open");
});

// --- what a toggle writes to storage ------------------------------------------------
// Each card is persisted under its OWN key (store/prefs.js), so a shared key or a
// collision fails these rather than passing on "something was written".

const KEY = "hqptuner.liveCollapse.playback";

test("test_closing_a_card_persists_a_zero_under_its_own_key", async () => {
  await reset();
  ensure(PLAYBACK, "open");
  const storage = useStorage();
  clickHead(PLAYBACK.title);
  assert.equal(storage.getItem(KEY), "0");
});

test("test_reopening_a_card_persists_a_one_under_its_own_key", async () => {
  await reset();
  ensure(PLAYBACK, "closed");
  const storage = useStorage();
  clickHead(PLAYBACK.title);
  assert.equal(storage.getItem(KEY), "1");
});

test("test_toggling_one_card_writes_no_other_cards_key", async () => {
  await reset();
  ensure(PLAYBACK, "open");
  const storage = useStorage();
  clickHead(PLAYBACK.title);
  assert.deepEqual([...storage.map.keys()], [KEY]);
});

// --- the Output tab's copy is no disclosure -------------------------------------------
// NarrowBar is shared, so these three say the change is the LIVE page's alone.
// The LIVE copy is CLOSED throughout: a bar wired to the LIVE disclosure signal
// would take the Output tab's body down with it, which is the defect the body
// case exists to catch and which an open LIVE card would hide.

async function outputReset() {
  await reset();
  ensure(NARROW, "closed");
}

// Every vnode the Output tab builds for its own narrowing head.
/** @returns {VNode[]} */
function outputHeads() {
  /** @type {VNode[]} */
  const seen = [];
  const previous = options.vnode;
  options.vnode = (/** @type {VNode} */ vnode) => {
    seen.push(vnode);
    if (previous) previous(vnode);
  };
  try {
    render(html`<${Output} />`);
  } finally {
    options.vnode = previous;
  }
  const hits = seen.filter(
    (v) =>
      typeof v.type === "string" &&
      String(v.props.class || v.props.className || "").includes("card-head") &&
      vnodeText(v).startsWith("Narrow filters"),
  );
  if (hits.length !== 1) throw new Error(`expected one Output narrowing head, found ${hits.length}`);
  return hits;
}

test("test_the_output_tabs_narrow_filters_head_is_no_button", async () => {
  await outputReset();
  assert.notEqual(headOf(outputTab(), NARROW.card).name, "button");
});

// The tag alone is not the promise: a `<div>` head carrying a toggle handler is
// a disclosure a pointer can work, whatever it is built from.
test("test_the_output_tabs_narrow_filters_head_takes_no_press", async () => {
  await outputReset();
  assert.equal(typeof outputHeads()[0].props.onClick, "undefined");
});

test("test_the_output_tabs_narrow_filters_card_renders_its_body", async () => {
  await outputReset();
  assert.equal(hasBody(outputTab(), NARROW.card), true);
});
