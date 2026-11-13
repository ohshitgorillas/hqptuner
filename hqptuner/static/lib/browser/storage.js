// The browser's localStorage behind three calls that never throw. A store that
// is missing (node, the SSR harness) or refuses the call (private mode, storage
// blocked by policy, a full quota) is reported to the caller as a failure, and
// the caller decides what that failure costs: its own fallback value, and
// whether to say so.

/**
 * A read that reached the store, holding what `getItem` returned, or one that
 * could not reach it.
 *
 * @typedef {{ ok: true, value: string | null } | { ok: false }} StoredRead
 */

/**
 * Read one key from localStorage.
 *
 * @param {string} key
 * @returns {StoredRead} `ok: false` where the store is missing or refused the read
 */
export function getStored(key) {
  try {
    return { ok: true, value: localStorage.getItem(key) };
  } catch {
    return { ok: false };
  }
}

/**
 * Write one key to localStorage.
 *
 * @param {string} key
 * @param {string} value
 * @returns {boolean} false where the store is missing or refused the write
 */
export function setStored(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove one key from localStorage.
 *
 * @param {string} key
 * @returns {boolean} false where the store is missing or refused the removal
 */
export function removeStored(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
