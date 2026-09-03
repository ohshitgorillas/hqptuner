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
 * The primer's ring measure. The output's main lobe is the run around its peak
 * sample out to the first zero crossing on each side; ring before is the peak
 * of the output ahead of that lobe, ring after the peak behind it, both in dB
 * relative to the pulse peak. Sidelobes count wherever they lie, and a
 * minimum-phase tail counts as ring after.
 * @param {Float64Array} taps
 * @param {Float64Array} pulse
 * @returns {{ beforeDb: number, afterDb: number }}
 */
export function ringing(taps, pulse) {
  const { y } = filterPulse(taps, pulse);
  let peak = 0;
  for (let j = 0; j < pulse.length; j += 1) peak = Math.max(peak, Math.abs(pulse[j]));
  let outPeak = 0;
  for (let k = 0; k < y.length; k += 1) if (Math.abs(y[k]) > Math.abs(y[outPeak])) outPeak = k;
  const sign = Math.sign(y[outPeak]);
  let lo = outPeak;
  while (lo > 0 && Math.sign(y[lo - 1]) === sign) lo -= 1;
  let hi = outPeak;
  while (hi < y.length - 1 && Math.sign(y[hi + 1]) === sign) hi += 1;
  let before = 0;
  let after = 0;
  for (let k = 0; k < lo; k += 1) before = Math.max(before, Math.abs(y[k]));
  for (let k = hi + 1; k < y.length; k += 1) after = Math.max(after, Math.abs(y[k]));
  const db = (/** @type {number} */ v) => 20 * Math.log10(Math.max(v / peak, MAG_FLOOR));
  return { beforeDb: db(before), afterDb: db(after) };
}
