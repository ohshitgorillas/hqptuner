// DOM-free decisions of the DSP pipelines drawer's editing surfaces (components/pipelines/dock.js, plot.js): the stage
// dock's field values and whether they resolve against their tables, and the inputs the response plot draws.

import { PEQ_TYPES } from "../gauges/eq.js";
import { minus } from "../../../../hqptuner/static/model/shell/format.js";
import { crosspoint, groups, inputsOf } from "./pipelines.js";

/** @typedef {import('./pipelines.js').Stage} Stage */
/** @typedef {import('./pipelines.js').Pipe} Pipe */
/** @typedef {import('./pipelines.js').Group} Group */
/** @typedef {{ t: string, d: string, args: string[], alt: string[] }} IirType  one row of the iir table */
/** @typedef {{ a: string, d: string, unit: string }} DelayArg  one row of the delay table */

const SPEED = 343.956;
const FILE_KINDS = new Set(["conv", "riaa", "peqfile"]);
const BIQUAD = { b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 };
/** The chip kinds whose band clamps into the chip's stages. */
const BANDED = new Set(["peq", "iir"]);
/** The chip kinds that lead with no kind picker. */
const UNPICKED = new Set(["gain", "peq"]);
/** @type {[string, number][]} the arguments a retyped stage seeds when it lacks them: frequency, gain */
const SEEDS = [
  ["f", 1000],
  ["g", 0],
];

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
  if (!p || rawOn) return { shown: false, chip, band, group: null, locked: false, si: -1, bands: 0, picker: false };
  const gs = groups(p);
  const c = Math.min(chip, gs.length - 1);
  const gr = gs[c];
  const locked = lockedGroup(p, gr);
  const b = !locked && BANDED.has(gr.kind) ? Math.min(band, gr.idx.length - 1) : band;
  const si = gr.idx[gr.kind === "peq" ? b : 0] ?? -1;
  const picker = !p.gen && !UNPICKED.has(gr.kind);
  return { shown: true, chip: c, band: b, group: gr, locked, si, bands: gr.idx.length, picker };
}

/**
 * Whether a crossfeed block owns a chip of a crossfeed row: its gain, or a stage the block placed.
 *
 * @param {Pipe} p
 * @param {Group} gr
 * @returns {boolean}
 */
const lockedGroup = (p, gr) => !!(p.gen && (gr.kind === "gain" || p.stages[gr.idx[0]]?.blk));

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
  const args = list.map((arg) => ({
    arg,
    value: /** @type {number | undefined} */ (st[arg]),
    switchable: arg === alt && def.alt.length > 1,
  }));
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
  const value = /** @type {number | undefined} */ (st[cur.a]);
  return { cur, known: !!found, value, speed: cur.a === "d" ? (st.v ?? SPEED) : null };
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
  const out = seeded(keep, nd);
  if (v === "biquad") Object.assign(out, BIQUAD);
  return out;
}

/**
 * A retyped stage with what it lacks seeded: a width (slope 1, else 0.707) when it keeps none, then a frequency and
 * a gain where the type takes them.
 *
 * @param {Stage} keep
 * @param {IirType} nd  the type switched to
 * @returns {Stage}
 */
function seeded(keep, nd) {
  const out = { ...keep };
  if (nd.alt.length && !nd.alt.some((a) => out[a] !== undefined)) out[nd.alt[0]] = nd.alt[0] === "s" ? 1 : 0.707;
  for (const [a, x] of SEEDS) if (nd.args.includes(a) && out[a] === undefined) out[a] = x;
  return out;
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
          .map((st, k) => ({ st, k, f: +(/** @type {number} */ (st.f)), db: +(/** @type {number} */ (st.g)) + off }))
          .filter(({ st }) => st.kind === "iir" && PEQ_TYPES.has(/** @type {string} */ (st.type)) && !st.blk);
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
