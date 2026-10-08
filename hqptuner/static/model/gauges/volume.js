// Playback volume decisions, free of the DOM: the level a request lands on (clamped to the range, snapped to the step),
// Fixed volume and Direct SDM pinning it (Direct SDM wins while it lasts), which ± buttons disable, what the windows and
// the rail print, and where the loudness bounds sit along a slider.

import { minus } from "../shell/format.js";
import { percentOf } from "./output.js";

/**
 * @typedef {{ min: number, max: number }} Range
 * @typedef {Range & { step: number }} Grid
 * @typedef {{ level: number, level_txt: string, text: string }} Pin
 * @typedef {Pin & { why: string }} DirectPin
 * @typedef {{ fixed: Pin | null, direct: DirectPin | null }} Pins
 * @typedef {{ down: boolean, up: boolean }} StepOff
 * @typedef {{ value: number, level: number, txt: string, rail: string, fixed: boolean, why: string, off: StepOff }} VolumeView
 */

/** Direct SDM pins PCM volume here, in dBFS (v1 gray.js). */
const DIRECT_LEVEL = -3;

/**
 * A level as the windows print it: one decimal, dB.
 *
 * @param {number} v
 * @returns {string}
 */
export const dbText = (v) => minus(v, 1) + " dB";

/**
 * The level a request lands on: the nearest step, inside the range.
 *
 * @param {number} v
 * @param {Grid} grid
 * @returns {number}
 */
export const snapLevel = (v, { min, max, step }) => Math.min(max, Math.max(min, Math.round(v / step) * step));

/**
 * Fixed volume as applied (Volume drawer → Fixed volume): 'manual' pins `level` (dBFS), 'auto' pins −3 (iso '1') or −6
 * (iso '2'); anything else leaves the volume adjustable (null).
 *
 * @param {string} mode
 * @param {string | number} level
 * @param {string} iso
 * @returns {Pin | null}
 */
export function fixedPin(mode, level, iso) {
  if (mode === "manual") {
    const l = Number(level);
    return { level: l, level_txt: dbText(l), text: `Manual: ${dbText(l)}` };
  }
  if (mode === "auto") {
    const l = iso === "2" ? -6 : -3,
      lt = dbText(l).replace(".0 dB", " dB");
    return { level: l, level_txt: lt, text: `Auto: ${lt}` };
  }
  return null;
}

/**
 * Direct SDM playing: the volume bypassed and PCM volume pinned, `why` the reason the window's tooltip carries; null when
 * it is not playing.
 *
 * @param {boolean} on
 * @param {string} why
 * @returns {DirectPin | null}
 */
export const directPin = (on, why) =>
  on ? { level: DIRECT_LEVEL, level_txt: dbText(DIRECT_LEVEL), text: `Direct: ${dbText(DIRECT_LEVEL)}`, why } : null;

/**
 * Which ± buttons disable: both while the level is pinned, else the one whose bound the level sits on.
 *
 * @param {number} level
 * @param {boolean} fixed
 * @param {Range} range
 * @returns {StepOff}
 */
export const stepOff = (level, fixed, { min, max }) => ({ down: fixed || level <= min, up: fixed || level >= max });

/**
 * What a volume request shows. Pinned (Direct SDM over Fixed volume), the adjustable level stays where it was and every
 * window shows the pin; free, the level moves to the snapped request. `txt` is the windows' text (the level alone),
 * `rail` the rail value (the mode word with it, when pinned), `why` the Direct SDM reason ('' otherwise).
 *
 * @param {number} v  requested level
 * @param {number} value  the adjustable level now
 * @param {Pins} pins
 * @param {Grid} grid
 * @returns {VolumeView}
 */
export function volumeView(v, value, { fixed, direct }, grid) {
  const pin = direct || fixed;
  const kept = pin ? value : snapLevel(v, grid);
  const level = pin ? pin.level : kept;
  const txt = pin ? pin.level_txt : dbText(kept);
  return {
    value: kept,
    level,
    txt,
    rail: pin ? pin.text : txt,
    fixed: !!pin,
    why: direct ? direct.why : "",
    off: stepOff(level, !!pin, grid),
  };
}

/**
 * Loudness bounds along a slider, as percentages of its range: `lo` and `hi` at the bounds (outside the range they clamp
 * to its ends), `width` the strip between them.
 *
 * @param {number} low
 * @param {number} high
 * @param {Range} range
 * @returns {{ lo: number, hi: number, width: number }}
 */
export function loudSpan(low, high, { min, max }) {
  const pct = (/** @type {number} */ v) => Math.min(100, Math.max(0, percentOf(v, min, max)));
  const lo = pct(low),
    hi = pct(high);
  return { lo, hi, width: hi - lo };
}
