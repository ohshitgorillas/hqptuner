// The Crossfeed block's strings the settings metadata does not hold (owner copy). Labels and paragraphs the metadata
// holds come through store/prose.js.

/** The crossfeed compensation's manual paragraph. */
export const COMP_MAN =
  "Crossfeed makes centered sound — vocals, bass, most of the mix — slightly duller in the treble than the sides, much as real speakers do. This brings the centered part back to neutral, without touching the crossfeed's stereo effect.";

/** The scale beside the compensation slider. */
export const COMP_SCALE = "0% off · 100% neutral · above 100% brighter than neutral";

/**
 * The tilt readout beside the compensation slider.
 *
 * @param {string} db
 */
export const compTilt = (db) => `crossfeed dulls the center by ${db} dB`;

/** The Structural controls' manual paragraphs, by control. */
export const STRUCTURAL_MAN = {
  angle:
    "How far apart the speakers being simulated are. Narrower blends the channels more; wider approaches plain headphones.",
  circ: "Measure with a tape around your head just above the ears — the same figure hat sizes use. The model works from the radius, shown under the value. A larger head means a longer path around it: more delay between the ears and more treble shadowing.",
  lambda:
    "Speakers color centered sound — vocals, bass, most of a mix — slightly darker than the sides. 100% reproduces that; 0% leaves the center tonally neutral. The stereo image is identical at every setting: only the tone of centered sound changes.",
};

/** The block's labels: the two lines, the compensation and the Structural controls. */
export const LABEL = {
  bauer: "Bauer",
  structural: "Structural",
  comp: "Crossfeed compensation",
  preset: "Preset",
  custom: "Custom",
  angle: "Speaker angle",
  circ: "Head circumference",
  lambda: "Center character",
};

/**
 * The head circumference's sublabel.
 *
 * @param {string} cm
 */
export const radiusSub = (cm) => `${cm} cm radius`;

/** The Structural drawing's readouts. */
export const READOUT = {
  itd: "Ear-to-ear delay",
  far: "Far ear, treble",
  center: "Center shift",
  /** @param {number} us */
  itdLow: (us) => ` · ${us} µs at low frequencies`,
};

/** The Bauer plot's trace names. */
export const TRACE = {
  uncorrected: "center, uncorrected",
  /** @param {number} pct */
  corrected: (pct) => `center, corrected ${pct}%`,
  sides: "stereo sides",
};

/** The gate's name and the accessible names. */
export const NAME = {
  gate: "Crossfeed",
  lines: "Crossfeed implementation",
  plot: "Bauer crossfeed response",
  diagram: "Top-down view: the simulated speakers, toed in toward the listener",
};
