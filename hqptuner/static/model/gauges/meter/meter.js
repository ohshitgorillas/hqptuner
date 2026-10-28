// The Source meter's model, free of the DOM and of any clock: the feed's bins decoded, a stride's frames folded into
// one, a channel's bins picked, bins gathered under drawing columns and into a spectrogram slice's bands, a level
// placed on the plot, the spectrum's frequency spans, and the shown columns as plot fractions at the Range.

import { clamp } from "../../../lib/coerce.js";
import { rowAt } from "../../../lib/spectroraster.js";
import { bufferOf } from "./spectrumfx.js";

/**
 * One channel of a meter frame.
 *
 * @typedef {object} MeterChannel
 * @property {number} peak  dBFS
 * @property {number} rms  dBFS
 * @property {Float32Array} bins  dBFS, low frequencies first
 */

/**
 * One decoded feed frame.
 *
 * @typedef {object} MeterFrame
 * @property {MeterChannel[]} channels
 * @property {number} ms  playback, ms, the frame covers
 * @property {number} [at]  playback, ms, where the frame starts
 * @property {boolean} [break]  whether the feed marks a break before the frame
 * @property {FrameGeometry | null} [geo]  the layout the frame is decoded under; null while the feed has sent no geometry event
 */

/**
 * The frames of a stride folded into one.
 *
 * @typedef {object} FoldScene
 * @property {MeterChannel[]} channels
 * @property {Float64Array[]} power  per channel, per bin, the power sum the fold carries
 */

/**
 * The layout of a frame's bins.
 *
 * @typedef {object} FrameGeometry
 * @property {number} rate  Hz
 * @property {number} nyquist  Hz
 * @property {number} channels
 * @property {number} bins
 */

/**
 * The Source spectrum's frequency spans, widest first: the whole band, a half and a quarter of it.
 *
 * @type {readonly string[]}
 */
export const FREQ_SPANS = Object.freeze(["full", "half", "quarter"]);

//: Each span's share of the band up to the source Nyquist.
const SPAN_SHARES = Object.freeze({ full: 1, half: 0.5, quarter: 0.25 });

/**
 * The share of the band, 0 Hz up to the source Nyquist, a span shows. A span outside FREQ_SPANS shows the whole band.
 *
 * @param {string} span  one of FREQ_SPANS
 * @returns {number}  in (0, 1]
 */
export function spanShare(span) {
  return span === "half" || span === "quarter" ? SPAN_SHARES[span] : SPAN_SHARES.full;
}

//: dB below full scale one wire count stands for.
const DB_PER_COUNT = 0.5;
//: Bytes a wire bin takes.
const BYTES_PER_BIN = 2;
//: Bits in a byte.
const BYTE_BITS = 8;

/**
 * The bins of a feed channel: two bytes a bin, low byte first, each a count of 0.5 dB steps below full scale.
 *
 * @param {string} wire  base64
 * @returns {Float32Array}  dBFS, low frequencies first
 */
export function decodeBins(wire) {
  const raw = atob(wire);
  const bins = new Float32Array(Math.floor(raw.length / BYTES_PER_BIN));
  for (let i = 0; i < bins.length; i++) {
    const count = raw.charCodeAt(i * BYTES_PER_BIN) + (raw.charCodeAt(i * BYTES_PER_BIN + 1) << BYTE_BITS);
    bins[i] = -count * DB_PER_COUNT;
  }
  return bins;
}

//: dB per decade of power.
const DB_PER_DECADE = 10;

/**
 * Power, linear, of a level.
 *
 * @param {number} db  dBFS
 * @returns {number}
 */
const power = (db) => DB_PER_DECADE ** (db / DB_PER_DECADE);

/**
 * Level of a power, linear.
 *
 * @param {number} p
 * @returns {number}  dBFS
 */
const level = (p) => DB_PER_DECADE * Math.log10(p);

/**
 * Whether a scene holds as many channels as a frame, each of as many bins.
 *
 * @param {FoldScene} scene
 * @param {MeterFrame} frame
 * @returns {boolean}
 */
function fits(scene, frame) {
  const { channels } = frame;
  if (scene.channels.length !== channels.length) return false;
  return channels.every((ch, c) => scene.channels[c].bins.length === ch.bins.length);
}

/**
 * A scene shaped like a frame: its channel count, each channel's bin count.
 *
 * @param {MeterFrame} frame
 * @returns {FoldScene}
 */
function sceneFor(frame) {
  return {
    channels: frame.channels.map((ch) => ({ peak: 0, rms: 0, bins: new Float32Array(ch.bins.length) })),
    power: frame.channels.map((ch) => new Float64Array(ch.bins.length)),
  };
}

/**
 * Fold channel `c` of every frame into the scene: the loudest peak, the RMS and each bin power-averaged.
 *
 * @param {MeterFrame[]} frames
 * @param {FoldScene} scene
 * @param {number} c
 */
function foldChannel(frames, scene, c) {
  const out = scene.channels[c];
  const sums = scene.power[c];
  sums.fill(0);
  let peak = -Infinity;
  let rms = 0;
  for (const f of frames) {
    const ch = f.channels[c];
    if (ch.peak > peak) peak = ch.peak;
    rms += power(ch.rms);
    for (let b = 0; b < sums.length; b++) sums[b] += power(ch.bins[b]);
  }
  out.peak = peak;
  out.rms = level(rms / frames.length);
  for (let b = 0; b < sums.length; b++) out.bins[b] = level(sums[b] / frames.length);
}

/**
 * The frames of a stride folded into one: per channel the loudest peak, the RMS and each bin power-averaged, each
 * frame once. The scene handed in is refilled in place and returned; a fresh one is made only when none is handed in
 * or the frames' channel or bin count differs from it. Every frame holds the first frame's channel and bin counts.
 *
 * @param {MeterFrame[]} frames
 * @param {FoldScene} [into]
 * @returns {FoldScene}
 */
export function foldFrames(frames, into) {
  const first = frames[0];
  if (!first) return into ?? { channels: [], power: [] };
  const scene = into && fits(into, first) ? into : sceneFor(first);
  for (let c = 0; c < scene.channels.length; c++) foldChannel(frames, scene, c);
  return scene;
}

/**
 * A channel's bins from a frame: a channel index picks that channel's own bins, handed back as the frame holds them;
 * `sum`, or an index the frame has no channel for, picks the power average of every channel, written into `out` where
 * it holds as many values as a channel has bins, into a new buffer otherwise.
 *
 * @param {Pick<MeterFrame, "channels">} frame
 * @param {string} channel  `sum` or a channel index
 * @param {Float32Array} [out]  an earlier pick's bins, reused where it fits
 * @returns {Float32Array}  dBFS, low frequencies first
 */
export function pickBins(frame, channel, out) {
  const { channels } = frame;
  const one = /^\d+$/.test(channel) ? channels[Number(channel)] : undefined;
  if (one) return one.bins;
  const sums = bufferOf(out, channels[0]?.bins.length ?? 0);
  for (let b = 0; b < sums.length; b++) {
    let sum = 0;
    for (const ch of channels) sum += power(ch.bins[b]);
    sums[b] = level(sum / channels.length);
  }
  return sums;
}

/**
 * How many bins, from 0 Hz up, a view holding `share` of the band shows: the bins run from 0 Hz to Nyquist, so the
 * view ends at the last bin at or below `share` of the way to the top one. At least one bin when the band holds any.
 *
 * @param {number} count  bins in the band
 * @param {number} share  in (0, 1]
 * @returns {number}
 */
const binsInView = (count, share) => clamp(Math.floor(share * (count - 1)) + 1, Math.min(1, count), count);

/**
 * The first bin at or above the edge between column `e - 1` and column `e`, half way between where the two stand.
 *
 * @param {number} e  the column above the edge
 * @param {number} last  the bin at the top of the view
 * @param {number} gaps  the steps between the first column and the last
 * @returns {number}
 */
const edgeBin = (e, last, gaps) => Math.ceil(((2 * e - 1) * last) / (2 * gaps));

/**
 * The loudest bin under each drawing column, low frequencies first, with `share` of the band spread across every
 * column: column 0 stands at 0 Hz, the last column at the top of the view, and column `j` of `n` at `j / (n - 1)` of the
 * way between. Each column reads the bins nearer to it than to its neighbors, and at least the bin nearest it, so a
 * column that falls between bins reads that bin and the trace has no gaps; a lone column reads every bin in view, and
 * with no bins every column reads -Infinity. Written into `out` where it holds `columns` values, a new buffer otherwise.
 *
 * @param {ArrayLike<number>} bins  dBFS, 0 Hz to Nyquist
 * @param {number} columns
 * @param {Float32Array} [out]  an earlier paint's columns, reused where it fits
 * @param {number} [share]  the Frequency span's share of the band, from spanShare; the whole band by default
 * @returns {Float32Array}  dBFS, one per column
 */
export function traceColumns(bins, columns, out, share = 1) {
  const cols = bufferOf(out, columns);
  cols.fill(-Infinity);
  const last = binsInView(bins.length, share) - 1;
  const gaps = Math.max(1, columns - 1);
  for (let j = 0; j < columns && last >= 0; j++) {
    const near = Math.round((j * last) / gaps);
    const from = Math.max(0, Math.min(near, edgeBin(j, last, gaps)));
    const to = j === columns - 1 ? last : Math.min(last, Math.max(near, edgeBin(j + 1, last, gaps) - 1));
    for (let b = from; b <= to; b++) if (bins[b] > cols[j]) cols[j] = bins[b];
  }
  return cols;
}

/**
 * Bin `k`'s row among `rows`: the band its frequency, k / `last` of the Nyquist, falls in, by the raster's rowAt.
 *
 * @param {number} k
 * @param {number} last  the bin at the Nyquist
 * @param {number} rows
 * @returns {number}
 */
const bandOf = (k, last, rows) => Math.floor(rowAt(k, last, rows) + 0.5);

/**
 * Of bins `k - 1` and `k`, below and above row `r`'s center, the one nearer it; `k` where both are equally near.
 *
 * @param {number} k
 * @param {number} last  the bin at the Nyquist
 * @param {number} rows
 * @param {number} r
 * @returns {number}
 */
const nearerCenter = (k, last, rows, r) => (rowAt(k, last, rows) - r <= r - rowAt(k - 1, last, rows) ? k : k - 1);

/**
 * A spectrogram slice's rows from bins, low frequencies first: row r of `rows` is the band the raster reads it as
 * (rowAt), with bin `k` of `bins.length` at k / (bins.length - 1) of the Nyquist. Each row holds the loudest of the bins
 * in its band, the bin at the Nyquist in the top row; a band holding no bin holds the bin nearest its center, the
 * higher of two equally near. A lone bin fills every row; with no bins every row reads -Infinity. Written into `out`
 * where it holds `rows` values, a new buffer otherwise.
 *
 * @param {ArrayLike<number>} bins  dBFS, 0 Hz to Nyquist
 * @param {number} rows
 * @param {Float32Array} [out]
 * @returns {Float32Array}  dBFS, one per row
 */
export function bandRows(bins, rows, out) {
  const levels = bufferOf(out, rows);
  const last = bins.length - 1;
  if (last < 1) return levels.fill(last === 0 ? bins[0] : -Infinity);
  let k = 0;
  for (let r = 0; r < rows; r++) {
    const first = k;
    let loud = -Infinity;
    for (; k <= last && (r === rows - 1 || bandOf(k, last, rows) <= r); k++) if (bins[k] > loud) loud = bins[k];
    levels[r] = k > first ? loud : bins[nearerCenter(k, last, rows, r)];
  }
  return levels;
}

/**
 * Where a level sits on the plot: 1 at full scale, 0 `range` dB below it. A level below the range sits at 0, one over
 * full scale at 1.
 *
 * @param {number} db  dBFS
 * @param {number} range  dB, positive
 * @returns {number}  in [0, 1]
 */
export function fraction(db, range) {
  return clamp(1 + db / range, 0, 1);
}

/**
 * Each shown column's plot fraction at `range`, low frequencies first. Written into `out` where it holds as many
 * values as there are columns, into a new buffer otherwise.
 *
 * @param {ArrayLike<number>} columns  dBFS
 * @param {number} range  dB, positive
 * @param {Float32Array} [out]  an earlier paint's fractions, reused where it fits
 * @returns {Float32Array}
 */
export function fractionsOf(columns, range, out) {
  const fracs = bufferOf(out, columns.length);
  for (let i = 0; i < columns.length; i++) fracs[i] = fraction(columns[i], range);
  return fracs;
}
