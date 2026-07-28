// Behavioral suite for components/tabs/ResamplingTab.js — the Resampling tab's
// rendered contract: the narrowing bar, the two output cards (each split by
// SOURCE type) and the FFT filter-length card that follows the selection.
//
// Policy (docs/testing.md): public API only, one assertion per test. The four
// override signals and the FILTER_CONTROLS table are private and stay that way —
// every case here goes through the exported `Resampling`, driven by the exported
// store signals (`config` carrying the daemon's own /config form) over a faked
// wire on the real REST paths. Nothing is stubbed.
//
// NOT covered, and deliberately not reached by widening the surface:
//   * The mode-mismatch note ("Output mode is SDM. These settings have no
//     effect."). It renders inside the PCM card exactly when the mode is SDM —
//     which is exactly when that card auto-CLOSES, so a closed Collapsible never
//     renders it. Seeing it requires the user to re-open the card by hand, i.e.
//     the module-private `pcmOverride` / `sdmOverride`, written only from the
//     disclosure head's onClick, which SSR never fires. Same for the SDM card's
//     note. Those belong to the playwright hand-back protocol.
//   * The override-reset effect (a mode change drops a manual collapse so the
//     auto disclosure re-asserts). Its whole observable is those same private
//     signals, whose only public writer is the click.
//
// State reset is total on every call — module-level signals, including the
// narrowing facets the filter dropdowns read, outlive a test.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/resamplingtab.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../hqptuner/static/lib/dom.js";
import { Resampling } from "../../hqptuner/static/components/tabs/ResamplingTab.js";
import { config, matrixConfig, metadata, engineState, enums, discardAll } from "../../hqptuner/static/store/state.js";
import { showDescriptions, keepOptionDescriptions } from "../../hqptuner/static/store/prefs.js";
import { resetNarrowing } from "../../hqptuner/static/store/narrowing.js";
import { stagingWire } from "./wire.js";

// The daemon's own /config form, keyed by FORM FIELD name (the PCM chain is
// filter1x / filter / dither, the SDM chain oversampling1x / oversampling /
// modulator). A spec value is a bare value or a {value, options} dropdown pair.
const formFields = (spec) =>
  Object.entries(spec).map(([name, v]) => (v && v.options ? { name, ...v } : { name, value: v }));

// `mode` is the output mode as the running config file reports it — the baseline
// an appliesLive control reads (store/state.js fileValue).
async function reset({ cfg = {}, mode = "auto" } = {}) {
  stagingWire();
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  resetNarrowing();
  matrixConfig.value = { fields: [] };
  config.value = { fields: formFields(cfg), file: { mode }, active: "", profiles: null };
  await discardAll();
}

const tab = () => render(html`<${Resampling} />`);

// One card's fragment, keyed by the title in its disclosure head.
const section = (out, title) => {
  const head = out.indexOf(`</span> ${title}</button>`);
  return head < 0 ? "" : out.slice(head, out.indexOf("</section>", head));
};

// That card's state — "open" or "closed" — off the section's own class.
const MARK = '<section class="card ';
const stateOf = (out, title) => {
  const head = out.indexOf(`</span> ${title}</button>`);
  const at = head < 0 ? -1 : out.lastIndexOf(MARK, head);
  return at < 0 ? "" : out.slice(at + MARK.length).split('"')[0];
};

// One SOURCE-type subsection of a card: from its subhead to the next one.
const subsection = (chunk, name) => {
  const at = chunk.indexOf(`<div class="subhead">${name}</div>`);
  if (at < 0) return "";
  const next = chunk.indexOf('<div class="subhead">', at + 1);
  return next < 0 ? chunk.slice(at) : chunk.slice(at, next);
};

const PCM = "PCM";
const SDM = "SDM";
const LENGTH = "Filter length";
const FROM_PCM = "PCM Sources";
const FROM_DSD = "DSD Sources";

// Option sets with per-field names, so a chain can be shown to carry ITS OWN
// filter list rather than merely "a filter list". Values are the form's enum
// ids; the FFT card matches on the NAME, never on the number.
const opt = (value, label) => ({ value, options: [{ value, label }] });
const FFT_LIST = [
  { value: "1", label: "poly-sinc-gauss-long" },
  { value: "7", label: "sinc-L (FFT)" },
];
const CHAINS = {
  filter1x: opt("1", "poly-sinc-gauss-long"),
  filter: opt("2", "poly-sinc-xtr-mp"),
  oversampling1x: opt("3", "poly-sinc-short-mp"),
  oversampling: opt("4", "closed-form-M"),
};

// --- narrowing bar ------------------------------------------------------------

test("test_the_narrowing_bar_leads_the_tab", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(tab().includes("Narrow filters"));
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

test("test_the_pcm_card_splits_out_its_pcm_sources", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(section(tab(), PCM).includes(`<div class="subhead">${FROM_PCM}</div>`));
});

test("test_the_pcm_card_splits_out_its_dsd_sources", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(section(tab(), PCM).includes(`<div class="subhead">${FROM_DSD}</div>`));
});

test("test_the_sdm_card_splits_out_its_pcm_sources", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(section(tab(), SDM).includes(`<div class="subhead">${FROM_PCM}</div>`));
});

test("test_the_sdm_card_splits_out_its_dsd_sources", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(section(tab(), SDM).includes(`<div class="subhead">${FROM_DSD}</div>`));
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
  assert.ok(subsection(section(tab(), PCM), FROM_PCM).includes("<label>Dither</label>"));
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
  assert.ok(subsection(section(tab(), SDM), FROM_PCM).includes("<label>Sigma-delta modulator</label>"));
});

test("test_dsd_source_handling_for_pcm_output_carries_the_noise_filter", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(subsection(section(tab(), PCM), FROM_DSD).includes("<label>Noise filter</label>"));
});

test("test_dsd_source_handling_for_pcm_output_carries_the_sdm_to_pcm_conversion", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(subsection(section(tab(), PCM), FROM_DSD).includes("<label>SDM → PCM</label>"));
});

test("test_dsd_source_handling_for_sdm_output_carries_the_integrator", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(subsection(section(tab(), SDM), FROM_DSD).includes("<label>Integrator</label>"));
});

test("test_dsd_source_handling_for_sdm_output_carries_direct_sdm", async () => {
  await reset({ cfg: CHAINS });
  assert.ok(subsection(section(tab(), SDM), FROM_DSD).includes("<label>Direct SDM</label>"));
});

// --- FFT filter length --------------------------------------------------------

test("test_the_filter_length_card_stays_closed_with_no_fft_filter_selected", async () => {
  await reset({ cfg: CHAINS });
  assert.equal(stateOf(tab(), LENGTH), "closed");
});

test("test_the_filter_length_card_opens_for_an_fft_filter_on_the_pcm_1x_slot", async () => {
  await reset({ cfg: { ...CHAINS, filter1x: { value: "7", options: FFT_LIST } } });
  assert.equal(stateOf(tab(), LENGTH), "open");
});

test("test_the_filter_length_card_opens_for_an_fft_filter_on_the_sdm_nx_slot", async () => {
  await reset({ cfg: { ...CHAINS, oversampling: { value: "7", options: FFT_LIST } } });
  assert.equal(stateOf(tab(), LENGTH), "open");
});

test("test_an_fft_filter_merely_offered_leaves_the_filter_length_card_closed", async () => {
  await reset({ cfg: { ...CHAINS, filter1x: { value: "1", options: FFT_LIST } } });
  assert.equal(stateOf(tab(), LENGTH), "closed");
});

test("test_the_filter_length_card_carries_the_fft_size_control", async () => {
  await reset({ cfg: { ...CHAINS, filter1x: { value: "7", options: FFT_LIST } } });
  assert.ok(section(tab(), LENGTH).includes("<label>FFT filter length</label>"));
});
