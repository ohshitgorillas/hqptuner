// Behavioral suite for the LIVE page's RE-ENUMERATION WINDOW as it renders —
// which controls components/LiveView.js grays out while a write that rebuilds
// the engine's menus is in flight, and which it leaves alone.
//
// A write to `mode`, `filter1x`, `filter`, `oversampling1x`, `oversampling` or
// `rate` makes the engine rebuild its filter, shaper and rate enumerations
// (HQPlayer manual §4.6), so between the write landing and the new lists
// arriving every menu ID on the page means something else than it did. The page
// answers by disabling the controls whose options come from an enumeration, and
// by nothing else: the window is surfaced by the graying alone.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. The window is driven by the store's public `liveBusy` — the control
// mid-write — and read off the rendered markup, never off a component flag.
//
// Two arrangements of the engine, because no single one shows everything. In
// PCM output mode the rate columns are live and the SDM card is collapsed; in
// `[source]` both chain cards render open (livechain.test.js) but the rate
// columns are already grayed, the source deciding the rate. So the loaded-vs-
// dormant chain distinction is read in `[source]` and everything else in PCM,
// and each case is anchored against the same page ungrayed.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/live-enumbusy.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { LiveView } from "../../../hqptuner/static/components/LiveView.js";
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
import { liveErrors, liveBusy, writeLive } from "../../../hqptuner/static/store/live.js";
import { ok, bad, staticWire } from "../support/wire.js";

// The two chains number the same filters differently, so the dormant column can
// only read the daemon's own /config form (protocol.md §4).
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

// `[source]`: the configured mode is 0 whatever chain the source left loaded.
const ENUMS = (auto) => ({
  filters: PCM_FILTERS,
  shapers: PCM_SHAPERS,
  rates: [
    { index: "0", rate: "0" },
    { index: "1", rate: "96000" },
  ],
  junk_filters: [{ index: "0", value: "0", name: "none" }],
  mode: { name: auto ? "[source]" : "PCM" },
});

const METADATA = {
  settings: {
    output: {
      output_mode: { label: "Output mode", tooltip: "Selects default output mode." },
      rate: { label: "Output rate", tooltip: "Output sample rate request, or upper limit." },
      junk_filter: {
        label: "High-frequency filter",
        tooltip: "Playback filters for noise.",
        options: { 0: "No filtering." },
      },
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

const STATE = (auto) => ({
  mode: auto ? "0" : "1",
  filter1x: "0",
  filterNx: "1",
  shaper: "0",
  rate: "1",
  filter_junk: "0",
  adaptive: "0",
  volume: "-10.0",
  active_chain: "pcm",
});

// The daemon's /config form: every field carries the option list for its OWN
// chain, which is what the dormant column reads.
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

// A live-lane server for the cases that run a real write to its end. `status`
// makes the daemon refuse instead of reporting; the three re-mirror endpoints
// answer what the signals already hold, so only the window itself moves.
const liveRoutes =
  ({ status = 200 } = {}) =>
  (path) => {
    if (path === "/api/config/live")
      return status === 200 ? ok({ live: [{ setting: "filter", ok: true }], stored: {} }) : bad(status, "no reply");
    if (path === "/api/state") return ok({ data: STATE() });
    if (path === "/api/enumerations") return ok({ data: ENUMS() });
    if (path === "/api/config") return ok({ data: { fields: FIELDS(), file: { mode: "auto" }, active: "" } });
    return undefined;
  };

// Total reset: module-level signals outlive a test, so a partial one makes cases
// pass alone and fail in sequence. `staged` is private — it is mirrored from
// whatever the faked /api/config/pending answers, via discardAll().
async function reset({ busy = "", routes, auto = false } = {}) {
  staticWire({ live: {}, http: {} }, routes);
  health.value = { reachable: true, info: {} };
  engineState.value = STATE(auto);
  engineStatus.value = null;
  enums.value = ENUMS(auto);
  metadata.value = METADATA;
  volume.value = "-10.0";
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
  config.value = { fields: FIELDS(), file: { mode: auto ? "auto" : "pcm" }, active: "", profiles: null };
  matrixConfig.value = { fields: [], file_profiles: {}, live_profiles: [] };
  liveErrors.value = {};
  liveBusy.value = busy;
  await discardAll();
}

const page = () => render(html`<${LiveView} />`);

// A named card's own markup, so the two chain cards' identically labelled
// controls cannot be confused. A miss throws rather than measuring some other
// card: a renamed head must fail loudly.
function card(out, title) {
  const at = out.indexOf(`${title}</button>`);
  if (at < 0) throw new Error(`no card headed "${title}" in the rendered page`);
  const end = out.indexOf("<section", at);
  return out.slice(at, end < 0 ? undefined : end);
}

const FIELD = '<div class="field"';
const WIDGET = '<div class="control">';

// The opening tag of the widget a labelled field wraps — `<select disabled` or
// `<select`. Read off the widget alone, never the whole field: a filter field
// also carries the narrowing tickboxes, which disable on their own account.
function widget(out, label) {
  const at = out.search(new RegExp(`<label>${label}(<|</label>)`));
  if (at < 0) throw new Error(`no field labelled "${label}" in the markup given`);
  const block = out.slice(out.lastIndexOf(FIELD, at));
  return block.slice(block.indexOf(WIDGET) + WIDGET.length).split(">")[0];
}

const grayed = (out, label) => widget(out, label).includes(" disabled");

// The whole of a labelled field. The output-mode switch is a segment, so its
// refusal lands on the buttons inside rather than on the wrapper the widget
// helper reads; this field carries nothing else that could disable.
function field(out, label) {
  const at = out.search(new RegExp(`<label>${label}(<|</label>)`));
  if (at < 0) throw new Error(`no field labelled "${label}" in the markup given`);
  const from = out.lastIndexOf(FIELD, at);
  const next = out.indexOf(FIELD, at);
  return out.slice(from, next < 0 ? undefined : next);
}

// --- every control that reads an enumeration grays out ------------------------
// The field in flight is never the field asserted on, so each control below is
// graying on the window's account and not its own. Each case is paired with the
// same page idle, so a control that was already gray for its own reasons cannot
// pass one of these by standing still.

const CHAIN = ["1x filter", "Nx filter", "Dither"];

for (const label of CHAIN) {
  const name = label.toLowerCase().replace(/ /g, "_");

  test(`test_the_loaded_chains_${name}_grays_out_during_a_re_enumerating_write`, async () => {
    await reset({ auto: true, busy: "rate" });
    assert.equal(grayed(card(page(), "PCM Chain"), label), true);
  });

  test(`test_the_loaded_chains_${name}_is_not_grayed_with_no_write_in_flight`, async () => {
    await reset({ auto: true });
    assert.equal(grayed(card(page(), "PCM Chain"), label), false);
  });
}

test("test_the_high_frequency_filter_grays_out_during_a_re_enumerating_write", async () => {
  await reset({ busy: "filter1x" });
  assert.equal(grayed(page(), "High-frequency filter"), true);
});

test("test_the_pcm_rate_column_grays_out_during_a_re_enumerating_write", async () => {
  await reset({ busy: "filter1x" });
  assert.equal(grayed(page(), "PCM"), true);
});

test("test_the_sdm_rate_column_grays_out_during_a_re_enumerating_write", async () => {
  await reset({ busy: "filter1x" });
  assert.equal(grayed(page(), "SDM"), true);
});

test("test_the_pcm_rate_column_is_not_grayed_with_no_write_in_flight", async () => {
  await reset();
  assert.equal(grayed(page(), "PCM"), false);
});

test("test_the_sdm_rate_column_is_not_grayed_with_no_write_in_flight", async () => {
  await reset();
  assert.equal(grayed(page(), "SDM"), false);
});

test("test_the_high_frequency_filter_is_not_grayed_with_no_write_in_flight", async () => {
  await reset();
  assert.equal(grayed(page(), "High-frequency filter"), false);
});

// --- the chain the engine has not loaded is untouched -------------------------
// Its options come from the running configuration, which no re-enumeration
// touches, and its edits are held until that chain loads.

const DORMANT = ["1x filter", "Nx filter", "Sigma-delta modulator"];

for (const label of DORMANT) {
  const name = label.toLowerCase().replace(/[ -]/g, "_");
  test(`test_the_dormant_chains_${name}_stays_live_during_a_re_enumerating_write`, async () => {
    await reset({ auto: true, busy: "rate" });
    assert.equal(grayed(card(page(), "SDM Chain"), label), false);
  });
}

// --- controls that read no list at all ----------------------------------------

test("test_adaptive_volume_stays_live_during_a_re_enumerating_write", async () => {
  await reset({ busy: "filter1x" });
  assert.equal(grayed(page(), "Adaptive volume"), false);
});

test("test_the_output_mode_switch_stays_live_during_another_fields_re_enumerating_write", async () => {
  await reset({ busy: "filter1x" });
  assert.equal(field(page(), "Mode").includes("disabled"), false);
});

// --- a write that rebuilds nothing grays nothing else -------------------------

test("test_a_plain_write_leaves_the_loaded_chains_filter_live", async () => {
  await reset({ busy: "junk_filter" });
  assert.equal(grayed(card(page(), "PCM Chain"), "Nx filter"), false);
});

test("test_a_plain_write_leaves_the_pcm_rate_column_live", async () => {
  await reset({ busy: "junk_filter" });
  assert.equal(grayed(page(), "PCM"), false);
});

test("test_a_plain_write_leaves_the_sdm_rate_column_live", async () => {
  await reset({ busy: "junk_filter" });
  assert.equal(grayed(page(), "SDM"), false);
});

test("test_a_plain_write_grays_the_control_it_is_writing", async () => {
  await reset({ busy: "junk_filter" });
  assert.equal(grayed(page(), "High-frequency filter"), true);
});

// --- the window closes when the write does ------------------------------------

test("test_nothing_is_left_grayed_once_a_re_enumerating_write_succeeds", async () => {
  await reset({ routes: liveRoutes() });
  await writeLive("filter", "40");
  assert.equal(grayed(card(page(), "PCM Chain"), "Nx filter"), false);
});

test("test_nothing_is_left_grayed_once_a_re_enumerating_write_is_refused", async () => {
  await reset({ routes: liveRoutes({ status: 503 }) });
  await writeLive("filter", "40");
  assert.equal(grayed(card(page(), "PCM Chain"), "Nx filter"), false);
});

// --- the window says nothing ---------------------------------------------------
// The graying is the whole of it: no caption, note or status text appears while
// it is open, so the page's text is the same text either way.

const words = (out) => out.replace(/<[^>]*>/g, "");

test("test_the_window_adds_no_text_to_the_page", async () => {
  await reset();
  const idle = words(page());
  liveBusy.value = "filter1x";
  assert.equal(words(page()), idle);
});
