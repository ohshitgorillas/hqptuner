// Source meter model: the decisions behind each painted frame, free of the DOM. Every function takes the frame's
// time as arguments (`now` in ms on the rAF timeline, `dt` in s) and returns the next state, so a caller paints what
// it gets back and a test drives it from a table.

const FLOOR_DB = -300; // a spectrum bin with nothing shown yet
const SPEC_FALL_DBPS = 30; // shown spectrum fall, dB/s
const SPEC_HOLD_MS = 2000; // spectrum peak hold before it decays
const SPEC_DECAY_DBPS = 10; // spectrum peak decay once released, dB/s
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
 * Shown spectrum, held peaks and the time each peak was last reached, one entry per bin. Float32 storage is part of
 * the result: each step reads back the rounded values it stored.
 *
 * @typedef {object} SpectrumHold
 * @property {Float32Array} disp    shown level, dBFS
 * @property {Float32Array} peak    held peak, dBFS
 * @property {Float32Array} peakAt  ms the peak was last reached
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
  };
}

/**
 * The spectrum after a frame `dt` seconds long of new bin levels: a rise shows at once, a fall shows falling at a fixed
 * rate (or lands at once on a jump), and each held peak stays put for two seconds after it was last reached, then
 * decays at a fixed rate, never below the shown level.
 *
 * @param {SpectrumHold} prev
 * @param {ArrayLike<number>} levels  this frame's bin levels, dBFS
 * @param {{ now: number, dt: number }} at  the frame's stamp, ms, and its length, s
 * @param {boolean} jump              show the new levels outright (reset, first paint)
 * @returns {SpectrumHold}
 */
export function stepSpectrum(prev, levels, { now, dt }, jump) {
  const next = emptySpectrum(levels.length);
  const fall = SPEC_FALL_DBPS * dt;
  const decay = SPEC_DECAY_DBPS * dt;
  for (let i = 0; i < levels.length; i++) {
    const v = levels[i];
    next.disp[i] = jump || v > prev.disp[i] ? v : Math.max(v, prev.disp[i] - fall);
    const d = next.disp[i];
    const released = now - prev.peakAt[i] > SPEC_HOLD_MS;
    next.peak[i] = d >= prev.peak[i] ? d : released ? Math.max(d, prev.peak[i] - decay) : prev.peak[i];
    next.peakAt[i] = d >= prev.peak[i] ? now : prev.peakAt[i];
  }
  return next;
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
  const share = 1 - Math.exp((-dt * 1000) / SMOOTH_TAU_MS);
  return Float32Array.from(next, (v, i) => prev[i] + (v - prev[i]) * share);
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
