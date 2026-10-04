import { derive, same } from "../../derive.js";

/** @typedef {import("../../../../../../hqptuner/static/model/shell/option-list.js").Opt} Opt */

/**
 * Both polynomial interpolators' facets.
 *
 * @type {import("../../../../../../hqptuner/static/model/shell/option-list.js").Facets}
 */
const POLYNOMIAL = {
  genre: [],
  q: 1,
  focus: [],
  phase: "",
  len: "xshort",
  adaptive: false,
  hires: false,
  apod: null,
  up: true,
  ratio: "integer",
};

/** @type {Opt[]} */
const INTERPOLATION = [
  {
    v: "closed-form",
    fam: "Interpolation",
    var: "Closed form",
    leaf: "Base",
    f: {
      genre: [],
      q: 3,
      focus: [],
      phase: "",
      len: "",
      adaptive: false,
      hires: false,
      apod: null,
      up: true,
      ratio: "2x",
    },
    d: "Closed form interpolation with a high number of taps.",
  },
  {
    v: "closed-form-fast",
    fam: "Interpolation",
    var: "Closed form",
    leaf: "Low CPU load",
    f: {
      genre: [],
      q: 2,
      focus: [],
      phase: "",
      len: "",
      adaptive: false,
      hires: false,
      apod: null,
      up: true,
      ratio: "2x",
    },
    d: "Closed form interpolation with lower CPU load, but also lower precision. Output precision tuned to match about 24-bit PCM.",
  },
  {
    v: "closed-form-M",
    fam: "Interpolation",
    var: "Closed form",
    leaf: "One million taps",
    f: {
      genre: [],
      q: 3,
      focus: [],
      phase: "",
      len: "stupid",
      adaptive: false,
      hires: false,
      apod: null,
      up: true,
      ratio: "2x",
    },
    d: "Closed form interpolation with one million taps.",
  },
  {
    v: "polynomial-1",
    fam: "Interpolation",
    var: "Polynomial",
    leaf: "No ringing",
    f: { ...POLYNOMIAL },
    d: 'Polynomial interpolation. No apparent pre- or post-ringing. Frequency response rolls off slowly in the top octave. Poor stop-band rejection and will thus leak a fairly high amount of ultrasonic distortion. These types of filters are sometimes referred to as "non-ringing" by some manufacturers. Not recommended.',
  },
  {
    v: "polynomial-2",
    fam: "Interpolation",
    var: "Polynomial",
    leaf: "One ringing cycle",
    f: { ...POLYNOMIAL },
    d: "Similar to polynomial-1, but higher stop-band rejection and only one cycle of pre- and post-ringing. Not recommended.",
  },
];

/**
 * SDM's closed form runs sixteen million taps where PCM's runs one million.
 *
 * @param {Opt} o
 * @returns {Partial<Opt> | undefined}
 */
const sdm = (o) =>
  o.v === "closed-form-M"
    ? { v: "closed-form-16M", leaf: "16 million taps", d: "Closed form interpolation with 16 million taps." }
    : undefined;

export const PCM_INTERPOLATION = derive(INTERPOLATION, same);
export const SDM_INTERPOLATION = derive(INTERPOLATION, sdm);
