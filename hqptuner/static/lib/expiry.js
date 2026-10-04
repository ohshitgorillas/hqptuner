// A status message that clears itself after a while, as an effect body: the
// timer is a parameter, so whether and when the message goes is testable
// without a browser or a wall clock.

/**
 * @typedef {object} Timers
 * @property {(fn: () => void, ms: number) => unknown} setTimeout
 * @property {(handle: unknown) => void} clearTimeout
 */

// Wrapped rather than passed bare: the browser's timer functions refuse to run
// with an object other than the window as `this`.
/** @type {Timers} */
const PLATFORM = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (handle)),
};

/**
 * Clear a message after `ms` when it is due to expire.
 *
 * @param {boolean} due whether this message expires at all
 * @param {number} ms how long it stays up first
 * @param {() => void} clear takes the message down
 * @param {Timers} [timers]
 * @returns {() => void} cancels the pending clear; does nothing when none is pending
 */
export function expireIf(due, ms, clear, timers = PLATFORM) {
  if (!due) return () => {};
  const handle = timers.setTimeout(clear, ms);
  return () => timers.clearTimeout(handle);
}
