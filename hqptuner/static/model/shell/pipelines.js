// DOM-free decisions of the DSP pipelines drawer: a pipeline's chain as chips, which pins of the routing grid are lit
// and what they carry, the overview's and an output tab's summaries, and whether a wire row does any work.

import { PEQ_TYPES } from "../gauges/eq.js";
import { minus, signed } from "./format.js";
import { paging } from "../builders/pager.js";

/**
 * Any stage of a pipeline: its kind, then its wire arguments by name (iir: type, f, g, q | bw | s or b0 … a2; delay:
 * t | s | d, v; riaa: subsonic; conv and peqfile: file). `blk` marks a stage a crossfeed block placed.
 *
 * @typedef {{
 *   kind: string,
 *   type?: string,
 *   file?: string,
 *   blk?: boolean,
 *   f?: number,
 *   g?: number,
 *   q?: number,
 *   bw?: number,
 *   s?: number,
 *   b0?: number,
 *   b1?: number,
 *   b2?: number,
 *   a0?: number,
 *   a1?: number,
 *   a2?: number,
 *   t?: number,
 *   d?: number,
 *   v?: number,
 *   subsonic?: number,
 *   [arg: string]: string | number | boolean | undefined,
 * }} Stage
 */

/**
 * One pipeline: source channel, mix channel, gain, chain. `gen` names the crossfeed block a row belongs to, `ear` the
 * side of the stereo pair whose EQ it carries.
 *
 * @typedef {object} Pipe
 * @property {number} src
 * @property {number} mix
 * @property {number} gain
 * @property {string} unit  'dB' | 'Lin'
 * @property {Stage[]} stages
 * @property {string} [gen]
 * @property {number} [ear]
 */

/** @typedef {[Pipe, number]} Placed  a pipeline with its position in the set */

/** @typedef {import("../../vendor/eqlab/core/matrixspec.js").PipelineRow} Row */

/**
 * One chip of a strip: its kind and the stages it stands for.
 *
 * @typedef {{ kind: string, idx: number[] }} Group
 */

/**
 * One line of an output's list: a pipeline, or a crossfeed block folded (`fold`) or headed (`head`).
 *
 * @typedef {object} Item
 * @property {Pipe} [p]
 * @property {number} [i]
 * @property {boolean} [inBlock]
 * @property {string} [fold]
 * @property {string} [head]
 * @property {number} [n]
 * @property {number} [first]
 */

/** Lines on one page of an output's list. */
export const PAGE = 6;
/** Pipelines the engine takes. */
export const MAXP = 128;
/** The gain a row leaves a signal at, by its unit. */
const UNITY = { dB: 0, Lin: 1 };

/**
 * A frequency as a chip prints it: Hz up to 1 kHz, k beyond.
 *
 * @param {number} f
 * @returns {string}
 */
const fmtHz = (f) => (f >= 1000 ? `${+(f / 1000).toFixed(2)}k` : `${+f}`);

/**
 * 0 … n-1.
 *
 * @param {number} n
 * @returns {number[]}
 */
export const range = (n) => Array.from({ length: n }, (_, k) => k);

/**
 * The pipelines from one input into one output, each with its position in the set.
 *
 * @param {Pipe[]} pipes
 * @param {number} src
 * @param {number} mix
 * @returns {Placed[]}
 */
export const crosspoint = (pipes, src, mix) =>
  pipes.map((p, i) => /** @type {Placed} */ ([p, i])).filter(([p]) => p.src === src && p.mix === mix);

/**
 * Whether a wire row does no work: it copies a channel to that same channel at unity gain with an empty process chain.
 *
 * @param {Row} r
 * @returns {boolean}
 */
export const passesThrough = (r) =>
  Number(r.source) === Number(r.mixdown) &&
  Object.hasOwn(UNITY, r.gainunit) &&
  Number(r.gain) === UNITY[/** @type {keyof typeof UNITY} */ (r.gainunit)] &&
  !r.process;

/**
 * The inputs feeding one output, once each, in channel order.
 *
 * @param {Pipe[]} pipes
 * @param {number} o
 * @returns {number[]}
 */
export const inputsOf = (pipes, o) =>
  [...new Set(pipes.filter((p) => p.mix === o).map((p) => p.src))].sort((a, b) => a - b);

/**
 * One input's list: its pipelines, a folded block standing in for its rows, an unfolded one led by a header line.
 *
 * @param {Placed[]} here
 * @param {Set<string>} open  block kinds unfolded
 * @returns {Item[]}
 */
export function listItems(here, open) {
  /** @type {Item[]} */
  const out = [];
  const seen = new Set();
  for (const [p, i] of here) {
    const gen = p.gen;
    if (gen && !seen.has(gen)) {
      seen.add(gen);
      const n = here.filter(([q]) => q.gen === gen).length;
      out.push(open.has(gen) ? { head: gen, n, first: i } : { fold: gen, n, first: i });
    }
    if (!gen || open.has(gen)) out.push({ p, i, inBlock: !!gen });
  }
  return out;
}

/**
 * A chain as chips: a run of two or more peak / shelf iir stages is one PEQ chip (a block's own stages never join);
 * the gain last.
 *
 * @param {Pipe} p
 * @returns {Group[]}
 */
export function groups(p) {
  /** @type {Group[]} */
  const g = [];
  p.stages.forEach((st, i) => {
    const peq = st.kind === "iir" && PEQ_TYPES.has(/** @type {string} */ (st.type)) && !st.blk;
    const last = g[g.length - 1];
    if (peq && last?.kind === "peqrun") last.idx.push(i);
    else g.push({ kind: peq ? "peqrun" : st.kind, idx: [i] });
  });
  for (const x of g) if (x.kind === "peqrun") x.kind = x.idx.length > 1 ? "peq" : "iir";
  g.push({ kind: "gain", idx: [] });
  return g;
}

/**
 * A pipeline's gain as its chip prints it.
 *
 * @param {Pipe} p
 * @returns {string}
 */
const gainText = (p) => (p.unit === "Lin" ? `Lin ${minus(+(+p.gain).toFixed(3))}` : `${signed(+p.gain, 1)} dB`);

/**
 * A delay stage as its chip prints it, in the unit it is given in.
 *
 * @param {Stage} st
 * @returns {string}
 */
const delayText = (st) =>
  st.t !== undefined
    ? `delay ${+(st.t * 1000).toFixed(2)} ms`
    : st.s !== undefined
      ? `delay ${st.s} samples`
      : `delay ${st.d} m`;

/**
 * A chip's text.
 *
 * @param {Pipe} p
 * @param {Group} gr
 * @returns {string}
 */
export function chipText(p, gr) {
  const st = p.stages[gr.idx[0]];
  switch (gr.kind) {
    case "peq":
      return `Parametric Equalizer · ${gr.idx.length} bands`;
    case "iir":
      return st.type === "biquad" ? "biquad" : `${st.type} ${fmtHz(/** @type {number} */ (st.f))} Hz`;
    case "delay":
      return delayText(st);
    case "riaa":
      return "riaa";
    case "gain":
      return gainText(p);
  }
  return st.file ? /** @type {string} */ (st.file.split("/").pop()) : gr.kind;
}

/**
 * A pipeline's chain as one line of its output's list.
 *
 * @param {Pipe} p
 * @returns {string}
 */
export const rowText = (p) =>
  groups(p)
    .slice(0, -1)
    .map((gr) => chipText(p, gr))
    .join(" · ") || "—";

/** A fresh stage of each kind (`+` and the dock's Stage picker). */
export const NEW_STAGE = {
  iir: () => ({ kind: "iir", type: "peak", f: 1000, q: 1, g: 0 }),
  delay: () => ({ kind: "delay", t: 0.001 }),
  riaa: () => ({ kind: "riaa", subsonic: 1 }),
  conv: () => ({ kind: "conv", file: "impulse.wav" }),
};

/**
 * The chip a stage sits in and its band within it; chip -1 when no chip holds it.
 *
 * @param {Group[]} gs
 * @param {number} si
 * @returns {{ chip: number, band: number }}
 */
export function stageAt(gs, si) {
  const chip = gs.findIndex((g) => g.idx.includes(si));
  return { chip, band: chip < 0 ? 0 : gs[chip].idx.indexOf(si) };
}

/**
 * One pin of the routing grid: lit or not, how many pipelines it holds, the crossfeed block among them, whether one
 * inverts polarity, its engraved gain, and the share of all pipelines its foot fills (%; 0 when it holds one or none).
 *
 * @param {Pipe[]} pipes
 * @param {number} src
 * @param {number} mix
 * @returns {{ on: boolean, n: number, gen: string | undefined, neg: boolean, label: string, fill: number }}
 */
export function pinState(pipes, src, mix) {
  const here = crosspoint(pipes, src, mix);
  const n = here.length,
    on = n > 0,
    first = here[0]?.[0];
  const gen = here.find(([p]) => p.gen)?.[0]?.gen;
  const neg = here.some(([p]) => p.unit === "Lin" && p.gain < 0);
  const label = !on
    ? ""
    : n > 1
      ? `×${n}`
      : first.unit === "Lin"
        ? minus(+(+first.gain).toFixed(3))
        : `${signed(+first.gain, 1)} dB`;
  const fill = n > 1 ? Math.max(6, Math.round((100 * n) / pipes.length)) : 0;
  return { on, n, gen, neg, label, fill };
}

/**
 * The overview's grid cell (px) for its channel counts, and whether the set is past the engine's ceiling.
 *
 * @param {number} nIn
 * @param {number} nOut
 * @param {number} nPipes
 * @returns {{ cell: number, over: boolean }}
 */
export const overviewSummary = (nIn, nOut, nPipes) => ({
  cell: Math.max(44, Math.min(112, Math.floor(440 / Math.max(nIn, nOut)))),
  over: nPipes > MAXP,
});

/**
 * An output tab as it paints: the inputs feeding it (with their counts) and the ones that could, the input shown (the
 * kept one while it still feeds, else the first), its pipelines and list, the selected pipeline (`reselect` when the kept
 * one is not on that input) and the page.
 *
 * @param {Pipe[]} pipes
 * @param {number} nIn
 * @param {number} o
 * @param {{ src: number | null, selPipe: number, page: number, open: Set<string> }} sel
 */
export function outputView(pipes, nIn, o, sel) {
  const ins = inputsOf(pipes, o);
  const src = sel.src === null || !ins.includes(sel.src) ? (ins[0] ?? null) : sel.src;
  const here = src === null ? [] : crosspoint(pipes, src, o);
  const reselect = !here.some(([, i]) => i === sel.selPipe);
  const items = listItems(here, sel.open);
  return {
    ins,
    counts: ins.map((i) => crosspoint(pipes, i, o).length),
    others: range(nIn).filter((i) => !ins.includes(i)),
    src,
    here,
    reselect,
    selPipe: reselect ? (here[0]?.[1] ?? -1) : sel.selPipe,
    items,
    paging: paging(items.length, PAGE, sel.page),
  };
}

/**
 * The page a pipeline's line sits on; the first when it is not listed.
 *
 * @param {Item[]} items
 * @param {number} i
 * @returns {number}
 */
export function pageOf(items, i) {
  const idx = items.findIndex((x) => x.p && x.i === i);
  return idx < 0 ? 0 : Math.floor(idx / PAGE);
}
