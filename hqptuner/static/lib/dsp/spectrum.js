// --- Primer spectrum readings ---------------------------------------------------
// The frequency-domain readings the filter primer draws: magnitude, group
// delay, the alias fold and the source wash. Pure functions.

import { fftRadix2 } from "./fft.js";

/** Magnitudes below this read as the floor; keeps log10 finite on exact zeros. */
const MAG_FLOOR = 1e-10;
/** Smallest FFT the magnitude reading is taken on; finer than any drawn grid. */
const MIN_NFFT = 1 << 14;

/**
 * The FFT size a reading of `taps` is taken on: at least MIN_NFFT, and at
 * least twice the filter so the taps sit in the first half.
 * @param {Float64Array} taps
 * @returns {number}
 */
const readSize = (taps) => Math.max(MIN_NFFT, 1 << Math.ceil(Math.log2(2 * taps.length)));

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
  const nfft = readSize(taps);
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
  const nfft = readSize(taps);
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
  const at = (/** @type {number} */ f) => {
    const i = Math.round(f / step);
    return i < levelsDb.length ? 10 ** (levelsDb[i] / 10) : 0;
  };
  const out = new Float64Array(freqsHz.length);
  for (let k = 0; k < freqsHz.length; k += 1) {
    const m = freqsHz[k] % outputRate;
    const g = m > outputRate / 2 ? outputRate - m : m;
    let total = 0;
    for (let a = g; a <= inputRate / 2; a += outputRate) total += at(a);
    for (let a = outputRate - g; a <= inputRate / 2; a += outputRate) total += at(a);
    out[k] = 10 * Math.log10(Math.max(total, MAG_FLOOR * MAG_FLOOR));
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
