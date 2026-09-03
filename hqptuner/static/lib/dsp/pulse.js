// --- Primer transient pulse -----------------------------------------------------
// The transient pulse the filter primer sends through a filter, and the ring
// measurement taken on what comes out. Pure functions.

/** Magnitudes below this read as the floor; keeps log10 finite on exact zeros. */
const MAG_FLOOR = 1e-10;
/** Half-extent of the pulse in sigmas; exp(-24.5) puts the truncation edge near -213 dB. */
const EXTENT_SIGMAS = 7;

/**
 * Gaussian pulse of the given sigma in samples, spanning plus or minus seven
 * sigma, odd length, unit peak at the centre sample. A sigma below a sample
 * is a single-sample impulse, the display standard.
 * @param {number} sigmaSamples
 * @returns {Float64Array}
 */
export function gaussianPulse(sigmaSamples) {
  const half = Math.ceil(EXTENT_SIGMAS * sigmaSamples);
  const p = new Float64Array(2 * half + 1);
  for (let i = 0; i < p.length; i += 1) {
    const d = i - half;
    p[i] = Math.exp(-(d * d) / (2 * sigmaSamples * sigmaSamples));
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
 * The primer's ring measure: what the filter changed. The input pulse is
 * aligned on the output's peak sample and subtracted; ring before is the peak
 * of that residual ahead of the output peak, ring after the peak behind it,
 * both in dB relative to the pulse peak. Smear inside the pulse's own span
 * counts, and a minimum-phase tail counts as ring after.
 * @param {Float64Array} taps
 * @param {Float64Array} pulse
 * @returns {{ beforeDb: number, afterDb: number }}
 */
export function ringing(taps, pulse) {
  const { y } = filterPulse(taps, pulse);
  let peak = 0;
  let centre = 0;
  for (let j = 0; j < pulse.length; j += 1) {
    if (Math.abs(pulse[j]) > peak) {
      peak = Math.abs(pulse[j]);
      centre = j;
    }
  }
  let outPeak = 0;
  for (let k = 0; k < y.length; k += 1) if (Math.abs(y[k]) > Math.abs(y[outPeak])) outPeak = k;
  const offset = outPeak - centre;
  let before = 0;
  let after = 0;
  for (let k = 0; k < y.length; k += 1) {
    const j = k - offset;
    const r = Math.abs(y[k] - (j >= 0 && j < pulse.length ? pulse[j] : 0));
    if (k < outPeak) before = Math.max(before, r);
    else if (k > outPeak) after = Math.max(after, r);
  }
  const db = (/** @type {number} */ v) => 20 * Math.log10(Math.max(v / peak, MAG_FLOOR));
  return { beforeDb: db(before), afterDb: db(after) };
}
