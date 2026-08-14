// Behavioral suite for components/LiveView.js and the LIVE switch in
// components/App.js — the mode's rendered contract: what the switch replaces,
// which chain's controls the page offers, and how a write in flight or refused
// reads on its control.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. The page is driven by the exported store signals carrying the shapes
// /api/state, /api/enumerations and /api/matrix actually serve; the switch is
// driven by the exported `liveMode` pref.
//
// `profileBusy` and `profileError` in LiveView are module-private and written
// only from the profile picker's own handlers, which SSR never fires — so the
// "switching…" mark and a failed switch are not observable here and are not
// reached by widening the module. The equivalent state on the LIVE controls IS
// observable, because `liveBusy` / `liveErrors` are the store's public surface
// (store/live/state.js) rather than this component's internals. The picker's own
// in-flight behaviour belongs to the playwright hand-back protocol.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/liveview.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { App } from "../../../hqptuner/static/components/App.js";
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
import { liveErrors, liveBusy } from "../../../hqptuner/static/store/live/state.js";
import { liveMode } from "../../../hqptuner/static/store/prefs.js";
import { staticWire } from "../support/wire.js";
import { attrOf, grayReason } from "../support/field-harness.js";
import { classes, elements, enclosing, labelled, text } from "../support/markup.js";

const ENUMS = {
  filters: [
    { index: "0", value: "0", name: "none" },
    { index: "1", value: "40", name: "poly-sinc-gauss-long" },
  ],
  shapers: [{ index: "0", value: "0", name: "none" }],
  rates: [
    { index: "0", rate: "0" },
    { index: "1", rate: "96000" },
  ],
  junk_filters: [{ index: "0", value: "0", name: "none" }],
  mode: { name: "PCM" },
};

// The prose the page joins to: settings.json's per-control label and tooltip,
// plus the two name-keyed overlays a selection's description comes from. Shipped
// prose is long; these are the same SHAPE, cut to a sentence each.
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
  filters: { filters: { "poly-sinc-gauss-long": { description: "Gaussian apodizing, very long." } }, aliases: {} },
  shapers: { pcm_dithers: { none: { description: "No dither." } }, sdm_modulators: {} },
};

/**
 * @param {string} chain
 * @param {string} [mode]
 */
const STATE = (chain, mode = "1") => ({
  mode,
  filter1x: "0",
  filterNx: "1",
  shaper: "0",
  rate: "1",
  filter_junk: "0",
  adaptive: "0",
  volume: "-10.0",
  active_chain: chain,
});

// Total reset: module-level signals outlive a test, so a partial one makes cases
// pass alone and fail in sequence. `staged` is private — it is mirrored from
// whatever the faked /api/config/pending answers, via discardAll().
async function reset({ chain = "pcm", staged = { live: {}, http: {} }, mtx = {} } = {}) {
  staticWire(staged);
  health.value = { reachable: true, info: {} };
  engineState.value = STATE(chain);
  engineStatus.value = null;
  enums.value = ENUMS;
  metadata.value = METADATA;
  volume.value = "-10.0";
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
  config.value = { fields: [{ name: "upnp_freewheel", value: "0" }], file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: [], ...mtx };
  liveErrors.value = {};
  liveBusy.value = "";
  liveMode.value = false;
  await discardAll();
}

const page = () => render(html`<${LiveView} />`);
const chrome = () => render(html`<${App} />`);

test("test_the_live_switch_hides_the_tab_bar", async () => {
  await reset();
  liveMode.value = true;
  assert.equal(chrome().includes('class="tab-nav"'), false);
});

test("test_the_live_switch_hides_the_pending_bar", async () => {
  await reset();
  liveMode.value = true;
  assert.equal(chrome().includes("pending-bar"), false);
});

test("test_the_live_switch_carries_the_accent_when_on", async () => {
  await reset();
  liveMode.value = true;
  assert.ok(chrome().includes('class="live-toggle on"'));
});

test("test_the_tab_bar_stands_with_live_off", async () => {
  await reset();
  assert.ok(chrome().includes('class="tab-nav"'));
});

test("test_the_page_says_up_front_that_controls_write_live", async () => {
  await reset();
  assert.ok(page().includes("writes to the engine when you select it"));
});

test("test_a_refused_write_shows_its_reason_on_the_control", async () => {
  await reset();
  liveErrors.value = { rate: "the pcm chain is not loaded" };
  assert.ok(page().includes('<div class="live-error">the pcm chain is not loaded</div>'));
});

test("test_a_profile_the_engine_never_loaded_cannot_be_switched_to", async () => {
  await reset({ mtx: { file_profiles: { Room: { rows: [], post: {} } }, live_profiles: [] } });
  assert.ok(page().includes("not loaded by the engine"));
});

// The engine-health card and the volume card are the System and Volume tabs'
// own components, rendered here as well. Both carry a "quick updates" opt-in on
// their tab; LIVE polls at 500 ms whatever they say (store/ui.js), so both drop
// it here. The cadence itself is polling.test.js's — what is observable in the
// markup is the card being present and the tickbox not.

test("test_the_live_page_carries_the_engine_health_card", async () => {
  await reset();
  assert.ok(page().includes("process speed"));
});

test("test_the_live_page_offers_no_quick_updates_tickbox", async () => {
  await reset();
  assert.equal(page().includes("poll-quick"), false);
});

// --- what a rate column's reason looks like on the page -------------------------
//
// In `[source]` the engine accepts no rate on the wire at all (protocol.md §6),
// so both rate columns come off the store grayed and carrying a reason
// (store/liverateauto.test.js pins the sentence itself). What is pinned here is
// where the user MEETS that sentence: on hover, as the field's own title, in
// place of the manual tooltip the field would otherwise carry — and nowhere as a
// caption underneath, which is what the old gray had and what reflows the row on
// every mode change.
//
// The anchors are what a user reads: the rate columns are labelled `PCM` and
// `SDM`, and the field root is the single smallest element enclosing that label,
// which is the element a pointer hovers. Everything between is left alone, so a
// restructured card that says the same things still measures.

// The two output modes the reason turns on, each set coherently across the three
// sources the page reads: State's numeric mode, the enumeration the engine is
// serving, and the configured mode in the running configuration. The two limits
// are what a grayed column shows in auto, so a column that renders at all has a
// value to render.
const LIMITS = { defaults_samplerate: "384000", defaults_bitrate: "49152000" };
const AUTO = { state: "0", name: "[source]", file: { mode: "auto", ...LIMITS } };
const EXPLICIT_PCM = { state: "1", name: "PCM", file: { mode: "pcm", ...LIMITS } };

// The manual tooltip the rate fields carry when nothing is refusing them —
// settings.json's own prose, as METADATA above serves it.
const RATE_TOOLTIP = "Output sample rate request, or upper limit.";

// The sentence the store hands a grayed column in auto.
const AUTO_REASON = "The engine selects the rate in Auto mode.";

/** @param {{ state: string, name: string, file: Record<string, string> }} mode */
async function inOutputMode(mode) {
  await reset();
  engineState.value = STATE("pcm", mode.state);
  enums.value = { ...ENUMS, mode: { name: mode.name } };
  config.value = { fields: [{ name: "upnp_freewheel", value: "0" }], file: mode.file, active: "", profiles: null };
}

// SSR escapes entities; the contract is the text a user reads on hover, not its
// encoding.
/** @param {string} raw */
const decode = (raw) => raw.replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// The hover title of the field a rate column is rendered in. A miss throws
// rather than quietly comparing `undefined`: a column that has lost its label
// must fail loudly.
/**
 * @param {string} out
 * @param {string} label
 * @returns {string}
 */
const hoverTitle = (out, label) => decode(attrOf(enclosing(out, labelled(out, label)).attrs, "title") || "");

// The whole Rate card — the smallest element enclosing its head, so a caption
// anywhere in it counts, whether it sits on a field or beside the pair. A miss
// throws rather than handing back an empty fragment: a question about what a
// card does NOT carry must never be answered by markup that simply moved.
/** @param {string} out */
function rateCard(out) {
  const hit = elements(out).find((el) => classes(el).includes("card-head") && text(el) === "Rate");
  if (!hit) throw new Error('no card headed "Rate" in the rendered page');
  return enclosing(out, hit).html;
}

test("test_the_grayed_pcm_rate_field_carries_its_columns_reason_as_its_hover_title", async () => {
  await inOutputMode(AUTO);
  assert.equal(hoverTitle(page(), "PCM"), AUTO_REASON);
});

test("test_the_grayed_sdm_rate_field_carries_its_columns_reason_as_its_hover_title", async () => {
  await inOutputMode(AUTO);
  assert.equal(hoverTitle(page(), "SDM"), AUTO_REASON);
});

test("test_the_grayed_pcm_rate_fields_hover_title_drops_the_manual_tooltip", async () => {
  // The reason stands IN PLACE OF the tooltip: a title carrying both tells the
  // user how to set a rate in the same breath as saying they cannot.
  await inOutputMode(AUTO);
  assert.equal(hoverTitle(page(), "PCM").includes(RATE_TOOLTIP), false);
});

test("test_a_live_rate_field_with_no_reason_still_carries_its_manual_tooltip", async () => {
  // Under an explicit mode the column carries no reason at all, so the hover
  // title is the field's own prose, exactly as it was before.
  await inOutputMode(EXPLICIT_PCM);
  assert.equal(hoverTitle(page(), "PCM"), RATE_TOOLTIP);
});

// The caption is gone in BOTH modes: in auto because the reason now rides on the
// hover, and under an explicit mode because there is no reason to show at all. A
// page that merely stopped setting the reason would pass the second and fail the
// first.

test("test_the_live_rate_card_shows_no_gray_reason_caption_in_auto", async () => {
  await inOutputMode(AUTO);
  assert.equal(grayReason(rateCard(page())), null);
});

test("test_the_live_rate_card_shows_no_gray_reason_caption_under_an_explicit_mode", async () => {
  await inOutputMode(EXPLICIT_PCM);
  assert.equal(grayReason(rateCard(page())), null);
});
