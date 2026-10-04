// Source meter model: the decisions behind each painted frame, free of the DOM. Every function takes the frame's
// time as arguments (`now` in ms on the rAF timeline, `dt` in s) and returns the next state, so a caller paints what
// it gets back and a test drives it from a table.

const FLOOR_DB = -300;            // a spectrum bin with nothing shown yet
const SPEC_FALL_DB = 3;           // shown spectrum fall per frame, ~30 dB/s at 10 Hz
const SPEC_HOLD_MS = 2000;        // spectrum peak hold before it decays
const SPEC_DECAY_DB = 1;          // spectrum peak decay per frame once released
const PEAK_CEIL_DB = -0.6;        // highest peak the mock source reaches
const PEAK_FALL_DBPS = 20;        // level peak fall, dB/s
const RMS_TAU_S = 0.3;            // level RMS integration time
const HOLD_MS = 1500;             // level hold before it decays
const HOLD_DECAY_DBPS = 10;       // level hold decay once released, dB/s
const MAX_DT_S = 0.1;             // longest step one frame may take

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
 * The spectrum after one frame of new bin levels: a rise shows at once, a fall shows falling a fixed step per frame
 * (or lands at once on a jump), and each held peak stays put for two seconds after it was last reached, then decays a
 * fixed step per frame, never below the shown level.
 *
 * @param {SpectrumHold} prev
 * @param {ArrayLike<number>} levels  this frame's bin levels, dBFS
 * @param {number} now                ms
 * @param {boolean} jump              show the new levels outright (reset, first paint)
 * @returns {SpectrumHold}
 */
export function stepSpectrum(prev, levels, now, jump) {
  const next = emptySpectrum(levels.length);
  for (let i = 0; i < levels.length; i++) {
    const v = levels[i];
    next.disp[i] = jump || v > prev.disp[i] ? v : Math.max(v, prev.disp[i] - SPEC_FALL_DB);
    const d = next.disp[i];
    const released = now - prev.peakAt[i] > SPEC_HOLD_MS;
    next.peak[i] = d >= prev.peak[i] ? d : released ? Math.max(d, prev.peak[i] - SPEC_DECAY_DB) : prev.peak[i];
    next.peakAt[i] = d >= prev.peak[i] ? now : prev.peakAt[i];
  }
  return next;
}

/**
 * Where a channel's level is heading for one mock column: RMS rides the column's envelope, the peak sits a crest
 * factor above it (redrawn every 60 ms, lifted on a kick) and never past the ceiling.
 *
 * @param {{ idx: number, env: number, kick: boolean }} c  the mock column
 * @param {number} ch                                      channel index
 * @param {number} now                                     ms
 * @returns {LevelTarget}
 */
export function levelTarget(c, ch, now) {
  const rms = -21 + c.env + (ch ? -1.3 : 0) + (hash(c.idx, 11 + ch) - 0.5) * 1.5;
  const pk = rms + 8 + hash(c.idx * 3 + Math.floor(now / 60), 13 + ch) * 5 + (c.kick ? 3 : 0);
  return { rms, peak: Math.min(PEAK_CEIL_DB, pk) };
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
  const dt = Math.max(0, Math.min(MAX_DT_S, (now - loop.prev) / 1000));
  if (!shown) return { prev: now, acc: loop.acc, dt, cols: 0 };
  let acc = loop.acc + dt;
  let cols = 0;
  while (acc >= perCol) { acc -= perCol; cols++; }
  return { prev: now, acc, dt, cols };
}

/**
 * Deterministic hash of two integers to [0, 1): the mock source's only randomness.
 *
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function hash(a, b) {
  let x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
