// Pure DSP math for the post-processing response plots. No daemon round-trip —
// every curve here is recomputed client-side on each knob move so dragging feels
// instantaneous.
//
// The loudness bands use exact RBJ "Audio EQ Cookbook" biquad coefficients
// (Robert Bristow-Johnson), matching HQPlayer's own shelving/peaking filters —
// no approximation. Measured against the daemon 2026-07-22 (matrix-spec.md probe
// round 3): six chains through /matrix/plot fit this math at 0.019 dB RMS with
// `q` read as RBJ Q — vs 2.66 dB reading it as bandwidth, 0.18 dB as shelf slope.
// The digital biquad's shape near the corner depends on the sample rate
// (bilinear warping), so `fs` is an explicit argument; the plots pass the active
// output rate. Caveat: the daemon's plot lane evaluates at a fixed ~96-99 kHz,
// so it grounds the coefficients but NOT the warping at the running source rate.
//
// The Bauer crossfeed feed path is a deliberate first-order MODEL (not the exact
// bs2b filter): a low-pass whose DC level is the feed level and whose corner is
// the cross-over frequency — enough to show the frequency/level interaction.

const TAU = 2 * Math.PI;
const LN2_2 = Math.LN2 / 2;

// --- loudness bands ----------------------------------------------------------
// The coefficient builders live in the matrix-pipeline section below: a loudness
// band and an iir stage are the same RBJ algebra, so they share one copy of it
// (function declarations hoist, hence the forward reference).

// One loudness band -> coefficients, dispatched by the form's `type` value.
// Steepness/Q is the shelf slope S for shelves, bandwidth for peak, Q for peakq
// — exactly the three shape parameters rbjAlpha already dispatches on.
function bandCoeffs(type, f0, dbGain, shape, fs) {
  const w0 = (TAU * f0) / fs;
  const A = 10 ** (dbGain / 40);
  if (type === "peak") return peakBiquad(w0, rbjAlpha(w0, { bw: shape }), A);
  if (type === "peakq") return peakBiquad(w0, rbjAlpha(w0, { q: shape }), A);
  const shelf = type === "hshelf" ? "hshelf" : "lshelf"; // lshelf is the default
  return shelfFromAlpha(shelf, f0, dbGain, rbjAlpha(w0, { s: shape }, A), fs);
}

// Magnitude in dB of a normalized biquad (a0 = 1) at frequency f.
function biquadMagDb(c, f, fs) {
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
function logFreqs(f0, f1, n) {
  const out = new Array(n);
  const k = Math.log(f1 / f0) / (n - 1);
  for (let i = 0; i < n; i += 1) out[i] = f0 * Math.exp(k * i);
  return out;
}

// The audio band every response plot spans. Its endpoints double as the plot
// x-domain (components/plots.js), so they live here instead of being retyped at
// each of the nine call sites `bandFreqs` replaced.
export const F0 = 20;
export const F1 = 20000;
export const bandFreqs = (n) => logFreqs(F0, F1, n);

// --- matrix pipeline stage responses (matrix-spec step 7) --------------------
// Same RBJ cookbook discipline as the loudness bands: exact coefficients, no
// approximation. A pipeline chain's response is the per-stage sum (dB / deg).

const DEG = 180 / Math.PI;

// Phase in degrees of a normalized biquad at f (same transfer function as
// biquadMagDb, atan2 instead of magnitude; wrapped to ±180 by construction).
function biquadPhaseDeg(c, f, fs) {
  const w = (TAU * f) / fs;
  const cw = Math.cos(w);
  const c2w = Math.cos(2 * w);
  const sw = Math.sin(w);
  const s2w = Math.sin(2 * w);
  const numRe = c.b0 + c.b1 * cw + c.b2 * c2w;
  const numIm = -(c.b1 * sw + c.b2 * s2w);
  const denRe = 1 + c.a1 * cw + c.a2 * c2w;
  const denIm = -(c.a1 * sw + c.a2 * s2w);
  return (Math.atan2(numIm, numRe) - Math.atan2(denIm, denRe)) * DEG;
}

// RBJ alpha from whichever shape parameter the iir spec carries: q, bandwidth
// (octaves), or shelf slope S (shelves only; A is the shelf amplitude). The
// manual allows s on lp/hp too — approximated at Butterworth there (flagged).
function rbjAlpha(w0, args, A = 1) {
  const sw = Math.sin(w0);
  if (args.q !== undefined) return sw / (2 * Number(args.q));
  if (args.bw !== undefined) return sw * Math.sinh((LN2_2 * Number(args.bw) * w0) / sw);
  if (args.s !== undefined) return (sw / 2) * Math.sqrt((A + 1 / A) * (1 / Number(args.s) - 1) + 2);
  return sw / (2 * 0.7071); // unspecified — Butterworth
}

function firstOrder(type, f0, fs) {
  const K = Math.tan((Math.PI * f0) / fs);
  const a0 = 1 + K;
  if (type === "lp1") return { b0: K / a0, b1: K / a0, b2: 0, a1: (K - 1) / a0, a2: 0 };
  return { b0: 1 / a0, b1: -1 / a0, b2: 0, a1: (K - 1) / a0, a2: 0 }; // hp1
}

// RBJ shelf coefficients from an explicit alpha (q- or slope-shaped alike).
function shelfFromAlpha(type, f0, dbGain, alpha, fs) {
  const A = 10 ** (dbGain / 40);
  const cw = Math.cos((TAU * f0) / fs);
  const t = 2 * Math.sqrt(A) * alpha;
  if (type === "lshelf") {
    const a0 = A + 1 + (A - 1) * cw + t;
    return {
      b0: (A * (A + 1 - (A - 1) * cw + t)) / a0,
      b1: (2 * A * (A - 1 - (A + 1) * cw)) / a0,
      b2: (A * (A + 1 - (A - 1) * cw - t)) / a0,
      a1: (-2 * (A - 1 + (A + 1) * cw)) / a0,
      a2: (A + 1 + (A - 1) * cw - t) / a0,
    };
  }
  const a0 = A + 1 - (A - 1) * cw + t;
  return {
    b0: (A * (A + 1 + (A - 1) * cw + t)) / a0,
    b1: (-2 * A * (A - 1 + (A + 1) * cw)) / a0,
    b2: (A * (A + 1 + (A - 1) * cw - t)) / a0,
    a1: (2 * (A - 1 - (A + 1) * cw)) / a0,
    a2: (A + 1 - (A - 1) * cw - t) / a0,
  };
}

// RBJ lp/hp/bp(0 dB peak)/notch/ap from an explicit alpha.
function plainBiquad(type, w0, alpha) {
  const cw = Math.cos(w0);
  const a0 = 1 + alpha;
  const a1 = (-2 * cw) / a0;
  const a2 = (1 - alpha) / a0;
  if (type === "lp") return { b0: (1 - cw) / 2 / a0, b1: (1 - cw) / a0, b2: (1 - cw) / 2 / a0, a1, a2 };
  if (type === "hp") return { b0: (1 + cw) / 2 / a0, b1: -(1 + cw) / a0, b2: (1 + cw) / 2 / a0, a1, a2 };
  if (type === "bp") return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1, a2 };
  if (type === "notch") return { b0: 1 / a0, b1: (-2 * cw) / a0, b2: 1 / a0, a1, a2 };
  return { b0: (1 - alpha) / a0, b1: (-2 * cw) / a0, b2: (1 + alpha) / a0, a1, a2 }; // ap
}

// User-supplied raw coefficients, normalized by a0 (absent a0 = 1, never 0).
function rawBiquad(args) {
  const a0 = Number(args.a0 ?? 1) || 1;
  return {
    b0: Number(args.b0 ?? 0) / a0,
    b1: Number(args.b1 ?? 0) / a0,
    b2: Number(args.b2 ?? 0) / a0,
    a1: Number(args.a1 ?? 0) / a0,
    a2: Number(args.a2 ?? 0) / a0,
  };
}

function peakBiquad(w0, alpha, A) {
  const a0 = 1 + alpha / A;
  return {
    b0: (1 + alpha * A) / a0,
    b1: (-2 * Math.cos(w0)) / a0,
    b2: (1 - alpha * A) / a0,
    a1: (-2 * Math.cos(w0)) / a0,
    a2: (1 - alpha / A) / a0,
  };
}

// Everything a second-order builder needs, derived once from the stage args.
function iirContext(args, f0, fs) {
  const g = Number(args.g ?? 0);
  const w0 = (TAU * f0) / fs;
  return { args, f0, fs, g, w0, A: 10 ** (g / 40) };
}

// Second-order types, dispatched by name. Shelves carry the gain into their
// own alpha (A); the plain pass/reject types take A = 1 — they have no gain.
const SECOND_ORDER = {
  peak: (c) => peakBiquad(c.w0, rbjAlpha(c.w0, c.args, c.A), c.A),
  lshelf: (c) => shelfFromAlpha("lshelf", c.f0, c.g, rbjAlpha(c.w0, c.args, c.A), c.fs),
  hshelf: (c) => shelfFromAlpha("hshelf", c.f0, c.g, rbjAlpha(c.w0, c.args, c.A), c.fs),
  lp: (c) => plainBiquad("lp", c.w0, rbjAlpha(c.w0, c.args, 1)),
  hp: (c) => plainBiquad("hp", c.w0, rbjAlpha(c.w0, c.args, 1)),
  bp: (c) => plainBiquad("bp", c.w0, rbjAlpha(c.w0, c.args, 1)),
  notch: (c) => plainBiquad("notch", c.w0, rbjAlpha(c.w0, c.args, 1)),
  ap: (c) => plainBiquad("ap", c.w0, rbjAlpha(c.w0, c.args, 1)),
};

const FIRST_ORDER = new Set(["lp1", "hp1"]);

// One iir-plugin stage -> normalized biquad coefficients (null = unplottable).
function iirStageCoeffs(args, fs) {
  const type = args.type;
  if (type === "biquad") return rawBiquad(args);
  const f0 = Number(args.f);
  if (!Number.isFinite(f0) || f0 <= 0 || f0 >= fs / 2) return null;
  if (FIRST_ORDER.has(type)) return firstOrder(type, f0, fs);
  const build = SECOND_ORDER[type];
  return build ? build(iirContext(args, f0, fs)) : null;
}

// --- non-IIR stages ----------------------------------------------------------

const SPEED_OF_SOUND = 343.956;

function delaySeconds(args, fs) {
  if (args.t !== undefined) return Number(args.t);
  if (args.s !== undefined) return Number(args.s) / fs;
  if (args.d !== undefined) return Number(args.d) / (Number(args.v) || SPEED_OF_SOUND);
  return 0;
}

const wrapDeg = (x) => (((x % 360) + 540) % 360) - 180;

// RIAA de-emphasis: zero at 318 µs, poles at 3180 µs and 75 µs, normalized to
// 0 dB at 1 kHz; optional first-order 20 Hz subsonic pole.
function riaaRaw(f) {
  const w = TAU * f;
  const db =
    20 * Math.log10(Math.hypot(1, w * 318e-6)) -
    20 * Math.log10(Math.hypot(1, w * 3180e-6)) -
    20 * Math.log10(Math.hypot(1, w * 75e-6));
  const deg = (Math.atan2(w * 318e-6, 1) - Math.atan2(w * 3180e-6, 1) - Math.atan2(w * 75e-6, 1)) * DEG;
  return { db, deg };
}
const RIAA_REF_DB = riaaRaw(1000).db;

function riaaResponse(f, subsonic) {
  const r = riaaRaw(f);
  let db = r.db - RIAA_REF_DB;
  let deg = r.deg;
  if (subsonic) {
    const w = TAU * f;
    const w0 = TAU * 20;
    db += 20 * Math.log10(w / Math.hypot(w, w0));
    deg += (Math.PI / 2 - Math.atan2(w, w0)) * DEG;
  }
  return { db, deg: wrapDeg(deg) };
}

// --- convolution preview (client FFT of a session-uploaded IR) ---------------

const IR_GRID = bandFreqs(256);
const irCache = new Map(); // daemon path -> {freqs, dbs, degs} | null while unpreviewable

function fftRadix2(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-TAU / len) * 1;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j += 1) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// Walk the RIFF chunk list for the two chunks we need. Odd-sized chunks carry a
// pad byte, hence the `size & 1`.
function riffChunks(v) {
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= v.byteLength) {
    const id = v.getUint32(off, false);
    const size = v.getUint32(off + 4, true);
    if (id === 0x666d7420) fmt = { at: off + 8 };
    if (id === 0x64617461) data = { at: off + 8, size };
    off += 8 + size + (size & 1);
  }
  return { fmt, data };
}

// One frame's first channel, scaled to [-1, 1). null = a width we don't decode.
function readSample(v, at, bits, audioFormat) {
  if (audioFormat === 3 && bits === 32) return v.getFloat32(at, true);
  if (bits === 16) return v.getInt16(at, true) / 32768;
  if (bits === 24) {
    const raw = v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getUint8(at + 2) << 16);
    return (raw >= 0x800000 ? raw - 0x1000000 : raw) / 8388608;
  }
  if (bits === 32) return v.getInt32(at, true) / 2147483648;
  return null;
}

// Minimal WAV reader: PCM16 / PCM24 / PCM32 / float32, first channel only.
function wavSamples(buf) {
  const v = new DataView(buf);
  if (v.getUint32(0, false) !== 0x52494646 || v.getUint32(8, false) !== 0x57415645) return null;
  const { fmt, data } = riffChunks(v);
  if (!fmt || !data) return null;
  const audioFormat = v.getUint16(fmt.at, true);
  const channels = v.getUint16(fmt.at + 2, true);
  const rate = v.getUint32(fmt.at + 4, true);
  const bits = v.getUint16(fmt.at + 14, true);
  const frame = (bits / 8) * channels;
  const n = Math.floor(data.size / frame);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const s = readSample(v, data.at + i * frame, bits, audioFormat);
    if (s === null) return null;
    out[i] = s;
  }
  return { rate, samples: out };
}

// Register a just-uploaded IR so conv stages referencing `path` can plot.
// Truncates/zero-pads to <=65536 points; response sampled onto the log grid.
export function registerIr(path, arrayBuffer) {
  const wav = wavSamples(arrayBuffer);
  if (!wav) {
    irCache.set(path, null);
    return;
  }
  let n = 1;
  while (n < wav.samples.length && n < 65536) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(wav.samples.subarray(0, n));
  fftRadix2(re, im);
  const dbs = new Array(IR_GRID.length);
  const degs = new Array(IR_GRID.length);
  for (let i = 0; i < IR_GRID.length; i += 1) {
    const bin = Math.min(n / 2 - 1, Math.max(0, Math.round((IR_GRID[i] / wav.rate) * n)));
    const mag = Math.hypot(re[bin], im[bin]);
    dbs[i] = 20 * Math.log10(Math.max(mag, 1e-9));
    degs[i] = wrapDeg(Math.atan2(im[bin], re[bin]) * DEG);
  }
  irCache.set(path, { freqs: IR_GRID, dbs, degs });
}

function convResponse(file, f) {
  const entry = irCache.get(file);
  if (!entry) return null;
  // nearest log-grid point — the grid is denser than the plot's sampling
  const k = Math.log(entry.freqs[1] / entry.freqs[0]);
  const idx = Math.max(0, Math.min(entry.freqs.length - 1, Math.round(Math.log(f / entry.freqs[0]) / k)));
  return { db: entry.dbs[idx], deg: entry.degs[idx] };
}

// One stage's response at f. null = unplottable (bad args, or a conv file not
// uploaded this session — the plot marks the row partial).
export function stageResponse(stage, f, fs) {
  if (stage.kind === "iir") {
    const c = iirStageCoeffs(stage.args, fs);
    return c && { db: biquadMagDb(c, f, fs), deg: biquadPhaseDeg(c, f, fs) };
  }
  if (stage.kind === "delay") {
    return { db: 0, deg: wrapDeg(-360 * f * delaySeconds(stage.args, fs)) };
  }
  if (stage.kind === "riaa") return riaaResponse(f, stage.args.subsonic !== "0");
  if (stage.kind === "conv") return convResponse(stage.file, f);
  return null;
}

// Whole-chain response: per-stage sum; `partial` when any stage is unplottable.
export function chainResponse(stages, f, fs) {
  let db = 0;
  let deg = 0;
  let partial = false;
  for (const s of stages) {
    const r = stageResponse(s, f, fs);
    if (r === null) partial = true;
    else {
      db += r.db;
      deg += r.deg;
    }
  }
  return { db, deg: wrapDeg(deg), partial };
}
