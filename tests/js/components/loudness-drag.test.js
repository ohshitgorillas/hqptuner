// Behavioral suite for the Loudness card's plot while the playback-volume knob
// is being dragged.
//
// Loudness shelving is a function of the playback level: the card's plot draws
// the curve it is applying AT THAT LEVEL and captions it with the level and how
// much of the maximum shelving that works out to. While a drag is in flight the
// level the user is choosing is the one on the knob, not the one the last poll
// reported — so both the caption and the applied curve follow `volumeDrag`, and
// hand back to `volume` when the drag is released. That is the whole point of
// dragging with the plot in view.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every case
// renders the exported `Volume` tab — the same route
// tests/js/components/loudness-strip.test.js uses for the card's controls —
// driven by the exported store signals, over a staging wire fake on the real
// REST paths. Nothing is stubbed.
//
// The curve is compared DIFFERENTIALLY rather than against a golden dump
// (docs/testing.md rule 5): the claim "the plot follows the dragged value" is
// exactly "the render with the knob at X equals the render the engine at X would
// have produced", and that is what the cases assert. It needs no knowledge of
// the shelving arithmetic and survives any change to it. The paired inequality
// case keeps it honest — a plot that ignored the volume entirely would satisfy
// the equality alone.
//
// State reset is total on every call: module-level signals — `loudnessSide` and
// `volumeDrag` included — outlive a test, so a partial reset makes cases pass
// alone and fail in sequence.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/loudness-drag.test.js

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
  volumeDrag,
  volumeRange,
} from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { loudnessSide } from "../../../hqptuner/static/store/ui.js";
import { showDescriptions, keepOptionDescriptions, fastVolumeUpdates } from "../../../hqptuner/static/store/prefs.js";
import { stagingWire } from "../support/wire.js";

// A volume control that is live, so loudness is not gated by a bypassed volume.
const FREE = { volume_min: "-60", volume_max: "0", defaults_volume: "-20", fixed_volume_enabled: false };
const ON = { min: "-60", max: "0", enabled: "1", adaptive: "0" };

// The daemon's own /matrix form with loudness on, as tests/js/components/
// loudness-strip.test.js states it. The shelving range is -50..-10 dB, so the
// levels the cases use sit at opposite ends of it and cannot draw the same curve.
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

// The level the engine keeps reporting, and the one the user drags to.
const POLLED = "-20";
const DRAGGED = -50;

/** @param {{ level?: string, drag?: number | null }} [fixture] */
async function reset({ level = POLLED, drag = null } = {}) {
  stagingWire();
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  volume.value = level;
  volumeDrag.value = drag;
  volumeRange.value = ON;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  fastVolumeUpdates.value = false;
  loudnessSide.value = "low";
  matrixConfig.value = { fields: MTX };
  config.value = {
    fields: Object.entries(FREE).map(([name, value]) => ({ name, value })),
    file: {},
    active: "",
    profiles: null,
  };
  await discardAll();
}

// The Loudness card's fragment, head to close — the same slice the sibling strip
// suite takes. A tab that stopped rendering the card at all would otherwise make
// every "the caption does not say X" case pass on an empty string.
function card() {
  const out = render(html`<${Volume} />`);
  const head = out.indexOf('<div class="card-head">Loudness</div>');
  if (head < 0) throw new Error("the Volume tab rendered no Loudness card");
  return out.slice(head, out.indexOf("</section>", head));
}

// The plot's caption line, as a user reads it.
function caption() {
  const hit = /<div class="plot-caption[^"]*">([^<]*)</.exec(card());
  if (!hit) throw new Error("the Loudness card rendered no plot caption");
  return hit[1];
}

// The curve the plot says it is APPLYING, as its polyline's points. The card
// draws a second, `ghost` trace for the maximum shelving, which does not move
// with the volume — matching the class word exactly keeps the two apart.
function appliedCurve() {
  const hit = /<polyline class="plot-trace applied"[^>]*points="([^"]*)"/.exec(card());
  if (!hit) throw new Error("the Loudness card rendered no applied trace");
  return hit[1];
}

// --- the caption names the level the knob is at ------------------------------

test("test_a_drag_in_progress_captions_the_dragged_volume", async () => {
  await reset({ level: POLLED, drag: DRAGGED });
  assert.ok(caption().includes("at -50.0 dB"));
});

test("test_a_drag_in_progress_keeps_the_polled_volume_out_of_the_caption", async () => {
  await reset({ level: POLLED, drag: DRAGGED });
  assert.equal(caption().includes("at -20.0 dB"), false);
});

test("test_a_drag_to_zero_decibels_captions_zero_rather_than_the_polled_volume", async () => {
  // 0 dB is the trap: falsy, so a caption picking its source with `||` reads the
  // polled level instead of the top of the knob's travel
  await reset({ level: POLLED, drag: 0 });
  assert.ok(caption().includes("at 0.0 dB"));
});

test("test_a_released_drag_returns_the_caption_to_the_polled_volume", async () => {
  await reset({ level: POLLED, drag: DRAGGED });
  volumeDrag.value = null;
  assert.ok(caption().includes("at -20.0 dB"));
});

// --- the applied curve follows the same level --------------------------------

test("test_a_drag_in_progress_applies_the_curve_of_the_dragged_volume", async () => {
  await reset({ level: String(DRAGGED), drag: null });
  const asEngineReported = appliedCurve();
  await reset({ level: POLLED, drag: DRAGGED });
  assert.equal(appliedCurve(), asEngineReported);
});

test("test_a_drag_in_progress_moves_the_applied_curve_off_the_polled_volume", async () => {
  // the paired inequality: without it, a plot that ignored the playback level
  // altogether would satisfy the equality above
  await reset({ level: POLLED, drag: null });
  const atPolledLevel = appliedCurve();
  await reset({ level: POLLED, drag: DRAGGED });
  assert.notEqual(appliedCurve(), atPolledLevel);
});

test("test_a_released_drag_returns_the_applied_curve_to_the_polled_volume", async () => {
  await reset({ level: POLLED, drag: null });
  const atPolledLevel = appliedCurve();
  await reset({ level: POLLED, drag: DRAGGED });
  volumeDrag.value = null;
  assert.equal(appliedCurve(), atPolledLevel);
});
