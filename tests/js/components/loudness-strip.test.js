// Behavioral suite for the Loudness card's control strip on the Volume tab:
// the Bass|Treble segmented switch, the one-side-at-a-time knob strip, the
// frequency knob's daemon-form bounds and log-scaled slider, and the dirty
// dot that keeps hidden-side staged edits visible.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every
// case renders through the exported `Volume`, driven by the exported store
// signals (`matrixConfig` carrying the daemon's own /matrix form fields,
// `loudnessSide` carrying the side switch) with edits staged through `edit()`
// over a faked wire on the real REST paths. Nothing is stubbed.
//
// State reset is total on every call: module-level signals — `loudnessSide`
// included — outlive a test, so a partial reset makes cases pass alone and
// fail in sequence.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/loudness-strip.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Volume } from "../../../hqptuner/static/components/tabs/VolumeTab.js";
import {
  config,
  matrixConfig,
  metadata,
  engineState,
  enums,
  volume,
  volumeRange,
} from "../../../hqptuner/static/store/signals.js";
import { edit, discardAll } from "../../../hqptuner/static/store/actions.js";
import { loudnessSide } from "../../../hqptuner/static/store/ui.js";
import { showDescriptions, keepOptionDescriptions, fastVolumeUpdates } from "../../../hqptuner/static/store/prefs.js";
import { stagingWire } from "../support/wire.js";

// A volume control that is live, so loudness is not gated by a bypassed volume.
const FREE = { volume_min: "-60", volume_max: "0", defaults_volume: "-20", fixed_volume_enabled: false };
const formFields = (spec) => Object.entries(spec).map(([name, value]) => ({ name, value }));

// The daemon's /matrix form, loudness on, with DISTINCT values on every
// numeric field so each knob is findable by its own aria-valuenow.
const MTX = [
  { name: "post_loudness_enabled", value: true },
  { name: "post_loudness_lowfreq", value: "80", min: "20", max: "20000" },
  { name: "post_loudness_lowlevel", value: "-9", min: "-20", max: "20" },
  { name: "post_loudness_lowsteep", value: "7" },
  { name: "post_loudness_lowtype", value: "0" },
  { name: "post_loudness_highfreq", value: "5000", min: "20", max: "20000" },
  { name: "post_loudness_highlevel", value: "-3", min: "-20", max: "20" },
  { name: "post_loudness_highsteep", value: "4" },
  { name: "post_loudness_hightype", value: "0" },
  { name: "post_loudness_rangelow", value: "-50", min: "-90", max: "0" },
  { name: "post_loudness_rangehigh", value: "-10", min: "-90", max: "0" },
];

// The same form as some daemon builds ship it: the corner-frequency fields
// carry no min/max attributes at all (tests/fake_http.py renders them bare).
const MTX_BARE = MTX.map((f) =>
  f.name === "post_loudness_lowfreq" || f.name === "post_loudness_highfreq" ? { name: f.name, value: f.value } : f,
);

async function reset(fields = MTX) {
  stagingWire();
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  volume.value = null;
  volumeRange.value = null;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  fastVolumeUpdates.value = false;
  loudnessSide.value = "low";
  matrixConfig.value = { fields };
  config.value = { fields: formFields(FREE), file: {}, active: "", profiles: null };
  await discardAll();
}

const tab = () => render(html`<${Volume} />`);

// The Loudness card's fragment, head to close.
const card = () => {
  const out = tab();
  const head = out.indexOf('<div class="card-head">Loudness</div>');
  return head < 0 ? "" : out.slice(head, out.indexOf("</section>", head));
};

// Segment buttons, addressed by label text; a dirty option carries the dot
// span inside its button, so the match is on containment, not equality.
const buttons = (out) =>
  out
    .split("<button")
    .slice(1)
    .map((s) => s.split("</button>")[0]);
const button = (out, text) => buttons(out).find((b) => b.slice(b.indexOf(">") + 1).includes(text)) || "";
const attrsOf = (b) => b.slice(0, b.indexOf(">"));
const bodyOf = (b) => b.slice(b.indexOf(">") + 1);

// Knob chunks: each rendered knob is one svg dial (role="slider" carrying the
// ARIA values) followed by its own range input, so splitting on the role
// pairs every dial's attributes with its slider.
const knobs = (frag) => frag.split('role="slider"').slice(1);
const knobAt = (frag, now) => knobs(frag).find((k) => k.includes(`aria-valuenow="${now}"`)) || "";
const sliderStep = (chunk) => {
  const input = (/<input[^>]*knob-slider[^>]*>/.exec(chunk) || [""])[0];
  return (/\sstep="([^"]*)"/.exec(input) || [])[1];
};

// --- the Bass|Treble switch -----------------------------------------------------

test("test_bass_is_the_active_segment_on_a_fresh_render", async () => {
  await reset();
  assert.ok(attrsOf(button(card(), "Bass")).includes('class="seg active"'));
});

test("test_switching_the_side_to_high_lights_the_treble_segment", async () => {
  await reset();
  loudnessSide.value = "high";
  assert.ok(attrsOf(button(card(), "Treble")).includes('class="seg active"'));
});

// --- one side's controls at a time ------------------------------------------------

test("test_the_low_side_shows_its_own_frequency_on_the_dial", async () => {
  await reset();
  assert.ok(card().includes('aria-valuenow="80"'));
});

test("test_the_hidden_high_side_frequency_appears_on_no_dial", async () => {
  await reset();
  assert.equal(card().includes('aria-valuenow="5000"'), false);
});

test("test_the_high_side_shows_its_own_frequency_on_the_dial", async () => {
  await reset();
  loudnessSide.value = "high";
  assert.ok(card().includes('aria-valuenow="5000"'));
});

// --- the frequency knob's real-unit bounds from the daemon form -------------------

test("test_the_frequency_dial_takes_its_minimum_from_the_daemon_form", async () => {
  await reset();
  assert.ok(knobAt(card(), "80").includes('aria-valuemin="20"'));
});

test("test_the_frequency_dial_takes_its_maximum_from_the_daemon_form", async () => {
  await reset();
  assert.ok(knobAt(card(), "80").includes('aria-valuemax="20000"'));
});

// --- a form shipping no bounds falls back to the audible range --------------------

test("test_a_bass_frequency_field_without_bounds_falls_back_to_a_20hz_minimum", async () => {
  await reset(MTX_BARE);
  assert.ok(knobAt(card(), "80").includes('aria-valuemin="20"'));
});

test("test_a_bass_frequency_field_without_bounds_falls_back_to_a_20khz_maximum", async () => {
  await reset(MTX_BARE);
  assert.ok(knobAt(card(), "80").includes('aria-valuemax="20000"'));
});

test("test_a_treble_frequency_field_without_bounds_falls_back_to_a_20hz_minimum", async () => {
  await reset(MTX_BARE);
  loudnessSide.value = "high";
  assert.ok(knobAt(card(), "5000").includes('aria-valuemin="20"'));
});

test("test_a_treble_frequency_field_without_bounds_falls_back_to_a_20khz_maximum", async () => {
  await reset(MTX_BARE);
  loudnessSide.value = "high";
  assert.ok(knobAt(card(), "5000").includes('aria-valuemax="20000"'));
});

// --- log knobs slide continuously, linear knobs step ------------------------------

test("test_the_frequency_slider_accepts_continuous_values", async () => {
  await reset();
  assert.equal(sliderStep(knobAt(card(), "80")), "any");
});

test("test_the_steepness_slider_accepts_continuous_values", async () => {
  await reset();
  assert.equal(sliderStep(knobAt(card(), "7")), "any");
});

test("test_the_level_slider_steps_at_a_fixed_quantum", async () => {
  await reset();
  // bound first: a missing level knob or a step-less slider must fail here,
  // not slide through as undefined !== "any" (reviewer finding)
  const step = sliderStep(knobAt(card(), "-9"));
  assert.ok(step !== undefined && step !== "any");
});

// --- hidden-side staged edits stay visible ----------------------------------------

test("test_a_staged_edit_on_the_hidden_side_dots_its_segment_button", async () => {
  await reset();
  await edit("loudness_high_level", "-6");
  assert.ok(bodyOf(button(card(), "Treble")).includes('<span class="seg-dirty-dot"'));
});

test("test_no_staged_edits_leave_both_segment_buttons_undotted", async () => {
  await reset();
  assert.equal(card().includes("seg-dirty-dot"), false);
});

test("test_a_staged_edit_on_the_active_side_leaves_its_segment_button_undotted", async () => {
  await reset();
  await edit("loudness_low_level", "-6");
  assert.equal(bodyOf(button(card(), "Bass")).includes("seg-dirty-dot"), false);
});
