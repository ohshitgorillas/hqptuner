// Behavioral suite for WHICH WIDGET each LIVE page dropdown renders, closed,
// server-side. A chain control whose schema entry carries `desc` — the PCM/SDM
// filters and the modulator — renders the custom combobox (button class
// "dd-box", role="combobox") in place of a native <select>; a dropdown whose
// entry has no `desc` — the rate pair — keeps its native <select>. Of the two
// pickers that are not schema desc entries at all, the matrix profile picker is
// native and the live preset picker is a combobox.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. SSR reaches the CLOSED state only — the popup opens from a handler
// SSR never fires — so open-state behavior belongs to the browser hand-back
// protocol, not here (same boundary as combobox.test.js).
//
// The anchors are what a user reads: a control is located by its `<label>` and
// measured to the next label, so a restructured row that still says the same
// thing still measures, and a missing label throws rather than quietly
// measuring some other control.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/livecombobox.test.js

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
import { livePresets, livePresetsBusy, livePresetError } from "../../../hqptuner/static/store/live/presets.js";
import { staticWire } from "../support/wire.js";
import { rec } from "../support/livepresetwire.js";
import { labeled } from "../support/markup.js";
import { section } from "../support/tabform.js";

// The two chains number the same filters differently, so each column's options
// come from its own source (livechain.test.js); this suite only needs every
// dropdown present, so the engine runs `[source]` and both chain cards render
// open.
const PCM_FILTERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "40", name: "poly-sinc-gauss-long" },
];
const SDM_FILTERS = [
  { index: "0", value: "38", name: "poly-sinc-gauss-long" },
  { index: "1", value: "23", name: "sinc-M" },
];
const PCM_SHAPERS = [{ index: "0", value: "0", name: "none" }];
const SDM_SHAPERS = [{ index: "0", value: "3", name: "ASDM7EC" }];

const ENUMS = {
  filters: PCM_FILTERS,
  shapers: PCM_SHAPERS,
  rates: [
    { index: "0", rate: "0" },
    { index: "1", rate: "96000" },
  ],
  junk_filters: [{ index: "0", value: "0", name: "none" }],
  mode: { name: "[source]" },
};

const METADATA = {
  settings: {
    output: {
      output_mode: { label: "Output mode", tooltip: "Selects default output mode." },
      rate: { label: "Output rate", tooltip: "Output sample rate request, or upper limit." },
      junk_filter: { label: "High-frequency filter", tooltip: "Playback filters for noise.", options: { 0: "None." } },
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
};

const STATE = {
  mode: "0",
  filter1x: "0",
  filterNx: "1",
  shaper: "0",
  rate: "1",
  filter_junk: "0",
  adaptive: "0",
  volume: "-10.0",
  active_chain: "pcm",
};

// The daemon's /config form: every field carries the option list for its OWN
// chain, which is what the dormant column reads.
/**
 * @param {string} name
 * @param {string} value
 * @param {{ index: string, value: string, name: string }[]} items
 */
const formField = (name, value, items) => ({
  name,
  value,
  options: items.map((i) => ({ value: i.value, label: i.name })),
});
const FIELDS = () => [
  formField("filter1x", "0", PCM_FILTERS),
  formField("filter", "40", PCM_FILTERS),
  formField("dither", "0", PCM_SHAPERS),
  formField("oversampling1x", "38", SDM_FILTERS),
  formField("oversampling", "38", SDM_FILTERS),
  formField("modulator", "3", SDM_SHAPERS),
];

// Total reset: module-level signals outlive a test, so a partial one makes
// cases pass alone and fail in sequence.
/**
 * @param {{ mtx?: Record<string, unknown>, presets?: ReturnType<typeof rec>[] }} [fixture]
 */
async function reset({ mtx = {}, presets = [] } = {}) {
  staticWire({ live: {}, http: {} });
  health.value = { reachable: true, info: {} };
  engineState.value = STATE;
  engineStatus.value = null;
  enums.value = ENUMS;
  metadata.value = METADATA;
  volume.value = "-10.0";
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
  config.value = { fields: FIELDS(), file: { mode: "auto" }, active: "", profiles: null };
  matrixConfig.value = { fields: [], file_profiles: {}, live_profiles: [], live_active: "[Default]", ...mtx };
  liveErrors.value = {};
  liveBusy.value = "";
  liveMode.value = false;
  livePresets.value = presets;
  livePresetsBusy.value = "";
  livePresetError.value = "";
  await discardAll();
}

const page = () => render(html`<${LiveView} />`);

// One control's own markup, by the schema key its field wrapper carries — the
// wire identifier, never the words announcing it (docs/testing.md rule 9). A
// miss throws rather than measuring the page.
/**
 * @param {string} out
 * @param {string} key
 */
const row = (out, key) => labeled(out, key).html;

// One card's own markup, by the id its section carries. The two pickers that
// are not schema entries carry no key, so they are reached through their card.
/**
 * @param {string} out
 * @param {string} id
 */
function card(out, id) {
  const frag = section(out, id);
  if (frag === "") throw new Error(`no card identified "${id}" in the rendered page`);
  return frag;
}

// Opening tag of the first element in `out` whose attributes match `needle`.
/**
 * @param {string} out
 * @param {string} needle
 * @returns {string | null}
 */
const openTag = (out, needle) => {
  const m = new RegExp(`<[a-zA-Z][^>]*${needle}[^>]*>`).exec(out || "");
  return m ? m[0] : null;
};

// The tag name of the form control a keyed field wraps.
/**
 * @param {string} out
 * @param {string} key
 */
function widgetTag(out, key) {
  const m = /<(select|input|button)\b/.exec(row(out, key));
  if (!m) throw new Error(`the field keyed "${key}" wraps no form control`);
  return m[1];
}

/** @param {string} out */
const selects = (out) => [...out.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/g)].map((m) => m[0]);

// --- a desc-bearing chain control renders the custom combobox -----------------
// The LIVE view keys its chain fields per chain, so the Nx filter is reached as
// `pcm_filter_nx` or `sdm_filter_nx` (store/live/derive.js). These three read
// the PCM column: `active_chain` is "pcm" in STATE, so that is the chain the
// engine has loaded and the one whose options come off the live enumeration.

test("test_a_live_filter_control_renders_a_combobox", async () => {
  await reset();
  assert.notEqual(openTag(row(page(), "pcm_filter_nx"), 'role="combobox"'), null);
});

test("test_a_live_filter_controls_combobox_carries_the_dd_box_class", async () => {
  await reset();
  assert.ok(/class="[^"]*\bdd-box\b[^"]*"/.test(row(page(), "pcm_filter_nx")));
});

test("test_a_live_filter_controls_row_carries_no_native_select", async () => {
  await reset();
  assert.equal(/<select\b/.test(row(page(), "pcm_filter_nx")), false);
});

test("test_a_live_modulator_control_renders_a_combobox", async () => {
  await reset();
  assert.notEqual(openTag(row(card(page(), "live-sdm-chain"), "sdm_modulator"), 'role="combobox"'), null);
});

// --- a dropdown with no desc keeps its native select --------------------------
// The rate pair renders as the two per-chain rate columns, keyed per chain.

for (const chain of ["pcm", "sdm"]) {
  test(`test_the_${chain}_rate_control_stays_a_native_select`, async () => {
    await reset();
    assert.equal(widgetTag(page(), `${chain}_rate`), "select");
  });
}

// --- the two pickers that are not schema entries ------------------------------
// Neither carries a schema key, so each is reached through its own card. The
// matrix profile picker is native; the live preset picker is a combobox.

test("test_the_matrix_profile_picker_stays_a_native_select", async () => {
  await reset({ mtx: { file_profiles: { Room: { rows: [], post: {} } }, live_profiles: ["Room"] } });
  assert.equal(selects(card(page(), "matrix-profile")).length, 1);
});

test("test_the_live_preset_picker_renders_a_combobox", async () => {
  await reset({ presets: [rec("Living Room", "pcm")] });
  assert.notEqual(openTag(card(page(), "live-mode"), 'role="combobox"'), null);
});

test("test_the_matrix_profile_picker_offers_the_loaded_profile", async () => {
  // The picker being a select is only worth pinning if it is the picker: its
  // option list carries the profile the daemon loaded.
  await reset({ mtx: { file_profiles: { Room: { rows: [], post: {} } }, live_profiles: ["Room"] } });
  assert.ok(selects(card(page(), "matrix-profile")).some((s) => s.includes(">Room<")));
});
