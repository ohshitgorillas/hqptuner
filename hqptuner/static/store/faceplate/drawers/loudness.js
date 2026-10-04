// The Loudness drawer's store half: the range bar's marks (both bounds on their own dBFS axis, the playback needle,
// the bound being dragged), how a dragged or typed bound is clamped and when it stages, the dots on the Bass | Treble
// switch (store/ui/ui.js), what a plot handle does, the band the plot draws and the reason the block grays. The DOM
// half is components/faceplate/drawers/Loudness.js.
//
// A bound dragged on the bar moves a draft and stages once, on release; a typed one stages at once. Both pass the
// lifted range-axis clamp: whole dB on the axis, the lower never above the upper. A plot handle streams v1's live
// override while dragged and stages its whole-hertz frequency and tenth-dB level on release (v1 plots.js).

import { signal } from "@preact/signals";
import { clampBounds, clampToAxis } from "../../../model/gauges/range-axis.js";
import { num } from "../../../lib/coerce.js";
import { volumeShown } from "../../signals.js";
import { effective, httpFieldMap, formFieldName, isDirty } from "../../resolve.js";
import { schema as catalog } from "../../schema.js";
import { edit, setLive } from "../../actions.js";
import { grayReason } from "../../ui/graying.js";
import { loudnessSide } from "../../ui/ui.js";

/** @typedef {import("../../../model/gauges/range-axis.js").BoundKey} Side */

/**
 * The range bar's marks: both bounds (dBFS), the playback needle held to the axis (null while no volume is
 * reported), and the bound being dragged (null when none).
 *
 * @typedef {{ low: number, high: number, needle: number | null, active: Side | null }} LoudnessBar
 */

/** The loudness bounds' axis, dBFS (the 6.0.4 /matrix form's min and max for both bounds). */
export const AXIS = { min: -120, max: 0 };

/** A side's four band parameters, in row order. */
export const PARAMS = ["type", "freq", "steep", "level"];

/**
 * The catalog key of one side's band parameter.
 *
 * @param {Side} side
 * @param {string} param
 */
export const bandKey = (side, param) => `loudness_${side}_${param}`;

/** @param {Side} side */
const boundKey = (side) => `loudness_range_${side}`;

/** The bound being dragged and where it is now, or null. */
const draft = signal(/** @type {{ key: Side, value: number } | null} */ (null));

/** The bounds in force, the staged ones under any drag. */
function bounds() {
  return { low: num(effective(boundKey("low")), -60), high: num(effective(boundKey("high")), -20) };
}

/**
 * The range bar's marks over the staged store.
 *
 * @returns {LoudnessBar}
 */
export function loudnessBar() {
  const pair = bounds();
  const d = /** @type {{ key: Side, value: number } | null} */ (draft.value);
  if (d) pair[d.key] = d.value;
  const v = volumeShown.value;
  const needle = v == null || v === "" ? null : clampToAxis(num(v, 0), AXIS);
  return { ...pair, needle, active: d ? d.key : null };
}

/**
 * Move a bound under the pointer: clamped against the other, nothing staged.
 *
 * @param {Side} key
 * @param {number} v  dBFS
 */
export function moveBound(key, v) {
  const pair = bounds();
  draft.value = { key, value: clampBounds(key, v, pair, AXIS) };
}

/** Release the bound being dragged: it stages where it was let go. */
export function dropBound() {
  const d = draft.value;
  draft.value = null;
  if (d) edit(boundKey(d.key), d.value);
}

/**
 * A typed bound: clamped, then staged.
 *
 * @param {Side} key
 * @param {number} v  dBFS
 */
export function typeBound(key, v) {
  if (!Number.isFinite(v)) return;
  edit(boundKey(key), clampBounds(key, v, bounds(), AXIS));
}

/**
 * The dot on each switch button: on the side not shown while it holds a staged edit (v1 VolumeTab.js).
 *
 * @returns {Record<Side, boolean>}
 */
export function sideDots() {
  const shown = loudnessSide.value;
  const dirty = (/** @type {Side} */ s) => s !== shown && PARAMS.some((p) => isDirty(bandKey(s, p)));
  return { low: dirty("low"), high: dirty("high") };
}

/**
 * Show a side of the switch.
 *
 * @param {Side} side
 */
export function showSide(side) {
  loudnessSide.value = side;
}

/**
 * Grabbing a plot handle points the switch at its side.
 *
 * @param {Side} side
 */
export function grabHandle(side) {
  loudnessSide.value = side;
}

/** @param {number} v */
const tenth = (v) => Math.round(v * 10) / 10;

/**
 * A plot handle under the pointer: its band streams as a live override.
 *
 * @param {Side} side
 * @param {number} f  Hz
 * @param {number} db
 */
export function dragHandle(side, f, db) {
  setLive(bandKey(side, "freq"), Math.round(f));
  setLive(bandKey(side, "level"), tenth(db));
}

/**
 * A plot handle let go: its frequency and level stage.
 *
 * @param {Side} side
 * @param {number} f  Hz
 * @param {number} db
 */
export function dropHandle(side, f, db) {
  edit(bandKey(side, "freq"), Math.round(f));
  edit(bandKey(side, "level"), tenth(db));
}

/**
 * Both bands as the v1 loudness curve reads them, from the staged store (v1 plots.js LoudnessPlot's fallbacks).
 *
 * @returns {{ lowType: string, lowFreq: number, lowLevel: number, lowSteep: number,
 *   highType: string, highFreq: number, highLevel: number, highSteep: number }}
 */
export function bands() {
  return {
    lowType: String(effective("loudness_low_type") ?? ""),
    lowFreq: num(effective("loudness_low_freq"), 80),
    lowLevel: num(effective("loudness_low_level"), 0),
    lowSteep: num(effective("loudness_low_steep"), 0.5),
    highType: String(effective("loudness_high_type") ?? ""),
    highFreq: num(effective("loudness_high_freq"), 5000),
    highLevel: num(effective("loudness_high_level"), 0),
    highSteep: num(effective("loudness_high_steep"), 1),
  };
}

/** Why the block's controls gray ('' while loudness can act): v1's reason for its band and bound settings. */
export const loudnessGray = () => grayReason(bandKey("low", "freq"));

/**
 * A number setting's bounds and step: the daemon form's own where it ships them, else the catalog's (v1 Field.js).
 *
 * @param {string} key
 * @returns {{ min?: number, max?: number, step?: number }}
 */
export function formBounds(key) {
  const e = catalog[key];
  if (!e) return {};
  const f = httpFieldMap(e)[formFieldName(e)] ?? {};
  /** @param {"min" | "max" | "step"} n */
  const pick = (n) => /** @type {number | undefined} */ (f[n] ?? e[n]);
  return { min: pick("min"), max: pick("max"), step: pick("step") };
}
