// The Source VU needles: where a reading sits on the -20 to +3 VU scale, and how each channel's needle moves toward
// its channel's RMS level under the IEC 60268-17 dynamic response.
//
// Each needle is a second-order mechanism driven by voltage relative to the VU reference, its deflection linear in
// voltage as the scale is. The needle's stops sit at the ends of the scale: a needle that reaches one rebounds off it
// with the speed it struck at, reflected, and a needle held against one by its drive rests there. A step solves that
// motion in closed form over the `dt` it is handed, from one strike to the next, so a stretch of time moves a needle
// the same whether it arrives in long frames or short ones, and a late step costs no more than an on-time one.

import { clamp } from "../../../lib/coerce.js";

/**
 * @typedef {object} VuState
 * @property {number[]} vu  per channel, the reading, VU
 * @property {number[]} deflection  per channel, the needle's deflection, voltage relative to 0 VU
 * @property {number[]} speed  per channel, the needle's speed, voltage relative to 0 VU per second
 */

//: The ends of the Source VU scale, VU.
export const SCALE_MIN_VU = -20;
export const SCALE_MAX_VU = 3;

//: The needle's damping ratio: an overshoot of 1.25% of reference deflection, inside IEC 60268-17's 1% to 1.5%.
const DAMPING = 0.8127;
//: The needle's natural angular frequency, rad/s: 99% of reference deflection 300 ms after a step to it.
const NATURAL = 13.512;
const DECAY = DAMPING * NATURAL;
const RINGING = NATURAL * Math.sqrt(1 - DAMPING * DAMPING);
//: The time from one turn of the needle to the next, s.
const HALF_RING = Math.PI / RINGING;

/**
 * @param {number} vu
 * @returns {number}  voltage relative to 0 VU
 */
function voltage(vu) {
  return 10 ** (vu / 20);
}

//: The needle's stops, at the ends of the scale, voltage relative to 0 VU.
const BOTTOM_STOP = voltage(SCALE_MIN_VU);
const TOP_STOP = voltage(SCALE_MAX_VU);
//: How far past a stop a deflection must lie to count as past it, beyond float rounding, voltage relative to 0 VU.
const STOP_EPS = 1e-12;
//: The halvings that place the moment a needle reaches a stop within its step.
const BISECTIONS = 40;
//: The strikes on a stop one step follows; a needle still bouncing after them has bounces too small to see left, and
//: settles on the stop.
const MAX_STRIKES = 64;

/**
 * A reading held on the scale.
 * @param {number} vu
 * @returns {number}  VU
 */
function held(vu) {
  return clamp(vu, SCALE_MIN_VU, SCALE_MAX_VU);
}

/**
 * Where a reading sits along the Source VU scale: 0 at the bottom, 1 at the top, linear in voltage, held at the ends.
 * @param {number} vu
 * @returns {number}
 */
export function scaleShare(vu) {
  return (voltage(held(vu)) - BOTTOM_STOP) / (TOP_STOP - BOTTOM_STOP);
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
    vu: new Array(channels).fill(SCALE_MIN_VU),
    deflection: new Array(channels).fill(BOTTOM_STOP),
    speed: new Array(channels).fill(0),
  };
}

/**
 * The deflection of a needle `t` seconds on, free of its stops, from `away` off its drive and moving at the speed
 * `lag` encodes.
 * @param {number} drive  voltage relative to 0 VU
 * @param {number} away  voltage relative to 0 VU
 * @param {number} lag  voltage relative to 0 VU
 * @param {number} t  s
 * @returns {number}  voltage relative to 0 VU
 */
function deflectionAt(drive, away, lag, t) {
  return drive + Math.exp(-DECAY * t) * (away * Math.cos(RINGING * t) + lag * Math.sin(RINGING * t));
}

/**
 * The speed of that needle `t` seconds on, free of its stops.
 * @param {number} away  voltage relative to 0 VU
 * @param {number} lag  voltage relative to 0 VU
 * @param {number} t  s
 * @returns {number}  voltage relative to 0 VU per second
 */
function speedAt(away, lag, t) {
  const start = RINGING * lag - DECAY * away;
  const pull = DECAY * lag + RINGING * away;
  return Math.exp(-DECAY * t) * (start * Math.cos(RINGING * t) - pull * Math.sin(RINGING * t));
}

/**
 * The first moment after the start that the needle, free of its stops, turns. Each turn after it follows `HALF_RING`
 * later and swings less far from the drive than the turn before it on the same side.
 * @param {number} away  voltage relative to 0 VU
 * @param {number} lag  voltage relative to 0 VU
 * @returns {number}  s
 */
function firstTurn(away, lag) {
  const angle = Math.atan2(RINGING * lag - DECAY * away, DECAY * lag + RINGING * away);
  return (angle > 0 ? angle : angle + Math.PI) / RINGING;
}

/**
 * @param {number} deflection  voltage relative to 0 VU
 * @returns {boolean}  whether the deflection lies past either stop
 */
function pastAStop(deflection) {
  return deflection > TOP_STOP + STOP_EPS || deflection < BOTTOM_STOP - STOP_EPS;
}

/**
 * A moment within `dt` by which the needle, free of its stops, has passed one, and before which it passed a stop only
 * once: its first turn, its second, or `dt`. NaN when it passes none within `dt`. Its farthest swings each side of the
 * drive are its first two turns, so those and the end of the step are the only places to look.
 * @param {number} drive  voltage relative to 0 VU
 * @param {number} away  voltage relative to 0 VU
 * @param {number} lag  voltage relative to 0 VU
 * @param {number} dt  s
 * @returns {number}  s
 */
function passedBy(drive, away, lag, dt) {
  const first = firstTurn(away, lag);
  const second = first + HALF_RING;
  if (first < dt && pastAStop(deflectionAt(drive, away, lag, first))) return first;
  if (second < dt && pastAStop(deflectionAt(drive, away, lag, second))) return second;
  return pastAStop(deflectionAt(drive, away, lag, dt)) ? dt : NaN;
}

/**
 * The moment the needle reaches the stop it has passed by `by`.
 * @param {number} drive  voltage relative to 0 VU
 * @param {number} away  voltage relative to 0 VU
 * @param {number} lag  voltage relative to 0 VU
 * @param {number} by  s
 * @returns {number}  s
 */
function impact(drive, away, lag, by) {
  let before = 0;
  let after = by;
  for (let k = 0; k < BISECTIONS; k++) {
    const mid = (before + after) / 2;
    if (pastAStop(deflectionAt(drive, away, lag, mid))) after = mid;
    else before = mid;
  }
  return after;
}

/**
 * @param {number} deflection  voltage relative to 0 VU
 * @returns {number}  the deflection held between the stops, voltage relative to 0 VU
 */
function betweenStops(deflection) {
  return clamp(deflection, BOTTOM_STOP, TOP_STOP);
}

/**
 * Sets channel `i` of `state` to a needle at `deflection`, held between the stops, moving at `speed`.
 * @param {VuState} state
 * @param {number} i
 * @param {number} deflection  voltage relative to 0 VU
 * @param {number} speed  voltage relative to 0 VU per second
 */
function place(state, i, deflection, speed) {
  const at = betweenStops(deflection);
  state.deflection[i] = at;
  state.speed[i] = speed;
  state.vu[i] = reading(at);
}

/**
 * @param {number} deflection  voltage relative to 0 VU
 * @param {number} speed  voltage relative to 0 VU per second
 * @param {number} drive  voltage relative to 0 VU
 * @returns {boolean}  whether the needle lies on a stop its drive holds it against, not moving off it
 */
function pinned(deflection, speed, drive) {
  const onBottom = deflection <= BOTTOM_STOP + STOP_EPS && drive < BOTTOM_STOP && speed <= 0;
  const onTop = deflection >= TOP_STOP - STOP_EPS && drive > TOP_STOP && speed >= 0;
  return onBottom || onTop;
}

/**
 * Moves channel `i` of `state` `dt` seconds on under `drive`, one strike on a stop at a time, each rebounding off the
 * stop with the speed it struck at, reflected, until the time runs out. A needle its drive holds on a stop rests there.
 * @param {VuState} state  moved in place
 * @param {number} i
 * @param {number} drive  voltage relative to 0 VU
 * @param {number} dt  s
 */
function moveNeedle(state, i, drive, dt) {
  let deflection = state.deflection[i] ?? BOTTOM_STOP;
  let speed = state.speed[i] ?? 0;
  let left = dt;
  for (let strikes = 0; strikes < MAX_STRIKES && !pinned(deflection, speed, drive); strikes++) {
    const away = deflection - drive;
    const lag = (speed + DECAY * away) / RINGING;
    const by = passedBy(drive, away, lag, left);
    if (Number.isNaN(by)) {
      place(state, i, deflectionAt(drive, away, lag, left), speedAt(away, lag, left));
      return;
    }
    const at = impact(drive, away, lag, by);
    deflection = betweenStops(deflectionAt(drive, away, lag, at));
    speed = -speedAt(away, lag, at);
    left -= at;
  }
  place(state, i, deflection, 0);
}

/**
 * Moves the needles in `state` `dt` seconds on, each driven by its channel's level held over that time. A needle that
 * reaches a stop rebounds off it at the speed it struck at and moves on for the rest of the step, so the stops cost a
 * step none of its time.
 * @param {VuState} state  moved in place
 * @param {number[]} rms  per channel, dBFS
 * @param {number} dt  wall, s, since the last step
 * @param {number} reference  the level that reads 0 VU, dBFS
 * @returns {VuState}  `state`
 */
export function stepVu(state, rms, dt, reference) {
  for (let i = 0; i < state.vu.length; i++) {
    moveNeedle(state, i, voltage((rms[i] ?? -Infinity) - reference), dt);
  }
  return state;
}
