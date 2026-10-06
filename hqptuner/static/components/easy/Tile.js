// One preset, as a tile. Not a `Card` and deliberately not card markup: a card
// is a section of the page, and eight of these sit INSIDE one card
// (docs/design-system.md, one card component). A rounded box on the card
// surface is what it is, so that is what it paints.
//
// A tile holds no state at all. Which tile is lit and where each knob stands are
// read off the current filter values every render (store/easy/easy.js matchPreset),
// so there is nothing here to fall out of step with the fields a user can also
// edit by hand in the chain cards.
//
// Clicking writes the preset through store/easy/apply.js, which also says which
// mark the tile wears.

// The hi-res badge's two strings. Constants rather than copy read through
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
