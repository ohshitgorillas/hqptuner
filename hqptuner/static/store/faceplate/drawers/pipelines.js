// The DSP pipelines drawer's store half: the pipeline set as the drawer reads it, and the edits it stages. The set is
// the effective one (store/resolve.js `effectivePipelines`), read as the model's pipelines (model/shell/pipelines.js)
// with a crossfeed block's rows marked and every stage of theirs locked; every edit stages the whole set through
// `stagePipelines` (store/actions.js). The components are components/faceplate/drawers/pipelines/.
//
// A row an edit did not touch goes back byte for byte, and so does every stage of an edited row that the edit left as
// it was: the wire text is re-used wherever the stage it reads as is unchanged, so a figure written `1000.0` on the
// daemon is not rewritten `1000` behind the user's back.

import { overviewSummary, pinState, range } from "../../../model/shell/pipelines.js";
import { editedStage, parseProcess, validateStage } from "../../../vendor/eqlab/core/matrixspec.js";
import { planEqImport } from "../../../vendor/eqlab/core/eqimport.js";
import { effective, effectivePipelines } from "../../resolve.js";
import { stagePipelines } from "../../actions.js";
import { matrixBypassed } from "../../schema/gray.js";
import { xfeedBlock } from "../../xfeed/block.js";
import { structuralBlock } from "../../xfeed/mode.js";

/** @typedef {import("../../../model/shell/pipelines.js").Pipe} Pipe */
/** @typedef {import("../../../model/shell/pipelines.js").Stage} Stage */
/** @typedef {import("../../../vendor/eqlab/core/matrixspec.js").MatrixStage} WireStage */
/** @typedef {import("../../../vendor/eqlab/core/matrixspec.js").PipelineRow} Row */
/** @typedef {ReturnType<typeof pinState>} Pin */
/** @typedef {Record<number, Pipe | null | undefined>} Ear  the stereo pair by side: whose EQ a block row carries */

/**
 * The crossfeed block at the head of the set: its kind, how many rows it holds, and its folded line's summary.
 *
 * @typedef {{ kind: string, rows: number, sum: string }} Block
 */

/** @typedef {{ id: string, out: number, label: string }} OutTab  an output tab: its id, its output, its name */

// Channel names while the daemon names them (slots 1–8, readme §1.9; LFE shown as Sub), numbers beyond.
const CH_SHORT = ["L", "R", "C", "Sub", "Lr", "Rr", "Ls", "Rs"];
const CH_NAME = ["Left", "Right", "Center", "Sub", "Left rear", "Right rear", "Left side", "Right side"];
/** Channels the grid draws a side out to when the engine reports more and the set names fewer. */
const GRID_MAX = 8;
/** Room the drawer head has for tab names, and what one name costs: px a character, px a tab's padding. */
const HEAD_ROOM = 470;
const CHAR_PX = 7;
const TAB_PX = 22;

/**
 * A channel's short name: the daemon's slot name, its number beyond the eighth.
 *
 * @param {number} i  wire channel, 0-based
 * @returns {string}
 */
export const chShort = (i) => CH_SHORT[i] ?? String(i + 1);

/**
 * A channel's full name: the daemon's slot name, `Channel n` beyond the eighth.
 *
 * @param {number} i  wire channel, 0-based
 * @returns {string}
 */
export const chName = (i) => CH_NAME[i] ?? `Channel ${i + 1}`;

/**
 * One wire stage as the model's stage: a plugin's arguments as numbers (an iir's type as written), a file by its kind.
 *
 * @param {WireStage} ws
 * @returns {Stage}
 */
function toStage(ws) {
  if (ws.kind === "conv") return { kind: /\.txt$/i.test(ws.file ?? "") ? "peqfile" : "conv", file: ws.file ?? "" };
  /** @type {Stage} */
  const st = { kind: ws.kind };
  for (const [k, v] of Object.entries(ws.args ?? {})) st[k] = k === "type" ? v : v === "" ? undefined : Number(v);
  return st;
}

/**
 * A model stage's wire text, its arguments in the manual's order; the `blk` mark is not wire.
 *
 * @param {Stage} st
 * @returns {string}
 */
function wireText(st) {
  if (st.kind === "conv" || st.kind === "peqfile") return String(st.file ?? "");
  /** @type {Record<string, string>} */
  const args = {};
  for (const [k, v] of Object.entries(st)) if (k !== "kind" && k !== "blk" && v !== undefined) args[k] = String(v);
  return editedStage({ kind: st.kind, args: {} }, args).raw ?? "";
}

/**
 * A chain's process string, each stage's wire text re-used from `before` while the stage it reads as is unchanged.
 *
 * @param {Stage[]} stages
 * @param {string} before  the row's process string ahead of the edit
 * @returns {string}
 */
function processOf(stages, before) {
  const old = parseProcess(before).map((ws) => ({ raw: ws.raw ?? "", text: wireText(toStage(ws)) }));
  const used = new Set();
  return stages
    .map((st) => {
      const text = wireText(st);
      const k = old.findIndex((o, j) => !used.has(j) && o.text === text);
      if (k < 0) return text;
      used.add(k);
      return old[k].raw;
    })
    .join(",");
}

/**
 * A row as the model's pipeline.
 *
 * @param {Row} r
 * @returns {Pipe}
 */
const toPipe = (r) => ({
  src: Number(r.source),
  mix: Number(r.mixdown),
  gain: Number(r.gain),
  unit: r.gainunit || "dB",
  stages: parseProcess(r.process).map(toStage),
});

/**
 * An EQ a block carries, as a pipeline the plot and Import EQ can read.
 *
 * @param {string} process
 * @param {number} gain  dB
 * @param {number} side
 * @returns {Pipe}
 */
const eqPipe = (process, gain, side) => ({
  ...toPipe({ source: "0", mixdown: "0", gain: "0", gainunit: "dB", process }),
  src: side,
  mix: side,
  gain,
});

/**
 * The crossfeed block at the head of `rows` and the EQ it carries per side, or none.
 *
 * @param {Row[]} rows
 * @returns {{ block: Block, ear: Ear }}
 */
function blockOf(rows) {
  const s = structuralBlock(rows);
  if (s) {
    const circ = 2 * Math.PI * s.headRadius * 100;
    const sum = `${s.angle.toFixed(1)}° · ${circ.toFixed(2)} cm · ${Math.round(s.lambda * 100)}%`;
    const ear = { 0: eqPipe(s.eqProcess.left, s.preampDb.left, 0), 1: eqPipe(s.eqProcess.right, s.preampDb.right, 1) };
    return { block: { kind: "structural", rows: 16, sum }, ear };
  }
  const { rec } = xfeedBlock(rows);
  if (rec) {
    const ear = { 0: eqPipe(rec.eqProcess, rec.preampDb, 0), 1: eqPipe(rec.eqProcess, rec.preampDb, 1) };
    return { block: { kind: "comp", rows: 8, sum: `${Math.round(rec.sFraction * 100)}%` }, ear };
  }
  return { block: { kind: "none", rows: 0, sum: "" }, ear: {} };
}

/**
 * The output tabs for the outputs a set feeds: names spelled out while they all fit the drawer head, short beyond.
 *
 * @param {number[]} outs
 * @returns {OutTab[]}
 */
function outputTabs(outs) {
  const cost = (/** @type {string} */ s) => s.length * CHAR_PX + TAB_PX;
  const full = cost("Overview") + outs.reduce((a, o) => a + cost(`${chName(o)} Out`), 0) <= HEAD_ROOM;
  return outs.map((o) => ({ id: `out${o}`, out: o, label: full ? `${chName(o)} Out` : chShort(o) }));
}

/**
 * The pipeline set as the drawer reads it: its pipelines (a crossfeed block's rows first, marked and locked), the
 * stereo pair, the block, the grid's channel counts, cell size and pins, whether the set is past the engine's ceiling,
 * the output tabs, and the matrix bypass's gray reason ('' while the engine runs).
 */
export function pipelinesView() {
  /** @type {Row[]} */
  const rows = effectivePipelines.value;
  const { block, ear } = blockOf(rows);
  /** @type {Pipe[]} */
  const pipes = rows.map((r, i) => {
    const p = toPipe(r);
    if (i >= block.rows) return p;
    return { ...p, gen: block.kind, ear: p.mix & 1, stages: p.stages.map((st) => ({ ...st, blk: true })) };
  });
  if (block.kind === "none") {
    ear[0] = pipes.find((p) => p.src === 0 && p.mix === 0);
    ear[1] = pipes.find((p) => p.src === 1 && p.mix === 1);
  }
  const channels = Math.min(GRID_MAX, Number(effective("channels")) || 0);
  const nIn = Math.max(2, ...pipes.map((p) => p.src + 1));
  const nOut = Math.max(2, channels, ...pipes.map((p) => p.mix + 1));
  const { cell, over } = overviewSummary(nIn, nOut, pipes.length);
  const outs = [...new Set(pipes.map((p) => p.mix))].sort((a, b) => a - b);
  return {
    pipes,
    ear,
    block,
    nIn,
    nOut,
    cell,
    over,
    grid: range(nIn).map((src) => range(nOut).map((mix) => pinState(pipes, src, mix))),
    outputs: outputTabs(outs),
    gray: matrixBypassed({ mode: "", effective }),
  };
}

/** The effective set's rows. @returns {Row[]} */
const rowsNow = () => effectivePipelines.value;

/**
 * Stage a new pipeline from input `src` into output `mix` (0 dB, empty chain), and answer its place in the set.
 *
 * @param {number} src
 * @param {number} mix
 * @returns {number}
 */
export function addPipeline(src, mix) {
  const rows = rowsNow();
  stagePipelines([...rows, { source: String(src), mixdown: String(mix), gain: "0", gainunit: "dB", process: "" }]);
  return rows.length;
}

/**
 * Stage the set without pipeline `i`.
 *
 * @param {number} i
 */
export const removePipeline = (i) => stagePipelines(rowsNow().filter((_, j) => j !== i));

/**
 * Stage the set with pipeline `i`'s row patched.
 *
 * @param {number} i
 * @param {Partial<Row>} patch
 */
const patchRow = (i, patch) => stagePipelines(rowsNow().map((r, j) => (j === i ? { ...r, ...patch } : r)));

/**
 * Stage pipeline `i`'s gain in `unit` (dB or Lin).
 *
 * @param {number} i
 * @param {number} gain
 * @param {string} unit
 */
export const setGain = (i, gain, unit) => patchRow(i, { gain: String(gain), gainunit: unit });

/**
 * Stage pipeline `i`'s chain.
 *
 * @param {number} i
 * @param {Stage[]} stages
 */
export const setStages = (i, stages) => patchRow(i, { process: processOf(stages, rowsNow()[i]?.process ?? "") });

/**
 * Stage pipeline `i`'s process string as written, unless a stage of it does not parse: then nothing stages and the
 * first reason why is answered ('' when it staged).
 *
 * @param {number} i
 * @param {string} text
 * @returns {string}
 */
export function setRaw(i, text) {
  const issue = parseProcess(text).flatMap(validateStage)[0] ?? "";
  if (!issue) patchRow(i, { process: text });
  return issue;
}

/**
 * Land an AutoEq / REW EQ on the stereo pair (into a crossfeed block when one holds it), replacing its EQ, its preamp
 * the pair's gain; `mirror` false lands it on the first side only. Answers what landed, in words.
 *
 * @param {string} text  the ParametricEQ.txt
 * @param {boolean} mirror
 * @returns {Promise<string>}
 */
export async function importEq(text, mirror) {
  const rows = rowsNow();
  if (!rows.length) return "";
  const v = pipelinesView();
  const first = v.block.kind === "none" ? v.pipes.indexOf(/** @type {Pipe} */ (v.ear[0] ?? v.ear[1])) : 0;
  const { bs, rec } = xfeedBlock(rows);
  const plan = planEqImport(rows, Math.max(0, first), {
    text,
    replace: true,
    mirror,
    block: rec,
    bauer: bs,
    structural: structuralBlock(rows),
  });
  if (plan.rows) await stagePipelines(plan.rows);
  return plan.note;
}
