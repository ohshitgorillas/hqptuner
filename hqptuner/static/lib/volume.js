// Volume-range policy: the dBFS axis the Min / Startup / Max handles live on,
// and the clamping that keeps the three in a legal order.
//
// Bounds are the daemon's own /config form bounds (volume_max -120..+12,
// volume_min -120..0) — note the asymmetry: only Max may exceed 0 dBFS, because
// only Max is documented as accepting positive gain (readme §1.2 volume_max
// "Allows also positive values (gain)").
//
// This lives apart from the component that draws the bar because it is pure
// policy, not presentation: it answers "where may this handle legally land",
// which is a question about the daemon's contract and is worth stating (and
// testing) on its own.

import { wireNum } from "./coerce.js";

export const AXIS_MIN = -120;
export const AXIS_MAX = 12;

/**
 * Clamp one handle against the axis, its own documented bound, and its
 * neighbors, rounded to whole dB. Ordering is enforced here rather than by
 * refusing the input, so a handle dragged past its neighbor stops against it
 * instead of jumping.
 * @param {string} which one of "min", "max", "startup"
 * @param {string | number} v the dragged/typed value
 * @param {{ min: number, startup: number, max: number }} cur the other handles' present values
 * @returns {number}
 */
export function clampVolume(which, v, { min, startup, max }) {
  const n = Math.round(wireNum(v, 0));
  if (which === "min") return Math.max(AXIS_MIN, Math.min(n, 0, startup, max));
  if (which === "max") return Math.min(AXIS_MAX, Math.max(n, min, startup));
  return Math.max(min, Math.min(n, max)); // startup rides between the two
}
