/**
 * Whether two values read the same once serialized. A body parsed from the wire
 * is a fresh object on every read, so a reference compare would call every one
 * a change; this compares by content.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
