// --- convolution preview (client FFT of a session-uploaded IR) ---------------
// The impulse-response registry and everything that feeds it: a minimal WAV
// reader, a radix-2 FFT, and the lookup a conv stage plots through. Its own
// module because `irCache` is module-level mutable state — one cache, written by
// registerIr and read by every consumer, so it must have exactly one home.

import { DEG, TAU, wrapDeg } from "./biquad.js";
import { bandFreqs } from "./curves.js";

/**
 * @typedef {import("./biquad.js").Response} Response
 * @typedef {{ freqs: number[], dbs: number[], degs: number[] }} IrEntry
 *   A registered impulse response sampled onto the log grid.
 */

const IR_GRID = bandFreqs(256);
/** @type {Map<string, IrEntry | null>} daemon path -> response, null while unpreviewable */
const irCache = new Map();

/**
 * @param {Float64Array} re
 * @param {Float64Array} im
 * @returns {void}
 */
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
/**
 * @param {DataView} v
 * @returns {{ fmt: { at: number } | null, data: { at: number, size: number } | null }}
 */
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
/**
 * @param {DataView} v
 * @param {number} at
 * @param {number} bits
 * @param {number} audioFormat
 * @returns {number | null}
 */
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
/**
 * @param {ArrayBuffer} buf
 * @returns {{ rate: number, samples: Float64Array } | null}
 */
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

/**
 * Register a just-uploaded IR so conv stages referencing `path` can plot.
 * Truncates/zero-pads to <=65536 points; response sampled onto the log grid.
 * @param {string} path
 * @param {ArrayBuffer} arrayBuffer
 * @returns {void}
 */
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

/**
 * Is `file` registered and previewable? The grid path checks this before
 * summing a conv stage; the cache itself stays private to this module.
 * @param {string} file
 * @returns {boolean}
 */
export function hasIr(file) {
  return Boolean(irCache.get(file));
}

/**
 * A registered IR's magnitude and phase at f, read off the nearest log-grid
 * point. null when `file` has no previewable entry.
 * @param {string} file
 * @param {number} f
 * @returns {Response | null}
 */
export function convResponse(file, f) {
  const entry = irCache.get(file);
  if (!entry) return null;
  // nearest log-grid point — the grid is denser than the plot's sampling
  const k = Math.log(entry.freqs[1] / entry.freqs[0]);
  const idx = Math.max(0, Math.min(entry.freqs.length - 1, Math.round(Math.log(f / entry.freqs[0]) / k)));
  return { db: entry.dbs[idx], deg: entry.degs[idx] };
}
