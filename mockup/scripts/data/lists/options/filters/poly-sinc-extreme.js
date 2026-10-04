import { derive, same } from "../../derive.js";
import { twoStage } from "./sides.js";

/** @type {import("../../../../model/shell/option-list.js").Opt[]} */
const POLY_SINC_EXTREME = [
  {
    v: "poly-sinc-xtr-mp",
    fam: "Polyphase sinc",
    var: "Extreme roll-off and attenuation",
    leaf: "Minimum phase",
    f: {
      genre: ["jazz"],
      q: 5,
      focus: ["timbre"],
      phase: "minimum",
      len: "",
      adaptive: false,
      hires: false,
      apod: "half",
      up: false,
      ratio: "any",
    },
    d: "Minimum phase polyphase sinc filter with extreme roll-off and attenuation.",
  },
  {
    v: "poly-sinc-xtr-lp",
    fam: "Polyphase sinc",
    var: "Extreme roll-off and attenuation",
    leaf: "Linear phase",
    f: {
      genre: ["classical"],
      q: 5,
      focus: ["timbre"],
      phase: "linear",
      len: "",
      adaptive: false,
      hires: false,
      apod: "half",
      up: false,
      ratio: "any",
    },
    d: "Linear phase polyphase sinc filter with extreme roll-off and attenuation.",
  },
  {
    v: "poly-sinc-xtr-short-mp",
    fam: "Polyphase sinc",
    var: "Extreme roll-off and attenuation",
    leaf: "Short minimum phase",
    f: {
      genre: ["pop"],
      q: 5,
      focus: ["timbre", "transients"],
      phase: "minimum",
      len: "short",
      adaptive: false,
      hires: false,
      apod: "full",
      up: false,
      ratio: "any",
    },
    d: "Short minimum phase polyphase sinc filter with extreme roll-off and attenuation.",
  },
  {
    v: "poly-sinc-xtr-short-lp",
    fam: "Polyphase sinc",
    var: "Extreme roll-off and attenuation",
    leaf: "Short linear phase",
    f: {
      genre: ["electronic", "jazz", "pop"],
      q: 5,
      focus: ["timbre", "transients"],
      phase: "linear",
      len: "short",
      adaptive: false,
      hires: false,
      apod: "full",
      up: false,
      ratio: "any",
    },
    d: "Short linear phase polyphase sinc filter with extreme roll-off and attenuation.",
  },
];

export const PCM_POLY_SINC_EXTREME = derive(POLY_SINC_EXTREME, same);
export const SDM_POLY_SINC_EXTREME = derive(POLY_SINC_EXTREME, twoStage);
