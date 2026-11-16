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
// The lag is also the same everywhere. Each track's lag is its median over the same window, and two are the same when they
// are within one metering frame, the frame of the finer rate when the rates differ (10.7 ms when a 96000 track is in the
// pair). The set compared: every pair of starts of one stream; each start against the one before it where the rate changed,
// named for the direction (44100 to 96000 and 96000 to 44100); and for each start, every pair of the points the page joined
// at, the reader that holds counting as one. None is dropped.
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

/** @param {import("./streams.js").Read} a @param {import("./streams.js").Read} b */
const finer = (a, b) => Math.min(frameMs(a.rate), frameMs(b.rate));

/**
 * The lags `a` and `b` stand at, as the most they differ by past one frame of the finer rate, ms to a tenth.
 *
 * @param {{ read: import("./streams.js").Read, lag: ReturnType<typeof look>[number] }} a
 * @param {{ read: import("./streams.js").Read, lag: ReturnType<typeof look>[number] }} b
 */
function apart(a, b) {
  const excess = Math.max(0, Math.abs(a.lag.level - b.lag.level) - finer(a.read, b.read));
  return { read: Math.min(a.lag.n, b.lag.n) >= MIN_PAINTS, apart: Math.round(excess * TENTH) / TENTH };
}

/** @param {import("./streams.js").Stream} stream @param {number} k */
const reading = (stream, k) => ({ read: stream.reads[k], lag: seen(stream)[k] });

const SAME = { read: true, apart: 0 };

for (const stream of STREAMS) {
  const { reads } = stream;
  for (let i = 0; i < reads.length; i++) {
    for (let j = i + 1; j < reads.length; j++) {
      const [a, b] = [reads[i], reads[j]];
      test(`test_the_lag_after_serial_${a.serial}_a_${a.kind}_is_the_lag_after_serial_${b.serial}_a_${b.kind}_in_${stream.name}`, () => {
        assert.deepEqual(apart(reading(stream, i), reading(stream, j)), SAME);
      });
    }
    if (i > 0 && reads[i].rate !== reads[i - 1].rate) {
      const [from, to] = [reads[i - 1].rate, reads[i].rate];
      test(`test_the_lag_is_the_same_across_the_change_${from}_to_${to}_at_serial_${reads[i].serial}_in_${stream.name}`, () => {
        assert.deepEqual(apart(reading(stream, i - 1), reading(stream, i)), SAME);
      });
    }
  }
}

/** @type {Map<string, Array<{ point: string, stream: import("./streams.js").Stream, k: number }>>} */
const joins = new Map();
for (const stream of STREAMS) {
  stream.reads.forEach((read, k) => {
    const key = `${stream.group}_serial_${read.serial}`;
    joins.set(key, [...(joins.get(key) ?? []), { point: stream.point, stream, k }]);
  });
}

for (const [key, points] of joins) {
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const [a, b] = [points[i], points[j]];
      test(
        `test_the_lag_is_the_same_for_${a.point}_and_${b.point}_in_${key}`.replaceAll(" ", "_").replaceAll("'", ""),
        () => {
          assert.deepEqual(apart(reading(a.stream, a.k), reading(b.stream, b.k)), SAME);
        },
      );
    }
  }
}
