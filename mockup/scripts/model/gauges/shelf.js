// The Loudness shelf's scale at a volume, free of the DOM: how much of the shelving applies between its two bounds.

/**
 * v1 eqlab shelfScale: full at/below the lower bound, none at/above the upper, linear between.
 *
 * @param {number} v
 * @param {number} low
 * @param {number} high
 */
export function shelfScale(v, low, high) {
  if (high <= low) return v <= low ? 1 : 0;
  return Math.max(0, Math.min(1, (high - v) / (high - low)));
}
