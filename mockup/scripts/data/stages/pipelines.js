// DSP pipelines drawer: data + copy. Wire truth = the 6.0.4 /matrix form (v1 docs/matrix-spec.md "Wire truth"): each
// pipeline = Source Ch (wire 0–127), Gain (dB | Lin; negative Lin = polarity inversion), Mix Ch, Process (comma list of
// plugin specs `iir:` / `delay:` / `riaa:`, WAV impulse files, REW ParametricEQ .txt). Pipelines feeding one Mix Ch sum.
// Strings: v1 settings.json matrix_pipelines (manual §7 / readme §1.11.1, verbatim, minus v1's own last sentence),
// manual §7.1–7.4 plugin tables (verbatim), v1 StageEditor kind labels, v1 Library / Tab labels.
// Mock state: Speakers station, profile [Default]: 2.0 source → 2.0 output, one room-correction pipeline per channel
// (REW-style PEQ + headroom gain). `#mch` in the URL loads a 5.1 → stereo mixdown instead (the daemon's stock
// `Mch-to-Stereo mixdown` profile shape), to show a fuller grid; `#dense` loads 120 pipelines in two channels, `#71` a 7.1 → 7.1 bass-managed layout (the 8-channel ceiling).

import { bandsToStages } from "../../../../hqptuner/static/model/gauges/eq.js";

// Channel names: slots 1–8 carry the daemon's channel order (readme §1.9; v1 short names, LFE shown as Sub), beyond that
// numbers (label channels when you can, numbers beyond that).
const CH_SHORT = ["L", "R", "C", "Sub", "Lr", "Rr", "Ls", "Rs"];
const CH_NAME = ["Left", "Right", "Center", "Sub", "Left rear", "Right rear", "Left side", "Right side"];
/**
 * A channel's short name: the daemon's slot name, its number beyond the eighth.
 *
 * @param {number} i  wire channel, 0-based
 * @returns {string}
 */
export const chShort = (i) => CH_SHORT[i] ?? String(i + 1);
/**
 * A channel's full name: the daemon's slot name, `Channel n` beyond the eighth.
 *
 * @param {number} i  wire channel, 0-based
 * @returns {string}
 */
export const chName = (i) => CH_NAME[i] ?? `Channel ${i + 1}`;

/**
 * One stage of a pipeline's Process chain: its plugin kind, then its wire arguments (iir: type, f, g, q | s | bw;
 * delay: t | d | s).
 *
 * @typedef {object} Stage
 * @property {string} kind
 * @property {string} [type]
 * @property {number} [f]
 * @property {number} [g]
 * @property {number} [q]
 * @property {number} [s]
 * @property {number} [bw]
 * @property {number} [t]
 * @property {number} [d]
 */

/**
 * One pipeline (virtual channel): source channel, gain in `unit` ('dB' | 'Lin'), mix channel, Process chain. `gen` names
 * the crossfeed block a generated row belongs to, `ear` the side of the stereo pair whose EQ it carries.
 *
 * @typedef {object} Pipeline
 * @property {number} src
 * @property {number} mix
 * @property {number} gain
 * @property {string} unit
 * @property {Stage[]} stages
 * @property {string} [gen]
 * @property {number} [ear]
 */

/**
 * A mock pipeline set: the matrix's input and output channel counts, the source rate, the pipelines.
 *
 * @typedef {{ inputs: number, outputs: number, rate: number, pipes: Pipeline[] }} PipelineSet
 */

/**
 * @param {import('../../../../hqptuner/static/model/gauges/eq.js').Band[]} bands
 * @returns {Stage[]}
 */
const room = (bands) => [...bandsToStages(bands), { kind: "iir", type: "hshelf", f: 8000, g: -1.5, q: 0.7 }];

/** @type {PipelineSet} */
const STEREO = {
  inputs: 2,
  outputs: 2,
  rate: 44100,
  pipes: [
    {
      src: 0,
      mix: 0,
      gain: -3.5,
      unit: "dB",
      stages: room([
        [41, -8.5, 4.3],
        [58, 2.6, 3.5],
        [84, -6.2, 4.8],
        [118, -3.8, 3.6],
        [160, 1.8, 2.9],
        [215, -2.6, 2.4],
        [310, 1.2, 1.7],
        [2600, -1.4, 0.6],
      ]),
    },
    {
      src: 1,
      mix: 1,
      gain: -3.5,
      unit: "dB",
      stages: room([
        [43, -7.2, 4.0],
        [61, 3.1, 3.2],
        [88, -5.4, 4.4],
        [124, -4.4, 3.1],
        [172, 1.5, 2.6],
        [228, -2.1, 2.2],
        [330, 0.9, 1.6],
        [2800, -1.1, 0.7],
      ]),
    },
  ],
};
// 5.1 → stereo (manual §7's example shape): fronts straight, center and surrounds folded in at −3 dB, sub to both.
/** @type {PipelineSet} */
const MCH = {
  inputs: 6,
  outputs: 2,
  rate: 48000,
  pipes: [
    { src: 0, mix: 0, gain: 0, unit: "dB", stages: [] },
    { src: 1, mix: 1, gain: 0, unit: "dB", stages: [] },
    { src: 2, mix: 0, gain: -3, unit: "dB", stages: [] },
    { src: 2, mix: 1, gain: -3, unit: "dB", stages: [] },
    { src: 3, mix: 0, gain: -6, unit: "dB", stages: [{ kind: "iir", type: "lp", f: 120, q: 0.707 }] },
    { src: 3, mix: 1, gain: -6, unit: "dB", stages: [{ kind: "iir", type: "lp", f: 120, q: 0.707 }] },
    { src: 4, mix: 0, gain: -3, unit: "dB", stages: [{ kind: "delay", t: 0.01 }] },
    { src: 5, mix: 1, gain: -3, unit: "dB", stages: [{ kind: "delay", t: 0.01 }] },
  ],
};
// A stupid number of pipelines in two channels: room correction plus a hand-built early-reflection
// field, 120 of the 128. Per side: the correction pipeline, 47 delayed taps on the same channel (decaying Lin gains,
// some polarity-flipped, each low-passed a little more), 12 cross-channel taps.
/** @type {PipelineSet} */
const DENSE = (() => {
  const pipes = STEREO.pipes.map((p) => ({ ...p, stages: p.stages.map((x) => ({ ...x })) }));
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const ch of [0, 1]) {
    for (let k = 1; k <= 47; k++) {
      const t = +(0.003 + k * 0.0011 + rnd() * 0.0008).toFixed(5);
      const g = +((rnd() < 0.2 ? -1 : 1) * 0.42 * Math.exp(-k / 18)).toFixed(4);
      pipes.push({
        src: ch,
        mix: ch,
        unit: "Lin",
        gain: g,
        stages: [
          { kind: "delay", t },
          { kind: "iir", type: "lp", f: Math.round(16000 * Math.exp(-k / 40)), q: 0.707 },
        ],
      });
    }
    for (let k = 1; k <= 12; k++) {
      pipes.push({
        src: ch,
        mix: 1 - ch,
        unit: "Lin",
        gain: +(0.3 * Math.exp(-k / 6)).toFixed(4),
        stages: [
          { kind: "delay", t: +(0.0004 + k * 0.0021).toFixed(5) },
          { kind: "iir", type: "lp", f: 2500, q: 0.707 },
        ],
      });
    }
  }
  return { inputs: 2, outputs: 2, rate: 44100, pipes };
})();
// 7.1 → 7.1 (`#71`): the 8-channel ceiling. Speaker alignment per channel (delay + trim, mains
// high-passed at 80 Hz), bass management: every main also low-passed into the Sub, summed with the LFE.
/** @type {PipelineSet} */
const MCH8 = (() => {
  const trim = [0, 0, -1.5, 0, -2, -2, -1, -1],
    dist = [3.1, 3.1, 2.9, 3.4, 1.8, 1.8, 2.2, 2.2];
  /** @type {Pipeline[]} */
  const pipes = [];
  for (let c = 0; c < 8; c++) {
    pipes.push({
      src: c,
      mix: c,
      gain: trim[c],
      unit: "dB",
      stages: [
        { kind: "delay", d: +(3.4 - dist[c]).toFixed(2) },
        ...(c === 3 ? [] : [{ kind: "iir", type: "hp", f: 80, q: 0.707 }]),
      ],
    });
    if (c !== 3)
      pipes.push({ src: c, mix: 3, gain: -6, unit: "dB", stages: [{ kind: "iir", type: "lp", f: 80, q: 0.707 }] });
  }
  return { inputs: 8, outputs: 8, rate: 48000, pipes };
})();
const SETS = { mch8: MCH8, mch: MCH, dense: DENSE, stereo: STEREO };

// ── Copy ────────────────────────────────────────────────────────────────────
export const PMAN = {
  pipelines:
    'Description of a virtual channel / processing pipeline. "Source Ch" specifies the channel used as the source for the virtual channel. "Gain" is the overall gain applied to the virtual channel, and "Mix Ch" is the logical output channel. When multiple virtual channels have the same target channel, the outputs of the virtual channels are mixed together to the target output channel. "Process" can define external filter impulse response WAV file(s) for convolution, a parametric equalizer specification in RoomEqWizard text output format, and parametric filter specifications.',
  gain: "Gain can be applied in either dB scale or linear scale, as selected in the corresponding column. Linear scale factors can also be negative to perform phase inversion; this allows, for example, M/S processing.",
  iir: "IIR plugin provides parametric EQ based on IIR biquad filters.",
  iirUnits: "Where f is in Hz, BW is factor, s is factor (1 maximum steepness) and g is in dB.",
  delay: "Delay plugin provides specified amount of delay.",
  riaa: "RIAA plugin provides RIAA EQ curve correction for vinyl playback. Currently plugin provides only one adjustable parameter “subsonic” which is additional 20 Hz subsonic filter pole, with values of “1” (enabled) and “0” (disabled). For best performance an accuracy, use input sampling rate of 192 kHz or higher. Minimum recommended input sampling rate is 96 kHz.",
  conv: "When choosing format for convolution filters, for most optimal case for all kinds of source material, use extended frequency response convolution filters with 352.8 kHz sampling rate. When such are used, Expand HF can be left disabled for all cases.",
  peqFile:
    "Various headphone equalization files can be found from AutoEq. Choose the ParametricEQ txt file. This can be directly used in HQPlayer matrix processor without modifications and also includes gain compensation data.",
};

// iir plugin table (manual §7.3), in the manual's order: description + arguments. `alt` = the either/or width argument.
export const IIR_TYPES = [
  { t: "lp", d: "Low-pass filter", args: ["f"], alt: ["q", "s"] },
  { t: "lp1", d: "1st order low-pass filter", args: ["f"], alt: [] },
  { t: "hp", d: "High-pass filter", args: ["f"], alt: ["q", "s"] },
  { t: "hp1", d: "1st order high-pass filter", args: ["f"], alt: [] },
  { t: "bp", d: "Band-pass filter", args: ["f"], alt: ["q", "bw"] },
  { t: "ap", d: "All-pass filter", args: ["f"], alt: ["q", "bw"] },
  { t: "notch", d: "Notch filter", args: ["f"], alt: ["q", "bw"] },
  { t: "peak", d: "Peaking filter", args: ["f", "g"], alt: ["q", "bw"] },
  { t: "lshelf", d: "Low-shelf filter", args: ["f", "g"], alt: ["q", "s"] },
  { t: "hshelf", d: "High-shelf filter", args: ["f", "g"], alt: ["q", "s"] },
  { t: "biquad", d: "Raw biquad filter", args: ["b0", "b1", "b2", "a0", "a1", "a2"], alt: [] },
];
export const ARG_NAME = { f: "frequency", q: "Q", s: "slope", bw: "bandwidth", g: "gain" };
export const ARG_UNIT = { f: "Hz", g: "dB" };

// delay plugin table (manual §7.2).
export const DELAY_ARGS = [
  { a: "s", d: "Delay in number of samples at source rate", unit: "samples" },
  { a: "t", d: "Delay in time, number of seconds", unit: "s" },
  { a: "d", d: "Delay in distance, number of meters", unit: "m" },
];
export const DELAY_V = { a: "v", d: "Velocity of sound, in m/s, default 343.956", unit: "m/s" };

// Stage kinds for `+ Stage` (v1 StageEditor KINDS labels).
export const KINDS = [
  { k: "iir", label: "Parametric (IIR)" },
  { k: "delay", label: "Delay" },
  { k: "riaa", label: "RIAA" },
  { k: "conv", label: "Convolution" },
];

// Import EQ popover (v1 Library.js lane): vendored AutoEq library, mock hits.
/**
 * @type {{ placeholder: string, mirror: string, hits: { name: string, src: string, pre: number, bands: import('../../../../hqptuner/static/model/gauges/eq.js').Band[] }[] }}
 */
export const AUTOEQ = {
  placeholder: "Search headphone model — e.g. HD 650…", // v1 Library.js
  mirror: "mirror to stereo pair", // v1 Tab.js
  hits: [
    {
      name: "Sennheiser HD 650",
      src: "oratory1990",
      pre: -6.4,
      bands: [
        [105, 5.5, 0.71, "lshelf"],
        [150, -1.6, 0.6],
        [1300, -2.1, 1.6],
        [3000, 3.3, 3.0],
        [5300, -3.2, 2.9],
        [10000, 2.2, 0.7, "hshelf"],
      ],
    },
    {
      name: "Sennheiser HD 600",
      src: "oratory1990",
      pre: -6.1,
      bands: [
        [105, 5.5, 0.71, "lshelf"],
        [190, -2.0, 0.5],
        [2100, -1.2, 2.2],
        [3300, 2.8, 2.6],
        [5600, -3.6, 3.5],
        [10000, 2.6, 0.7, "hshelf"],
      ],
    },
    {
      name: "Sennheiser HD 660S2",
      src: "oratory1990",
      pre: -5.3,
      bands: [
        [105, 4.3, 0.71, "lshelf"],
        [220, -2.4, 0.6],
        [1800, 1.5, 1.2],
        [4800, -2.9, 3.1],
        [10000, 1.4, 0.7, "hshelf"],
      ],
    },
    {
      name: "Sennheiser HD 650",
      src: "Rtings",
      pre: -6.8,
      bands: [
        [105, 6.1, 0.71, "lshelf"],
        [160, -1.9, 0.7],
        [3100, 3.6, 2.4],
        [5900, -2.6, 3.2],
        [10000, 2.0, 0.7, "hshelf"],
      ],
    },
  ],
};

/**
 * The pipeline set the mock opens on (model/flags.js `pipelines`), with the drawer schema built for its outputs. Call once
 * (main.js) and share the result: the chain and the Profile builder edit the same PIPELINES and mount the same schema.
 * @param {import('../../model/shell/flags.js').Flags} flags
 */
export function pipelineSet(flags) {
  const PIPELINES = SETS[flags.pipelines];
  // Output tab names spelled out (`Left Out | Right Out`) while they fit the drawer head (~470px of tabs), short beyond.
  const FULL_FITS =
    "Overview".length * 7 +
      22 +
      Array.from({ length: PIPELINES.outputs }, (_, o) => `${chName(o)} Out`.length * 7 + 22).reduce(
        (a, b) => a + b,
        0,
      ) <=
    470;
  /** @param {number} o */
  const OUT_LABEL = (o) => (FULL_FITS ? `${chName(o)} Out` : chShort(o));
  // Tabs: Overview = the routing alone; then one tab per output channel, named like the grid's columns.
  /** @type {import('./output.js').DrawerSchema} */
  const PIPELINES_DRAWER = {
    id: "pipelines",
    family: "matrix",
    title: "DSP pipelines",
    aria: "DSP pipelines settings",
    restart: true,
    tabs: [
      { id: "overview", label: "Overview", body: [{ block: "pl-overview" }] },
      ...Array.from({ length: PIPELINES.outputs }, (_, o) => ({
        id: `out${o}`,
        label: OUT_LABEL(o),
        body: [{ block: `pl-out${o}` }],
      })),
    ],
  };
  return { PIPELINES, PIPELINES_DRAWER, FULL_FITS };
}
