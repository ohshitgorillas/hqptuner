// Pure DSP math for the post-processing response plots. No daemon round-trip —
// every curve here is recomputed client-side on each knob move so dragging feels
// instantaneous.
//
// The loudness bands use exact RBJ "Audio EQ Cookbook" biquad coefficients
// (Robert Bristow-Johnson), matching HQPlayer's own shelving/peaking filters —
// no approximation (validated against /matrix/plot). The digital biquad's shape
// near the corner depends on the sample rate (bilinear warping), so `fs` is an
// explicit argument; the plots pass the active output rate.
//
// The Bauer crossfeed feed path is a deliberate first-order MODEL (not the exact
// bs2b filter): a low-pass whose DC level is the feed level and whose corner is
// the cross-over frequency — enough to show the frequency/level interaction.

const TAU = 2 * Math.PI;
const LN2_2 = Math.LN2 / 2;

// --- RBJ biquad coefficients, normalized by a0 -> {b0, b1, b2, a1, a2} --------

function lowShelf(f0, dbGain, slope, fs) {
  const A = 10 ** (dbGain / 40);
  const w0 = (TAU * f0) / fs;
  const cw = Math.cos(w0);
  const alpha = (Math.sin(w0) / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
  const twoSqrtAalpha = 2 * Math.sqrt(A) * alpha;
  const a0 = A + 1 + (A - 1) * cw + twoSqrtAalpha;
  return {
    b0: (A * (A + 1 - (A - 1) * cw + twoSqrtAalpha)) / a0,
    b1: (2 * A * (A - 1 - (A + 1) * cw)) / a0,
    b2: (A * (A + 1 - (A - 1) * cw - twoSqrtAalpha)) / a0,
    a1: (-2 * (A - 1 + (A + 1) * cw)) / a0,
    a2: (A + 1 + (A - 1) * cw - twoSqrtAalpha) / a0,
  };
}

function highShelf(f0, dbGain, slope, fs) {
  const A = 10 ** (dbGain / 40);
  const w0 = (TAU * f0) / fs;
  const cw = Math.cos(w0);
  const alpha = (Math.sin(w0) / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
  const twoSqrtAalpha = 2 * Math.sqrt(A) * alpha;
  const a0 = A + 1 - (A - 1) * cw + twoSqrtAalpha;
  return {
    b0: (A * (A + 1 + (A - 1) * cw + twoSqrtAalpha)) / a0,
    b1: (-2 * A * (A - 1 + (A + 1) * cw)) / a0,
    b2: (A * (A + 1 + (A - 1) * cw - twoSqrtAalpha)) / a0,
    a1: (2 * (A - 1 - (A + 1) * cw)) / a0,
    a2: (A + 1 - (A - 1) * cw - twoSqrtAalpha) / a0,
  };
}

// `shape` is Q when useQ, else bandwidth in octaves (the form's "peak" vs "peakq").
function peaking(f0, dbGain, shape, fs, useQ) {
  const A = 10 ** (dbGain / 40);
  const w0 = (TAU * f0) / fs;
  const sw = Math.sin(w0);
  const alpha = useQ ? sw / (2 * shape) : sw * Math.sinh((LN2_2 * shape * w0) / sw);
  const a0 = 1 + alpha / A;
  return {
    b0: (1 + alpha * A) / a0,
    b1: (-2 * Math.cos(w0)) / a0,
    b2: (1 - alpha * A) / a0,
    a1: (-2 * Math.cos(w0)) / a0,
    a2: (1 - alpha / A) / a0,
  };
}

// One loudness band -> coefficients, dispatched by the form's `type` value.
// Steepness/Q is the shelf slope S for shelves, bandwidth for peak, Q for peakq.
export function bandCoeffs(type, f0, dbGain, shape, fs) {
  if (type === "hshelf") return highShelf(f0, dbGain, shape, fs);
  if (type === "peak") return peaking(f0, dbGain, shape, fs, false);
  if (type === "peakq") return peaking(f0, dbGain, shape, fs, true);
  return lowShelf(f0, dbGain, shape, fs); // lshelf (default)
}

// Magnitude in dB of a normalized biquad (a0 = 1) at frequency f.
export function biquadMagDb(c, f, fs) {
  const w = (TAU * f) / fs;
  const cw = Math.cos(w);
  const c2w = Math.cos(2 * w);
  const sw = Math.sin(w);
  const s2w = Math.sin(2 * w);
  const numRe = c.b0 + c.b1 * cw + c.b2 * c2w;
  const numIm = -(c.b1 * sw + c.b2 * s2w);
  const denRe = 1 + c.a1 * cw + c.a2 * c2w;
  const denIm = -(c.a1 * sw + c.a2 * s2w);
  const mag2 = (numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm);
  return 10 * Math.log10(mag2);
}

// Combined bass + treble magnitude in dB at f, each band's gain scaled by
// `scale` (0..1) — the volume-adaptive shelving fraction.
export function loudnessMagDb(p, f, fs, scale) {
  const bass = bandCoeffs(p.lowType, p.lowFreq, p.lowLevel * scale, p.lowSteep, fs);
  const treble = bandCoeffs(p.highType, p.highFreq, p.highLevel * scale, p.highSteep, fs);
  return biquadMagDb(bass, f, fs) + biquadMagDb(treble, f, fs);
}

// Volume -> shelving fraction: full (1) at/below the lower bound, none (0) at/
// above the upper bound, linearly interpolated between. This is the loudness
// compensation curve — more shelving the quieter you listen.
export function shelfScale(volume, rangeLow, rangeHigh) {
  if (rangeHigh <= rangeLow) return volume <= rangeLow ? 1 : 0;
  return Math.max(0, Math.min(1, (rangeHigh - volume) / (rangeHigh - rangeLow)));
}

// First-order Bauer-crossfeed feed-path model: the cross-fed (opposite-channel)
// signal sits `levelDb` below the direct path at DC and rolls off first-order
// above the cross-over frequency `fc`. The direct path is flat 0 dB.
export function crossfeedMagDb(f, fc, levelDb) {
  return -Math.abs(levelDb) - 10 * Math.log10(1 + (f / fc) ** 2);
}

// Logarithmically-spaced frequency points across [f0, f1] for a plot trace.
export function logFreqs(f0, f1, n) {
  const out = new Array(n);
  const k = Math.log(f1 / f0) / (n - 1);
  for (let i = 0; i < n; i += 1) out[i] = f0 * Math.exp(k * i);
  return out;
}
