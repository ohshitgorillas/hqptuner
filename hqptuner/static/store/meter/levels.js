// Level-meter ballistics for the METER page. One settle() step per feed frame,
// and a frame covers a fixed stride of frame time (STRIDE_MS in
// engine/meterfeed.py), so release and hold count frames rather than reading a
// clock. Attack is instant; the bars and the hold mark fall at one rate.

const STEP_S = 0.04;
const RELEASE_DB_PER_S = 20;
const HOLD_S = 2;
const FALL = RELEASE_DB_PER_S * STEP_S;

/** @typedef {{ peak: number, rms: number }} Reading */
/**
 * @typedef {{ peak: number, rms: number, hold: number, age: number }} Ballistic
 *   One channel's displayed levels in dBFS, and how long the hold mark has stood, in seconds.
 */

/**
 * The level a bar shows: the new reading when it is louder, else the old one fallen one step.
 *
 * @param {number | undefined} prev
 * @param {number} next
 */
const fall = (prev, next) => (prev === undefined ? next : Math.max(next, prev - FALL));

/**
 * @param {Ballistic | undefined} p
 * @param {Reading} r
 * @returns {Ballistic}
 */
function settleOne(p, r) {
  const peak = fall(p && p.peak, r.peak);
  const rms = fall(p && p.rms, r.rms);
  if (!p || r.peak >= p.hold) return { peak, rms, hold: r.peak, age: 0 };
  const age = p.age + STEP_S;
  return { peak, rms, hold: age > HOLD_S ? fall(p.hold, r.peak) : p.hold, age };
}

/**
 * Move each channel's displayed levels one frame toward its new reading.
 *
 * @param {Ballistic[] | null} prev
 * @param {Reading[]} readings
 * @returns {Ballistic[]}
 */
export function settle(prev, readings) {
  return readings.map((r, i) => settleOne(prev ? prev[i] : undefined, r));
}

/**
 * Where a level sits on a bar running from `floor` dB to full scale, from 0 to 1.
 *
 * @param {number} db
 * @param {number} floor
 * @returns {number}
 */
export function fraction(db, floor) {
  return Math.min(1, Math.max(0, (db - floor) / -floor));
}
