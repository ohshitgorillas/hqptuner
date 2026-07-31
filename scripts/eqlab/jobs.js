// The probe, evaluate and diff jobs, plus the panel shape all share with search.

import { applyChanges, isEq, resolveChain, serialize } from "./chain.js";
import { guidanceFlags, headroomFlags } from "./guidance.js";
import {
  computeMetrics,
  curveOf,
  extrema,
  fitOfEdits,
  metricValues,
  preampDb,
  preampDbFull,
  round,
} from "./metrics.js";
import { noteDeltas, noteTable } from "./notes.js";

/** Everything measured about one chain: preamp, metric panel, process string. */
export function panelOf(stages, fs, metricSpecs, target) {
  const curve = curveOf(stages, fs);
  const panel = computeMetrics(curve, metricSpecs, target);
  const preamp = preampDb(curve);
  const preampFull = preampDbFull(stages, fs, preamp);
  return {
    curve,
    panel,
    preamp,
    preampFull,
    out: {
      process: serialize(stages),
      band_count: stages.length,
      preamp_db: round(preamp, 2),
      preamp_db_full: round(preampFull, 2),
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
  const { curve, out } = panelOf(ctx.stages, ctx.fs, ctx.metrics, ctx.target);
  return {
    ...out,
    extrema: extrema(curve).map((e) => ({ kind: e.kind, hz: round(e.hz, 2), db: round(e.db) })),
    notes: roundNotes(noteTable(curve, ctx.notes)),
  };
}

const editOut = (e) =>
  e.kind === "replace"
    ? { kind: e.kind, removed: e.removed, added: e.added }
    : { kind: e.kind, index: e.index, before: e.before, after: e.after };

// EQ bands of one side keyed by exact f — the same literal-match rule as
// `select`. An f carried by more than one band on a side stays unmatched.
function bandsByF(stages) {
  const map = new Map();
  for (const s of stages.filter(isEq)) map.set(s.args.f, map.has(s.args.f) ? null : s);
  return map;
}

const NUMERIC_PARAMS = ["g", "q", "bw", "s"];

function bandPairDiff(f, a, b) {
  const deltas = {};
  for (const k of NUMERIC_PARAMS) {
    if (a.args[k] !== undefined || b.args[k] !== undefined) {
      deltas[k] = round(Number(b.args[k] ?? 0) - Number(a.args[k] ?? 0));
    }
  }
  return { f: Number(f), a: a.args, b: b.args, deltas };
}

function bandDiff(stagesA, stagesB) {
  const [byA, byB] = [bandsByF(stagesA), bandsByF(stagesB)];
  const matched = [];
  for (const [f, a] of byA) {
    const b = byB.get(f);
    if (a && b) matched.push(bandPairDiff(f, a, b));
  }
  const unmatched = (stages, own, other) =>
    stages
      .filter(isEq)
      .filter((s) => !(own.get(s.args.f) && other.get(s.args.f)))
      .map((s) => s.args);
  return { matched, only_a: unmatched(stagesA, byA, byB), only_b: unmatched(stagesB, byB, byA) };
}

// rmse / maxdev of (b - a) across the shared grid — the summed responses, so
// it is honest about what actually differs, band bookkeeping aside.
function responseDelta(a, b) {
  let sq = 0;
  let maxdev = 0;
  let hz = a.freqs[0];
  a.db.forEach((v, i) => {
    const d = b.db[i] - v;
    sq += d * d;
    if (Math.abs(d) > Math.abs(maxdev)) [maxdev, hz] = [d, a.freqs[i]];
  });
  return { rmse: round(Math.sqrt(sq / a.db.length)), maxdev: round(maxdev), hz: round(hz, 2) };
}

/**
 * Diff job: the job's `chain` (A) against `against` (B, any chain source).
 * Deltas are B minus A throughout. Both sides score against the same job
 * target and metric panel.
 */
export async function diffJob(job, ctx) {
  if (!job.against)
    throw new Error('diff: needs "against": a chain spec (daemon, xml, parametric_eq, snapshot, bands)');
  const other = await resolveChain(job.against);
  const a = panelOf(ctx.stages, ctx.fs, ctx.metrics, ctx.target);
  const b = panelOf(other.stages, ctx.fs, ctx.metrics, ctx.target);
  const [av, bv] = [metricValues(a.panel), metricValues(b.panel)];
  return {
    a: a.out,
    b: b.out,
    against_source: other.source,
    against_tail_consistency: other.consistency,
    metric_deltas: Object.fromEntries(Object.keys(bv).map((k) => [k, round(bv[k] - av[k])])),
    response_delta: responseDelta(a.curve, b.curve),
    bands: bandDiff(ctx.stages, other.stages),
    note_deltas: roundNotes(noteDeltas(a.curve, b.curve, ctx.notes)),
  };
}

export function evaluateJob(job, ctx) {
  const { stages, edits } = applyChanges(ctx.stages, job.changes || job);
  const before = panelOf(ctx.stages, ctx.fs, ctx.metrics, ctx.target);
  const after = panelOf(stages, ctx.fs, ctx.metrics, ctx.target);
  const [bv, av] = [metricValues(before.panel), metricValues(after.panel)];
  const fit = fitOfEdits(edits, ctx.fs);
  return {
    before: before.out,
    after: after.out,
    metric_deltas: Object.fromEntries(Object.keys(av).map((k) => [k, round(av[k] - bv[k])])),
    edits: edits.map(editOut),
    ...(fit.length ? { fit } : {}),
    flags: [...guidanceFlags(edits, stages), ...headroomFlags(after.preamp, after.preampFull)],
    note_deltas: roundNotes(noteDeltas(before.curve, after.curve, ctx.notes)),
  };
}
