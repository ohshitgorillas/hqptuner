// Hold and fall: the rule a mark over a moving level follows, a bar's peak cap and the spectrum's fall ghost alike, in
// plot fractions, 0 on the floor and 1 at full scale. Free of the DOM; the caller hands in the time.

export const CAP_HOLD_S = 0.5; // a mark's hold after its level last reached it, s
export const CAP_GRAVITY = 4; // a released mark's acceleration, plot fractions/s²

/**
 * A mark after a step of `dt` seconds over `level`: a level at or above the mark lifts it; otherwise the mark holds
 * until `age` passes CAP_HOLD_S, then falls by CAP_GRAVITY times its age past the hold times the step, never below the
 * level.
 *
 * @param {number} mark   plot fraction
 * @param {number} level  plot fraction
 * @param {number} age    time since the level last reached the mark, this step included, s
 * @param {number} dt     s
 * @returns {number}  plot fraction
 */
export function holdFall(mark, level, age, dt) {
  if (level >= mark) return level;
  const over = age - CAP_HOLD_S;
  return over > 0 ? Math.max(level, mark - CAP_GRAVITY * over * dt) : mark;
}
