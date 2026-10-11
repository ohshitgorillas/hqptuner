// The AutoEq library picker's preview signal (`previewEq`), and the matrix
// pipeline typedefs.
import { signal } from "@preact/signals";

/**
 * @typedef {{ source: string, gain: string, gainunit: string, mixdown: string, process: string }} PipelineRow
 *   One matrix pipeline as store/resolve.js canonicalizes it — every field a
 *   string, because the config XML and the /matrix form both carry text.
 * @typedef {import("../../vendor/eqlab/core/matrixspec.js").MatrixStage} Stage
 *   One parsed `process` stage: a plugin spec with `args`, or a convolution
 *   stage carrying `file`.
 * @typedef {{
 *   f: number, db: number, dbMin: number, dbMax: number, label: string, kind: string, active: boolean,
 *   onSelect: () => void, onDrag: (f: number, db: number) => void, onEnd: (f: number, db: number) => void,
 * }} DragHandle
 *   A PlotHandle carrying a drag contract: a dB clamp range, a readout label,
 *   and the select/drag/commit callbacks PlotFrame invokes.
 */

// Library-picker preview: { label, stages } or null. Set by Library.js on a
// pick, cleared on deselect (clearLibrarySelection); never touches pipeline state.
export const previewEq = signal(null);
