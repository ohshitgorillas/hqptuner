// --- radix-2 FFT ------------------------------------------------------------
// In-place complex FFT on split real/imaginary arrays whose length is a power
// of two. Shared by the impulse-response registry and the FIR primer.

import { TAU } from "./biquad.js";

/**
 * Forward transform, in place. `re.length` must be a power of two.
 * @param {Float64Array} re
 * @param {Float64Array} im
 * @returns {void}
 */
export function fftRadix2(re, im) {
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
    const ang = -TAU / len;
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

/**
 * Inverse transform, in place: conjugate, forward, conjugate, scale by 1/n.
 * @param {Float64Array} re
 * @param {Float64Array} im
 * @returns {void}
 */
export function ifftRadix2(re, im) {
  const n = re.length;
  for (let i = 0; i < n; i += 1) im[i] = -im[i];
  fftRadix2(re, im);
  for (let i = 0; i < n; i += 1) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}
