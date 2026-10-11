// A pipeline row's parsed stages with any in-flight drag patch (`dragEq`)
// merged in: withDrag, which the matrix response traces read rows through
// (plot-traces.js rowTraces), and the stage typedefs.
import { signal } from "@preact/signals";
import { parseProcess } from "../../vendor/eqlab/core/matrixspec.js";

/**
 * @typedef {import("../../vendor/eqlab/core/matrixspec.js").PipelineRow} PipelineRow
 * @typedef {import("../../vendor/eqlab/core/matrixspec.js").MatrixStage} Stage
 * @typedef {{ row: number, stage: number }} StageSel
 *   A pipeline row and a stage within it.
 * @typedef {{ name: string, min: number, max: number, step: number, unit?: string, scale?: string,
 *             round: (v: number) => number }} BandSpec
 *   One editable iir argument's range, step, unit, scale and rounding.
 * @typedef {{ sel: StageSel, st: Stage, shown: string[] }} StripTarget
 *   A selected stage, plus the arg names offered for it.
 */

// In-flight drag override: {key, args}, client-only — an arg patch (strings,
// e.g. {f, g}) merged into every plotted stage whose serialized form is `key`,
// so the curve tracks the gesture with zero server traffic.
const dragEq = signal(null);

const stageKey = (/** @type {Stage} */ s) => JSON.stringify({ kind: s.kind, args: s.args });

// A byte-identical stage is ONE band rendered into many pipelines — a stereo
// pair, or every row of a crossfeed block (where the shared EQ sits at
// DIFFERENT indices behind the lp1/delay structural stages, so same-index
// matching cannot be the rule). A drag therefore moves every
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
