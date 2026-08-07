// Trace builders for the matrix RESPONSE plot (MatrixPlot.js): working-row
// magnitude/phase curves, the crossfeed-block EQ overview, applied-baseline
// ghosts and the library-picker preview. Pure client math (lib/dsp/chain.js),
// recomputed per render off the staged pipeline signals — no server
// round-trip.
import { parseProcess, serializeProcess } from "../lib/matrixspec.js";
import { chainResponse } from "../lib/dsp/chain.js";
import { bandFreqs } from "../lib/dsp/curves.js";
import { xfeedBlock } from "./XfeedComp.js";
import { structuralBlock } from "../store/xfmode.js";
import { withDrag, dragEq } from "./BandStrip.js";

/**
 * @typedef {{ source: string, gain: string, gainunit: string, mixdown: string, process: string }} PipelineRow
 *   One matrix pipeline as store/resolve.js canonicalizes it — every field a
 *   string, because the config XML and the /matrix form both carry text.
 * @typedef {import("../lib/matrixspec.js").MatrixStage} Stage
 *   One parsed `process` stage, as lib/matrixspec.js parseProcess emits it.
 * @typedef {{ min: number, max: number }} Bounds
 *   The dB window the plot auto-scales to. Widened IN PLACE by every builder
 *   here, so the caller's object is the accumulator.
 * @typedef {{ stages: Stage[], idxs: number[] }} Group
 *   Rows sharing a byte-identical chain, drawn as one curve labelled with every
 *   pipeline number it covers.
 * @typedef {PlotTrace & { ghost?: boolean }} GhostTrace
 *   An applied-baseline curve: a PlotTrace flagged for the muted dashed style.
 * @typedef {{ eqProcess: { left: string, right: string } }} StructuralRec
 *   The part of a recognized structural crossfeed block these traces read: the
 *   per-ear EQ chain it was built from (store/xfmode.js).
 */

// Same fixed audio-band reference rate as the loudness plot: the digital-biquad
// shape across 20 Hz–20 kHz is near rate-independent once fs is well above audio.
const FS = 48000;
export const HUES = ["r0", "r1", "r2", "r3"];

/**
 * @param {PipelineRow[]} rows
 * @param {number[]} plotted
 * @param {Bounds} bounds
 * @returns {{ traces: PlotTrace[], anyPartial: boolean }}
 */
export function rowTraces(rows, plotted, bounds) {
  const freqs = bandFreqs(160);
  // Collapse rows with an identical processing chain (stereo pairs land byte-
  // identical) into one curve, labeled with every pipeline number it covers —
  // so a stereo EQ is a single "1+2" trace, not two overlapping ones with
  // doubled legends.
  /** @type {Group[]} */
  const groups = [];
  /** @type {Map<string, Group>} */
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
  /** @type {PlotTrace[]} */
  const traces = [];
  let anyPartial = false;
  groups.forEach((g, k) => {
    /** @type {[number, number][]} */
    const mag = [];
    /** @type {[number, number][]} */
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
/**
 * @param {PipelineRow[]} rows
 * @param {Bounds} bounds
 * @returns {PlotTrace[] | null}
 */
export function eqOverviewTrace(rows, bounds) {
  const structural = structuralBlock(rows);
  if (structural) return structuralEqTraces(structural, bounds);
  const { rec } = xfeedBlock(rows);
  if (!rec) return null;
  const stages = parseProcess(rec.eqProcess);
  if (!stages.length) return null;
  const freqs = bandFreqs(160);
  /** @type {[number, number][]} */
  const mag = [];
  /** @type {[number, number][]} */
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
/**
 * @param {StructuralRec} rec
 * @param {Bounds} bounds
 * @returns {PlotTrace[] | null}
 */
function structuralEqTraces(rec, bounds) {
  const sides =
    rec.eqProcess.left === rec.eqProcess.right
      ? [["EQ", rec.eqProcess.left]]
      : [
          ["EQ left", rec.eqProcess.left],
          ["EQ right", rec.eqProcess.right],
        ];
  const freqs = bandFreqs(160);
  /** @type {PlotTrace[]} */
  const out = [];
  for (const [label, chain] of sides) {
    const stages = parseProcess(chain);
    if (!stages.length) continue;
    /** @type {[number, number][]} */
    const mag = [];
    /** @type {[number, number][]} */
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
/**
 * @param {PipelineRow[]} rows
 * @param {PipelineRow[]} base
 * @param {number[]} plotted
 * @returns {boolean}
 */
export function editedAway(rows, base, plotted) {
  if (dragEq.value !== null) return true;
  if (rows.length !== base.length) return true;
  return plotted.some((i) => (rows[i].process || "") !== ((base[i] && base[i].process) || ""));
}

/**
 * @param {PipelineRow[]} base
 * @param {number[]} plotted
 * @param {Bounds} bounds
 * @returns {GhostTrace[]}
 */
export function appliedTraces(base, plotted, bounds) {
  if (structuralBlock(base) || xfeedBlock(base).rec) {
    const eq = eqOverviewTrace(base, bounds) || [];
    return eq.filter((t) => !t.y2).map((t) => ({ points: t.points, kind: "ghost", ghost: true, label: "applied" }));
  }
  /** @type {Map<string, Group>} */
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
    /** @type {[number, number][]} */
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

/**
 * @param {{ label: string, stages: Stage[] }} preview
 * @param {Bounds} bounds
 * @returns {PlotTrace}
 */
export function previewTrace(preview, bounds) {
  const freqs = bandFreqs(160);
  /** @type {[number, number][]} */
  const mag = [];
  for (const f of freqs) {
    const r = chainResponse(preview.stages, f, FS);
    mag.push([f, r.db]);
    bounds.min = Math.min(bounds.min, r.db);
    bounds.max = Math.max(bounds.max, r.db);
  }
  return { points: mag, kind: "mag prev", label: "preview" };
}
