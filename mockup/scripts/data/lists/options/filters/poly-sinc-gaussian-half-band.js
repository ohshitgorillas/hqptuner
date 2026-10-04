import { derive, same } from "../../derive.js";

/** @type {import("../../../../../../hqptuner/static/model/shell/option-list.js").Opt[]} */
const POLY_SINC_GAUSSIAN_HALF_BAND = [
  {
    v: "poly-sinc-gauss-halfband",
    fam: "Polyphase sinc",
    var: "Gaussian half-band",
    leaf: "Linear phase",
    f: {
      genre: ["any"],
      q: 4,
      focus: ["transients", "timbre", "space"],
      phase: "linear",
      len: "",
      adaptive: false,
      hires: false,
      apod: null,
      up: false,
      ratio: "any",
    },
    d: "Linear phase half-band Gaussian filter. Slightly leaky around Nyquist, but extremely high attenuation. Only suitable for highest technical quality source materials.",
  },
  {
    v: "poly-sinc-gauss-halfband-s",
    fam: "Polyphase sinc",
    var: "Gaussian half-band",
    leaf: "Short linear phase",
    f: {
      genre: ["any"],
      q: 3,
      focus: ["transients", "timbre", "space"],
      phase: "linear",
      len: "short",
      adaptive: false,
      hires: false,
      apod: null,
      up: false,
      ratio: "any",
    },
    d: "Short linear phase half-band Gaussian filter. Leaky around Nyquist, but high attenuation. Only suitable for highest technical quality source materials.",
  },
];

export const PCM_POLY_SINC_GAUSSIAN_HALF_BAND = derive(POLY_SINC_GAUSSIAN_HALF_BAND, same);
export const SDM_POLY_SINC_GAUSSIAN_HALF_BAND = derive(POLY_SINC_GAUSSIAN_HALF_BAND, same);
