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

// The help copy names the marks in the middle of a sentence, and a mark is
// drawn geometry rather than a character — there is no circled one-half in
// Unicode to type. So the approved string carries a plain-text stand-in and the
// panel swaps the real mark in where it finds one. The stand-in is what the
// sentence would say if nothing were substituted, which keeps the copy legible
// on its own and leaves the owner nothing new to learn.
/** @type {Record<string, string>} */
const STANDIN = { "(A)": "full", "(1/2)": "half" };

/** Matches every stand-in, and captures it, so a split keeps the pieces. */
const SPLIT = /(\(A\)|\(1\/2\))/g;

/**
 * One paragraph broken into its text runs and the marks named inside it. A run
 * is `{text}`; a mark is `{kind}`.
 *
 * @param {string} para
 * @returns {{text?: string, kind?: string}[]}
 */
export function markRuns(para) {
  return para
    .split(SPLIT)
    .filter((piece) => piece !== "")
    .map((piece) => (STANDIN[piece] ? { kind: STANDIN[piece] } : { text: piece }));
}
