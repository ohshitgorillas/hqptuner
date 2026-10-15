// Source VU needles, free of the DOM and of any clock: one needle per channel, driven by that channel's RMS in dBFS and
// moved only by the seconds each step is handed, so a caller paints what it gets back and a test drives it from a table.
//
// The needle is the IEC 60268-17 volume indicator: a damped second-order movement on a deflection linear in voltage,
// 100% deflection at 0 VU, reaching 99% of a reference step in 300 ms and overshooting it by 1.25%, the middle of the
// standard's 1 to 1.5%. Each step solves the movement exactly over its elapsed time, so the same time travels the same
// distance whatever frames it arrives in.

import { clamp } from "../../../lib/coerce.js";
import { ampToDb, dbToAmp } from "../../../lib/units.js";

export const SCALE_MIN_VU = -20; // bottom of the scale, where a needle at rest reads
export const SCALE_MAX_VU = 3; // top of the scale, where the needle meets its stop
const OVERSHOOT = 0.0125; // overshoot past a step's deflection, as a share of it
const RESPONSE_S = 0.3; // time to 99% of a step's deflection
const RESPONSE_RADIANS = 4.0536; // that time in radians of the undamped movement at this damping

const LOG_OVERSHOOT = -Math.log(OVERSHOOT);
const DAMPING = LOG_OVERSHOOT / Math.sqrt(Math.PI ** 2 + LOG_OVERSHOOT ** 2);
const NATURAL_RAD_S = RESPONSE_RADIANS / RESPONSE_S;
const DECAY_PER_S = DAMPING * NATURAL_RAD_S;
const RING_RAD_S = NATURAL_RAD_S * Math.sqrt(1 - DAMPING ** 2);
const STOP_DEFLECTION = dbToAmp(SCALE_MAX_VU);
const FLOOR_DEFLECTION = dbToAmp(SCALE_MIN_VU); // the deflection the bottom of the scale reads

/**
 * One needle's movement: deflection as a share of reference deflection, and its speed in shares per second.
 *
 * @typedef {{ deflection: number, speed: number }} Needle
 */

/**
 * The VU needles: per channel its reading on the scale, VU, and the movement behind it.
 *
 * @typedef {{ vu: number[], needles: Needle[] }} VuState
 */

/**
 * The reading of a deflection, held on the scale.
 *
 * @param {number} deflection
 */
const readingOf = (deflection) => clamp(ampToDb(deflection), SCALE_MIN_VU, SCALE_MAX_VU);

/**
 * Where reading `vu` sits along the scale, 0 at its bottom and 1 at its top, held on the scale: linear in voltage, as
 * the needle's deflection is.
 *
 * @param {number} vu
 */
export const scaleShare = (vu) =>
  (dbToAmp(clamp(vu, SCALE_MIN_VU, SCALE_MAX_VU)) - FLOOR_DEFLECTION) / (STOP_DEFLECTION - FLOOR_DEFLECTION);

/**
 * `channels` needles at rest.
 *
 * @param {number} channels
 * @returns {VuState}
 */
export function restVu(channels) {
  const needles = Array.from({ length: channels }, () => ({ deflection: 0, speed: 0 }));
  return { vu: needles.map((n) => readingOf(n.deflection)), needles };
}

/**
 * One needle after `dt` seconds toward the deflection `target`, stopped at the top of the scale and at rest.
 *
 * @param {Needle} needle
 * @param {number} target  share of reference deflection
 * @param {number} dt      s
 * @returns {Needle}
 */
function moveNeedle(needle, target, dt) {
  const off = needle.deflection - target;
  const sine = (needle.speed + DECAY_PER_S * off) / RING_RAD_S;
  const fade = Math.exp(-DECAY_PER_S * dt);
  const cos = Math.cos(RING_RAD_S * dt);
  const sin = Math.sin(RING_RAD_S * dt);
  const deflection = target + fade * (off * cos + sine * sin);
  const speed = fade * ((sine * RING_RAD_S - DECAY_PER_S * off) * cos - (off * RING_RAD_S + DECAY_PER_S * sine) * sin);
  if (deflection >= STOP_DEFLECTION) return { deflection: STOP_DEFLECTION, speed: Math.min(0, speed) };
  if (deflection <= 0) return { deflection: 0, speed: Math.max(0, speed) };
  return { deflection, speed };
}

/**
 * The needles after a step of `dt` seconds, each driven by its own channel's RMS against the VU reference: a steady
 * level at the reference reads 0 VU.
 *
 * @param {VuState} prev
 * @param {number[]} rms       per channel, dBFS
 * @param {number} dt          s
 * @param {number} reference   dBFS that reads 0 VU
 * @returns {VuState}
 */
export function stepVu(prev, rms, dt, reference) {
  const needles = prev.needles.map((n, i) => moveNeedle(n, dbToAmp((rms[i] ?? -Infinity) - reference), dt));
  return { vu: needles.map((n) => readingOf(n.deflection)), needles };
}
