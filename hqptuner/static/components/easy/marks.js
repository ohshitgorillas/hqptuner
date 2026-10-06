// What Easy Mode calls the apodizing marks, and where its prose asks for one.
//
// Shared by the tiles, which wear a mark, and the help panel, which explains
// them: one vocabulary in one place, so the panel cannot end up naming a mark
// something the tile does not.
//
// Constants rather than copy read through `easyProse`, unlike every visible
// string on a tile. Prose arrives with the metadata and is empty until it does,
// which for a caption means a line that appears a moment late, but for an
// `aria-label` means an image with no name at all on first paint. The
// dropdown's own two labels are constants for the same reason
// (controls/comborow.js).

/** @type {Record<string, string>} */
export const MARK_LABEL = {
  full: "Full error correction",
  half: "Partial error correction",
  none: "No error correction",
};
