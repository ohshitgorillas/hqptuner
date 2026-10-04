// The DSP pipelines drawer's copy and plugin tables, carried from the faceplate mockup (mockup/scripts/data/stages/
// pipelines.js and its pipelines/ components): the manual's Pipelines, gain and plugin paragraphs (v1 settings.json
// matrix_pipelines, manual §7 / readme §1.11.1, verbatim), the manual's plugin tables (§7.2-7.4, verbatim), v1's stage
// kind labels (StageEditor), and the drawer's own names for the crossfeed blocks.

export const PMAN = {
  pipelines:
    'Description of a virtual channel / processing pipeline. "Source Ch" specifies the channel used as the source for the virtual channel. "Gain" is the overall gain applied to the virtual channel, and "Mix Ch" is the logical output channel. When multiple virtual channels have the same target channel, the outputs of the virtual channels are mixed together to the target output channel. "Process" can define external filter impulse response WAV file(s) for convolution, a parametric equalizer specification in RoomEqWizard text output format, and parametric filter specifications.',
  gain: "Gain can be applied in either dB scale or linear scale, as selected in the corresponding column. Linear scale factors can also be negative to perform phase inversion; this allows, for example, M/S processing.",
  iirUnits: "Where f is in Hz, BW is factor, s is factor (1 maximum steepness) and g is in dB.",
  delay: "Delay plugin provides specified amount of delay.",
  riaa: "RIAA plugin provides RIAA EQ curve correction for vinyl playback. Currently plugin provides only one adjustable parameter “subsonic” which is additional 20 Hz subsonic filter pole, with values of “1” (enabled) and “0” (disabled). For best performance an accuracy, use input sampling rate of 192 kHz or higher. Minimum recommended input sampling rate is 96 kHz.",
  conv: "When choosing format for convolution filters, for most optimal case for all kinds of source material, use extended frequency response convolution filters with 352.8 kHz sampling rate. When such are used, Expand HF can be left disabled for all cases.",
  peqFile:
    "Various headphone equalization files can be found from AutoEq. Choose the ParametricEQ txt file. This can be directly used in HQPlayer matrix processor without modifications and also includes gain compensation data.",
};

/** @typedef {import("../../../../model/shell/pipelines-edit.js").IirType} IirType */
/** @typedef {import("../../../../model/shell/pipelines-edit.js").DelayArg} DelayArg */

/** The iir plugin table (manual §7.3), in the manual's order. `alt` is the either/or width argument. @type {IirType[]} */
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
/** The row an iir stage of an unlisted type is edited as: the peaking filter. */
export const IIR_FALLBACK = IIR_TYPES[7];

/** @type {Record<string, string>} */
export const ARG_NAME = { f: "frequency", q: "Q", s: "slope", bw: "bandwidth", g: "gain" };
/** @type {Record<string, string>} */
export const ARG_UNIT = { f: "Hz", g: "dB" };
/** @type {Record<string, string>} */
export const WIDTH_NAME = { q: "Q", bw: "Bandwidth", s: "Slope" };

/** The delay plugin table (manual §7.2). @type {DelayArg[]} */
export const DELAY_ARGS = [
  { a: "s", d: "Delay in number of samples at source rate", unit: "samples" },
  { a: "t", d: "Delay in time, number of seconds", unit: "s" },
  { a: "d", d: "Delay in distance, number of meters", unit: "m" },
];
/** The argument a delay given in none of them is edited as: seconds. */
export const DELAY_FALLBACK = DELAY_ARGS[1];
/** @type {DelayArg} */
export const DELAY_V = { a: "v", d: "Velocity of sound, in m/s, default 343.956", unit: "m/s" };
/** @type {Record<string, string>} */
export const DELAY_NAME = { s: "Samples", t: "Seconds", d: "Meters" };

/** Stage kinds for `+` and the dock's Stage picker (v1 StageEditor labels). */
export const KINDS = [
  { k: "iir", label: "Parametric (IIR)" },
  { k: "delay", label: "Delay" },
  { k: "riaa", label: "RIAA" },
  { k: "conv", label: "Convolution" },
];

/** A crossfeed block's name, by kind. @type {Record<string, string>} */
export const BLOCK_NAME = {
  structural: "Structural Crossfeed",
  comp: "Bauer Crossfeed compensation",
};

/** The width hint under an iir stage whose width can be given two ways, by the second way. @type {Record<string, string>} */
export const WIDTH_HINT = {
  bw: "Width can be given as a Q or as a Bandwidth: a higher Q is narrower, a higher Bandwidth is wider.",
  s: "Steepness can be given as a Q or as a Slope: Slope 1 is the steepest it gets without overshoot.",
};
