// Small shared value helpers, shared because they are one-liners — exactly the
// kind of copy that drifts when every consumer hand-rolls its own.

/**
 * Read a checkbox's truth out of any of the spellings that cross the wire: a
 * real bool, 1, "1", "on" or "true". Everything else, "0" included, is false.
 *
 * A checkbox's truth crosses domains — the daemon's form reports a real bool, a
 * staged edit carries "1"/"0" — so every consumer normalizes through `truthy`.
 * The "on"/"true" arms cover HTML's default submit value, which hqplayerd's own
 * forms override with an explicit "1" but which costs nothing to admit.
 */
export const truthy = (/** @type {unknown} */ v) => v === true || v === 1 || v === "1" || v === "on" || v === "true";

/**
 * Number with a fallback: form values arrive as strings, and an empty or
 * unparseable one has to read as the default rather than as NaN.
 */
export const num = (/** @type {unknown} */ v, /** @type {number} */ d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Confine `v` to the closed interval [lo, hi]. */
export const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) =>
  Math.max(lo, Math.min(hi, v));
