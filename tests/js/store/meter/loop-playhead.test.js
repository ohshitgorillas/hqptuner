// Store suite for the playback span each step of hqptuner/static/store/meter/loop.js shows: the loop's playhead moves
// through the queued feed frames on playback time, and each step shows the audio the playhead crossed since the step
// before, every frame weighted by how much of it was crossed, so a feed frame that straddles two steps counts in both
// for its share of each and a burst arriving at once is shown at its own positions rather than a whole frame a step.
// A peak in any frame a step touches still shows on that step.
//
// Feed frames arrive through openMeterFeed() on the EventSource fake (tests/js/support/eventsource.js), as the payloads
// /api/meter/feed sends; animation frames through the fake Clock of tests/js/support/clock.js, which runs one every
// 16 ms, so the loop steps every 32 ms. Every case runs at a 0.1 s offset and no reported output delay, and sends one
// burst of four 25 ms feed frames at once, exactly the delay deep, so the first
// step after it starts the playhead at the burst's first frame and the rate trim has nothing to trim on that step.
// The burst is quiet but for its second frame. A step's shown audio is read off the scene's trace columns before
// smoothing, one flat level across the band for frames whose bins are flat.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/loop-playhead.test.js

import test, { afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onMeterPaint, startMeterLoop } from "../../../../hqptuner/static/store/meter/loop.js";
import { openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { setSpectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { near } from "../../support/near.js";
import { fakeClock } from "../../support/clock.js";

/** @typedef {import("../../../../hqptuner/static/store/meter/loop.js").MeterScene} MeterScene */

//: One step: the fake clock runs an animation frame every 16 ms, and the loop steps on every second one.
const STEP_MS = 32;
//: Long enough after a painter registers for the loop to have stepped on the fresh geometry.
const SETTLE_MS = 2 * STEP_MS;
const BINS = 8;
//: The offset the meters run behind the feed, s.
const OFFSET_S = 0.1;
//: Each feed frame's frame time, ms: four of them hold the 0.1 s delay.
const FRAME_MS = 25;
//: The quiet frames' bin byte and peak, and the loud frame's: bin dB = -byte * 0.5.
const QUIET_BYTE = 120;
const QUIET_PEAK = -50;
const LOUD_BYTE = 20;
const LOUD_PEAK = -6;
//: Tolerance on a shown level, dB.
const DB_EPS = 0.01;

const { clock, advance } = fakeClock();

/**
 * Every bin of one channel at step `byte`, two bytes a bin with the low one first.
 *
 * @param {number} byte
 */
const bins = (byte) => btoa(String.fromCharCode(...new Array(BINS).fill([byte, 0]).flat()));

/** Send the burst at once: four 25 ms feed frames, quiet but for the second. */
function burst() {
  for (const loud of [false, true, false, false]) {
    const byte = loud ? LOUD_BYTE : QUIET_BYTE;
    const peak = loud ? LOUD_PEAK : QUIET_PEAK;
    lastStream()?.emit("frame", { channels: [{ peak, rms: peak - 6, bins: bins(byte) }], ms: FRAME_MS });
  }
}

/**
 * The scenes `n` steps after the burst paint.
 *
 * @param {number} n
 * @returns {MeterScene[]}
 */
function afterBurst(n) {
  burst();
  advance(n * STEP_MS);
  return scenes.slice(-n);
}

/**
 * The flat level a scene's trace columns show before smoothing, dBFS.
 *
 * @param {MeterScene | undefined} scene
 */
const shown = (scene) => scene?.raw?.[0] ?? NaN;

/** @type {MeterScene[]} */
let scenes = [];
let unpaint = () => {};

before(() => {
  startMeterLoop(clock);
});

beforeEach(() => {
  useStorage();
  setSpectrumOffset(OFFSET_S);
  engineStatus.value = { status: { state: "2" } };
  useEventSource();
  openMeterFeed(clock);
  lastStream()?.emit("geometry", { nyquist: 48000, channels: 1, bins: BINS });
  unpaint = onMeterPaint((scene) => scenes.push(scene));
  advance(SETTLE_MS);
  scenes = [];
});

afterEach(() => {
  unpaint();
});

// The first step crosses the first quiet frame whole and the first 7 ms of the loud one: 7/32 of the loud frame's power,
// -10 dB, beside 25/32 of -60 dB, is -16.60 dB.
test("test_the_first_step_after_a_burst_shows_the_part_of_a_loud_frame_it_crossed", () => {
  assert.ok(...near(shown(afterBurst(1)[0]), -16.6, DB_EPS));
});

// The second step crosses the loud frame's last 18 ms and the next 14 ms of the quiet frame after it, the trim taking
// a hair off the step: 18/32 of the loud frame's power, -12.50 dB.
test("test_the_next_step_shows_the_rest_of_the_loud_frame_it_crossed_beside_the_quiet_one_after_it", () => {
  assert.ok(...near(shown(afterBurst(2)[1]), -12.498, DB_EPS));
});

test("test_a_step_that_crosses_only_part_of_a_loud_frame_shows_its_peak", () => {
  assert.equal(afterBurst(1)[0]?.levels[0]?.peak, LOUD_PEAK);
});
