// Behavioral suite for the LIVE page's chain-card disclosure — the toggle
// itself, and what a poll is allowed to do to a card the user has touched.
//
// The defect this pins: the page re-fetches /api/state, /api/status and
// /api/enumerations twice a second, and a poll that brought back the SAME engine
// state was snapping a hand-opened card shut, so a click read as doing nothing.
// Every "poll" below therefore carries state that is identical in content to
// what is already displayed, built from the same scenario constant, and is a
// FRESH object each time — writing the same reference to a signal does not
// notify, and the notification is the whole point (docs/testing.md, harness
// facts).
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. The page is driven by assigning the exported store signals the
// shapes /api/state, /api/enumerations and /api/config actually serve.
//
// There is no exported collapse API and there is no DOM here, so a card is
// opened the way a caller opens one: by invoking the onClick its head element
// carries. The heads are collected through preact's own `options.vnode` hook —
// the renderer's public seam, third-party surface, not ours — so nothing of
// HQPTuner's is stubbed, widened or reached into. The state is read back off the
// card section's class list, as the browser shows it.
//
// The browser re-renders on every signal change; SSR does not, so `poll()`
// renders once and drops the output. That render is the one production does for
// free, not an extra nudge.
//
// Setup never assumes a clean slate: the manual override is module-private and
// outlives a test, so `ensure()` reads the card's current disclosure and clicks
// only when it differs from what the case needs. A card shown CLOSED in a mode
// whose automatic disclosure is OPEN can only be the user's own override, and
// the mirror for open — so each case's starting override is pinned by what is on
// screen, not by history.
//
// NOT covered: an override that OPENED a card being dropped on a mode change.
// The only mode in which the PCM card's automatic disclosure is closed is SDM
// (and the mirror for SDM), so there is no mode transition on which a dropped
// open-override renders differently from a kept one — nothing to observe.
// Automatic disclosure with no override at all is livechain.test.js's, covered
// there for all three modes.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/livecollapse.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { options } from "preact";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { LiveView } from "../../../hqptuner/static/components/live/View.js";
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
import { liveMode } from "../../../hqptuner/static/store/prefs.js";
import { staticWire } from "../support/wire.js";

// --- the wire shapes ----------------------------------------------------------
// Each chain numbers the same names differently (protocol.md §4), so the two
// enumerations are kept apart even though disclosure does not read them.

const PCM_FILTERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "40", name: "poly-sinc-gauss-long" },
  { index: "2", value: "25", name: "sinc-M" },
];
const SDM_FILTERS = [
  { index: "0", value: "38", name: "poly-sinc-gauss-long" },
  { index: "1", value: "23", name: "sinc-M" },
];
const PCM_SHAPERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "5", name: "NS9" },
];
const SDM_SHAPERS = [
  { index: "0", value: "0", name: "ASDM5" },
  { index: "1", value: "3", name: "ASDM7EC" },
];
const RATES = [
  { index: "0", rate: "0" },
  { index: "1", rate: "96000" },
];
const JUNK = [{ index: "0", value: "0", name: "none" }];

// A scenario is one configured output mode: `mode` is the ModesItem list index
// State reports ("0" = [source], "1" = PCM, "2" = SDM), `chain` is which chain
// the engine has loaded, and the two are separate fields.
const PCM = { mode: "1", chain: "pcm", modeName: "PCM", cfgMode: "pcm", sdm: false };
const SDM = { mode: "2", chain: "sdm", modeName: "SDM (DSD)", cfgMode: "sdm", sdm: true };
const AUTO = { mode: "0", chain: null, modeName: "[source]", cfgMode: "auto", sdm: false };

/**
 * One scenario the page can be showing: what the engine reports, what it has
 * loaded, and what the config file says.
 *
 * @typedef {{ mode: string, chain: string | null, modeName: string, cfgMode: string, sdm: boolean }} Scenario
 * @typedef {{ index: string, value: string, name: string }} EnumItem
 * @typedef {import("../support/wheel.js").VNode} VNode
 */

/** @param {Scenario} sc */
const STATE = (sc) => ({
  mode: sc.mode,
  filter1x: "1",
  filterNx: "1",
  shaper: "1",
  rate: "1",
  filter_junk: "0",
  adaptive: "0",
  volume: "-10.0",
  active_chain: sc.chain,
});

/** @param {Scenario} sc */
const ENUMS = (sc) => ({
  filters: sc.sdm ? SDM_FILTERS : PCM_FILTERS,
  shapers: sc.sdm ? SDM_SHAPERS : PCM_SHAPERS,
  rates: RATES,
  junk_filters: JUNK,
  mode: { name: sc.modeName },
});

// The daemon's /config form: every field carries its OWN chain's option list, in
// the enum-ID domain the config file speaks.
/**
 * @param {string} name
 * @param {string} value
 * @param {EnumItem[]} items
 */
const formField = (name, value, items) => ({
  name,
  value,
  options: items.map((i) => ({ value: i.value, label: i.name })),
});
const FORM = { filter1x: "40", filter: "40", dither: "5", oversampling1x: "38", oversampling: "38", modulator: "3" };
/** @type {Record<string, EnumItem[]>} */
const LISTS = {
  filter1x: PCM_FILTERS,
  filter: PCM_FILTERS,
  dither: PCM_SHAPERS,
  oversampling1x: SDM_FILTERS,
  oversampling: SDM_FILTERS,
  modulator: SDM_SHAPERS,
};
const FIELDS = () => Object.entries(FORM).map(([name, value]) => formField(name, value, LISTS[name]));
/** @param {Scenario} sc */
const FILE = (sc) => ({ mode: sc.cfgMode, ...FORM });

// settings.json's per-control prose, cut to a sentence each.
const METADATA = () => ({
  settings: {
    output: {
      output_mode: { label: "Output mode", tooltip: "Selects default output mode." },
      rate: { label: "Output rate", tooltip: "Output sample rate request, or upper limit." },
      junk_filter: { label: "High-frequency filter", tooltip: "Playback filters for noise.", options: {} },
    },
    dsp: {
      filter_1x: { label: "1x filter", tooltip: "Oversampling filter for base-rate sources." },
      filter_nx: { label: "Nx filter", tooltip: "Oversampling filter above the base rates." },
      shaper: { label: "Dither", tooltip: "Noise shaping applied at the output word length." },
    },
    volume: { adaptive_volume: { label: "Adaptive volume", tooltip: "Applies the source's ReplayGain 2.0 offset." } },
  },
  filters: { filters: {}, aliases: {} },
  shapers: { pcm_dithers: {}, sdm_modulators: {} },
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

/**
 * @param {unknown} node
 * @returns {string}
 */
function text(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  const props = /** @type {VNode} */ (node).props;
  return text(props && props.children);
}

// The head of the named card, as the button a pointer would land on. Anything
// other than exactly one match throws rather than clicking something else: a
// restructured head must fail loudly, not quietly toggle the wrong card.
/** @param {string} title */
function clickHead(title) {
  const heads = renderPage().seen.filter(
    (v) => v && v.type === "button" && v.props && typeof v.props.onClick === "function" && text(v).includes(title),
  );
  if (heads.length !== 1) throw new Error(`expected one clickable head for "${title}", found ${heads.length}`);
  const onClick = /** @type {(event: object) => void} */ (heads[0].props.onClick);
  onClick({ preventDefault() {}, stopPropagation() {} });
}

const MARK = '<section class="card ';

// A named card's disclosure, off its own section's class list.
/**
 * @param {string} out
 * @param {string} title
 */
function cardState(out, title) {
  const at = out.search(new RegExp(`class="card-head">(<span class="tri">.</span> )?${title}</(div|button)>`));
  if (at < 0) throw new Error(`no card headed "${title}" in the rendered page`);
  const mark = out.lastIndexOf(MARK, at);
  if (mark < 0) throw new Error(`the card headed "${title}" is not inside a card section`);
  return out.slice(mark + MARK.length).split('"')[0];
}

// Bring a card to the disclosure a case starts from, by clicking its head when
// what is on screen is not it — the only route a user has. A single click that
// does not land is an error, not something to click harder at.
/**
 * @param {string} title
 * @param {string} want
 */
function ensure(title, want) {
  if (cardState(page(), title) === want) return;
  clickHead(title);
  const now = cardState(page(), title);
  if (now !== want) throw new Error(`"${title}" would not go ${want}: it is ${now}`);
}

// --- the poll -----------------------------------------------------------------

// One pass of the page's own polling loop: every signal it feeds gets a FRESH
// object, whether or not the daemon said anything new. Passing the scenario the
// page is already showing is the unchanged poll — identical in content, new in
// identity, which is exactly what /api/state hands over on a quiet engine.
/** @param {Scenario} sc */
function poll(sc) {
  health.value = { reachable: true, info: {} };
  engineState.value = STATE(sc);
  engineStatus.value = null;
  enums.value = ENUMS(sc);
  config.value = { fields: FIELDS(), file: FILE(sc), active: "", profiles: null };
  matrixConfig.value = { fields: [], file_profiles: {}, live_profiles: [] };
  volume.value = "-10.0";
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
  page(); // the browser re-renders on a signal change; SSR has to be told to
}

// Total reset of everything the page reads, less the manual override, which is
// private and is pinned per case by `ensure()` instead (see header).
/** @param {Scenario} sc */
async function reset(sc) {
  staticWire({ live: {}, http: {} });
  metadata.value = METADATA();
  liveErrors.value = {};
  liveBusy.value = "";
  liveMode.value = true;
  poll(sc);
  await discardAll();
}

// --- the toggle ---------------------------------------------------------------

test("test_clicking_a_closed_cards_head_opens_it", async () => {
  await reset(PCM);
  ensure("SDM Chain", "closed");
  clickHead("SDM Chain");
  assert.equal(cardState(page(), "SDM Chain"), "open");
});

test("test_clicking_an_open_cards_head_closes_it", async () => {
  await reset(PCM);
  ensure("PCM Chain", "open");
  clickHead("PCM Chain");
  assert.equal(cardState(page(), "PCM Chain"), "closed");
});

// --- a poll that changes nothing leaves the user's card alone -------------------

test("test_a_card_opened_by_hand_survives_a_poll_of_unchanged_state", async () => {
  await reset(PCM);
  ensure("SDM Chain", "open"); // the SDM card's automatic disclosure in PCM is closed
  poll(PCM);
  assert.equal(cardState(page(), "SDM Chain"), "open");
});

test("test_a_card_closed_by_hand_survives_a_poll_of_unchanged_state", async () => {
  await reset(PCM);
  ensure("PCM Chain", "closed"); // the PCM card's automatic disclosure in PCM is open
  poll(PCM);
  assert.equal(cardState(page(), "PCM Chain"), "closed");
});

test("test_a_card_opened_by_hand_survives_repeated_unchanged_polls", async () => {
  // The reported symptom was a card snapping shut about once a second, so the
  // contract is the steady state, not the first poll after the click.
  await reset(PCM);
  ensure("SDM Chain", "open");
  poll(PCM);
  poll(PCM);
  poll(PCM);
  assert.equal(cardState(page(), "SDM Chain"), "open");
});

// --- a mode change drops the override -------------------------------------------
// The override is the user's answer to the disclosure the page chose; a new
// output mode is a new question, and the page answers it afresh. Without this a
// card shut by hand in auto stays shut in the mode that needs it.

test("test_a_pcm_card_closed_by_hand_in_auto_reopens_when_the_mode_becomes_pcm", async () => {
  await reset(AUTO);
  ensure("PCM Chain", "closed"); // auto opens both, so this is the user's own doing
  poll(PCM);
  assert.equal(cardState(page(), "PCM Chain"), "open");
});

test("test_an_sdm_card_closed_by_hand_in_auto_reopens_when_the_mode_becomes_sdm", async () => {
  await reset(AUTO);
  ensure("SDM Chain", "closed");
  poll(SDM);
  assert.equal(cardState(page(), "SDM Chain"), "open");
});

test("test_a_card_closed_by_hand_in_pcm_reopens_when_the_mode_becomes_auto", async () => {
  // The other direction of the same rule: auto shows both chains, so the card
  // the user shut while the mode named one chain comes back for [source].
  await reset(PCM);
  ensure("PCM Chain", "closed");
  poll(AUTO);
  assert.equal(cardState(page(), "PCM Chain"), "open");
});
