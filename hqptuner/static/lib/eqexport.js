// Export a pipeline row's parametric EQ as REW / Equalizer APO text — the
// write-side twin of eqimport.js. Only iir stages that map to a REW filter token
// are emitted; raw biquads, non-EQ stages (delay/riaa/conv) and first-order
// slopes have no Fc/Gain/Q form and are collected in `skipped` and reported,
// never silently dropped (mirrors the importer's contract). A dB channel gain
// becomes the Preamp line; a Lin/inverted gain has no Preamp equivalent and is
// reported instead. See docs/eq-export.md.
import { parseProcess } from "./matrixspec.js";

/**
 * @typedef {import("./matrixspec.js").MatrixStage} MatrixStage
 * @typedef {import("./matrixspec.js").PipelineRow} PipelineRow
 */

// iir type -> REW token. Inverse of eqimport.js TYPE_MAP.
/** @type {Record<string, string>} */
const TOKEN = { peak: "PK", lshelf: "LSC", hshelf: "HSC", lp: "LP", hp: "HP", notch: "NO", ap: "AP", bp: "BP" };
const GAINED = new Set(["peak", "lshelf", "hshelf"]);

// Why a stage cannot become a REW filter line, or null if it can.
/**
 * @param {MatrixStage} stage
 * @param {number} ord the stage's 1-based position
 * @param {string} type the iir type argument
 * @returns {string | null}
 */
function stageSkip(stage, ord, type) {
  if (stage.kind !== "iir") return `stage ${ord} (${stage.kind}) — not a parametric filter`;
  if (type === "biquad") return `stage ${ord} (raw biquad) — no Fc/Gain/Q form`;
  if (type === "lp1" || type === "hp1") return `stage ${ord} (${type}) — first-order slope has no REW token`;
  if (!TOKEN[type]) return `stage ${ord} (${type || "unknown"}) — unsupported type`;
  if ((stage.args || {}).f === undefined) return `stage ${ord} (${type}) — no Fc`;
  return null;
}

// The filter body ("PK Fc 105 Hz Gain -3.2 dB Q 1.41"), or a skip reason. Arg
// values are the stage's verbatim decimal strings, so precision is preserved.
/**
 * @param {MatrixStage} stage
 * @param {number} ord
 * @returns {{ skip?: string, body?: string }}
 */
function stageBody(stage, ord) {
  const a = stage.args || {};
  const type = a.type;
  const skip = stageSkip(stage, ord, type);
  if (skip) return { skip };
  // LP/HP with an explicit Q use the Q-carrying token so the value round-trips.
  const tok = (type === "lp" || type === "hp") && a.q !== undefined ? `${TOKEN[type]}Q` : TOKEN[type];
  let body = `${tok} Fc ${a.f} Hz`;
  if (GAINED.has(type) && a.g !== undefined) body += ` Gain ${a.g} dB`;
  if (a.q !== undefined) body += ` Q ${a.q}`;
  return { body };
}

// A dB channel gain is the preamp; Lin/inverted has no REW Preamp equivalent.
/**
 * @param {Partial<PipelineRow>} row `{}` stands in for a missing row
 * @returns {{ skip?: string, line?: string }}
 */
function preampLine(row) {
  if (row.gainunit !== "dB") return { skip: `channel gain is ${row.gainunit || "unset"} — no Preamp equivalent` };
  const g = row.gain === undefined || row.gain === "" ? "0" : row.gain;
  return { line: `Preamp: ${g} dB` };
}

// rowToRewText(row) -> { text, count, skipped } where `count` is the number of
// filters emitted (0 => nothing to export) and `skipped` lists every stage or
// gain that could not be represented, with its reason.
/**
 * @param {PipelineRow} row
 * @returns {{ text: string, count: number, skipped: string[] }}
 */
export function rowToRewText(row) {
  const stages = parseProcess((row && row.process) || "");
  /** @type {string[]} */
  const bodies = [];
  /** @type {string[]} */
  const skipped = [];
  stages.forEach((s, i) => {
    const r = stageBody(s, i + 1);
    if (r.skip) skipped.push(r.skip);
    else bodies.push(r.body);
  });
  const pre = preampLine(row || {});
  if (pre.skip) skipped.push(pre.skip);
  const filters = bodies.map((b, i) => `Filter ${i + 1}: ON ${b}`);
  const lines = [pre.line, ...filters].filter(Boolean);
  return { text: lines.length ? `${lines.join("\n")}\n` : "", count: bodies.length, skipped };
}

// Master export: the whole pipeline set as one REW / Equalizer APO file.
// Identical EQ across channels (the stereo headphone case) collapses to a single
// clean, directly-importable filter block; channels carrying DIFFERENT EQ are
// each written under a "# Pipeline N (In i -> Out j)" comment header (which REW
// and our own importer both skip as a non-filter line) so nothing is dropped or
// silently merged. Rows with no exportable EQ contribute nothing. Returns
// { text, count, skipped } where `count` is the number of pipelines exported.
/**
 * @param {PipelineRow[]} rows
 * @returns {{ text: string, count: number, skipped: string[] }}
 */
export function pipelinesToRewText(rows) {
  /** @type {{ i: number, row: PipelineRow, text: string }[]} */
  const parts = [];
  /** @type {string[]} */
  const skipped = [];
  (rows || []).forEach((row, i) => {
    const r = rowToRewText(row);
    r.skipped.forEach((s) => skipped.push(`pipeline ${i + 1}: ${s}`));
    if (r.count) parts.push({ i, row, text: r.text });
  });
  if (!parts.length) return { text: "", count: 0, skipped };
  if (new Set(parts.map((p) => p.text)).size === 1) return { text: parts[0].text, count: parts.length, skipped };
  const secs = parts.map(
    (p) => `# Pipeline ${p.i + 1} (In ${Number(p.row.source) + 1} -> Out ${Number(p.row.mixdown) + 1})\n${p.text}`,
  );
  return { text: `${secs.join("\n")}\n`, count: parts.length, skipped };
}
