// Store suite for the VU needles on hqptuner/static/store/meter/loop.js: each step hands the painters one VU reading
// per channel, `scene.vu`, advanced from that channel's RMS in the feed frames against the VU reference preference.
// A steady level reads its distance in dB from the reference, each needle reads its own channel, a change of
// reference moves where a steady level reads, and a needle rises toward a new level rather than landing on it.
// The needle's ballistics are tests/js/model/gauges/meter/vu.test.js's; this suite reads only settled readings and the
// response clause's 99% mark.
//
// Feed frames arrive through openMeterFeed() on the EventSource fake (tests/js/support/eventsource.js), as the payloads
// /api/meter/feed sends; animation frames through a fake Clock that moves only when told, as in
// tests/js/store/meter/loop.test.js. Every case steps on single frames exactly 1/30 s apart, each preceded by one feed
// frame covering the same time. The VU reference is picked through the prefs store's setter, read off the module
// namespace with optional access, and the scene's readings are read with optional access, so a loop without them fails
// these cases on their assertions.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/loop-vu.test.js

import test, { afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onMeterPaint, startMeterLoop } from "../../../../hqptuner/static/store/meter/loop.js";
import { openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { setSpectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
import * as uiPrefs from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { near } from "../../support/near.js";

/** @typedef {import("../../../../hqptuner/static/lib/clock.js").Clock} Clock */
/** @typedef {import("../../../../hqptuner/static/store/meter/loop.js").MeterScene & { vu?: number[] }} VuScene */

/** @type {{ referenceDeflectionPercent: number, responseDeflectionPercent: number }} */
const IEC = JSON.parse(
  readFileSync(new URL("../../../support/fixtures/iec60268-17/vu-dynamic-response.json", import.meta.url), "utf8"),
);
//: The reading at 99% of reference deflection, the response clause's mark, on a scale linear in voltage.
const RESPONSE_VU = 20 * Math.log10(IEC.responseDeflectionPercent / IEC.referenceDeflectionPercent);

const STEP_MS = 1000 / 30;
const BINS = 8;
const PLAYING = { status: { state: "2" } };
//: Steps enough for a needle within the standard to settle: 4 s at 30 steps a second.
const SETTLE_STEPS = 120;
//: Tolerance for a settled reading, in VU.
const STEADY_EPS = 0.05;

//: The VU references on offer, as the store holds them, in dBFS.
const REF_14 = "-14";
const REF_18 = "-18";
const REF_20 = "-20";

/** @type {{ setVuReference?(v: string): void }} */
const vuStore = uiPrefs;

/**
 * Pick the VU reference `v`.
 *
 * @param {string} v
 */
const pickReference = (v) => vuStore.setVuReference?.(v);

/**
 * A clock that moves only on `frame`: each call is one animation frame, `ms` after the last.
 */
function frameClock() {
  let now = 0;
  /** @type {Array<(now: number) => void>} */
  let queued = [];
  /** @type {Clock} */
  const clock = {
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => queued.push(fn),
    queueMicrotask: (fn) => fn(),
    now: () => now,
  };
  /** Run one animation frame `ms` after the last. */
  const frame = (ms = STEP_MS) => {
    now += ms;
    const due = queued;
    queued = [];
    due.forEach((fn) => fn(now));
  };
  return { clock, frame };
}

const { clock, frame } = frameClock();

//: Every bin of a channel at one quiet level, encoded as the feed sends it, two bytes a bin with the low one first.
const QUIET_BINS = btoa(String.fromCharCode(...new Array(BINS).fill([120, 0]).flat()));

/**
 * Open the feed on `channels` channels.
 *
 * @param {number} channels
 */
function stream(channels) {
  useEventSource();
  openMeterFeed(clock);
  lastStream()?.emit("geometry", { nyquist: 48000, channels, bins: BINS });
  frame();
}

/**
 * Hold one RMS level per channel for `steps` steps, each step one feed frame of 1/30 s, every channel's peak 6 dB over
 * its RMS.
 *
 * @param {number[]} rms
 * @param {number} steps
 */
function hold(rms, steps) {
  for (let k = 0; k < steps; k++) {
    const channels = rms.map((r) => ({ peak: r + 6, rms: r, bins: QUIET_BINS }));
    lastStream()?.emit("frame", { channels, ms: STEP_MS });
    frame();
  }
}

/** @type {VuScene[]} */
let scenes = [];
let unpaint = () => {};

/**
 * Channel `c`'s VU reading in the last scene handed out.
 *
 * @param {number} c
 */
const reading = (c) => scenes.at(-1)?.vu?.[c] ?? NaN;

before(() => {
  startMeterLoop(clock);
});

beforeEach(() => {
  useStorage();
  setSpectrumOffset(0);
  engineStatus.value = { ...PLAYING };
  pickReference(REF_18);
  scenes = [];
  unpaint = onMeterPaint((scene) => scenes.push(scene));
});

afterEach(() => {
  unpaint();
});

test("test_a_steady_rms_10_db_under_the_reference_reads_minus_10_vu", () => {
  pickReference(REF_20);
  stream(1);
  hold([-30], SETTLE_STEPS);
  assert.ok(...near(reading(0), -10, STEADY_EPS));
});

test("test_each_needle_reads_its_own_channels_rms", () => {
  pickReference(REF_18);
  stream(2);
  hold([-18, -28], SETTLE_STEPS);
  assert.ok(...near(reading(1), -10, STEADY_EPS));
});

test("test_changing_the_vu_reference_moves_a_steady_reading_by_the_difference", () => {
  pickReference(REF_14);
  stream(1);
  hold([-18], SETTLE_STEPS);
  const under14 = reading(0);
  pickReference(REF_20);
  hold([-18], SETTLE_STEPS);
  assert.ok(...near(reading(0) - under14, 6, STEADY_EPS));
});

test("test_one_step_after_a_level_at_the_reference_arrives_the_needle_is_still_short_of_99_percent", () => {
  pickReference(REF_18);
  stream(1);
  hold([-18], 1);
  assert.ok(reading(0) < RESPONSE_VU, `expected under ${RESPONSE_VU}, got ${reading(0)}`);
});
