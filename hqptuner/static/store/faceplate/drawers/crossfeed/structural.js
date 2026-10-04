// The Structural line's controls in the Crossfeed drawer (v1 xfeed/Card.js StructuralMode): speaker angle, head
// circumference and center character, the preset they land on, and the settings an install would change. A drag
// streams through v1's live params so the drawing follows without restaging sixteen rows per pixel; a commit remembers
// the values and restages an installed block. With no block installed nothing stages: the gate installs it.

import { PRESETS, matchPreset } from "../../../../lib/binaural-setup.js";
import { effectivePipelines } from "../../../resolve.js";
import {
  conflicts,
  liveParams,
  remember,
  stageStructural,
  structuralBlock,
  structuralParams,
} from "../../../xfeed/mode.js";
import { xfRefusal } from "../crossfeed.js";

/**
 * The Structural controls as the drawer shows them: speaker angle (°), head circumference (cm) and its radius (m),
 * center character (a fraction, 1 = 100%), the preset id they land on (`custom` off every preset), and the settings
 * an install would change, each with the reason.
 *
 * @typedef {object} StructuralView
 * @property {number} angle
 * @property {number} circ
 * @property {number} headRadius
 * @property {number} lambda
 * @property {string} preset
 * @property {{ key: string, reason: string }[]} conflicts
 */

/** @typedef {{ angle?: number, circ?: number, lambda?: number }} StructuralPatch  circ in cm */

/**
 * The Structural controls' view over the staged store.
 *
 * @returns {StructuralView}
 */
export function structuralView() {
  const p = structuralParams(effectivePipelines.value);
  return {
    angle: p.angle,
    circ: p.headRadius * 2 * Math.PI * 100,
    headRadius: p.headRadius,
    lambda: p.lambda,
    preset: matchPreset(p),
    conflicts: conflicts().map((c) => ({ key: c.key, reason: c.reason })),
  };
}

/**
 * The params with `patch` laid over the ones in force, the circumference turned into the radius the block reads.
 *
 * @param {StructuralPatch} patch
 */
function merged({ circ, ...rest }) {
  const p = { ...structuralParams(effectivePipelines.value), ...rest };
  return circ === undefined ? p : { ...p, headRadius: circ / 100 / (2 * Math.PI) };
}

/**
 * Follow a slider drag: the controls and the drawing move, nothing stages.
 *
 * @param {StructuralPatch} patch
 */
export function dragStructural(patch) {
  liveParams.value = merged(patch);
}

/**
 * Commit control values: remember them, and restage the installed block with them.
 *
 * @param {StructuralPatch} patch
 */
export function commitStructural(patch) {
  const next = merged(patch);
  liveParams.value = null;
  remember(next);
  const rows = effectivePipelines.value;
  if (structuralBlock(rows)) xfRefusal.value = stageStructural(rows, next) || "";
}

/**
 * Pick a Structural preset: its speaker angle and center character, the head kept.
 *
 * @param {string} id
 */
export function pickStructuralPreset(id) {
  const hit = PRESETS.find((p) => p.id === id);
  if (hit) commitStructural({ angle: hit.angle, lambda: hit.lambda });
}
