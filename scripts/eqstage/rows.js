// Row model for staging: read the baseline row set, edit selected rows, and
// canonicalise the result byte-identically to the web UI's `canonPipelines`
// (static/store/resolve.js) so the pending bar's dirty-compare and the apply's
// verify diff both reduce to string equality.
//
// Nothing here talks to the daemon: the reads are HQPTuner's own REST surface.

import { parseProcess, serializeProcess } from "../../hqptuner/static/lib/matrixspec.js";
import { bandToStage, eqTail, resolveChain } from "../eqlab/chain.js";

const MAX_CHANNELS = 128;
const GAIN_RE = /^-?\d+(\.\d+)?$/;
const GAIN_UNITS = new Set(["dB", "Lin"]);

const hasControlChar = (text) => [...text].some((c) => c.codePointAt(0) < 0x20);

/** One row in the canonical shape: five keys, alphabetical, all strings. */
const canonRow = (r) => ({
  gain: String(r.gain ?? "0"),
  gainunit: r.gainunit || "dB",
  mixdown: String(r.mixdown ?? "0"),
  process: r.process || "",
  source: String(r.source ?? "0"),
});

/** The whole row set as the atomic `matrix_pipelines` string. */
export const canonPipelines = (rows) => JSON.stringify(rows.map(canonRow));

/**
 * The row contract the server enforces at apply time (conf/matrixconf.py
 * `_validate_row`), checked here so a bad row fails before anything is staged
 * rather than at the user's Apply click.
 */
export function lintRow(row, index) {
  const where = `row ${index}`;
  for (const key of ["source", "mixdown"]) {
    const n = Number(row[key]);
    if (!Number.isInteger(n)) throw new Error(`${where}: ${key} must be an integer, got ${JSON.stringify(row[key])}`);
    if (n < 0 || n >= MAX_CHANNELS) throw new Error(`${where}: ${key} ${n} out of range 0..${MAX_CHANNELS - 1}`);
  }
  if (!GAIN_RE.test(String(row.gain))) throw new Error(`${where}: bad gain ${JSON.stringify(row.gain)}`);
  if (!GAIN_UNITS.has(String(row.gainunit))) throw new Error(`${where}: bad gainunit ${JSON.stringify(row.gainunit)}`);
  if (hasControlChar(String(row.process))) throw new Error(`${where}: control characters in process`);
  return row;
}

// --- baseline ---------------------------------------------------------------

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { method: "GET" });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * The current row set, file truth first. `/api/config` carries the daemon's own
 * canonical JSON (credentials permitting); `/api/matrix` is the read-only-mode
 * fallback, parsed from the management form. Rows are never synthesised — a
 * staged `matrix_pipelines` replaces the whole set, so the baseline is the only
 * safe starting point.
 */
export async function readBaseline(base, fetchImpl) {
  try {
    const body = await getJson(fetchImpl, `${base}/api/config`);
    const raw = ((body.data || {}).file || {}).matrix_pipelines;
    if (typeof raw === "string" && raw) {
      return { rows: JSON.parse(raw).map(canonRow), baseline_source: "config" };
    }
  } catch {
    /* no credentials, or no matrix body — fall through to the form rows */
  }
  const body = await getJson(fetchImpl, `${base}/api/matrix`);
  const rows = (body.data || {}).rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${base}/api/matrix returned no matrix rows`);
  return {
    rows: [...rows].sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0)).map(canonRow),
    baseline_source: "matrix",
  };
}

// --- the EQ to stage --------------------------------------------------------

/**
 * The stages a job's `eq` spec resolves to. `{"process":"iir:..."}` is this
 * tool's own literal form; everything else is eqlab's chain resolver, so a
 * snapshot or a ParametricEQ file stages exactly what eqlab measured.
 */
export async function resolveEq(spec) {
  if (!spec) throw new Error('eq: give {"bands":[...]}, {"process":"..."}, or an eqlab chain source');
  if (typeof spec.process === "string") return parseProcess(spec.process);
  if (Array.isArray(spec.bands)) return spec.bands.map(bandToStage);
  const { stages } = await resolveChain(spec);
  return stages;
}

// --- row edit ---------------------------------------------------------------

/**
 * The row's process with the EQ applied. `replace_tail` drops only the trailing
 * run of parametric-EQ stages, so a crossfeed lead-in (`lp1`, `delay`, a
 * convolution) survives; `append` keeps everything and adds the bands after it.
 */
function processWith(process, stages, mode) {
  const existing = parseProcess(process || "");
  const kept = mode === "append" ? existing : existing.slice(0, existing.length - eqTail(existing).length);
  return serializeProcess([...kept, ...stages]);
}

/**
 * A staged row: process rewritten, and — when a preamp was asked for — the
 * channel gain set in dB. A row already carrying a `Lin` gain is part of a
 * decomposed matrix (Bauer crossfeed writes those), where a dB preamp would
 * silently destroy the decomposition, so it is refused unless forced.
 */
export function editRow(row, stages, { mode, preampDb, forceGainunit }) {
  const out = { ...canonRow(row), process: processWith(row.process, stages, mode) };
  if (preampDb === null || preampDb === undefined) return out;
  if (out.gainunit !== "dB" && !forceGainunit) {
    throw new Error(
      `row gainunit is "${out.gainunit}", not dB — a dB preamp would break a decomposed matrix; ` +
        'amend band gains instead, or pass "force_gainunit": true',
    );
  }
  return { ...out, gain: preampDb.toFixed(1), gainunit: "dB" };
}

/** Which baseline row indices a job's `rows` selector picks. */
export function selectRows(spec, count) {
  if (spec === undefined || spec === null || spec === "all") return [...Array(count).keys()];
  if (!Array.isArray(spec)) throw new Error('rows: give "all" or a list of row indices');
  for (const i of spec) {
    if (!Number.isInteger(i) || i < 0 || i >= count) {
      throw new Error(`rows: index ${i} outside baseline 0..${count - 1}`);
    }
  }
  return spec;
}
