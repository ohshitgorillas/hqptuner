// Tolerance helper for the eqstage suites. No test() and no assert lives here:
// every assertion stays at its call site in the suite that owns it.

/**
 * [ok, message] for spreading into ONE assert.ok.
 *
 * @param {number} actual
 * @param {number} expected
 * @param {number} [tol]
 * @returns {[boolean, string]}
 */
export const near = (actual, expected, tol = 0.05) => [
  Math.abs(actual - expected) <= tol,
  `expected ${expected} ± ${tol}, got ${actual}`,
];
