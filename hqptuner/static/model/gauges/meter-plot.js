// Source meter plots: where the spectrum and the spectrogram put what they paint, free of the DOM. The spectrum's
// points and axes, the spectrogram's colour indices and apodizing strip, the time axis, and the colour ramps.

const NO_DATA = -1; // spectrogram colour index for a pixel with no column under it
const MAX_APOD = 3; // apodizing events one strip pixel tells apart
const RAMP_SIZE = 256; // colour ramp entries
const DB_STEPS = 6; // spectrum dB grid steps from full scale to the range's floor
const TIME_STEPS_S = [5, 10, 15, 30, 60, 120, 300]; // time-axis tick steps, at most five per span

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
 * Where a frequency sits across a spectrum plot.
 *
 * @param {number} f  Hz
 * @param {SpectrumPlot} plot
 * @returns {number}
 */
const freqX = (f, plot) => (f / plot.nyq) * plot.w;

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
 * A spectrum plot's dB ticks (full scale down to the range in DB_STEPS even steps) and frequency ticks, placed.
 *
 * @param {SpectrumPlot} plot
 * @returns {{ db: { db: number, y: number }[], hz: { hz: number, x: number }[] }}
 */
export function spectrumAxes(plot) {
  const step = plot.range / DB_STEPS;
  const db = Array.from({ length: DB_STEPS + 1 }, (_, i) => {
    const d = 0 - i * step;
    return { db: d, y: levelY(d, plot) };
  });
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
 * the ticks at their fraction across, each with its value in that unit, counting back from the newest column to zero.
 * A tick crowding the right edge gives way to the end label.
 *
 * @param {number} span        columns shown
 * @param {number} colsPerSec
 * @returns {{ inMin: boolean, ticks: { at: number, value: number }[] }}
 */
export function timeTicks(span, colsPerSec) {
  const spanS = span / colsPerSec;
  const step = TIME_STEPS_S.find((v) => spanS / v <= 5) || 600;
  const inMin = spanS > 120;
  /** @param {number} sec */
  const value = (sec) => (inMin ? +(sec / 60).toFixed(1) : Math.round(sec));
  /** @type {{ at: number, value: number }[]} */
  const ticks = [];
  for (let t = spanS; t > step * 0.35; t -= step) ticks.push({ at: 1 - t / spanS, value: value(-t) });
  ticks.push({ at: 1, value: value(0) });
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
