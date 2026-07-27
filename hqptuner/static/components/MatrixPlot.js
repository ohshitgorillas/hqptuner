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
import { effectivePipelines, pipelineBaseline, stagePipelines } from "../store/state.js";
import { parseProcess, serializeProcess, IIR_TYPES } from "../lib/matrixspec.js";
import { chainResponse, bandFreqs } from "../lib/dsp.js";
import { clamp } from "../lib/coerce.js";
import { PlotFrame } from "./plots.js";
import { Knob } from "./Knob.js";
import { xfeedLensTraces, xfeedBlock } from "./XfeedComp.js";
import { structuralBlock } from "../lib/xfmode.js";
import { structuralLensTraces } from "./StructuralXfeed.js";
import { Card } from "./tabs/common.js";

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
// In-flight drag override: {row, stage, args}, client-only — an arg patch
// (strings, e.g. {f, g} from a dot drag or {q} from the band strip) merged into
// the plotted stage list so the curve tracks the gesture with zero server
// traffic; the release commits through stagePipelines like any pipeline edit.
const GAIN_TYPES = new Set(["peak", "lshelf", "hshelf"]);
const dragEq = signal(null);

const stageKey = (s) => JSON.stringify({ kind: s.kind, args: s.args });
const keyAt = (rows, row, stageIdx) => stageKey(parseProcess(rows[row].process)[stageIdx]);

// A byte-identical stage is ONE band rendered into many pipelines — a stereo
// pair, or every row of a crossfeed block (where the shared EQ sits at
// DIFFERENT indices behind the lp1/delay structural stages, so same-index
// matching cannot be the rule). A drag or commit therefore moves every
// byte-identical copy wherever it sits in whichever chain; anything not
// byte-identical is left alone. This keeps merged curves merged mid-drag and
// keeps a block's rows consistent — an index-based edit would silently
// dismantle it.
const patched = (stages, key, args) =>
  stages.map((s) => (stageKey(s) === key ? { ...s, args: { ...s.args, ...args }, raw: undefined } : s));

function withDrag(rows, i) {
  const stages = parseProcess(rows[i].process);
  const d = dragEq.value;
  return d ? patched(stages, d.key, d.args) : stages;
}

// Release: rewrite the patched args on every byte-identical copy.
function commitStage(rows, row, stageIdx, patch) {
  dragEq.value = null;
  const key = keyAt(rows, row, stageIdx);
  const next = rows.map((r) => {
    const stages = parseProcess(r.process);
    if (!stages.some((s) => stageKey(s) === key)) return r;
    return { ...r, process: serializeProcess(patched(stages, key, patch)) };
  });
  stagePipelines(next);
}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

function rowHandles(rows, plotted) {
  const handles = [];
  const sel = selectedStage.value;
  plotted.forEach((i, k) => {
    withDrag(rows, i).forEach((s, j) => {
      if (s.kind !== "iir" || !GAIN_TYPES.has(s.args.type)) return;
      const f = Number(s.args.f);
      const g = Number(s.args.g);
      if (!Number.isFinite(f) || !Number.isFinite(g)) return;
      // drag-readout label: pipeline number + type, plus the width arg the drag
      // holds fixed (q/bw/s) so the readout states the band's full identity
      const width = s.args.q ? ` Q${s.args.q}` : s.args.bw ? ` bw${s.args.bw}` : s.args.s ? ` S${s.args.s}` : "";
      handles.push({
        f,
        db: g,
        // gain moves clamp to the band-strip policy range, not the plot's
        // auto-scaled viewport — the visible axis must never cap a drag
        dbMin: BAND_ARGS.g.min,
        dbMax: BAND_ARGS.g.max,
        label: `${i + 1} · ${s.args.type}${width}`,
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

// ── band strip: knob + slider + exact-box trios for the selected iir stage ───
// Docked under the plot. First visual control for the width arg (Q/bw/s) — the
// dot drag only carries f/g. Streams through the same dragEq override and lands
// through the same pair-synced commit as the dot, so curve, dot, docked editor
// and strip stay in step by construction. biquad (raw coefficients) and
// non-iir stages keep the docked editor only. Ranges are UI policy (hqplayerd
// documents the args, not their bounds): f spans the audio band, g matches the
// plot's ±24 dB ceiling, Q/bw/s cover the practical RBJ envelope; the docked
// editor still accepts anything outside them.
const BAND_ARGS = {
  f: { name: "freq", min: 20, max: 20000, step: 1, unit: "Hz", scale: "log", round: Math.round },
  g: { name: "gain", min: -24, max: 24, step: 0.1, unit: "dB", round: r1 },
  q: { name: "Q", min: 0.1, max: 16, step: 0.01, scale: "log", round: r2 },
  bw: { name: "bandwidth", min: 0.05, max: 8, step: 0.01, unit: "oct", round: r2 },
  s: { name: "slope", min: 0.1, max: 2, step: 0.01, round: r2 },
};

// The stage the strip can edit, or null: an iir stage of the selection whose
// type schema carries at least one slider-able arg (biquad's raw coefficients
// don't qualify — those keep the docked text editor only).
function stripTarget(rows) {
  const sel = selectedStage.value;
  if (!sel || sel.row >= rows.length) return null;
  const st = withDrag(rows, sel.row)[sel.stage];
  if (!st || st.kind !== "iir") return null;
  const schema = IIR_TYPES[st.args.type];
  if (!schema) return null;
  const shown = [...schema.args, ...(schema.oneOf || [])].filter((a) => BAND_ARGS[a] && st.args[a] !== undefined);
  return shown.length ? { sel, st, shown } : null;
}

// Strip title: every pipeline carrying a byte-identical copy — the same rule
// commitStage moves copies by, so the name states what a commit will actually
// touch. "1+2" for a stereo pair; a block's shared EQ names the row count.
function stripName(rows, sel) {
  const mine = keyAt(rows, sel.row, sel.stage);
  const idxs = rows.flatMap((r, i) => (parseProcess(r.process).some((s) => stageKey(s) === mine) ? [i] : []));
  return idxs.length > 2 ? `${idxs.length} pipelines` : idxs.map((i) => i + 1).join("+");
}

// Three STANDING slots — freq | gain | width — the strip's geometry NEVER
// changes with the selection (a shape-shifting strip moves the page bottom and
// the scroll position under the user). The width slot shows whichever width
// arg the selection carries (q/bw/s); a slot whose arg the selection lacks —
// or every slot, with nothing selected — renders the same knob disabled at a
// neutral value.
const IDLE_VALS = { f: 1000, g: 0, q: 1, bw: 1, s: 1 };
const WIDTH_ARGS = ["q", "bw", "s"];

function slotArgs(t) {
  const width = t && WIDTH_ARGS.find((a) => t.shown.includes(a));
  return ["f", "g", width || "q"];
}

function BandKnob({ rows, t, a }) {
  const spec = BAND_ARGS[a];
  const live = !!(t && t.shown.includes(a));
  const v = live ? Number(t.st.args[a]) : IDLE_VALS[a];
  const patch = (nv) => {
    const n = Number(nv);
    return Number.isFinite(n) ? { [a]: String(spec.round(clamp(n, spec.min, spec.max))) } : null;
  };
  return html`
    <div class="band-arg">
      <span class="t-label">${spec.name}</span>
      <${Knob}
        value=${Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.min}
        min=${spec.min}
        max=${spec.max}
        step=${spec.step}
        unit=${spec.unit}
        scale=${spec.scale}
        label=${spec.name}
        disabled=${!live}
        onLive=${
          live
            ? (nv) => {
                const p = patch(nv);
                if (p) dragEq.value = { key: keyAt(rows, t.sel.row, t.sel.stage), args: p };
              }
            : null
        }
        onCommit=${
          live
            ? (nv) => {
                const p = patch(nv);
                if (p) commitStage(rows, t.sel.row, t.sel.stage, p);
              }
            : null
        }
      />
    </div>
  `;
}

// STANDING, like the plot card above it — always rendered at full size, so the
// block is there before anything is selected. No editable selection -> the
// same knob trio, disabled, and a head line saying how to bind it. Never a
// vanished or collapsed block.
function BandStrip({ rows }) {
  const t = stripTarget(rows);
  const head = t
    ? html`<div class="t-label mono">${stripName(rows, t.sel)} · ${t.st.args.type}</div>`
    : html`<div class="t-caption">No band selected — click a stage chip or a plot dot to edit it here.</div>`;
  return html`
    <div class="band-strip">
      ${head}
      <div class="band-slots">
        ${slotArgs(t).map(
          (a, i) => html`
            ${i ? html`<span class="col-rule"></span>` : null}
            <${BandKnob} rows=${rows} t=${t} a=${a} />
          `,
        )}
      </div>
    </div>
  `;
}

function rowTraces(rows, plotted, bounds) {
  const freqs = bandFreqs(160);
  // Collapse rows with an identical processing chain (stereo pairs land byte-
  // identical) into one curve, labeled with every pipeline number it covers —
  // so a stereo EQ is a single "1+2" trace, not two overlapping ones with
  // doubled legends.
  const groups = [];
  const byKey = new Map();
  plotted.forEach((i) => {
    const stages = withDrag(rows, i);
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
  const freqs = bandFreqs(160);
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
  const freqs = bandFreqs(160);
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

// Reference to tune against: the APPLIED response — pipelineBaseline, the
// daemon's file truth — as dashed muted ghost magnitude curves under the
// working traces, present whenever the working picture differs (staged edits
// or an in-flight drag). A block baseline (crossfeed applied) ghosts its
// recovered EQ curve instead of the block's internal rows.
function editedAway(rows, base, plotted) {
  if (dragEq.value !== null) return true;
  if (rows.length !== base.length) return true;
  return plotted.some((i) => (rows[i].process || "") !== ((base[i] && base[i].process) || ""));
}

function appliedTraces(base, plotted, bounds) {
  if (structuralBlock(base) || xfeedBlock(base).rec) {
    const eq = eqOverviewTrace(base, bounds) || [];
    return eq.filter((t) => !t.y2).map((t) => ({ points: t.points, kind: "ghost", ghost: true, label: "applied" }));
  }
  const byKey = new Map();
  plotted.forEach((i) => {
    if (!base[i]) return;
    const stages = parseProcess(base[i].process);
    if (!stages.length) return;
    const key = serializeProcess(stages);
    let g = byKey.get(key);
    if (!g) {
      g = { stages, idxs: [] };
      byKey.set(key, g);
    }
    g.idxs.push(i);
  });
  const freqs = bandFreqs(160);
  return [...byKey.values()].map((g) => {
    const mag = [];
    for (const f of freqs) {
      const r = chainResponse(g.stages, f, FS);
      mag.push([f, r.db]);
      bounds.min = Math.min(bounds.min, r.db);
      bounds.max = Math.max(bounds.max, r.db);
    }
    return { points: mag, kind: "ghost", ghost: true, label: `${g.idxs.map((i) => i + 1).join("+")} applied` };
  });
}

function previewTrace(preview, bounds) {
  const freqs = bandFreqs(160);
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
  const base = pipelineBaseline.value;
  if (editedAway(rows, base, plotted)) traces.unshift(...appliedTraces(base, plotted, bounds));
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
    <${Card} title="Matrix response">
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
