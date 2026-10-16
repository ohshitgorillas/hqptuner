// Suite for store/meter/spectrogram.js: the apodizing strip under the spectrogram stays in step with it. As playback
// moves on, the strip's right edge moves on by the same playback time as the spectrogram's right edge, both between
// Status polls and across a poll that agrees with the playback the feed has covered.
//
// Playback reaches the store as feed frames, each carrying the frame time it covers, through addSpectrumFrame, and as
// Status polls through the poll seam (tests/js/support/apodpolls.js), each moving the daemon's position on by one
// second. Both are the clock this suite controls, so no case waits on one.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/spectrogram-strip.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  addSpectrumFrame,
  initSpectrogram,
  spectrogramEnd,
  stripEnd,
} from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { setApodWindow, setMeterChannel } from "../../../../hqptuner/static/store/ui/prefs.js";
import { useStorage } from "../../support/storage.js";
import { newTrack, poll, setPollStep } from "../../support/apodpolls.js";

// A two-bin mono geometry: the levels play no part here.
const GEO = { nyquist: 24000, channels: 1, bins: 2 };
const LEVEL = [{ peak: -6, rms: -12, bins: new Float32Array(2).fill(-30) }];

/**
 * `count` feed frames of `ms` frame time each.
 *
 * @param {number} count
 * @param {number} ms
 * @returns {() => void}
 */
const frames = (count, ms) => () => {
  for (let i = 0; i < count; i++) addSpectrumFrame(GEO, LEVEL, ms);
};

/**
 * How far each edge moved across each step, ms, in step order.
 *
 * @param {Array<() => void>} steps
 * @returns {{ spectrogram: number[], strip: number[] }}
 */
function moves(steps) {
  /** @type {{ spectrogram: number[], strip: number[] }} */
  const moved = { spectrogram: [], strip: [] };
  let spec = spectrogramEnd.value;
  let strip = stripEnd.value ?? 0;
  for (const step of steps) {
    step();
    moved.spectrogram.push(spectrogramEnd.value - spec);
    moved.strip.push((stripEnd.value ?? 0) - strip);
    spec = spectrogramEnd.value;
    strip = stripEnd.value ?? 0;
  }
  return moved;
}

beforeEach(() => {
  useStorage();
  setApodWindow("300");
  setMeterChannel("sum");
  initApodHistory();
  initSpectrogram();
  setPollStep(1);
  newTrack();
  poll();
});

// Three seconds of playback: each second the feed covers in frames of its own size, a part at a time, then the poll
// that says the daemon has played it.
test("test_the_strip_edge_moves_on_by_the_playback_time_the_spectrogram_edge_moves_on_by", () => {
  const moved = moves([
    frames(10, 40),
    frames(15, 40),
    poll,
    frames(4, 187.5),
    frames(10, 25),
    poll,
    frames(8, 62.5),
    frames(1, 500),
    poll,
  ]);
  assert.deepEqual(moved.strip, moved.spectrogram);
});
