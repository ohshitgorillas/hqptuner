// What the Filter presets popover calls a row's error-correction mark
// (faceplate/page/FilterPresets.js), its accessible name and its title.
//
// Constants rather than copy read through `easyProse`. Prose arrives with the
// metadata and is empty until it does, which for a caption means a line that
// appears a moment late, but for an `aria-label` means an image with no name at
// all on first paint.

/** @type {Record<string, string>} */
export const MARK_LABEL = {
  full: "Full error correction",
  half: "Partial error correction",
  none: "No error correction",
};
