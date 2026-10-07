// Matrix response plot (Matrix engine section). PLACEHOLDER shape only — not a measurement, not a filter
// characterization. Reads like a room-correction filter: narrow cuts at low-frequency modes, a mild fill,
// flattening above the correction window, gentle HF tilt.

export const MATRIX_PLOT = {
  range: 12, // ±dB shown
  fMin: 20,
  fMax: 20000, // Hz, log axis
  // Peaking bands: [centre Hz, gain dB, width in octaves (Gaussian sigma)]
  bands: [
    [26, 1.5, 0.35],
    [41, -8.5, 0.1],
    [58, 2.6, 0.12],
    [84, -6.2, 0.09],
    [118, -3.8, 0.12],
    [160, 1.8, 0.15],
    [215, -2.6, 0.18],
    [310, 1.2, 0.25],
    [480, -1.1, 0.35],
    [900, 0.6, 0.5],
    [2600, -1.4, 0.8],
    [5200, 0.9, 0.6],
  ],
  tilt: { from: 1000, dbPerOct: -0.9 }, // soft-knee downward tilt above `from`
  top: { from: 16000, dbPerOct: -3 }, // extra drop at the very top
};

// ── Matrix engine family drawers ────────────────────────────────────────────
// One drawer per rail stage (Matrix engine, Crossfeed, Loudness, DAC correction; DSP pipelines not drawn yet). All of
// them edit the matrix profile in focus (the profile carries the whole matrix context, post-process included:
// protocol.md "Matrix profile commands"), so they form one drawer family: staging is
// profile-wide, one Apply writes the profile. Every setting here is a restart-lane edit (restore lane, ~5.6 s); nothing
// is live. Strings: v1 data/settings.json (manual §7 / readme §1.11, verbatim), v1 store/schema/postprocess.js + dsp.js
// labels, v1 store/schema/gray.js reasons, v1 components/xfeed (owner copy). Engine tokens from the 6.0.4 /matrix form.
// Mock state: matrix on, profile [Default], overlap-add, Expand HF off, IIR to FIR none; crossfeed off (Speakers
// station); loudness on at the form defaults; DAC correction off.

export const MATRIX_BYPASS = "Matrix engine is bypassed. These settings have no effect."; // v1 gray.js
/**
 * The Matrix engine family's gray reason: the bypass line while Matrix processing is bypassed.
 *
 * @param {Record<string, unknown>} v  staged values by control id
 * @returns {string}
 */
export const bypassed = (v) => (v.mxen === "0" ? MATRIX_BYPASS : "");

// Matrix engine drawer intro: DRAFT (agent; the manual has no lead for the family). Names the drawers the matrix engine
// runs, each a link there (`{to}` = main.js xrefGo id), and what the gate below does to them (main.js: bypassed, their
// lamps go dark and their settings are kept). Owner ruling: never define the matrix engine by what it doesn't do.
const MX_INTRO = [
  "The matrix engine runs your matrix profile: ",
  { to: "drawer-pipelines", label: "DSP pipelines" },
  ", ",
  { to: "drawer-crossfeed", label: "Crossfeed" },
  ", ",
  { to: "drawer-loudness", label: "Loudness" },
  " and ",
  { to: "drawer-correction", label: "DAC correction" },
  ". Bypassing it stops them all; their settings are kept for when you engage it again.",
];

const MX = {
  enabled:
    "Matrix processing offers a way to copy, route, filter and mix down channels with specified gains. Matrix processing consists of a maximum of 128 virtual channels (pipelines); the number of active pipelines can be configured through advanced settings.",
  engine: "Convolution engine used for the filter(s) defined in Process.",
  expandHf:
    "For filters using a low sampling rate, the frequency response of the filter can be extended beyond the Nyquist frequency of the filter's sampling rate by selecting Expand HF. When choosing a format for convolution filters, extended frequency response convolution filters with a 352.8 kHz sampling rate are optimal for all kinds of source material. When such filters are used, Expand HF can be left disabled.",
  iir2fir:
    "Using IIR to FIR, it is possible to choose whether parametric EQs are converted to a convolution EQ. In some cases, like GPU offloading, it may be more efficient to compute a set of parametric EQs as a convolution filter instead.",
};

// Engine enums (6.0.4 form): value = wire value, label = the engine's token. Per-option copy = manual §6 (convolution
// engine: the same two algorithms), each option's own sentence, verbatim; the only description the manual gives them
// (the options need their description AND the setting keeps its own).
// Order: default leftmost: overlap-add is the engine's default (v1 settings.json, manual §6).
const ENGINE = [
  { v: "1", label: "overlap-add", man: "“overlap-add” consumes less CPU power and is recommended." },
  { v: "0", label: "overlap-save", man: "Another alternative is “overlap-save” which consumes more CPU power." },
];
const IIR2FIR = [
  { v: "0", label: "none", man: "Disabled." },
  { v: "1", label: "direct", man: "Direct conversion, retains original minimum phase response." },
  {
    v: "2",
    label: "linear",
    man: "The EQ filter is converted to linear phase. Note! Conversion to linear phase will introduce some amount of unnatural pre-ringing in the audio band. This is why EQ filters are typically minimum phase. The higher the parametric filter's Q and dB values are, the more pre-ringing it will also introduce for linear phase. Therefore, the linear phase conversion works best with rather gentle EQ setups.",
  },
];
const OFF_ON = [
  { v: "0", label: "Off" },
  { v: "1", label: "On" },
];
// Stage gates (ENGAGE | BYPASS labels, v1 options.js ENGAGE_BYPASS). Order: default leftmost: every gate's factory default is bypass, so BYPASS | ENGAGE.
export const ENGAGE_BYPASS = [
  { v: "0", label: "Bypass" },
  { v: "1", label: "Engage" },
];
/**
 * @param {string} id
 * @param {string} aria
 * @param {string} value
 * @param {{ v: string, label: string }[]} list
 * @returns {import('./output.js').Control}
 */
const enumSeg = (id, aria, value, list) => ({
  type: "seg",
  id,
  cls: "enum",
  aria,
  value,
  options: list.map((o) => ({ v: o.v, label: o.label })),
});

/** @type {import('./output.js').DrawerSchema} */
export const MATRIX_DRAWER = {
  id: "matrix",
  family: "matrix",
  title: "Matrix engine",
  aria: "Matrix engine settings",
  restart: true,
  // Basic | Advanced: the gate + Expand HF, then the engine settings.
  tabs: [
    {
      id: "basic",
      label: "Basic",
      body: [
        { intro: MX_INTRO },
        {
          row: {
            label: "Matrix processing",
            man: MX.enabled,
            control: { type: "seg", id: "mxen", aria: "Matrix processing", value: "1", options: ENGAGE_BYPASS },
          },
        },
        {
          row: {
            label: "Expand HF",
            man: MX.expandHf,
            control: { type: "seg", id: "mxexpand", aria: "Expand HF", value: "0", options: OFF_ON },
          },
        },
      ],
    },
    {
      id: "advanced",
      label: "Advanced",
      body: [
        {
          row: { label: "Engine", man: MX.engine, optMan: ENGINE, control: enumSeg("mxengine", "Engine", "1", ENGINE) },
        },
        {
          row: {
            label: "IIR to FIR",
            man: MX.iir2fir,
            optMan: IIR2FIR,
            control: enumSeg("mxiir2fir", "IIR to FIR", "0", IIR2FIR),
          },
        },
      ],
    },
  ],
};

// ── DAC correction ──────────────────────────────────────────────────────────
// Model list = the 6.0.4 form's post_correction_dac0 options (they follow the output device). Combo backend: one model
// per sub-device (dac0, dac1 …): not drawn, the mock backend is ALSA.
/** @type {import('./output.js').DrawerSchema} */
export const CORRECTION_DRAWER = {
  id: "correction",
  family: "matrix",
  title: "DAC correction",
  aria: "DAC correction settings",
  restart: true,
  tabs: [
    {
      id: "correction",
      label: "DAC correction",
      body: [
        {
          row: {
            label: "DAC correction",
            man: "Performs corrections for the output signal of the selected DAC. These corrections are specific to a DAC model and output rate. When the Combo backend is used, there may be multiple corrections available, one for each sub-device's DAC. Applied to the output mix bus, meaning output channels after matrix processing.",
            control: {
              type: "seg",
              id: "dcen",
              aria: "DAC correction",
              value: "0",
              options: ENGAGE_BYPASS,
              gray: bypassed,
            },
          },
        },
        {
          row: {
            label: "DAC model",
            man: "Defines the DAC model for correction. These corrections are specific to a DAC model and output rate. On combo, the DAC model is defined per sub-backend.",
            control: {
              type: "select",
              id: "dcdac",
              aria: "DAC model",
              value: "",
              gray: bypassed,
              options: [
                { v: "", label: "[none]" },
                { v: "Holo Audio Spring 2", label: "Holo Audio Spring 2" },
                { v: "Holo Audio Spring 3 / May", label: "Holo Audio Spring 3 / May" },
                { v: "Holo Audio Cyan 2", label: "Holo Audio Cyan 2" },
              ],
            },
          },
        },
      ],
    },
  ],
};

// ── Crossfeed ───────────────────────────────────────────────────────────────
// Two implementations, mutually exclusive by construction (the matrix runs before post-process: both at once is two
// crossfeeds in series; v1 xfeed/Card.js). Bauer = HQPlayer's post-process (libbs2b); Structural = HQPTuner's
// sixteen-pipeline block (v1 docs/crossfeed-math.md). One choice: Off | Bauer | Structural; the picked line holds its
// controls, the unpicked one folds to a summary line.
export const CROSSFEED = {
  mode: "off",
  bauer: { preset: "default", freq: 700, level: 4.5, comp: 100 },
  structural: { angle: 30, circ: 54.98, lambda: 0.7 }, // v1 defaults: Standard preset, a = 8.75 cm
  presets: [
    { v: "default", label: "Default" },
    { v: "cmoy", label: "Chu Moy" },
    { v: "jmeier", label: "Jan Meier" },
    { v: "custom", label: "Custom" },
  ],
  sPresets: [
    // v1 lib/binaural-setup.js PRESETS
    { v: "standard", label: "Standard", angle: 30, lambda: 0.7 },
    { v: "anechoic", label: "Anechoic", angle: 30, lambda: 1.0 },
    { v: "intimate", label: "Intimate", angle: 22, lambda: 0.7 },
    { v: "wide", label: "Wide", angle: 45, lambda: 0.5 },
    { v: "neutral", label: "Neutral center", angle: 30, lambda: 0.0 },
  ],
  man: {
    bauer:
      "Bauer cross-feed is processing for headphones, intended to make the listening experience more natural and spacious. This is a very simple model with three presets. Applied to the output mix bus, meaning output channels after matrix processing.",
    preset:
      "Sets one of the available presets: default parameters, Chu Moy's parameters, Jan Meier's parameters, or custom parameters according to frequency and level. When the custom preset is selected, the cross-feed filter frequency and level can be entered.",
    freq: "Sets cross-feed cross-over filter frequency, in integer Hz (custom preset only).",
    level: "Sets cross-feed level, in decimal dB (custom preset only).",
    comp: "Crossfeed makes centered sound — vocals, bass, most of the mix — slightly duller in the treble than the sides, much as real speakers do. This brings the centered part back to neutral, without touching the crossfeed's stereo effect.",
    compScale: "0% off · 100% neutral · above 100% brighter than neutral",
    angle:
      "How far apart the speakers being simulated are. Narrower blends the channels more; wider approaches plain headphones.",
    circ: "Measure with a tape around your head just above the ears — the same figure hat sizes use. The model works from the radius, shown under the value. A larger head means a longer path around it: more delay between the ears and more treble shadowing.",
    lambda:
      "Speakers color centered sound — vocals, bass, most of a mix — slightly darker than the sides. 100% reproduces that; 0% leaves the center tonally neutral. The stereo image is identical at every setting: only the tone of centered sound changes.",
    linear: "Linear-phase conversion flattens the group delay, which is what carries the delay between your ears.", // v1 binaural-setup.js
  },
};

// What runs (xfmode), by name: the rail value and the Profile builder's Crossfeed answer.
export const XF_MODES = [
  { v: "off", label: "Off" },
  { v: "bauer", label: "Bauer" },
  { v: "structural", label: "Structural" },
];

// ── Loudness ────────────────────────────────────────────────────────────────
// Form defaults (6.0.4 /matrix): bass lshelf 80 Hz, 0.5, +20 dB; treble hshelf 5000 Hz, 1.0, +10 dB; range −60 … −20.
// The range bounds are also drawn, read-only, on the Volume drawer's Range bar (its `Loudness ›` link opens this drawer).
export const LOUDNESS = {
  on: "1",
  low: { type: "lshelf", freq: 80, steep: 0.5, level: 20 },
  high: { type: "hshelf", freq: 5000, steep: 1.0, level: 10 },
  rangeLow: -60,
  rangeHigh: -20,
  types: { low: ["lshelf", "peak", "peakq"], high: ["hshelf", "peak", "peakq"] },
  man: {
    enabled:
      "Volume-adaptive loudness control with adjustable parameters. For bass and treble, the corner frequency, slope factor (see IIR plugin), and level can be adjusted. Lower bound is the volume setting where, at or below, the maximum loudness value is reached. Upper bound is the volume setting where, at or above, the loudness value reaches 0 dB. Applied to the output mix bus, meaning output channels after matrix processing.",
    low: {
      type: "Bass adjustment filter type: low shelf, peak with bandwidth, or peak with Q.",
      freq: "Bass adjustment corner frequency in Hz.",
      steep: "Bass adjustment slope factor. See the IIR plugin: s is the factor (1 = maximum steepness).",
      level: "Bass adjustment level in dB.",
    },
    high: {
      type: "Treble adjustment filter type: high shelf, peak with bandwidth, or peak with Q.",
      freq: "Treble adjustment corner frequency in Hz.",
      steep: "Treble adjustment slope factor. See the IIR plugin: s is the factor (1 = maximum steepness).",
      level: "Treble adjustment level in dB. Set to 0 for bass-only loudness compensation.",
    },
    rangeLow: "The volume setting where, at or below, the maximum loudness value is reached.",
    rangeHigh: "The volume setting where, at or above, the loudness value reaches 0 dB.",
  },
  off: "Enable loudness to adjust.", // v1 gray.js loudnessOff
};

/** @type {import('./output.js').DrawerSchema} */
export const LOUDNESS_DRAWER = {
  id: "loudness",
  family: "matrix",
  title: "Loudness",
  aria: "Loudness settings",
  restart: true,
  tabs: [
    {
      id: "loudness",
      label: "Loudness",
      body: [
        {
          row: {
            label: "Loudness",
            man: LOUDNESS.man.enabled,
            control: {
              type: "seg",
              id: "ldon",
              aria: "Loudness",
              value: LOUDNESS.on,
              options: ENGAGE_BYPASS,
              gray: bypassed,
            },
          },
        },
        { block: "loudness" },
      ],
    },
  ],
};

/** @type {import('./output.js').DrawerSchema} */
export const CROSSFEED_DRAWER = {
  id: "crossfeed",
  family: "matrix",
  title: "Crossfeed",
  aria: "Crossfeed settings",
  restart: true,
  tabs: [{ id: "crossfeed", label: "Crossfeed", body: [{ block: "crossfeed" }] }],
};
