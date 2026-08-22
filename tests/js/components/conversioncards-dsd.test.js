// Behavioral suite for the DSD half of each chain card on the Output tab: the
// "DSD Sources" subsection is a disclosure, closed unless the user has said
// their library holds DSD files, its AUTOMATIC driver is the narrow bar's
// source-format facet, and its subhead is a per-card toggle over that. The
// "PCM Sources" half is not a disclosure at all — every library has PCM in it.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. The cards are internal composition of the exported `Output`, so
// every case goes through `Output`, driven by the exported store signals
// (`config` carrying the daemon's own /config form, `nSrcFormat` carrying the
// facet) over a faked wire on the real REST paths. Nothing is stubbed.
//
// A subsection is read as OPEN when the controls of that chain's DSD half are on
// screen — the noise filter for PCM output, direct SDM for SDM output, both of
// them pinned as that subsection's contents by conversioncards.test.js. That is
// what "the body renders only when open" means to a reader.
//
// There is no exported collapse API and there is no DOM here, so a subsection is
// toggled the way a caller toggles one: by invoking the onClick its subhead
// button carries, collected through preact's own `options.vnode` hook — the
// renderer's public seam, third-party surface, not ours. Which of the two
// subhead buttons belongs to which card is never assumed: a toggle is applied by
// pressing a candidate, re-reading what moved, and undoing the press when it
// moved the other card, so a case that goes on to assert is standing on a
// subsection it really did toggle.
//
// The override a press writes is module-level state that outlives a test, so
// `reset()` clears it the way a user does — by moving the facet and moving it
// back — and refuses to hand a case a starting state it did not ask for.
//
// Every card is rendered in `auto` output mode, where both chain cards are open,
// so a closed DSD half is the subsection's own doing rather than its card's.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/conversioncards-dsd.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { options } from "preact";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Output } from "../../../hqptuner/static/components/tabs/OutputTab.js";
import { config, matrixConfig, metadata, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { resetNarrowing, nSrcFormat } from "../../../hqptuner/static/store/narrow/state.js";
import { stagingWire } from "../support/wire.js";
import { formFields, section } from "../support/tabform.js";
import { SUBHEADS, subsection, subheadButtons, vnodeText } from "../support/chainsubsections.js";

/** @typedef {import("../support/wheel.js").VNode} VNode */

const [FROM_PCM, FROM_DSD] = SUBHEADS;
const PCM = "PCM Chain";
const SDM = "SDM Chain";

// One control from each chain's DSD half, as that half renders it, keyed by the
// title in the card's head.
/** @type {Record<string, string>} */
const MARK = {
  [PCM]: "<label>Noise filter<",
  [SDM]: "<label>DSD Playback</label>",
};

// The daemon's /config form fields the chain cards render, each with its own
// option list so the cards have real dropdowns under them.
const CHAINS = {
  filter1x: { value: "1", options: [{ value: "1", label: "poly-sinc-gauss-long" }] },
  filter: { value: "2", options: [{ value: "2", label: "poly-sinc-xtr-mp" }] },
  oversampling1x: { value: "3", options: [{ value: "3", label: "poly-sinc-short-mp" }] },
  oversampling: { value: "4", options: [{ value: "4", label: "closed-form-M" }] },
};

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
 * Whether one card's DSD half has its body on screen.
 *
 * @param {string} out
 * @param {string} card
 * @returns {boolean}
 */
const dsdOpen = (out, card) => subsection(section(out, card), FROM_DSD).includes(MARK[card]);

/**
 * The two DSD subheads a reader can press, in the order they were built.
 *
 * @returns {((event: object) => void)[]}
 */
function dsdToggles() {
  const heads = renderTab().seen.filter(
    (v) =>
      v &&
      v.type === "button" &&
      v.props &&
      typeof v.props.onClick === "function" &&
      vnodeText(v).trim().endsWith(FROM_DSD),
  );
  if (heads.length !== 2) throw new Error(`expected two "${FROM_DSD}" toggles, found ${heads.length}`);
  return heads.map((v) => /** @type {(event: object) => void} */ (v.props.onClick));
}

/** @param {number} at */
const press = (at) => dsdToggles()[at]({ preventDefault() {}, stopPropagation() {} });

/**
 * Toggle the named card's DSD half, whichever of the two subheads carries it: a
 * press that moved the other card is undone before the next is tried.
 *
 * @param {string} card
 */
function toggleDsd(card) {
  const before = dsdOpen(tab(), card);
  for (const at of [0, 1]) {
    press(at);
    if (dsdOpen(tab(), card) !== before) return;
    press(at);
  }
  throw new Error(`no "${FROM_DSD}" subhead toggles the ${card} card`);
}

/**
 * Every case starts from a stated facet with no override standing: a facet
 * change is what drops one, so moving the facet and moving it back clears
 * whatever a previous case pressed.
 *
 * What that leaves on screen is deliberately NOT checked here — it is the
 * subject of the cases below, and a harness that guaranteed it would leave them
 * asserting something they could not fail.
 *
 * @param {{ srcFormat?: string }} [start]
 */
async function reset({ srcFormat = "pcm" } = {}) {
  stagingWire();
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  resetNarrowing();
  matrixConfig.value = { fields: [] };
  config.value = { fields: formFields(CHAINS), file: { mode: "auto" }, active: "", profiles: null };
  await discardAll();
  nSrcFormat.value = "both";
  nSrcFormat.value = "pcm";
  nSrcFormat.value = srcFormat;
}

/** @param {string} card */
const name = (card) => (card === PCM ? "pcm" : "sdm");

// --- which subhead is a disclosure --------------------------------------------

for (const card of [PCM, SDM]) {
  test(`test_the_${name(card)}_cards_dsd_sources_subhead_is_a_button`, async () => {
    await reset();
    assert.equal(subheadButtons(tab(), card, FROM_DSD).length, 1);
  });

  test(`test_the_${name(card)}_cards_pcm_sources_subhead_is_no_button`, async () => {
    await reset();
    assert.deepEqual(subheadButtons(tab(), card, FROM_PCM), []);
  });
}

// --- closed until the user says their library holds DSD -------------------------

for (const card of [PCM, SDM]) {
  test(`test_the_${name(card)}_cards_dsd_sources_body_is_off_screen_at_defaults`, async () => {
    await reset();
    assert.equal(dsdOpen(tab(), card), false);
  });

  test(`test_the_source_format_facet_at_both_opens_the_${name(card)}_cards_dsd_sources`, async () => {
    await reset({ srcFormat: "both" });
    assert.equal(dsdOpen(tab(), card), true);
  });

  test(`test_the_source_format_facet_back_at_pcm_closes_the_${name(card)}_cards_dsd_sources`, async () => {
    await reset({ srcFormat: "both" });
    nSrcFormat.value = "pcm";
    assert.equal(dsdOpen(tab(), card), false);
  });
}

// --- the toggle belongs to one card -------------------------------------------

test("test_opening_the_pcm_cards_dsd_sources_leaves_the_sdm_cards_closed", async () => {
  await reset();
  toggleDsd(PCM);
  assert.equal(dsdOpen(tab(), SDM), false);
});

test("test_opening_the_sdm_cards_dsd_sources_leaves_the_pcm_cards_closed", async () => {
  await reset();
  toggleDsd(SDM);
  assert.equal(dsdOpen(tab(), PCM), false);
});

test("test_collapsing_the_pcm_cards_dsd_sources_leaves_the_sdm_cards_open", async () => {
  await reset({ srcFormat: "both" });
  toggleDsd(PCM);
  assert.equal(dsdOpen(tab(), SDM), true);
});

// --- the facet is still the driver ---------------------------------------------
// The override is the user's answer to the disclosure the facet chose; a new
// source format is a new question. There is no facet change to make while the
// facet already reads "both", so the round trip is what a user does: away, and
// back again.

test("test_the_source_format_facet_at_both_reopens_a_dsd_half_the_user_collapsed", async () => {
  await reset({ srcFormat: "both" });
  toggleDsd(PCM);
  nSrcFormat.value = "pcm";
  nSrcFormat.value = "both";
  assert.equal(dsdOpen(tab(), PCM), true);
});

// The mirror, and the direction that tells a driver from a one-way opener: an
// override the user set at "pcm" is dropped by the round trip just the same, so
// the half they opened by hand is shut again by the facet that never wanted it.
test("test_the_source_format_facet_back_at_pcm_recloses_a_dsd_half_the_user_opened", async () => {
  await reset();
  toggleDsd(PCM);
  nSrcFormat.value = "both";
  nSrcFormat.value = "pcm";
  assert.equal(dsdOpen(tab(), PCM), false);
});
