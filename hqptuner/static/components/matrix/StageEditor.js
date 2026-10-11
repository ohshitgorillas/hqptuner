// The WAV header sniff behind the DSP pipelines drawer's filter upload
// (faceplate/drawers/pipelines/upload.js), and the stage typedefs.
import {} from "../../vendor/eqlab/core/matrixspec.js";

/**
 * @typedef {import("../../vendor/eqlab/core/matrixspec.js").MatrixStage} MatrixStage
 * @typedef {import("../../vendor/eqlab/core/matrixspec.js").IirSchema} IirSchema
 * @typedef {{ row: number, stage: number }} StageRef
 *   A stage's place: pipeline row, then index within that row's parsed chain.
 * @typedef {(patch: Record<string, string>) => void} Commit
 *   Land an argument patch on the edited stage (or `file` on a conv stage) —
 *   the same patch shape vendor/eqlab/core/matrixspec.js editedStage takes.
 * @typedef {(props: { stage: MatrixStage, commit: Commit }) => unknown} EditorFn
 *   One per-kind editor body, dispatched on the stage's kind.
 */

/**
 * Sniff a WAV header's sample rate (fmt chunk) for the 352.8 kHz recommendation
 * (manual §7). Returns null for non-WAV/undetectable — no warning then.
 *
 * @param {DataView} view
 * @returns {number | null}
 */
export function wavRateFromHeader(view) {
  try {
    if (view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) return null;
    let off = 12;
    while (off + 8 < view.byteLength) {
      if (view.getUint32(off, false) === 0x666d7420) return view.getUint32(off + 12, true);
      off += 8 + view.getUint32(off + 4, true);
    }
  } catch {
    /* a truncated header carries no rate */
  }
  return null;
}
