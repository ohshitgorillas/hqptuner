// Behavioral suite for the conversion cards — Pre-process, the narrowing bar,
// and the two chain cards (each split by SOURCE type) — as they render on the
// Output tab, where the Conversion-tab merge moved them. The FFT filter length
// control, which stands inside a chain card, is fftlength.test.js's subject.
// There is no Resampling/Conversion tab component any more: the cards are
// internal composition of the exported `Output`, so every case here goes through
// `Output`, driven by the exported store signals (`config` carrying the daemon's
// own /config form) over a faked wire on the real REST paths. Nothing is stubbed.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Automatic disclosure with NO manual override is this file's subject; the
// manual toggles (the mode-mismatch notes and the override lifecycle) live in
// conversioncards-collapse.test.js, a separate file, because a click's override
// is module-level state that outlives a test and each test FILE gets its own
// process.
//
// State reset is total on every call — module-level signals, including the
// narrowing facets the filter dropdowns read, outlive a test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/conversioncards.test.js

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
import { stagingWire, quiesce } from "../support/wire.js";
import { cardHeadAt, cardTitled, formFields, section, stateOf } from "../support/tabform.js";
import { SUBHEADS, subsection, subheadsIn } from "../support/chainsubsections.js";
import { attr, classes, elements, keyed } from "../support/markup.js";

// The /config form is keyed by FORM FIELD name: the PCM chain is filter1x /
// filter / dither, the SDM chain oversampling1x / oversampling / modulator.
/** @typedef {import("../support/tabform.js").FieldSpec} FieldSpec */

// `mode` is the output mode as the running config file reports it — the baseline
// an appliesLive control reads (store/resolve.js fileValue).
/**
 * @param {{ cfg?: Record<string, FieldSpec>, mode?: string }} [opts]
 * @returns {Promise<import("../support/wire.js").StagingWire>}
 */
async function reset({ cfg = {}, mode = "auto" } = {}) {
  const w = stagingWire();
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  resetNarrowing();
  matrixConfig.value = { fields: [] };
  config.value = { fields: formFields(cfg), file: { mode }, active: "", profiles: null };
  await discardAll();
  return w;
}

const tab = () => render(html`<${Output} />`);

// Cards are named by the `data-card` their <section> carries — the card's own
// machine identity, never the words in its head (docs/testing.md rule 9).
const PCM = "pcm-chain";
const SDM = "sdm-chain";
const PREPROCESS = "pre-process";
const NARROW = "narrow-filters";
const [FROM_PCM, FROM_DSD] = SUBHEADS;

// Option sets with per-field names, so a chain can be shown to carry ITS OWN
// filter list rather than merely "a filter list". Values are the form's enum
// ids — volatile across engine versions — so a chain is identified by the LABEL
// its slot carries, never by the number.
/**
 * @param {string} value
 * @param {string} label
 */
const opt = (value, label) => ({ value, options: [{ value, label }] });
const CHAINS = {
  filter1x: opt("1", "poly-sinc-gauss-long"),
  filter: opt("2", "poly-sinc-xtr-mp"),
  oversampling1x: opt("3", "poly-sinc-short-mp"),
  oversampling: opt("4", "closed-form-M"),
};

// --- narrowing bar ------------------------------------------------------------

test("test_the_narrowing_bar_stands_on_the_output_tab", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(cardHeadAt(tab(), NARROW) >= 0);
});

// --- pre-process card ----------------------------------------------------------
// The controls that shape the signal BEFORE the conversion chains: a plain card
// titled Pre-process, ahead of the narrowing bar and the chain cards, carrying
// exactly the high-frequency filter, its auto-pilot switch and the metering
// order — pinned as the card's whole <label> sequence, in order.
//
// The auto-pilot switch is HQPTuner's own state, not a daemon setting: it has no
// lane and no schema field, so it is absent from PREP below and is pinned by the
// `data-k` its row carries, the same machine identity the fields are pinned by.

/** @param {string} frag */
const keysOf = (frag) => [...frag.matchAll(/data-k="([^"]*)"/g)].map((m) => m[1]);
const PREP = { junk_filter: "0", pre_before_meter: false };

test("test_the_pre_process_card_precedes_the_narrowing_bar_and_the_chains", async () => {
  await reset({ cfg: { ...CHAINS, ...PREP } });
  const out = tab();
  const at = cardHeadAt(out, PREPROCESS);
  assert.ok(at >= 0 && at < cardHeadAt(out, NARROW) && at < cardHeadAt(out, PCM));
});

test("test_the_pre_process_card_carries_exactly_its_three_controls_in_order", async () => {
  await reset({ cfg: { ...CHAINS, ...PREP } });
  assert.deepEqual(keysOf(cardTitled(tab(), PREPROCESS)), ["junk_filter", "junk_filter_autopilot", "pre_before_meter"]);
});

// --- which card opens ---------------------------------------------------------

test("test_the_pcm_card_opens_in_auto_mode", async () => {
  await reset({ cfg: CHAINS, mode: "auto" });
  assert.equal(stateOf(tab(), PCM), "open");
});

test("test_the_sdm_card_opens_in_auto_mode", async () => {
  await reset({ cfg: CHAINS, mode: "auto" });
  assert.equal(stateOf(tab(), SDM), "open");
});

test("test_the_pcm_card_opens_in_pcm_mode", async () => {
  await reset({ cfg: CHAINS, mode: "pcm" });
  assert.equal(stateOf(tab(), PCM), "open");
});

test("test_the_sdm_card_closes_in_pcm_mode", async () => {
  await reset({ cfg: CHAINS, mode: "pcm" });
  assert.equal(stateOf(tab(), SDM), "closed");
});

test("test_the_sdm_card_opens_in_sdm_mode", async () => {
  await reset({ cfg: CHAINS, mode: "sdm" });
  assert.equal(stateOf(tab(), SDM), "open");
});

test("test_the_pcm_card_closes_in_sdm_mode", async () => {
  await reset({ cfg: CHAINS, mode: "sdm" });
  assert.equal(stateOf(tab(), PCM), "closed");
});

test("test_a_closed_card_hides_its_filter_chain", async () => {
  await reset({ cfg: CHAINS, mode: "pcm" });
  assert.equal(section(tab(), SDM).includes("poly-sinc-short-mp"), false);
});

// --- how each card is split ---------------------------------------------------
// Each card carries one heading per source type — an element whose wording is
// that type's, not merely the words appearing somewhere under the card. Both
// stand whatever the DSD half's disclosure is doing: which element carries each
// one, and whether the DSD body is on screen, belong to
// conversioncards-dsd.test.js.

test("test_the_pcm_card_splits_out_its_pcm_sources", async () => {
  await reset({ cfg: CHAINS });
  assert.equal(subheadsIn(tab(), PCM, FROM_PCM).length, 1);
});

test("test_the_pcm_card_splits_out_its_dsd_sources", async () => {
  await reset({ cfg: CHAINS });
  assert.equal(subheadsIn(tab(), PCM, FROM_DSD).length, 1);
});

test("test_the_sdm_card_splits_out_its_pcm_sources", async () => {
  await reset({ cfg: CHAINS });
  assert.equal(subheadsIn(tab(), SDM, FROM_PCM).length, 1);
});

test("test_the_sdm_card_splits_out_its_dsd_sources", async () => {
  await reset({ cfg: CHAINS });
  assert.equal(subheadsIn(tab(), SDM, FROM_DSD).length, 1);
});

// --- which control sits in which chain ----------------------------------------

test("test_the_pcm_chain_carries_the_pcm_1x_filter", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(subsection(section(tab(), PCM), FROM_PCM).includes("poly-sinc-gauss-long"));
});

test("test_the_pcm_chain_carries_the_pcm_nx_filter", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(subsection(section(tab(), PCM), FROM_PCM).includes("poly-sinc-xtr-mp"));
});

test("test_the_pcm_chain_ends_in_the_dither", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(subsection(section(tab(), PCM), FROM_PCM).includes('data-k="pcm_dither"'));
});

test("test_the_sdm_chain_carries_the_sdm_1x_filter", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(subsection(section(tab(), SDM), FROM_PCM).includes("poly-sinc-short-mp"));
});

test("test_the_sdm_chain_carries_the_sdm_nx_filter", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(subsection(section(tab(), SDM), FROM_PCM).includes("closed-form-M"));
});

test("test_the_sdm_chain_ends_in_the_modulator", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(subsection(section(tab(), SDM), FROM_PCM).includes('data-k="sdm_modulator"'));
});

// The DSD half of each chain is disclosed by the narrow bar's source-format
// facet and starts closed, so a case about what it CONTAINS says the library
// holds DSD first — the same thing a user says by picking "+DSD".

test("test_dsd_source_handling_for_pcm_output_carries_the_noise_filter", async () => {
  await reset({ cfg: CHAINS });
  nSrcFormat.value = "both";
  assert.ok(subsection(section(tab(), PCM), FROM_DSD).includes('data-k="noise_filter"'));
});

test("test_dsd_source_handling_for_pcm_output_carries_the_decimation_filter", async () => {
  await reset({ cfg: CHAINS });
  nSrcFormat.value = "both";
  assert.ok(subsection(section(tab(), PCM), FROM_DSD).includes('data-k="pcm_conversion"'));
});

test("test_dsd_source_handling_for_sdm_output_carries_the_sdm_integrator_control", async () => {
  await reset({ cfg: CHAINS });
  nSrcFormat.value = "both";
  assert.ok(subsection(section(tab(), SDM), FROM_DSD).includes('data-k="sdm_integrator"'));
});

test("test_dsd_source_handling_for_sdm_output_carries_direct_sdm", async () => {
  await reset({ cfg: CHAINS });
  nSrcFormat.value = "both";
  assert.ok(subsection(section(tab(), SDM), FROM_DSD).includes('data-k="direct_sdm"'));
});

// --- the DSD Playback segment ---------------------------------------------------
// `direct_sdm` (hqplayerd-readme.txt §1.2) renders in the SDM chain's DSD half as
// a two-option segment, not the checkbox it once was. The daemon's /config form
// hands the value over as a real boolean; the staged-edit domain stays the
// checkbox era's strings "1"/"0". The Direct-SDM edit warning flow is
// directsdmwarn.test.js's subject, not this one's.

// The `direct_sdm` field's own markup, whole: the field element the schema key
// renders as, found by the key the daemon's form is keyed by rather than by the
// words announcing it, so a rewording of the label changes nothing here.
/**
 * @param {boolean} value
 * @returns {Promise<string>}
 */
async function dsdPlaybackControl(value) {
  await reset({ cfg: { ...CHAINS, direct_sdm: value } });
  nSrcFormat.value = "both";
  return keyed(subsection(section(tab(), SDM), FROM_DSD), "direct_sdm").html;
}

// The strip's option buttons, matched on whole class TOKENS — "seg" the token,
// never "seg" the substring — so a behavior-preserving change to the class list
// (an extra token, a reorder) changes nothing here.
/** @param {string} s */
const segButtons = (s) => elements(s).filter((el) => el.name === "button" && classes(el).includes("seg"));
// An option is named by the wire value it carries in `data-v`
// (components/controls/index.js), never by the words beside it.
/** @param {string} s */
const segValues = (s) => segButtons(s).map((el) => attr(el, "data-v"));
/** @param {string} s */
const activeSeg = (s) => {
  const hit = segButtons(s).find((el) => classes(el).includes("active"));
  return hit === undefined ? null : attr(hit, "data-v");
};

// There is no DOM here and preact-render-to-string never fires a handler, so an
// option is chosen the way conversioncards-dsd.test.js presses a subhead: the
// vnodes are collected through preact's own `options.vnode` hook — the
// renderer's public seam — and the onClick the option button carries, the very
// function a browser would call, is invoked.
/** @typedef {import("../support/wheel.js").VNode} VNode */
/** @returns {VNode[]} */
function builtVnodes() {
  /** @type {VNode[]} */
  const seen = [];
  const previous = options.vnode;
  options.vnode = (/** @type {VNode} */ vnode) => {
    seen.push(vnode);
    if (previous) previous(vnode);
  };
  try {
    render(html`<${Output} />`);
  } finally {
    options.vnode = previous;
  }
  return seen;
}

/**
 * Press the option carrying wire value `value` on the field keyed `key`.
 *
 * Both handles are contract: the field wears its schema key in `data-k`
 * (components/Field.js), the option its own value in `data-v`
 * (components/controls/index.js). Preact builds a field's widget before it
 * moves to the next field, so a field's options are the ones built after its
 * own `data-k` vnode and before the next field's — the renderer's depth-first
 * order, not ours. Anything but exactly one match is a broken fixture, not a
 * case.
 *
 * @param {string} key
 * @param {string} value
 */
function chooseSegOption(key, value) {
  const seen = builtVnodes();
  /** @param {VNode} v */
  const fieldKey = (v) => (v && v.props ? v.props["data-k"] : undefined);
  const at = seen.findIndex((v) => fieldKey(v) === key);
  if (at < 0) throw new Error(`no field keyed "${key}" was rendered`);
  const after = seen.findIndex((v, i) => i > at && typeof fieldKey(v) === "string");
  const own = seen.slice(at, after < 0 ? seen.length : after);
  const hits = own.filter(
    (v) => v.type === "button" && v.props && typeof v.props.onClick === "function" && v.props["data-v"] === value,
  );
  if (hits.length !== 1) throw new Error(`expected one option valued "${value}" on ${key}, found ${hits.length}`);
  /** @type {(event: object) => void} */ (hits[0].props.onClick)({
    preventDefault() {},
    stopPropagation() {},
  });
}

test("test_dsd_playback_renders_as_a_segment", async () => {
  assert.ok((await dsdPlaybackControl(false)).includes('<span class="segment">'));
});

test("test_dsd_playback_is_no_longer_a_checkbox", async () => {
  assert.equal((await dsdPlaybackControl(false)).includes('type="checkbox"'), false);
});

test("test_dsd_playback_offers_direct_sdm_off_then_on", async () => {
  assert.deepEqual(segValues(await dsdPlaybackControl(false)), ["0", "1"]);
});

test("test_a_false_direct_sdm_activates_the_off_option", async () => {
  assert.equal(activeSeg(await dsdPlaybackControl(false)), "0");
});

test("test_a_true_direct_sdm_activates_the_on_option", async () => {
  assert.equal(activeSeg(await dsdPlaybackControl(true)), "1");
});

// Enabling direct_sdm is guarded: from any other volume state the click raises
// the warn question (directsdmwarn.test.js's subject) and stages nothing, so
// the immediate-staging case starts from the one baseline that needs no
// confirmation — volume already pinned at fixed -3 dB. Disabling is never
// guarded, so the "0" case below starts plain.
test("test_choosing_direct_stages_the_string_one", async () => {
  const w = await reset({
    cfg: { ...CHAINS, direct_sdm: false, fixed_volume_enabled: true, fixed_volume: "-3" },
  });
  nSrcFormat.value = "both";
  chooseSegOption("direct_sdm", "1");
  await quiesce(w);
  assert.equal(w.staged.http.direct_sdm, "1");
});

test("test_choosing_processed_stages_the_string_zero", async () => {
  const w = await reset({ cfg: { ...CHAINS, direct_sdm: true } });
  nSrcFormat.value = "both";
  chooseSegOption("direct_sdm", "0");
  await quiesce(w);
  assert.equal(w.staged.http.direct_sdm, "0");
});
