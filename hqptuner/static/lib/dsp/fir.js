// --- FIR primer mathematics ----------------------------------------------------
// Textbook windowed-sinc design and the measurements the filter primer draws
// from it. Pure functions, no HQPlayer filter modelled or named. The Kaiser
// pieces reproduce scipy (`kaiser`, `kaiser_atten`, `kaiser_beta`, `firwin`,
// `minimum_phase(method="homomorphic", half=False)`) so their published
// reference values pin the transcription.

import { fftRadix2, ifftRadix2 } from "./fft.js";

/** Magnitudes below this read as the floor; keeps log10 finite on exact zeros. */
const MAG_FLOOR = 1e-10;
/** Largest FFT the cepstral conversion pads to. */
const MAX_NFFT = 1 << 16;
/** Pulse narrower than this aliases at Nyquist and reads as fake ringing. */
const MIN_SIGMA = 2;
/** Level the fake hi-res band and out-of-band queries sit at. */
const SOURCE_FLOOR_DB = -110;

// Cephes Chebyshev expansions for I0 on [0, 8] and (8, inf), as numpy `_i0A` / `_i0B`.
const I0_A = [
  -4.4153416464793395e-18, 3.3307945188222384e-17, -2.431279846547955e-16, 1.715391285555133e-15,
  -1.1685332877993451e-14, 7.676185498604936e-14, -4.856446783111929e-13, 2.95505266312964e-12, -1.726826291441556e-11,
  9.675809035373237e-11, -5.189795601635263e-10, 2.6598237246823866e-9, -1.300025009986248e-8, 6.046995022541919e-8,
  -2.670793853940612e-7, 1.1173875391201037e-6, -4.4167383584587505e-6, 1.6448448070728896e-5, -5.754195010082104e-5,
  0.00018850288509584165, -0.0005763755745385824, 0.0016394756169413357, -0.004324309995050576, 0.010546460394594998,
  -0.02373741480589947, 0.04930528423967071, -0.09490109704804764, 0.17162090152220877, -0.3046826723431984,
  0.6767952744094761,
];
const I0_B = [
  -7.233180487874754e-18, -4.830504485944182e-18, 4.46562142029676e-17, 3.461222867697461e-17, -2.8276239805165836e-16,
  -3.425485619677219e-16, 1.7725601330565263e-15, 3.8116806693526224e-15, -9.554846698828307e-15,
  -4.150569347287222e-14, 1.54008621752141e-14, 3.8527783827421426e-13, 7.180124451383666e-13, -1.7941785315068062e-12,
  -1.3215811840447713e-11, -3.1499165279632416e-11, 1.1889147107846439e-11, 4.94060238822497e-10, 3.3962320257083865e-9,
  2.266668990498178e-8, 2.0489185894690638e-7, 2.8913705208347567e-6, 6.889758346916825e-5, 0.0033691164782556943,
  0.8044904110141088,
];

/**
 * @param {number} x
 * @param {number[]} coeffs
 * @returns {number}
 */
function chbevl(x, coeffs) {
  let b0 = coeffs[0];
  let b1 = 0;
  let b2 = 0;
  for (let i = 1; i < coeffs.length; i += 1) {
    b2 = b1;
    b1 = b0;
    b0 = x * b1 - b2 + coeffs[i];
  }
  return 0.5 * (b0 - b2);
}

/**
 * Modified Bessel function of the first kind, order zero.
 * @param {number} x
 * @returns {number}
 */
function besselI0(x) {
  const ax = Math.abs(x);
  if (ax <= 8) return Math.exp(ax) * chbevl(ax / 2 - 2, I0_A);
  return (Math.exp(ax) * chbevl(32 / ax - 2, I0_B)) / Math.sqrt(ax);
}

/**
 * Symmetric Kaiser window of `n` points.
 * @param {number} n
 * @param {number} beta
 * @returns {Float64Array}
 */
export function kaiserWindow(n, beta) {
  const w = new Float64Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  const alpha = (n - 1) / 2;
  const denom = besselI0(beta);
  for (let i = 0; i < n; i += 1) {
    const r = (i - alpha) / alpha;
    w[i] = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / denom;
  }
  return w;
}

/**
 * Stopband attenuation in dB the Kaiser relation predicts for `taps` taps with a
 * transition band `widthHz` wide at sample rate `rate`.
 * @param {number} taps
 * @param {number} widthHz
 * @param {number} rate
 * @returns {number}
 */
export function kaiserAttenuation(taps, widthHz, rate) {
  const width = widthHz / (rate / 2);
  return 2.285 * (taps - 1) * Math.PI * width + 7.95;
}

/**
 * Kaiser shape parameter for a target attenuation.
 * @param {number} attenDb
 * @returns {number}
 */
function kaiserBeta(attenDb) {
  if (attenDb > 50) return 0.1102 * (attenDb - 8.7);
  if (attenDb > 21) return 0.5842 * (attenDb - 21) ** 0.4 + 0.07886 * (attenDb - 21);
  return 0;
}

/** @param {number} x */
const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/**
 * Kaiser-windowed sinc lowpass with DC gain 1. `rate` is the rate the taps run
 * at, `cutoffHz` the centre of the transition band and `widthHz` its width. An
 * even `taps` is rounded up so the centre lands on a sample.
 * @param {{ rate: number, taps: number, cutoffHz: number, widthHz: number }} spec
 * @returns {Float64Array}
 */
export function designLowpass({ rate, taps, cutoffHz, widthHz }) {
  const n = taps % 2 === 1 ? taps : taps + 1;
  const beta = kaiserBeta(kaiserAttenuation(n, widthHz, rate));
  const w = kaiserWindow(n, beta);
  const fc = cutoffHz / (rate / 2);
  const alpha = (n - 1) / 2;
  const h = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    h[i] = fc * sinc(fc * (i - alpha)) * w[i];
    sum += h[i];
  }
  for (let i = 0; i < n; i += 1) h[i] /= sum;
  return h;
}

/**
 * Minimum-phase taps with the same magnitude response, by the homomorphic
 * (real cepstrum) method. Same length as the input.
 * @param {Float64Array} taps
 * @returns {Float64Array}
 */
export function minimumPhase(taps) {
  const n = taps.length;
  const nfft = Math.min(MAX_NFFT, 1 << Math.ceil(Math.log2(Math.max(n, 200 * (n - 1)))));
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  re.set(taps);
  fftRadix2(re, im);
  let minNonzero = Infinity;
  for (let i = 0; i < nfft; i += 1) {
    re[i] = Math.hypot(re[i], im[i]);
    if (re[i] > 0 && re[i] < minNonzero) minNonzero = re[i];
  }
  const floor = 1e-7 * minNonzero;
  for (let i = 0; i < nfft; i += 1) {
    re[i] = Math.log(re[i] + floor);
    im[i] = 0;
  }
  ifftRadix2(re, im);
  const half = nfft / 2;
  for (let i = 0; i < nfft; i += 1) {
    const win = i === 0 || i === half ? 1 : i < half ? 2 : 0;
    re[i] *= win;
    im[i] = 0;
  }
  fftRadix2(re, im);
  for (let i = 0; i < nfft; i += 1) {
    const mag = Math.exp(re[i]);
    re[i] = mag * Math.cos(im[i]);
    im[i] = mag * Math.sin(im[i]);
  }
  ifftRadix2(re, im);
  return re.slice(0, n);
}

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

/**
 * Gaussian pulse of the given sigma in samples, spanning plus or minus five
 * sigma, odd length, unit peak at the centre sample. Sigma is floored so the
 * pulse holds no energy at Nyquist.
 * @param {number} sigmaSamples
 * @returns {Float64Array}
 */
export function gaussianPulse(sigmaSamples) {
  const sigma = Math.max(MIN_SIGMA, sigmaSamples);
  const half = Math.ceil(5 * sigma);
  const p = new Float64Array(2 * half + 1);
  for (let i = 0; i < p.length; i += 1) {
    const d = i - half;
    p[i] = Math.exp(-(d * d) / (2 * sigma * sigma));
  }
  return p;
}

/**
 * The pulse through the filter: the full convolution, and the index of the
 * filter's tap centroid, its group delay at DC, so the pulse's first sample
 * sits at `y[delay]` and a minimum-phase filter's front-loaded response is not
 * credited as arriving early.
 * @param {Float64Array} taps
 * @param {Float64Array} pulse
 * @returns {{ y: Float64Array, delay: number }}
 */
export function filterPulse(taps, pulse) {
  const y = new Float64Array(taps.length + pulse.length - 1);
  let moment = 0;
  let mass = 0;
  for (let i = 0; i < taps.length; i += 1) {
    moment += i * taps[i];
    mass += taps[i];
    for (let j = 0; j < pulse.length; j += 1) y[i + j] += taps[i] * pulse[j];
  }
  return { y, delay: Math.round(moment / mass) };
}

/**
 * Peak of what the filter added outside the pulse's own extent, before and
 * after its centre, in dB relative to the pulse peak. The output is aligned on
 * the filter's tap centroid, its group delay at DC, so a minimum-phase filter's
 * front-loaded response is not credited as arriving early.
 * @param {Float64Array} taps
 * @param {Float64Array} pulse
 * @returns {{ beforeDb: number, afterDb: number }}
 */
export function ringing(taps, pulse) {
  const { y, delay } = filterPulse(taps, pulse);
  let peak = 0;
  for (let j = 0; j < pulse.length; j += 1) peak = Math.max(peak, Math.abs(pulse[j]));
  let before = 0;
  let after = 0;
  for (let k = 0; k < y.length; k += 1) {
    const t = k - delay;
    if (t < 0) before = Math.max(before, Math.abs(y[k]));
    else if (t >= pulse.length) after = Math.max(after, Math.abs(y[k]));
  }
  const db = (/** @type {number} */ v) => 20 * Math.log10(Math.max(v / peak, MAG_FLOOR));
  return { beforeDb: db(before), afterDb: db(after) };
}

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
