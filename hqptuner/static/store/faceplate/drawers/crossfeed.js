// The Crossfeed drawer's store half: which implementation line is picked, what the folded line summarizes, why the
// block is grayed, and the gate and the pick over v1's crossfeed store (store/xfeed/mode.js). The DOM half is
// components/faceplate/drawers/Crossfeed.js; Bauer's compensation and the Structural controls are the two siblings
// under crossfeed/.
//
// One gate, two mechanisms (v1 xfeed/Card.js): on the Bauer line it is the daemon's post-process switch, on the
// Structural line it is whether the sixteen-row matrix block is installed. The pick is a view choice that disables
// the line being left and engages nothing. Everything stages; Apply is the user's.

import { signal } from "@preact/signals";
import { bauerSummary, crossfeedGray, structuralSummary } from "../../../model/gauges/crossfeed.js";
import { truthy } from "../../../lib/coerce.js";
import { PRESETS } from "../../../lib/binaural-setup.js";
import { uncompensatedRows, BAUER_PRESETS } from "../../../vendor/eqlab/core/xfeed.js";
import { crossfeedOff, matrixBypassed } from "../../schema/gray.js";
import { modeName } from "../../signals.js";
import { effective, effectivePipelines } from "../../resolve.js";
import { edit } from "../../actions.js";
import {
  activeMode,
  removeStructural,
  setXfMode,
  stageStructural,
  structuralBlock,
  structuralParams,
} from "../../xfeed/mode.js";
import { xfeedBlock } from "../../xfeed/block.js";
import { rowOptions } from "../drawer.js";
import { compPct } from "./crossfeed/comp.js";

/** @typedef {import("../../../vendor/eqlab/core/matrixspec.js").PipelineRow} PipelineRow */
/** @typedef {ReturnType<typeof crossfeedGray>} CrossfeedLive */

/**
 * The folded line: its implementation, the preset its values land on (undefined off every preset) and the numbers it
 * summarizes. Bauer: frequency (Hz), level (dB), compensation (%). Structural: speaker angle (°), head circumference
 * (cm), center character (%).
 *
 * @typedef {{ v: string, label: string | undefined, values: number[] }} FoldedLine
 */

/**
 * What the Crossfeed block shows: the picked line, whether that line's crossfeed is engaged, the folded line, the
 * reason the block grays ('' while live) and which of its parts are live.
 *
 * @typedef {object} CrossfeedView
 * @property {"bauer" | "structural"} picked
 * @property {boolean} engaged
 * @property {FoldedLine} folded
 * @property {string} gray
 * @property {CrossfeedLive} live
 */

/** The note of the last Structural install the rows refused ('' when none). */
export const xfRefusal = signal("");

/** A Structural value that still reads as its preset (v1 lib/binaural-setup.js matchPreset). */
const S_TOL = { angle: 0.05, lambda: 0.005 };

/** The Structural presets in the shape the lifted decisions read. */
const S_PRESETS = PRESETS.map((p) => ({ v: p.id, label: p.label, angle: p.angle, lambda: p.lambda }));

/** Each named Bauer preset's corner, [frequency Hz, level dB] (libbs2b). */
const CORNERS = Object.fromEntries(
  Object.entries(BAUER_PRESETS).map(([k, p]) => /** @type {[string, [number, number]]} */ ([k, [p.fc, p.feed]])),
);

/**
 * A head circumference in cm from a radius in metres.
 *
 * @param {number} radius
 */
const circOf = (radius) => radius * 2 * Math.PI * 100;

/**
 * What the folded Bauer line installs: the preset, its corner and the compensation now in the rows.
 *
 * @param {PipelineRow[]} rows
 * @returns {FoldedLine}
 */
function bauerLine(rows) {
  const presets = rowOptions("crossfeed_preset").map((o) => ({ v: String(o.value), label: o.label }));
  const st = {
    preset: String(effective("crossfeed_preset") ?? "default"),
    freq: Number(effective("crossfeed_frequency")),
    level: Number(effective("crossfeed_level")),
    comp: compPct(rows),
  };
  const s = bauerSummary(st, presets, CORNERS);
  return { v: "bauer", label: s.label, values: [s.fc, s.feed, s.comp] };
}

/**
 * What the folded Structural line installs: the controls as the drawer shows them.
 *
 * @param {PipelineRow[]} rows
 * @returns {FoldedLine}
 */
function structuralLine(rows) {
  const p = structuralParams(rows);
  const s = structuralSummary({ angle: p.angle, circ: circOf(p.headRadius), lambda: p.lambda }, S_PRESETS, S_TOL);
  return { v: "structural", label: s.label, values: [s.angle, s.circ, s.lambda] };
}

/**
 * Whether the crossfeed of line `picked` is engaged: the post-process switch for Bauer, an installed block for
 * Structural.
 *
 * @param {PipelineRow[]} rows
 * @param {string} picked
 */
const engagedOn = (rows, picked) =>
  picked === "structural" ? !!structuralBlock(rows) : truthy(effective("crossfeed_enabled"));

/**
 * The Crossfeed block's view over the staged store.
 *
 * @returns {CrossfeedView}
 */
export function crossfeedView() {
  const rows = effectivePipelines.value;
  const picked = activeMode(rows) === "structural" ? "structural" : "bauer";
  const engaged = engagedOn(rows, picked);
  // The picked line's own switch read in place of the post-process flag: v1 gray.js's wording, one source.
  const ctx = { mode: modeName.value, effective: (/** @type {string} */ k) => readAs(k, engaged) };
  const live = crossfeedGray(
    { gate: engaged ? "1" : "0", preset: String(effective("crossfeed_preset")), impl: picked },
    matrixBypassed(ctx),
    String(effective("matrix_iir2fir")),
  );
  const folded = picked === "bauer" ? structuralLine(rows) : bauerLine(rows);
  return { picked, engaged, folded, gray: crossfeedOff(ctx), live };
}

/**
 * A catalog value, with the post-process switch read as `engaged`.
 *
 * @param {string} key
 * @param {boolean} engaged
 */
const readAs = (key, engaged) => (key === "crossfeed_enabled" ? (engaged ? "1" : "0") : effective(key));

/**
 * Pick an implementation line: the view switches, the line being left is staged off, nothing is engaged.
 *
 * @param {string} v  bauer | structural
 */
export function pickLine(v) {
  xfRefusal.value = "";
  setXfMode(v, effectivePipelines.value);
}

/**
 * Install the Structural block, taking a compensation block back to its plain pair first, or record the refusal.
 *
 * @param {PipelineRow[]} rows
 */
function installStructural(rows) {
  const comp = xfeedBlock(rows).rec;
  const base = comp ? uncompensatedRows(rows, comp) : rows;
  xfRefusal.value = stageStructural(base, structuralParams(base)) || "";
}

/**
 * Throw the gate of the picked line: `1` engages, `0` bypasses.
 *
 * @param {string} v
 */
export function setGate(v) {
  const rows = effectivePipelines.value;
  xfRefusal.value = "";
  if (activeMode(rows) !== "structural") {
    edit("crossfeed_enabled", v);
    return;
  }
  const rec = structuralBlock(rows);
  if (v === "1" && !rec) installStructural(rows);
  else if (v === "0" && rec) removeStructural(rows, rec);
}
