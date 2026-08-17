// Behavioral suite for the width class a dropdown field carries — the schema's
// `compact` property, rendered as the class pair `compact compact-<size>` on the
// field element, on the LIVE page (components/live/View.js).
//
// Without the class a combobox trigger is content-sized, so its width changes
// with the selection and the control moves under the cursor. The sizes below are
// the ones each schema entry asks for, spelled out rather than read back.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Every case drives the exported store signals carrying the shapes
// /api/state, /api/enumerations and /api/config actually serve; nothing of ours
// is stubbed.
//
// The anchors are what a user reads — a card by its head, a control by its
// `<label>` — and the question asked is of the field root that control is
// rendered in: which `compact*` class tokens does the single element enclosing
// this label carry? That is the element the CSS sizes, so a class parked on a
// shared row or card wrapper sizes nothing and is caught by the case that asks
// for none.
//
// The engine runs `[source]`, so both chain cards render open and every chain
// control is on the page at once (livechain.test.js pins that collapse rule).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/livecompact.test.js

import test from "node:test";
import assert from "node:assert/strict";
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
import { PCM_FILTERS, PCM_SHAPERS, JUNK, formField, FORM, LISTS } from "../support/chainenums.js";
import { classes, elements, enclosing, labelled, text } from "../support/markup.js";

const PROSE = { label: "", tooltip: "prose." };
const METADATA = {
  settings: {
    output: {
      junk_filter: { ...PROSE, label: "High-frequency filter", options: { 0: "No filtering." } },
      rate: { ...PROSE, label: "Output rate" },
    },
    dsp: {
      filter_1x: { ...PROSE, label: "1x filter" },
      filter_nx: { ...PROSE, label: "Nx filter" },
      shaper: { ...PROSE, label: "Dither" },
    },
    volume: { adaptive_volume: { ...PROSE, label: "Adaptive volume" } },
  },
  filters: { filters: {}, aliases: {} },
  shapers: { pcm_dithers: {}, sdm_modulators: {} },
};

// `[source]`: the configured mode is 0 and the source has left the PCM chain
// loaded, so both chain cards render their own controls.
const STATE = {
  mode: "0",
  filter1x: "1",
  filterNx: "2",
  shaper: "1",
  rate: "1",
  filter_junk: "0",
  adaptive: "0",
  volume: "-10.0",
  active_chain: "pcm",
};

const ENUMS = {
  filters: PCM_FILTERS,
  shapers: PCM_SHAPERS,
  rates: [
    { index: "0", rate: "0" },
    { index: "1", rate: "96000" },
  ],
  junk_filters: JUNK,
  mode: { name: "[source]" },
};

// Total reset: module-level signals outlive a test, so a partial one makes cases
// pass alone and fail in sequence. `staged` is private — it is cleared through
// the faked /api/config/pending, via discardAll().
async function reset() {
  staticWire({ live: {}, http: {} });
  health.value = { reachable: true, info: {} };
  engineState.value = STATE;
  engineStatus.value = null;
  enums.value = ENUMS;
  metadata.value = METADATA;
  volume.value = "-10.0";
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
  config.value = {
    fields: Object.entries(FORM).map(([name, value]) => formField(name, value, LISTS[name])),
    file: { mode: "auto", ...FORM },
    active: "",
    profiles: null,
  };
  matrixConfig.value = { fields: [], file_profiles: {}, live_profiles: [] };
  liveErrors.value = {};
  liveBusy.value = "";
  liveMode.value = false;
  await discardAll();
}

const page = () => render(html`<${LiveView} />`);

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// The title a card head announces: its own text, less the disclosure triangle a
// collapsible head carries ahead of it (components/common.js).
/** @param {MarkupElement} el */
const title = (el) => text(el).replace(/^[^\p{L}\p{N}]+/u, "");

// One card's own markup: the smallest element enclosing its head. A miss throws
// rather than handing back the page, so a renamed head fails loudly instead of
// quietly measuring some other card.
/**
 * @param {string} out
 * @param {string} want
 */
function card(out, want) {
  const hit = elements(out).find((el) => classes(el).includes("card-head") && title(el) === want);
  if (!hit) throw new Error(`no card headed "${want}" in the rendered page`);
  return enclosing(out, hit).html;
}

const isCompact = (/** @type {string} */ c) => c === "compact" || c.startsWith("compact-");

// The `compact*` class tokens carried by the field root a control is rendered
// in — the single smallest element enclosing its label — sorted so the answer
// does not depend on the order a class list is assembled in.
/**
 * @param {string} fragment
 * @param {string} label
 * @returns {string[]}
 */
function compactOf(fragment, label) {
  const root = enclosing(fragment, labelled(fragment, label));
  return [...new Set(classes(root).filter(isCompact))].sort();
}

const LG = ["compact", "compact-lg"];
const MD = ["compact", "compact-md"];
const SM = ["compact", "compact-sm"];

// --- the LIVE page's chain controls -------------------------------------------
// A chain filter's option labels are the longest on the page and vary most in
// length, so these are the columns the jitter shows on.

/** @type {[string, string, string[]][]} */
const CHAIN = [
  ["PCM Chain", "1x filter", LG],
  ["PCM Chain", "Nx filter", LG],
  ["SDM Chain", "1x filter", LG],
  ["SDM Chain", "Nx filter", LG],
  ["PCM Chain", "Dither", SM],
  ["SDM Chain", "Sigma-delta modulator", MD],
];

for (const [head, label, want] of CHAIN) {
  const name = `${head} ${label}`.toLowerCase().replace(/[ -]/g, "_");
  test(`test_the_live_${name}_field_carries_its_schemas_compact_size`, async () => {
    await reset();
    assert.deepEqual(compactOf(card(page(), head), label), want);
  });
}

// --- the LIVE page's Playback card ---------------------------------------------

test("test_the_live_high_frequency_filter_field_carries_its_schemas_compact_size", async () => {
  await reset();
  assert.deepEqual(compactOf(card(page(), "Playback"), "High-frequency filter"), SM);
});

// The discriminating half: a control whose schema entry carries no `compact` at
// all. A class parked on the card rather than on the field passes every case
// above and fails here.
test("test_a_live_field_whose_schema_entry_has_no_compact_size_carries_no_compact_class", async () => {
  await reset();
  assert.deepEqual(compactOf(card(page(), "Playback"), "Adaptive volume"), []);
});
