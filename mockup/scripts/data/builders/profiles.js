// Matrix profiles, per station (Profile builder; the page's Matrix profile select and the Snapshot builder's profile row
// list the active station's). A profile is the whole matrix context (v1 ProfileCard: "the settings in General, the current
// pipelines, and the crossfeed, DAC correction and loudness that run with them"): every Matrix engine family value.
// `[Default]` is the daemon's name for the station's unnamed profile (readme §1.12): it can't be renamed or deleted.
//
// Mock records hold only what differs from the station's applied matrix (the chain's family values at load); `pipes`
// rewrites the mock pipeline set (whatever `#mch` / `#dense` / `#71` loaded), so every record fits the drawers' channel
// layout. Descriptions are the user's own text (v1 profile descriptions), keyed by profile.
//
import { AUTOEQ } from "../stages/pipelines.js";
import { PEQ_TYPES, bandsToStages, replacePeq } from "../../../../hqptuner/static/model/gauges/eq.js";

// Copy: v1 verbatim (ProfileCard placeholders, Ask.js `Enter a name first`); the confirm lines are v1's Ask grammar
// (`Preset "x" already exists. Overwrite it?`, `Delete preset "x"? This cannot be undone.`) with `Profile`, as the
// Snapshot builder took them with `Snapshot`.

/**
 * A matrix profile's mock record: the user's description, the listening it is for, `flat` = it changes nothing (the
 * A/B reference), the Matrix engine family values it changes (by control id), and how it rewrites the pipeline set.
 *
 * @typedef {object} Profile
 * @property {string} desc
 * @property {string} [listen]
 * @property {boolean} [flat]
 * @property {Record<string, string>} [vals]
 * @property {Rewrite} [pipes]
 */

/** @typedef {(pipes: import('../stages/pipelines.js').Pipeline[]) => import('../stages/pipelines.js').Pipeline[]} Rewrite  a profile's rewrite of the pipeline set */

/**
 * Scale every peak / shelf band's gain (f below `under` Hz only, when given) and set the pipelines' gain.
 *
 * @param {{ k?: number, under?: number, shift?: number, gain?: number }} how
 * @returns {Rewrite}
 */
const reshape =
  ({ k = 1, under = Infinity, shift = 1, gain }) =>
  (pipes) =>
    pipes.map((p) =>
      p.gen
        ? p
        : {
            ...p,
            gain: gain ?? p.gain,
            stages: p.stages.map((st) =>
              st.kind === "iir" && PEQ_TYPES.has(st.type ?? "") && st.f !== undefined && st.f < under
                ? { ...st, f: Math.round(st.f * shift), g: +(Number(st.g) * k).toFixed(1) }
                : st,
            ),
          },
    );

/**
 * An AutoEq hit (data/pipelines.js AUTOEQ) on the stereo pair: its bands replace the pair's peak / shelf stages.
 *
 * @param {{ bands: readonly import('../../../../hqptuner/static/model/gauges/eq.js').Band[], pre: number }} hit
 * @returns {Rewrite}
 */
const autoeq = (hit) => (pipes) =>
  pipes.map((p) =>
    p.gen || p.src > 1 || p.src !== p.mix ? p : { ...p, ...replacePeq(p, bandsToStages(hit.bands), hit.pre) },
  );

/** @type {Record<string, Record<string, Profile>>} */
export const PROFILES = {
  Speakers: {
    "[Default]": {
      desc: "Living room mains · REW correction measured at the listening chair.\nCrossfeed off for speakers; loudness on for late-night listening.",
    },
    Nearfield: {
      desc: "Desk monitors at 1 m. Room modes matter less up close: low bands halved, more headroom.",
      vals: { ldon: "0" },
      pipes: reshape({ k: 0.5, under: 200, gain: -2 }),
    },
    // Mock: the reference for A/B. `flat` = this profile changes nothing: the page's Matrix plot draws it flat (main.js
    // paintFill; the page picker names a profile but doesn't load its values into the drawers).
    Flat: {
      flat: true,
      desc: "No EQ, no crossfeed, no loudness. The reference for A/B.",
      vals: { ldon: "0" },
      pipes: reshape({ k: 0, gain: 0 }),
    },
    "Room EQ · sofa": {
      desc: "Measured from the sofa, 2.4 m back. Bands moved up a touch; IIR converted to FIR.",
      vals: { mxiir2fir: "1", ldrlow: "-55", ldrhigh: "-25" },
      pipes: reshape({ k: 1.2, shift: 1.05, gain: -4.5 }),
    },
  },
  Headphones: {
    "[Default]": {
      listen: "headphones",
      desc: "Open-backs at the desk. Structural crossfeed.",
      vals: {
        xfgate: "1",
        xfimpl: "structural",
        xfmode: "structural",
        ldon: "0",
        eqname: "Sennheiser HD 650 · oratory1990",
      },
      pipes: autoeq(AUTOEQ.hits[0]),
    },
    Bauer: {
      listen: "headphones",
      desc: "",
      vals: { xfgate: "1", xfimpl: "bauer", xfmode: "bauer", xfcomp: "100", ldon: "0" },
      pipes: reshape({ k: 0, gain: 0 }),
    },
  },
  Office: {
    "[Default]": {
      desc: "",
      vals: { dcen: "1", dcdac: "Holo Audio Spring 3 / May", ldon: "0" },
      pipes: reshape({ k: 0, gain: 0 }),
    },
  },
};

/**
 * The page's Matrix profile select: the active station's profiles.
 *
 * @param {string} station
 * @returns {string[]}
 */
export const STATION_PROFILES = (station) => Object.keys(PROFILES[station] ?? {});

/**
 * Loudness doesn't apply while Fixed volume is on (v1 gray.js loudnessGated: the volume reason + its own sentence).
 *
 * @param {() => boolean} fixed
 * @returns {string}
 */
const loudnessGated = (fixed) =>
  fixed()
    ? "Fixed volume bypasses the volume control. Volume-adaptive loudness cannot adapt — use a Matrix EQ for a volume-agnostic equivalent."
    : "";
/** Headphone Auto EQ: v1 Library.js / Tab.js copy. */
export const AEQ_COPY = {
  title: "Headphone Auto EQ", // v1 card title
  credit: "profiles:", // v1 credit line: `profiles: AutoEq (MIT)`
  /** @param {number} n */
  more: (n) => `…${n} more — refine the search`,
  /**
   * @param {number} n
   * @param {number | null} pre
   */
  bands: (n, pre) => `${n} band(s)${pre !== null ? ` · preamp ${pre} dB` : ""}`,
  load: "Load profile",
  clear: "Clear",
  file: "Load AutoEq / REW .txt…", // v1 Tab.js LoadEqButton
  conv: "Upload convolution filters", // owner copy (DSP pipelines Overview)
  preview: "preview", // v1 plot trace for the picked hit
};

// ── The builder: a guided walk ───────────────────────────
// It opens on an overview that says what the matrix engine is (one roof for everything but the HF filter, resampling,
// shaping and volume), shows it on the signal chain, says what the profile holds now, and offers the ways on: save it as
// it is (tuned by ear already), change something, or start from scratch. The steps walk one part at a time, each in the
// drawers' row grammar with the manual's own paragraphs; Back / Next; a step that doesn't apply is skipped with its
// reason. The last step returns to the overview (the review). DSP pipelines has its own access point there; Advanced
// settings only a quiet link at its foot.
// Settings copy is the manual's / v1's (data/matrix.js, data/pipelines.js).
export const LISTEN = [
  { v: "speakers", label: "Speakers" },
  { v: "headphones", label: "Headphones" },
]; // v1 Tab.js labels
/** Matrix engine family stages on the chain (the overview's picture lights these). */
export const MATRIX_STAGES = ["matrix", "pipelines", "crossfeed", "loudness", "correction"];
/** Stages outside the matrix engine: ink-2 in the overview's chain picture. */
export const OUTSIDE_STAGES = ["hf", "volume", "resampling", "shaping"];
export const PB_COPY = {
  intro:
    "A matrix profile keeps your EQ and correction, crossfeed, loudness and DAC correction together under one name, so you can switch between correction profiles for different pairs of headphones, or between EQ curves for different genres and moods, in one move. This builder walks through them one step at a time. Nothing you hear changes until you save.",
  holds: "What this profile holds",
  overview: "Overview",
  change: "Change something",
  scratch: "Start from scratch",
  back: "Back",
  next: "Next",
  review: "Review",
  skipped: "Skipped",
  advanced: "Advanced settings", // owner's name
  /**
   * @param {number} n
   * @param {number} t
   */
  stepOf: (n, t) => `Step ${n} of ${t}`,
  state: {
    dirtyRun: "Unsaved changes. Saving restarts the engine and runs this profile.",
    dirty: "Unsaved changes. Saving restarts the engine.",
    running: "Saved · running now.",
    saved: "Saved.",
  },
};
/**
 * The walk. guide(x) = what the step decides; skip(x) = why it doesn't apply here ('' = it does). x: model/builders/
 * profile.js StepContext.
 *
 * @type {{
 *   id: string,
 *   title: string,
 *   guide: (x: import('../../../../hqptuner/static/model/builders/profile.js').StepContext) => string,
 *   skip?: (x: import('../../../../hqptuner/static/model/builders/profile.js').StepContext) => string,
 * }[]}
 */
export const PB_STEPS = [
  {
    id: "listen",
    title: "Listening",
    guide: () => "Headphones and speakers take different paths through the steps that follow.",
  },
  {
    id: "eq",
    title: "EQ / Correction",
    guide: (x) =>
      x.listen === "headphones"
        ? "Load a correction you already have, or find your headphones in the AutoEq library."
        : "Load your room correction: a REW or AutoEq .txt file, or convolution filters.",
  },
  {
    id: "crossfeed",
    title: "Crossfeed",
    guide: () => "Crossfeed is for headphones: it lets a little of each channel reach the other ear, as speakers do.",
    skip: (x) => (x.listen === "speakers" ? "Skipped: crossfeed is for headphones." : ""),
  },
  {
    id: "correction",
    title: "DAC correction",
    guide: () => "Some DACs have a correction made for them. The models offered follow your output device.",
    skip: (x) => (x.models ? "" : "Skipped: there are no corrections for this output device."),
  },
  {
    id: "loudness",
    title: "Loudness",
    guide: () => "Loudness keeps bass and treble in balance as the volume goes down.",
    skip: (x) => loudnessGated(() => x.fixed),
  }, // v1 copy
];
/** Crossfeed: the implementations as choice lines (Bauer = the manual's paragraph). */
export const XF_LINES = {
  off: "No crossfeed: each channel reaches only its own ear.",
  structural: "A model of two speakers in front of you, built from your head size and the speakers' angle.",
};
/** "Do you know your settings?" as choice lines (both steps). */
export const KNOWN = {
  crossfeed: [
    { v: "preset", label: "Use a preset", man: "Pick one now, and tune it by ear on the chain once the profile runs." },
    { v: "values", label: "Enter my values", man: "Type in the values you already know." },
  ],
  loudness: [
    {
      v: "preset",
      label: "Use the defaults",
      man: "Start from the defaults, and tune by ear on the chain once the profile runs.",
    },
    { v: "values", label: "Enter my values", man: "Type in the values you already know." },
  ],
};

export const PROFILE_COPY = {
  noName: "Enter a name first", // v1 Ask.js
  name: "profile name", // v1 ProfileCard placeholder
  desc: "Room, mic, target, date — whatever the name can't hold.", // v1 ProfileCard placeholder
  descLabel: "Description", // v1 ProfileCard field label
  /** @param {string} n */
  overwrite: (n) => `Profile "${n}" already exists. Overwrite it?`,
  /** @param {string} n */
  remove: (n) => `Delete profile "${n}"? This cannot be undone.`,
};
