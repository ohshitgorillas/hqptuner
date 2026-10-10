// RESPONSE card: a STANDING card at the section bottom, always rendered like
// the crossfeed/loudness graphs. With nothing to plot it shows axes + an
// empty-state caption. Overlaid magnitude (solid, dB left axis) + phase
// (dashed, ±180° second axis) for every plot-toggled pipeline, log
// 20 Hz–20 kHz; a library-picker preview overlays as a dashed accent magnitude
// trace so candidate-vs-current is a visual A/B.
// Pure client math (lib/dsp/chain.js), recomputed per render off the staged
// pipeline signals — no server round-trip. Convolution stages plot only when
// their IR was uploaded this session (registerIr); otherwise marked partial.
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
 *   A PlotHandle carrying this card's drag contract: the band-strip clamp range,
 *   a readout label, and the select/drag/commit callbacks PlotFrame invokes.
 */

// Library-picker preview: { label, stages } or null. Set by MatrixLibrary on
// selection, cleared on deselect/panel close — never touches pipeline state.
export const previewEq = signal(null);
