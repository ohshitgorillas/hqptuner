// DOM-free timing for the mockup's components: a held button's repeat, a mock check's paced lines, a temporary state
// that reverts. Each takes the Clock it schedules on, so a test drives it with a fake.

/** @typedef {import('../lib/clock.js').Clock} Clock */

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
 * Pace a mock check: `onLine` gets each of `lines` a `tick` apart, starting one turn of the clock from now, then
 * `onVerdict` runs a tick after the last line.
 *
 * @param {string[]} lines
 * @param {number} tick  ms between printed lines
 * @param {(line: string) => void} onLine
 * @param {() => void} onVerdict
 * @param {Clock} clock
 */
export function checkSequence(lines, tick, onLine, onVerdict, clock) {
  lines.forEach((line, i) => clock.setTimeout(() => onLine(line), i * tick));
  clock.setTimeout(onVerdict, lines.length * tick);
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
  /** @type {unknown} */
  let timer;
  return () => {
    clock.clearTimeout(timer);
    timer = clock.setTimeout(revert, ms);
  };
}
