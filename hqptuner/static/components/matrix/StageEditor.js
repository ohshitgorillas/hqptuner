// The docked inline stage editor — step 4 of the delivery order (matrix-spec
// §8). Selecting a stage chip outlines it and docks this panel under its row (no
// modal). `convDraft` and `uploadNote` are
// private to this module, and `setSelected` lives here because clearing the
// draft is exactly what it is for.
import {} from "../../vendor/eqlab/core/matrixspec.js";

/**
 * @typedef {import("../../vendor/eqlab/core/matrixspec.js").MatrixStage} MatrixStage
 * @typedef {import("../../vendor/eqlab/core/matrixspec.js").IirSchema} IirSchema
 * @typedef {{ row: number, stage: number }} StageRef
 *   Which stage the editor is docked under: pipeline row, then index within
 *   that row's parsed chain.
 * @typedef {(patch: Record<string, string>) => void} Commit
 *   Land an argument patch on the edited stage (or `file` on a conv stage) —
 *   the same patch shape lib/matrixspec.js editedStage takes.
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
