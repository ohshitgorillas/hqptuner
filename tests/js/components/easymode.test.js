// Behavioral suite for the Easy Mode shell: which cards each page draws while
// the flag is down and while it is up (components/tabs/OutputTab.js,
// components/live/View.js), what the Easy Mode card itself renders
// (components/easy/EasyCard.js), where the Narrow Filters card's Reset button
// and Easy Mode link stand (components/narrowbar/Bar.js), and the notice reader
// the card's subtitle comes through (store/prose.js's `easyProse`).
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Every case drives the exported store signals with the shapes
// /api/state, /api/enumerations, /api/config and /api/metadata actually serve,
// over a faked wire on the real REST paths. Nothing of HQPTuner's is stubbed.
//
// NAMES, NOT WORDS (rule 9). Every card is found by the `data-card` its section
// carries, every switcher option by its `data-v`, the Reset button by its
// `narrow-reset` class, and the two links and the notice by `data-testid` /
// `data-note` markings the components carry for the purpose. The link captions,
// the card title and the notice sentence are owner copy and are asserted
// nowhere; the notice seeded below is this file's own stand-in text, chosen so
// that a case can tell "the card read the metadata" from "the card printed
// something", and it is never compared against what ships.
//
// HOOKS THIS SUITE REQUIRES the implementation to provide:
//   * `data-testid="easy-enter"` on the Narrow Filters card's Easy Mode link
//   * `data-testid="easy-exit"` on the Easy Mode card's exit link
//   * `data-note="easy-notice"` on the card's notice/subtitle element
//   * `data-grid` on the single grid container (already in the spec)
// Head and body are read as the `card-head` / `card-body` elements, which is
// what "in the head" and "in the body" mean structurally.
//
// CLICKS. preact-render-to-string never fires a handler and there is no DOM
// here, so the two links are pressed the way tests/js/support/carddisclosure.js
// presses a card head: by invoking the onClick the link's vnode carries,
// collected through preact's own `options.vnode` creation hook — the renderer's
// public seam, third-party surface. No signal of HQPTuner's is stubbed and none
// is reached that a caller could not reach.
//
// NOT COVERED HERE: pressing a switcher option. The spec states what the
// switcher MARKS for a given grid and that `setEasyGrid` moves it, but not which
// element the grid change hangs off, so there is no stated contract to press.
// The store half is tests/js/store/easyview.test.js; the pointer half belongs to
// the playwright hand-back protocol.
//
// A working fake localStorage stands for the whole file: the links' handlers
// persist through it, and this process has none at all. It is installed EMPTY
// and before any import, so every module that reads a key at load sees exactly
// what it sees with no storage — its defaults. What happens when storage is
// missing or refuses is tests/js/store/easyview.test.js's.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easymode.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { options } from "preact";
import { render } from "preact-render-to-string";

import { useStorage } from "../support/storage.js";

useStorage();

const { html } = await import("../../../hqptuner/static/lib/dom.js");
const { Output } = await import("../../../hqptuner/static/components/tabs/OutputTab.js");
const { LiveView } = await import("../../../hqptuner/static/components/live/View.js");
const { EasyCard } = await import("../../../hqptuner/static/components/easy/EasyCard.js");
const { NarrowBar } = await import("../../../hqptuner/static/components/narrowbar/Bar.js");
const { easyMode, easyGrid } = await import("../../../hqptuner/static/store/easyview.js");
const { easyProse } = await import("../../../hqptuner/static/store/prose.js");
const signals = await import("../../../hqptuner/static/store/signals.js");
const { discardAll } = await import("../../../hqptuner/static/store/actions.js");
const { liveMode, showDescriptions, keepOptionDescriptions } = await import("../../../hqptuner/static/store/prefs.js");
const narrow = await import("../../../hqptuner/static/store/narrow/state.js");
const { stagingWire, staticWire } = await import("../support/wire.js");
const { elements, classes, attr } = await import("../support/markup.js");
const { cardHeadAt, section, formFields } = await import("../support/tabform.js");
const { resets } = await import("../support/narrowbarview.js");

/** @typedef {import("../support/wheel.js").VNode} VNode */
/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// --- the payloads ---------------------------------------------------------------

// This file's own stand-in for the owner's notice. Never compared against what
// ships — only against itself, and only where the question is "did the reader
// reach the metadata".
const NOTICE = "A stand-in notice, seeded by the suite.";

const META = {
  settings: {},
  filters: { filters: {}, aliases: {} },
  shapers: { pcm_dithers: {}, sdm_modulators: {} },
  easy: { notice: NOTICE, album: { heading: "A stand-in album heading." } },
};

/**
 * @param {string} value
 * @param {string} label
 */
const opt = (value, label) => ({ value, options: [{ value, label }] });

// A form loaded enough for the Output tab to draw its chain cards, as
// tests/js/components/outputtab.test.js seeds them.
const FORM = {
  backend: "alsa",
  alsa_device: { value: "hw:0", options: [{ value: "hw:0", label: "Topping DAC" }] },
  net_device: { value: "naa:1", options: [{ value: "naa:1", label: "Living room NAA" }] },
  filter1x: opt("1", "poly-sinc-gauss-long"),
  filter: opt("2", "poly-sinc-xtr-mp"),
  oversampling1x: opt("3", "poly-sinc-short-mp"),
  oversampling: opt("4", "closed-form-M"),
  junk_filter: "0",
  pre_before_meter: false,
};

// The engine's own `<GetFilters/>` enumeration (protocol.md:226) and the
// smallest `<State/>` the LIVE page needs a loaded PCM chain from, as
// tests/js/components/liveview-narrowbar.test.js seeds them.
const ENGINE = {
  enumerations: {
    mode: { name: "PCM" },
    rates: [{ index: "0", rate: "96000" }],
    shapers: [{ index: "0", value: "0", name: "none" }],
    junk_filters: [{ index: "0", value: "0", name: "none" }],
    filters: [
      { index: "0", value: "0", name: "none", arg: 1, description: "5/5 timbre ⥮ Any" },
      { index: "1", value: "40", name: "poly-sinc-gauss-long", arg: 1, description: "5/5 timbre ⥮ Any" },
    ],
  },
  state: { mode: "1", active_chain: "pcm", filter1x: "0", filterNx: "1", shaper: "0", rate: "0" },
};

// Module-level signals outlive a test, so every signal these pages read is put
// back on every reset, not just the ones a case cares about.
/** @param {{ easy?: boolean, grid?: string, notes?: boolean }} [opts] */
function common({ easy = false, grid = "album", notes = true } = {}) {
  signals.metadata.value = { ...META };
  signals.matrixConfig.value = { fields: [] };
  showDescriptions.value = notes;
  keepOptionDescriptions.value = true;
  narrow.resetNarrowing();
  easyMode.value = easy;
  easyGrid.value = grid;
}

/** @param {Parameters<typeof common>[0]} [opts] */
async function resetTab(opts) {
  stagingWire();
  liveMode.value = false;
  signals.engineState.value = {};
  signals.enums.value = null;
  common(opts);
  signals.config.value = { fields: formFields(FORM), file: { mode: "auto" }, active: "", profiles: null };
  await discardAll();
}

/** @param {Parameters<typeof common>[0]} [opts] */
async function resetLive(opts) {
  staticWire({ live: {}, http: {} });
  signals.health.value = { reachable: true, info: {} };
  signals.engineState.value = ENGINE.state;
  signals.enums.value = ENGINE.enumerations;
  common(opts);
  signals.config.value = { fields: [], file: {}, active: "", profiles: null };
  liveMode.value = true;
  await discardAll();
}

/** @param {Parameters<typeof common>[0]} [opts] */
async function resetBar(opts) {
  staticWire();
  liveMode.value = false;
  signals.engineState.value = {};
  signals.enums.value = { filters: ENGINE.enumerations.filters };
  common(opts);
  signals.config.value = { fields: [], file: {}, active: "", profiles: null };
  await discardAll();
}

const tab = () => render(html`<${Output} />`);
const live = () => render(html`<${LiveView} />`);
const bar = () => render(html`<${NarrowBar} />`);
const card = () => render(html`<${EasyCard} />`);

// --- readers ----------------------------------------------------------------------

/**
 * Which of a set of cards a page drew, by the `data-card` each section carries.
 *
 * @param {string} out
 * @param {string[]} cards
 * @returns {Record<string, boolean>}
 */
const drew = (out, cards) => Object.fromEntries(cards.map((c) => [c, cardHeadAt(out, c) >= 0]));

const EASY = "easy-mode";
const NARROW = "narrow-filters";
const TAB_CARDS = [NARROW, "pcm-chain", "sdm-chain", EASY];
const LIVE_CARDS = [NARROW, "live-pcm-chain", "live-sdm-chain", EASY];

/** @param {string[]} cards @param {boolean} easy */
const expected = (cards, easy) => Object.fromEntries(cards.map((c) => [c, c === EASY ? easy : !easy]));

/**
 * The `data-grid` every grid container of a rendering carries, in document
 * order — so "exactly one" and "which one" are one reading.
 *
 * @param {string} out
 * @returns {(string | undefined)[]}
 */
const grids = (out) =>
  elements(out)
    .filter((el) => attr(el, "data-grid") !== undefined)
    .sort((a, b) => a.start - b.start)
    .map((el) => attr(el, "data-grid"));

/**
 * The switcher's options, by the wire value each carries in `data-v`.
 *
 * @param {string} out
 * @returns {(string | undefined)[]}
 */
const segValues = (out) =>
  elements(out)
    .filter((el) => el.name === "button" && classes(el).includes("seg"))
    .map((el) => attr(el, "data-v"))
    .sort();

/**
 * The switcher options a rendering marks active.
 *
 * @param {string} out
 * @returns {(string | undefined)[]}
 */
const activeSegs = (out) =>
  elements(out)
    .filter((el) => el.name === "button" && classes(el).includes("seg") && classes(el).includes("active"))
    .map((el) => attr(el, "data-v"));

/**
 * One region of the Narrow Filters card — its head or its body — as the
 * outermost element inside the card carrying that class.
 *
 * @param {string} out
 * @param {string} name
 * @returns {MarkupElement}
 */
function region(out, name) {
  const hits = elements(section(out, NARROW)).filter((el) => classes(el).includes(name));
  if (hits.length === 0) throw new Error(`no "${name}" inside the "${NARROW}" card`);
  return hits.reduce((a, b) => (a.start <= b.start ? a : b));
}

// --- the click seam ---------------------------------------------------------------

/**
 * One render, with every vnode preact built along the way. `options.vnode` is
 * restored even if the render throws.
 *
 * @param {unknown} node
 * @returns {VNode[]}
 */
function seenOf(node) {
  /** @type {VNode[]} */
  const seen = [];
  const previous = options.vnode;
  options.vnode = (/** @type {VNode} */ v) => {
    seen.push(v);
    if (previous) previous(v);
  };
  try {
    render(/** @type {never} */ (node));
    return seen;
  } finally {
    options.vnode = previous;
  }
}

/**
 * One press on the affordance a `data-testid` names, as a pointer would land on
 * it. Anything but a single match throws rather than pressing something else.
 *
 * @param {VNode[]} seen
 * @param {string} testid
 * @returns {void}
 */
function press(seen, testid) {
  const hits = seen.filter(
    (v) => v && v.props && v.props["data-testid"] === testid && typeof v.props.onClick === "function",
  );
  if (hits.length !== 1) throw new Error(`expected one clickable "${testid}", found ${hits.length}`);
  /** @type {(event: object) => void} */ (hits[0].props.onClick)({ preventDefault() {}, stopPropagation() {} });
}

const ENTER = "easy-enter";
const EXIT = "easy-exit";
const NOTE = 'data-note="easy-notice"';

// ============================================================================
// which cards each page draws
// ============================================================================
//
// One assertion per page state, over the whole card set: a page that swapped
// only two of the three, or that drew the Easy Mode card beside them, fails by
// naming which card was wrong.

test("test_the_output_tab_draws_the_three_filter_cards_and_no_easy_mode_card_with_the_flag_down", async () => {
  await resetTab({ easy: false });
  assert.deepEqual(drew(tab(), TAB_CARDS), expected(TAB_CARDS, false));
});

test("test_the_output_tab_draws_the_easy_mode_card_alone_with_the_flag_up", async () => {
  await resetTab({ easy: true });
  assert.deepEqual(drew(tab(), TAB_CARDS), expected(TAB_CARDS, true));
});

test("test_the_live_page_draws_the_three_filter_cards_and_no_easy_mode_card_with_the_flag_down", async () => {
  await resetLive({ easy: false });
  assert.deepEqual(drew(live(), LIVE_CARDS), expected(LIVE_CARDS, false));
});

test("test_the_live_page_draws_the_easy_mode_card_alone_with_the_flag_up", async () => {
  await resetLive({ easy: true });
  assert.deepEqual(drew(live(), LIVE_CARDS), expected(LIVE_CARDS, true));
});

// ============================================================================
// the Narrow Filters card's head and body
// ============================================================================

test("test_the_narrow_filters_card_head_carries_the_easy_mode_link", async () => {
  await resetBar();
  assert.ok(region(bar(), "card-head").html.includes(`data-testid="${ENTER}"`));
});

// The Reset button moved OUT of the head and INTO the body. Both halves in one
// reading: a Reset left in the head fails, and so does one that went missing
// altogether.

test("test_the_reset_button_stands_in_the_card_body_and_not_in_the_head", async () => {
  await resetBar();
  narrow.nGenre.value = ["classical"];
  const out = bar();
  assert.deepEqual(
    { head: resets(region(out, "card-head").html), body: resets(region(out, "card-body").html) },
    { head: 0, body: 1 },
  );
});

// --- and it still comes and goes with the narrowing ---------------------------------

test("test_the_card_offers_no_reset_while_no_facet_has_moved", async () => {
  await resetBar();
  assert.equal(resets(section(bar(), NARROW)), 0);
});

test("test_the_card_offers_a_reset_once_a_facet_has_moved", async () => {
  await resetBar();
  narrow.nGenre.value = ["classical"];
  assert.equal(resets(section(bar(), NARROW)), 1);
});

// ============================================================================
// the Easy Mode card itself
// ============================================================================

// Exactly one grid container, and it is the one the switcher is on: two
// containers left in the markup with one hidden by CSS would read as a single
// choice to a user and as a defect here.

for (const grid of ["album", "playlist"]) {
  test(`test_the_easy_mode_card_renders_one_grid_container_for_the_${grid}_grid`, async () => {
    await resetTab({ easy: true, grid });
    assert.deepEqual(grids(card()), [grid]);
  });
}

test("test_the_switcher_offers_an_album_and_a_playlist_option", async () => {
  await resetTab({ easy: true });
  assert.deepEqual(segValues(card()), ["album", "playlist"]);
});

// Exactly the current grid's option is marked, so a switcher that marked both,
// or the wrong one, fails by naming what it marked.

for (const grid of ["album", "playlist"]) {
  test(`test_the_switcher_marks_the_${grid}_option_active_while_that_grid_is_showing`, async () => {
    await resetTab({ easy: true, grid });
    assert.deepEqual(activeSegs(card()), [grid]);
  });
}

// The notice is not a setting description: it stands whatever the descriptions
// preference says, because it is the card's own subtitle.

test("test_the_card_shows_its_notice_with_the_descriptions_preference_off", async () => {
  await resetTab({ easy: true, notes: false });
  assert.ok(card().includes(NOTE));
});

// ============================================================================
// the links
// ============================================================================

test("test_pressing_the_easy_mode_link_on_the_narrow_filters_card_raises_the_flag", async () => {
  await resetBar({ easy: false });
  press(seenOf(html`<${NarrowBar} />`), ENTER);
  assert.equal(easyMode.value, true);
});

test("test_pressing_the_exit_link_in_the_easy_mode_card_lowers_the_flag", async () => {
  await resetTab({ easy: true });
  press(seenOf(html`<${EasyCard} />`), EXIT);
  assert.equal(easyMode.value, false);
});

// ============================================================================
// the notice reader
// ============================================================================
//
// `easyProse` walks the `easy` section of /api/metadata. The strings it is asked
// for here are this file's own seeded stand-ins, so what is pinned is the WALK —
// which key path reaches which value, and that a path that does not exist costs
// the caller an empty string rather than a crash.

test("test_easy_prose_reads_a_top_level_key_off_the_easy_section", async () => {
  await resetTab();
  assert.equal(easyProse("notice"), NOTICE);
});

test("test_easy_prose_walks_down_a_nested_key_path", async () => {
  await resetTab();
  assert.equal(easyProse("album", "heading"), META.easy.album.heading);
});

test("test_easy_prose_answers_empty_for_a_key_the_section_does_not_carry", async () => {
  await resetTab();
  assert.equal(easyProse("nowhere"), "");
});

test("test_easy_prose_answers_empty_for_a_path_through_a_branch_that_is_not_there", async () => {
  await resetTab();
  assert.equal(easyProse("album", "nowhere", "deeper"), "");
});

test("test_easy_prose_answers_empty_before_the_metadata_has_loaded", async () => {
  await resetTab();
  signals.metadata.value = null;
  assert.equal(easyProse("notice"), "");
});
