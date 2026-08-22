// Behavioral suite for the LIVE page's consolidated "Playback" card —
// components/live/View.js placing Adaptive volume and the High-frequency filter
// beside the volume dial rendered by components/volume/Playback.js's
// `PlaybackVolumeBody`, and the Volume tab's own card being untouched by it.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Every case drives the exported store signals carrying the shapes
// /api/state, /api/enumerations, /api/config and /api/matrix actually serve,
// over a faked wire on the real REST paths; nothing of ours is stubbed.
//
// Anchors are machine identities, never words (docs/testing.md rule 9): a card
// is found by the `data-card` its section carries, a control by the schema key
// on its wrapper, the dial by its ARIA values. A miss throws rather than quietly
// measuring some other part of the page, so a restructured card fails loudly.
//
// The "region carrying the disabled state" of behavior 9 is read off the `off`
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
import { LiveView } from "../../../hqptuner/static/components/live/View.js";
import { PlaybackVolume } from "../../../hqptuner/static/components/volume/Playback.js";
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
import { attr, classes, disabledRegion, elements, enclosing, hasLabel, labeled, text } from "../support/markup.js";
import { cardHeadAt, section } from "../support/tabform.js";

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

// The two cards under discussion, by the id their sections carry.
const LIVE_PLAYBACK = "live-playback";
const VOLUME_CARD = "playback-volume";

// `running` is the daemon's own /config form, keyed by FORM FIELD name — the
// authority the disabled reason is read from, ahead of anything staged.
async function reset({ range = ON, level = "-12", running = {} } = {}) {
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
  await discardAll();
}

const page = () => render(html`<${LiveView} />`);
const volumeCard = () => render(html`<${PlaybackVolume} />`);

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// One card's own markup, by its id. A miss throws rather than handing back an
// empty string, so a question about what a card holds can never be answered by
// a card that was never rendered.
/**
 * @param {string} out
 * @param {string} want
 */
function card(out, want) {
  const frag = section(out, want);
  if (frag === "") throw new Error(`no card identified "${want}" in the rendered page`);
  return frag;
}

// One control's own markup: the smallest element enclosing its keyed wrapper.
/**
 * @param {string} out
 * @param {string} key
 */
const row = (out, key) => enclosing(out, labeled(out, key)).html;

// The cause the hint names, or null when the fragment carries no hint.
/**
 * @param {string} frag
 * @returns {string | null}
 */
const cause = (frag) => {
  const el = elements(frag).find((e) => attr(e, "data-hint") !== undefined);
  return el ? (attr(el, "data-hint") ?? null) : null;
};

/**
 * @param {string} out
 * @param {string} name
 */
const aria = (out, name) => (new RegExp(`${name}="([^"]*)"`).exec(out) || [])[1];

// --- the cards the LIVE page lays out -----------------------------------------

test("test_the_live_page_carries_a_playback_card", async () => {
  await reset();
  assert.notEqual(cardHeadAt(page(), LIVE_PLAYBACK), -1);
});

test("test_the_live_page_gives_the_dial_no_card_of_its_own", async () => {
  await reset();
  assert.equal(cardHeadAt(page(), VOLUME_CARD), -1);
});

// --- what the consolidated card holds ------------------------------------------

test("test_the_playback_card_carries_the_adaptive_volume_control", async () => {
  await reset();
  assert.ok(hasLabel(card(page(), LIVE_PLAYBACK), "adaptive_volume"));
});

test("test_the_playback_card_carries_the_high_frequency_filter_control", async () => {
  await reset();
  assert.ok(hasLabel(card(page(), LIVE_PLAYBACK), "junk_filter"));
});

test("test_the_high_frequency_filter_shows_the_junk_filter_the_engine_reports", async () => {
  await reset();
  assert.ok(row(card(page(), LIVE_PLAYBACK), "junk_filter").includes("iir-15khz"));
});

// The engine reports list index "1"; a control populated from the enumeration
// offers index "0" as well, a read-only display of the current filter does not.
test("test_the_high_frequency_filter_offers_the_junk_filters_it_is_not_set_to", async () => {
  await reset();
  const out = row(card(page(), LIVE_PLAYBACK), "junk_filter");
  assert.ok(elements(out).some((el) => text(el) === "none"));
});

test("test_adaptive_volume_precedes_the_high_frequency_filter", async () => {
  await reset();
  const out = card(page(), LIVE_PLAYBACK);
  assert.ok(labeled(out, "adaptive_volume").start < labeled(out, "junk_filter").start);
});

test("test_the_playback_card_carries_the_volume_dial", async () => {
  await reset({ level: "-12" });
  assert.equal(aria(card(page(), LIVE_PLAYBACK), "aria-valuenow"), "-12");
});

// The two cases that stood here pinned WHICH WORDS name the dial: that the
// consolidated card's dial carries its own caption and the Volume tab's dial
// leaves the naming to the card head. Both are owner-owned wording with no
// machine identity beside them, so both are gone (docs/testing.md rule 9).

// --- a disabled volume control grays the dial, and nothing else -----------------
// The engine reports "disabled" without a cause; the card names it from the
// RUNNING config. Consolidating the card must not spread that state onto the two
// controls beside the dial, neither of which the volume flag governs — and the
// junk filter is switchable during playback whatever the transport is doing
// (HQPlayer manual §2.8).

test("test_an_enabled_volume_control_grays_nothing_in_the_playback_card", async () => {
  await reset({ range: ON });
  assert.equal(
    elements(card(page(), LIVE_PLAYBACK)).some((el) => classes(el).includes("off")),
    false,
  );
});

test("test_a_disabled_volume_control_grays_the_dial", async () => {
  await reset({ range: OFF, running: { direct_sdm: "1" } });
  assert.ok(disabledRegion(card(page(), LIVE_PLAYBACK)).includes('class="knob'));
});

test("test_the_disabled_region_encloses_the_reason_hint", async () => {
  // The cause is read, not merely counted: the running config the fixture hands
  // the page sets `direct_sdm="1"`, so `direct-sdm` is the reason the hint has
  // to name. Asking only whether SOME hint sits in the region leaves the LIVE
  // page's reading of that flag pinned nowhere.
  await reset({ range: OFF, running: { direct_sdm: "1" } });
  assert.equal(cause(disabledRegion(card(page(), LIVE_PLAYBACK))), "direct-sdm");
});

test("test_the_disabled_region_leaves_out_the_adaptive_volume_control", async () => {
  await reset({ range: OFF, running: { direct_sdm: "1" } });
  assert.equal(hasLabel(disabledRegion(card(page(), LIVE_PLAYBACK)), "adaptive_volume"), false);
});

test("test_the_disabled_region_leaves_out_the_high_frequency_filter_control", async () => {
  await reset({ range: OFF, running: { direct_sdm: "1" } });
  assert.equal(hasLabel(disabledRegion(card(page(), LIVE_PLAYBACK)), "junk_filter"), false);
});

test("test_a_fixed_volume_disable_names_its_cause_on_the_live_page", async () => {
  await reset({ range: OFF, running: { fixed_volume_enabled: "1" } });
  assert.equal(cause(card(page(), LIVE_PLAYBACK)), "fixed-volume");
});

test("test_an_unexplained_disable_reads_as_no_active_stream_on_the_live_page", async () => {
  await reset({ range: OFF });
  assert.equal(cause(card(page(), LIVE_PLAYBACK)), "no-stream");
});

// --- the Volume tab's own card is untouched ------------------------------------

test("test_the_volume_tab_still_renders_the_playback_volume_card", async () => {
  await reset();
  assert.notEqual(cardHeadAt(volumeCard(), VOLUME_CARD), -1);
});

test("test_the_volume_tabs_card_still_carries_the_dial", async () => {
  await reset({ level: "-12" });
  assert.equal(aria(card(volumeCard(), VOLUME_CARD), "aria-valuenow"), "-12");
});
