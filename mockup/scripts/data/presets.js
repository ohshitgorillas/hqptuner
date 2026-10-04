// Filter presets (Easy Mode tiles, renamed). Copy is owner copy — verbatim, never paraphrase.
// Mock state: SDM mode, Lossless, 44.1k source. Flagships offer no Emphasis (hi-res filter is on Nx only).
//
// filters:    [{stage, name}] — stage omitted when one filter serves both stages
// knobs:      per-preset adjustments; each option {label, on?, title?}; knob.title = tooltip on the whole knob
// correction: 'full' | 'partial' | 'none'  (error correction / apodizing coverage)
// cost:       {pips: n} or {word: '…'}     (resource use)
// current:    running and selected (Live lane)

const HIRES_TIP =
  "Uses a special hi-res-optimized filter at rates above 48 kHz; these filters can also be used for Lossy content";

const SPACE_TIP =
  "Choose 'Space' for live or acoustic performances where the room or venue is part of the recording. This is far from a hard rule, so experiment with both and find what sounds best to you.";
const TRANSIENTS_TIP =
  "Choose 'Transients' for multi-track studio material, which often has an artificial sense of space but strong transient content. This is far from a hard rule, so experiment with both and find what sounds best to you.";

const emphasis = (pick) => ({
  label: "Emphasis",
  options: [
    { label: "Space", title: SPACE_TIP, on: pick === "space" },
    { label: "Transients", title: TRANSIENTS_TIP, on: pick === "transients" },
  ],
});
const correctionKnob = {
  label: "Correction",
  title: "Disabling error correction reduces resource consumption.",
  options: [{ label: "On", on: true }, { label: "Off" }],
};

/**
 * Subsets (Concert Hall and The Crucible are the flagships taken further, without a Version knob).
 * `lanes` = the flagships that carry them; each flagship expands to show both, in its own version: every filter under The
 * Perfect Ten is a Gaussian variant, every one under Lifelike an Extended frequency response v2 variant
 * (filter-plain-names.json). rows[subset][flagship]: filter per Correction position (`fixed` = one filter, no
 * non-correcting twin: Correction can't reach it, v1 `when`), cost (v1 easycost.js: SDM pips; Correction Off costs one pip
 * less; Crucible under The Perfect Ten is the `Adaptive` caption). Filter names from v1 store/easy/easy.js FILTERS.
 */
export const LINEAGE = {
  lanes: ["perfect-ten", "lifelike"],
  rows: {
    "concert-hall": {
      "perfect-ten": { on: "poly-sinc-gauss-xla", off: "poly-sinc-gauss-xl", cost: { pips: 17 } },
      lifelike: { on: "poly-sinc-ext2-xla", off: "poly-sinc-ext2-xl", cost: { pips: 17 } },
    },
    crucible: {
      "perfect-ten": { on: "sinc-MGa", off: "sinc-MG", cost: { word: "Adaptive" } },
      lifelike: { fixed: "sinc-M", cost: { pips: 17 } },
    },
  },
};

export const PRESET_COLUMNS = ["Preset", "Filter", "Adjust", "Correction", "Resources"];

export const CORRECTION_LABELS = {
  full: "Full error correction",
  partial: "Partial error correction",
  none: "No error correction",
};

export const PRESETS = [
  {
    id: "perfect-ten",
    emoji: "🥇",
    name: "The Perfect Ten",
    hires: true,
    desc: "Does everything well, no strings attached: the best-case solution to the tension at the heart of filter design.",
    filters: [
      { stage: "1x", name: "poly-sinc-gauss-long" },
      { stage: "Nx", name: "poly-sinc-gauss-hires-lp" },
    ],
    knobs: [],
    correction: "full",
    cost: { pips: 2 },
  },
  {
    id: "lifelike",
    emoji: "🎻",
    name: "Lifelike",
    hires: true,
    current: true,
    desc: "Puts the focus on natural, realistic timbre.",
    filters: [
      { stage: "1x", name: "poly-sinc-ext2" },
      { stage: "Nx", name: "poly-sinc-ext2-hires-mp" },
    ],
    knobs: [],
    correction: "full",
    cost: { pips: 2 },
  },
  {
    id: "damage-control",
    emoji: "🚑",
    name: "Damage Control",
    desc: "Aggressive clean-up; great for loudness war-era and other less-than-good material.",
    filters: [{ name: "poly-sinc-xtr-short-lp-2s" }],
    knobs: [emphasis("space")],
    correction: "full",
    cost: { pips: 1 },
  },
  {
    id: "old-school",
    emoji: "📻",
    name: "Old School",
    desc: "Pairs well with classic-era analog recordings.",
    filters: [{ name: "poly-sinc-short-mp-2s" }],
    knobs: [emphasis("transients")],
    correction: "partial",
    cost: { pips: 1 },
  },
  {
    id: "purist",
    emoji: "💧",
    name: "The Purist",
    desc: "Passes the original samples through unchanged. Only for the highest technical quality source material.",
    filters: [{ name: "poly-sinc-gauss-halfband" }],
    knobs: [],
    correction: "none",
    cost: { pips: 2 },
  },
  {
    id: "concert-hall",
    emoji: "🏛️",
    name: "Concert Hall",
    desc: "Heavily emphasizes space over transients; for material like live classical with minimal transient content.",
    filters: [{ name: "poly-sinc-gauss-xla" }],
    knobs: [correctionKnob],
    correction: "full",
    cost: { pips: 17 },
  },
  {
    id: "crucible",
    emoji: "🔥",
    name: "The Crucible",
    desc: "'Concert Hall' taken to the extreme using a maximalist, brute-force reconstruction approach.",
    filters: [{ name: "sinc-MGa" }],
    knobs: [correctionKnob],
    correction: "full",
    cost: { word: "Adaptive" },
  },
  {
    id: "full-analog",
    emoji: "🎛️",
    name: "Full Analog",
    desc: "Imitates the smooth and relaxing sound of an analog playback chain.",
    filters: [{ name: "IIR2" }],
    knobs: [],
    correction: "full",
    cost: { word: "CPU-bound" },
  },
  {
    id: "textbook",
    emoji: "📖",
    name: "Textbook",
    desc: "The sound of most standard-issue DAC hardware.",
    filters: [{ name: "FIR" }],
    knobs: [emphasis("space")],
    correction: "full",
    cost: { pips: 1 },
  },
];

export { HIRES_TIP };
