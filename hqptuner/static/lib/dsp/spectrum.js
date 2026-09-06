// --- Primer spectrum readings ---------------------------------------------------
// The frequency-domain readings the filter primer draws: magnitude, group
// delay, the alias fold and the source wash. Pure functions.

import { fftRadix2 } from "./fft.js";

/** Magnitudes below this read as the floor; keeps log10 finite on exact zeros. */
const MAG_FLOOR = 1e-10;
/** Smallest FFT the magnitude reading is taken on; finer than any drawn grid. */
const MIN_NFFT = 1 << 14;

/**
 * The FFT size a reading of `taps` is taken on: at least MIN_NFFT, at least
 * twice the filter so the taps sit in the first half, and at least twice the
 * grid's intervals, so a grid that steps a power of two across half the rate
 * lands every point on a bin and the reading is the transform itself rather
 * than a chord between two bins, which near a null sits decibels above it.
 * @param {Float64Array} taps
 * @param {number} points on the grid the reading is taken at
 * @returns {number}
 */
const readSize = (taps, points) => Math.max(MIN_NFFT, 1 << Math.ceil(Math.log2(2 * Math.max(taps.length, points - 1))));

/**
 * A per-bin quantity read at each requested frequency, interpolated between
 * bins. Frequencies past the rate wrap, so the reading is periodic in `rate`
 * like the response itself.
 * @param {Float64Array} bins
 * @param {number} rate
 * @param {number[]} freqsHz
 * @returns {Float64Array}
 */
function readBins(bins, rate, freqsHz) {
  const nfft = bins.length;
  const out = new Float64Array(freqsHz.length);
  for (let k = 0; k < freqsHz.length; k += 1) {
    const pos = (((freqsHz[k] / rate) % 1) + 1) % 1;
    const x = pos * nfft;
    const lo = Math.floor(x) % nfft;
    const hi = (lo + 1) % nfft;
    const t = x - Math.floor(x);
    out[k] = bins[lo] * (1 - t) + bins[hi] * t;
  }
  return out;
}

/**
 * Magnitude response in dB at each requested frequency, read off one FFT of the
 * taps and interpolated between bins; periodic in `rate`.
 * @param {Float64Array} taps
 * @param {number} rate
 * @param {number[]} freqsHz
 * @returns {Float64Array}
 */
export function magnitudeDb(taps, rate, freqsHz) {
  const nfft = readSize(taps, freqsHz.length);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  re.set(taps);
  fftRadix2(re, im);
  const mag = new Float64Array(nfft);
  for (let i = 0; i < nfft; i += 1) mag[i] = Math.hypot(re[i], im[i]);
  return readBins(mag, rate, freqsHz).map((v) => 20 * Math.log10(Math.max(v, MAG_FLOOR)));
}

/**
 * Group delay in samples at each requested frequency: the real part of the
 * ramped-tap transform over the plain one, read off one FFT pair and
 * interpolated between bins; periodic in `rate`. No phase is unwrapped, so
 * the reading is exact wherever the response has energy and meaningless in a
 * stop band, which the caller masks by magnitude.
 * @param {Float64Array} taps
 * @param {number} rate
 * @param {number[]} freqsHz
 * @returns {Float64Array}
 */
export function groupDelaySamples(taps, rate, freqsHz) {
  const nfft = readSize(taps, freqsHz.length);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const rampRe = new Float64Array(nfft);
  const rampIm = new Float64Array(nfft);
  re.set(taps);
  for (let n = 0; n < taps.length; n += 1) rampRe[n] = n * taps[n];
  fftRadix2(re, im);
  fftRadix2(rampRe, rampIm);
  const d = new Float64Array(nfft);
  for (let i = 0; i < nfft; i += 1) {
    const power = Math.max(re[i] * re[i] + im[i] * im[i], MAG_FLOOR * MAG_FLOOR);
    d[i] = (rampRe[i] * re[i] + rampIm[i] * im[i]) / power;
  }
  return readBins(d, rate, freqsHz);
}

/**
 * The spectrum of a stream at `inputRate` after resampling to `outputRate`,
 * on the same grid (uniform, starting at 0, reaching at least half the input
 * rate). Every input frequency within the input's own band that lands on a
 * given output frequency adds its power there, so what a decimation does not
 * remove folds into the passband; the result is periodic in the output rate.
 * @param {Float64Array} levelsDb
 * @param {number[]} freqsHz
 * @param {number} inputRate
 * @param {number} outputRate
 * @returns {Float64Array}
 */
export function foldSpectrumDb(levelsDb, freqsHz, inputRate, outputRate) {
  const step = freqsHz[1] - freqsHz[0];
  // The levels are a curve sampled on the grid, and an alias rarely lands on a
  // grid point, so the reading is taken between the two neighbours it falls
  // between; the nearer of the two moves a steep part of the curve by a decibel.
  const at = (/** @type {number} */ f) => {
    const x = f / step;
    const lo = Math.floor(x);
    if (lo < 0 || lo >= levelsDb.length) return 0;
    const hi = Math.min(lo + 1, levelsDb.length - 1);
    const t = x - lo;
    return 10 ** ((levelsDb[lo] * (1 - t) + levelsDb[hi] * t) / 10);
  };
  const out = new Float64Array(freqsHz.length);
  for (let k = 0; k < freqsHz.length; k += 1) {
    const m = freqsHz[k] % outputRate;
    const g = m > outputRate / 2 ? outputRate - m : m;
    let total = 0;
    for (let a = g; a <= inputRate / 2; a += outputRate) total += at(a);
    // The reflected series is the direct one mirrored about each multiple of the
    // output rate. At DC and at half the output rate the mirror lands on the
    // series itself, and adding both counts every copy there twice.
    for (let a = outputRate - g; g > 0 && g < outputRate / 2 && a <= inputRate / 2; a += outputRate) total += at(a);
    out[k] = 10 * Math.log10(Math.max(total, MAG_FLOOR * MAG_FLOOR));
  }
  return out;
}

/** Order of the analog low-pass the primer assumes for a NOS DAC's output stage. */
const ANALOG_ORDER = 2;
/** Corner of that low-pass in Hz; unsourced, the primer's stated assumption. */
const ANALOG_CORNER_HZ = 50000;

/**
 * The DAC's analog reconstruction in dB at each frequency: a zero-order hold at
 * the output rate times a low-order analog low-pass, the two cascaded, so their
 * dB add exactly (docs/plans/filter-primer-math.md section 9).
 *
 * The hold is |sinc(f / fs_out)|, which nulls at every multiple of the output
 * rate and is 3.92 dB down at half of it; that droop is the whole reason a
 * slower output rate loses the top of its band and a faster one does not. The
 * low-pass is the same at every output rate, so it shapes the picture without
 * separating the ratios. Neither the order nor the corner of a real NOS DAC's
 * output stage is published, so both are the primer's assumption and the card
 * says so.
 * @param {number[]} freqsHz
 * @param {number} outputRateHz
 * @returns {Float64Array}
 */
export function analogStageDb(freqsHz, outputRateHz) {
  const out = new Float64Array(freqsHz.length);
  for (let k = 0; k < freqsHz.length; k += 1) {
    const f = freqsHz[k];
    const x = Math.PI * (f / outputRateHz);
    const hold = x === 0 ? 1 : Math.abs(Math.sin(x) / x);
    const lowpass = 10 * Math.log10(1 + (f / ANALOG_CORNER_HZ) ** (2 * ANALOG_ORDER));
    out[k] = 20 * Math.log10(Math.max(hold, MAG_FLOOR)) - lowpass;
  }
  return out;
}

/** Level the fake hi-res band and out-of-band queries sit at. */
const SOURCE_FLOOR_DB = -110;

/** @param {number} db */
const power = (db) => 10 ** (db / 10);

/**
 * Source music wash at the source rate, one dB value per frequency. A gently
 * falling shape below Nyquist, the floor above it. `spurs` adds discrete tones
 * above 20 kHz, `fakeHires` empties the music above 22 kHz, `risingNoise`
 * climbs from 20 kHz toward Nyquist.
 * @param {number} rate
 * @param {number[]} freqsHz
 * @param {{ spurs: boolean, fakeHires: boolean, risingNoise: boolean }} content
 * @returns {Float64Array}
 */
export function sourceSpectrumDb(rate, freqsHz, { spurs, fakeHires, risingNoise }) {
  const nyquist = rate / 2;
  const out = new Float64Array(freqsHz.length);
  for (let k = 0; k < freqsHz.length; k += 1) {
    const f = freqsHz[k];
    if (f > nyquist) {
      out[k] = SOURCE_FLOOR_DB;
      continue;
    }
    let music = -10 * Math.log10(Math.max(f, 100) / 100);
    if (fakeHires && f > 22000) music = SOURCE_FLOOR_DB;
    let total = power(music) + power(SOURCE_FLOOR_DB);
    if (spurs) {
      for (let tone = 24000; tone < nyquist; tone += 4000) {
        const d = (f - tone) / 300;
        total += power(-40) * Math.exp(-(d * d) / 2);
      }
    }
    if (risingNoise && f > 20000) {
      const climb = (f - 20000) / (nyquist - 20000);
      total += power(-90 + 60 * climb);
    }
    out[k] = 10 * Math.log10(total);
  }
  return out;
}
