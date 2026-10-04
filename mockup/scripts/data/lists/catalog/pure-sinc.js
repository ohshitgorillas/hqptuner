import { derive, same } from "../derive.js";
import { sdm16x } from "./sides.js";

/** @type {import("./sides.js").CatalogFilter[]} */
const PURE_SINC = [
  {
    v: "sinc-S",
    label: "Sinc · Extended v2 · Short",
    group: "Pure sinc",
    man: "Sinc filter with adaptive number of taps. Number of taps is 4096x conversion ratio. Very sharp roll-off and high attenuation. Variant of poly-sinc-ext2-xla.",
  },
  {
    v: "sinc-M",
    label: "Sinc · Extended v2 · Constant length",
    group: "Pure sinc",
    man: "Sinc filter with one million taps. Very sharp roll-off and high attenuation. Variant of poly-sinc-ext2-xla.",
  },
  {
    v: "sinc-Mx",
    label: "Sinc · Extended v2 · Constant time",
    group: "Pure sinc",
    man: "Constant time version of sinc-M. Filter length is constant in time, with one million taps at 16x PCM output rates. Variant of poly-sinc-ext2-xla. (65536x conversion ratio)",
  },
  {
    v: "sinc-MG",
    label: "Sinc · Gauss · Constant time",
    group: "Pure sinc",
    man: "Gaussian constant time filter with one million taps at 16x PCM output rates. Extremely high attenuation. Variant of poly-sinc-gauss-xl. (65536x conversion ratio)",
  },
  {
    v: "sinc-MGa",
    label: "Sinc · Gauss · Constant time, apod",
    group: "Pure sinc",
    man: "Apodizing Gaussian constant time filter with one million taps at 16x PCM output rates. Extremely high attenuation. Variant of poly-sinc-gauss-xla. (65536x conversion ratio)",
  },
  {
    v: "sinc-L",
    label: "Sinc · X-long",
    group: "Pure sinc",
    man: "Sinc filter with adaptive number of taps. Number of taps is 131070x conversion ratio. Extremely sharp roll-off and average attenuation.",
  },
  {
    v: "sinc-Ls",
    label: "Sinc · Short",
    group: "Pure sinc",
    man: "Average attenuation sinc filter with adaptive number of taps (4096x conversion ratio).",
  },
  {
    v: "sinc-Lm",
    label: "Sinc · Medium",
    group: "Pure sinc",
    man: "Average attenuation sinc filter with adaptive number of taps (16384x conversion ratio).",
  },
  {
    v: "sinc-Ll",
    label: "Sinc · Long",
    group: "Pure sinc",
    man: "Average attenuation sinc filter with adaptive number of taps (65536x conversion ratio).",
  },
  {
    v: "sinc-Lh",
    label: "Sinc · Medium with high attenuation",
    group: "Pure sinc",
    man: "High attenuation sinc filter with adaptive number of taps (16384x ratio). Significantly better quality than sinc-L at 1/8th of the load.",
  },
  {
    v: "sinc-short",
    label: "Sinc · Rate-flexible · Short",
    group: "Pure sinc",
    man: "Short average attenuation sinc filter with adaptive number of taps.",
  },
  {
    v: "sinc-medium",
    label: "Sinc · Rate-flexible · Medium",
    group: "Pure sinc",
    man: "Average attenuation sinc filter with adaptive number of taps.",
  },
  {
    v: "sinc-long",
    label: "Sinc · Rate-flexible · Long",
    group: "Pure sinc",
    man: "Long average attenuation sinc filter with adaptive number of taps.",
  },
  {
    v: "sinc-long-h",
    label: "Sinc · Rate-flexible · Long with high attenuation",
    group: "Pure sinc",
    man: "Long high attenuation sinc filter with adaptive number of taps.",
  },
];

export const PCM_PURE_SINC_CATALOG = derive(PURE_SINC, same);
export const SDM_PURE_SINC_CATALOG = derive(PURE_SINC, sdm16x);
