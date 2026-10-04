// Source meter model: the decisions behind each painted frame, free of the DOM. Every function takes the frame's
// time as arguments (`now` in ms on the rAF timeline, `dt` in s) and returns the next state, so a caller paints what
// it gets back and a test drives it from a table.

const FLOOR_DB = -300; // a spectrum bin with nothing shown yet
const SPEC_FALL_DB = 3; // shown spectrum fall per frame, ~30 dB/s at 10 Hz
const SPEC_HOLD_MS = 2000; // spectrum peak hold before it decays
const SPEC_DECAY_DB = 1; // spectrum peak decay per frame once released
const PEAK_CEIL_DB = -0.6; // highest peak the mock source reaches
const PEAK_FALL_DBPS = 20; // level peak fall, dB/s
const RMS_TAU_S = 0.3; // level RMS integration time
const HOLD_MS = 1500; // level hold before it decays
const HOLD_DECAY_DBPS = 10; // level hold decay once released, dB/s
const MAX_DT_S = 0.1; // longest step one frame may take
const DSD_NOISE_HZ = 12000; // where a DSD source's modulator noise starts to climb
const NO_DATA = -1; // spectrogram colour index for a pixel with no column under it
const MAX_APOD = 3; // apodizing events one strip pixel tells apart
const RAMP_SIZE = 256; // colour ramp entries
/** @type {Record<number, number>} */
const DB_STEP = { 60: 10, 90: 15, 120: 20, 200: 40, 300: 50 }; // spectrum dB grid step per range
const TIME_STEPS_S = [5, 10, 15, 30, 60, 120, 300]; // time-axis tick steps, at most five per span
//: The mock track's four chords (MIDI notes), 2.4 s each.
const CHORDS = [
  [45, 57, 61, 64],
  [50, 57, 62, 66],
  [43, 55, 59, 62],
  [48, 55, 60, 64],
];

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
 * What the mock source holds: where its content ends and whether a DSD modulator's noise rides over the top of the band.
 *
 * @typedef {object} MockSource
 * @property {number} brick       Hz
 * @property {boolean} [dsdNoise]
 */

/**
 * The mock source as a feed of spectrogram columns: the column period and each spectrogram row's frequency.
 *
 * @typedef {MockSource & { perCol: number, rowHz: ArrayLike<number> }} MockFeed
 */

/**
 * What sounds in one mock column.
 *
 * @typedef {object} MockVoice
 * @property {number[]} notes  Hz
 * @property {number[]} dyn    dB under full level, one per note
 * @property {number} hatDb    dB under the hat's level
 * @property {boolean} kick
 * @property {boolean} hat
 * @property {number} env      dB, applied to everything
 */

/**
 * One mock column: its voice, its apodizing events, and its spectrogram rows (dBFS) for L, then R, then Sum.
 *
 * @typedef {MockVoice & { idx: number, apod: number, db: Float32Array }} MockColumn
 */

/**
 * A spectrum plot's box: Nyquist, the dB span from full scale down, and its width and height.
 *
 * @typedef {object} SpectrumPlot
 * @property {number} nyq    Hz
 * @property {number} range  dB
 * @property {number} w
 * @property {number} h
 */

/**
 * A spectrogram's raster: pixel columns and rows, the history columns it spans, the offset of the shown channel's rows
 * in each column, and the dB span of its colour ramp.
 *
 * @typedef {object} SpectrogramView
 * @property {number} cols
 * @property {number} rows
 * @property {number} span
 * @property {number} off
 * @property {number} range
 */

/**
 * The spectrogram's colour indices, one per pixel row by row (NO_DATA where no column lies under it), and the
 * apodizing strip's, one per pixel column.
 *
 * @typedef {{ colour: Int16Array, events: Uint8Array }} SpectrogramIndex
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
  while (acc >= perCol) {
    acc -= perCol;
    cols++;
  }
  return { prev: now, acc, dt, cols };
}

/**
 * Power in dB.
 *
 * @param {number} p
 */
const dB = (p) => 10 * Math.log10(p);

/**
 * Linear power at `f` for one channel of one mock column, its envelope applied: a falling noise bed, each note's
 * harmonics up to 97% of the brick wall (panned apart between the channels), a kick in the bass, a hat in the treble,
 * the brick wall's cut, the 16-bit floor and, from DSD, modulator noise climbing toward the top of the band.
 *
 * @param {MockVoice} c
 * @param {number} f      Hz
 * @param {number} ch     channel index
 * @param {MockSource} src
 * @returns {number}
 */
export function power(c, f, ch, src) {
  const brick = src.brick;
  let p = 10 ** ((-56 - 5 * Math.log2(Math.max(f, 60) / 250) - (f < 60 ? 12 * Math.log2(60 / f) : 0)) / 10);
  c.notes.forEach((f0, n) => {
    const pan = (n + ch) % 2 ? 0 : -2.5;
    for (let k = 1; k <= 14; k++) {
      const fk = f0 * k;
      if (fk > brick * 0.97) break;
      const d = Math.log2(f / fk);
      if (d > 0.15 || d < -0.15) continue;
      p +=
        10 ** ((-20 - 6.5 * Math.log2(k) + pan - (n === 0 ? 0 : 4) - c.dyn[n]) / 10) *
        Math.exp(-0.5 * (d / 0.035) ** 2);
    }
  });
  if (c.kick && f < 180) p += 10 ** (-12 / 10) * Math.exp(-0.5 * (Math.log2(f / 60) / 0.6) ** 2);
  if (c.hat && f > 3000) p += 10 ** ((-58 - c.hatDb - 3 * Math.log2(f / 8000) ** 2) / 10);
  if (f > brick) p *= 10 ** (-Math.min(110, (f - brick) * (brick > 30000 ? 0.012 : 0.09)) / 10);
  p += 10 ** (-112 / 10);
  if (src.dsdNoise && f > DSD_NOISE_HZ) p += 10 ** ((-118 + ((f - DSD_NOISE_HZ) / 10000) * 62) / 10);
  return p * 10 ** (c.env / 10);
}

/**
 * The mock column's power scatter at one row or bin of one channel, as a linear factor within ±3 dB.
 *
 * @param {{ idx: number }} c
 * @param {number} i   row or bin
 * @param {number} ch  channel index (the spectrum draws its own)
 * @returns {number}
 */
export const jitter = (c, i, ch) => 10 ** ((hash(c.idx * 211 + i, 1 + ch) - 0.5) * 0.6);

/**
 * Apodizing events in one mock column: clustered in the opening 90 columns, rare afterwards.
 *
 * @param {number} idx
 * @returns {number}
 */
function apodEvents(idx) {
  if (idx < 90) return hash(idx, 3) < 0.12 ? 1 + Math.floor(hash(idx, 4) * 2) : 0;
  return hash(idx, 5) < 0.0015 ? 1 : 0;
}

/**
 * The mock column at track column `idx`: a chord changing every 2.4 s with its dynamics, a kick every fifth column and
 * a hat two before it, the envelope, the apodizing events, and its spectrogram rows.
 *
 * @param {number} idx
 * @param {MockFeed} feed
 * @returns {MockColumn}
 */
export function mockColumn(idx, feed) {
  const t = idx * feed.perCol;
  const chord = CHORDS[Math.floor(t / 2.4) % 4];
  const rows = feed.rowHz.length;
  /** @type {MockColumn} */
  const c = {
    idx,
    notes: chord.map((m) => 440 * 2 ** ((m - 69) / 12)),
    dyn: chord.map((_, n) => 6 * hash(Math.floor(t / 0.6), 20 + n) + (t % 2.4) * 2.5),
    hatDb: 10 * hash(idx, 9),
    kick: idx % 5 === 0,
    hat: idx % 5 === 3,
    env: 3 * Math.sin(t * 0.37) + 1.5 * Math.sin(t * 1.9) + (hash(idx, 7) - 0.5) * 2,
    apod: apodEvents(idx),
    db: new Float32Array(rows * 3),
  };
  for (let y = 0; y < rows; y++) {
    const [l, r] = [0, 1].map((ch) => power(c, feed.rowHz[y], ch, feed) * jitter(c, y, ch));
    c.db[y] = dB(l);
    c.db[rows + y] = dB(r);
    c.db[2 * rows + y] = dB((l + r) / 2);
  }
  return c;
}

/**
 * One mock column's spectrum, dBFS per bin, for one channel or the power average of the two.
 *
 * @param {MockColumn} c
 * @param {ArrayLike<number>} binHz
 * @param {string} channel  'sum' or a channel index
 * @param {MockSource} src
 * @returns {Float64Array}
 */
export function binLevels(c, binHz, channel, src) {
  return Float64Array.from(binHz, (f, i) => {
    const p = channel === "sum" ? (power(c, f, 0, src) + power(c, f, 1, src)) / 2 : power(c, f, Number(channel), src);
    return dB(p * jitter(c, i, 5));
  });
}

/**
 * Where a frequency sits across a spectrum plot.
 *
 * @param {number} f  Hz
 * @param {SpectrumPlot} plot
 * @returns {number}
 */
export const freqX = (f, plot) => (f / plot.nyq) * plot.w;

/**
 * Where a level sits down a spectrum plot: full scale on the top edge, the range's floor and below on the bottom one.
 *
 * @param {number} db  dBFS
 * @param {SpectrumPlot} plot
 * @returns {number}
 */
const levelY = (db, plot) => Math.max(0, Math.min(plot.h, (-db / plot.range) * plot.h));

/**
 * One [x, y] point per bin of a spectrum trace.
 *
 * @param {ArrayLike<number>} levels  dBFS per bin
 * @param {ArrayLike<number>} binHz
 * @param {SpectrumPlot} plot
 * @returns {[number, number][]}
 */
export function spectrumPoints(levels, binHz, plot) {
  return Array.from(levels, (v, i) => [freqX(binHz[i], plot), levelY(v, plot)]);
}

/**
 * The frequency ticks of an axis from 0 to Nyquist, Hz: every 5, 10 or 20 kHz as Nyquist grows, none in the top 15%.
 *
 * @param {number} nyq  Hz
 * @returns {number[]}
 */
function khzTicks(nyq) {
  const step = nyq > 60000 ? 20000 : nyq > 30000 ? 10000 : 5000;
  return Array.from({ length: Math.floor(nyq / step) + 1 }, (_, i) => i * step).filter((f) => f <= nyq * 0.85);
}

/**
 * A spectrum plot's dB ticks (full scale down to the range at the range's step) and frequency ticks, placed.
 *
 * @param {SpectrumPlot} plot
 * @returns {{ db: { db: number, y: number }[], hz: { hz: number, x: number }[] }}
 */
export function spectrumAxes(plot) {
  const step = DB_STEP[plot.range];
  /** @type {{ db: number, y: number }[]} */
  const db = [];
  for (let d = 0; d >= -plot.range; d -= step) db.push({ db: d, y: levelY(d, plot) });
  return { db, hz: khzTicks(plot.nyq).map((hz) => ({ hz, x: freqX(hz, plot) })) };
}

/**
 * A frequency axis's tick labels in kHz and the Nyquist label (kHz to two places), each at the fraction of the axis
 * `at` puts its frequency.
 *
 * @param {number} nyq  Hz
 * @param {(f: number) => number} at
 * @returns {{ ticks: { khz: number, at: number }[], nyq: { khz: number, at: number } }}
 */
export function freqTicks(nyq, at) {
  return {
    ticks: khzTicks(nyq).map((f) => ({ khz: f / 1000, at: at(f) })),
    nyq: { khz: +(nyq / 1000).toFixed(2), at: at(nyq) },
  };
}

/**
 * History columns a spectrogram window spans: every column since track start for 'all', else its seconds' worth.
 *
 * @param {number | 'all'} window  s
 * @param {number} total           columns since track start
 * @param {number} colsPerSec
 * @returns {number}
 */
export const windowSpan = (window, total, colsPerSec) => (window === "all" ? total : window * colsPerSec);

/**
 * The held columns under pixel column `x`: those of its share of the span still in history.
 *
 * @template {{ db: ArrayLike<number>, apod: number }} C
 * @param {C[]} hist
 * @param {number} firstIdx  track column of hist[0]
 * @param {number} x
 * @param {SpectrogramView} view
 * @returns {C[]}
 */
function heldUnder(hist, firstIdx, x, view) {
  const total = firstIdx + hist.length;
  const start = total - view.span;
  const i0 = start + Math.floor((x * view.span) / view.cols);
  const i1 = Math.max(i0 + 1, start + Math.floor(((x + 1) * view.span) / view.cols));
  const held = [];
  for (let i = Math.max(i0, firstIdx); i < i1 && i < total; i++) held.push(hist[i - firstIdx]);
  return held;
}

/**
 * The ramp index of the loudest of `held` at one row: 0 at the range's floor and below, 255 at full scale.
 *
 * @param {{ db: ArrayLike<number> }[]} held
 * @param {number} row    index into each column's rows
 * @param {number} range  dB
 * @returns {number}
 */
function colourIndex(held, row, range) {
  let m = -300;
  for (const c of held) if (c.db[row] > m) m = c.db[row];
  return Math.round(Math.max(0, Math.min(1, (m + range) / range)) * (RAMP_SIZE - 1));
}

/**
 * The spectrogram's colour index at every pixel and the apodizing strip's at every pixel column (its events, capped
 * at three), the right edge on the newest column held.
 *
 * @param {{ db: ArrayLike<number>, apod: number }[]} hist
 * @param {number} firstIdx  track column of hist[0]
 * @param {SpectrogramView} view
 * @returns {SpectrogramIndex}
 */
export function spectrogramIndex(hist, firstIdx, view) {
  const colour = new Int16Array(view.cols * view.rows);
  const events = new Uint8Array(view.cols);
  for (let x = 0; x < view.cols; x++) {
    const held = heldUnder(hist, firstIdx, x, view);
    let ev = 0;
    for (const c of held) ev += c.apod;
    events[x] = Math.min(MAX_APOD, ev);
    for (let y = 0; y < view.rows; y++)
      colour[y * view.cols + x] = held.length ? colourIndex(held, view.off + y, view.range) : NO_DATA;
  }
  return { colour, events };
}

/**
 * The time axis under a spectrogram window: a tick step keeping at most five per span, minutes past two minutes, and
 * the ticks at their fraction across, each with its value in that unit. 'All' counts from track start to the newest
 * column; a timed window counts back from it to zero. A tick crowding the right edge gives way to the end label.
 *
 * @param {number} span        columns shown
 * @param {number} total       columns since track start
 * @param {number} colsPerSec
 * @param {boolean} all
 * @returns {{ inMin: boolean, ticks: { at: number, value: number }[] }}
 */
export function timeTicks(span, total, colsPerSec, all) {
  const spanS = span / colsPerSec;
  const step = TIME_STEPS_S.find((v) => spanS / v <= 5) || 600;
  const inMin = spanS > 120;
  /** @param {number} sec */
  const value = (sec) => (inMin ? +(sec / 60).toFixed(1) : Math.round(sec));
  /** @type {{ at: number, value: number }[]} */
  const ticks = [];
  if (all) {
    const endS = total / colsPerSec;
    for (let t = 0; t < endS - step * 0.35; t += step) ticks.push({ at: t / spanS, value: value(t) });
    ticks.push({ at: 1, value: value(endS) });
  } else {
    for (let t = spanS; t > step * 0.35; t -= step) ticks.push({ at: 1 - t / spanS, value: value(-t) });
    ticks.push({ at: 1, value: value(0) });
  }
  return { inMin, ticks };
}

/**
 * The spectrogram's colour ramp: 256 RGB entries blending evenly across the stops, first stop at 0, last at 255.
 *
 * @param {number[][]} stops  [r, g, b], at least two
 * @returns {Uint8ClampedArray}
 */
export function rampLut(stops) {
  const lut = new Uint8ClampedArray(RAMP_SIZE * 3);
  for (let i = 0; i < RAMP_SIZE; i++) {
    const pos = (i / (RAMP_SIZE - 1)) * (stops.length - 1);
    const a = Math.min(stops.length - 2, Math.floor(pos)),
      t = pos - a;
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = stops[a][k] + (stops[a + 1][k] - stops[a][k]) * t;
  }
  return lut;
}

/**
 * The apodizing strip's colours for 0 to 3 events: the glass, then 63%, 81% and 99% of the way to the bad colour.
 *
 * @param {number[]} glass  [r, g, b]
 * @param {number[]} bad    [r, g, b]
 * @returns {number[][]}
 */
export function apodRamp(glass, bad) {
  return [0, 1, 2, 3].map((n) => {
    const t = n ? 0.45 + 0.18 * n : 0;
    return glass.map((g, k) => g + (bad[k] - g) * t);
  });
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
