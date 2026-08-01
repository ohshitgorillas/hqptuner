// Behavioral suite for components/SignalPath.js — the front-panel chain bar.
// Written BEFORE the complexity refactor of SignalPath (19).
//
// Rendered through preact-render-to-string against the VENDORED preact bundle
// (tests/js/vendor-resolve.js maps the importmap specifiers), so this exercises
// the code that ships rather than an npm substitute.
//
// Every assertion is on rendered output — which chips exist, in what order, and
// what they read. None touches a private helper, and the component exports only
// itself, so the whole contract is observable exactly as a user sees it.
//
// State is driven through the store's exported source signals. `panel()`
// reassigns ALL of them on every call rather than only the ones a given case
// cares about: module-level signals persist for the life of the process, so a
// partial reset makes tests pass alone and fail in sequence.

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { SignalPath } from "../../../hqptuner/static/components/SignalPath.js";
import { engineState, engineStatus, matrixConfig, config } from "../../../hqptuner/static/store/signals.js";

const PLAYING = 2;

// The DSD-source chips read the /config form the same way the DSP tab's own
// selects do — a raw option value joined to its label — so the fake carries real
// option lists rather than pre-resolved display strings.
function dspField(name, value, options) {
  return { name, value, options: options.map((label, i) => ({ value: String(i), label })) };
}

function configFields(dsp) {
  return [
    { name: "direct_sdm", value: dsp.directSdm ?? false },
    dspField("integrator", dsp.integrator ?? "0", ["IIR", "IIR2", "FIR-bw"]),
    dspField("sdm_conversion", dsp.sdmConversion ?? "0", ["wide", "narrow", "XFi"]),
    dspField("noise_filter", dsp.noiseFilter ?? "0", ["standard", "low", "brickwall"]),
    dspField("pcm_conversion", dsp.pcmConversion ?? "0", ["traditional", "poly-short-lp", "none"]),
  ];
}

function panel({ state = 0, status = {}, metadata = {}, matrix = {}, dsp = {} } = {}) {
  engineState.value = { state: String(state) };
  engineStatus.value = { status, metadata };
  config.value = { fields: configFields(dsp) };
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: matrix.enabled ?? false },
      { name: "post_bauer_enabled", value: matrix.crossfeed ?? false },
      { name: "post_loudness_enabled", value: matrix.loudness ?? false },
    ],
    live_active: matrix.profile,
    active: "[Default]",
  };
  return render(html`<${SignalPath} />`);
}

// label -> displayed value, in render order.
function chips(out) {
  const found = {};
  for (const m of out.matchAll(/<span class="chip-label">([^<]*)<\/span><span class="chip-val">([^<]*)<\/span>/g)) {
    found[m[1]] = m[2];
  }
  return found;
}

const labels = (out) => [...out.matchAll(/<span class="chip-label">([^<]*)<\/span>/g)].map((m) => m[1]);

// SSR escapes the entities in a chip label, so "SDM → SDM" arrives encoded.
const decode = (s) => s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
const chip = (out, label) => chips(out)[Object.keys(chips(out)).find((k) => decode(k) === label)];
const has = (out, label) => labels(out).some((k) => decode(k) === label);

// label -> that chip's own class attribute, verbatim.
const chipClass = (out, label) => {
  const marked = [...out.matchAll(/<span class="(chip[^"]*)"><span class="chip-label">([^<]*)<\/span>/g)];
  return marked.find((m) => decode(m[2]) === label)?.[1] ?? "no such chip";
};

const PLAY = { state: PLAYING, metadata: { samplerate: "44100", bits: "24" }, status: { active_rate: "705600" } };
// A DSD bitstream into a DSD output — the SDM→SDM remodulation path.
const DSD_TO_SDM = {
  state: PLAYING,
  metadata: { samplerate: "2822400", bits: "1" },
  status: { active_rate: "22579200", active_filter: "poly-sinc-ext2-xla", active_shaper: "AMSDM7EC 512+fs" },
};
// The same bitstream decoded out to a PCM device.
const DSD_TO_PCM = {
  state: PLAYING,
  metadata: { samplerate: "2822400", bits: "1" },
  status: { active_rate: "705600", active_filter: "sinc-M", active_shaper: "LNS15" },
};
// PCM oversampled up to a DSD output — the modulator's own path.
const PCM_TO_SDM = {
  state: PLAYING,
  metadata: { samplerate: "44100", bits: "24" },
  status: { active_rate: "22579200", active_filter: "poly-sinc-ext2-xla", active_shaper: "ASDM7EC-super" },
};

// --- playing vs idle --------------------------------------------------------

test("test_an_idle_engine_renders_the_bar_dimmed", () => {
  assert.ok(panel().includes('class="signal-path idle"'));
});

test("test_a_playing_engine_renders_the_bar_live", () => {
  assert.ok(panel(PLAY).includes('class="signal-path live"'));
});

test("test_a_paused_engine_is_not_live", () => {
  assert.ok(panel({ ...PLAY, state: 1 }).includes('class="signal-path idle"'));
});

// --- source -----------------------------------------------------------------

test("test_an_idle_source_reads_as_a_dash", () => {
  assert.equal(chips(panel()).Source, "—");
});

test("test_a_playing_source_shows_rate_and_bit_depth", () => {
  assert.equal(chips(panel(PLAY)).Source, "44.1 kHz / 24bit");
});

test("test_a_source_with_no_bit_depth_marks_it_unknown", () => {
  assert.equal(chips(panel({ ...PLAY, metadata: { samplerate: "44100" } })).Source, "44.1 kHz / ?bit");
});

test("test_a_source_with_no_rate_reads_as_a_dash", () => {
  assert.equal(chips(panel({ ...PLAY, metadata: {} })).Source, "—");
});

test("test_a_dsd_source_is_shown_in_megahertz", () => {
  const out = panel({ ...PLAY, metadata: { samplerate: "2822400", bits: "1" } });
  assert.equal(chips(out).Source, "2.822 MHz / 1bit");
});

test("test_a_sub_kilohertz_source_is_shown_in_hertz", () => {
  assert.equal(chips(panel({ ...PLAY, metadata: { samplerate: "800", bits: "16" } })).Source, "800 Hz / 16bit");
});

// --- output -----------------------------------------------------------------

test("test_an_idle_output_reads_as_a_dash", () => {
  assert.equal(chips(panel()).Output, "—");
});

test("test_an_unreported_bit_depth_below_the_dsd_floor_shows_the_bare_rate", () => {
  assert.equal(chips(panel(PLAY)).Output, "705.6 kHz");
});

test("test_a_dsd_output_rate_is_shown_in_megahertz_and_one_bit", () => {
  const out = panel({ ...PLAY, status: { active_rate: "24576000" } });
  assert.equal(chips(out).Output, "24.576 MHz / 1bit");
});

test("test_a_zero_output_rate_reads_as_a_dash", () => {
  assert.equal(chips(panel({ ...PLAY, status: { active_rate: "0" } })).Output, "—");
});

test("test_the_output_chip_is_the_hero_chip", () => {
  assert.ok(panel(PLAY).includes('class="chip chip-hero"'));
});

// --- output bit depth -------------------------------------------------------
// The engine reports the negotiated output word length as status.active_bits,
// a digit string like every other Status field. When it is there it is the
// authority; when it is absent or "0" the chip falls back to inferring 1bit
// from a rate at or above the DSD64 floor (2822400 Hz).

// PLAY's source is 24bit, so the reported depth here is deliberately 32: a chip
// rendering the SOURCE word length would pass a 24 and fail this.
test("test_a_pcm_output_shows_the_reported_bit_depth", () => {
  const out = panel({ ...PLAY, status: { active_rate: "705600", active_bits: "32" } });
  assert.equal(chips(out).Output, "705.6 kHz / 32bit");
});

test("test_a_dsd_rate_output_reads_as_one_bit", () => {
  const out = panel({ ...PLAY, status: { active_rate: "22579200", active_bits: "1" } });
  assert.equal(chips(out).Output, "22.579 MHz / 1bit");
});

test("test_a_reported_bit_depth_of_zero_falls_back_to_the_dsd_rate_floor", () => {
  const out = panel({ ...PLAY, status: { active_rate: "22579200", active_bits: "0" } });
  assert.equal(chips(out).Output, "22.579 MHz / 1bit");
});

test("test_a_reported_bit_depth_of_zero_below_the_dsd_floor_shows_no_depth", () => {
  const out = panel({ ...PLAY, status: { active_rate: "705600", active_bits: "0" } });
  assert.equal(chips(out).Output, "705.6 kHz");
});

test("test_an_unreported_bit_depth_at_the_dsd_floor_infers_one_bit", () => {
  const out = panel({ ...PLAY, status: { active_rate: "2822400" } });
  assert.equal(chips(out).Output, "2.822 MHz / 1bit");
});

test("test_a_zero_output_rate_with_a_reported_bit_depth_still_reads_as_a_dash", () => {
  const out = panel({ ...PLAY, status: { active_rate: "0", active_bits: "24" } });
  assert.equal(chips(out).Output, "—");
});

test("test_a_missing_output_rate_with_a_reported_bit_depth_reads_as_a_dash", () => {
  assert.equal(chips(panel({ ...PLAY, status: { active_bits: "24" } })).Output, "—");
});

test("test_a_paused_engine_shows_a_dash_whatever_bit_depth_is_reported", () => {
  const out = panel({ ...PLAY, state: 1, status: { active_rate: "705600", active_bits: "24" } });
  assert.equal(chips(out).Output, "—");
});

// --- PCM source -> PCM output -----------------------------------------------
// The <pcm filter> + <pcm dither> pair, both reported live by the engine.

test("test_the_active_filter_is_shown", () => {
  const out = panel({ ...PLAY, status: { active_rate: "705600", active_filter: "sinc-M" } });
  assert.equal(chips(out).Filter, "sinc-M");
});

test("test_a_pcm_output_labels_the_shaper_chip_dither", () => {
  const out = panel({ ...PLAY, status: { active_rate: "705600", active_shaper: "NS5" } });
  assert.equal(chips(out).Dither, "NS5");
});

test("test_an_absent_filter_reads_as_a_dash", () => {
  assert.equal(chips(panel(PLAY)).Filter, "—");
});

// --- PCM source -> SDM output -----------------------------------------------
// <sdm oversampling> + <sdm modulator> (manual §4.5). This is the ONE path the
// modulator serves, so it is the one path that may name it.

test("test_a_pcm_source_into_a_dsd_output_labels_the_shaper_chip_modulator", () => {
  assert.equal(chips(panel(PCM_TO_SDM)).Modulator, "ASDM7EC-super");
});

test("test_a_pcm_source_into_a_dsd_output_still_shows_the_oversampling_filter", () => {
  assert.equal(chips(panel(PCM_TO_SDM)).Filter, "poly-sinc-ext2-xla");
});

// --- DSD source -> SDM output (SDM->SDM remodulation) ------------------------
// Integrator + SDM→SDM conversion, and neither an oversampling filter nor a
// modulator: the converter carries its own noise shaping (manual §4.5). The
// engine keeps reporting active_filter/active_shaper here regardless, which is
// exactly the stale modulator this path must stop showing (features.md 9).

test("test_a_dsd_source_into_a_dsd_output_shows_no_modulator_chip", () => {
  assert.equal(has(panel(DSD_TO_SDM), "Modulator"), false);
});

test("test_a_dsd_source_into_a_dsd_output_shows_no_shaper_value_at_all", () => {
  assert.equal(panel(DSD_TO_SDM).includes("AMSDM7EC"), false);
});

test("test_a_dsd_source_into_a_dsd_output_shows_no_filter_chip", () => {
  assert.equal(has(panel(DSD_TO_SDM), "Filter"), false);
});

test("test_a_dsd_source_into_a_dsd_output_shows_the_integrator", () => {
  assert.equal(chip(panel({ ...DSD_TO_SDM, dsp: { integrator: "2" } }), "Integrator"), "FIR-bw");
});

test("test_a_dsd_source_into_a_dsd_output_shows_the_sdm_to_sdm_conversion", () => {
  assert.equal(chip(panel({ ...DSD_TO_SDM, dsp: { sdmConversion: "2" } }), "SDM → SDM"), "XFi");
});

test("test_the_remodulation_chain_runs_source_integrator_conversion_output", () => {
  assert.deepEqual(labels(panel(DSD_TO_SDM)).map(decode), ["Source", "Integrator", "SDM → SDM", "Output"]);
});

test("test_a_dsd_source_is_recognized_from_the_metadata_sdm_flag_alone", () => {
  const out = panel({ ...DSD_TO_SDM, metadata: { sdm: "1" } });
  assert.equal(has(out, "Integrator"), true);
});

test("test_an_unmatched_conversion_value_falls_back_to_the_raw_value", () => {
  assert.equal(chip(panel({ ...DSD_TO_SDM, dsp: { sdmConversion: "9" } }), "SDM → SDM"), "9");
});

// --- DirectSDM ---------------------------------------------------------------
// "Disables all processing when source is DSD content and output format is SDM
// to a DSD-device or file" (manual §4.5) — so the bar shows a bare pass-through.

test("test_direct_sdm_collapses_the_chain_to_a_bit_perfect_pass_through", () => {
  const out = panel({ ...DSD_TO_SDM, dsp: { directSdm: true } });
  assert.deepEqual(labels(out).map(decode), ["Source", "Direct SDM", "Output"]);
});

test("test_direct_sdm_suppresses_the_matrix_chip", () => {
  const out = panel({ ...DSD_TO_SDM, dsp: { directSdm: true }, matrix: { enabled: true } });
  assert.equal(has(out, "Matrix"), false);
});

test("test_direct_sdm_suppresses_dac_correction", () => {
  const out = panel({
    ...DSD_TO_SDM,
    status: { ...DSD_TO_SDM.status, correction: "1" },
    dsp: { directSdm: true },
  });
  assert.equal(has(out, "Correction"), false);
});

test("test_direct_sdm_is_inert_while_a_pcm_source_plays", () => {
  assert.equal(has(panel({ ...PCM_TO_SDM, dsp: { directSdm: true } }), "Modulator"), true);
});

// --- DSD source -> PCM output ------------------------------------------------
// pdm_filt + pdm_conv decode to PCM, then the ordinary <pcm filter> + dither
// carry it to the target rate (manual §4.4).

test("test_a_dsd_source_into_a_pcm_output_shows_the_noise_filter", () => {
  assert.equal(chip(panel({ ...DSD_TO_PCM, dsp: { noiseFilter: "2" } }), "Noise filter"), "brickwall");
});

test("test_a_dsd_source_into_a_pcm_output_shows_the_sdm_to_pcm_conversion", () => {
  assert.equal(chip(panel({ ...DSD_TO_PCM, dsp: { pcmConversion: "1" } }), "SDM → PCM"), "poly-short-lp");
});

test("test_a_dsd_source_into_a_pcm_output_still_shows_the_resampling_filter", () => {
  assert.equal(chips(panel(DSD_TO_PCM)).Filter, "sinc-M");
});

test("test_a_dsd_source_into_a_pcm_output_labels_the_shaper_chip_dither", () => {
  assert.equal(chips(panel(DSD_TO_PCM)).Dither, "LNS15");
});

test("test_the_dsd_to_pcm_chain_runs_decode_then_resample", () => {
  const expected = ["Source", "Noise filter", "SDM → PCM", "Filter", "Dither", "Output"];
  assert.deepEqual(labels(panel(DSD_TO_PCM)).map(decode), expected);
});

// --- matrix chip ------------------------------------------------------------

test("test_a_disabled_matrix_shows_no_chip", () => {
  assert.equal("Matrix" in chips(panel(PLAY)), false);
});

test("test_an_enabled_matrix_on_the_default_profile_reads_as_on", () => {
  assert.equal(chips(panel({ ...PLAY, matrix: { enabled: true } })).Matrix, "On");
});

test("test_an_enabled_matrix_shows_its_active_profile_name", () => {
  const out = panel({ ...PLAY, matrix: { enabled: true, profile: "HD650" } });
  assert.equal(chips(out).Matrix, "HD650");
});

test("test_an_over_long_profile_name_is_truncated", () => {
  const out = panel({ ...PLAY, matrix: { enabled: true, profile: "a".repeat(30) } });
  assert.equal(chips(out).Matrix, `${"a".repeat(19)}…`);
});

test("test_a_profile_name_at_the_length_limit_is_not_truncated", () => {
  const name = "b".repeat(20);
  assert.equal(chips(panel({ ...PLAY, matrix: { enabled: true, profile: name } })).Matrix, name);
});

// --- post-process slot ------------------------------------------------------
// Crossfeed and loudness share one slot: both on collapses to a single "DSP"
// chip rather than crowding the panel with two.

test("test_crossfeed_alone_shows_a_crossfeed_chip", () => {
  assert.equal(chips(panel({ ...PLAY, matrix: { crossfeed: true } })).Crossfeed, "On");
});

test("test_loudness_alone_shows_a_loudness_chip", () => {
  assert.equal(chips(panel({ ...PLAY, matrix: { loudness: true } })).Loudness, "On");
});

test("test_crossfeed_and_loudness_together_collapse_to_one_dsp_chip", () => {
  assert.equal(chips(panel({ ...PLAY, matrix: { crossfeed: true, loudness: true } })).DSP, "On");
});

test("test_the_collapsed_slot_replaces_the_individual_crossfeed_chip", () => {
  const out = panel({ ...PLAY, matrix: { crossfeed: true, loudness: true } });
  assert.equal("Crossfeed" in chips(out), false);
});

test("test_neither_post_process_shows_no_slot", () => {
  const found = chips(panel(PLAY));
  assert.ok(!("DSP" in found) && !("Crossfeed" in found) && !("Loudness" in found));
});

// --- DAC correction ---------------------------------------------------------

test("test_active_dac_correction_shows_a_chip", () => {
  const out = panel({ ...PLAY, status: { active_rate: "705600", correction: "1" } });
  assert.equal(chips(out).Correction, "On");
});

test("test_inactive_dac_correction_shows_no_chip", () => {
  const out = panel({ ...PLAY, status: { active_rate: "705600", correction: "0" } });
  assert.equal("Correction" in chips(out), false);
});

// --- chain assembly ---------------------------------------------------------

test("test_the_bare_chain_is_source_filter_dither_output", () => {
  assert.deepEqual(labels(panel(PLAY)), ["Source", "Filter", "Dither", "Output"]);
});

test("test_the_full_chain_runs_in_processing_order", () => {
  // matrix and crossfeed are input-side; correction is output-rate and follows
  // the shaper — the ordering docs/architecture.md §3 originally got wrong
  const out = panel({
    ...PLAY,
    status: { active_rate: "705600", correction: "1" },
    matrix: { enabled: true, crossfeed: true },
  });
  assert.deepEqual(labels(out), ["Source", "Matrix", "Crossfeed", "Filter", "Dither", "Correction", "Output"]);
});

test("test_the_chain_carries_one_connector_between_each_pair_of_chips", () => {
  const out = panel(PLAY);
  const links = [...out.matchAll(/<span class="link">/g)].length;
  assert.equal(links, labels(out).length - 1);
});

// --- placeholder chips ------------------------------------------------------
// A chip standing in for a figure the engine is not reporting reads "—", and
// says so in its class as well as its text, so the placeholder can be drawn in
// the readout face rather than as ordinary chip text. The mark follows the
// VALUE, not the transport: a stopped engine dashes every chip, but a chip can
// read "—" mid-playback too (an engine reporting no filter) and is marked the
// same.

test("test_a_stopped_sources_placeholder_chip_is_marked_as_a_dash", () => {
  assert.ok(chipClass(panel(), "Source").split(" ").includes("chip-dash"));
});

test("test_a_placeholder_chip_is_marked_as_a_dash_while_playing_too", () => {
  // PLAY reports no active_filter, so the Filter chip reads "—" mid-playback
  assert.ok(chipClass(panel(PLAY), "Filter").split(" ").includes("chip-dash"));
});

test("test_a_chip_carrying_a_real_value_is_not_marked_as_a_dash", () => {
  assert.equal(chipClass(panel(PLAY), "Source"), "chip");
});

test("test_the_stopped_output_chip_is_both_the_hero_and_a_dash", () => {
  const cls = chipClass(panel(), "Output").split(" ");
  assert.deepEqual({ hero: cls.includes("chip-hero"), dash: cls.includes("chip-dash") }, { hero: true, dash: true });
});

test("test_a_chip_that_is_neither_hero_nor_placeholder_carries_no_empty_class_slots", () => {
  const out = panel({ ...PLAY, status: { active_rate: "705600", active_filter: "sinc-M" } });
  assert.equal(chipClass(out, "Filter"), "chip");
});
