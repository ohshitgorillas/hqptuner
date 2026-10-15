// Source meter model: the decisions behind each painted frame, free of the DOM. Every function takes the frame's
// time as arguments (`now` in ms on the rAF timeline, `dt` in s) and returns the next state, so a caller paints what
// it gets back and a test drives it from a table.

import { clamp } from "../../../lib/coerce.js";
import { dbToPower, powerToDb } from "../../../lib/units.js";
import { suiteColor } from "./spectrumfx.js";

const FLOOR_DB = -300; // a spectrum bin with nothing shown yet
const SPEC_FALL_TAU_MS = 150; // shown spectrum fall time constant: about a fifth of the gap closed per 30 Hz frame
const SPEC_GHOST_TAU_MS = 1000; // ghost relaxation time constant: about a thirtieth of its gap closed per 30 Hz frame
const BIN_STEP_DB = 0.5; // one bin step below full scale on the feed (engine/meterfeed.py)
const BIN_BYTES = 2; // bytes a bin's steps travel in, low byte first
const HIGH_BYTE = 256; // steps one count of the high byte stands for
const PEAK_FALL_DBPS = 20; // level peak fall, dB/s
const RMS_TAU_S = 0.3; // level RMS integration time
const HOLD_MS = 1500; // level hold before it decays
const HOLD_DECAY_DBPS = 10; // level hold decay once released, dB/s
const MAX_DT_S = 0.1; // longest step one frame may take
const SMOOTH_COLS = 2; // trace columns averaged either side of each, across frequency

/**
 * Shown spectrum, one entry per bin. Float32 storage is part of the result: each step reads back the rounded values it
 * stored.
 *
 * @typedef {object} SpectrumHold
 * @property {Float32Array} disp   shown level, dBFS
 * @property {Float32Array} ghost  held peak, dBFS, never below `disp`
 */

/**
 * One channel's level reading.
 *
 * @typedef {object} LevelReading
 * @property {number} peak    ballistic peak, dBFS
 * @property {number} rms     integrated RMS, dBFS
 * @property {number} hold    held peak, dBFS
 * @property {number} holdAt  ms the hold was last reached
 */

/**
 * Where one channel's level is heading this frame.
 *
 * @typedef {object} LevelTarget
 * @property {number} rms   dBFS
 * @property {number} peak  dBFS
 */

/**
 * A spectrum with nothing shown.
 *
 * @param {number} bins
 * @returns {SpectrumHold}
 */
export function emptySpectrum(bins) {
  return { disp: new Float32Array(bins).fill(FLOOR_DB), ghost: new Float32Array(bins).fill(FLOOR_DB) };
}

/**
 * The spectrum after a frame `dt` seconds long of new bin levels: a rise shows at once, and a fall closes the same share
 * of the gap left to the new level each frame of a given length, so it lands fast, settles gently and never passes below
 * the level it falls to. Each bin's ghost rises with the shown level at once and, while it sits above it, closes a
 * smaller fixed share of its gap to the shown level each frame of a given length, so it keeps the shape of the trace it
 * came from as it settles, with no hold, and never passes below the shown level. On a jump the new levels show
 * outright and the ghost lands on them.
 *
 * @param {SpectrumHold} prev
 * @param {ArrayLike<number>} levels  this frame's bin levels, dBFS
 * @param {{ now: number, dt: number }} at  the frame's stamp, ms, and its length, s
 * @param {boolean} jump              show the new levels outright (reset, first paint)
 * @returns {SpectrumHold}
 */
export function stepSpectrum(prev, levels, { dt }, jump) {
  const left = Math.exp((-dt * 1000) / SPEC_FALL_TAU_MS);
  const disp = Float32Array.from(levels, (v, i) => (jump || v > prev.disp[i] ? v : v + (prev.disp[i] - v) * left));
  const kept = jump ? 0 : Math.exp((-dt * 1000) / SPEC_GHOST_TAU_MS);
  const ghost = disp.map((d, i) => d + Math.max(0, prev.ghost[i] - d) * kept);
  return { disp, ghost };
}

/**
 * One channel's reading after a frame of `dt` seconds toward its target: the peak rises at once and falls at a fixed
 * rate, the RMS integrates, and the hold stays put for 1.5 s after it was last reached, then decays at a fixed rate,
 * never below the peak.
 *
 * @param {LevelReading} v
 * @param {LevelTarget} t
 * @param {number} now  ms
 * @param {number} dt   s
 * @returns {LevelReading}
 */
export function stepLevel(v, t, now, dt) {
  const peak = t.peak > v.peak ? t.peak : Math.max(t.peak, v.peak - PEAK_FALL_DBPS * dt);
  const rms = v.rms + (t.rms - v.rms) * Math.min(1, dt / RMS_TAU_S);
  if (peak >= v.hold) return { peak, rms, hold: peak, holdAt: now };
  const hold = now - v.holdAt > HOLD_MS ? Math.max(peak, v.hold - HOLD_DECAY_DBPS * dt) : v.hold;
  return { peak, rms, hold, holdAt: v.holdAt };
}

/**
 * The seconds one animation frame stamped `now` runs the ballistics for after the frame stamped `prev`: clamped to
 * [0, 100 ms], so a frame stamped before mount never runs them backwards and a stalled page never leaps.
 *
 * @param {number} prev  ms
 * @param {number} now   ms
 * @returns {number}
 */
export function frameDt(prev, now) {
  return clamp((now - prev) / 1000, 0, MAX_DT_S);
}

/**
 * One feed frame, or several folded into one: per channel its peak and RMS in dBFS and its transform bins in dBFS,
 * DC first, the frame time it covers, and the feed geometry it arrived under.
 *
 * @typedef {{ nyquist: number, channels: number, bins: number }} FrameGeometry
 * @typedef {{ channels: { peak: number, rms: number, bins: Float32Array }[], ms: number, geo?: FrameGeometry | null }} MeterFrame
 */

/**
 * A frame's bins off the wire: two bytes per bin, low byte first, base64, each `BIN_STEP_DB` per step below full scale.
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
 * The power average of several dB arrays of one length, element by element.
 *
 * @param {ArrayLike<number>[]} rows
 * @returns {Float32Array}
 */
function powerMean(rows) {
  const n = rows[0].length;
  const acc = new Float64Array(n);
  for (const row of rows) for (let k = 0; k < n; k++) acc[k] += dbToPower(row[k]);
  return Float32Array.from(acc, (p) => powerToDb(p / rows.length));
}

/**
 * Feed frames folded into one, as the feed folds a stride: per channel the loudest peak, and the RMS and each bin
 * power-averaged; the frame time is theirs together. A single frame folds to itself.
 *
 * @param {MeterFrame[]} frames  at least one, all of one layout
 * @returns {MeterFrame}
 */
export function foldFrames(frames) {
  if (frames.length === 1) return frames[0];
  const first = frames[0];
  return {
    channels: first.channels.map((_, c) => {
      const chs = frames.map((f) => f.channels[c]);
      return {
        peak: Math.max(...chs.map((ch) => ch.peak)),
        rms: powerMean(chs.map((ch) => [ch.rms]))[0],
        bins: powerMean(chs.map((ch) => ch.bins)),
      };
    }),
    ms: frames.reduce((sum, f) => sum + f.ms, 0),
  };
}

/**
 * The bins one channel pick shows: that channel's, or for `sum` (or a channel the frame lacks) the power average
 * across channels, bin by bin.
 *
 * @param {MeterFrame} frame
 * @param {string} pick
 * @returns {Float32Array}
 */
export function pickBins(frame, pick) {
  const ch = pick === "sum" ? undefined : frame.channels[Number(pick)];
  return ch ? ch.bins : powerMean(frame.channels.map((c) => c.bins));
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
 * falls in takes the bin nearest its centre. A bin above the top of that view falls in no column.
 *
 * @param {ArrayLike<number>} bins  dBFS
 * @param {number} cols
 * @param {number} [share]  of the band up to Nyquist, from 0 Hz
 * @returns {Float32Array}
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
 * Columns smoothed across frequency: each the power average of itself and SMOOTH_COLS neighbours either side, weighted
 * 3-2-1 outward, over the neighbours that exist.
 *
 * @param {ArrayLike<number>} cols  dBFS
 * @returns {Float32Array}
 */
export function smoothColumns(cols) {
  const n = cols.length;
  const power = Float64Array.from(cols, dbToPower);
  const out = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    let sum = 0;
    let weight = 0;
    for (let j = -SMOOTH_COLS; j <= SMOOTH_COLS; j++) {
      const k = c + j;
      if (k < 0 || k >= n) continue;
      const w = SMOOTH_COLS + 1 - Math.abs(j);
      sum += w * power[k];
      weight += w;
    }
    out[c] = powerToDb(sum / weight);
  }
  return out;
}

/**
 * Where a level sits on a bar running from `floor` dB to full scale, from 0 to 1.
 *
 * @param {number} db
 * @param {number} floor
 * @returns {number}
 */
export function fraction(db, floor) {
  return clamp((db - floor) / -floor, 0, 1);
}

/**
 * The colors the Source level meter draws a reading in under the spectrum's palette `palette`: each bar and the held
 * peak in the color the spectrum draws at that part's own level, and the peak readout in its bar's color. Under
 * Accent those are the accent's shades.
 *
 * @param {string} palette  a spectrum palette, as the store holds it
 * @param {{ peak: number, rms: number, hold: number }} reading  bar fractions, 0 on the floor and 1 at full scale
 * @param {string} accent  the accent in force, `#rrggbb`
 * @returns {{ peak: string, rms: string, hold: string, readout: string }}  `#rrggbb`
 */
export function meterColors(palette, { peak, rms, hold }, accent) {
  const peakColor = suiteColor(palette, peak, accent);
  return {
    peak: peakColor,
    rms: suiteColor(palette, rms, accent),
    hold: suiteColor(palette, hold, accent),
    readout: peakColor,
  };
}
