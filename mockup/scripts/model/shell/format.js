// Text forms the mockup prints, free of the DOM: a number with its sign (the typographic minus, never a hyphen), and a
// class list built from the names that apply.

const MINUS = "−";

/**
 * The magnitude, to `dp` places when given, else as the number prints.
 *
 * @param {number} v
 * @param {number} [dp]
 * @returns {string}
 */
const mag = (v, dp) => (dp === undefined ? String(Math.abs(v)) : Math.abs(v).toFixed(dp));

/**
 * A value with its sign: +6, −6, 0 (zero bare).
 *
 * @param {number} v
 * @param {number} [dp]  decimal places; omitted, the number prints whole
 * @returns {string}
 */
export const signed = (v, dp) => (v > 0 ? "+" : v < 0 ? MINUS : "") + mag(v, dp);

/**
 * A value with a minus when negative and no sign otherwise: −6, 6.
 *
 * @param {number} v
 * @param {number} [dp]  decimal places; omitted, the number prints whole
 * @returns {string}
 */
export const minus = (v, dp) => (v < 0 ? MINUS : "") + mag(v, dp);

/**
 * A value with its sign always shown: + for zero and up, − for anything else.
 *
 * @param {number} v
 * @param {number} [dp]  decimal places; omitted, the number prints whole
 * @returns {string}
 */
export const plusMinus = (v, dp) => (v >= 0 ? "+" : MINUS) + mag(v, dp);

/**
 * A value already printed (or a number as it prints) with its first hyphen made a minus.
 *
 * @param {string | number} v
 * @returns {string}
 */
export const minusText = (v) => String(v).replace("-", MINUS);

/**
 * A class attribute from the names that apply: falsy entries skipped, the rest joined by spaces ('' when none apply).
 *
 * @param {...(string | number | boolean | null | undefined)} names
 * @returns {string}
 */
export const classNames = (...names) => names.filter(Boolean).join(" ");
