// Range bar geometry and handle rules, free of the DOM: one linear dB axis across a track inset from both ends, the
// ticks and end labels under it, which handle a press takes, and the clamps a dragged or typed value passes through.
// The bars (components/volume-range.js, components/loudness.js) draw what they get back and a test drives it from a
// table.

const TICK_LEN = { minor: 5, major: 9, strong: 13 };

/**
 * A dB axis.
 *
 * @typedef {object} Axis
 * @property {number} min
 * @property {number} max
 */

/**
 * One tick: its value, its weight and its length in px.
 *
 * @typedef {object} TickMark
 * @property {number} d
 * @property {'minor' | 'major' | 'strong'} weight
 * @property {number} len
 */

/** @typedef {'low' | 'high'} BoundKey */
/** @typedef {'min' | 'startup' | 'max'} VolumeKey */

/**
 * x of a dB value on a bar W px wide with the track inset `padX` px from each end, snapped to half a px.
 *
 * @param {number} W
 * @param {Axis} axis
 * @param {number} padX
 * @returns {(d: number) => number}
 */
export function barX(W, axis, padX) {
  return (d) => Math.round((padX + ((W - 2 * padX) * (d - axis.min)) / (axis.max - axis.min)) * 2) / 2;
}

/**
 * The dB value under px on the same bar, unclamped and unrounded.
 *
 * @param {number} W
 * @param {Axis} axis
 * @param {number} padX
 * @param {number} px
 * @returns {number}
 */
export function barValueAt(W, axis, padX, px) {
  return axis.min + ((px - padX) / (W - 2 * padX)) * (axis.max - axis.min);
}

/**
 * Ticks every `step` dB from `from` up to `to` inclusive.
 *
 * @param {number} from
 * @param {number} to
 * @param {number} step
 * @returns {number[]}
 */
export function ticksEvery(from, to, step) {
  const ticks = [];
  for (let d = from; d <= to; d += step) ticks.push(d);
  return ticks;
}

/**
 * Each tick weighed: strong where `strong` names it, major where it carries a label, minor otherwise; the heavier the
 * weight, the longer the tick.
 *
 * @param {number[]} ticks
 * @param {{ has(d: number): boolean }} labelled
 * @param {number[]} strong
 * @returns {TickMark[]}
 */
export function tickMarks(ticks, labelled, strong) {
  return ticks.map((d) => {
    /** @type {TickMark['weight']} */
    const weight = strong.includes(d) ? "strong" : labelled.has(d) ? "major" : "minor";
    return { d, weight, len: TICK_LEN[weight] };
  });
}

/**
 * An axis label's text-anchor: the end labels sit inside the bar, the rest centre on their tick.
 *
 * @param {number} d
 * @param {Axis} axis
 * @returns {'start' | 'end' | 'middle'}
 */
export function labelAnchor(d, axis) {
  return d === axis.min ? "start" : d === axis.max ? "end" : "middle";
}

/**
 * The loudness bound a press at dB value `v` takes: the nearer one, the lower on a tie.
 *
 * @param {number} v
 * @param {{ low: number, high: number }} pair
 * @returns {BoundKey}
 */
export function pickBound(v, pair) {
  return Math.abs(pair.low - v) <= Math.abs(pair.high - v) ? "low" : "high";
}

/**
 * The volume handle a press takes: Startup anywhere in the pin row (y above `pinBelow`), else the nearest of Min, Max
 * and Startup, in that order on a tie.
 *
 * @param {number} v       dB under the press
 * @param {number} yTop    px from the bar's top
 * @param {Record<VolumeKey, number>} cur
 * @param {number} pinBelow
 * @returns {VolumeKey}
 */
export function pickVolumeHandle(v, yTop, cur, pinBelow) {
  if (yTop < pinBelow) return "startup";
  /** @type {VolumeKey[]} */
  const keys = ["min", "max", "startup"];
  return keys.reduce((a, b) => (Math.abs(cur[b] - v) < Math.abs(cur[a] - v) ? b : a));
}

/**
 * A loudness bound moved to `v`: whole dB on the axis, the lower never above the upper.
 *
 * @param {BoundKey} k
 * @param {number} v
 * @param {{ low: number, high: number }} pair
 * @param {Axis} axis
 * @returns {number}
 */
export function clampBounds(k, v, pair, axis) {
  const n = Math.round(Math.max(axis.min, Math.min(axis.max, v)));
  return k === "low" ? Math.min(n, pair.high) : Math.max(n, pair.low);
}

/**
 * A volume handle moved to `n` (v1 lib/volume.js clampVolume): whole dB; Min on the axis, at most 0 dB and never above
 * Startup or Max; Max on the axis and never below Min or Startup; Startup between Min and Max.
 *
 * @param {VolumeKey} which
 * @param {number} n
 * @param {Record<VolumeKey, number>} cur
 * @param {Axis} axis
 * @returns {number}
 */
export function clampVolume(which, n, { min, startup, max }, axis) {
  n = Math.round(n);
  if (which === "min") return Math.max(axis.min, Math.min(n, 0, startup, max));
  if (which === "max") return Math.min(axis.max, Math.max(n, min, startup));
  return Math.max(min, Math.min(n, max));
}

/**
 * A value held to the axis, unrounded.
 *
 * @param {number} v
 * @param {Axis} axis
 * @returns {number}
 */
export function clampToAxis(v, axis) {
  return Math.max(axis.min, Math.min(axis.max, v));
}
