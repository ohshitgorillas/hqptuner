import { derive, same } from "../../derive.js";

/** @type {import("../../../../../../hqptuner/static/model/shell/option-list.js").Opt[]} */
const POLY_SINC_EXTENDED = [
  {
    v: "poly-sinc-ext",
    fam: "Polyphase sinc",
    var: "Extended frequency response",
    leaf: "Linear phase",
    f: {
      genre: [],
      q: 3,
      focus: [],
      phase: "linear",
      len: "",
      adaptive: false,
      hires: false,
      apod: "half",
      up: false,
      ratio: "integer",
    },
    d: "Linear phase polyphase sinc filter with sharper roll-off and somewhat lower stop-band attenuation, while being roughly equal in length to poly-sinc.",
  },
];

export const PCM_POLY_SINC_EXTENDED = derive(POLY_SINC_EXTENDED, same);
export const SDM_POLY_SINC_EXTENDED = derive(POLY_SINC_EXTENDED, same);
