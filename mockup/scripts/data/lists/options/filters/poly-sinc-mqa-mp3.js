import { derive, same } from "../../derive.js";

/** @type {import("../../../../../../hqptuner/static/model/shell/option-list.js").Opt[]} */
const POLY_SINC_MQA_MP3 = [
  {
    v: "poly-sinc-mqa/mp3-mp",
    fam: "Polyphase sinc",
    var: "MQA and MP3",
    leaf: "Minimum phase",
    f: {
      genre: ["pop"],
      q: 4,
      focus: ["transients"],
      phase: "minimum",
      len: "",
      adaptive: false,
      hires: true,
      apod: "full",
      up: true,
      ratioPcm: "integer",
      ratioSdm: "any",
    },
    d: "Minimum phase variant of poly-sinc-mqa.",
  },
  {
    v: "poly-sinc-mqa/mp3-lp",
    fam: "Polyphase sinc",
    var: "MQA and MP3",
    leaf: "Linear phase",
    f: {
      genre: ["classical", "jazz"],
      q: 4,
      focus: ["transients"],
      phase: "linear",
      len: "",
      adaptive: false,
      hires: true,
      apod: "full",
      up: true,
      ratioPcm: "integer",
      ratioSdm: "any",
    },
    d: "Linear phase polyphase sinc filter optimized for playing back MQA- or MP3-encoded content in order to clean up high frequency noise added by the MQA or MP3 encoding. Also suitable for upsampling PCM sources of ≥ 88.2 kHz sampling rate, especially for hi-res PCM recordings of ≥ 176.4 kHz sampling rate. Very short ringing. Early slow roll-off.",
  },
];

export const PCM_POLY_SINC_MQA_MP3 = derive(POLY_SINC_MQA_MP3, same);
export const SDM_POLY_SINC_MQA_MP3 = derive(POLY_SINC_MQA_MP3, same);
