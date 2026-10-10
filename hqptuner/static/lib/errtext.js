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

/**
 * `text` ending in exactly one full stop: its trailing whitespace and its own
 * trailing full stops dropped, then one full stop added. Text with nothing
 * before its stops comes back as the one stop alone.
 * @param {string} text
 * @returns {string}
 */
export function endSentence(text) {
  let body = text.trimEnd();
  while (body.endsWith(".")) body = body.slice(0, -1);
  return `${body}.`;
}

/**
 * The sentence a failure shows under a caller's `lead`, the clause naming the
 * operation that failed: the backend's own sentence alone when the failure
 * carries one, since that sentence opens with its own clause, else `lead` in
 * front of the error text.
 *
 * Read by duck type, like `errText`: anything that is not an `ApiFailure`
 * carrying a backend sentence gets the lead.
 * @param {string} lead
 * @param {unknown} e
 * @returns {string}
 */
export function failText(lead, e) {
  const err = /** @type {{ fromBackend?: unknown }} */ (e);
  return e && err.fromBackend === true ? errText(e) : `${lead}${errText(e)}`;
}
