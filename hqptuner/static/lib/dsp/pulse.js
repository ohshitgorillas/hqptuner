// --- Primer transient pulse -----------------------------------------------------
// The transient pulse the filter primer sends through a filter, and the ring
// measurement taken on what comes out. Pure functions.

/** Magnitudes below this read as the floor; keeps log10 finite on exact zeros. */
const MAG_FLOOR = 1e-10;
/** Pulse narrower than this aliases at Nyquist and reads as fake ringing. */
const MIN_SIGMA = 2;

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
