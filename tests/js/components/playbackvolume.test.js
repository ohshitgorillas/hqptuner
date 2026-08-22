// Behavioral suite for components/volume/Playback.js — the live volume knob.
// Written BEFORE the complexity refactor of PlaybackVolume (11); not one case
// may change when it is split.
//
// Policy (docs/testing.md): public API only, one assertion per test. The
// component exports only itself and `disabledReason` stays private — every one
// of its branches is a pure function of exported store signals (`volumeRange`,
// `volume`, `config`, plus the staged buffer reached through `edit`), so the
// whole contract is observable in the rendered card exactly as a user sees it.
//
// Assertions read the Knob's ARIA surface (aria-valuemin/max/now/text) rather
// than any internal prop: that is the same contract a screen reader consumes,
// and it survives any re-shaping of the markup around the dial.
//
// NOT REACHABLE from here, and deliberately not exported to make it so: the
// module-private `dragging`/`display` signals. They are set only inside the
// Knob's onLive/onCommit handlers, which server-side rendering never fires, so
// the `dragging.value ? display.value : engine` branch is covered on its engine
// side only. Same for the throttled setVolume writer behind those handlers.
//
// State reset is total on every call: module-level signals outlive a test, so a
// partial reset makes cases pass alone and fail in sequence.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/playbackvolume.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { PlaybackVolume } from "../../../hqptuner/static/components/volume/Playback.js";
import { volume, volumeRange, config, engineState, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { ok, stagingWire } from "../support/wire.js";
import { attr, classes, disabledRegion, elements } from "../support/markup.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// Fake wire (docs/testing.md rule 4): a real pending buffer over the real REST
// paths, so `edit()` stages exactly as it does against the backend.
function wire() {
  stagingWire({ fallback: (w) => ok(w.staged) });
}

// `running` is the daemon's own /config form, keyed by FORM FIELD name — the
// authority disabledReason() reads (Auto headroom's field is volume_fixed).
/**
 * `range` carries the VolumeRange report as the engine spells it: the flag
 * arrives as a string, a number or a bool, and min/max are absent on the cases
 * that pin the defaults. `null` is the engine reporting no range at all.
 *
 * @param {{
 *   range?: Record<string, string | number | boolean> | null,
 *   level?: string | null,
 *   running?: Record<string, string>,
 * }} [scenario]
 * @returns {Promise<void>}
 */
async function reset({ range = null, level = null, running = {} } = {}) {
  wire();
  volume.value = level;
  volumeRange.value = range;
  engineState.value = {};
  matrixConfig.value = null;
  config.value = { fields: Object.entries(running).map(([name, value]) => ({ name, value })), file: {} };
  await discardAll();
}

const card = () => render(html`<${PlaybackVolume} />`);

// One attribute off the dial, which is the only element carrying ARIA values.
/**
 * @param {string} out
 * @param {string} name
 */
const aria = (out, name) => (new RegExp(`${name}="([^"]*)"`).exec(out) || [])[1];

// The dial itself: the one element carrying the `knob` class token, as opposed
// to the `knob-*` parts it is built from.
/** @param {MarkupElement} el */
const isKnob = (el) => classes(el).includes("knob");

/**
 * @param {string} out
 * @returns {MarkupElement}
 */
function knob(out) {
  const hit = elements(out).find(isKnob);
  if (!hit) throw new Error("no dial in the fragment");
  return hit;
}

// The dial's own range input, and the quantum it steps in. Read off the slider
// rather than any other input in the card, the way tests/js/components/
// loudness-strip.test.js reads a dial's step.
/** @param {string} out */
const sliderStep = (out) => {
  const input = (/<input[^>]*knob-slider[^>]*>/.exec(out) || [""])[0];
  return (/\sstep="([^"]*)"/.exec(input) || [])[1];
};

const ON = { enabled: "1", min: "-60", max: "0" };
const OFF = { enabled: "0", min: "-60", max: "0" };

// The hint's machine identities, which is what the card is asked here — never
// the sentence it prints (docs/testing.md rule 9). `data-hint` names the cause
// that grayed the knob and `data-staged` says whether the user has already
// staged the fix; both live on the hint element itself.

/**
 * @param {string} frag
 * @returns {MarkupElement | undefined}
 */
const hintEl = (frag) => elements(frag).find((el) => attr(el, "data-hint") !== undefined);

/**
 * The cause the card names, or null when it names none.
 *
 * @param {string} frag
 * @returns {string | null}
 */
const cause = (frag) => {
  const el = hintEl(frag);
  return el ? (attr(el, "data-hint") ?? null) : null;
};

/**
 * Whether the hint reports a staged fix, or null when there is no hint.
 *
 * @param {string} frag
 * @returns {string | null}
 */
const staged = (frag) => {
  const el = hintEl(frag);
  return el ? (attr(el, "data-staged") ?? null) : null;
};

// --- the enabled flag, in each of its three wire forms -----------------------

test("test_a_string_one_enables_the_volume_control", async () => {
  await reset({ range: ON });
  assert.equal(
    elements(card()).some((el) => classes(el).includes("off")),
    false,
  );
});

test("test_a_numeric_one_enables_the_volume_control", async () => {
  await reset({ range: { ...ON, enabled: 1 } });
  assert.equal(
    elements(card()).some((el) => classes(el).includes("off")),
    false,
  );
});

test("test_a_boolean_true_enables_the_volume_control", async () => {
  await reset({ range: { ...ON, enabled: true } });
  assert.equal(
    elements(card()).some((el) => classes(el).includes("off")),
    false,
  );
});

// Truthy to JavaScript, but not one of the three forms the daemon reports the
// flag in, so it reads as disabled like anything else the engine did not say.
test("test_an_unrecognized_enabled_value_disables_the_volume_control", async () => {
  await reset({ range: { ...ON, enabled: "yes" } });
  assert.ok(classes(knob(card())).includes("off"));
});

test("test_a_zero_puts_the_reason_hint_inside_the_disabled_region", async () => {
  await reset({ range: OFF });
  assert.notEqual(hintEl(disabledRegion(card())), undefined);
});

test("test_a_missing_volume_range_puts_the_reason_hint_inside_the_disabled_region", async () => {
  await reset();
  assert.notEqual(hintEl(disabledRegion(card())), undefined);
});

test("test_a_disabled_control_grays_the_knob", async () => {
  await reset({ range: OFF });
  assert.ok(classes(knob(card())).includes("off"));
});

test("test_an_enabled_control_leaves_the_knob_live", async () => {
  await reset({ range: ON });
  assert.equal(classes(knob(card())).includes("off"), false);
});

// Behavior 9: the dial and the reason hint are ONE region, so what the engine
// takes away it takes away in one piece.

test("test_the_disabled_region_encloses_the_knob", async () => {
  await reset({ range: OFF });
  assert.ok(elements(disabledRegion(card())).some(isKnob));
});

// --- the range the knob spans ------------------------------------------------

test("test_the_knob_spans_the_reported_minimum", async () => {
  await reset({ range: { ...ON, min: "-45" } });
  assert.equal(aria(card(), "aria-valuemin"), "-45");
});

test("test_the_knob_spans_the_reported_maximum", async () => {
  await reset({ range: { ...ON, max: "6" } });
  assert.equal(aria(card(), "aria-valuemax"), "6");
});

test("test_a_missing_minimum_defaults_to_minus_sixty_dbfs", async () => {
  await reset({ range: { enabled: "1", max: "0" } });
  assert.equal(aria(card(), "aria-valuemin"), "-60");
});

test("test_a_missing_maximum_defaults_to_zero_dbfs", async () => {
  await reset({ range: { enabled: "1", min: "-60" } });
  assert.equal(aria(card(), "aria-valuemax"), "0");
});

// Half a decibel is the quantum the volume dial moves in, unchanged by the
// removal of the faster-updates opt-in from this card.

test("test_the_volume_dial_steps_in_half_decibel_increments", async () => {
  await reset({ range: ON, level: "-12" });
  assert.equal(sliderStep(card()), "0.5");
});

// --- the value shown ---------------------------------------------------------

test("test_the_engine_reported_volume_is_shown", async () => {
  await reset({ range: ON, level: "-12" });
  assert.equal(aria(card(), "aria-valuenow"), "-12");
});

test("test_a_missing_engine_volume_falls_back_to_the_minimum", async () => {
  await reset({ range: { ...ON, min: "-45" } });
  assert.equal(aria(card(), "aria-valuenow"), "-45");
});

test("test_the_readout_carries_the_decibel_unit", async () => {
  await reset({ range: ON, level: "-12" });
  assert.equal(aria(card(), "aria-valuetext"), "-12.0 dB");
});

// --- why the control is disabled ---------------------------------------------
// The engine reports "disabled" without a cause; the card names it from the
// RUNNING config, so a staged-but-unapplied change never rewrites the message.

test("test_an_enabled_control_shows_no_hint", async () => {
  await reset({ range: ON });
  assert.equal(cause(card()), null);
});

test("test_a_disabled_control_explains_itself", async () => {
  await reset({ range: OFF });
  assert.notEqual(cause(card()), null);
});

test("test_direct_sdm_is_named_as_the_cause", async () => {
  await reset({ range: OFF, running: { direct_sdm: "1" } });
  assert.equal(cause(card()), "direct-sdm");
});

test("test_a_running_direct_sdm_with_nothing_staged_offers_no_apply_hint", async () => {
  await reset({ range: OFF, running: { direct_sdm: "1" } });
  assert.equal(staged(card()), "0");
});

test("test_a_staged_direct_sdm_disable_points_at_apply", async () => {
  await reset({ range: OFF, running: { direct_sdm: "1" } });
  await edit("direct_sdm", "0");
  assert.equal(staged(card()), "1");
});

test("test_fixed_volume_is_named_as_the_cause", async () => {
  await reset({ range: OFF, running: { fixed_volume_enabled: "1" } });
  assert.equal(cause(card()), "fixed-volume");
});

test("test_auto_headroom_is_named_by_the_fixed_volume_cause", async () => {
  await reset({ range: OFF, running: { volume_fixed: "1" } });
  assert.equal(cause(card()), "fixed-volume");
});

test("test_a_staged_fixed_volume_disable_points_at_apply", async () => {
  await reset({ range: OFF, running: { fixed_volume_enabled: "1" } });
  await edit("fixed_volume_enabled", "0");
  assert.equal(staged(card()), "1");
});

test("test_a_staged_auto_headroom_disable_points_at_apply", async () => {
  await reset({ range: OFF, running: { volume_fixed: "1" } });
  await edit("optimal_iso", "0");
  assert.equal(staged(card()), "1");
});

test("test_a_running_fixed_volume_with_nothing_staged_offers_no_apply_hint", async () => {
  await reset({ range: OFF, running: { fixed_volume_enabled: "1" } });
  assert.equal(staged(card()), "0");
});

test("test_a_zero_width_volume_range_is_named_as_the_cause", async () => {
  await reset({ range: OFF, running: { volume_min: "0", volume_max: "0" } });
  assert.equal(cause(card()), "zero-range");
});

test("test_a_staged_widening_of_a_zero_range_points_at_apply", async () => {
  await reset({ range: OFF, running: { volume_min: "0", volume_max: "0" } });
  await edit("volume_max", "-3");
  assert.equal(staged(card()), "1");
});

test("test_an_unwidened_zero_range_offers_no_apply_hint", async () => {
  await reset({ range: OFF, running: { volume_min: "0", volume_max: "0" } });
  assert.equal(staged(card()), "0");
});

test("test_an_unexplained_disable_reads_as_no_active_stream", async () => {
  await reset({ range: OFF });
  assert.equal(cause(card()), "no-stream");
});

test("test_direct_sdm_outranks_fixed_volume_as_the_named_cause", async () => {
  await reset({ range: OFF, running: { direct_sdm: "1", fixed_volume_enabled: "1" } });
  assert.equal(cause(card()), "direct-sdm");
});

test("test_fixed_volume_outranks_a_zero_width_range_as_the_named_cause", async () => {
  await reset({ range: OFF, running: { fixed_volume_enabled: "1", volume_min: "0", volume_max: "0" } });
  assert.equal(cause(card()), "fixed-volume");
});

// --- no faster-updates opt-in ------------------------------------------------
// The volume page polls every second unconditionally now (store/ui.js), so there
// is no choice left to offer. The case that pinned the ABSENCE of the old
// wording is gone: that sentence is nowhere in shipped source, so its absence
// constrained nothing. The opt-in's class is a wire identifier and still bites.

test("test_the_card_carries_no_poll_opt_in_element", async () => {
  await reset({ range: ON });
  assert.equal(card().includes("poll-quick"), false);
});
