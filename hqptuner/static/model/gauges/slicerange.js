// Which slices of the spectrogram's history a paint draws: those inside the window of playback `span` wide whose right
// edge is `edge`. A slice is inside when it ends by the edge and starts no earlier than `span` before it.
//
// The history is stamped and sorted by `at`, slices laid end to end, so both a slice's start and its end rise with its
// index. Both bounds are found by binary search: the cost grows with the log of the history, and nothing is allocated.

import { endOf, startOf } from "../../lib/timebase.js";

/** @typedef {import("../../lib/timebase.js").Stamped} Stamped */

/**
 * The first index in `[lo, hi)` whose slice satisfies `past`, or `hi` when none does; `past` must be false for a
 * prefix of the range and true for the rest.
 *
 * @param {ArrayLike<Stamped>} slices
 * @param {number} lo
 * @param {number} hi
 * @param {(s: Stamped) => boolean} past
 */
function firstPast(slices, lo, hi, past) {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (past(slices[mid])) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * The index range `[lo, hi)` of the slices inside `[edge - span, edge]`.
 *
 * @param {ArrayLike<Stamped>} slices  oldest first; playback, ms
 * @param {number} span  playback, ms: the window's width
 * @param {number} edge  playback, ms: the window's right edge
 * @returns {{ lo: number, hi: number }}
 */
export function sliceRange(slices, span, edge) {
  const from = edge - span;
  const hi = firstPast(slices, 0, slices.length, (s) => endOf(s) > edge);
  const lo = firstPast(slices, 0, hi, (s) => startOf(s) >= from);
  return { lo, hi };
}
