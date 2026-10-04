// The Profile builder's copy and tables, as the mockup draws them.
// Plain data: no imports, no behavior beyond the step functions' string choices.

/** @typedef {import("../../../model/builders/profile.js").StepContext} StepContext */

/** Headphone Auto EQ copy. */
export const AEQ_COPY = {
  title: "Headphone Auto EQ",
  credit: "profiles:",
  /** @param {number} n */
  more: (n) => `…${n} more — refine the search`,
  /**
   * @param {number} n
   * @param {number | null} pre
   */
  bands: (n, pre) => `${n} band(s)${pre !== null ? ` · preamp ${pre} dB` : ""}`,
  load: "Load profile",
  clear: "Clear",
  file: "Load AutoEq / REW .txt…",
  conv: "Upload convolution filters",
  preview: "preview",
};

/** The listening choices. */
export const LISTEN = [
  { v: "speakers", label: "Speakers" },
  { v: "headphones", label: "Headphones" },
];

/** Matrix engine family stages on the chain. */
export const MATRIX_STAGES = ["matrix", "pipelines", "crossfeed", "loudness", "correction"];

/** Stages outside the matrix engine. */
export const OUTSIDE_STAGES = ["hf", "volume", "resampling", "shaping"];

/** The builder's overview and navigation copy. */
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
  advanced: "Advanced settings",
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
 * The walk: guide(x) says what the step decides, skip(x) says why it does not apply ("" = it does).
 *
 * @type {{
 *   id: string,
 *   title: string,
 *   guide: (x: StepContext) => string,
 *   skip?: (x: StepContext) => string,
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
    skip: (x) =>
      x.fixed
        ? "Fixed volume bypasses the volume control. Volume-adaptive loudness cannot adapt — use a Matrix EQ for a volume-agnostic equivalent."
        : "",
  },
];

/** Crossfeed implementations as choice lines. */
export const XF_LINES = {
  off: "No crossfeed: each channel reaches only its own ear.",
  structural: "A model of two speakers in front of you, built from your head size and the speakers' angle.",
};

/** The crossfeed Off line's name and the label over the "do you know your settings?" choices. */
export const STEP_LABELS = { off: "Off", settings: "Settings" };

/** "Do you know your settings?" choice lines for the crossfeed and loudness steps. */
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

/** Profile naming, description and confirmation copy. */
export const PROFILE_COPY = {
  noName: "Enter a name first",
  name: "profile name",
  desc: "Room, mic, target, date — whatever the name can't hold.",
  descLabel: "Description",
  /** @param {string} n */
  overwrite: (n) => `Profile "${n}" already exists. Overwrite it?`,
  /** @param {string} n */
  remove: (n) => `Delete profile "${n}"? This cannot be undone.`,
};

/** Manual copy for the EQ step's file and convolution inputs. */
export const EQ_MAN = {
  peqFile:
    "Various headphone equalization files can be found from AutoEq. Choose the ParametricEQ txt file. This can be directly used in HQPlayer matrix processor without modifications and also includes gain compensation data.",
  conv: "When choosing format for convolution filters, for most optimal case for all kinds of source material, use extended frequency response convolution filters with 352.8 kHz sampling rate. When such are used, Expand HF can be left disabled for all cases.",
};

/** Import EQ popover copy. */
export const AUTOEQ_COPY = {
  placeholder: "Search headphone model — e.g. HD 650…",
  mirror: "mirror to stereo pair",
};
