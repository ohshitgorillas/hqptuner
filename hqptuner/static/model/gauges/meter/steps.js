// The pace of a page spectrum style that moves in whole steps, free of the DOM and of any clock: a paint is handed the
// seconds since the last one and takes the whole steps they buy at STEPS_PER_S, carrying the part step to the next
// paint, so the style moves as far over a stretch of time whatever the paint rate. A paint takes at most CATCH_UP
// steps, so a long gap catches up a bounded way.

const STEPS_PER_S = 30; // steps a second a style takes, whatever the paint rate
const CATCH_UP = 6; // the most steps one paint takes, however long since the last
const STEP_SLACK = 1e-6; // share of a step a paint's time may fall short by and still buy it, for rounding in the sum

/**
 * What one paint's time buys: the whole steps it takes now, and the part step it leaves owed to the next paint.
 *
 * @typedef {object} StepsDue
 * @property {number} steps  whole steps to take now
 * @property {number} owed   steps' worth of time carried to the next paint, under one
 */

/**
 * The steps a paint `dt` seconds after the last one takes: `owed`, the part step the last paint carried, plus
 * STEPS_PER_S a second of `dt`, taken in whole steps with the part step carried on. A paint owed more than CATCH_UP
 * steps takes CATCH_UP and carries nothing, so a long gap leaves no backlog behind it. A `dt` below 0 counts as none.
 *
 * @param {number} owed  steps, as the last paint's StepsDue carried them; 0 before the first
 * @param {number} dt    s
 * @returns {StepsDue}
 */
export function stepsDue(owed, dt) {
  const due = owed + Math.max(0, dt) * STEPS_PER_S;
  const whole = Math.floor(due + STEP_SLACK);
  if (whole > CATCH_UP) return { steps: CATCH_UP, owed: 0 };
  return { steps: whole, owed: Math.max(0, due - whole) };
}
