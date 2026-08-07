// Anything can be thrown, so a catch binding is `unknown`. Every caller wants the
// same sentence out of it: the message if the throw carried one, else the value
// itself stringified. `instanceof Error` would be the wrong narrowing — a plain
// object carrying a message still has the sentence worth showing the user.
/**
 * @param {unknown} e
 * @returns {string}
 */
export function errText(e) {
  const err = /** @type {{ message?: unknown }} */ (e);
  return String(e && err.message ? err.message : e);
}
