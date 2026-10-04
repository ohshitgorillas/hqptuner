// The faceplate page's sections: engaged stages only, in signal order, each with whether it takes the spare height
// (the fill) and whether it sits folded to its header line. Free of the DOM and the store; the caller hands in the
// running path, the running matrix engine and the browser's own preferences.

import { fillLayout } from "./frame.js";

/** @typedef {"source" | "matrix" | "resampling" | "shaping" | "output"} SectionId */

/**
 * One section of the page.
 *
 * @typedef {object} PageSection
 * @property {SectionId} id  the rail's stage id
 * @property {boolean} fill  the section takes the spare height; exactly one does
 * @property {boolean} fold  the section sits on its header line, no body
 */

/**
 * What the page is built from.
 *
 * @typedef {object} PageNow
 * @property {string} path        the playback path, store/faceplate/path.js
 * @property {boolean} matrixOn   the matrix engine as running
 * @property {string} topOfPage   Top of page: auto | profile | spectrum
 * @property {boolean} pinsOn     Allow pinned rates
 */

/** @type {SectionId[]} */
const SIGNAL_ORDER = ["source", "matrix", "resampling", "shaping", "output"];

// The top section reads no scene or no-stream line: those only say what the spectrum shows, never whether it does.
const AT_REST = { id: "", playing: false };
const NO_LINES = { meterIdle: "", meterDsd: "" };

/**
 * The page's sections in signal order. Source shows wherever the spectrum does; the Matrix section stands at the top,
 * folds to its header line or is absent as the top section decides, and is absent while the matrix engine is bypassed;
 * Direct SDM takes Resampling and Shaping out of the path; Output shows only with pinned rates allowed. The spectrum
 * takes the fill while it shows, else the Matrix section at the top does.
 *
 * @param {PageNow} now
 * @returns {PageSection[]}
 */
export function pageSections({ path, matrixOn, topOfPage, pinsOn }) {
  const top = fillLayout(matrixOn, topOfPage, AT_REST, NO_LINES);
  const processed = path !== "direct";
  /** @type {Record<SectionId, boolean>} */
  const engaged = {
    source: top.show,
    matrix: top.profile || top.fold,
    resampling: processed,
    shaping: processed,
    output: pinsOn,
  };
  const fill = top.show ? "source" : "matrix";
  return SIGNAL_ORDER.filter((id) => engaged[id]).map((id) => ({
    id,
    fill: id === fill,
    fold: id === "matrix" && top.fold,
  }));
}
