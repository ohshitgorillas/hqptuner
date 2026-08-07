/**
 * One showable sentence out of a caught value: its `message` if the throw
 * carried a non-empty one, else the value itself stringified.
 *
 * Anything can be thrown, so a catch binding is `unknown`. `instanceof Error`
 * would be the wrong narrowing — a plain object carrying a message still has
 * the sentence worth showing the user.
 * @param {unknown} e
 * @returns {string}
 */
export function errText(e) {
  const err = /** @type {{ message?: unknown }} */ (e);
  return String(e && err.message ? err.message : e);
}
