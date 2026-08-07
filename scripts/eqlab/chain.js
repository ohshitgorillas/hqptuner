// Chain resolution: where the stages come from, and what a change set does to
// them. Everything here goes through the shipped process-string parser
// (lib/matrixspec.js) — eqlab never writes its own `iir:` grammar.
//
// The one network call in this tool is the GET below; file-backed sources
// (xml, parametric_eq, snapshot) read through io.js.

import {
  parseProcess,
  serializeProcess,
  editedStage,
  fmtArg,
  stageArgs,
} from "../../hqptuner/static/lib/matrixspec.js";
import { readParametricEq, readSnapshot, readXmlRows } from "./io.js";

/** @typedef {import("../../hqptuner/static/lib/matrixspec.js").MatrixStage} MatrixStage */
/** @typedef {import("../../hqptuner/static/lib/matrixspec.js").StageArgs} StageArgs */
/** @typedef {import("./io.js").ChainRow} ChainRow */

/**
 * One band as a job spells it. `type` names the iir filter; the rest are the
 * plugin's own argument names, and each admits a string because a job may
 * write `"1000"` as readily as `1000` — `asArg` normalises both.
 *
 * @typedef {{
 *   type?: string,
 *   f?: number | string,
 *   g?: number | string,
 *   q?: number | string,
 *   bw?: number | string,
 *   s?: number | string,
 * }} Band
 */

/**
 * Whether every row's EQ tail agrees, and which rows dissent. `null` where the
 * source is a single chain rather than a row set (a file or a snapshot), which
 * is a different thing from "checked and consistent".
 *
 * @typedef {{ tail_consistent: boolean, offending_rows: number[], rows_checked: number }} Consistency
 */

/**
 * A resolved chain: the stages, where they came from, and — for row-set sources
 * only — whether the rest of the rows agreed.
 *
 * `source` is a bag rather than a union of the five per-source shapes: it is
 * provenance written straight into the job's answer and never read back by
 * anything in this tool, so a union would buy nothing and cost every producer
 * a discriminant.
 *
 * @typedef {{ stages: MatrixStage[], source: Record<string, unknown>, consistency: Consistency | null }} ChainResult
 */

/**
 * The job's `chain` spec. One shape with everything optional rather than a
 * discriminated union: each `from` handler validates the keys it needs and
 * throws by name, so the runtime check is per-source and the type does not have
 * to be.
 *
 * @typedef {{
 *   from?: string,
 *   bands?: Band[],
 *   url?: string,
 *   row?: number,
 *   eq_only?: boolean,
 *   path?: string,
 *   name?: string,
 *   dir?: string,
 * }} ChainSpec
 */

const DEFAULT_URL = "http://127.0.0.1:8090/api/matrix";

// The EQ tail is defined by stage TYPE, not by plugin: crossfeed's `lp1` is an
// `iir:` stage too, and grouping rows by "their iir stages" splits the 16 rows
// into two groups that differ only by that lead-in.
const EQ_TYPES = new Set(["peak", "lshelf", "hshelf"]);

export const isEq = (/** @type {MatrixStage} */ stage) => stage.kind === "iir" && EQ_TYPES.has(stageArgs(stage).type);

/**
 * The trailing run of parametric-EQ stages — the shared EQ tail of a row.
 *
 * @param {MatrixStage[]} stages
 * @returns {MatrixStage[]}
 */
export function eqTail(stages) {
  let i = stages.length;
  while (i > 0 && isEq(stages[i - 1])) i -= 1;
  return stages.slice(i);
}

/**
 * @param {string} url
 * @returns {Promise<ChainRow[]>}
 */
async function fetchRows(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  const body = await res.json();
  /** @type {ChainRow[]} */
  const rows = (body.data || {}).rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`GET ${url} returned no matrix rows`);
  return [...rows].sort((a, b) => a.index - b.index);
}

/**
 * Do all rows carry an identical EQ tail? Every EQ edit in this workflow is one
 * atomic 16-row write, so a desynced row would otherwise go unnoticed. Row 0 is
 * the reference because it is the row eqlab reads by default.
 *
 * @param {ChainRow[]} rows
 * @returns {Consistency}
 */
export function tailConsistency(rows) {
  const tails = rows.map((r) => serializeProcess(eqTail(parseProcess(r.process || ""))));
  const offending = rows.filter((_, i) => tails[i] !== tails[0]).map((r) => r.index);
  return { tail_consistent: offending.length === 0, offending_rows: offending, rows_checked: rows.length };
}

/** Decimal places per argument. Anything not named here formats at 4. */
/** @type {Record<string, number>} */
const DP = { f: 4, g: 2, q: 4, bw: 4, s: 4 };

const asArg = (/** @type {string} */ key, /** @type {unknown} */ value) =>
  typeof value === "number" ? fmtArg(value, DP[key] ?? 4) : String(value);

/**
 * A band object {type,f,q,g} -> an iir stage with args in schema order.
 *
 * @param {Band} band
 * @returns {MatrixStage}
 */
export function bandToStage(band) {
  const patch = Object.fromEntries(
    Object.entries({ type: "peak", ...band }).map(([k, v]) => [k, k === "type" ? String(v) : asArg(k, v)]),
  );
  return editedStage({ kind: "iir", args: {} }, patch);
}

/**
 * @param {ChainSpec} spec
 * @returns {Promise<ChainResult>}
 */
async function fromDaemon(spec) {
  const url = spec.url || DEFAULT_URL;
  const rows = await fetchRows(url);
  const rowIndex = spec.row ?? 0;
  const row = rows.find((r) => r.index === rowIndex);
  if (!row) throw new Error(`matrix row ${rowIndex} not found (rows ${rows[0].index}..${rows[rows.length - 1].index})`);
  const all = parseProcess(row.process || "");
  const stages = spec.eq_only ? eqTail(all) : all;
  return {
    stages,
    source: {
      kind: "daemon",
      url,
      row: rowIndex,
      eq_only: Boolean(spec.eq_only),
      stage_count: stages.length,
      process: serializeProcess(stages),
    },
    consistency: tailConsistency(rows),
  };
}

/**
 * @param {ChainSpec} spec
 * @returns {Promise<ChainResult>}
 */
async function fromXml(spec) {
  if (!spec.path) throw new Error("chain: xml source needs a path");
  const rows = await readXmlRows(spec.path);
  const rowIndex = spec.row ?? 0;
  const row = rows.find((r) => r.index === rowIndex);
  if (!row) throw new Error(`xml: channel ${rowIndex} not found (rows ${rows.map((r) => r.index).join(", ")})`);
  const all = parseProcess(row.process);
  const stages = spec.eq_only ? eqTail(all) : all;
  return {
    stages,
    source: {
      kind: "xml",
      path: spec.path,
      row: rowIndex,
      eq_only: Boolean(spec.eq_only),
      stage_count: stages.length,
      process: serializeProcess(stages),
    },
    consistency: tailConsistency(rows),
  };
}

/**
 * @param {ChainSpec} spec
 * @returns {Promise<ChainResult>}
 */
async function fromParametricEq(spec) {
  if (!spec.path) throw new Error("chain: parametric_eq source needs a path");
  const { stages, preamp, skipped } = await readParametricEq(spec.path);
  return {
    stages,
    source: {
      kind: "parametric_eq",
      path: spec.path,
      stage_count: stages.length,
      process: serializeProcess(stages),
      // File preamp is provenance only — eqlab chains carry band gains, and
      // preamp_db is always computed from the summed response.
      file_preamp_db: preamp === null ? null : Number(preamp),
      skipped,
    },
    consistency: null,
  };
}

/**
 * @param {ChainSpec} spec
 * @returns {Promise<ChainResult>}
 */
async function fromSnapshot(spec) {
  if (!spec.name) throw new Error("chain: snapshot source needs a name");
  const snap = await readSnapshot({ ...spec, name: spec.name });
  const stages = parseProcess(snap.process);
  return {
    stages,
    source: {
      kind: "snapshot",
      name: snap.name,
      path: snap.path,
      saved_at: snap.saved_at,
      stage_count: stages.length,
      process: serializeProcess(stages),
    },
    consistency: null,
  };
}

/** @type {Record<string, (spec: ChainSpec) => Promise<ChainResult>>} */
const SOURCES = { daemon: fromDaemon, xml: fromXml, parametric_eq: fromParametricEq, snapshot: fromSnapshot };

/**
 * Resolve the job's `chain` spec into stages plus provenance.
 *
 * @param {ChainSpec | null | undefined} spec
 * @returns {Promise<ChainResult>}
 */
export async function resolveChain(spec) {
  if (!spec)
    throw new Error('chain: give {"from": "daemon" | "xml" | "parametric_eq" | "snapshot"} or {"bands":[...]}');
  if (Array.isArray(spec.bands)) {
    const stages = spec.bands.map(bandToStage);
    return {
      stages,
      source: { kind: "bands", stage_count: stages.length, process: serializeProcess(stages) },
      consistency: null,
    };
  }
  const from = SOURCES[spec.from ?? ""];
  if (!from) throw new Error(`chain: unknown source "${spec.from}" (${Object.keys(SOURCES).join(", ")})`);
  return from(spec);
}

/**
 * One entry in a change set's `amend` list: which band, and the arguments to
 * overwrite on it.
 *
 * @typedef {{ select: number | string } & Band} AmendSpec
 */

/**
 * One entry in a change set's `replace` list.
 *
 * @typedef {{
 *   remove: number | string | (number | string)[],
 *   with?: Band | Band[],
 *   fit_range?: [number, number],
 * }} ReplaceSpec
 */

/**
 * What one applied change did, as the job's answer records it.
 *
 * @typedef {{ kind: "amend", index: number, select: number | string, before: StageArgs, after: StageArgs }} AmendEdit
 * @typedef {{
 *   kind: "replace",
 *   removed: { index: number, before: StageArgs }[],
 *   added: { index: number, after: StageArgs }[],
 *   fit_range?: [number, number],
 * }} ReplaceEdit
 * @typedef {{ kind: "append", index: number, after: StageArgs }} AppendEdit
 * @typedef {AmendEdit | ReplaceEdit | AppendEdit} Edit
 */

/**
 * Index of the band whose `f` equals `select` exactly. Never fuzzy.
 *
 * @param {MatrixStage[]} stages
 * @param {number | string} select
 * @returns {number}
 */
export function selectBand(stages, select) {
  const target = Number(select);
  if (!Number.isFinite(target)) throw new Error(`amend: select must be a frequency, got ${JSON.stringify(select)}`);
  const hits = stages.map((s, i) => (isEq(s) && Number(stageArgs(s).f) === target ? i : -1)).filter((i) => i >= 0);
  if (hits.length === 0) {
    const present = stages.filter(isEq).map((s) => stageArgs(s).f);
    throw new Error(`amend: no band at f=${target} (bands present: ${present.join(", ") || "none"})`);
  }
  if (hits.length > 1) throw new Error(`amend: f=${target} matches ${hits.length} bands (stage indices ${hits})`);
  return hits[0];
}

/**
 * @param {MatrixStage[]} stages
 * @param {AmendSpec} change
 * @returns {{ stages: MatrixStage[], edit: AmendEdit }}
 */
function amendOne(stages, change) {
  const { select, ...params } = change;
  const i = selectBand(stages, select);
  const patch = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, k === "type" ? String(v) : asArg(k, v)]));
  const next = [...stages];
  next[i] = editedStage(stages[i], patch);
  return {
    stages: next,
    edit: { kind: "amend", index: i, select, before: stageArgs(stages[i]), after: stageArgs(next[i]) },
  };
}

/**
 * @template T
 * @param {T | T[] | undefined} x
 * @returns {T[]}
 */
const asList = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

// A band is amended or replaced, never both: the amend would be silently
// discarded with its band, which is a contradiction in the change set, not a
// resolvable order of operations.
/**
 * @param {MatrixStage[]} stages
 * @param {ReplaceSpec} spec
 * @param {Set<MatrixStage>} amendedStages
 * @returns {{ stages: MatrixStage[], edit: ReplaceEdit }}
 */
function replaceOne(stages, spec, amendedStages) {
  const removeList = asList(spec.remove);
  if (removeList.length === 0) throw new Error("replace: remove must name at least one band frequency");
  const indices = removeList.map((f) => selectBand(stages, f));
  if (new Set(indices).size !== indices.length)
    throw new Error(`replace: remove names the same band twice (${removeList.join(", ")})`);
  for (const i of indices) {
    if (amendedStages.has(stages[i]))
      throw new Error(`replace: band at f=${stageArgs(stages[i]).f} is also amended — amend or replace, not both`);
  }
  const added = asList(spec.with).map(bandToStage);
  const at = Math.min(...indices);
  const removedSet = new Set(indices);
  const kept = stages.filter((_, i) => !removedSet.has(i));
  const next = [...kept.slice(0, at), ...added, ...kept.slice(at)];
  return {
    stages: next,
    edit: {
      kind: "replace",
      removed: indices.sort((a, b) => a - b).map((i) => ({ index: i, before: stageArgs(stages[i]) })),
      added: added.map((s, j) => ({ index: at + j, after: stageArgs(s) })),
      ...(spec.fit_range ? { fit_range: spec.fit_range } : {}),
    },
  };
}

/**
 * Apply a change set {amend, replace, append} to a stage list. Returns stages + edits.
 *
 * @param {MatrixStage[]} stages
 * @param {{ amend?: AmendSpec | AmendSpec[], replace?: ReplaceSpec | ReplaceSpec[], append?: Band | Band[] } | null | undefined} changes
 * @returns {{ stages: MatrixStage[], edits: Edit[] }}
 */
export function applyChanges(stages, changes) {
  /** @type {Edit[]} */
  const edits = [];
  let out = stages;
  /** @type {Set<MatrixStage>} */
  const amendedStages = new Set();
  for (const change of asList((changes || {}).amend)) {
    const r = amendOne(out, change);
    out = r.stages;
    amendedStages.add(out[r.edit.index]);
    edits.push(r.edit);
  }
  for (const spec of asList((changes || {}).replace)) {
    const r = replaceOne(out, spec, amendedStages);
    out = r.stages;
    edits.push(r.edit);
  }
  for (const band of asList((changes || {}).append)) {
    const stage = bandToStage(band);
    out = [...out, stage];
    edits.push({ kind: "append", index: out.length - 1, after: stageArgs(stage) });
  }
  return { stages: out, edits };
}
