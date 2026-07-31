// Chain resolution: where the stages come from, and what a change set does to
// them. Everything here goes through the shipped process-string parser
// (lib/matrixspec.js) — eqlab never writes its own `iir:` grammar.
//
// READ-ONLY. The one network call in this tool is the GET below.

import { parseProcess, serializeProcess, editedStage, fmtArg } from "../../hqptuner/static/lib/matrixspec.js";

const DEFAULT_URL = "http://127.0.0.1:8090/api/matrix";

// The EQ tail is defined by stage TYPE, not by plugin: crossfeed's `lp1` is an
// `iir:` stage too, and grouping rows by "their iir stages" splits the 16 rows
// into two groups that differ only by that lead-in.
const EQ_TYPES = new Set(["peak", "lshelf", "hshelf"]);

const isEq = (stage) => stage.kind === "iir" && EQ_TYPES.has(stage.args.type);

/** The trailing run of parametric-EQ stages — the shared EQ tail of a row. */
export function eqTail(stages) {
  let i = stages.length;
  while (i > 0 && isEq(stages[i - 1])) i -= 1;
  return stages.slice(i);
}

async function fetchRows(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  const body = await res.json();
  const rows = (body.data || {}).rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`GET ${url} returned no matrix rows`);
  return [...rows].sort((a, b) => a.index - b.index);
}

/**
 * Do all rows carry an identical EQ tail? Every EQ edit in this workflow is one
 * atomic 16-row write, so a desynced row would otherwise go unnoticed. Row 0 is
 * the reference because it is the row eqlab reads by default.
 */
export function tailConsistency(rows) {
  const tails = rows.map((r) => serializeProcess(eqTail(parseProcess(r.process || ""))));
  const offending = rows.filter((_, i) => tails[i] !== tails[0]).map((r) => r.index);
  return { tail_consistent: offending.length === 0, offending_rows: offending, rows_checked: rows.length };
}

const DP = { f: 4, g: 2, q: 4, bw: 4, s: 4 };

const asArg = (key, value) => (typeof value === "number" ? fmtArg(value, DP[key] ?? 4) : String(value));

/** A band object {type,f,q,g} -> an iir stage with args in schema order. */
export function bandToStage(band) {
  const patch = Object.fromEntries(
    Object.entries({ type: "peak", ...band }).map(([k, v]) => [k, k === "type" ? String(v) : asArg(k, v)]),
  );
  return editedStage({ kind: "iir", args: {} }, patch);
}

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

/** Resolve the job's `chain` spec into stages plus provenance. */
export async function resolveChain(spec) {
  if (!spec) throw new Error('chain: give {"from":"daemon"} or {"bands":[...]}');
  if (Array.isArray(spec.bands)) {
    const stages = spec.bands.map(bandToStage);
    return {
      stages,
      source: { kind: "bands", stage_count: stages.length, process: serializeProcess(stages) },
      consistency: null,
    };
  }
  if (spec.from !== "daemon") throw new Error(`chain: unknown source "${spec.from}"`);
  return fromDaemon(spec);
}

/** Index of the band whose `f` equals `select` exactly. Never fuzzy. */
export function selectBand(stages, select) {
  const target = Number(select);
  if (!Number.isFinite(target)) throw new Error(`amend: select must be a frequency, got ${JSON.stringify(select)}`);
  const hits = stages.map((s, i) => (isEq(s) && Number(s.args.f) === target ? i : -1)).filter((i) => i >= 0);
  if (hits.length === 0) {
    const present = stages.filter(isEq).map((s) => s.args.f);
    throw new Error(`amend: no band at f=${target} (bands present: ${present.join(", ") || "none"})`);
  }
  if (hits.length > 1) throw new Error(`amend: f=${target} matches ${hits.length} bands (stage indices ${hits})`);
  return hits[0];
}

function amendOne(stages, change) {
  const { select, ...params } = change;
  const i = selectBand(stages, select);
  const patch = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, k === "type" ? String(v) : asArg(k, v)]));
  const next = [...stages];
  next[i] = editedStage(stages[i], patch);
  return { stages: next, edit: { kind: "amend", index: i, select, before: stages[i].args, after: next[i].args } };
}

const asList = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

// A band is amended or replaced, never both: the amend would be silently
// discarded with its band, which is a contradiction in the change set, not a
// resolvable order of operations.
function replaceOne(stages, spec, amendedStages) {
  const removeList = asList(spec.remove);
  if (removeList.length === 0) throw new Error("replace: remove must name at least one band frequency");
  const indices = removeList.map((f) => selectBand(stages, f));
  if (new Set(indices).size !== indices.length)
    throw new Error(`replace: remove names the same band twice (${removeList.join(", ")})`);
  for (const i of indices) {
    if (amendedStages.has(stages[i]))
      throw new Error(`replace: band at f=${stages[i].args.f} is also amended — amend or replace, not both`);
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
      removed: indices.sort((a, b) => a - b).map((i) => ({ index: i, before: stages[i].args })),
      added: added.map((s, j) => ({ index: at + j, after: s.args })),
      ...(spec.fit_range ? { fit_range: spec.fit_range } : {}),
    },
  };
}

/** Apply a change set {amend, replace, append} to a stage list. Returns stages + edits. */
export function applyChanges(stages, changes) {
  const edits = [];
  let out = stages;
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
    edits.push({ kind: "append", index: out.length - 1, after: stage.args });
  }
  return { stages: out, edits };
}

export const serialize = serializeProcess;
