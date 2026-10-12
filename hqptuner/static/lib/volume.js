// Volume-range policy: the dBFS axis the Min / Startup / Max handles live on.
//
// Bounds are the daemon's own /config form bounds (volume_max -120..+12,
// volume_min -120..0) — note the asymmetry: only Max may exceed 0 dBFS, because
// only Max is documented as accepting positive gain (readme §1.2 volume_max
// "Allows also positive values (gain)").
//
// This lives apart from the component that draws the bar because it is pure
// policy, not presentation: it states the daemon's contract. The clamping that
// keeps the three handles in a legal order on this axis is
// model/gauges/range-axis.js clampVolume.

export const AXIS_MIN = -120;
export const AXIS_MAX = 12;

/** The axis as one value, for the range-axis geometry and clamps. */
export const AXIS = { min: AXIS_MIN, max: AXIS_MAX };
