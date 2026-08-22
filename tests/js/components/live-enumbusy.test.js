// Behavioral suite for the LIVE page's RE-ENUMERATION WINDOW as it renders —
// which controls components/live/View.js grays out while a write that rebuilds
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
// Two arrangements of the engine, because no single one shows everything. In a
// fixed output mode the rate columns are live and the dormant chain's card is
// collapsed; in `[source]` both chain cards render open (livechain.test.js) but
// the rate columns are already grayed, the source deciding the rate. So the
// loaded-vs-dormant chain distinction is read in `[source]` and everything else
// in PCM, and every "grays out" case is paired with the same page idle, so a
// control already gray on its own account cannot pass by standing still.
//
// WHICH CHAIN IS LOADED IS A PARAMETER. Every chain case runs twice, PCM loaded
// and SDM loaded, with the expectations swapping: a page that hardcoded "the PCM
// card grays, the SDM card does not" instead of reading `active_chain` passes
// one direction and fails the other.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/live-enumbusy.test.js

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
import { writeLive } from "../../../hqptuner/static/store/live/write.js";
import { ok, bad, staticWire } from "../support/wire.js";
import { formField } from "../support/chainenums.js";
import { labeled } from "../support/markup.js";
import { section } from "../support/tabform.js";

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
// The rate list is mode-dependent (manual §4.6): SDM enumerates DSD rates.
const PCM_RATES = [
  { index: "0", rate: "0" },
  { index: "1", rate: "96000" },
];
const SDM_RATES = [
  { index: "0", rate: "0" },
  { index: "1", rate: "12288000" },
];

// The engine can only enumerate the chain it has LOADED. `[source]`: the
// configured mode is 0 whatever chain the source left loaded.
/**
 * @param {string} chain
 * @param {boolean} [auto]
 */
const ENUMS = (chain, auto) => ({
  filters: chain === "sdm" ? SDM_FILTERS : PCM_FILTERS,
  shapers: chain === "sdm" ? SDM_SHAPERS : PCM_SHAPERS,
  rates: chain === "sdm" ? SDM_RATES : PCM_RATES,
  junk_filters: [{ index: "0", value: "0", name: "none" }],
  mode: { name: auto ? "[source]" : chain === "sdm" ? "SDM (DSD)" : "PCM" },
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

// State reports the LIST INDEX of the loaded chain's filter and shaper, and
// nothing at all about the chain that is not loaded. The indices below are valid
// in either chain's lists, so only `active_chain` says which they mean.
/**
 * @param {string} chain
 * @param {boolean} [auto]
 */
const STATE = (chain, auto) => ({
  mode: auto ? "0" : chain === "sdm" ? "2" : "1",
  filter1x: "0",
  filterNx: "1",
  shaper: "0",
  rate: "1",
  filter_junk: "0",
  adaptive: "0",
  volume: "-10.0",
  active_chain: chain,
});

// The daemon's /config form: every field carries the option list for its OWN
// chain, which is what the dormant column reads.
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
/** @typedef {NonNullable<Parameters<typeof staticWire>[1]>} Routes */

/** @param {{ status?: number }} [opts] */
const liveRoutes =
  ({ status = 200 } = {}) =>
  (/** @type {string} */ path) => {
    if (path === "/api/config/live")
      return status === 200 ? ok({ live: [{ setting: "filter", ok: true }], stored: {} }) : bad(status, "no reply");
    if (path === "/api/state") return ok({ data: STATE("pcm") });
    if (path === "/api/enumerations") return ok({ data: ENUMS("pcm") });
    if (path === "/api/config") return ok({ data: { fields: FIELDS(), file: { mode: "pcm" }, active: "" } });
    return undefined;
  };

// Total reset: module-level signals outlive a test, so a partial one makes cases
// pass alone and fail in sequence. `staged` is private — it is mirrored from
// whatever the faked /api/config/pending answers, via discardAll().
/**
 * @param {{ busy?: string, routes?: Routes, auto?: boolean, chain?: string }} [fixture]
 */
async function reset({ busy = "", routes, auto = false, chain = "pcm" } = {}) {
  staticWire({ live: {}, http: {} }, routes);
  health.value = { reachable: true, info: {} };
  engineState.value = STATE(chain, auto);
  engineStatus.value = null;
  enums.value = ENUMS(chain, auto);
  metadata.value = METADATA;
  volume.value = "-10.0";
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
  config.value = { fields: FIELDS(), file: { mode: auto ? "auto" : chain }, active: "", profiles: null };
  matrixConfig.value = { fields: [], file_profiles: {}, live_profiles: [] };
  liveErrors.value = {};
  liveBusy.value = busy;
  await discardAll();
}

const page = () => render(html`<${LiveView} />`);

// --- reading a control's state off the page -----------------------------------
// The anchors are machine identities (docs/testing.md rule 9): a card by the
// `data-card` its section carries, a control by the schema key on its field
// wrapper. Everything between them — which wrapper divs exist and what they are
// classed — is left alone, so a card that is restructured, or reworded, still
// measures.

// One chain card's own fragment. A card that stopped rendering raises rather
// than lending its neighbor's controls to a lookup.
/**
 * @param {string} out
 * @param {string} id
 */
function card(out, id) {
  const frag = section(out, id);
  if (frag === "") throw new Error(`no card identified "${id}" in the rendered page`);
  return frag;
}

// The attributes of the form control a keyed field wraps — the first control
// inside the field, so the narrowing tickboxes that follow a filter's dropdown,
// which disable on their own account, are not mistaken for it.
/**
 * @param {string} out
 * @param {string} key
 */
function widgetAttrs(out, key) {
  const m = /<(select|input|button)\b([^>]*)>/.exec(labeled(out, key).html);
  if (!m) throw new Error(`the field keyed "${key}" wraps no form control`);
  return m[2];
}

// Delimited, so `aria-disabled` and the word in a caption are not mistaken for
// the attribute.
const DISABLED = /(^|\s)disabled(\s|=|\/|$)/;
/**
 * @param {string} out
 * @param {string} key
 */
const grayed = (out, key) => DISABLED.test(widgetAttrs(out, key));

// The output-mode switch is a segment of buttons rather than one control, so its
// refusal lands on the buttons. The field carries nothing else that can disable.
/**
 * @param {string} out
 * @param {string} key
 */
function segmentGrayed(out, key) {
  const field = labeled(out, key).html;
  return [...field.matchAll(/<button\b([^>]*)>/g)].some((m) => DISABLED.test(m[1]));
}

// --- which fields open the window ---------------------------------------------
// Read off the loaded chain's dither, which is none of the fields written below,
// so every case here is graying on the window's account and not its own.

const REENUM = ["mode", "filter1x", "filter", "oversampling1x", "oversampling", "rate"];
const PLAIN = ["adaptive_volume", "junk_filter"];

const PCM_CARD = "live-pcm-chain";
const SDM_CARD = "live-sdm-chain";

for (const field of REENUM) {
  test(`test_a_${field}_write_in_flight_grays_the_controls_that_read_an_enumeration`, async () => {
    await reset({ busy: field });
    assert.equal(grayed(card(page(), PCM_CARD), "shaper"), true);
  });
}

for (const field of PLAIN) {
  test(`test_a_${field}_write_in_flight_grays_no_control_that_reads_an_enumeration`, async () => {
    await reset({ busy: field });
    assert.equal(grayed(card(page(), PCM_CARD), "shaper"), false);
  });
}

// --- the loaded chain grays, the dormant chain does not ------------------------
// Both directions of `active_chain`, in `[source]` so both cards render open.
// The field in flight is `rate`, which belongs to neither card.

// Both chain cards carry the same three keys; which card they are read from is
// what tells the loaded chain from the dormant one.
const CONTROLS = ["filter_1x", "filter_nx", "shaper"];
/** @type {Record<string, string>} */
const CARD = { pcm: PCM_CARD, sdm: SDM_CARD };
/** @param {string} chain */
const other = (chain) => (chain === "pcm" ? "sdm" : "pcm");

for (const chain of ["pcm", "sdm"]) {
  for (const key of CONTROLS) {
    test(`test_the_loaded_${chain}_${key}_grays_out_during_a_re_enumerating_write`, async () => {
      await reset({ auto: true, chain, busy: "rate" });
      assert.equal(grayed(card(page(), CARD[chain]), key), true);
    });

    test(`test_the_loaded_${chain}_${key}_is_not_grayed_with_no_write_in_flight`, async () => {
      await reset({ auto: true, chain });
      assert.equal(grayed(card(page(), CARD[chain]), key), false);
    });

    // The dormant chain's options come from the running configuration, which no
    // re-enumeration touches, and its edits are held until that chain loads.
    test(`test_the_dormant_${other(chain)}_${key}_stays_live_during_a_re_enumerating_write`, async () => {
      await reset({ auto: true, chain, busy: "rate" });
      assert.equal(grayed(card(page(), CARD[other(chain)]), key), false);
    });
  }
}

// --- the page-wide controls that read an enumeration ---------------------------

test("test_the_high_frequency_filter_grays_out_during_a_re_enumerating_write", async () => {
  await reset({ busy: "filter1x" });
  assert.equal(grayed(page(), "junk_filter"), true);
});

test("test_the_high_frequency_filter_is_not_grayed_with_no_write_in_flight", async () => {
  await reset();
  assert.equal(grayed(page(), "junk_filter"), false);
});

test("test_the_pcm_rate_column_grays_out_during_a_re_enumerating_write", async () => {
  await reset({ busy: "filter1x" });
  assert.equal(grayed(page(), "pcm_rate"), true);
});

test("test_the_sdm_rate_column_grays_out_during_a_re_enumerating_write", async () => {
  await reset({ busy: "filter1x" });
  assert.equal(grayed(page(), "sdm_rate"), true);
});

test("test_the_pcm_rate_column_is_not_grayed_with_no_write_in_flight", async () => {
  await reset();
  assert.equal(grayed(page(), "pcm_rate"), false);
});

test("test_the_sdm_rate_column_is_not_grayed_with_no_write_in_flight", async () => {
  await reset();
  assert.equal(grayed(page(), "sdm_rate"), false);
});

// --- controls that read no list at all ----------------------------------------

test("test_adaptive_volume_stays_live_during_a_re_enumerating_write", async () => {
  await reset({ busy: "filter1x" });
  assert.equal(grayed(page(), "adaptive_volume"), false);
});

test("test_the_output_mode_switch_stays_live_during_another_fields_re_enumerating_write", async () => {
  await reset({ busy: "filter1x" });
  assert.equal(segmentGrayed(page(), "output_mode"), false);
});

test("test_the_output_mode_switch_grays_while_it_is_itself_being_written", async () => {
  // The pair the case above needs: without it, a switch that can never disable
  // reads the same as one correctly left alone.
  await reset({ busy: "mode" });
  assert.equal(segmentGrayed(page(), "output_mode"), true);
});

// --- a write that rebuilds nothing grays nothing else -------------------------

test("test_a_plain_write_leaves_the_loaded_chains_filter_live", async () => {
  await reset({ busy: "junk_filter" });
  assert.equal(grayed(card(page(), PCM_CARD), "filter_nx"), false);
});

test("test_a_plain_write_leaves_the_pcm_rate_column_live", async () => {
  await reset({ busy: "junk_filter" });
  assert.equal(grayed(page(), "pcm_rate"), false);
});

test("test_a_plain_write_leaves_the_sdm_rate_column_live", async () => {
  await reset({ busy: "junk_filter" });
  assert.equal(grayed(page(), "sdm_rate"), false);
});

test("test_a_plain_write_grays_the_control_it_is_writing", async () => {
  await reset({ busy: "junk_filter" });
  assert.equal(grayed(page(), "junk_filter"), true);
});

// --- the window closes when the write does ------------------------------------

test("test_nothing_is_left_grayed_once_a_re_enumerating_write_succeeds", async () => {
  await reset({ routes: liveRoutes() });
  await writeLive("filter", "40");
  assert.equal(grayed(card(page(), PCM_CARD), "filter_nx"), false);
});

test("test_nothing_is_left_grayed_once_a_re_enumerating_write_is_refused", async () => {
  await reset({ routes: liveRoutes({ status: 503 }) });
  await writeLive("filter", "40");
  assert.equal(grayed(card(page(), PCM_CARD), "filter_nx"), false);
});

// --- the window says nothing ---------------------------------------------------
// The graying is the whole of it: no caption, note or status text appears while
// it is open, so the page's text is the same text either way.

/** @param {string} out */
const words = (out) => out.replace(/<[^<>]*>/g, "");

test("test_the_window_adds_no_text_to_the_page", async () => {
  await reset();
  const idle = words(page());
  liveBusy.value = "filter1x";
  assert.equal(words(page()), idle);
});
