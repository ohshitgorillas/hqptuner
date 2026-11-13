// The two chain families, PCM and SDM: the family a value names, the rate a 1-bit bitstream starts at, and the output
// mode the engine's reported mode name selects.

/** @typedef {"pcm" | "sdm"} Family */

const DSD_FLOOR = 2822400; // DSD64 (44.1k × 64), the lowest 1-bit bitstream rate

/**
 * The family a value names; anything but SDM reads as PCM.
 *
 * @param {unknown} v
 * @returns {Family}
 */
export const familyOf = (v) => (v === "sdm" ? "sdm" : "pcm");

/**
 * Whether a rate is a 1-bit bitstream's: at or above DSD64.
 *
 * @param {unknown} rate  hertz, as a number or the engine's string
 * @returns {boolean}
 */
export const isDsdRate = (rate) => Number(rate) >= DSD_FLOOR;

// Mode is the one live field whose value is a name rather than a number. The
// modes enumeration is device-dependent — it drops SDM on a device that cannot
// do DSD — so the form value is matched from the item's NAME, exactly as
// routing._mode_form_value does on the other side.
/**
 * The mode form value an engine mode name matches, "" when it matches none.
 *
 * @param {string} modeName
 * @returns {"auto" | "pcm" | "sdm" | ""}
 */
export function modeOfName(modeName) {
  const name = modeName.toUpperCase();
  if (name.startsWith("[SOURCE]")) return "auto";
  if (name.startsWith("PCM")) return "pcm";
  return name.startsWith("SDM") || name.startsWith("DSD") ? "sdm" : "";
}
