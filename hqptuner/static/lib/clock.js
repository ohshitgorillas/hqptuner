// The one place the faceplate reaches the platform's clock. Anything that waits, repeats or animates takes a Clock
// (default PLATFORM), so a test drives it with a fake and never waits on wall time.

/**
 * @typedef {object} Clock
 * @property {(fn: () => void, ms: number) => unknown} setTimeout
 * @property {(handle: unknown) => void} clearTimeout
 * @property {(fn: () => void, ms: number) => unknown} setInterval
 * @property {(handle: unknown) => void} clearInterval
 * @property {(fn: (now: number) => void) => unknown} requestAnimationFrame
 * @property {(fn: () => void) => void} queueMicrotask
 * @property {() => number} now milliseconds on the same timeline requestAnimationFrame stamps its frames with
 */

// Wrapped rather than passed bare: the browser's timer functions refuse to run with an object other than the window
// as `this`.
/** @type {Clock} */
export const PLATFORM = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (handle)),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(/** @type {ReturnType<typeof setInterval>} */ (handle)),
  requestAnimationFrame: (fn) => requestAnimationFrame(fn),
  queueMicrotask: (fn) => queueMicrotask(fn),
  now: () => performance.now(),
};
