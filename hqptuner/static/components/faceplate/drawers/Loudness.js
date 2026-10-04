// The Loudness drawer's block, under the drawer's Loudness gate row: the Bass | Treble bands, then the range bar
// beside v1's loudness plot (components/plots.js LoudnessPlot): the maximum shelving against what the shown volume
// applies, its share the rail's own figure (store/matrix/loudness.js), each band a draggable dot at its frequency and
// level. Everything stages; the block grays, its copy and reason legible, while the matrix engine is bypassed, the
// volume cannot move or loudness is off. The decisions are store/faceplate/drawers/loudness.js's.

import { html } from "../../../lib/dom.js";
import { loudnessMagDb } from "../../../vendor/eqlab/core/dsp/curves.js";
import { loudnessApplied } from "../../../store/matrix/loudness.js";
import {
  bandKey,
  bands,
  dragHandle,
  dropHandle,
  formBounds,
  grabHandle,
  loudnessGray,
} from "../../../store/faceplate/drawers/loudness.js";
import { Bands } from "./loudness/Bands.js";
import { RangeBar } from "./loudness/RangeBar.js";
import { RespPlot } from "./loudness/RespPlot.js";

/** @typedef {import("../../../store/faceplate/drawers/loudness.js").Side} Side */
/** @typedef {import("./loudness/RespPlot.js").Handle} Handle */

// v1 plots.js: the digital-biquad shape is near rate-independent across the band, so one 48 kHz reference.
const FS = 48000;
const SCALE = { lo: -3, hi: 24, step: 6, minor: 3 };

/**
 * A band's dot: at its frequency and level, its drag held to the level's bounds.
 *
 * @param {Side} side
 * @param {number} f
 * @param {number} db
 * @param {boolean} off
 * @returns {Handle}
 */
function handle(side, f, db, off) {
  const { min = -20, max = 20 } = formBounds(bandKey(side, "level"));
  const held = (/** @type {number} */ d) => Math.max(min, Math.min(max, d));
  return {
    f,
    db,
    off,
    onGrab: () => grabHandle(side),
    onDrag: (nf, nd) => dragHandle(side, nf, held(nd)),
    onEnd: (nf, nd) => dropHandle(side, nf, held(nd)),
  };
}

/** The plot: max against the applied share, with both bands' dots. @param {{ grayed: boolean }} props */
function Plot({ grayed }) {
  const p = bands();
  const pct = loudnessApplied();
  return html`<${RespPlot}
    cls=${grayed ? "eq lplot grayed" : "eq lplot"}
    aria="Loudness response"
    scale=${SCALE}
    traces=${[
      { cls: "ghost", id: "max", label: "max", fn: (/** @type {number} */ f) => loudnessMagDb(p, f, FS, 1) },
      { id: "applied", label: `${pct}% applied`, fn: (/** @type {number} */ f) => loudnessMagDb(p, f, FS, pct / 100) },
    ]}
    handles=${[handle("low", p.lowFreq, p.lowLevel, grayed), handle("high", p.highFreq, p.highLevel, grayed)]}
  />`;
}

/**
 * The Loudness drawer's block.
 *
 * @param {{ schema: import("../../../store/faceplate/drawer.js").DrawerSchema }} _props
 */
export function LoudnessBody(_props) {
  const why = loudnessGray();
  return html`
    <${Bands} why=${why} />
    <div class="lbot">
      <${RangeBar} grayed=${!!why} />
      <${Plot} grayed=${!!why} />
    </div>
  `;
}
