// Behavioral suite for the LIVE page's consolidated "Playback" card —
// components/LiveView.js placing Adaptive volume and the High-frequency filter
// beside the volume dial rendered by components/PlaybackVolume.js's
// `PlaybackVolumeBody`, and the Volume tab's own card being untouched by it.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Every case drives the exported store signals carrying the shapes
// /api/state, /api/enumerations, /api/config and /api/matrix actually serve,
// over a faked wire on the real REST paths; nothing of ours is stubbed.
//
// Anchors are what a user reads or a screen reader consumes: a card is found by
// the heading it carries, a control by its `<label>`, the dial by its ARIA
// values. A miss throws rather than quietly measuring some other part of the
// page, so a renamed head or a restructured card fails loudly.
//
// The "region carrying the disabled state" of behaviour 9 is read off the `off`
// class token, which is this codebase's rendered marker for a control the engine
// has taken away (`card playback off`, `knob knob-lg off`, `dsp-body off`). The
// outermost element carrying it inside the Playback card is taken to be that
// region: if the whole card carries it, the exclusion cases below fail, which is
// exactly the consolidation defect they exist to catch.
//
// State reset is total on every call: module-level signals outlive a test, so a
// partial one makes cases pass alone and fail in sequence.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/liveplayback.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { LiveView } from "../../../hqptuner/static/components/LiveView.js";
import { PlaybackVolume } from "../../../hqptuner/static/components/PlaybackVolume.js";
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
import { liveMode, fastVolumeUpdates } from "../../../hqptuner/static/store/prefs.js";
import { staticWire } from "../support/wire.js";
import { classes, disabledRegion, elements, enclosing, hasLabel, labelled, text } from "../support/markup.js";

// The junk-filter enumeration as GetJunkFilters serves it: options come from
// here and nowhere else — the daemon's /config form has no junk_filter field
// (protocol.md, the LIVE-only field table). The engine reports LIST INDEX "1",
// so the distinctive name below is the one the control shows whichever widget
// it renders as.
const JUNK = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "1", name: "iir-15khz" },
];

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
  junk_filters: JUNK,
  mode: { name: "PCM" },
};

// settings.json's per-control label and tooltip, plus the name-keyed overlays a
// selection's description comes from. Shipped prose is long; these are the same
// SHAPE, cut to a sentence each.
const METADATA = {
  settings: {
    output: {
      output_mode: { label: "Output mode", tooltip: "Selects default output mode." },
      rate: { label: "Output rate", tooltip: "Output sample rate request, or upper limit." },
      junk_filter: {
        label: "High-frequency filter",
        tooltip: "Playback filters for noise.",
        options: { 0: "No filtering.", 1: "A 15 kHz IIR filter." },
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

/** @param {string} level */
const STATE = (level) => ({
  mode: "1",
  filter1x: "0",
  filterNx: "1",
  shaper: "0",
  rate: "1",
  filter_junk: "1",
  adaptive: "0",
  volume: level,
  active_chain: "pcm",
});

const ON = { enabled: "1", min: "-60", max: "0" };
const OFF = { enabled: "0", min: "-60", max: "0" };
const SDM_HINT = "Direct SDM bypasses the volume control and sets PCM volume to a fixed -3 dBFS value.";
const FIXED_HINT = "Fixed volume in effect";

// `running` is the daemon's own /config form, keyed by FORM FIELD name — the
// authority the disabled reason is read from, ahead of anything staged.
async function reset({ range = ON, level = "-12", running = {}, fast = false } = {}) {
  staticWire({ live: {}, http: {} });
  health.value = { reachable: true, info: {} };
  engineState.value = STATE(level);
  engineStatus.value = null;
  enums.value = ENUMS;
  metadata.value = METADATA;
  volume.value = level;
  volumeRange.value = range;
  config.value = {
    fields: Object.entries({ upnp_freewheel: "0", ...running }).map(([name, value]) => ({ name, value })),
    file: {},
    active: "",
    profiles: null,
  };
  matrixConfig.value = { fields: [] };
  liveErrors.value = {};
  liveBusy.value = "";
  liveMode.value = false;
  fastVolumeUpdates.value = fast;
  await discardAll();
}

const page = () => render(html`<${LiveView} />`);
const volumeCard = () => render(html`<${PlaybackVolume} />`);

// The title a card head announces: its own text, less the disclosure triangle a
// collapsible head carries ahead of it (components/common.js).
/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

/** @param {string} out */
const heads = (out) => elements(out).filter((el) => classes(el).includes("card-head"));
/** @param {MarkupElement} el */
const title = (el) => text(el).replace(/^[^\p{L}\p{N}]+/u, "");

// Every card title on a page, in document order. A page with no card heads at
// all raises rather than reporting an empty list, so a question about what the
// page does NOT carry can never be answered by markup that simply moved.
/** @param {string} out */
function cardTitles(out) {
  const found = heads(out);
  if (found.length === 0) throw new Error("the rendered page carries no card heads");
  return found.map(title);
}

// One card's own markup: the smallest element enclosing its head. A miss throws
// rather than handing back the page.
/**
 * @param {string} out
 * @param {string} want
 */
function card(out, want) {
  const hit = heads(out).find((el) => title(el) === want);
  if (!hit) throw new Error(`no card headed "${want}" in the rendered page`);
  return enclosing(out, hit).html;
}

// One labelled control's own markup: the smallest element enclosing its label.
/**
 * @param {string} out
 * @param {string} label
 */
const row = (out, label) => enclosing(out, labelled(out, label)).html;

/**
 * @param {string} out
 * @param {string} name
 */
const aria = (out, name) => (new RegExp(`${name}="([^"]*)"`).exec(out) || [])[1];

// --- the cards the LIVE page lays out -----------------------------------------

test("test_the_live_page_carries_a_playback_card", async () => {
  await reset();
  assert.ok(cardTitles(page()).includes("Playback"));
});

test("test_the_live_page_carries_no_processing_card", async () => {
  await reset();
  assert.equal(cardTitles(page()).includes("Processing"), false);
});

test("test_the_live_page_gives_the_dial_no_card_of_its_own", async () => {
  await reset();
  assert.equal(cardTitles(page()).includes("Playback volume"), false);
});

// --- what the consolidated card holds ------------------------------------------

test("test_the_playback_card_carries_the_adaptive_volume_control", async () => {
  await reset();
  assert.ok(hasLabel(card(page(), "Playback"), "Adaptive volume"));
});

test("test_the_playback_card_carries_the_high_frequency_filter_control", async () => {
  await reset();
  assert.ok(hasLabel(card(page(), "Playback"), "High-frequency filter"));
});

test("test_the_high_frequency_filter_shows_the_junk_filter_the_engine_reports", async () => {
  await reset();
  assert.ok(row(card(page(), "Playback"), "High-frequency filter").includes("iir-15khz"));
});

// The engine reports list index "1"; a control populated from the enumeration
// offers index "0" as well, a read-only display of the current filter does not.
test("test_the_high_frequency_filter_offers_the_junk_filters_it_is_not_set_to", async () => {
  await reset();
  const out = row(card(page(), "Playback"), "High-frequency filter");
  assert.ok(elements(out).some((el) => text(el) === "none"));
});

test("test_adaptive_volume_precedes_the_high_frequency_filter", async () => {
  await reset();
  const out = card(page(), "Playback");
  assert.ok(labelled(out, "Adaptive volume").start < labelled(out, "High-frequency filter").start);
});

test("test_the_playback_card_carries_the_volume_dial", async () => {
  await reset({ level: "-12" });
  assert.equal(aria(card(page(), "Playback"), "aria-valuenow"), "-12");
});

test("test_the_playback_card_offers_no_faster_updates_tickbox", async () => {
  await reset();
  assert.equal(card(page(), "Playback").includes("Faster volume updates"), false);
});

// --- a disabled volume control grays the dial, and nothing else -----------------
// The engine reports "disabled" without a cause; the card names it from the
// RUNNING config. Consolidating the card must not spread that state onto the two
// controls beside the dial, neither of which the volume flag governs — and the
// junk filter is switchable during playback whatever the transport is doing
// (HQPlayer manual §2.8).

test("test_an_enabled_volume_control_grays_nothing_in_the_playback_card", async () => {
  await reset({ range: ON });
  assert.equal(
    elements(card(page(), "Playback")).some((el) => classes(el).includes("off")),
    false,
  );
});

test("test_a_disabled_volume_control_grays_the_dial", async () => {
  await reset({ range: OFF, running: { direct_sdm: "1" } });
  assert.ok(disabledRegion(card(page(), "Playback")).includes('class="knob'));
});

test("test_the_disabled_region_encloses_the_reason_hint", async () => {
  await reset({ range: OFF, running: { direct_sdm: "1" } });
  assert.ok(disabledRegion(card(page(), "Playback")).includes(SDM_HINT));
});

test("test_the_disabled_region_leaves_out_the_adaptive_volume_control", async () => {
  await reset({ range: OFF, running: { direct_sdm: "1" } });
  assert.equal(hasLabel(disabledRegion(card(page(), "Playback")), "Adaptive volume"), false);
});

test("test_the_disabled_region_leaves_out_the_high_frequency_filter_control", async () => {
  await reset({ range: OFF, running: { direct_sdm: "1" } });
  assert.equal(hasLabel(disabledRegion(card(page(), "Playback")), "High-frequency filter"), false);
});

test("test_a_fixed_volume_disable_names_its_cause_on_the_live_page", async () => {
  await reset({ range: OFF, running: { fixed_volume_enabled: "1" } });
  assert.ok(card(page(), "Playback").includes(FIXED_HINT));
});

test("test_an_unexplained_disable_reads_as_no_active_stream_on_the_live_page", async () => {
  await reset({ range: OFF });
  assert.ok(card(page(), "Playback").includes("No active stream — volume adjusts live during playback."));
});

// --- the Volume tab's own copy is untouched ------------------------------------

test("test_the_volume_tabs_card_is_still_headed_playback_volume", async () => {
  await reset();
  assert.ok(cardTitles(volumeCard()).includes("Playback volume"));
});

test("test_the_volume_tabs_card_still_carries_the_dial", async () => {
  await reset({ level: "-12" });
  assert.equal(aria(card(volumeCard(), "Playback volume"), "aria-valuenow"), "-12");
});

test("test_the_volume_tabs_card_still_offers_the_faster_updates_tickbox", async () => {
  await reset();
  assert.ok(volumeCard().includes("Faster volume updates"));
});
