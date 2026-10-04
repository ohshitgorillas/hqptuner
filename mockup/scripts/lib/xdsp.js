// Response maths for the Crossfeed and Loudness plots. Shapes only, client-side (Embedded has no daemon plot: v1
// matrix-spec "Probe findings — /matrix/plot"). Sources:
//   Bauer   = libbs2b (HQPlayer's bauer post-process; v1 docs/matrix-spec.md "Model"): first-order lowpass on the cross
//             path, first-order high-boost on the direct path, normalized; M/S diagonalizes it exactly.
//   Structural = Brown & Duda head-shadow filter + Woodworth ITD (v1 docs/crossfeed-math.md §2, §3, §6.1).
//   Loudness = RBJ cookbook biquads (the daemon's iir is RBJ, measured: matrix-spec "numeric oracle"), at 48 kHz like v1.

const C = 343;   // m/s, the constant the Brown & Duda fit travels with (crossfeed-math §2)

// Complex helpers: [re, im].
/** @typedef {(a: number[], b: number[]) => number[]} CxOp */
/** @type {CxOp} */
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
/** @type {CxOp} */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
/** @type {CxOp} */
const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
/** @type {CxOp} */
const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
/** @type {(a: number[], k: number) => number[]} */
const sc = (a, k) => [a[0] * k, a[1] * k];
/** @type {(a: number[]) => number} */
const mag = (a) => Math.hypot(a[0], a[1]);
/** @type {(m: number) => number} */
export const toDb = (m) => 20 * Math.log10(Math.max(m, 1e-9));

/** Bauer presets (bs2b constants; v1 matrix-spec "Model"). Custom uses the form's frequency + level. */
export const BAUER_PRESETS = { default: [700, 4.5], cmoy: [700, 6.0], jmeier: [650, 9.5] };

/**
 * bs2b mid/side magnitudes at f for (fc Hz, feed dB).
 *
 * @param {number} fc
 * @param {number} feed
 * @param {number} f
 */
export function bauerMS(fc, feed, f) {
  const GBlo = -5 * feed / 6 - 3, GBhi = feed / 6 - 3;
  const Glo = 10 ** (GBlo / 20), Ghi = 1 - 10 ** (GBhi / 20);
  const Fchi = fc * 2 ** ((GBlo - 20 * Math.log10(Ghi)) / 12);
  const norm = 1 / (1 - Ghi + Glo);
  const lo = div([Glo, 0], [1, f / fc]);                        // cross path
  const hi = sub([1, 0], div([Ghi, 0], [1, f / Fchi]));         // direct path: DC 1−Ghi, HF 1
  return { mid: mag(sc(add(hi, lo), norm)), side: mag(sc(sub(hi, lo), norm)) };
}

/**
 * Brown & Duda for a ±angle speaker pair and head radius a (m): near/far α, ray ITD, shadow corner.
 *
 * @param {number} angle
 * @param {number} a
 */
export function pathParams(angle, a) {
  /** @param {number} th */
  const alpha = (th) => 1.05 + 0.95 * Math.cos((th / 150) * Math.PI);   // eq. (5), α_min 0.1, θ_min 150°
  /** @param {number} d */
  const rad = (d) => d * Math.PI / 180;
  const thN = 90 - angle, thF = 90 + angle;
  const dtN = -(a / C) * Math.cos(rad(thN));                             // eq. (2), 0 ≤ θ < 90°
  const dtF = (a / C) * (rad(thF) - Math.PI / 2);                        // eq. (2), 90° ≤ θ < 180°
  const an = alpha(thN), af = alpha(thF), w0 = C / a;
  // Head-shadow group delay T_g = (1 − α)/(2ω₀) (crossfeed-math §3): what supplies the low-frequency ITD excess.
  return { an, af, itd: dtF - dtN, w0, gdN: (1 - an) / (2 * w0), gdF: (1 - af) / (2 * w0) };
}

/**
 * Structural mid/side magnitudes at f; λ = center character (0 neutral … 1 as speakers).
 *
 * @param {number} f
 * @param {number} angle
 * @param {number} a
 * @param {number} lambda
 */
export function structuralMS(f, angle, a, lambda) {
  const p = pathParams(angle, a);
  const w = 2 * Math.PI * f;
  const P = div([1, 0], [1, w / (2 * p.w0)]);                            // the lp1 (pole at µ = 2)
  const D = [Math.cos(w * p.itd), -Math.sin(w * p.itd)];                 // far-ear delay
  const Hn = add([p.an, 0], sc(P, 1 - p.an));
  const Hf = mul(D, add([p.af, 0], sc(P, 1 - p.af)));
  const mid = add(sc(add(Hn, Hf), lambda / 2), [1 - lambda, 0]);
  const side = sc(sub(Hn, Hf), 0.5);
  return { mid: mag(mid), side: mag(side) };
}

// ── Loudness ────────────────────────────────────────────────────────────────
const FS = 48000;

/**
 * RBJ biquad magnitude (dB) at f. type lshelf|hshelf (k = slope), peak (k = bw, octaves), peakq (k = Q); k floors at
 * 0.05. The corner is taken as given, unclamped.
 *
 * @param {string} type
 * @param {number} f0
 * @param {number} g
 * @param {number} k
 * @param {number} f
 */
function biquadDb(type, f0, g, k, f) {
  const c = Math.max(k, 0.05);
  const st = type === 'peak' ? { type, bw: c } : type === 'peakq' ? { type: 'peak', q: c } : { type, s: c };
  const [b, a] = iirCoef(st, FS, f0, g);
  const [num, den] = numDen(b, a, 2 * Math.PI * f / FS);
  return toDb(mag(num) / mag(den));
}

/** @typedef {{ type: string, freq: number, steep: number, level: number }} LoudnessBand */

/**
 * Loudness curve (dB) at f, levels scaled by `amount` (0…1).
 *
 * @param {{ low: LoudnessBand, high: LoudnessBand }} p
 * @param {number} f
 * @param {number} amount
 */
export function loudnessDb(p, f, amount) {
  return biquadDb(p.low.type, p.low.freq, p.low.level * amount, p.low.steep, f)
    + biquadDb(p.high.type, p.high.freq, p.high.level * amount, p.high.steep, f);
}

/**
 * v1 eqlab shelfScale: full at/below the lower bound, none at/above the upper, linear between.
 *
 * @param {number} v
 * @param {number} low
 * @param {number} high
 */
export function shelfScale(v, low, high) {
  if (high <= low) return v <= low ? 1 : 0;
  return Math.max(0, Math.min(1, (high - v) / (high - low)));
}

// ── Pipelines ───────────────────────────────────────────────────────────────
// Complex response of one pipeline (process chain × gain) at its source rate, for the DSP pipelines plot. iir = RBJ
// cookbook (the daemon's, measured: matrix-spec "numeric oracle"); lp1/hp1 = bilinear first order; delay = linear phase;
// riaa and convolution are not modelled (flat; the plot says so).

/**
 * One process stage as the pipeline carries it; numeric fields may arrive as text.
 *
 * @typedef {object} Stage
 * @property {string} [kind]  iir | delay | riaa | conv
 * @property {string} [type]  the iir type
 * @property {number | string} [f]
 * @property {number | string} [g]
 * @property {number | string} [q]
 * @property {number | string} [s]   shelf slope, or delay in samples
 * @property {number | string} [bw]
 * @property {number | string} [b0]
 * @property {number | string} [b1]
 * @property {number | string} [b2]
 * @property {number | string} [a0]
 * @property {number | string} [a1]
 * @property {number | string} [a2]
 * @property {number | string} [t]   delay, s
 * @property {number | string} [d]   delay, m
 * @property {number | string} [v]   speed of sound for d, m/s
 */

/**
 * Numerator and denominator of b(z)/a(z) at z = e^{jw}, w in rad/sample; a missing second-order term counts as 0.
 *
 * @param {number[]} b
 * @param {number[]} a
 * @param {number} w
 */
function numDen(b, a, w) {
  const z1 = [Math.cos(w), -Math.sin(w)], z2 = [Math.cos(2 * w), -Math.sin(2 * w)];
  const num = add(add([b[0], 0], sc(z1, b[1])), sc(z2, b[2] ?? 0));
  const den = add(add([a[0], 0], sc(z1, a[1])), sc(z2, a[2] ?? 0));
  return [num, den];
}

/**
 * Coefficients [b, a] for one iir stage at fs, corner f0 Hz and gain g dB (the stage's own f and g are not read).
 *
 * @param {Stage} st
 * @param {number} fs
 * @param {number} f0
 * @param {number} g
 * @returns {[number[], number[]]}
 */
function iirCoef(st, fs, f0, g) {
  const t = st.type;
  if (t === 'biquad') return [[Number(st.b0), Number(st.b1), Number(st.b2)], [Number(st.a0), Number(st.a1), Number(st.a2)]];
  const w0 = 2 * Math.PI * f0 / fs, cw = Math.cos(w0), sw = Math.sin(w0);
  if (t === 'lp1' || t === 'hp1') {
    const K = Math.tan(w0 / 2);
    return t === 'lp1' ? [[K / (K + 1), K / (K + 1)], [1, (K - 1) / (K + 1)]] : [[1 / (K + 1), -1 / (K + 1)], [1, (K - 1) / (K + 1)]];
  }
  const A = 10 ** (g / 40);
  let al;
  if (st.bw !== undefined) al = sw * Math.sinh(Math.LN2 / 2 * Math.max(+st.bw, 0.01) * w0 / sw);
  else if (st.s !== undefined && (t === 'lshelf' || t === 'hshelf')) {
    const S = Math.min(Math.max(+st.s, 0.05), 1);
    al = sw / 2 * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
  } else al = sw / (2 * Math.max(+(st.q ?? st.s ?? 0.707), 0.05));
  const q2 = 2 * Math.sqrt(A) * al;
  switch (t) {
    case 'lp': return [[(1 - cw) / 2, 1 - cw, (1 - cw) / 2], [1 + al, -2 * cw, 1 - al]];
    case 'hp': return [[(1 + cw) / 2, -(1 + cw), (1 + cw) / 2], [1 + al, -2 * cw, 1 - al]];
    case 'bp': return [[al, 0, -al], [1 + al, -2 * cw, 1 - al]];
    case 'ap': return [[1 - al, -2 * cw, 1 + al], [1 + al, -2 * cw, 1 - al]];
    case 'notch': return [[1, -2 * cw, 1], [1 + al, -2 * cw, 1 - al]];
    case 'peak': return [[1 + al * A, -2 * cw, 1 - al * A], [1 + al / A, -2 * cw, 1 - al / A]];
    case 'lshelf': return [[A * ((A + 1) - (A - 1) * cw + q2), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - q2)],
      [(A + 1) + (A - 1) * cw + q2, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - q2]];
    case 'hshelf': return [[A * ((A + 1) + (A - 1) * cw + q2), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - q2)],
      [(A + 1) - (A - 1) * cw + q2, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - q2]];
  }
  return [[1], [1]];
}

/**
 * A pipeline's gain as a linear factor: dB converted, Lin as given (negative = polarity).
 *
 * @param {{ unit?: string, gain: number | string }} p
 */
export const gainLin = (p) => (p.unit === 'Lin' ? +p.gain : 10 ** (+p.gain / 20));

/**
 * Complex H(f) of one pipeline: its stages in order, then its gain. An iir stage's corner is its f (1 kHz when unset,
 * clamped below Nyquist), its gain its g (0 when unset).
 *
 * @param {{ stages: Stage[], unit?: string, gain: number | string }} p
 * @param {number} f
 * @param {number} fs
 * @returns {number[]}
 */
export function pipeH(p, f, fs) {
  let H = [1, 0];
  const w = 2 * Math.PI * f / fs;
  for (const st of p.stages) {
    if (st.kind === 'iir') {
      const [b, a] = iirCoef(st, fs, Math.min(Number(st.f) || 1000, fs * 0.499), Number(st.g) || 0);
      const [num, den] = numDen(b, a, w);
      H = mul(H, div(num, den));
    } else if (st.kind === 'delay') {
      const t = st.t !== undefined ? +st.t : st.s !== undefined ? +st.s / fs : st.d !== undefined ? +st.d / (Number(st.v) || 343.956) : 0;
      H = mul(H, [Math.cos(2 * Math.PI * f * t), -Math.sin(2 * Math.PI * f * t)]);
    }
  }
  return sc(H, gainLin(p));
}
export const cplx = { add, mag };
