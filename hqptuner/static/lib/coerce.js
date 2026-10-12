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
 * Number with a fallback: form values arrive as strings, and an unparseable or
 * infinite one has to read as the default rather than as NaN. Null and "" read
 * as 0, Number's own reading; `wireNum` is the reader for which blank means the
 * default.
 *
 * @template {number | null} [D=number]
 * @param {unknown} v
 * @param {D} [d]
 * @returns {number | D}
 */
export const num = (v, d = /** @type {D} */ (0)) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/**
 * Whether a wire value is blank, the daemon's "no answer": absent, null, or an
 * empty string.
 *
 * @param {unknown} v
 * @returns {v is null | undefined | ""}
 */
export const isBlank = (v) => v == null || v === "";

/**
 * A wire number, `d` for a blank or unparseable one, so a blank never reads as
 * 0 or NaN.
 *
 * @param {unknown} v
 * @param {number} d
 * @returns {number}
 */
export const wireNum = (v, d) => (isBlank(v) ? d : num(v, d));

/** Confine `v` to the closed interval [lo, hi]. */
export const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) =>
  Math.max(lo, Math.min(hi, v));
