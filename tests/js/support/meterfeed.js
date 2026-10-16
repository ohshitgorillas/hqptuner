// The meter feed's wire, as tables, for the suites that drive the feed store through the EventSource fake
// (tests/js/support/eventsource.js). A `geometry` event names the metering rate in whole Hz beside the Nyquist, channel
// and bin counts; every `frame` event carries its channels and its stamp, `at` the sample it starts at counted from the
// feed's reset and `n` the samples it covers, both whole numbers at that rate.
//
// Every table is written out by hand, row by row: no table works out a stamp. Each table's rows are named for what
// the run of stamps is (contiguous, a gap, an overlap), and their lengths span 17.3 to 23.2 ms and change mid-table, the
// measured range of a feed event (docs/spec/timing.md, Measured facts). For the suites whose claim is not about the
// stamps, `follow` sends each event contiguous with the one sent before it on the same stream, the one place here that
// works out a stamp.
//
// No test() and no assert lives here. Not a *.test.js file on purpose: the runner glob would execute it.

import { lastStream } from "./eventsource.js";

/** One mono channel's bins as the wire sends them: base64, two bytes a bin. */
export const MONO_BINS = "AQAGADwAWAI=";

/**
 * One row of a feed table: the stamp of one `frame` event, in samples at the geometry's rate.
 *
 * @typedef {{ at: number, n: number }} Stamp
 */

/** 44.1 kHz, a DSD64 source played as DSD. */
export const RATE_44K = 44100;

/** 176.4 kHz, a DSD64 source played as PCM at 705.6k. */
export const RATE_176K = 176400;

/**
 * Eight events at 44.1 kHz, each starting where the one before it ended: 22.7, 17.3, 19.3 and 23.1 ms long, two of
 * each.
 *
 * @type {Stamp[]}
 */
export const CONTIGUOUS_44K = [
  { at: 0, n: 1000 },
  { at: 1000, n: 1000 },
  { at: 2000, n: 765 },
  { at: 2765, n: 765 },
  { at: 3530, n: 850 },
  { at: 4380, n: 850 },
  { at: 5230, n: 1020 },
  { at: 6250, n: 1020 },
];

/**
 * CONTIGUOUS_44K with its fourth event, `{ at: 2765, n: 765 }`, never sent.
 *
 * @type {Stamp[]}
 */
export const DROPPED_44K = [
  { at: 0, n: 1000 },
  { at: 1000, n: 1000 },
  { at: 2000, n: 765 },
  { at: 3530, n: 850 },
  { at: 4380, n: 850 },
  { at: 5230, n: 1020 },
  { at: 6250, n: 1020 },
];

/**
 * Two events at 44.1 kHz whose starts are one second of samples apart.
 *
 * @type {Stamp[]}
 */
export const ONE_SECOND_APART_44K = [
  { at: 0, n: 1000 },
  { at: 44100, n: 765 },
];

/**
 * Two events at 176.4 kHz whose starts are one second of samples apart.
 *
 * @type {Stamp[]}
 */
export const ONE_SECOND_APART_176K = [
  { at: 3072, n: 3072 },
  { at: 179472, n: 4080 },
];

/**
 * Two events at 176.4 kHz, the second starting one sample after the first ended.
 *
 * @type {Stamp[]}
 */
export const ONE_SAMPLE_GAP_176K = [
  { at: 0, n: 3072 },
  { at: 3073, n: 4080 },
];

/**
 * Two events at 176.4 kHz, the second starting one sample before the first ended.
 *
 * @type {Stamp[]}
 */
export const ONE_SAMPLE_OVERLAP_176K = [
  { at: 0, n: 3072 },
  { at: 3071, n: 4080 },
];

/**
 * Two contiguous events at 44.1 kHz, then one an hour of samples on.
 *
 * @type {Stamp[]}
 */
export const AN_HOUR_ON_44K = [
  { at: 0, n: 1000 },
  { at: 1000, n: 1000 },
  { at: 158760000, n: 765 },
];

/** 96 kHz, a 48 kHz Nyquist. */
export const RATE_96K = 96000;

/**
 * A `geometry` event's payload: one channel per `channels`, `bins` bins (four unless given), at `rate`.
 *
 * @param {number} rate
 * @param {number} [channels]
 * @param {number} [bins]
 */
export const geometry = (rate, channels = 1, bins = 4) => ({ rate, nyquist: rate / 2, channels, bins });

/**
 * Send one `frame` event per row on the stream opened last, each channel carrying MONO_BINS.
 *
 * @param {Stamp[]} rows
 * @param {number} [channels]
 */
export function play(rows, channels = 1) {
  const chans = Array.from({ length: channels }, () => ({ peak: -3.1, rms: -9.4, bins: MONO_BINS }));
  for (const { at, n } of rows) lastStream()?.emit("frame", { channels: chans, at, n });
}

/**
 * Where the next event `follow` sends on each stream starts, in samples: where the last one it sent there ended.
 *
 * @type {WeakMap<object, number>}
 */
const ends = new WeakMap();

/**
 * Send one `frame` event of `n` samples carrying `channels` on the stream opened last, starting where the last event
 * `follow` sent on that stream ended, or at sample 0 on a stream it has sent nothing on.
 *
 * @param {Array<{ peak: number, rms: number, bins: string }>} channels
 * @param {number} n
 */
export function follow(channels, n) {
  const stream = lastStream();
  if (!stream) return;
  const at = ends.get(stream) ?? 0;
  ends.set(stream, at + n);
  stream.emit("frame", { channels, at, n });
}
