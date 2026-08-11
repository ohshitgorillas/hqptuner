// RESPONSE card (matrix-spec.md "Response plot"): a STANDING card at
// the section bottom, always rendered like the crossfeed/loudness graphs. With
// nothing to plot it shows axes + an empty-state caption. Overlaid magnitude
// (solid, dB left axis) + phase (dashed, ±180° second axis) for every
// plot-toggled pipeline, log 20 Hz–20 kHz; a library-picker preview overlays as
// a dashed accent magnitude trace so candidate-vs-current is a visual A/B.
// Pure client math (lib/dsp/chain.js), recomputed per render off the staged
// pipeline signals — no server round-trip. Convolution stages plot only when
// their IR was uploaded this session (registerIr); otherwise marked partial.
import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { effectivePipelines, pipelineBaseline } from "../store/resolve.js";
import { parseProcess, stageArgs } from "../lib/matrixspec.js";
import { PlotFrame } from "./plots.js";
import { xfeedLensTraces } from "./XfeedComp.js";
import { xfeedBlock } from "../store/xfeedblock.js";
import { structuralBlock } from "../store/xfmode.js";
import { structuralLensTraces } from "./StructuralXfeed.js";
import { Card } from "./common.js";
import { BypassNote } from "./MatrixBypassNote.js";
import { BandStrip, selectedStage, dragEq, withDrag, keyAt, commitStage, BAND_ARGS, r1 } from "./BandStrip.js";
import { rowTraces, eqOverviewTrace, editedAway, appliedTraces, previewTrace, HUES } from "./matrixplot-traces.js";

/**
 * @typedef {{ source: string, gain: string, gainunit: string, mixdown: string, process: string }} PipelineRow
 *   One matrix pipeline as store/resolve.js canonicalizes it — every field a
 *   string, because the config XML and the /matrix form both carry text.
 * @typedef {import("../lib/matrixspec.js").MatrixStage} Stage
 *   One parsed `process` stage: a plugin spec with `args`, or a convolution
 *   stage carrying `file`.
 * @typedef {{
 *   f: number, db: number, dbMin: number, dbMax: number, label: string, kind: string, active: boolean,
 *   onSelect: () => void, onDrag: (f: number, db: number) => void, onEnd: (f: number, db: number) => void,
 * }} DragHandle
 *   A PlotHandle carrying this card's drag contract: the band-strip clamp range,
 *   a readout label, and the select/drag/commit callbacks PlotFrame invokes.
 */

export const plottedRows = signal(new Set());
// Library-picker preview: { label, stages } or null. Set by MatrixLibrary on
// selection, cleared on deselect/panel close — never touches pipeline state.
export const previewEq = signal(null);

// Rows the plot draws when the user has toggled nothing yet: every pipeline that
// carries processing, EXCEPT a recognized 8-row crossfeed comp block. That block
// is an internal mid/side decomposition — plotting its 8 near-identical rows is
// meaningless noise; MatrixPlot instead draws the single headphone-EQ curve it
// was built from (eqOverviewTrace). Empty result here means genuinely nothing to
// plot as rows (no profile / bare passthrough / block-only — the last still
// draws the EQ overview).
/**
 * @param {PipelineRow[]} rows
 * @returns {Set<number>}
 */
function autoDefaultRows(rows) {
  const { rec } = xfeedBlock(rows);
  const structural = structuralBlock(rows);
  /** @type {Set<number>} */
  const out = new Set();
  rows.forEach((r, i) => {
    if (rec && i < 8) return; // internal crossfeed block — drawn as one EQ curve
    if (structural && i < 16) return; // structural crossfeed — 16 internal rows, lens instead
    if (parseProcess(r.process).length > 0) out.add(i);
  });
  return out;
}

// The set of rows actually on the plot: the user's explicit toggle selection if
// any, else the auto-default, plus the selected stage's row so picking a chip
// always draws its curve.
/**
 * @param {PipelineRow[]} rows
 * @returns {Set<number>}
 */
function shownRows(rows) {
  const explicit = plottedRows.value;
  const base = explicit.size ? new Set(explicit) : autoDefaultRows(rows);
  const sel = selectedStage.value;
  if (sel && sel.row < rows.length) base.add(sel.row);
  return base;
}

/**
 * True when row `index` is currently drawn — including auto-defaulted rows, so the
 * ◉/○ toggle indicator reflects the plot.
 *
 * @param {number} index
 * @returns {boolean}
 */
export function isPlotted(index) {
  return shownRows(effectivePipelines.value).has(index);
}

// The live stage selection is deliberately not baked in here.
/**
 * Flips row `index` on the plot, materializing the current plotted base (explicit
 * set, or the auto-default on first click) first — so "what you see is what's
 * toggled".
 *
 * @param {number} index
 */
export function togglePlotted(index) {
  const rows = effectivePipelines.value;
  const explicit = plottedRows.value;
  const next = explicit.size ? new Set(explicit) : autoDefaultRows(rows);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  plottedRows.value = next;
}

const GAIN_TYPES = new Set(["peak", "lshelf", "hshelf"]);

/**
 * @param {PipelineRow[]} rows
 * @param {number[]} plotted
 * @returns {DragHandle[]}
 */
function rowHandles(rows, plotted) {
  /** @type {DragHandle[]} */
  const handles = [];
  const sel = selectedStage.value;
  plotted.forEach((i, k) => {
    withDrag(rows, i).forEach((/** @type {Stage} */ s, /** @type {number} */ j) => {
      const args = stageArgs(s);
      if (s.kind !== "iir" || !GAIN_TYPES.has(args.type)) return;
      const f = Number(args.f);
      const g = Number(args.g);
      if (!Number.isFinite(f) || !Number.isFinite(g)) return;
      // drag-readout label: pipeline number + type, plus the width arg the drag
      // holds fixed (q/bw/s) so the readout states the band's full identity
      const width = args.q ? ` Q${args.q}` : args.bw ? ` bw${args.bw}` : args.s ? ` S${args.s}` : "";
      handles.push({
        f,
        db: g,
        // gain moves clamp to the band-strip policy range, not the plot's
        // auto-scaled viewport — the visible axis must never cap a drag
        dbMin: BAND_ARGS.g.min,
        dbMax: BAND_ARGS.g.max,
        label: `${i + 1} · ${args.type}${width}`,
        kind: HUES[k % HUES.length],
        active: !!(sel && sel.row === i && sel.stage === j),
        // grabbing the dot selects the band, so the strip and docked editor
        // dock without a trip back to the pipeline chips (REW-style flow)
        onSelect: () => {
          selectedStage.value = { row: i, stage: j };
        },
        onDrag: (nf, ndb) => {
          dragEq.value = { key: keyAt(rows, i, j), args: { f: String(Math.round(nf)), g: String(r1(ndb)) } };
        },
        onEnd: (nf, ndb) => commitStage(rows, i, j, { f: String(Math.round(nf)), g: String(r1(ndb)) }),
      });
    });
  });
  // stereo-pair dots overlap exactly — draw the highlighted one last so the
  // selection ring is never occluded by its twin
  return handles.sort((a, b) => (a.active ? 1 : 0) - (b.active ? 1 : 0));
}

// The lens toggle that gates the traces below lives on the CROSSFEED card
// (components/Crossfeed.js), next to the crossfeed it describes — not here. This
// card only draws what the toggle asks for.
/**
 * The RESPONSE card: overlaid magnitude and phase curves for the plotted pipelines,
 * with the applied-baseline ghosts, crossfeed lenses and picker preview, plus the
 * band strip and drag handles that edit them.
 */
export function MatrixPlot() {
  const rows = effectivePipelines.value;
  const plotted = [...shownRows(rows)].filter((i) => i < rows.length).sort((a, b) => a - b);
  const preview = previewEq.value;
  const bounds = { min: -6, max: 6 };
  const { traces, anyPartial } = rowTraces(rows, plotted, bounds);
  // block-only: no plain rows plotted, but a recognized crossfeed block IS data —
  // draw the single headphone-EQ curve it was built from instead of its 8 rows
  let eqOverview = false;
  if (!traces.length) {
    const eq = eqOverviewTrace(rows, bounds);
    if (eq) {
      traces.push(...eq);
      eqOverview = true;
    }
  }
  const base = pipelineBaseline.value;
  if (editedAway(rows, base, plotted)) traces.unshift(...appliedTraces(base, plotted, bounds));
  if (preview) traces.push(previewTrace(preview, bounds));
  traces.push(...xfeedLensTraces(rows, bounds));
  traces.push(...structuralLensTraces(rows, bounds));
  const caption = traces.length
    ? "magnitude solid (dB, left axis) · phase dashed (°, ±180)" +
      (eqOverview ? " · EQ = your headphone EQ; the crossfeed pipelines are hidden — see ∿ what you hear above" : "") +
      (preview ? ` · preview dashed: ${preview.label}` : "") +
      (anyPartial ? " · partial: a convolution stage has no preview — re-upload its file to plot it" : "")
    : "No pipeline processing to plot yet — load a profile or add EQ / stages above";
  return html`
    <${Card} title="Matrix response">
        ${
          traces.length
            ? html`<${BypassNote} on=${true} text="Matrix engine is bypassed. The changes below are not applied." />`
            : null
        }
        <${PlotFrame}
          traces=${traces}
          yMin=${Math.max(Math.floor(bounds.min / 6) * 6, -36)}
          yMax=${Math.min(Math.ceil(bounds.max / 6) * 6, 36)}
          dbStep=${6}
          height=${240}
          y2Min=${-180}
          y2Max=${180}
          caption=${caption}
          handles=${rowHandles(rows, plotted)}
          autoColor=${true}
        />
        <${BandStrip} rows=${rows} />
    <//>
  `;
}
