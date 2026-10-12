// DOM-free timing for the faceplate's components: a held button's repeat, a restartable quiet window, a temporary state
// that reverts. Each takes the Clock it schedules on, so a test drives it with a fake.

/** @typedef {import('../../lib/clock.js').Clock} Clock */

/**
 * Hold to repeat: after `delay` ms, call `step` every `rate` ms until the returned stop is called.
 *
 * @param {() => void} step
 * @param {Clock} clock
 * @param {number} delay  ms before the repeat begins
 * @param {number} rate   ms between steps once it has
 * @returns {() => boolean}  stop: cancels both timers; true when the delay had passed, so the repeat had begun
 */
export function holdRepeat(step, clock, delay, rate) {
  /** @type {unknown} */
  let rep;
  let began = false;
  const wait = clock.setTimeout(() => {
    began = true;
    rep = clock.setInterval(step, rate);
  }, delay);
  return () => {
    clock.clearTimeout(wait);
    clock.clearInterval(rep);
    return began;
  };
}

/**
 * A restartable quiet window: `arm` cancels the pending fire and schedules `fire` a full `ms` from now; `cancel` drops
 * the pending fire without firing. Both are no-ops on the clock when nothing is pending.
 *
 * @param {number} ms
 * @param {() => void} fire
 * @param {Clock} clock
 * @returns {{ arm: () => void, cancel: () => void }}
 */
export function quietWindow(ms, fire, clock) {
  /** @type {unknown} the pending fire's handle, or null when nothing is pending */
  let pending = null;
  const cancel = () => {
    if (pending === null) return;
    clock.clearTimeout(pending);
    pending = null;
  };
  const arm = () => {
    cancel();
    pending = clock.setTimeout(() => {
      pending = null;
      fire();
    }, ms);
  };
  return { arm, cancel };
}

/**
 * A state that reverts after `ms`. The returned arm schedules `revert`; arming again cancels the pending one and waits
 * the full `ms` from the new arming.
 *
 * @param {number} ms
 * @param {() => void} revert
 * @param {Clock} clock
 * @returns {() => void}  arm
 */
export function revertAfter(ms, revert, clock) {
  return quietWindow(ms, revert, clock).arm;
}
