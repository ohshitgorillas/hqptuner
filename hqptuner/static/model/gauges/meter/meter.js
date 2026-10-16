// Meter bin math, free of the DOM and of time: decoding a feed event's bins, folding frames, picking a channel,
// tracing bins into drawing columns, the frequency spans, and where a level sits on the plot. Every function returns
// its answer from the values it is handed and keeps nothing between calls.

import { clamp } from "../../../lib/coerce.js";
import { dbToPower, powerToDb } from "../../../lib/units.js";
import { suiteColor } from "./spectrumfx.js";

const BIN_STEP_DB = 0.5; // one bin step below full scale on the feed
const BIN_BYTES = 2; // bytes a bin's steps travel in, low byte first
const HIGH_BYTE = 256; // steps one count of the high byte stands for

/**
 * One channel of a frame: its peak and RMS, and its transform bins DC first.
 *
 * @typedef {object} MeterChannel
 * @property {number} peak  dBFS
 * @property {number} rms  dBFS
 * @property {Float32Array} bins  dBFS
 */

/**
 * One feed frame: its channels, the playback it covers, and the feed geometry it arrived under. A frame off the feed
 * also carries where that playback starts and whether its event begins a break.
 *
 * @typedef {{ nyquist: number, channels: number, bins: number }} FrameGeometry
 * @typedef {object} MeterFrame
 * @property {MeterChannel[]} channels
 * @property {number} ms  playback, ms: how long the frame lasts
 * @property {number} [at]  playback, ms: where the frame starts, counted from the feed's reset
 * @property {boolean} [break]  whether the frame's event begins a break
 * @property {FrameGeometry | null} [geo]
 */

/**
 * A frame's bins off the wire: two bytes per bin, low byte first, base64, each count a BIN_STEP_DB step below full
 * scale.
 *
 * @param {string} text
 * @returns {Float32Array}  dBFS
 */
export function decodeBins(text) {
  const raw = atob(text);
  const out = new Float32Array(Math.floor(raw.length / BIN_BYTES));
  for (let i = 0; i < out.length; i++) {
    const steps = raw.charCodeAt(BIN_BYTES * i) + HIGH_BYTE * raw.charCodeAt(BIN_BYTES * i + 1);
    out[i] = -steps * BIN_STEP_DB;
  }
  return out;
}

/**
 * Frames folded into one set of channels, with the power each channel summed while folding: per channel, one entry
 * per bin and one more, last, for the RMS. A caller hands it back to the next fold to fill in place.
 *
 * @typedef {object} FoldScene
 * @property {MeterChannel[]} channels
 * @property {Float64Array[]} power  linear power, summed over the frames folded
 */

/**
 * A fold scene of `channels` channels of `bins` bins each.
 *
 * @param {number} channels
 * @param {number} bins
 * @returns {FoldScene}
 */
function foldScene(channels, bins) {
  const scene = /** @type {FoldScene} */ ({ channels: [], power: [] });
  for (let c = 0; c < channels; c++) {
    scene.channels.push({ peak: -Infinity, rms: -Infinity, bins: new Float32Array(bins) });
    scene.power.push(new Float64Array(bins + 1));
  }
  return scene;
}

/**
 * Whether `scene` holds `channels` channels of `bins` bins each.
 *
 * @param {FoldScene | undefined} scene
 * @param {number} channels
 * @param {number} bins
 * @returns {scene is FoldScene}
 */
function fits(scene, channels, bins) {
  if (!scene || scene.channels.length !== channels || scene.power.length !== channels) return false;
  return scene.channels.every((ch, c) => ch.bins.length === bins && scene.power[c].length === bins + 1);
}

/**
 * The frames handed in folded into one set of channels: per channel the loudest peak, and the RMS and each bin
 * power-averaged over the frames, each frame counted once. Fills and returns `out` when it holds the frames' layout,
 * allocating nothing; allocates a fresh scene otherwise.
 *
 * @param {MeterFrame[]} frames  at least one, all of one layout
 * @param {FoldScene} [out]  a scene from an earlier fold, to fill in place
 * @returns {FoldScene}
 */
export function foldFrames(frames, out) {
  const nch = frames[0].channels.length;
  const width = nch ? frames[0].channels[0].bins.length : 0;
  const scene = fits(out, nch, width) ? out : foldScene(nch, width);
  for (let c = 0; c < nch; c++) {
    scene.channels[c].peak = -Infinity;
    scene.power[c].fill(0);
  }
  for (const f of frames) {
    for (let c = 0; c < nch; c++) {
      const ch = f.channels[c];
      const acc = scene.power[c];
      if (ch.peak > scene.channels[c].peak) scene.channels[c].peak = ch.peak;
      for (let k = 0; k < width; k++) acc[k] += dbToPower(ch.bins[k]);
      acc[width] += dbToPower(ch.rms);
    }
  }
  for (let c = 0; c < nch; c++) {
    const acc = scene.power[c];
    const bins = scene.channels[c].bins;
    for (let k = 0; k < width; k++) bins[k] = powerToDb(acc[k] / frames.length);
    scene.channels[c].rms = powerToDb(acc[width] / frames.length);
  }
  return scene;
}

/**
 * The bins one channel pick shows: that channel's, or for `sum` (or a channel the frame lacks) the power average
 * across channels, bin by bin, written into `out` when it has the frame's bin count, into a fresh array otherwise.
 *
 * @param {{ channels: MeterChannel[] }} frame  at least one channel
 * @param {string} pick  a channel index, or `sum`
 * @param {Float32Array} [out]  an array from an earlier pick, to fill in place
 * @returns {Float32Array}  dBFS
 */
export function pickBins(frame, pick, out) {
  const ch = pick === "sum" ? undefined : frame.channels[Number(pick)];
  if (ch) return ch.bins;
  const chs = frame.channels;
  const width = chs[0].bins.length;
  const sum = out && out.length === width ? out : new Float32Array(width);
  for (let k = 0; k < width; k++) {
    let power = 0;
    for (let c = 0; c < chs.length; c++) power += dbToPower(chs[c].bins[k]);
    sum[k] = powerToDb(power / chs.length);
  }
  return sum;
}

/**
 * The share of the band up to Nyquist each frequency span keeps in view, from 0 Hz.
 *
 * @type {Record<string, number>}
 */
const SPAN_SHARES = { full: 1, half: 0.5, quarter: 0.25 };

/** The frequency spans, widest first. */
export const FREQ_SPANS = Object.keys(SPAN_SHARES);

/**
 * The share of the band up to Nyquist that frequency span `span` keeps in view; the whole band for a span outside
 * FREQ_SPANS.
 *
 * @param {string} span
 * @returns {number}
 */
export function spanShare(span) {
  return SPAN_SHARES[span] ?? 1;
}

/**
 * Bins laid onto `cols` columns from 0 Hz to `share` of Nyquist, bin `k` of `n` at `k/((n-1)·share)` of the way: each
 * column the loudest bin in its span, so a tone keeps its level however many bins share a column, and a column no bin
 * falls in takes the bin nearest its center. A bin above the top of that view falls in no column.
 *
 * @param {ArrayLike<number>} bins  dBFS
 * @param {number} cols
 * @param {number} [share]  of the band up to Nyquist, from 0 Hz
 * @returns {Float32Array}  dBFS
 */
export function traceColumns(bins, cols, share = 1) {
  const out = new Float32Array(cols).fill(-Infinity);
  const top = (bins.length - 1) * share;
  const last = Math.min(bins.length - 1, Math.floor(top));
  for (let k = 0; k <= last; k++) {
    const c = Math.min(cols - 1, Math.floor((k / top) * cols));
    if (bins[k] > out[c]) out[c] = bins[k];
  }
  for (let c = 0; c < cols; c++) {
    if (out[c] === -Infinity) out[c] = bins[Math.min(last, Math.round(((c + 0.5) / cols) * top))];
  }
  return out;
}

/**
 * Where a level sits on a plot spanning `range` dB down from full scale: 0 dB at 1, `-range` dB at 0, linear between,
 * clamped to [0, 1].
 *
 * @param {number} db  dBFS
 * @param {number} range  dB, positive
 * @returns {number}
 */
export function fraction(db, range) {
  return clamp((db + range) / range, 0, 1);
}

/**
 * The colors the Source level meter draws a reading in under the spectrum's palette `palette`: each bar and the held
 * peak in the color the spectrum draws at that part's own level. Under Accent those are the accent's shades.
 *
 * @param {string} palette  a spectrum palette, as the store holds it
 * @param {{ peak: number, rms: number, hold: number }} reading  bar fractions, 0 on the floor and 1 at full scale
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {{ peak: string, rms: string, hold: string }}  `#rrggbb`
 */
export function meterColors(palette, { peak, rms, hold }, accent) {
  return {
    peak: suiteColor(palette, peak, accent),
    rms: suiteColor(palette, rms, accent),
    hold: suiteColor(palette, hold, accent),
  };
}
