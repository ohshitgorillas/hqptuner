import { derive, same } from "../derive.js";
import { PCM_POLY_SINC_CATALOG, SDM_POLY_SINC_CATALOG } from "./poly-sinc.js";
import { PCM_PURE_SINC_CATALOG, SDM_PURE_SINC_CATALOG } from "./pure-sinc.js";

/** @typedef {import("./sides.js").CatalogFilter} CatalogFilter */

/** The filters ahead of the polyphase sincs. @type {CatalogFilter[]} */
const HEAD = [
  {
    v: "none",
    label: "No resampling",
    group: "Misc",
    man: "No sample rate conversion happens. Only sample depth is changed as needed.",
  },
  {
    v: "IIR",
    label: "Analog-style · Very steep",
    group: "Analog-style",
    man: "Analog-sounding filter especially suitable for recordings containing strong transients, with long post-ringing as a side effect (not usually audible due to masking). A really steep IIR filter is used. This filter type is similar to analog filters and has no pre-ringing but long post-ringing. Small amount of passband ripple is also present. Medium attenuation. The IIR filter is applied in the time domain.",
  },
  {
    v: "IIR2",
    label: "Analog-style · Steep",
    group: "Analog-style",
    man: "Analog-sounding filter especially suitable for recordings containing strong transients, with long post-ringing as a side effect (not usually audible due to masking). A steep IIR filter is used. This filter type is similar to analog filters and has no pre-ringing but long post-ringing. Medium attenuation. No passband ripple. The IIR filter is applied in the time domain.",
  },
  {
    v: "FIR",
    label: "Conventional · Classic · Base",
    group: "Conventional",
    man: 'Typical "oversampling" digital filter, generally suitable for most uses (slight pre- and post-ringing), but best on classical music recorded in a real-world acoustic environment such as a concert hall. This is the most ordinary filter type, usually present in hardware. This filter is applied in the time domain. Average amount of pre- and post-ringing.',
  },
  {
    v: "asymFIR",
    label: "Conventional · Classic · Asymmetric",
    group: "Conventional",
    man: "Asymmetric FIR, good for jazz/blues and other music containing transients recorded in a real-world acoustic environment. Otherwise same as FIR, but with shorter pre-ringing and longer post-ringing. Modifies phase response, but not as much as minimum phase FIR.",
  },
  {
    v: "minphaseFIR",
    label: "Conventional · Classic · Minimum",
    group: "Conventional",
    man: "Minimum phase FIR, good for pop/rock/electronic music containing strong transients such as drums and percussion, where the recording is made in a studio using multi-track equipment. No pre-ringing, but somewhat long post-ringing.",
  },
  {
    v: "FFT",
    label: "Conventional · Brickwall · Frequency domain",
    group: "Conventional",
    man: 'Technically good steep "brickwall" filter, but might have some side effects (pre-ringing) on material containing strong transients. This filter is similar to FIR, but it is applied in the frequency domain and is quite efficient from a performance point of view while having a rather long impulse response. The length of this filter can be configured separately in the FFT filter length setting.',
  },
];

/** The filters between the polyphase sincs and the pure sincs. @type {CatalogFilter[]} */
const MIDDLE = [
  {
    v: "ASRC",
    label: "Asynchronous, any rate",
    group: "Misc",
    man: "Special type of filter, slightly similar to FIR, but with a possibility of asynchronous operation for conversions from any rate to any other rate. Computationally heavy. Not recommended.",
  },
  {
    v: "polynomial-1",
    label: "Interpolation · Polynomial · No ringing",
    group: "Interpolation",
    man: 'Polynomial interpolation. No apparent pre- or post-ringing. Frequency response rolls off slowly in the top octave. Poor stop-band rejection and will thus leak a fairly high amount of ultrasonic distortion. These types of filters are sometimes referred to as "non-ringing" by some manufacturers. Not recommended.',
  },
  {
    v: "polynomial-2",
    label: "Interpolation · Polynomial · One cycle",
    group: "Interpolation",
    man: "Similar to polynomial-1, but higher stop-band rejection and only one cycle of pre- and post-ringing. Not recommended.",
  },
  {
    v: "minringFIR-lp",
    label: "Conventional · Min ringing · Linear",
    group: "Conventional",
    man: "Minimum ringing FIR. Uses a special algorithm to create a linear phase filter that minimizes ringing while providing better frequency response and attenuation than polynomial interpolators. Performance and ringing between polynomial and poly-sinc-short.",
  },
  {
    v: "minringFIR-mp",
    label: "Conventional · Min ringing · Minimum",
    group: "Conventional",
    man: "Minimum phase variant of minringFIR.",
  },
  {
    v: "closed-form",
    label: "Interpolation · Closed form · Base",
    group: "Interpolation",
    man: "Closed form interpolation with a high number of taps.",
  },
  {
    v: "closed-form-fast",
    label: "Interpolation · Closed form · Low CPU load",
    group: "Interpolation",
    man: "Closed form interpolation with lower CPU load, but also lower precision. Output precision tuned to match about 24-bit PCM.",
  },
  {
    v: "closed-form-M",
    label: "Interpolation · Closed form · 1M taps",
    group: "Interpolation",
    man: "Closed form interpolation with one million taps.",
  },
];

/** The filters only the PCM catalog lists. */
const PCM_ONLY = new Set(["none", "ASRC"]);

/**
 * SDM drops the PCM-only filters and runs the closed form at sixteen million taps where PCM runs one million.
 *
 * @param {CatalogFilter} e
 * @returns {Partial<CatalogFilter> | null | undefined}
 */
function sdm(e) {
  if (PCM_ONLY.has(e.v)) return null;
  if (e.v !== "closed-form-M") return undefined;
  return {
    v: "closed-form-16M",
    label: "Interpolation · Closed form · 16M taps",
    man: "Closed form interpolation with 16 million taps.",
  };
}

export const PCM_FILTER_CATALOG = [
  ...derive(HEAD, same),
  ...PCM_POLY_SINC_CATALOG,
  ...derive(MIDDLE, same),
  ...PCM_PURE_SINC_CATALOG,
];
export const SDM_FILTER_CATALOG = [
  ...derive(HEAD, sdm),
  ...SDM_POLY_SINC_CATALOG,
  ...derive(MIDDLE, sdm),
  ...SDM_PURE_SINC_CATALOG,
];
