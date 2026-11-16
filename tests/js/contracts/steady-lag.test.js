// Contract suite for the first smoothness behavior: the delay between what is on screen and what is heard stays the same
// through a whole track, within one metering frame at the track's own rate, after every start and at every sample rate,
// however the data arrives. It asks the lag and pins no cause.
//
// Each stream (tests/js/contracts/streams.js) reproduces how the two captures show data arriving around a track start, with
// a heard clock known to the sample, and is replayed through the real stack (tests/js/contracts/world.js) once; every test
// reads one finding of that replay. The lag is read after each track's opening stretch: 1500 ms after its serial change (or
// after a join). That length comes from the rush the measurement script prints for the two captures (a build of at most
// 355 ms and frames resuming at most 217 ms after the serial change, 572 ms in all, doubled) and was set before this suite
// first ran against the code. The stream
// list is the module's own, so a stream added there joins this suite with no edit here.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/steady-lag.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { lagProbe } from "./smooth-probes.js";
import { STREAMS } from "./streams.js";
import { replay } from "./world.js";

//: Paints a window must hold for the reading to count as one.
const MIN_PAINTS = 20;
const SAMPLES_PER_FRAME = 1024;
const MS_PER_S = 1000;
const TENTH = 10;

/** @type {Map<string, ReturnType<typeof look>>} */
const looked = new Map();

/**
 * Replay `stream` once and read the lag of each of its reads.
 *
 * @param {import("./streams.js").Stream} stream
 */
function look(stream) {
  const lag = lagProbe(stream.reads);
  replay(stream.schedule, (paint) => lag.see(paint));
  return lag.done();
}

/**
 * What replaying `stream` showed, replayed on the first ask.
 *
 * @param {import("./streams.js").Stream} stream
 */
function seen(stream) {
  if (!looked.has(stream.name)) looked.set(stream.name, look(stream));
  return /** @type {ReturnType<typeof look>} */ (looked.get(stream.name));
}

/** One metering frame at `rate`, playback ms: the most the lag may move. @param {number} rate */
const frameMs = (rate) => (SAMPLES_PER_FRAME * MS_PER_S) / rate;

for (const stream of STREAMS) {
  stream.reads.forEach((read, k) => {
    test(`test_the_lag_holds_through_serial_${read.serial}_a_${read.kind}_in_${stream.name}`, () => {
      const { n, spread } = seen(stream)[k];
      const moved = Math.round(Math.max(0, spread - frameMs(read.rate)) * TENTH) / TENTH;
      assert.deepEqual({ read: n >= MIN_PAINTS, moved }, { read: true, moved: 0 });
    });
  });
}
