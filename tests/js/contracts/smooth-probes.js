// What the smoothness suites measure of a replay: for each read of a stream (the wall window one track is heard in, and the
// stamp its music sits at), the lag between what is heard and the playhead on screen, paint by paint. No test() and no
// assert lives here.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

/** @typedef {import("./world.js").Paint} Paint */
/** @typedef {import("./streams.js").Read} Read */
/**
 * What one read saw: how many paints fell in its window, how far the lag moved across them, and the lag's median. The
 * lag is the stamp heard at the paint's wall time less the playhead, playback ms; a paint with no playhead makes it NaN.
 *
 * @typedef {{ n: number, spread: number, level: number }} Lag
 */

/**
 * The lag of every read, collected over a replay.
 *
 * @param {Read[]} reads
 * @returns {{ see: (paint: Paint) => void, done: () => Lag[] }}
 */
export function lagProbe(reads) {
  /** @type {number[][]} */
  const series = reads.map(() => []);
  return {
    see: ({ t, head }) =>
      reads.forEach((r, k) => {
        if (t >= r.from && t <= r.to) series[k].push(head === null ? NaN : r.heard(t) - head);
      }),
    done: () =>
      series.map((lags) => {
        const sorted = [...lags].sort((a, b) => a - b);
        const spread = lags.some(Number.isNaN) ? NaN : sorted[sorted.length - 1] - sorted[0];
        return { n: lags.length, spread, level: sorted[Math.floor(sorted.length / 2)] };
      }),
  };
}
