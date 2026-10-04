// Source meter mock source: a deterministic music-like feed (model/meter.js mockColumn) and the column history since
// track start, standing in for the 4322 metering stream (store/meter/feed.js) the real app reads.

import { mockColumn } from "../../../model/gauges/meter-source.js";

/**
 * @typedef {import('../../../model/gauges/meter-source.js').MockFeed} MockFeed
 * @typedef {import('../../../model/gauges/meter-source.js').MockColumn} MockColumn
 * @typedef {import('../source-meter.js').MeterConfig} MeterConfig
 */

/**
 * The column history since track start.
 *
 * @typedef {object} MockHistory
 * @property {MockColumn[]} hist      hist[0] is track column `firstIdx`
 * @property {number} firstIdx
 * @property {() => void} push        add the next column, drop the oldest past the memory cap
 * @property {() => MockColumn} latest
 */

const MAX_HISTORY_S = 600; // mock memory cap

/**
 * The feed one mount draws from: the column period, where the content ends, DSD modulator noise, and the frequency of
 * each of the spectrogram's `rows` (top = Nyquist).
 *
 * @param {MeterConfig} cfg  METER: colsPerSec, nyquist, brick, dsdNoise
 * @param {number} rows
 * @returns {MockFeed}
 */
export function mockFeed(cfg, rows) {
  return {
    perCol: 1 / cfg.colsPerSec,
    brick: cfg.brick ?? 19600, // CD brick-wall; hi-res runs higher
    dsdNoise: cfg.dsdNoise,
    rowHz: Array.from({ length: rows }, (_, y) => cfg.nyquist * (1 - (y + 0.5) / rows)),
  };
}

/**
 * History since track start (hist[0] is track column `firstIdx`), filled to the track's elapsed time; `push` adds the
 * next column and drops the oldest past the memory cap.
 *
 * @param {MeterConfig} cfg  METER: trackElapsedSec, colsPerSec
 * @param {MockFeed} feed
 * @returns {MockHistory}
 */
export function mockHistory(cfg, feed) {
  /** @type {MockColumn[]} */
  const hist = [];
  const elapsedCols = Math.round(cfg.trackElapsedSec * cfg.colsPerSec);
  for (let i = 0; i < elapsedCols; i++) hist.push(mockColumn(i, feed));
  const cap = MAX_HISTORY_S * cfg.colsPerSec;
  /** @type {MockHistory} */
  const src = {
    hist,
    firstIdx: 0,
    push() {
      hist.push(mockColumn(src.firstIdx + hist.length, feed));
      if (hist.length > cap) {
        hist.shift();
        src.firstIdx++;
      }
    },
    latest: () => hist[hist.length - 1],
  };
  return src;
}
