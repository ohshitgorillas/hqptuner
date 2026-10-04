// Option lookup, free of the DOM: control values arrive as strings (the drawers' family values, a select's value) while
// catalogs carry numbers and strings both, so a value and an option match on their string forms.

/**
 * The first option whose value prints as `v` does, or undefined.
 *
 * @template {{ v: unknown }} T
 * @param {readonly T[]} options
 * @param {unknown} v
 * @returns {T | undefined}
 */
export const optionOf = (options, v) => options.find((o) => String(o.v) === String(v));
