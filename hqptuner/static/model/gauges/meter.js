// Source meter model: the decisions behind each painted frame, free of the DOM. Every function takes the frame's
// time as arguments (`now` in ms on the rAF timeline, `dt` in s) and returns the next state, so a caller paints what
// it gets back and a test drives it from a table.

import { holdFall } from "./holdfall.js";

const FLOOR_DB = -300; // a spectrum bin with nothing shown yet
const SPEC_FALL_DBPS = 30; // shown spectrum fall, dB/s
const GHOST_AVERAGE_TAU_S = 1.5; // average ghost time constant, s
const GHOST_COLLECT_MS = 2000; // fade ghost collection before it fades, ms
const GHOST_FADE_MS = 500; // fade ghost fade-out, ms
const BIN_STEP_DB = 0.5; // one bin step below full scale on the feed (engine/meterfeed.py)
const BIN_BYTES = 2; // bytes a bin's steps travel in, low byte first
const HIGH_BYTE = 256; // steps one count of the high byte stands for
const PEAK_FALL_DBPS = 20; // level peak fall, dB/s
const RMS_TAU_S = 0.3; // level RMS integration time
const HOLD_MS = 1500; // level hold before it decays
const HOLD_DECAY_DBPS = 10; // level hold decay once released, dB/s
const MAX_DT_S = 0.1; // longest step one frame may take
const SMOOTH_COLS = 2; // trace columns averaged either side of each, across frequency
const SMOOTH_TAU_MS = 60; // trace easing time constant, in dB

/**
 * Shown spectrum and the ghost line above it, one entry per bin, the time the shown level last reached each ghost
 * entry, whether the ghost holds a level yet, how visible it is, and when a fade ghost began collecting. Float32
 * storage is part of the result: each step reads back the rounded values it stored.
 *
 * @typedef {object} SpectrumHold
 * @property {Float32Array} disp       shown level, dBFS
 * @property {Float32Array} peak       ghost level, dBFS
 * @property {Float32Array} peakAt     ms the shown level last reached the ghost
 * @property {boolean} held            the ghost holds a level, whichever style stepped it
 * @property {number} peakShown        how visible the ghost is, 0 (gone) to 1 (in full)
 * @property {number} collectAt        ms the fade ghost began collecting, -Infinity before it has
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
 * The frame loop between frames.
 *
 * @typedef {object} FrameLoop
 * @property {number} prev  rAF stamp of the last frame, ms
 * @property {number} acc   time accumulated toward the next spectrogram column, s
 */

/**
 * One frame's step: the loop to carry forward, the dt the frame runs the ballistics at, and how many spectrogram
 * columns it owes.
 *
 * @typedef {FrameLoop & { dt: number, cols: number }} FrameStep
 */

/**
 * A spectrum with nothing shown and nothing held.
 *
 * @param {number} bins
 * @returns {SpectrumHold}
 */
export function emptySpectrum(bins) {
  return {
    disp: new Float32Array(bins).fill(FLOOR_DB),
    peak: new Float32Array(bins).fill(FLOOR_DB),
    peakAt: new Float32Array(bins),
    held: false,
    peakShown: 1,
    collectAt: -Infinity,
  };
}

/**
 * The spectrum after a frame `dt` seconds long of new bin levels: a rise shows at once, a fall shows falling at a fixed
 * rate (or lands at once on a jump), and the ghost above it steps in the `ghost` style, fall unless `average` or
 * `fade` is given, on a plot spanning `range` dB. Fall: each ghost entry steps by `holdFall` in plot
 * fractions, as a bar's peak cap does. Average: the ghost eases toward the shown level over 1.5 s, from the plot's
 * floor at the lowest. Fade: the ghost collects the shown level's peaks for two seconds, then fades out over half a
 * second as one, holding its shape, and collects again from the shown level.
 *
 * @param {SpectrumHold} prev
 * @param {ArrayLike<number>} levels  this frame's bin levels, dBFS
 * @param {{ now: number, dt: number, ghost?: string, range: number }} at  ms, s, ghost style, plot span in dB
 * @param {boolean} jump              show the new levels outright (reset, first paint)
 * @returns {SpectrumHold}
 */
export function stepSpectrum(prev, levels, { now, dt, ghost, range }, jump) {
  const next = emptySpectrum(levels.length);
  const fall = SPEC_FALL_DBPS * dt;
  for (let i = 0; i < levels.length; i++) {
    const v = levels[i];
    next.disp[i] = jump || v > prev.disp[i] ? v : Math.max(v, prev.disp[i] - fall);
    next.peakAt[i] = next.disp[i] >= prev.peak[i] ? now : prev.peakAt[i];
  }
  if (ghost === "average") averageGhost(prev, next, { dt, range });
  else if (ghost === "fade") fadeGhost(prev, next, now);
  else fallGhost(prev, next, { now, dt, range });
  next.held = true;
  return next;
}

/**
 * The fall ghost into `next`: each entry and the shown level under it, as fractions of a plot spanning `range` dB
 * (unclamped, so levels off the plot keep their distance), stepped by `holdFall` with its age the time since the
 * shown level last reached it.
 *
 * @param {SpectrumHold} prev
 * @param {SpectrumHold} next  shown level and stamps already stepped
 * @param {{ now: number, dt: number, range: number }} at  ms, s, dB
 */
function fallGhost(prev, next, { now, dt, range }) {
  for (let i = 0; i < next.disp.length; i++) {
    const age = (now - prev.peakAt[i]) / 1000;
    const mark = holdFall(1 + prev.peak[i] / range, 1 + next.disp[i] / range, age, dt);
    next.peak[i] = (mark - 1) * range;
  }
}

/**
 * The average ghost into `next`: each entry closes the same share of its gap to the shown level in dB per step, over
 * GHOST_AVERAGE_TAU_S, both floored at the bottom of a plot spanning `range` dB, so it stays finite and eases up from
 * the floor after silence; a ghost holding no level yet lands on the shown level.
 *
 * @param {SpectrumHold} prev
 * @param {SpectrumHold} next  shown level already stepped
 * @param {{ dt: number, range: number }} at  s, dB
 */
function averageGhost(prev, next, { dt, range }) {
  const fresh = !prev.held;
  const share = easeShare(dt, GHOST_AVERAGE_TAU_S);
  for (let i = 0; i < next.disp.length; i++) {
    const d = Math.max(-range, next.disp[i]);
    const g = Math.max(-range, prev.peak[i]);
    next.peak[i] = fresh ? d : g + (d - g) * share;
  }
}

/**
 * The fade ghost into `next`: for GHOST_COLLECT_MS after it began collecting each entry is the highest shown level
 * since, fully visible; for GHOST_FADE_MS after that it holds and its visibility falls from 1 to 0; then it begins
 * collecting again from the shown level, as it does on its first step.
 *
 * @param {SpectrumHold} prev
 * @param {SpectrumHold} next  shown level already stepped
 * @param {number} now  ms
 */
function fadeGhost(prev, next, now) {
  const start = prev.collectAt;
  const since = now - start;
  if (since >= GHOST_COLLECT_MS + GHOST_FADE_MS) {
    next.peak.set(next.disp);
    next.collectAt = now;
    return;
  }
  const collecting = since < GHOST_COLLECT_MS;
  next.collectAt = start;
  next.peakShown = collecting ? 1 : 1 - (since - GHOST_COLLECT_MS) / GHOST_FADE_MS;
  for (let i = 0; i < next.disp.length; i++) {
    next.peak[i] = collecting ? Math.max(prev.peak[i], next.disp[i]) : prev.peak[i];
  }
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
 * One rAF frame: dt is the time since the last frame, clamped to [0, 100 ms] (a frame stamped before mount must not
 * run the ballistics backwards); while shown, it accumulates toward the spectrogram's column period and the frame owes
 * one column per whole period accumulated.
 *
 * @param {FrameLoop} loop
 * @param {number} now     rAF stamp, ms
 * @param {number} perCol  spectrogram column period, s
 * @param {boolean} shown  the meter is on screen
 * @returns {FrameStep}
 */
export function stepFrame(loop, now, perCol, shown) {
  const dt = frameDt(loop.prev, now);
  if (!shown) return { prev: now, acc: loop.acc, dt, cols: 0 };
  let acc = loop.acc + dt;
  let cols = 0;
  while (acc >= perCol) {
    acc -= perCol;
    cols++;
  }
  return { prev: now, acc, dt, cols };
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
  return Math.max(0, Math.min(MAX_DT_S, (now - prev) / 1000));
}

/**
 * One feed frame, or several folded into one: per channel its peak and RMS in dBFS and its transform bins in dBFS,
 * DC first, the frame time it covers, and the feed geometry it arrived under.
 *
 * @typedef {{ nyquist: number, channels: number, bins: number }} FrameGeometry
 * @typedef {{ channels: { peak: number, rms: number, bins: Float32Array }[], ms: number, geo?: FrameGeometry | null }} MeterFrame
 */

const toPower = (/** @type {number} */ db) => 10 ** (db / 10);
const toDb = (/** @type {number} */ p) => 10 * Math.log10(p);

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
  for (const row of rows) for (let k = 0; k < n; k++) acc[k] += toPower(row[k]);
  return Float32Array.from(acc, (p) => toDb(p / rows.length));
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
 * Bins laid onto `cols` columns from 0 Hz to Nyquist, bin `k` of `n` at `k/(n-1)` of the way: each column the loudest
 * bin in its span, so a tone keeps its level however many bins share a column, and a column no bin falls in takes the
 * bin nearest its centre.
 *
 * @param {ArrayLike<number>} bins  dBFS
 * @param {number} cols
 * @returns {Float32Array}
 */
export function traceColumns(bins, cols) {
  const out = new Float32Array(cols).fill(-Infinity);
  const last = bins.length - 1;
  for (let k = 0; k <= last; k++) {
    const c = Math.min(cols - 1, Math.floor((k / last) * cols));
    if (bins[k] > out[c]) out[c] = bins[k];
  }
  for (let c = 0; c < cols; c++) {
    if (out[c] === -Infinity) out[c] = bins[Math.round(((c + 0.5) / cols) * last)];
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
  const power = Float64Array.from(cols, toPower);
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
    out[c] = toDb(sum / weight);
  }
  return out;
}

/**
 * The trace `dt` seconds on from `prev` toward `next`, each column closing the same share of its gap in dB, so it
 * rises and falls alike; without a `prev` of the same length the trace lands on `next`.
 *
 * @param {ArrayLike<number> | null} prev  dBFS
 * @param {ArrayLike<number>} next  dBFS
 * @param {number} dt  s
 * @returns {Float32Array}
 */
export function easeTrace(prev, next, dt) {
  if (!prev || prev.length !== next.length) return Float32Array.from(next);
  const share = easeShare(dt, SMOOTH_TAU_MS / 1000);
  return Float32Array.from(next, (v, i) => prev[i] + (v - prev[i]) * share);
}

/**
 * The share of its gap an exponential ease with time constant `tau` closes in a step of `dt`.
 *
 * @param {number} dt   s
 * @param {number} tau  s
 * @returns {number}
 */
function easeShare(dt, tau) {
  return 1 - Math.exp(-dt / tau);
}

/**
 * Where a level sits on a bar running from `floor` dB to full scale, from 0 to 1.
 *
 * @param {number} db
 * @param {number} floor
 * @returns {number}
 */
export function fraction(db, floor) {
  return Math.min(1, Math.max(0, (db - floor) / -floor));
}
