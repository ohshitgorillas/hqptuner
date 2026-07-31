// The probe and evaluate jobs, plus the panel shape both share with search.

import { applyChanges, serialize } from "./chain.js";
import { guidanceFlags } from "./guidance.js";
import { computeMetrics, curveOf, extrema, metricValues, preampDb, round } from "./metrics.js";
import { noteDeltas, noteTable } from "./notes.js";

/** Everything measured about one chain: preamp, metric panel, process string. */
export function panelOf(stages, fs, metricSpecs) {
  const curve = curveOf(stages, fs);
  const panel = computeMetrics(curve, metricSpecs);
  return {
    curve,
    panel,
    out: {
      process: serialize(stages),
      band_count: stages.length,
      preamp_db: round(preampDb(curve), 2),
      partial: curve.partial,
      metrics: Object.fromEntries(
        Object.entries(panel).map(([k, v]) => [k, { value: round(v.value), ...(v.hz ? { hz: round(v.hz, 2) } : {}) }]),
      ),
    },
  };
}

const roundNotes = (rows) =>
  rows &&
  rows.map((n) => ({
    ...n,
    hz: round(n.hz, 2),
    harmonics: n.harmonics.map((h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, round(v, 3)]))),
  }));

export function probe(_job, ctx) {
  const { curve, out } = panelOf(ctx.stages, ctx.fs, ctx.metrics);
  return {
    ...out,
    extrema: extrema(curve).map((e) => ({ kind: e.kind, hz: round(e.hz, 2), db: round(e.db) })),
    notes: roundNotes(noteTable(curve, ctx.notes)),
  };
}

export function evaluateJob(job, ctx) {
  const { stages, edits } = applyChanges(ctx.stages, job.changes || job);
  const before = panelOf(ctx.stages, ctx.fs, ctx.metrics);
  const after = panelOf(stages, ctx.fs, ctx.metrics);
  const [bv, av] = [metricValues(before.panel), metricValues(after.panel)];
  return {
    before: before.out,
    after: after.out,
    metric_deltas: Object.fromEntries(Object.keys(av).map((k) => [k, round(av[k] - bv[k])])),
    edits: edits.map((e) => ({ kind: e.kind, index: e.index, before: e.before, after: e.after })),
    flags: guidanceFlags(edits, stages),
    note_deltas: roundNotes(noteDeltas(before.curve, after.curve, ctx.notes)),
  };
}
