// Behavioral suite for the chain cards' manual disclosure on the Output tab —
// the toggle itself, the mode-mismatch note a hand-opened inert card carries,
// and the override lifecycle: a manual toggle wins until the OUTPUT MODE
// changes, at which point the card re-follows automatic disclosure; anything
// short of a mode change (a fresh config at the same mode, an unrelated staged
// edit) leaves the user's choice alone.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. There is no exported collapse API and there is no DOM here, so a
// card is toggled the way a caller toggles one: by invoking the onClick its head
// element carries, collected through preact's own `options.vnode` hook — the
// renderer's public seam, third-party surface, not ours. The state is read back
// off the card section's class list, as the browser shows it.
//
// Kept apart from conversioncards.test.js deliberately: the override a click
// writes is module-level state that outlives a test, and each test FILE runs in
// its own process, so the automatic-disclosure suite never sees this one's
// clicks. Setup here never assumes a clean slate either: `ensure()` reads the
// card's current disclosure and clicks only when it differs from what the case
// needs.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/conversioncards-collapse.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { options } from "preact";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Output } from "../../../hqptuner/static/components/tabs/OutputTab.js";
import { config, matrixConfig, metadata, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrowing.js";
import { stagingWire } from "../support/wire.js";
import { formFields, section, stateOf } from "../support/tabform.js";

/** @typedef {import("../support/wheel.js").VNode} VNode */

const PCM = "PCM Chain";
const SDM = "SDM Chain";
const SDM_NOTE = "Output mode is SDM. These settings have no effect.";
const PCM_NOTE = "Output mode is PCM. These settings have no effect.";

// The daemon's /config form fields the chain cards render, each with its own
// option list so the cards have real dropdowns under them.
/**
 * @param {string} value
 * @param {string} label
 */
const opt = (value, label) => ({ value, options: [{ value, label }] });
const CHAINS = {
  filter1x: opt("1", "poly-sinc-gauss-long"),
  filter: opt("2", "poly-sinc-xtr-mp"),
  oversampling1x: opt("3", "poly-sinc-short-mp"),
  oversampling: opt("4", "closed-form-M"),
};

// The config as the store hands it over: a FRESH object every call, the way a
// re-fetch delivers one, with `mode` as the running config file reports it.
/** @param {string} mode */
const setMode = (mode) => {
  config.value = { fields: formFields(CHAINS), file: { mode }, active: "", profiles: null };
};

/** @param {string} mode */
async function reset(mode) {
  stagingWire();
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  resetNarrowing();
  matrixConfig.value = { fields: [] };
  setMode(mode);
  await discardAll();
}

// --- rendering, clicking, reading ---------------------------------------------

// One render, with every vnode preact builds along the way. `options.vnode` is
// preact's own creation hook; it is restored even if the render throws.
function renderTab() {
  /** @type {VNode[]} */
  const seen = [];
  const previous = options.vnode;
  options.vnode = (/** @type {VNode} */ vnode) => {
    seen.push(vnode);
    if (previous) previous(vnode);
  };
  try {
    return { out: render(html`<${Output} />`), seen };
  } finally {
    options.vnode = previous;
  }
}

const tab = () => renderTab().out;

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
// other than exactly one match throws rather than clicking something else.
/** @param {string} title */
function clickHead(title) {
  const heads = renderTab().seen.filter(
    (v) => v && v.type === "button" && v.props && typeof v.props.onClick === "function" && text(v).includes(title),
  );
  if (heads.length !== 1) throw new Error(`expected one clickable head for "${title}", found ${heads.length}`);
  const onClick = /** @type {(event: object) => void} */ (heads[0].props.onClick);
  onClick({ preventDefault() {}, stopPropagation() {} });
}

// Bring a card to the disclosure a case starts from, by clicking its head when
// what is on screen is not it — the only route a user has.
/**
 * @param {string} title
 * @param {string} want
 */
function ensure(title, want) {
  if (stateOf(tab(), title) === want) return;
  clickHead(title);
  const now = stateOf(tab(), title);
  if (now !== want) throw new Error(`"${title}" would not go ${want}: it is ${now}`);
}

// --- the toggle ---------------------------------------------------------------

test("test_clicking_a_closed_chain_cards_head_opens_it", async () => {
  await reset("pcm");
  ensure(SDM, "closed"); // the SDM card's automatic disclosure in PCM is closed
  clickHead(SDM);
  assert.equal(stateOf(tab(), SDM), "open");
});

test("test_clicking_an_open_chain_cards_head_closes_it", async () => {
  await reset("pcm");
  ensure(PCM, "open");
  clickHead(PCM);
  assert.equal(stateOf(tab(), PCM), "closed");
});

// --- the mode-mismatch note ---------------------------------------------------
// An inert chain auto-closes, so its note is only ever seen by a user who opened
// the card by hand — and it must be there when they do.

test("test_a_hand_opened_pcm_card_in_sdm_mode_says_its_settings_have_no_effect", async () => {
  await reset("sdm");
  ensure(PCM, "open");
  assert.ok(section(tab(), PCM).includes(SDM_NOTE));
});

test("test_a_hand_opened_sdm_card_in_pcm_mode_says_its_settings_have_no_effect", async () => {
  await reset("pcm");
  ensure(SDM, "open");
  assert.ok(section(tab(), SDM).includes(PCM_NOTE));
});

test("test_a_chain_card_in_its_own_mode_carries_no_mismatch_note", async () => {
  await reset("pcm");
  ensure(PCM, "open");
  assert.equal(section(tab(), PCM).includes("These settings have no effect"), false);
});

// --- the override lifecycle ---------------------------------------------------
// The override is the user's answer to the disclosure the tab chose; a new
// output mode is a new question, and the tab answers it afresh. Anything short
// of a mode change keeps the user's answer.

test("test_a_pcm_card_closed_by_hand_in_auto_reopens_when_the_mode_becomes_pcm", async () => {
  await reset("auto");
  ensure(PCM, "closed"); // auto opens both, so this is the user's own doing
  setMode("pcm");
  assert.equal(stateOf(tab(), PCM), "open");
});

test("test_an_sdm_card_closed_by_hand_in_auto_reopens_when_the_mode_becomes_sdm", async () => {
  await reset("auto");
  ensure(SDM, "closed");
  setMode("sdm");
  assert.equal(stateOf(tab(), SDM), "open");
});

test("test_a_card_closed_by_hand_survives_a_fresh_config_at_the_same_mode", async () => {
  await reset("pcm");
  ensure(PCM, "closed"); // the PCM card's automatic disclosure in PCM is open
  setMode("pcm"); // identical in content, new in identity — a quiet re-fetch
  assert.equal(stateOf(tab(), PCM), "closed");
});

test("test_a_card_closed_by_hand_survives_an_unrelated_staged_edit", async () => {
  await reset("pcm");
  ensure(PCM, "closed");
  await edit("gain_comp", "-0.5");
  assert.equal(stateOf(tab(), PCM), "closed");
});

// The same lifecycle, mirrored for a card the user OPENED by hand — an inert
// chain shown against its mode's auto disclosure. It stays open through
// anything short of a mode change, and a mode change drops the override.

test("test_a_card_opened_by_hand_survives_a_fresh_config_at_the_same_mode", async () => {
  await reset("pcm");
  ensure(SDM, "open"); // the SDM card's automatic disclosure in PCM is closed
  setMode("pcm"); // identical in content, new in identity — a quiet re-fetch
  assert.equal(stateOf(tab(), SDM), "open");
});

test("test_a_card_opened_by_hand_survives_an_unrelated_staged_edit", async () => {
  await reset("pcm");
  ensure(SDM, "open");
  await edit("gain_comp", "-0.5");
  assert.equal(stateOf(tab(), SDM), "open");
});

test("test_a_hand_opened_inert_card_recloses_once_the_mode_has_changed", async () => {
  // Each card is auto-closed in exactly one mode, so no single transition lands
  // a hand-opened card where auto disclosure is closed again — a kept override
  // and a dropped one render the same after one change. The round trip tells
  // them apart: if the first mode change dropped the open-override, returning
  // to SDM finds the PCM card back on its automatic (closed) disclosure.
  await reset("sdm");
  ensure(PCM, "open"); // auto-closed in SDM, so this is the user's own doing
  setMode("pcm");
  setMode("sdm");
  assert.equal(stateOf(tab(), PCM), "closed");
});
