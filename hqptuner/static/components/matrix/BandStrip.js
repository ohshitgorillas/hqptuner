// ── band strip: knob + slider + exact-box trios for the selected iir stage ───
// Docked under the matrix RESPONSE plot. First visual control for the width arg
// (Q/bw/s) — the dot drag only carries f/g. Streams through the same dragEq
// override and lands through the same pair-synced commit as the dot, so curve,
// dot, docked editor and strip stay in step by construction. biquad (raw
// coefficients) and non-iir stages keep the docked editor only.
import { signal } from "@preact/signals";
import { parseProcess } from "../../vendor/eqlab/core/matrixspec.js";

/**
 * @typedef {import("../../vendor/eqlab/core/matrixspec.js").PipelineRow} PipelineRow
 * @typedef {import("../../vendor/eqlab/core/matrixspec.js").MatrixStage} Stage
 * @typedef {{ row: number, stage: number }} StageSel
 *   Which pipeline row and which stage within it the editor points at.
 * @typedef {{ name: string, min: number, max: number, step: number, unit?: string, scale?: string,
 *             round: (v: number) => number }} BandSpec
 *   One editable iir argument's UI policy — see BAND_ARGS.
 * @typedef {{ sel: StageSel, st: Stage, shown: string[] }} StripTarget
 *   The selected stage the strip can edit, plus the arg names it offers.
 */

// --- draggable EQ handles (peak/lshelf/hshelf stages of plotted rows) --------
// In-flight drag override: {row, stage, args}, client-only — an arg patch
// (strings, e.g. {f, g} from a dot drag or {q} from the band strip) merged into
// the plotted stage list so the curve tracks the gesture with zero server
// traffic; the release commits through stagePipelines like any pipeline edit.
const dragEq = signal(null);

const stageKey = (/** @type {Stage} */ s) => JSON.stringify({ kind: s.kind, args: s.args });

// A byte-identical stage is ONE band rendered into many pipelines — a stereo
// pair, or every row of a crossfeed block (where the shared EQ sits at
// DIFFERENT indices behind the lp1/delay structural stages, so same-index
// matching cannot be the rule). A drag or commit therefore moves every
// byte-identical copy wherever it sits in whichever chain; anything not
// byte-identical is left alone. This keeps merged curves merged mid-drag and
// keeps a block's rows consistent — an index-based edit would silently
// dismantle it.
/**
 * @param {Stage[]} stages
 * @param {string} key
 * @param {Record<string, string>} args
 * @returns {Stage[]}
 */
const patched = (stages, key, args) =>
  stages.map((s) => (stageKey(s) === key ? { ...s, args: { ...s.args, ...args }, raw: undefined } : s));

/**
 * A row's stage list with any in-flight drag patch merged in, so callers plot the gesture rather than the stored value.
 *
 * @param {PipelineRow[]} rows
 * @param {number} i
 * @returns {Stage[]}
 */
export function withDrag(rows, i) {
  const stages = parseProcess(rows[i].process);
  const d = dragEq.value;
  return d ? patched(stages, d.key, d.args) : stages;
}
