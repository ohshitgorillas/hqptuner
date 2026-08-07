// AutoEq / REW ParametricEQ text import (matrix-spec.md "AutoEq / REW import"). Both dialects
// share one line grammar — AutoEq: "Filter 1: ON PK Fc 105 Hz Gain -3.2 dB Q 1.41"
// preceded by "Preamp: -6.4 dB"; REW's Generic EQ export writes the same fields
// with looser spacing under a header block. Anything that isn't a filter line
// is ignored; OFF filters and unsupported types are collected in `skipped` and
// reported — never silently dropped.

import { editedStage, serializeProcess, withoutEq } from "./matrixspec.js";
import { applyEqToBlock, fitComp } from "./xfeed.js";
import { compileRows } from "./binaural/compile.js";

// REW/AutoEq type tokens -> iir plugin types (manual §7.3)
/**
 * @typedef {import("./matrixspec.js").MatrixStage} MatrixStage
 * @typedef {import("./matrixspec.js").StageArgs} StageArgs
 * @typedef {import("./matrixspec.js").PipelineRow} PipelineRow
 * @typedef {import("./xfeed.js").MsRecognition} MsRecognition
 * @typedef {import("./binaural/recognize.js").StructuralRecognition} StructuralRecognition
 * @typedef {{ text: string, replace?: boolean, mirror?: boolean, block?: MsRecognition | null,
 *   bauer?: { fc: number, feed: number }, structural?: StructuralRecognition | null }} ImportOpts
 *   The tab's private signals, as planEqImport reads them (see the block above).
 * @typedef {{ preamp: string | null, stages: MatrixStage[], skipped: string[], addition: string }} Cut
 *   The parse result plus the serialized chain the filters became.
 * @typedef {{ rows: PipelineRow[] | null, targets: number[], note: string }} ImportPlan
 *   Where the filters land: the new row set (null = nothing to do), the rows the
 *   EQ went onto (empty on a block path, which owns its whole block), and the note.
 */

/** @type {Record<string, string>} */
const TYPE_MAP = {
  PK: "peak",
  PEQ: "peak",
  LS: "lshelf",
  LSC: "lshelf",
  HS: "hshelf",
  HSC: "hshelf",
  LP: "lp",
  HP: "hp",
  NO: "notch",
  AP: "ap",
};
const GAINLESS = new Set(["lp", "hp", "notch", "ap"]);

const PREAMP_RE = /^Preamp\s*:\s*(-?\d+(?:\.\d+)?)\s*dB/i;
// `(\S.*|)` rather than `(.*)`: `.` matches a space, so `\s*(.*)` leaves the
// engine free to split the gap after the type either way, and that ambiguity is
// what makes the match super-linear. The empty alternative keeps group 3
// defined for a filter that carries no arguments.
const FILTER_RE = /^Filter\s*\d+\s*:\s*(ON|OFF)\s+([a-z]+)\b\s*(\S.*|)$/i;

/**
 * @param {string} line the trimmed source line, quoted back in any skip reason
 * @param {RegExpMatchArray} m the FILTER_RE match
 * @returns {{ skip?: string, stage?: MatrixStage }}
 */
function parseFilterLine(line, m) {
  if (m[1].toUpperCase() === "OFF") return { skip: `${line} — filter is OFF` };
  const type = TYPE_MAP[m[2].toUpperCase()];
  if (!type) return { skip: `${line} — unsupported type "${m[2]}"` };
  const rest = m[3].replace(/,/g, "");
  const f = rest.match(/Fc\s+(-?[\d.]+)\s*Hz/i);
  if (!f) return { skip: `${line} — no Fc` };
  const g = rest.match(/Gain\s+(-?[\d.]+)\s*dB/i);
  const q = rest.match(/Q\s+([\d.]+)/i);
  /** @type {StageArgs} */
  const args = { type, f: f[1] };
  if (q) args.q = q[1];
  if (g && !GAINLESS.has(type)) args.g = g[1];
  return { stage: editedStage({ kind: "iir", args: {}, raw: undefined }, args) };
}

// parseEqText(text) -> { preamp: "-6.1" | null, stages: [iir stages], skipped: [reasons] }
/**
 * @param {string} text the raw AutoEq / REW text
 * @returns {{ preamp: string | null, stages: MatrixStage[], skipped: string[] }}
 */
export function parseEqText(text) {
  /** @type {MatrixStage[]} */
  const stages = [];
  /** @type {string[]} */
  const skipped = [];
  let preamp = null;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const pm = line.match(PREAMP_RE);
    if (pm) {
      preamp = pm[1];
      continue;
    }
    const fm = line.match(FILTER_RE);
    if (!fm) continue; // header / notes line — not a filter
    const parsed = parseFilterLine(line, fm);
    if (parsed.skip) skipped.push(parsed.skip);
    else stages.push(parsed.stage);
  }
  return { preamp, stages, skipped };
}

// --- import plan (matrix-spec.md "AutoEq / REW import", decision half) --------
//
// Where the parsed filters land, given the current pipeline set. Pure: the tab's
// `doImport` reads its private signals, calls this, and stages the result.
//
// opts:
//   text     — the raw AutoEq / REW text
//   replace  — drop the target's existing EQ first (a library profile load)
//   mirror   — also write the target's stereo pair (the adjacent pipeline)
//   block    — msRecognize() of rows 1–8, or null when no compensation block
//   bauer    — {fc, feed} the block is compensated for (only read when block)
//   structural — recognizeRows() of rows 1–16, or null when no structural block
//
// Returns {rows, targets, note}: the new pipeline set (null = nothing to do),
// the row indexes the EQ landed on (for auto-plotting; empty on the block path,
// which owns eight rows), and the user-facing note.

// The note suffixes both paths share. `cut` below is the parse result plus the
// serialized chain the filters became — everything both planners need.
const skipNote = (/** @type {string[]} */ skipped) => (skipped.length ? ` · skipped: ${skipped.join("; ")}` : "");
const preampNote = (/** @type {string | null} */ preamp, /** @type {string} */ tail) =>
  preamp !== null ? `, preamp ${preamp} dB${tail}` : "";

// A recognized compensation block owns rows 0..7 as ONE unit: shared EQ, Lin
// gains with the preamp folded in. Appending to one of its rows would break
// recognition AND leave that row carrying the EQ twice at a dB gain — an audible
// one-channel imbalance with no error shown. Route into the block instead.
/**
 * @param {PipelineRow[]} rows
 * @param {ImportOpts} opts
 * @param {Cut} cut
 * @returns {ImportPlan}
 */
function blockPlan(rows, opts, cut) {
  const fit = fitComp(opts.bauer.fc, opts.bauer.feed);
  return {
    rows: applyEqToBlock(rows, opts.block, fit, { addition: cut.addition, preamp: cut.preamp, replace: opts.replace }),
    targets: [],
    note:
      `${cut.stages.length} filter(s) → crossfeed compensation block (pipelines 1–8)` +
      preampNote(cut.preamp, "") +
      (opts.block.stale ? " · block was out of date and has been rebuilt at 100%" : "") +
      skipNote(cut.skipped),
  };
}

// The target's stereo pair — the adjacent pipeline — or null when mirroring is
// off, there is no second pipeline, or the partner is past the last row.
/**
 * @param {PipelineRow[]} rows
 * @param {number} target
 * @param {boolean} mirror
 * @returns {number | null}
 */
function mirrorPair(rows, target, mirror) {
  if (!mirror || rows.length < 2) return null;
  const pair = target % 2 === 0 ? target + 1 : target - 1;
  return pair < rows.length ? pair : null;
}

// One target row with the EQ landed on it: appended (or replacing the row's
// previous EQ, keeping its non-EQ stages), with any Preamp line as the row gain.
/**
 * @param {PipelineRow} row
 * @param {ImportOpts} opts
 * @param {Cut} cut
 * @returns {PipelineRow}
 */
function eqRow(row, opts, cut) {
  const base = opts.replace ? withoutEq(row.process) : row.process;
  const process = base ? `${base},${cut.addition}` : cut.addition;
  return { ...row, process, ...(cut.preamp !== null ? { gain: cut.preamp, gainunit: "dB" } : {}) };
}

/**
 * @param {PipelineRow[]} rows
 * @param {number} target
 * @param {ImportOpts} opts
 * @param {Cut} cut
 * @returns {ImportPlan}
 */
function rowPlan(rows, target, opts, cut) {
  const pair = mirrorPair(rows, target, opts.mirror);
  const targets = new Set(pair === null ? [target] : [target, pair]);
  return {
    rows: rows.map((r, i) => (targets.has(i) ? eqRow(r, opts, cut) : r)),
    targets: [...targets],
    note:
      `${cut.stages.length} filter(s) → pipeline ${[...targets].map((i) => i + 1).join(" + ")}` +
      preampNote(cut.preamp, " → gain") +
      skipNote(cut.skipped),
  };
}

// A recognized structural block owns rows 0..15 as ONE unit, the same way the
// compensation block owns rows 0..7: sixteen Lin-gain rows carrying one EQ chain
// per ear with that ear's preamp folded into every gain, and the head model's own
// lowpass and delay stages interleaved with it. Writing a profile onto one of its
// rows dies on the first gainunit check — the block stops being recognized, the
// card falls back to Bauer, and the EQ the user just loaded sits on two rows out
// of sixteen while the other fourteen carry the old one. Recompile it instead.
//
// The block's own stages are not part of `eqProcess` and are re-derived by
// compileRows, so only the ear chains and the preamp change here. Channels come
// from the installed rows rather than assumed: recognition accepts any distinct
// pair, and a block built on In 3 / In 4 must come back on In 3 / In 4.
/**
 * @param {PipelineRow[]} rows
 * @param {ImportOpts} opts
 * @param {Cut} cut
 * @returns {ImportPlan}
 */
function structuralPlan(rows, opts, cut) {
  const rec = opts.structural;
  const ear = (/** @type {"left" | "right"} */ side) => {
    const base = opts.replace ? "" : rec.eqProcess[side];
    return base ? `${base},${cut.addition}` : cut.addition;
  };
  const next = compileRows({
    lambda: rec.lambda,
    angle: rec.angle,
    headRadius: rec.headRadius,
    srcA: rows[0].source,
    srcB: rows[8].source,
    preampDb: cut.preamp !== null ? Number(cut.preamp) : rec.preampDb,
    eqProcess: { left: ear("left"), right: ear("right") },
  });
  return {
    rows: [...next, ...rows.slice(16)],
    targets: [],
    note:
      `${cut.stages.length} filter(s) → structural crossfeed block (pipelines 1–16)` +
      preampNote(cut.preamp, "") +
      skipNote(cut.skipped),
  };
}

/**
 * @param {PipelineRow[]} rows the current pipeline set
 * @param {number} targetIndex the row the import is aimed at
 * @param {ImportOpts} opts
 * @returns {ImportPlan}
 */
export function planEqImport(rows, targetIndex, opts) {
  const { preamp, stages, skipped } = parseEqText(opts.text);
  if (!stages.length) {
    return {
      rows: null,
      targets: [],
      note: `no filters found${skipped.length ? ` — ${skipped.length} line(s) skipped` : ""}`,
    };
  }
  const target = Math.min(targetIndex, rows.length - 1);
  const cut = { preamp, stages, skipped, addition: serializeProcess(stages) };
  if (opts.structural && target < 16) return structuralPlan(rows, opts, cut);
  return opts.block && target < 8 ? blockPlan(rows, opts, cut) : rowPlan(rows, target, opts, cut);
}
