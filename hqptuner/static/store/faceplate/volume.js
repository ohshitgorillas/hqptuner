// The engine-row volume, read off what the engine reports and what the daemon is running, never a staged edit: the
// level it shows on a 0.5 dB step, the range it moves over, the pins that hold it (Direct SDM over Fixed volume), the
// write that moves it, and where the loudness bounds sit along its slider.
//
// The range is the one the Volume tab's dial is drawn on (components/volume/Playback.js): the engine's own report while
// it has the control, else the running config's, since the range the engine reports while it holds the control is not
// the configured one. A collapsed running range (min at or above max; 0 / 0 bypasses the volume control, manual §4.2)
// draws on the daemon's full −60…0 dB.

import { volume, volumeRange, volumeShown } from "../signals.js";
import { runningValue } from "../resolve.js";
import { setVolume } from "../actions.js";
import { directSdm, isoLevel } from "../schema/gray.js";
import { num, truthy } from "../../lib/coerce.js";
import { directPin, fixedPin, loudSpan, volumeView } from "../../model/gauges/volume.js";

/** @typedef {import("../../model/gauges/volume.js").Grid} Grid */
/** @typedef {import("../../model/gauges/volume.js").Pins} Pins */
/** @typedef {import("../../model/gauges/volume.js").VolumeView} VolumeView */

const STEP = 0.5; // dB, the Volume tab dial's step
const FULL = { min: -60, max: 0 }; // dBFS, the daemon's own range

/**
 * A wire number, `d` for an absent or empty one (`num` alone reads null as 0).
 *
 * @param {unknown} v
 * @param {number} d
 */
const wireNum = (v, d) => (v == null || v === "" ? d : num(v, d));

/**
 * The range the level moves over, and its step.
 *
 * @returns {Grid}
 */
export function volumeGrid() {
  const vr = volumeRange.value || {};
  const reported = { min: wireNum(vr.min, FULL.min), max: wireNum(vr.max, FULL.max), step: STEP };
  // VolumeRange reports the flag as 1 / "1" / true and nothing else (Playback.js knobRange)
  if (vr.enabled === "1" || vr.enabled === 1 || vr.enabled === true) return reported;
  const [min, max] = ["volume_min", "volume_max"].map((k) => wireNum(runningValue(k), NaN));
  if (Number.isNaN(min) || Number.isNaN(max)) return reported;
  return min >= max ? { ...FULL, step: STEP } : { min, max, step: STEP };
}

/**
 * The pins the running config holds the level with. Auto headroom (Optimal ISO) supersedes the manual level
 * (store/schema/gray.js), and Direct SDM pins it at −3 dBFS with the reason its gray predicate gives.
 *
 * @returns {Pins}
 */
function pins() {
  const iso = isoLevel(runningValue("optimal_iso"));
  const mode = iso !== "0" ? "auto" : truthy(runningValue("fixed_volume_enabled")) ? "manual" : "off";
  const level = runningValue("fixed_volume");
  const why = directSdm({ mode: "", effective: runningValue });
  return {
    fixed: fixedPin(mode, typeof level === "boolean" || level == null ? "" : level, iso),
    direct: directPin(truthy(runningValue("direct_sdm")), why),
  };
}

/**
 * The level the page shows (a knob drag in flight, else the engine's report), the bottom of the range with none.
 *
 * @param {Grid} grid
 */
const shownLevel = (grid) => wireNum(volumeShown.value, grid.min);

/**
 * What the engine-row volume shows now.
 *
 * @returns {VolumeView}
 */
export function volumeNow() {
  const grid = volumeGrid();
  const at = shownLevel(grid);
  return volumeView(at, at, pins(), grid);
}

/**
 * Move the level: the request lands on the step inside the range, shows at once and goes to the engine. Nothing is
 * sent while the level is pinned, nor for a request landing where the level already is.
 *
 * @param {number} level  dB
 */
export function writeVolume(level) {
  const grid = volumeGrid();
  const at = shownLevel(grid);
  const p = pins();
  const next = volumeView(level, at, p, grid);
  if (next.fixed || next.value === volumeView(at, at, p, grid).value) return;
  volume.value = String(next.value); // shown before the engine answers, as the Volume tab's dial does on release
  setVolume(next.value).catch(() => {}); // the next poll reports the level the engine holds
}

/**
 * The loudness bounds along the slider, as percentages of its range; null unless the matrix engine and loudness both
 * run with the level free, since loudness does not reach the output otherwise (store/matrix/loudness.js).
 *
 * @returns {{ lo: number, hi: number, width: number } | null}
 */
export function loudnessMarks() {
  if (!truthy(runningValue("matrix_enabled")) || !truthy(runningValue("loudness_enabled"))) return null;
  if (volumeNow().fixed) return null;
  const low = wireNum(runningValue("loudness_range_low"), -60);
  const high = wireNum(runningValue("loudness_range_high"), -20);
  return loudSpan(low, high, volumeGrid());
}
