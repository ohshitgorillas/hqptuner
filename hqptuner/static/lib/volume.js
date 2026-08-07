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

export const AXIS_MIN = -120;
export const AXIS_MAX = 12;

/**
 * Read a form value as a number, keeping the caller's default for anything the
 * daemon may legitimately send as "no answer" — an empty box, a missing field,
 * or a non-numeric placeholder — so a blank never becomes NaN.
 * @param {string | number | boolean | null | undefined} v
 * @param {number} dflt
 * @returns {number}
 */
export function num(v, dflt) {
  return v === "" || v == null || Number.isNaN(Number(v)) ? dflt : Number(v);
}

/**
 * Clamp one handle against the axis, its own documented bound, and its
 * neighbours, rounded to whole dB. Ordering is enforced here rather than by
 * refusing the input, so a handle dragged past its neighbour stops against it
 * instead of jumping.
 * @param {string} which one of "min", "max", "startup"
 * @param {string | number} v the dragged/typed value
 * @param {{ min: number, startup: number, max: number }} cur the other handles' present values
 * @returns {number}
 */
export function clampVolume(which, v, { min, startup, max }) {
  const n = Math.round(num(v, 0));
  if (which === "min") return Math.max(AXIS_MIN, Math.min(n, 0, startup, max));
  if (which === "max") return Math.min(AXIS_MAX, Math.max(n, min, startup));
  return Math.max(min, Math.min(n, max)); // startup rides between the two
}

// Volume-adaptive loudness compensation's two bounds ride the same dBFS axis but
// answer to their own form bounds, which stop at the limiter threshold: neither
// bound takes positive gain (post_loudness_range{low,high} are min="-120"
// max="0" step="1").
const LOUD_MIN = -120;
const LOUD_MAX = 0;

/**
 * Clamp one loudness bound to -120..0 dBFS and against its partner, rounded to
 * whole dB. The pair shares the axis with Min / Startup / Max but not their
 * ordering rule — the only crossing forbidden here is the lower bound passing
 * the upper.
 * @param {string} which one of "low", "high"
 * @param {string | number} v the dragged/typed value
 * @param {{ low: number, high: number }} cur the pair's present values
 * @returns {number}
 */
export function clampLoudness(which, v, { low, high }) {
  const n = Math.round(num(v, 0));
  if (which === "low") return Math.max(LOUD_MIN, Math.min(n, LOUD_MAX, high));
  return Math.min(LOUD_MAX, Math.max(n, LOUD_MIN, low));
}
