// Behavioral suite for components/PlaybackVolume.js — the live volume knob.
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

import { html } from "../../hqptuner/static/lib/dom.js";
import { PlaybackVolume } from "../../hqptuner/static/components/PlaybackVolume.js";
import {
  volume,
  volumeRange,
  config,
  engineState,
  matrixConfig,
  discardAll,
  edit,
} from "../../hqptuner/static/store/state.js";
import { fastVolumeUpdates } from "../../hqptuner/static/store/prefs.js";
import { ok, stagingWire } from "./wire.js";

// Fake wire (docs/testing.md rule 4): a real pending buffer over the real REST
// paths, so `edit()` stages exactly as it does against the backend.
function wire() {
  stagingWire({ fallback: (w) => ok(w.staged) });
}

// `running` is the daemon's own /config form, keyed by FORM FIELD name — the
// authority disabledReason() reads (Auto headroom's field is volume_fixed).
async function reset({ range = null, level = null, running = {}, fast = false } = {}) {
  wire();
  volume.value = level;
  volumeRange.value = range;
  fastVolumeUpdates.value = fast;
  engineState.value = {};
  matrixConfig.value = null;
  config.value = { fields: Object.entries(running).map(([name, value]) => ({ name, value })), file: {} };
  await discardAll();
}

const card = () => render(html`<${PlaybackVolume} />`);

// One attribute off the dial, which is the only element carrying ARIA values.
const aria = (out, name) => (new RegExp(`${name}="([^"]*)"`).exec(out) || [])[1];

const ON = { enabled: "1", min: "-60", max: "0" };
const OFF = { enabled: "0", min: "-60", max: "0" };
const APPLY_HINT = "Apply the staged change to free the volume control.";

// --- the enabled flag, in each of its three wire forms -----------------------

test("test_a_string_one_enables_the_volume_control", async () => {
  await reset({ range: ON });
  assert.ok(card().includes('class="card playback "'));
});

test("test_a_numeric_one_enables_the_volume_control", async () => {
  await reset({ range: { ...ON, enabled: 1 } });
  assert.ok(card().includes('class="card playback "'));
});

test("test_a_boolean_true_enables_the_volume_control", async () => {
  await reset({ range: { ...ON, enabled: true } });
  assert.ok(card().includes('class="card playback "'));
});

test("test_a_zero_disables_the_volume_control", async () => {
  await reset({ range: OFF });
  assert.ok(card().includes('class="card playback off"'));
});

test("test_a_missing_volume_range_disables_the_volume_control", async () => {
  await reset();
  assert.ok(card().includes('class="card playback off"'));
});

test("test_a_disabled_control_grays_the_knob", async () => {
  await reset({ range: OFF });
  assert.ok(card().includes('class="knob knob-lg off"'));
});

test("test_an_enabled_control_leaves_the_knob_live", async () => {
  await reset({ range: ON });
  assert.ok(card().includes('class="knob knob-lg "'));
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
  assert.equal(card().includes("playback-hint"), false);
});

test("test_a_disabled_control_explains_itself", async () => {
  await reset({ range: OFF });
  assert.ok(card().includes("Volume control disabled"));
});

test("test_direct_sdm_is_named_as_the_cause", async () => {
  await reset({ range: OFF, running: { direct_sdm: "1" } });
  assert.ok(card().includes("Direct SDM bypasses the volume control."));
});

test("test_a_running_direct_sdm_with_nothing_staged_offers_no_apply_hint", async () => {
  await reset({ range: OFF, running: { direct_sdm: "1" } });
  assert.equal(card().includes(APPLY_HINT), false);
});

test("test_a_staged_direct_sdm_disable_points_at_apply", async () => {
  await reset({ range: OFF, running: { direct_sdm: "1" } });
  await edit("direct_sdm", "0");
  assert.ok(card().includes(APPLY_HINT));
});

test("test_fixed_volume_is_named_as_the_cause", async () => {
  await reset({ range: OFF, running: { fixed_volume_enabled: "1" } });
  assert.ok(card().includes("Fixed volume in effect"));
});

test("test_auto_headroom_is_named_by_the_fixed_volume_message", async () => {
  await reset({ range: OFF, running: { volume_fixed: "1" } });
  assert.ok(card().includes("Fixed volume in effect"));
});

test("test_a_staged_fixed_volume_disable_points_at_apply", async () => {
  await reset({ range: OFF, running: { fixed_volume_enabled: "1" } });
  await edit("fixed_volume_enabled", "0");
  assert.ok(card().includes(APPLY_HINT));
});

test("test_a_staged_auto_headroom_disable_points_at_apply", async () => {
  await reset({ range: OFF, running: { volume_fixed: "1" } });
  await edit("optimal_iso", "0");
  assert.ok(card().includes(APPLY_HINT));
});

test("test_a_running_fixed_volume_with_nothing_staged_offers_no_apply_hint", async () => {
  await reset({ range: OFF, running: { fixed_volume_enabled: "1" } });
  assert.equal(card().includes(APPLY_HINT), false);
});

test("test_a_zero_width_volume_range_is_named_as_the_cause", async () => {
  await reset({ range: OFF, running: { volume_min: "0", volume_max: "0" } });
  assert.ok(card().includes("Volume min and max are both 0 — volume control is bypassed."));
});

test("test_a_staged_widening_of_a_zero_range_points_at_apply", async () => {
  await reset({ range: OFF, running: { volume_min: "0", volume_max: "0" } });
  await edit("volume_max", "-3");
  assert.ok(card().includes(APPLY_HINT));
});

test("test_an_unwidened_zero_range_offers_no_apply_hint", async () => {
  await reset({ range: OFF, running: { volume_min: "0", volume_max: "0" } });
  assert.equal(card().includes(APPLY_HINT), false);
});

test("test_an_unexplained_disable_reads_as_no_active_stream", async () => {
  await reset({ range: OFF });
  assert.ok(card().includes("No active stream — volume adjusts live during playback."));
});

test("test_direct_sdm_outranks_fixed_volume_as_the_named_cause", async () => {
  await reset({ range: OFF, running: { direct_sdm: "1", fixed_volume_enabled: "1" } });
  assert.ok(card().includes("Direct SDM bypasses the volume control."));
});

test("test_fixed_volume_outranks_a_zero_width_range_as_the_named_cause", async () => {
  await reset({ range: OFF, running: { fixed_volume_enabled: "1", volume_min: "0", volume_max: "0" } });
  assert.ok(card().includes("Fixed volume in effect"));
});

// --- the faster-updates opt-in -----------------------------------------------
// LIVE renders this same card with the opt-in suppressed, because that page
// polls at 500 ms regardless (store/ui.js). Everywhere else the choice is real,
// so the card offers it unless a caller says otherwise.

test("test_the_card_offers_the_faster_updates_opt_in_by_default", async () => {
  await reset({ range: ON });
  assert.ok(card().includes("Faster volume updates"));
});

test("test_the_faster_updates_checkbox_is_clear_by_default", async () => {
  await reset({ range: ON });
  assert.equal(card().includes("checked"), false);
});

test("test_the_faster_updates_checkbox_reflects_an_enabled_preference", async () => {
  await reset({ range: ON, fast: true });
  assert.ok(card().includes("checked"));
});
