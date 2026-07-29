// Behavioral suite for the LIVE page's two chain cards — store/live.js's
// `pcmChain` / `sdmChain` and the cards components/LiveView.js renders from
// them.
//
// The engine can only be asked about the chain it has LOADED: GetFilters and
// GetShapers enumerate the active mode's chain alone, and the two chains number
// the same names differently (protocol.md §4 — `poly-sinc-gauss-long` is enum 40
// under PCM `filter`, 38 under SDM `oversampling`). The page shows both anyway,
// so the dormant chain's controls read the running configuration and the
// daemon's own /config form instead of the engine's lists.
//
// Three sources answer for a dormant control and every fixture below keeps them
// apart, because a control reading the wrong one is exactly the defect:
//   - `engineState` + `enums` — the LOADED chain, and nothing else;
//   - `config.file` — the running configuration WITH what LIVE is holding
//     overlaid on it (liveoverrides.live_overrides), which is the only lane a
//     held edit reaches the frontend by;
//   - `config.fields` — the daemon's raw /config form, which carries each
//     chain's own option list.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire — the exported signals carry the shapes /api/state, /api/enumerations
// and /api/config actually serve.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/livechain.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../hqptuner/static/lib/dom.js";
import { LiveView } from "../../hqptuner/static/components/LiveView.js";
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
  discardAll,
} from "../../hqptuner/static/store/state.js";
import { liveModel, liveErrors, liveBusy } from "../../hqptuner/static/store/live.js";
import { staticWire } from "./wire.js";

// The daemon's two chain enumerations, verbatim in their numbering: the same
// two filters carry different enum IDs and sit at different indices on each
// chain, which is the whole reason the dormant chain cannot borrow the loaded
// one's list.
const PCM_FILTERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "40", name: "poly-sinc-gauss-long" },
  { index: "2", value: "25", name: "sinc-M" },
];
const PCM_SHAPERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "5", name: "NS9" },
];
const SDM_FILTERS = [
  { index: "0", value: "38", name: "poly-sinc-gauss-long" },
  { index: "1", value: "23", name: "sinc-M" },
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

const base = { rates: RATES, junk_filters: JUNK };
const PCM_ENUMS = () => ({ ...base, filters: PCM_FILTERS, shapers: PCM_SHAPERS, mode: { name: "PCM" } });
const SDM_ENUMS = () => ({ ...base, filters: SDM_FILTERS, shapers: SDM_SHAPERS, mode: { name: "SDM (DSD)" } });
// `[source]`: the configured mode is 0 whatever chain the source left loaded.
const AUTO_PCM_ENUMS = () => ({ ...PCM_ENUMS(), mode: { name: "[source]" } });
const AUTO_SDM_ENUMS = () => ({ ...SDM_ENUMS(), mode: { name: "[source]" } });

// State reports the LIST INDEX of the loaded chain's filter and shaper, and
// nothing at all about the chain that is not loaded.
const STATE = ({ mode = "1", chain = "pcm", filterNx = "2" } = {}) => ({
  mode,
  filter1x: "1",
  filterNx,
  shaper: "1",
  rate: "1",
  filter_junk: "0",
  adaptive: "0",
  volume: "-10.0",
  active_chain: chain,
});

// The /config form as the daemon serves it: every field carries the option list
// for its OWN chain, in the enum-ID domain the config file speaks.
const formField = (name, value, items) => ({
  name,
  value,
  options: items.map((i) => ({ value: i.value, label: i.name })),
});

const FORM = { filter1x: "40", filter: "40", dither: "5", oversampling1x: "38", oversampling: "38", modulator: "3" };
const LISTS = {
  filter1x: PCM_FILTERS,
  filter: PCM_FILTERS,
  dither: PCM_SHAPERS,
  oversampling1x: SDM_FILTERS,
  oversampling: SDM_FILTERS,
  modulator: SDM_SHAPERS,
};

const FIELDS = (over = {}) =>
  Object.entries({ ...FORM, ...over }).map(([name, value]) => formField(name, value, LISTS[name]));

// `file` is the running configuration with the live lane's overrides on top, so
// a value held for the dormant chain shows up HERE and in no other source. Each
// scenario gives the field it asserts on a value the form field does not carry,
// so a control reading the raw form cannot pass by accident.
const FILE = (mode, over = {}) => ({ mode, ...FORM, ...over });

const METADATA = {
  settings: {
    output: { output_mode: { label: "Output mode", tooltip: "Selects default output mode." } },
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

// Total reset: module-level signals outlive a test file, so a partial one makes
// cases pass alone and fail in sequence. `staged` is private and is cleared
// through the faked /api/config/pending, via discardAll().
async function reset({ chain = "pcm", mode = "1", lists, cfgMode = "pcm", form = {}, file = {}, filterNx } = {}) {
  staticWire({ live: {}, http: {} });
  health.value = { reachable: true, info: {} };
  engineState.value = STATE({ mode, chain, filterNx });
  engineStatus.value = null;
  enums.value = lists || PCM_ENUMS();
  metadata.value = METADATA;
  volume.value = "-10.0";
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
  config.value = { fields: FIELDS(form), file: FILE(cfgMode, file), active: "", profiles: null };
  matrixConfig.value = { fields: [], file_profiles: {}, live_profiles: [] };
  liveErrors.value = {};
  liveBusy.value = "";
  await discardAll();
}

// The engine in PCM: State's filterNx is index 2 of the PCM list (enum 25), and
// the SDM column's 23 lives only in `file` — an edit LIVE is holding for the
// chain that is not loaded.
const PCM_RUNNING = { chain: "pcm", mode: "1", lists: PCM_ENUMS(), cfgMode: "pcm", file: { oversampling: "23" } };
// The mirror, with the dormant PCM column's held 25 in `file` alone. 25 is
// neither the form's 40, nor the engine's 23 (index 1 of the SDM list), nor the
// head of the PCM list — so no fallback produces it.
const SDM_RUNNING = {
  chain: "sdm",
  mode: "2",
  lists: SDM_ENUMS(),
  cfgMode: "sdm",
  filterNx: "1",
  file: { filter: "25" },
};
const NOTHING_LOADED = { chain: null, mode: "0", lists: AUTO_PCM_ENUMS(), cfgMode: "auto" };
// [source] mid-playback, the normal case: the configured mode is auto and the
// source has left the SDM chain loaded, so the PCM chain IS the dormant one.
const AUTO_SDM_LOADED = { chain: "sdm", mode: "0", lists: AUTO_SDM_ENUMS(), cfgMode: "auto", filterNx: "1" };

const fields = (chain) => liveModel.value[chain].map((c) => c.field);
const control = (field) => [...liveModel.value.pcmChain, ...liveModel.value.sdmChain].find((c) => c.field === field);

// --- each chain carries its own three controls --------------------------------

test("test_the_sdm_chain_carries_its_own_three_controls_while_the_engine_runs_pcm", async () => {
  await reset(PCM_RUNNING);
  assert.deepEqual(fields("sdmChain"), ["oversampling1x", "oversampling", "modulator"]);
});

test("test_the_pcm_chain_carries_its_own_three_controls_while_the_engine_runs_sdm", async () => {
  await reset(SDM_RUNNING);
  assert.deepEqual(fields("pcmChain"), ["filter1x", "filter", "dither"]);
});

test("test_the_pcm_chain_carries_its_controls_with_no_chain_loaded", async () => {
  // [source] before playback starts: a page that offered only the loaded chain's
  // controls would be empty.
  await reset(NOTHING_LOADED);
  assert.deepEqual(fields("pcmChain"), ["filter1x", "filter", "dither"]);
});

test("test_the_sdm_chain_carries_its_controls_with_no_chain_loaded", async () => {
  await reset(NOTHING_LOADED);
  assert.deepEqual(fields("sdmChain"), ["oversampling1x", "oversampling", "modulator"]);
});

// --- which source each column reads ------------------------------------------

test("test_the_loaded_sdm_column_reads_the_filter_the_engine_reported", async () => {
  // State says index 1 of the SDM list, which is enum 23; the configuration says
  // 38, so a column reading it here shows the wrong filter.
  await reset(SDM_RUNNING);
  assert.equal(control("oversampling").value, "23");
});

test("test_the_dormant_sdm_column_reads_the_running_configuration", async () => {
  // The engine has the PCM chain loaded and cannot answer for the SDM one at
  // all; the form field says 38, and only `file` carries what LIVE is holding.
  await reset(PCM_RUNNING);
  assert.equal(control("oversampling").value, "23");
});

test("test_the_dormant_pcm_column_reads_the_running_configuration", async () => {
  // The mirror: a store that sourced one chain from State and the other from the
  // configuration regardless of which is loaded passes one of these and fails
  // the other.
  await reset(SDM_RUNNING);
  assert.equal(control("filter").value, "25");
});

test("test_the_dormant_sdm_column_offers_its_own_chains_options", async () => {
  // The engine's list is the PCM chain's (0/40/25); the SDM chain numbers its
  // filters 38/23, and only the daemon's /config form can say so while the
  // chain is dormant.
  await reset(PCM_RUNNING);
  assert.deepEqual(
    control("oversampling").options.map((o) => o.value),
    ["38", "23"],
  );
});

test("test_the_dormant_pcm_column_offers_its_own_chains_options", async () => {
  await reset(SDM_RUNNING);
  assert.deepEqual(
    control("filter").options.map((o) => o.value),
    ["0", "40", "25"],
  );
});

// --- a dormant control is still a control -------------------------------------
// An edit to the chain the engine has not loaded is remembered and written when
// that chain loads, so there is nothing to gray out.

test("test_the_dormant_sdm_control_is_not_disabled", async () => {
  await reset(PCM_RUNNING);
  assert.equal(Boolean(control("oversampling").disabled), false);
});

test("test_the_dormant_pcm_control_is_not_disabled", async () => {
  await reset(SDM_RUNNING);
  assert.equal(Boolean(control("filter").disabled), false);
});

// --- the rendered page --------------------------------------------------------

const page = () => render(html`<${LiveView} />`);

// A card head is `class="card-head">Title</div>`, or the collapsible form with
// the disclosure triangle ahead of the title (components/tabs/common.js).
const head = (title) => new RegExp(`class="card-head">(<span class="tri">.</span> )?${title}</(div|button)>`);

const MARK = '<section class="card ';

// A named card's disclosure, off its own section's class. A miss throws rather
// than reporting some other card's state: a renamed head or a restructured card
// must fail loudly, not quietly measure the wrong thing.
function cardState(out, title) {
  const at = out.search(head(title));
  if (at < 0) throw new Error(`no card headed "${title}" in the rendered page`);
  const mark = out.lastIndexOf(MARK, at);
  if (mark < 0) throw new Error(`the card headed "${title}" is not inside a card section`);
  return out.slice(mark + MARK.length).split('"')[0];
}

test("test_the_page_carries_a_pcm_chain_card_while_the_engine_runs_sdm", async () => {
  await reset(SDM_RUNNING);
  assert.ok(head("PCM Chain").test(page()));
});

test("test_the_page_carries_an_sdm_chain_card_while_the_engine_runs_pcm", async () => {
  await reset(PCM_RUNNING);
  assert.ok(head("SDM Chain").test(page()));
});

test("test_the_pcm_card_is_open_in_pcm_output_mode", async () => {
  await reset(PCM_RUNNING);
  assert.equal(cardState(page(), "PCM Chain"), "open");
});

test("test_the_sdm_card_is_collapsed_in_pcm_output_mode", async () => {
  await reset(PCM_RUNNING);
  assert.equal(cardState(page(), "SDM Chain"), "closed");
});

test("test_the_sdm_card_is_open_in_sdm_output_mode", async () => {
  await reset(SDM_RUNNING);
  assert.equal(cardState(page(), "SDM Chain"), "open");
});

test("test_the_pcm_card_is_collapsed_in_sdm_output_mode", async () => {
  await reset(SDM_RUNNING);
  assert.equal(cardState(page(), "PCM Chain"), "closed");
});

// [source] follows the source, so neither chain can be called the dormant one
// and collapsing either would hide controls the next track needs.

test("test_the_pcm_card_is_open_in_auto_output_mode", async () => {
  await reset(NOTHING_LOADED);
  assert.equal(cardState(page(), "PCM Chain"), "open");
});

test("test_the_sdm_card_is_open_in_auto_output_mode", async () => {
  await reset(NOTHING_LOADED);
  assert.equal(cardState(page(), "SDM Chain"), "open");
});

test("test_the_pcm_card_stays_open_in_auto_output_mode_while_the_engine_runs_sdm", async () => {
  // The case the feature exists for: auto mid-playback, the source having left
  // the SDM chain loaded. The PCM controls are the ones whose edits are held,
  // so collapsing them is collapsing the thing the user came to do.
  await reset(AUTO_SDM_LOADED);
  assert.equal(cardState(page(), "PCM Chain"), "open");
});
