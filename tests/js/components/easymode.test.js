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
// carries, the Reset button by its
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
//   * `data-card="filter-primer"` on the primer's section, the third face the
//     filter half of each page can show (store/primerview.js's `primerOpen`)
//   * `data-note="easy-notice"` on the card's notice/subtitle element
//   * `data-testid="easy-switcher"` on a grid switcher, were there one — read
//     only for its ABSENCE, the card having no switcher any more
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
// The card no longer offers a switcher, so nothing here presses one; that the
// marking is absent is read as a plain count, in the card section below.
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
const { easyMode } = await import("../../../hqptuner/static/store/easyview.js");
const { primerOpen } = await import("../../../hqptuner/static/store/primerview.js");
const { easyProse } = await import("../../../hqptuner/static/store/prose.js");
const signals = await import("../../../hqptuner/static/store/signals.js");
const { discardAll } = await import("../../../hqptuner/static/store/actions.js");
const { liveMode, showDescriptions, keepOptionDescriptions } = await import("../../../hqptuner/static/store/prefs.js");
const narrow = await import("../../../hqptuner/static/store/narrow/state.js");
const { stagingWire, staticWire } = await import("../support/wire.js");
const { elements, classes, attr } = await import("../support/markup.js");
const { cardHeadAt, section, formFields } = await import("../support/tabform.js");
const { resets, seen: readerSees } = await import("../support/narrowbarview.js");

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
  easy: { notice: NOTICE, "perfect-ten": { title: "A stand-in tile title." } },
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
/** @param {{ easy?: boolean, primer?: boolean, notes?: boolean }} [opts] */
function common({ easy = false, primer = false, notes = true } = {}) {
  signals.metadata.value = { ...META };
  signals.matrixConfig.value = { fields: [] };
  showDescriptions.value = notes;
  keepOptionDescriptions.value = true;
  narrow.resetNarrowing();
  easyMode.value = easy;
  primerOpen.value = primer;
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
const PRIMER = "filter-primer";
const NARROW = "narrow-filters";
const TAB_CARDS = [NARROW, "pcm-chain", "sdm-chain", EASY, PRIMER];
const LIVE_CARDS = [NARROW, "live-pcm-chain", "live-sdm-chain", EASY, PRIMER];

// The filter half of a page shows one of three faces: the filter cards (`up`
// null), the Easy Mode card, or the primer. Whichever stand-in is up is drawn
// alone; with neither up the filter cards are drawn and neither stand-in is.
/** @param {string[]} cards @param {string | null} up */
const expected = (cards, up) =>
  Object.fromEntries(cards.map((c) => [c, up ? c === up : c !== EASY && c !== PRIMER]));

/**
 * How many switcher containers a rendering carries, by the
 * `data-testid="easy-switcher"` the switcher was found by — a marking put there
 * to be found by, rather than the styling class beside it, which the owner may
 * restyle without changing any behavior.
 *
 * @param {string} out
 * @returns {number}
 */
const switchers = (out) => elements(out).filter((el) => attr(el, "data-testid") === "easy-switcher").length;

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
 * One press on the affordance an attribute names — a `data-testid` for the two
 * links, a `data-v` for a switcher option — as a pointer would land on it.
 * Anything but a single match throws rather than pressing something else.
 *
 * @param {VNode[]} seen
 * @param {string} name
 * @param {string} value
 * @returns {void}
 */
function press(seen, name, value) {
  const hits = seen.filter((v) => v && v.props && v.props[name] === value && typeof v.props.onClick === "function");
  if (hits.length !== 1) throw new Error(`expected one clickable ${name}="${value}", found ${hits.length}`);
  /** @type {(event: object) => void} */ (hits[0].props.onClick)({ preventDefault() {}, stopPropagation() {} });
}

const TESTID = "data-testid";
const ENTER = "easy-enter";
const EXIT = "easy-exit";

/**
 * What a reader sees in the card's notice. Exactly one element carries the
 * marking, so a card that grew a second one fails here rather than reading the
 * first it finds.
 *
 * @param {string} out
 * @returns {string}
 */
function noticeText(out) {
  const hits = elements(out).filter((el) => attr(el, "data-note") === "easy-notice");
  if (hits.length !== 1) throw new Error(`expected one notice element, found ${hits.length}`);
  return readerSees(hits[0]);
}

// ============================================================================
// which cards each page draws
// ============================================================================
//
// One assertion per page state, over the whole card set: a page that swapped
// only two of the three, or that drew the Easy Mode card beside them, fails by
// naming which card was wrong.

test("test_the_output_tab_draws_the_three_filter_cards_and_no_easy_mode_card_with_the_flag_down", async () => {
  await resetTab({ easy: false });
  assert.deepEqual(drew(tab(), TAB_CARDS), expected(TAB_CARDS, null));
});

test("test_the_output_tab_draws_the_easy_mode_card_alone_with_the_flag_up", async () => {
  await resetTab({ easy: true });
  assert.deepEqual(drew(tab(), TAB_CARDS), expected(TAB_CARDS, EASY));
});

test("test_the_output_tab_draws_the_primer_alone_with_the_primer_open", async () => {
  await resetTab({ primer: true });
  assert.deepEqual(drew(tab(), TAB_CARDS), expected(TAB_CARDS, PRIMER));
});

test("test_the_live_page_draws_the_three_filter_cards_and_no_easy_mode_card_with_the_flag_down", async () => {
  await resetLive({ easy: false });
  assert.deepEqual(drew(live(), LIVE_CARDS), expected(LIVE_CARDS, null));
});

test("test_the_live_page_draws_the_easy_mode_card_alone_with_the_flag_up", async () => {
  await resetLive({ easy: true });
  assert.deepEqual(drew(live(), LIVE_CARDS), expected(LIVE_CARDS, EASY));
});

test("test_the_live_page_draws_the_primer_alone_with_the_primer_open", async () => {
  await resetLive({ primer: true });
  assert.deepEqual(drew(live(), LIVE_CARDS), expected(LIVE_CARDS, PRIMER));
});

// ============================================================================
// the Narrow Filters card's head and body
// ============================================================================

test("test_the_narrow_filters_card_head_carries_the_easy_mode_link", async () => {
  await resetBar();
  assert.ok(region(bar(), "card-head").html.includes(`${TESTID}="${ENTER}"`));
});

// The Reset button moved OUT of the head and INTO the body. Two cases, so a
// failure names which half moved: a Reset that went missing altogether is red on
// the first, one left in the head is red on the second.

test("test_the_reset_button_stands_in_the_card_body", async () => {
  await resetBar();
  narrow.nGenre.value = ["classical"];
  assert.equal(resets(region(bar(), "card-body").html), 1);
});

test("test_the_reset_button_no_longer_stands_in_the_card_head", async () => {
  await resetBar();
  narrow.nGenre.value = ["classical"];
  assert.equal(resets(region(bar(), "card-head").html), 0);
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

// THE SWITCHER IS GONE. There is one set of tiles, so the card offers nothing
// that chooses between two: a card still rendering the switcher would be
// offering a choice the store no longer keeps. Read as an absence of the marking
// the switcher was found by — whether the tiles are laid out in a container of
// any kind, and what that container is marked with, is the writer's business and
// is asserted nowhere.

test("test_the_card_renders_no_switcher", async () => {
  await resetTab({ easy: true });
  assert.equal(switchers(card()), 0);
});

// The notice is not a setting description: it stands whatever the descriptions
// preference says, because it is the card's own subtitle. What it must say is
// what the metadata carries, so the seeded stand-in is read back out of it — an
// empty element carrying the marking is not a notice shown.

test("test_the_card_shows_the_notice_the_metadata_carries_with_the_descriptions_preference_off", async () => {
  await resetTab({ easy: true, notes: false });
  assert.equal(noticeText(card()), NOTICE);
});

// ============================================================================
// the controls
// ============================================================================

test("test_pressing_the_easy_mode_link_on_the_narrow_filters_card_raises_the_flag", async () => {
  await resetBar({ easy: false });
  press(seenOf(html`<${NarrowBar} />`), TESTID, ENTER);
  assert.equal(easyMode.value, true);
});

test("test_pressing_the_exit_link_in_the_easy_mode_card_lowers_the_flag", async () => {
  await resetTab({ easy: true });
  press(seenOf(html`<${EasyCard} />`), TESTID, EXIT);
  assert.equal(easyMode.value, false);
});

// What the tiles and their knobs do when pressed is
// tests/js/components/easytiles.test.js's; the two links above are the controls
// this file owns, the switcher they used to sit beside having gone.

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
  assert.equal(easyProse("perfect-ten", "title"), META.easy["perfect-ten"].title);
});

test("test_easy_prose_answers_empty_for_a_key_the_section_does_not_carry", async () => {
  await resetTab();
  assert.equal(easyProse("nowhere"), "");
});

test("test_easy_prose_answers_empty_for_a_path_through_a_branch_that_is_not_there", async () => {
  await resetTab();
  assert.equal(easyProse("perfect-ten", "nowhere", "deeper"), "");
});

test("test_easy_prose_answers_empty_before_the_metadata_has_loaded", async () => {
  await resetTab();
  signals.metadata.value = null;
  assert.equal(easyProse("notice"), "");
});
