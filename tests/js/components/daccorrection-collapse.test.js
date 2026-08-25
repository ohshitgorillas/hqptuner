// Behavioral suite for the DAC correction card's disclosure on the Output tab —
// that it is a collapsible card at all, that it stands open until the user says
// otherwise, that its head toggles it both ways, and that the user's choice
// survives unrelated activity without disturbing another card's disclosure.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. There is no exported collapse API and there is no DOM here, so the
// card is toggled the way a caller toggles one: by invoking the onClick its head
// element carries, collected through preact's own `options.vnode` hook — the
// renderer's public seam, third-party surface, not ours, reached through the
// shared `renderWith` harness. The state is read back off the card section's
// class list, as the browser shows it.
//
// The card's body is witnessed by its own gate control, the field keyed
// `dac_correction_enabled` (card-gates.test.js). A closed card renders none of
// it.
//
// Kept apart from outputtab.test.js deliberately: the override a click writes is
// module-level state that outlives a test, and each test FILE runs in its own
// process, so the automatic-disclosure suites never see this one's clicks. Setup
// here never assumes a clean slate either: `ensure()` reads the card's current
// disclosure and clicks only when it differs from what the case needs. The two
// default-disclosure cases below are the exception and are placed FIRST in the
// file on purpose, before any click has happened.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/daccorrection-collapse.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Output } from "../../../hqptuner/static/components/tabs/OutputTab.js";
import { config, matrixConfig, metadata, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrow/state.js";
import { stagingWire } from "../support/wire.js";
import { formFields, section, stateOf } from "../support/tabform.js";
import { classes, elements } from "../support/markup.js";
import { renderWith } from "../support/wheel.js";
import { clickCardHead } from "../support/carddisclosure.js";

// Cards are named by the `data-card` their <section> carries — the card's own
// machine identity, never the words in its head (docs/testing.md rule 9).
const DAC = "dac-correction";
// The gate control of the DAC correction card, by the schema key its field
// wears in `data-k`: the `dac_correction_enabled` two-choice segmented switch.
const GATE = 'data-k="dac_correction_enabled"';

/**
 * @param {string} value
 * @param {string} label
 */
const opt = (value, label) => ({ value, options: [{ value, label }] });

// A working Output tab: a backend with a device that is present, the four chain
// slots the conversion cards read, and a /matrix form whose engine is engaged so
// the post-process gate is live rather than grayed for the matrix's own sake.
const FORM = {
  backend: "alsa",
  alsa_device: opt("hw:0", "Topping DAC"),
  net_device: opt("naa:1", "Living room NAA"),
  filter1x: opt("1", "poly-sinc-gauss-long"),
  filter: opt("2", "poly-sinc-xtr-mp"),
  oversampling1x: opt("3", "poly-sinc-short-mp"),
  oversampling: opt("4", "closed-form-M"),
};
const MATRIX = { enabled: "1", post_correction_enabled: true };

async function reset() {
  stagingWire();
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  resetNarrowing();
  matrixConfig.value = { fields: formFields(MATRIX) };
  config.value = { fields: formFields(FORM), file: { mode: "auto" }, active: "", profiles: null };
  await discardAll();
}

// --- rendering, clicking, reading ---------------------------------------------

const renderTab = () => renderWith(html`<${Output} />`);
const tab = () => renderTab().out;

// The head of the card carrying an id, as the button a pointer would land on:
// the head INSIDE that card's own section subtree, so which card is toggled is
// a matter of containment rather than of the order preact happens to build
// vnodes in. The card is never found by the words in its head (docs/testing.md
// rule 9).
/** @param {string} card */
const clickHead = (card) => clickCardHead(renderTab().seen, card);

// Bring a card to the disclosure a case starts from, by clicking its head when
// what is on screen is not it — the only route a user has.
/**
 * @param {string} card
 * @param {string} want
 */
function ensure(card, want) {
  if (stateOf(tab(), card) === want) return;
  clickHead(card);
  const now = stateOf(tab(), card);
  if (now !== want) throw new Error(`"${card}" would not go ${want}: it is ${now}`);
}

// --- the card is a disclosure --------------------------------------------------

// The head is the card's own head element, a button a pointer can press, with
// the disclosure triangle its `tri` span carries — whichever way the triangle
// points and whatever the title beside it reads.
/** @param {string} frag */
const headButtons = (frag) => elements(frag).filter((el) => el.name === "button" && classes(el).includes("card-head"));

test("test_the_dac_correction_head_is_a_disclosure_button", async () => {
  await reset();
  assert.equal(headButtons(section(tab(), DAC)).length, 1);
});

// --- how it stands before anyone touches it ------------------------------------
// First render of the tab, ahead of every click this file makes.

test("test_the_dac_correction_card_stands_open_before_anyone_touches_it", async () => {
  await reset();
  assert.equal(stateOf(tab(), DAC), "open");
});

test("test_an_untouched_dac_correction_card_shows_its_gate", async () => {
  await reset();
  assert.ok(section(tab(), DAC).includes(GATE));
});

// --- the toggle ----------------------------------------------------------------

test("test_clicking_the_open_dac_correction_head_closes_the_card", async () => {
  await reset();
  ensure(DAC, "open");
  clickHead(DAC);
  assert.equal(stateOf(tab(), DAC), "closed");
});

test("test_a_closed_dac_correction_card_hides_its_gate", async () => {
  await reset();
  ensure(DAC, "closed");
  assert.equal(section(tab(), DAC).includes(GATE), false);
});

test("test_clicking_the_closed_dac_correction_head_opens_the_card_again", async () => {
  await reset();
  ensure(DAC, "closed");
  clickHead(DAC);
  assert.equal(stateOf(tab(), DAC), "open");
});

test("test_a_reopened_dac_correction_card_shows_its_gate_again", async () => {
  await reset();
  ensure(DAC, "closed");
  clickHead(DAC);
  assert.ok(section(tab(), DAC).includes(GATE));
});

// --- the user's choice sticks ---------------------------------------------------

test("test_a_dac_correction_card_closed_by_hand_survives_an_unrelated_staged_edit", async () => {
  await reset();
  ensure(DAC, "closed");
  await edit("gain_comp", "-0.5");
  assert.equal(stateOf(tab(), DAC), "closed");
});

// A click lands on the card it was aimed at and nowhere else. The neighbour is
// the PCM chain card, which stands open in this file's `auto` mode, and the
// state is asserted LITERALLY rather than as a before/after comparison read off
// the same helper: a neighbour that vanished with the click would read "" on
// both sides of such a comparison and the case would pass on a broken tab.
test("test_closing_dac_correction_leaves_a_neighbouring_cards_disclosure_alone", async () => {
  await reset();
  ensure(DAC, "open");
  clickHead(DAC);
  assert.equal(stateOf(tab(), "pcm-chain"), "open");
});
