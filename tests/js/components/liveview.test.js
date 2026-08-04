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
// (store/live.js) rather than this component's internals. The picker's own
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
import { liveErrors, liveBusy } from "../../../hqptuner/static/store/live.js";
import { liveMode } from "../../../hqptuner/static/store/prefs.js";
import { staticWire } from "../support/wire.js";

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

const STATE = (chain) => ({
  mode: "1",
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
