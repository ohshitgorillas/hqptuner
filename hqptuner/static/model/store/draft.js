// Which keys of an engine form's draft differ from the form as read.

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isPlainObject = (v) => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * An own member of `obj`, a missing one read as null.
 *
 * @param {Record<string, unknown>} obj
 * @param {string} key
 * @returns {unknown}
 */
const member = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : null);

/**
 * Whether two values post the same text.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
const samePosted = (a, b) => {
  if (a == null || b == null) return a == null && b == null;
  if (Array.isArray(a) || Array.isArray(b)) return sameArray(a, b);
  if (isPlainObject(a) || isPlainObject(b)) return sameObject(a, b);
  return String(a) === String(b);
};

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
const sameArray = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => samePosted(v, b[i]));

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
const sameObject = (a, b) => {
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => samePosted(member(a, k), member(b, k)));
};

/**
 * The keys whose draft value differs from the form as read, compared in the field's own domain.
 *
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} values
 * @param {string[]} keys
 * @returns {string[]}
 */
export const draftDiffers = (base, values, keys) =>
  [...new Set(keys)].filter((k) => Object.hasOwn(values, k) && !samePosted(member(base, k), values[k]));
