// Source meter plots: where the spectrum and the spectrogram put their axes, free of the DOM. The spectrum's axes, the
// Ranges a step wider and narrower, the level bars' dB scale, the frequency and time axes' ticks, and the colour ramps.

import { clamp } from "../../lib/coerce.js";

const RAMP_SIZE = 256; // colour ramp entries
const DB_STEPS = 6; // dB scale steps from full scale to the spectrum's range or the level bars' floor
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
const levelY = (db, plot) => clamp((-db / plot.range) * plot.h, 0, plot.h);

/**
 * The tick steps of a frequency axis, Hz, each after the axis top it takes over above, widest first.
 *
 * @type {[number, number][]}
 */
const KHZ_STEPS = [
  [60000, 20000],
  [30000, 10000],
  [15000, 5000],
  [7500, 2000],
];

/**
 * The frequency ticks of an axis from 0 to its top, Hz: every 1, 2, 5, 10 or 20 kHz as the top grows, none in the top
 * 15%.
 *
 * @param {number} nyq  the axis's top, Hz
 * @returns {number[]}
 */
function khzTicks(nyq) {
  const step = KHZ_STEPS.find(([above]) => nyq > above)?.[1] ?? 1000;
  return Array.from({ length: Math.floor(nyq / step) + 1 }, (_, i) => i * step).filter((f) => f <= nyq * 0.85);
}

/**
 * The dB ticks from full scale down `span` dB, in DB_STEPS even steps, full scale first.
 *
 * @param {number} span  dB
 * @returns {number[]}  dBFS
 */
const dbSteps = (span) => Array.from({ length: DB_STEPS + 1 }, (_, i) => 0 - (i * span) / DB_STEPS);

/**
 * A spectrum plot's dB ticks (full scale down to the range in DB_STEPS even steps) and frequency ticks, placed.
 *
 * @param {SpectrumPlot} plot
 * @returns {{ db: { db: number, y: number }[], hz: { hz: number, x: number }[] }}
 */
export function spectrumAxes(plot) {
  const db = dbSteps(plot.range).map((d) => ({ db: d, y: levelY(d, plot) }));
  return { db, hz: khzTicks(plot.nyq).map((hz) => ({ hz, x: freqX(hz, plot) })) };
}

/**
 * The Ranges one step either side of `range` among `ranges`, by span: the next wider and the next narrower, each null
 * where `range` is already the widest or the narrowest, both null where `ranges` does not hold it.
 *
 * @param {readonly string[]} ranges  dB
 * @param {string} range  dB
 * @returns {{ wider: string | null, narrower: string | null }}
 */
export function rangeSteps(ranges, range) {
  const spans = [...ranges].sort((a, b) => Number(a) - Number(b));
  const i = spans.indexOf(range);
  if (i < 0) return { wider: null, narrower: null };
  return { wider: spans[i + 1] ?? null, narrower: spans[i - 1] ?? null };
}

/**
 * The level bars' dB scale: full scale down to `floor` in DB_STEPS even steps, each at its fraction of the bar down
 * from the top.
 *
 * @param {number} floor  dBFS, below full scale
 * @returns {{ db: number, at: number }[]}
 */
export function levelTicks(floor) {
  return dbSteps(-floor).map((d, i) => ({ db: d, at: i / DB_STEPS }));
}

/**
 * A frequency axis's tick labels in kHz and the label at its top (kHz to two places), each at the fraction of the axis
 * `at` puts its frequency.
 *
 * @param {number} nyq  the axis's top, Hz
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
