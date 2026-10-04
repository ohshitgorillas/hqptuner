// The Volume drawer's store half: the Fixed volume line picked and what a pick stages (Level tab), and what the Range
// block shows and the move a handle makes (Range tab). The DOM half is components/faceplate/drawers/VolumeRange.js.
//
// Fixed volume is one choice over two settings: Manual is the dBFS level switched on (`fixed_volume_enabled`), Auto is
// Auto headroom at −3 or −6 dB (`optimal_iso`), and Auto supersedes Manual (store/schema/gray.js). A pick stages
// through edit(), whose coupling switches the other setting off (store/actions.js applyFixedVolumeCoupling).
//
// The Range block reads Min, Startup and Max through the staged store, grays with the volume range's own reason, shows
// the loudness bounds for reference while loudness reaches the output (store/faceplate/volume.js), and carries the
// live playback level as a needle while the engine reports the control.

import { volumeRange, volumeShown } from "../../signals.js";
import { effective, isDirty, runningValue } from "../../resolve.js";
import { edit } from "../../actions.js";
import { grayReason } from "../../ui/graying.js";
import { isoLevel } from "../../schema/gray.js";
import { truthy } from "../../../lib/coerce.js";
import { AXIS_MAX, AXIS_MIN, clampVolume, num } from "../../../lib/volume.js";
import { loudnessBounds } from "../volume.js";

/** @typedef {"off" | "manual" | "auto"} FixedMode */
/** @typedef {"min" | "startup" | "max"} VolumeKey */
/** @typedef {Record<VolumeKey, number>} VolumeTrio */

/**
 * What the Range block shows: the three handles in dBFS, the reason the block grays ('' when free), which handles are
 * staged, the loudness bounds in dBFS (null while loudness does not reach the output), and the live level in dBFS (null
 * while the engine does not report the control).
 *
 * @typedef {object} VolumeRangeView
 * @property {VolumeTrio} cur
 * @property {string} gray
 * @property {Record<VolumeKey, boolean>} dirty
 * @property {{ low: number, high: number } | null} loud
 * @property {number | null} level
 */

/** Each handle's catalog key, in the order the block's reason is looked up. @type {Record<VolumeKey, string>} */
export const RANGE_KEYS = { max: "volume_max", min: "volume_min", startup: "startup_volume" };

/** @type {VolumeKey[]} */
const HANDLES = ["min", "startup", "max"];

/**
 * The Fixed volume line picked, read through the staged store.
 *
 * @returns {FixedMode}
 */
export function fixedMode() {
  if (isoLevel(effective("optimal_iso")) !== "0") return "auto";
  return truthy(effective("fixed_volume_enabled")) ? "manual" : "off";
}

/**
 * Pick a Fixed volume line. Manual switches the level on; Auto switches Auto headroom on at the running level, −3 dB
 * when the running config has it off; Off switches off whichever of the two is on. Picking the line already picked, or
 * a value that is not a line, stages nothing.
 *
 * @param {string} v
 * @returns {Promise<void>}
 */
export async function pickFixedMode(v) {
  if (v === fixedMode()) return;
  if (v === "manual") await edit("fixed_volume_enabled", "1");
  else if (v === "auto") {
    const running = isoLevel(runningValue("optimal_iso"));
    await edit("optimal_iso", running === "0" ? "1" : running);
  } else if (v === "off") {
    if (isoLevel(effective("optimal_iso")) !== "0") await edit("optimal_iso", "0");
    if (truthy(effective("fixed_volume_enabled"))) await edit("fixed_volume_enabled", "0");
  }
}

/** The three handles through the staged store; Max defaults to 0, Min to −60 and Startup to Min (v1 RangeBar). */
function trio() {
  const max = num(effective("volume_max"), 0);
  const min = num(effective("volume_min"), -60);
  return { min, startup: num(effective("startup_volume"), min), max };
}

/**
 * The live level the needle rides at, held to the axis; null unless the engine reports the control (VolumeRange
 * enabled as 1 / "1" / true and nothing else, Playback.js knobRange) and a level, a drag in flight winning.
 *
 * @returns {number | null}
 */
function liveLevel() {
  const vr = volumeRange.value;
  if (!vr || !(vr.enabled === "1" || vr.enabled === 1 || vr.enabled === true)) return null;
  const db = num(volumeShown.value, NaN);
  return Number.isNaN(db) ? null : Math.max(AXIS_MIN, Math.min(AXIS_MAX, db));
}

/**
 * What the Range block shows now.
 *
 * @returns {VolumeRangeView}
 */
export function volumeRangeNow() {
  const gray = Object.values(RANGE_KEYS).reduce((found, k) => found || grayReason(k), "");
  return {
    cur: trio(),
    gray,
    dirty: { min: isDirty(RANGE_KEYS.min), startup: isDirty(RANGE_KEYS.startup), max: isDirty(RANGE_KEYS.max) },
    loud: loudnessBounds(),
    level: liveLevel(),
  };
}

/**
 * Move a handle to `v` dBFS: it lands on whole dB, inside its own bound and never past its neighbours
 * (lib/volume.js clampVolume), and stages unless it lands where it already is.
 *
 * @param {VolumeKey} k
 * @param {number} v
 * @returns {number}  the dBFS it lands on
 */
export function moveVolumeHandle(k, v) {
  const cur = trio();
  const n = clampVolume(k, v, cur);
  if (HANDLES.includes(k) && n !== cur[k]) edit(RANGE_KEYS[k], String(n));
  return n;
}
