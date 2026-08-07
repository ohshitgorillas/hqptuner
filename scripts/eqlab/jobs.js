// The probe, evaluate and diff jobs, plus the panel shape all share with search.

import { serializeProcess, stageArgs } from "../../hqptuner/static/lib/matrixspec.js";
import { applyChanges, isEq, resolveChain } from "./chain.js";
import { curveOf, extrema, preampDb, preampDbFull, round } from "./curve.js";
import { fitOfEdits } from "./fit.js";
import { guidanceFlags, headroomFlags } from "./guidance.js";
import { computeMetrics, metricValues } from "./metrics.js";
import { noteDeltas, noteTable } from "./notes.js";

/** @typedef {import("../../hqptuner/static/lib/matrixspec.js").MatrixStage} MatrixStage */
/** @typedef {import("../../hqptuner/static/lib/matrixspec.js").StageArgs} StageArgs */
/** @typedef {import("./metrics.js").MetricSpec} MetricSpec */
/** @typedef {import("./curve.js").Curve} Curve */
/** @typedef {import("./metrics.js").MetricResult} MetricResult */
/** @typedef {import("./target.js").TargetCurve} TargetCurve */
/** @typedef {import("./notes.js").NoteSpec} NoteSpec */
/** @typedef {import("./chain.js").Edit} Edit */
/** @typedef {import("./guidance.js").Flag} Flag */

/**
 * What every job is run against: the resolved chain and the job-wide settings
 * each job reads the parts of that it needs.
 *
 * @typedef {{
 *   stages: MatrixStage[],
 *   fs: number,
 *   metrics?: Record<string, MetricSpec> | null,
 *   target?: TargetCurve | null,
 *   notes?: NoteSpec | null,
 * }} JobCtx
 */

/**
 * One chain's measured panel as it appears in a job's JSON.
 *
 * @typedef {{
 *   process: string,
 *   band_count: number,
 *   preamp_db: number,
 *   preamp_db_full: number,
 *   partial: boolean,
 *   metrics: Record<string, { value: number, hz?: number }>,
 * }} PanelOut
 */

/**
 * One note row after rounding for output.
 *
 * `harmonics` is an index signature because the two producers put different
 * keys in it: `noteTable` writes `{n, hz, db}` and `noteDeltas` writes
 * `{n, hz, before, after, delta}`. `undefined` is in the value union for
 * exactly that reason — reading `delta` off a note-table row finds nothing, and
 * render.js tests for it.
 *
 * @typedef {{
 *   midi: number,
 *   name: string,
 *   hz: number,
 *   harmonics: Record<string, number | null | undefined>[],
 * }} RoundedNote
 */

/**
 * Everything measured about one chain: preamp, metric panel, process string.
 *
 * @param {MatrixStage[]} stages
 * @param {number} fs
 * @param {Record<string, MetricSpec> | null | undefined} metricSpecs
 * @param {TargetCurve | null | undefined} target
 * @returns {{ curve: Curve, panel: Record<string, MetricResult>, preamp: number, preampFull: number, out: PanelOut }}
 */
function panelOf(stages, fs, metricSpecs, target) {
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
      process: serializeProcess(stages),
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

/**
 * @param {ReturnType<typeof noteTable> | ReturnType<typeof noteDeltas>} rows
 * @returns {RoundedNote[] | null}
 */
const roundNotes = (rows) =>
  rows &&
  rows.map((n) => ({
    ...n,
    hz: round(n.hz, 2),
    harmonics: n.harmonics.map((h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, round(v, 3)]))),
  }));

/**
 * The chain as it stands, no edit applied: the metric panel, the summed
 * response's peaks and dips in Hz/dB, and the note table.
 *
 * @param {unknown} _job
 * @param {JobCtx} ctx
 * @returns {PanelOut & { extrema: { kind: string, hz: number, db: number }[], notes: RoundedNote[] | null }}
 */
export function probe(_job, ctx) {
  const { curve, out } = panelOf(ctx.stages, ctx.fs, ctx.metrics, ctx.target);
  return {
    ...out,
    extrema: extrema(curve).map((e) => ({ kind: e.kind, hz: round(e.hz, 2), db: round(e.db) })),
    notes: roundNotes(noteTable(curve, ctx.notes)),
  };
}

// An append has no `before` — it added a band that was not there. The third
// branch spells that out rather than reading a key off it: the emitted JSON is
// unchanged either way, since `JSON.stringify` drops an undefined value.
const editOut = (/** @type {Edit} */ e) => {
  if (e.kind === "replace") return { kind: e.kind, removed: e.removed, added: e.added };
  if (e.kind === "amend") return { kind: e.kind, index: e.index, before: e.before, after: e.after };
  return { kind: e.kind, index: e.index, after: e.after };
};

// EQ bands of one side keyed by exact f — the same literal-match rule as
// `select`. An f carried by more than one band on a side stays unmatched.
/**
 * @param {MatrixStage[]} stages
 * @returns {Map<string, MatrixStage | null>}
 */
function bandsByF(stages) {
  /** @type {Map<string, MatrixStage | null>} */
  const map = new Map();
  for (const s of stages.filter(isEq)) {
    const f = stageArgs(s).f;
    map.set(f, map.has(f) ? null : s);
  }
  return map;
}

const NUMERIC_PARAMS = ["g", "q", "bw", "s"];

/**
 * @param {string} f
 * @param {MatrixStage} a
 * @param {MatrixStage} b
 * @returns {{ f: number, a: StageArgs, b: StageArgs, deltas: Record<string, number> }}
 */
function bandPairDiff(f, a, b) {
  /** @type {Record<string, number>} */
  const deltas = {};
  const [aa, ba] = [stageArgs(a), stageArgs(b)];
  for (const k of NUMERIC_PARAMS) {
    if (aa[k] !== undefined || ba[k] !== undefined) {
      deltas[k] = round(Number(ba[k] ?? 0) - Number(aa[k] ?? 0));
    }
  }
  return { f: Number(f), a: aa, b: ba, deltas };
}

/**
 * @param {MatrixStage[]} stagesA
 * @param {MatrixStage[]} stagesB
 * @returns {{ matched: ReturnType<typeof bandPairDiff>[], only_a: StageArgs[], only_b: StageArgs[] }}
 */
function bandDiff(stagesA, stagesB) {
  const [byA, byB] = [bandsByF(stagesA), bandsByF(stagesB)];
  /** @type {ReturnType<typeof bandPairDiff>[]} */
  const matched = [];
  for (const [f, a] of byA) {
    const b = byB.get(f);
    if (a && b) matched.push(bandPairDiff(f, a, b));
  }
  /**
   * @param {MatrixStage[]} stages
   * @param {Map<string, MatrixStage | null>} own
   * @param {Map<string, MatrixStage | null>} other
   * @returns {StageArgs[]}
   */
  const unmatched = (stages, own, other) =>
    stages
      .filter(isEq)
      .filter((s) => !(own.get(stageArgs(s).f) && other.get(stageArgs(s).f)))
      .map((s) => stageArgs(s));
  return { matched, only_a: unmatched(stagesA, byA, byB), only_b: unmatched(stagesB, byB, byA) };
}

// rmse / maxdev of (b - a) across the shared grid — the summed responses, so
// it is honest about what actually differs, band bookkeeping aside.
/**
 * @param {Curve} a
 * @param {Curve} b
 * @returns {{ rmse: number, maxdev: number, hz: number }}
 */
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
 *
 * @param {{ against?: import("./chain.js").ChainSpec }} job
 * @param {JobCtx} ctx
 * @returns {Promise<{
 *   a: PanelOut,
 *   b: PanelOut,
 *   against_source: Record<string, unknown>,
 *   against_tail_consistency: import("./chain.js").Consistency | null,
 *   metric_deltas: Record<string, number>,
 *   response_delta: ReturnType<typeof responseDelta>,
 *   bands: ReturnType<typeof bandDiff>,
 *   note_deltas: RoundedNote[] | null,
 * }>}
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

/**
 * One change set applied to the chain and measured against it: panels either
 * side, per-metric deltas, the band edits it took, their fit against the
 * target, guidance and headroom flags, and per-note dB deltas.
 *
 * @param {Parameters<typeof applyChanges>[1] & { changes?: Parameters<typeof applyChanges>[1] }} job
 * @param {JobCtx} ctx
 * @returns {{
 *   before: PanelOut,
 *   after: PanelOut,
 *   metric_deltas: Record<string, number>,
 *   edits: ReturnType<typeof editOut>[],
 *   fit?: ReturnType<typeof fitOfEdits>,
 *   flags: Flag[],
 *   note_deltas: RoundedNote[] | null,
 * }}
 */
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
