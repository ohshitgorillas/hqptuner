// --- FIR primer mathematics ----------------------------------------------------
// Textbook windowed-sinc design and the measurements the filter primer draws
// from it. Pure functions, no HQPlayer filter modelled or named. The Kaiser
// pieces reproduce scipy (`kaiser`, `kaiser_atten`, `kaiser_beta`, `firwin`,
// `minimum_phase(method="homomorphic", half=False)`) so their published
// reference values pin the transcription.

import { TAU } from "./biquad.js";
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

/**
 * Magnitude response in dB at each requested frequency.
 * @param {Float64Array} taps
 * @param {number} rate
 * @param {number[]} freqsHz
 * @returns {Float64Array}
 */
export function magnitudeDb(taps, rate, freqsHz) {
  const out = new Float64Array(freqsHz.length);
  for (let k = 0; k < freqsHz.length; k += 1) {
    const w = (TAU * freqsHz[k]) / rate;
    let re = 0;
    let im = 0;
    for (let i = 0; i < taps.length; i += 1) {
      re += taps[i] * Math.cos(w * i);
      im -= taps[i] * Math.sin(w * i);
    }
    out[k] = 20 * Math.log10(Math.max(Math.hypot(re, im), MAG_FLOOR));
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
 * Peak of what the filter added outside the pulse's own extent, before and
 * after its centre, in dB relative to the pulse peak. The output is aligned on
 * the filter's tap centroid, its group delay at DC, so a minimum-phase filter's
 * front-loaded response is not credited as arriving early.
 * @param {Float64Array} taps
 * @param {Float64Array} pulse
 * @returns {{ beforeDb: number, afterDb: number }}
 */
export function ringing(taps, pulse) {
  const y = new Float64Array(taps.length + pulse.length - 1);
  let moment = 0;
  let mass = 0;
  for (let i = 0; i < taps.length; i += 1) {
    moment += i * taps[i];
    mass += taps[i];
    for (let j = 0; j < pulse.length; j += 1) y[i + j] += taps[i] * pulse[j];
  }
  const delay = Math.round(moment / mass);
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
