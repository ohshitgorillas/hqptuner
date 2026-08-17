// Behavioral suite for the axis the Playback volume dial spans, and where that
// axis comes from: the engine's own VolumeRange report while the engine owns the
// volume control, and the RUNNING config's volume_min/volume_max once it does
// not.
//
// Why the two differ: measured on the live daemon under fixed volume, the engine
// keeps reporting its own range (enabled="0", min="-12", max="0", volume
// "-3.0103") while the configured range was volume_min=-60, volume_max=-3
// (docs/protocol.md, hqplayerd-readme.txt §1.2). A dial drawn on the engine's
// range while disabled therefore reads mid-scale for a level that is in fact at
// the top of what the daemon is configured to do.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every case
// renders the exported `PlaybackVolumeBody` and reads the dial's ARIA surface —
// aria-valuemin/max/now on the `role="slider"` element — which is the same
// contract a screen reader consumes and survives any re-shaping of the markup
// around the dial. Disabledness is read as the `off` class token the way
// tests/js/components/playbackvolume.test.js already reads it; no new probe.
//
// State reset is total on every call: module-level signals outlive a test file,
// so a partial reset makes cases pass alone and fail in sequence.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/playbackvolume-axis.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { PlaybackVolumeBody } from "../../../hqptuner/static/components/PlaybackVolume.js";
import {
  volume,
  volumeDrag,
  volumeRange,
  config,
  engineState,
  matrixConfig,
} from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { ok, stagingWire } from "../support/wire.js";
import { classes, elements } from "../support/markup.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

/**
 * `running` is the daemon's own /config form, keyed by FORM FIELD name, so an
 * empty one is the shape /api/config being unavailable leaves behind.
 *
 * @param {{
 *   range?: Record<string, string> | null,
 *   level?: string | null,
 *   running?: Record<string, string>,
 * }} [scenario]
 * @returns {Promise<void>}
 */
async function reset({ range = null, level = null, running = {} } = {}) {
  // Fake wire (docs/testing.md rule 4): a real pending buffer over the real
  // REST paths, so nothing of ours is stubbed.
  stagingWire({ fallback: (w) => ok(w.staged) });
  volume.value = level;
  volumeDrag.value = null;
  volumeRange.value = range;
  engineState.value = {};
  matrixConfig.value = null;
  config.value = { fields: Object.entries(running).map(([name, value]) => ({ name, value })), file: {} };
  await discardAll();
}

const body = () => render(html`<${PlaybackVolumeBody} />`);

// The dial: the one element announcing itself as a slider. Raising on anything
// else keeps a case from silently reading ARIA off some other control.
/**
 * @param {string} out
 * @returns {MarkupElement}
 */
function dial(out) {
  const hits = elements(out).filter((el) => /\brole="slider"/.test(el.attrs));
  if (hits.length !== 1) throw new Error(`expected exactly one dial in the fragment, found ${hits.length}`);
  return hits[0];
}

/**
 * @param {string} out
 * @param {string} name
 */
const aria = (out, name) => (new RegExp(`${name}="([^"]*)"`).exec(dial(out).attrs) || [])[1];

// The engine's reported range, which stays its own whichever way the flag reads.
const ENGINE = { min: "-12", max: "0" };
const ON = { ...ENGINE, enabled: "1" };
const OFF = { ...ENGINE, enabled: "0" };
const LEVEL = "-3.01";
// The configured range the live daemon was measured under while fixed.
const CONFIGURED = { volume_min: "-60", volume_max: "-3" };
// Both zero bypasses the volume control completely (HQPlayer manual §4.2).
const BYPASSED = { volume_min: "0", volume_max: "0" };

// --- the dial is announced as the playback volume ----------------------------

test("test_the_dial_announces_itself_as_the_playback_volume", async () => {
  await reset({ range: ON, level: LEVEL });
  assert.match(dial(body()).attrs, /aria-label="Playback volume"/);
});

// --- enabled: the engine owns the axis ---------------------------------------

test("test_an_enabled_control_spans_the_engine_reported_minimum", async () => {
  await reset({ range: ON, level: LEVEL, running: CONFIGURED });
  assert.equal(aria(body(), "aria-valuemin"), "-12");
});

test("test_an_enabled_control_spans_the_engine_reported_maximum", async () => {
  await reset({ range: ON, level: LEVEL, running: CONFIGURED });
  assert.equal(aria(body(), "aria-valuemax"), "0");
});

test("test_an_enabled_control_sits_at_the_engine_reported_level", async () => {
  await reset({ range: ON, level: LEVEL, running: CONFIGURED });
  assert.equal(aria(body(), "aria-valuenow"), "-3.01");
});

// --- disabled: the configured range owns the axis ----------------------------
// The engine goes on reporting its own -12..0 here; the dial must not draw on
// it, or a level sitting at the top of the configured range reads mid-scale.

test("test_a_disabled_control_spans_the_configured_minimum", async () => {
  await reset({ range: OFF, level: LEVEL, running: CONFIGURED });
  assert.equal(aria(body(), "aria-valuemin"), "-60");
});

test("test_a_disabled_control_spans_the_configured_maximum", async () => {
  await reset({ range: OFF, level: LEVEL, running: CONFIGURED });
  assert.equal(aria(body(), "aria-valuemax"), "-3");
});

test("test_a_disabled_control_sits_at_the_engine_reported_level", async () => {
  await reset({ range: OFF, level: LEVEL, running: CONFIGURED });
  assert.equal(aria(body(), "aria-valuenow"), "-3.01");
});

// --- disabled and bypassed: the dial reads full up ---------------------------
// volume_min = volume_max = 0 means there is no volume control at all, so the
// level the engine happens to report says nothing about where the dial sits.

test("test_a_bypassed_control_spans_down_to_minus_sixty", async () => {
  await reset({ range: OFF, level: "-30", running: BYPASSED });
  assert.equal(aria(body(), "aria-valuemin"), "-60");
});

test("test_a_bypassed_control_spans_up_to_zero", async () => {
  await reset({ range: OFF, level: "-30", running: BYPASSED });
  assert.equal(aria(body(), "aria-valuemax"), "0");
});

test("test_a_bypassed_control_reads_full_up_whatever_level_the_engine_reports", async () => {
  await reset({ range: OFF, level: "-30", running: BYPASSED });
  assert.equal(aria(body(), "aria-valuenow"), "0");
});

// --- disabled with no configured range to fall back to -----------------------
// /api/config unavailable: the running form carries no volume_min or volume_max
// at all, so the engine's report is all there is.

test("test_a_disabled_control_without_a_configured_range_spans_the_engine_minimum", async () => {
  await reset({ range: OFF, level: LEVEL });
  assert.equal(aria(body(), "aria-valuemin"), "-12");
});

test("test_a_disabled_control_without_a_configured_range_spans_the_engine_maximum", async () => {
  await reset({ range: OFF, level: LEVEL });
  assert.equal(aria(body(), "aria-valuemax"), "0");
});

// --- the disabled dial stays non-interactive ---------------------------------

test("test_a_disabled_control_still_grays_the_dial", async () => {
  await reset({ range: OFF, level: LEVEL, running: CONFIGURED });
  assert.ok(
    elements(body())
      .filter((el) => classes(el).includes("knob"))
      .some((el) => classes(el).includes("off")),
  );
});
