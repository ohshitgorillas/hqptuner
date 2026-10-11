// The hi-res badge's two strings, on a Filter presets row
// (faceplate/page/FilterPresets.js). Constants rather than copy read through
// `easyProse`, for the reason marks.js gives about its own labels: prose arrives
// with the metadata and is empty until it does, and a badge sourced from it
// would paint an empty pill on first render and fill in a moment later.
//
// One string serves as both the hover tip and the badge's accessible name. The
// badge reads "Hi-Res", which names the thing without saying anything about it,
// so the sentence is what a screen reader should hear.
export const HIRES_LABEL = "Hi-Res";
export const HIRES_TIP =
  "Uses a special hi-res-optimized filter at rates above 48 kHz; these filters can also be used for Lossy content";

/**
 * @typedef {import("../../store/easy/easy.js").Preset} Preset
 * @typedef {import("../../store/easy/easy.js").Knob} Knob
 */
