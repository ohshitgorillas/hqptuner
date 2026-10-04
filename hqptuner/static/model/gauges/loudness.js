// Loudness figures, free of the DOM: how much of the maximum shelving applies, as the whole percent the rail, the
// Loudness plot and the Profile builder print.

/**
 * A shelf scale (0 … 1: vendor/eqlab/core/dsp/curves.js shelfScale at the live volume, or 0 where loudness is not in
 * effect) as a whole percent, half up.
 *
 * @param {number} scale
 * @returns {number}
 */
export const percentApplied = (scale) => Math.round(scale * 100);
