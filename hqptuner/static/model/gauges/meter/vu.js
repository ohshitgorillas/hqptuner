// The Source VU needles: where a reading sits on the -20 to +3 VU scale, and how each channel's needle moves toward
// its channel's RMS level under the IEC 60268-17 dynamic response.
//
// Each needle is a second-order mechanism driven by voltage relative to the VU reference, its deflection linear in
// voltage as the scale is. A step solves that motion in closed form over the `dt` it is handed, so a stretch of time
// moves a needle the same whether it arrives in long frames or short ones, and a late step costs no more than an
// on-time one.

/**
 * @typedef {object} VuState
 * @property {number[]} vu  per channel, the reading, VU
 * @property {number[]} deflection  per channel, the needle's deflection, voltage relative to 0 VU
 * @property {number[]} speed  per channel, the needle's speed, voltage relative to 0 VU per second
 */

//: The ends of the Source VU scale, VU.
const BOTTOM_VU = -20;
const TOP_VU = 3;

//: The needle's damping ratio: an overshoot of 1.25% of reference deflection, inside IEC 60268-17's 1% to 1.5%.
const DAMPING = 0.8127;
//: The needle's natural angular frequency, rad/s: 99% of reference deflection 300 ms after a step to it.
const NATURAL = 13.512;
const DECAY = DAMPING * NATURAL;
const RINGING = NATURAL * Math.sqrt(1 - DAMPING * DAMPING);

/**
 * @param {number} vu
 * @returns {number}  voltage relative to 0 VU
 */
function voltage(vu) {
  return 10 ** (vu / 20);
}

//: The needle's stop past the top of the scale, voltage relative to 0 VU.
const TOP_STOP = voltage(TOP_VU);

/**
 * A reading held on the scale.
 * @param {number} vu
 * @returns {number}  VU
 */
function held(vu) {
  return Math.min(TOP_VU, Math.max(BOTTOM_VU, vu));
}

/**
 * Where a reading sits along the Source VU scale: 0 at the bottom, 1 at the top, linear in voltage, held at the ends.
 * @param {number} vu
 * @returns {number}
 */
export function scaleShare(vu) {
  const bottom = voltage(BOTTOM_VU);
  return (voltage(held(vu)) - bottom) / (voltage(TOP_VU) - bottom);
}

/**
 * The reading a deflection shows, held on the scale.
 * @param {number} deflection  voltage relative to 0 VU
 * @returns {number}  VU
 */
function reading(deflection) {
  return held(20 * Math.log10(deflection));
}

/**
 * The needles at rest, against their bottom stop.
 * @param {number} channels
 * @returns {VuState}
 */
export function restVu(channels) {
  return {
    vu: new Array(channels).fill(BOTTOM_VU),
    deflection: new Array(channels).fill(0),
    speed: new Array(channels).fill(0),
  };
}

/**
 * Channel `i` of `next` set to a needle that has moved to `deflection` at `speed`, stopped at either end of its travel.
 * @param {VuState} next
 * @param {number} i
 * @param {number} deflection  voltage relative to 0 VU
 * @param {number} speed  voltage relative to 0 VU per second
 */
function settle(next, i, deflection, speed) {
  const stopped = deflection <= 0 || deflection >= TOP_STOP;
  const at = Math.min(TOP_STOP, Math.max(0, deflection));
  next.deflection[i] = stopped ? at : deflection;
  next.speed[i] = stopped ? 0 : speed;
  next.vu[i] = reading(at);
}

/**
 * The needles `dt` seconds on, each driven by its channel's level held over that time.
 * @param {VuState} state
 * @param {number[]} rms  per channel, dBFS
 * @param {number} dt  wall, s, since the last step
 * @param {number} reference  the level that reads 0 VU, dBFS
 * @returns {VuState}
 */
export function stepVu(state, rms, dt, reference) {
  const channels = state.vu.length;
  const fade = Math.exp(-DECAY * dt);
  const cos = Math.cos(RINGING * dt);
  const sin = Math.sin(RINGING * dt);
  const next = { vu: new Array(channels), deflection: new Array(channels), speed: new Array(channels) };
  for (let i = 0; i < channels; i++) {
    const drive = voltage((rms[i] ?? -Infinity) - reference);
    const away = (state.deflection[i] ?? 0) - drive;
    const lag = ((state.speed[i] ?? 0) + DECAY * away) / RINGING;
    const deflection = drive + fade * (away * cos + lag * sin);
    const speed = fade * ((RINGING * lag - DECAY * away) * cos - (DECAY * lag + RINGING * away) * sin);
    settle(next, i, deflection, speed);
  }
  return next;
}
