import { derive, same } from "../../derive.js";

/** @type {import("../../../../../../hqptuner/static/model/shell/option-list.js").Opt[]} */
const ANALOG_STYLE = [
  {
    v: "IIR2",
    fam: "Analog-style",
    var: null,
    leaf: "Steep",
    f: {
      genre: ["pop", "jazz"],
      q: 4,
      focus: [],
      phase: "",
      len: "",
      adaptive: false,
      hires: false,
      apod: "full",
      up: false,
      ratio: "integer",
    },
    d: "Analog-sounding filter especially suitable for recordings containing strong transients, with long post-ringing as a side effect (not usually audible due to masking). A steep IIR filter is used. This filter type is similar to analog filters and has no pre-ringing but long post-ringing. Medium attenuation. No passband ripple. The IIR filter is applied in the time domain.",
  },
  {
    v: "IIR",
    fam: "Analog-style",
    var: null,
    leaf: "Very steep",
    f: {
      genre: ["pop", "jazz"],
      q: 2,
      focus: [],
      phase: "",
      len: "",
      adaptive: false,
      hires: false,
      apod: "full",
      up: false,
      ratio: "integer",
    },
    d: "Analog-sounding filter especially suitable for recordings containing strong transients, with long post-ringing as a side effect (not usually audible due to masking). A really steep IIR filter is used. This filter type is similar to analog filters and has no pre-ringing but long post-ringing. Small amount of passband ripple is also present. Medium attenuation. The IIR filter is applied in the time domain.",
  },
];

export const PCM_ANALOG_STYLE = derive(ANALOG_STYLE, same);
export const SDM_ANALOG_STYLE = derive(ANALOG_STYLE, same);
