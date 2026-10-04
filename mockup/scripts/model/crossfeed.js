// Crossfeed lookups, free of the DOM: the name a mode shows, the Bauer preset a stored value names, and the Structural
// preset a speaker angle and center character land on. Stored values may arrive as strings (the family's values).

/**
 * The name of crossfeed mode `mode` in `modes`, or undefined for a mode the table does not hold.
 *
 * @template L
 * @param {readonly { v: string, label: L }[]} modes
 * @param {string} mode
 * @returns {L | undefined}
 */
export const modeName = (modes, mode) => modes.find((m) => m.v === mode)?.label;

/**
 * The Bauer preset whose value is `v`, or undefined.
 *
 * @template {{ v: string }} T
 * @param {readonly T[]} presets
 * @param {string} v
 * @returns {T | undefined}
 */
export const bauerPreset = (presets, v) => presets.find((p) => p.v === v);

/**
 * Whether two values match: within `tol` (strictly) when a tolerance is given, else exactly as numbers.
 *
 * @param {number | string} a
 * @param {number | string} b
 * @param {number} [tol]
 * @returns {boolean}
 */
const near = (a, b, tol) => (tol ? Math.abs(+a - +b) < tol : +a === +b);

/**
 * The first Structural preset at speaker angle `angle` and center character `lambda`, or undefined. Exact without
 * `tol`; with it, each value strictly within its own tolerance.
 *
 * @template {{ angle: number, lambda: number }} T
 * @param {readonly T[]} presets
 * @param {number | string} angle
 * @param {number | string} lambda
 * @param {{ angle: number, lambda: number }} [tol]
 * @returns {T | undefined}
 */
export const structuralPreset = (presets, angle, lambda, tol) =>
  presets.find((p) => near(p.angle, angle, tol?.angle) && near(p.lambda, lambda, tol?.lambda));
