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

import { html } from "../../hqptuner/static/lib/dom.js";
import { SignalPath } from "../../hqptuner/static/components/SignalPath.js";
import { engineState, engineStatus, matrixConfig } from "../../hqptuner/static/store/state.js";

const PLAYING = 2;

function panel({ state = 0, status = {}, metadata = {}, matrix = {} } = {}) {
  engineState.value = { state: String(state) };
  engineStatus.value = { status, metadata };
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

const PLAY = { state: PLAYING, metadata: { samplerate: "44100", bits: "24" }, status: { active_rate: "705600" } };

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

test("test_a_pcm_output_rate_is_shown_in_kilohertz", () => {
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

// --- filter and shaper ------------------------------------------------------

test("test_the_active_filter_is_shown", () => {
  const out = panel({ ...PLAY, status: { active_rate: "705600", active_filter: "sinc-M" } });
  assert.equal(chips(out).Filter, "sinc-M");
});

test("test_the_active_shaper_is_shown", () => {
  const out = panel({ ...PLAY, status: { active_rate: "705600", active_shaper: "NS5" } });
  assert.equal(chips(out).Shaper, "NS5");
});

test("test_an_absent_filter_reads_as_a_dash", () => {
  assert.equal(chips(panel(PLAY)).Filter, "—");
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

test("test_the_bare_chain_is_source_filter_shaper_output", () => {
  assert.deepEqual(labels(panel(PLAY)), ["Source", "Filter", "Shaper", "Output"]);
});

test("test_the_full_chain_runs_in_processing_order", () => {
  // matrix and crossfeed are input-side; correction is output-rate and follows
  // the shaper — the ordering docs/outline §3 originally got wrong
  const out = panel({
    ...PLAY,
    status: { active_rate: "705600", correction: "1" },
    matrix: { enabled: true, crossfeed: true },
  });
  assert.deepEqual(labels(out), ["Source", "Matrix", "Crossfeed", "Filter", "Shaper", "Correction", "Output"]);
});

test("test_the_chain_carries_one_connector_between_each_pair_of_chips", () => {
  const out = panel(PLAY);
  const links = [...out.matchAll(/<span class="link">/g)].length;
  assert.equal(links, labels(out).length - 1);
});
