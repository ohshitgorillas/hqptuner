// DOM-free decisions of the DSP pipelines drawer (components/pipelines.js): a pipeline's chain as chips, which pins of
// the routing grid are lit and what they carry, the overview's and an output tab's summaries, the stage dock's field
// values and whether they resolve against their tables, and the inputs the response plot draws.

import { PEQ_TYPES } from "./eq.js";
import { minus, signed } from "./format.js";
import { paging } from "./pager.js";

/**
 * Any stage of a pipeline: its kind, then its wire arguments by name.
 *
 * @typedef {{ kind: string, [arg: string]: any }} Stage
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

/** @typedef {{ t: string, d: string, args: string[], alt: string[] }} IirType  one row of the iir table */
/** @typedef {{ a: string, d: string, unit: string }} DelayArg  one row of the delay table */

/** Lines on one page of an output's list. */
export const PAGE = 6;
/** Pipelines the engine takes. */
export const MAXP = 128;
const SPEED = 343.956;
const FILE_KINDS = new Set(["conv", "riaa", "peqfile"]);
const BIQUAD = { b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 };

/**
 * A frequency as a chip prints it: Hz up to 1 kHz, k beyond.
 *
 * @param {number} f
 * @returns {string}
 */
export const fmtHz = (f) => (f >= 1000 ? `${+(f / 1000).toFixed(2)}k` : `${+f}`);

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
    const peq = st.kind === "iir" && PEQ_TYPES.has(st.type) && !st.blk;
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
      return st.type === "biquad" ? "biquad" : `${st.type} ${fmtHz(st.f)} Hz`;
    case "delay":
      return delayText(st);
    case "riaa":
      return "riaa";
    case "gain":
      return gainText(p);
  }
  return st.file ? st.file.split("/").pop() : gr.kind;
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

/**
 * The stage dock for the selected pipeline: shown or not (hidden without one, or while its strip is raw), the chip it
 * edits (clamped into the strip), the band (clamped into an editable PEQ or iir chip, else as kept), the chip and the
 * stage under edit, whether a crossfeed block owns it, how many bands the chip holds, and whether it leads with a kind
 * picker.
 *
 * @param {Pipe | undefined} p
 * @param {boolean} rawOn
 * @param {number} chip
 * @param {number} band
 */
export function dockState(p, rawOn, chip, band) {
  const shown = !!p && !rawOn;
  if (!p || !shown) return { shown, chip, band, group: null, locked: false, si: -1, bands: 0, picker: false };
  const gs = groups(p);
  const c = Math.min(chip, gs.length - 1);
  const gr = gs[c];
  const locked = !!(p.gen && (gr.kind === "gain" || p.stages[gr.idx[0]]?.blk));
  const banded = !locked && (gr.kind === "peq" || gr.kind === "iir");
  const b = banded ? Math.min(band, gr.idx.length - 1) : band;
  const si = gr.idx[gr.kind === "peq" ? b : 0] ?? -1;
  const picker = !p.gen && gr.kind !== "gain" && gr.kind !== "peq";
  return { shown, chip: c, band: b, group: gr, locked, si, bands: gr.idx.length, picker };
}

/**
 * An iir stage's editor fields: its table row (`known` when the type is listed, else the fallback), the width argument
 * shown (the one given, else the first choice), each argument in wire order with the stage's value and whether it
 * switches its form, and which width hint applies ('bw', 's' or null).
 *
 * @param {Stage} st
 * @param {IirType[]} types
 * @param {IirType} fallback
 */
export function iirFields(st, types, fallback) {
  const found = types.find((x) => x.t === st.type);
  const def = found || fallback;
  const alt = def.alt.find((a) => st[a] !== undefined) || def.alt[0];
  const list = def.t === "biquad" ? def.args : [def.args[0], alt, ...def.args.slice(1)].filter(Boolean);
  const args = list.map((arg) => ({ arg, value: st[arg], switchable: arg === alt && def.alt.length > 1 }));
  const hint = def.alt.includes("bw") ? "bw" : def.alt.includes("s") ? "s" : null;
  return { def, known: !!found, alt, args, hint };
}

/**
 * A delay stage's editor fields: the argument it is given in (`known`, else the fallback), its value, and the speed of
 * sound when it is given as a distance (null otherwise).
 *
 * @param {Stage} st
 * @param {DelayArg[]} args
 * @param {DelayArg} fallback
 */
export function delayFields(st, args, fallback) {
  const found = args.find((x) => st[x.a] !== undefined);
  const cur = found || fallback;
  return { cur, known: !!found, value: st[cur.a], speed: cur.a === "d" ? (st.v ?? SPEED) : null };
}

/**
 * A stage a crossfeed block owns, read-only: what it is, its value as the wire gives it, its unit, and its table row.
 *
 * @param {Pipe} p
 * @param {Group} gr
 * @param {{ types: IirType[], delays: DelayArg[] }} tables
 * @returns {{ kind: string, value: string, unit: string, arg: DelayArg | null, def: IirType | null }}
 */
export function lockedFields(p, gr, tables) {
  const st = p.stages[gr.idx[0]];
  if (gr.kind === "gain") return { kind: "gain", value: minus(+p.gain), unit: p.unit, arg: null, def: null };
  if (gr.kind === "delay") {
    const a = /** @type {DelayArg} */ (tables.delays.find((x) => st[x.a] !== undefined));
    return { kind: "delay", value: `${a.a}=${st[a.a]}`, unit: a.unit, arg: a, def: null };
  }
  const def = /** @type {IirType} */ (tables.types.find((x) => x.t === st.type));
  const value = Object.keys(st)
    .filter((k) => !["kind", "type", "blk"].includes(k))
    .map((k) => `${k}=${st[k]}`)
    .join(" ");
  return { kind: "iir", value, unit: "", arg: null, def };
}

/**
 * A gain carried over to the other unit: dB to a Lin factor, Lin to dB (a zero factor floors at −120 dB).
 *
 * @param {number} gain
 * @param {string} unit  the unit switched to
 * @returns {number}
 */
export const gainSwitch = (gain, unit) =>
  unit === "Lin" ? +(10 ** (gain / 20)).toFixed(4) : +(20 * Math.log10(Math.abs(gain) || 1e-6)).toFixed(2);

/**
 * An iir stage's fields once retyped: the arguments both types take kept, a missing width, frequency or gain seeded,
 * a biquad seeded as a pass-through.
 *
 * @param {Stage} st
 * @param {string} v  the type switched to
 * @param {IirType[]} types
 * @returns {Stage}
 */
export function retypeStage(st, v, types) {
  const nd = /** @type {IirType} */ (types.find((x) => x.t === v));
  /** @type {Stage} */
  const keep = { kind: "iir", type: v };
  for (const a of [...nd.args, ...nd.alt]) if (st[a] !== undefined) keep[a] = st[a];
  if (nd.alt.length && !nd.alt.some((a) => keep[a] !== undefined)) keep[nd.alt[0]] = nd.alt[0] === "s" ? 1 : 0.707;
  if (nd.args.includes("f") && keep.f === undefined) keep.f = 1000;
  if (nd.args.includes("g") && keep.g === undefined) keep.g = 0;
  if (v === "biquad") Object.assign(keep, BIQUAD);
  return keep;
}

/**
 * The plot scope drawn: the one asked for, or the one that fits ('auto' = the crosspoint when it holds several, else
 * the pipeline; a crossfeed row has no pipeline scope, a lone crosspoint no crosspoint scope).
 *
 * @param {string} scope
 * @param {boolean} gen
 * @param {boolean} multi
 * @returns {string}
 */
const scopeOf = (scope, gen, multi) =>
  scope === "auto"
    ? multi
      ? "xp"
      : "pipe"
    : scope === "pipe" && gen
      ? "xp"
      : scope === "xp" && !multi
        ? "pipe"
        : scope;

/**
 * A partial curve: a stage the plot cannot draw (convolution, RIAA, a PEQ file).
 *
 * @param {Pipe} q
 * @returns {boolean}
 */
const partial = (q) => q.stages.some((st) => FILE_KINDS.has(st.kind));

/**
 * The traces of one scope, each the sum of its member pipelines.
 *
 * @param {string} sc
 * @param {{ p: Pipe, n: number, eqOf: Pipe, xps: { src: number, members: Pipe[] }[], label: (x: { src: number, members: Pipe[] }) => string }} at
 * @returns {{ cls?: string, label: string, members: Pipe[] }[]}
 */
function tracesOf(sc, { p, n, eqOf, xps, label }) {
  const xp = /** @type {{ src: number, members: Pipe[] }} */ (xps.find((x) => x.src === p.src));
  if (sc === "bus")
    return xps.map((x) => ({ cls: x.src === p.src ? "" : "side", label: label(x), members: x.members }));
  if (sc === "xp")
    return [
      { cls: "ghost", label: p.gen ? "EQ" : `#${n}`, members: [eqOf] },
      { label: label(xp), members: xp.members },
    ];
  return [{ label: `#${n}` + (partial(p) ? " (partial)" : ""), members: [p] }];
}

/**
 * What the plot draws for the selected pipeline of output `o`: shown or not, the scope drawn and the ones offered, the
 * traces (each the sum of its members), the EQ the bands ride and its gain offset (dB), and one draggable band per
 * peak / shelf stage of that EQ (none on the bus scope).
 *
 * @param {Pipe[]} pipes
 * @param {{ o: number, selPipe: number, scope: string, ear: Record<number, Pipe | null | undefined> }} view
 * @param {{ short: (i: number) => string, long: (i: number) => string }} names
 */
export function plotInputs(pipes, { o, selPipe, scope, ear }, names) {
  const p = pipes[selPipe];
  if (!p) return { shown: false, sc: "", options: [], traces: [], eqOf: null, off: 0, bands: [] };
  const xps = inputsOf(pipes, o).map((src) => ({ src, members: crosspoint(pipes, src, o).map(([q]) => q) }));
  const gen = !!p.gen;
  const multi = /** @type {{ members: Pipe[] }} */ (xps.find((x) => x.src === p.src)).members.length > 1;
  const sc = scopeOf(scope, gen, multi);
  const route = `${names.short(p.src)} → ${names.short(o)}`;
  const options = [
    !gen && { v: "pipe", label: `#${selPipe + 1}` },
    multi && { v: "xp", label: route },
    { v: "bus", label: `${names.long(o)} Out` },
  ].filter((x) => !!x);
  const label = (/** @type {{ src: number, members: Pipe[] }} */ x) =>
    `${names.short(x.src)} → ${names.short(o)}` + (x.members.some(partial) ? " (partial)" : "");
  const eqOf = /** @type {Pipe} */ (gen ? ear[/** @type {number} */ (p.ear)] : p);
  const traces = tracesOf(sc, { p, n: selPipe + 1, eqOf, xps, label });
  const off = eqOf.unit === "Lin" ? 20 * Math.log10(Math.abs(+eqOf.gain) || 1e-6) : +eqOf.gain;
  const bands =
    sc === "bus"
      ? []
      : eqOf.stages
          .map((st, k) => ({ st, k, f: +st.f, db: +st.g + off }))
          .filter(({ st }) => st.kind === "iir" && PEQ_TYPES.has(st.type) && !st.blk);
  return { shown: true, sc, options, traces, eqOf, off, bands };
}

/**
 * A dragged band's gain: the curve's dB less the pipeline's gain, clamped to ±20 dB, to a tenth.
 *
 * @param {number} d
 * @param {number} off
 * @returns {number}
 */
export const bandGain = (d, off) => Math.round(Math.max(-20, Math.min(20, d - off)) * 10) / 10;
