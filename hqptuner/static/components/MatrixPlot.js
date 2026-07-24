// RESPONSE card (matrix-spec step 7 + AutoEq library pass): a STANDING card at
// the section bottom, always rendered like the crossfeed/loudness graphs. With
// nothing to plot it shows axes + an empty-state caption. Overlaid magnitude
// (solid, dB left axis) + phase (dashed, ±180° second axis) for every
// plot-toggled pipeline, log 20 Hz–20 kHz; a library-picker preview overlays as
// a dashed accent magnitude trace so candidate-vs-current is a visual A/B.
// Pure client math (lib/dsp.js), recomputed per render off the staged
// pipeline signals — no server round-trip. Convolution stages plot only when
// their IR was uploaded this session (registerIr); otherwise marked partial.
import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { effectivePipelines, stagePipelines } from "../store/state.js";
import { parseProcess, serializeProcess } from "../lib/matrixspec.js";
import { chainResponse, logFreqs } from "../lib/dsp.js";
import { PlotFrame } from "./plots.js";
import { xfeedLensTraces, xfeedBlock } from "./XfeedComp.js";
import { structuralBlock } from "../lib/xfmode.js";
import { structuralLensTraces } from "./StructuralXfeed.js";

// Same fixed audio-band reference rate as the loudness plot: the digital-biquad
// shape across 20 Hz–20 kHz is near rate-independent once fs is well above audio.
const FS = 48000;
const HUES = ["r0", "r1", "r2", "r3"];

export const plottedRows = signal(new Set());
// Stage selection ({row, stage}) shared with the pipeline editor (it lives here
// so MatrixTab -> MatrixPlot stays a one-way import): the selected chip's dot
// renders highlighted, so the editor and the plot point at the same band.
export const selectedStage = signal(null);
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
function autoDefaultRows(rows) {
  const { rec } = xfeedBlock(rows);
  const structural = structuralBlock(rows);
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
function shownRows(rows) {
  const explicit = plottedRows.value;
  const base = explicit.size ? new Set(explicit) : autoDefaultRows(rows);
  const sel = selectedStage.value;
  if (sel && sel.row < rows.length) base.add(sel.row);
  return base;
}

// True when row `index` is currently drawn (drives the ◉/○ toggle indicator so
// it reflects the plot, including auto-defaulted rows).
export function isPlotted(index) {
  return shownRows(effectivePipelines.value).has(index);
}

// Toggle materializes the current plotted base (explicit set, or the auto-default
// on first click) then flips this row — so "what you see is what's toggled". The
// live stage selection is deliberately not baked in here.
export function togglePlotted(index) {
  const rows = effectivePipelines.value;
  const explicit = plottedRows.value;
  const next = explicit.size ? new Set(explicit) : autoDefaultRows(rows);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  plottedRows.value = next;
}

// --- draggable EQ handles (peak/lshelf/hshelf stages of plotted rows) --------
// In-flight drag override: {row, stage, f, g}, client-only — merged into the
// plotted stage list so the curve tracks the cursor with zero server traffic;
// the release commits through stagePipelines like any pipeline edit.
const GAIN_TYPES = new Set(["peak", "lshelf", "hshelf"]);
const dragEq = signal(null);

function withDrag(i, stages) {
  const d = dragEq.value;
  if (!d || d.row !== i) return stages;
  return stages.map((s, j) =>
    j === d.stage ? { ...s, args: { ...s.args, f: String(d.f), g: String(d.g) }, raw: undefined } : s,
  );
}

// Release: rewrite the dragged stage's f/g (other args untouched). Stereo-pair
// sync: if the adjacent pair row carries a byte-identical stage at the same
// position (how AutoEq imports land), it moves too; a diverged pair is left alone.
function commitDrag(rows, row, stageIdx, f, g) {
  dragEq.value = null;
  const orig = parseProcess(rows[row].process)[stageIdx];
  const origKey = JSON.stringify({ kind: orig.kind, args: orig.args });
  const pair = row % 2 === 0 ? row + 1 : row - 1;
  const next = rows.map((r, i) => {
    if (i !== row && i !== pair) return r;
    const stages = parseProcess(r.process);
    const s = stages[stageIdx];
    if (!s) return r;
    if (i !== row && JSON.stringify({ kind: s.kind, args: s.args }) !== origKey) return r;
    stages[stageIdx] = { ...s, args: { ...s.args, f: String(f), g: String(g) }, raw: undefined };
    return { ...r, process: serializeProcess(stages) };
  });
  stagePipelines(next);
}

function rowHandles(rows, plotted) {
  const handles = [];
  const r1 = (v) => Math.round(v * 10) / 10;
  const sel = selectedStage.value;
  plotted.forEach((i, k) => {
    withDrag(i, parseProcess(rows[i].process)).forEach((s, j) => {
      if (s.kind !== "iir" || !GAIN_TYPES.has(s.args.type)) return;
      const f = Number(s.args.f);
      const g = Number(s.args.g);
      if (!Number.isFinite(f) || !Number.isFinite(g)) return;
      handles.push({
        f,
        db: g,
        kind: HUES[k % HUES.length],
        active: !!(sel && sel.row === i && sel.stage === j),
        onDrag: (nf, ndb) => {
          dragEq.value = { row: i, stage: j, f: Math.round(nf), g: r1(ndb) };
        },
        onEnd: (nf, ndb) => commitDrag(rows, i, j, Math.round(nf), r1(ndb)),
      });
    });
  });
  // stereo-pair dots overlap exactly — draw the highlighted one last so the
  // selection ring is never occluded by its twin
  return handles.sort((a, b) => (a.active ? 1 : 0) - (b.active ? 1 : 0));
}

function rowTraces(rows, plotted, bounds) {
  const freqs = logFreqs(20, 20000, 160);
  // Collapse rows with an identical processing chain (stereo pairs land byte-
  // identical) into one curve, labeled with every pipeline number it covers —
  // so a stereo EQ is a single "1+2" trace, not two overlapping ones with
  // doubled legends.
  const groups = [];
  const byKey = new Map();
  plotted.forEach((i) => {
    const stages = withDrag(i, parseProcess(rows[i].process));
    const key = serializeProcess(stages);
    let g = byKey.get(key);
    if (!g) {
      g = { stages, idxs: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.idxs.push(i);
  });
  const traces = [];
  let anyPartial = false;
  groups.forEach((g, k) => {
    const mag = [];
    const ph = [];
    let partial = false;
    for (const f of freqs) {
      const r = chainResponse(g.stages, f, FS);
      mag.push([f, r.db]);
      ph.push([f, r.deg]);
      partial ||= r.partial;
      bounds.min = Math.min(bounds.min, r.db);
      bounds.max = Math.max(bounds.max, r.db);
    }
    anyPartial ||= partial;
    const hue = HUES[k % HUES.length];
    const name = g.idxs.map((i) => i + 1).join("+");
    traces.push({ points: mag, kind: `mag ${hue}`, label: `${name}${partial ? " ·part" : ""}` });
    traces.push({ points: ph, kind: `ph ${hue}`, label: `${name} φ`, y2: true });
  });
  return { traces, anyPartial };
}

// A recognized crossfeed block is data, but its 8 internal pipelines aren't worth
// plotting individually. Draw the single headphone-EQ curve the block was built
// from (msRecognize recovers it) as the block-only overview.
// The headphone EQ a crossfeed block carries, drawn in place of the block's own
// near-identical internal rows. Both block types hide their rows from the plot,
// so without this the EQ — the curve the user actually tuned — disappears and a
// ~2 dB crossfeed response is left dominating the chart.
function eqOverviewTrace(rows, bounds) {
  const structural = structuralBlock(rows);
  if (structural) return structuralEqTraces(structural, bounds);
  const { rec } = xfeedBlock(rows);
  if (!rec) return null;
  const stages = parseProcess(rec.eqProcess);
  if (!stages.length) return null;
  const freqs = logFreqs(20, 20000, 160);
  const mag = [];
  const ph = [];
  for (const f of freqs) {
    const r = chainResponse(stages, f, FS);
    mag.push([f, r.db]);
    ph.push([f, r.deg]);
    bounds.min = Math.min(bounds.min, r.db);
    bounds.max = Math.max(bounds.max, r.db);
  }
  return [
    { points: mag, kind: "mag", label: "EQ" },
    { points: ph, kind: "ph", label: "EQ φ", y2: true },
  ];
}

// Per ear, because the structural block carries a chain for each. One curve when
// they agree, two labelled ones when they do not.
function structuralEqTraces(rec, bounds) {
  const sides =
    rec.eqProcess.left === rec.eqProcess.right
      ? [["EQ", rec.eqProcess.left]]
      : [
          ["EQ left", rec.eqProcess.left],
          ["EQ right", rec.eqProcess.right],
        ];
  const freqs = logFreqs(20, 20000, 160);
  const out = [];
  for (const [label, chain] of sides) {
    const stages = parseProcess(chain);
    if (!stages.length) continue;
    const mag = [];
    const ph = [];
    for (const f of freqs) {
      const r = chainResponse(stages, f, FS);
      mag.push([f, r.db]);
      ph.push([f, r.deg]);
      bounds.min = Math.min(bounds.min, r.db);
      bounds.max = Math.max(bounds.max, r.db);
    }
    out.push({ points: mag, kind: "mag", label });
    out.push({ points: ph, kind: "ph", label: `${label} φ`, y2: true });
  }
  return out.length ? out : null;
}

function previewTrace(preview, bounds) {
  const freqs = logFreqs(20, 20000, 160);
  const mag = [];
  for (const f of freqs) {
    const r = chainResponse(preview.stages, f, FS);
    mag.push([f, r.db]);
    bounds.min = Math.min(bounds.min, r.db);
    bounds.max = Math.max(bounds.max, r.db);
  }
  return { points: mag, kind: "mag prev", label: "preview" };
}

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
  if (preview) traces.push(previewTrace(preview, bounds));
  traces.push(...xfeedLensTraces(rows, bounds));
  traces.push(...structuralLensTraces(rows, bounds));
  const caption = traces.length
    ? "magnitude solid (dB, left axis) · phase dashed (°, ±180)" +
      (eqOverview ? " · EQ = your headphone EQ; the crossfeed pipelines are hidden — use ∿ what you hear" : "") +
      (preview ? ` · preview dashed: ${preview.label}` : "") +
      (anyPartial ? " · partial: a convolution stage has no preview — re-upload its file to plot it" : "")
    : "No pipeline processing to plot yet — load a profile or add EQ / stages above";
  return html`
    <section class="card">
      <div class="card-head">Matrix response</div>
      <div class="card-body">
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
      </div>
    </section>
  `;
}
