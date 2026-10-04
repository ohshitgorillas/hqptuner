// DSP pipelines drawer: the state its tabs share. The pipeline set and the stereo pair, the crossfeed block it follows
// (the Crossfeed drawer's staged values), the views that repaint on every edit, and the matrix bypass that grays them.

import { grayBut } from "../../../lib/shell/dom.js";
import { withXref, xrefGo } from "../../../lib/controls/xref.js";
import { structuralRows, compRows } from "../../../lib/dsp/xblocks.js";
import { bandsToStages, replacePeq } from "../../../../../hqptuner/static/model/gauges/eq.js";
import { crosspoint } from "../../../../../hqptuner/static/model/shell/pipelines.js";

/** @typedef {import('../../../../../hqptuner/static/model/shell/pipelines.js').Pipe} Pipe */
/** @typedef {import('../../../../../hqptuner/static/model/shell/pipelines.js').Placed} Placed */
/** @typedef {import('../../../../../hqptuner/static/model/gauges/eq.js').Band} Band */
/** @typedef {import('../../../../../hqptuner/static/model/gauges/crossfeed.js').StructuralFields} StructuralFields */
/** @typedef {import('../../../../../hqptuner/static/model/gauges/crossfeed.js').BauerFields} BauerFields */
/** @typedef {import('./popovers.js').Pop} Pop */

/** @typedef {Record<string, string>} Values  the matrix family's values by id */

/**
 * A block's staging handle (drawer/rows.js): seed a value, stage one, hear Discard, hear every value change.
 *
 * @typedef {object} Ctx
 * @property {(id: string, v: string) => void} init
 * @property {(id: string, v: string) => void} set
 * @property {(fn: (base: Values) => void) => void} onDiscard
 * @property {(fn: (v: Values) => void) => void} watch
 */

/** @typedef {{ pipes: Pipe[], inputs: number, outputs: number, rate: number }} Config  PIPELINES (data/stages/pipelines.js) */

/**
 * What the drawer reads from its caller: the matrix bypass reason, the plate its popovers hang on, how Crossfeed opens
 * and how a tab is picked.
 *
 * @typedef {object} Deps
 * @property {(v: Values) => string} bypassed
 * @property {HTMLElement} plate
 * @property {() => void} openCrossfeed
 * @property {(id: string) => void} goTab
 */

/**
 * The crossfeed block the set follows: its kind and values, a key that changes with them, and its folded line's summary.
 *
 * @typedef {{ kind: 'structural', prm: StructuralFields, key: string, sum: string }
 *   | { kind: 'comp', prm: BauerFields, key: string, sum: string }
 *   | { kind: 'none', key: string, sum?: undefined }} Block
 */

/** @typedef {Record<number, Pipe | null | undefined>} Ear  the stereo pair by side: In L→Out L, In R→Out R */

/** @typedef {{ text: string, error: string }} Raw  a strip in Raw: its process string and the parse error */

/** @typedef {{ paint: () => void, reset?: undefined, out?: undefined, focus?: undefined }} PlainView */

/**
 * An output tab as the drawer reaches it: repaint, reset its selection, focus an input (and a pipeline on it).
 *
 * @typedef {object} OutView
 * @property {number} out
 * @property {() => void} paint
 * @property {() => void} reset
 * @property {(src: number, pipe: number | null) => void} focus
 */

/** @typedef {PlainView | OutView} View */

/**
 * The drawer's shared state.
 *
 * @typedef {object} Drawer
 * @property {Pipe[]} pipes  the pipeline set, crossfeed block rows first
 * @property {number} nIn
 * @property {number} nOut
 * @property {number} fs  sample rate, Hz
 * @property {Ear} ear  what a crossfeed block rebuilds; its EQ + gain ride every block row
 * @property {Block} block
 * @property {string} mxWhy  the matrix bypass reason ('' while it runs)
 * @property {boolean} watching
 * @property {Map<Pipe, Raw>} raw  pipe → its Raw text while its strip is in Raw
 * @property {Set<string>} openBlocks  block kinds unfolded in the lists
 * @property {View[]} views
 * @property {Ctx | null} ctx0  the first block's ctx: stages an EQ landed from outside (Profile builder's EQ / Correction)
 * @property {string} toCrossfeed  this drawer's Crossfeed link target
 * @property {(v: Values) => string} bypassed
 * @property {HTMLElement} plate
 * @property {(id: string) => void} goTab
 * @property {Pop | null} pop  the shared popovers (popovers.js)
 */

export const BLOCK_NAME = /** @type {Record<string, string>} */ ({
  structural: "Structural Crossfeed",
  comp: "Bauer Crossfeed compensation",
});
let made = 0; // drawers built: each registers its own Crossfeed link target, since each caller opens Crossfeed its own way

/**
 * The drawer's shared state.
 *
 * @param {Config} cfg
 * @param {Deps} deps
 * @returns {Drawer}
 */
export function createState(cfg, { bypassed, plate, openCrossfeed, goTab }) {
  const pipes = cfg.pipes.map((p) => ({ ...p, stages: p.stages.map((x) => ({ ...x })) }));
  /** @type {Drawer} */
  const dr = {
    pipes,
    nIn: cfg.inputs,
    nOut: cfg.outputs,
    fs: cfg.rate,
    // The stereo pair (In L→Out L, In R→Out R): what a crossfeed block rebuilds; its EQ + gain ride every block row.
    ear: { 0: pipes.find((p) => p.src === 0 && p.mix === 0), 1: pipes.find((p) => p.src === 1 && p.mix === 1) },
    block: { kind: "none", key: "none" },
    mxWhy: "",
    watching: false,
    raw: new Map(), // pipe → {text, error} while its strip is in Raw
    openBlocks: new Set(), // block kinds unfolded in the lists
    views: [],
    ctx0: null, // the first block's ctx: stages an EQ landed from outside (Profile builder's EQ / Correction)
    toCrossfeed: `pipelines-crossfeed-${++made}`,
    bypassed,
    plate,
    goTab,
    pop: null, // the shared popovers (popovers.js)
  };
  xrefGo(dr.toCrossfeed, openCrossfeed);
  return dr;
}

/**
 * The pipelines from one input into one output, each with its position in the set.
 *
 * @param {Drawer} dr
 * @param {number} src
 * @param {number} mix
 * @returns {Placed[]}
 */
export const at = (dr, src, mix) => crosspoint(dr.pipes, src, mix);

/**
 * Repaint every view.
 *
 * @param {Drawer} dr
 */
export function paint(dr) {
  for (const v of dr.views) v.paint();
}

/**
 * Stage the pipeline set through `ctx`.
 *
 * @param {Drawer} dr
 * @param {Ctx} ctx
 * @returns {void}
 */
export const stage = (dr, ctx) => ctx.set("mxpipes", JSON.stringify(dr.pipes));

/**
 * Gray a tab's body under the matrix bypass but its reason, which stays legible and links to the Matrix engine.
 *
 * @param {Drawer} dr
 * @param {HTMLElement} body
 * @param {HTMLElement} reason
 */
export function grayed(dr, body, reason) {
  grayBut(body, reason, !!dr.mxWhy);
  const ctls = /** @type {NodeListOf<HTMLButtonElement | HTMLInputElement>} */ (body.querySelectorAll("button,input"));
  for (const x of ctls) x.disabled = !!dr.mxWhy;
  reason.replaceChildren(...withXref(dr.mxWhy));
  reason.hidden = !dr.mxWhy;
}

// ── Crossfeed blocks (follow the Crossfeed drawer's staged values) ──────
/**
 * The crossfeed block the Crossfeed drawer's values ask for.
 *
 * @param {Values} v
 * @returns {Block}
 */
export function want(v) {
  const n = (/** @type {string} */ k) => Number(v[k]);
  if (v.xfgate === "1" && v.xfimpl === "structural") {
    const prm = { angle: n("xsangle"), circ: n("xscirc"), lambda: n("xslambda") };
    return {
      kind: "structural",
      prm,
      key: `s${prm.angle}|${prm.circ}|${prm.lambda}`,
      sum: `${prm.angle.toFixed(1)}° · ${prm.circ.toFixed(2)} cm · ${Math.round(prm.lambda * 100)}%`,
    };
  }
  if (v.xfgate === "1" && v.xfimpl === "bauer" && n("xfcomp") > 0) {
    const prm = { preset: v.xfpreset, freq: n("xffreq"), level: n("xflevel"), comp: n("xfcomp") };
    return {
      kind: "comp",
      prm,
      key: `c${prm.preset}|${prm.freq}|${prm.level}|${prm.comp}`,
      sum: `${Math.round(prm.comp)}%`,
    };
  }
  return { kind: "none", key: "none" };
}

/**
 * The rows a block puts at the head of the set: its own rows built from the stereo pair, or the pair itself.
 *
 * @param {Ear} ear
 * @param {Block} b
 * @returns {Pipe[]}
 */
function blockRows(ear, b) {
  return b.kind === "structural"
    ? structuralRows(ear, b.prm)
    : b.kind === "comp"
      ? compRows(ear, b.prm)
      : /** @type {Pipe[]} */ ([ear[0], ear[1]].filter(Boolean));
}

/**
 * Rebuild the set's head for block `b` (unless it is the one in place and not `force`d): the old block rows and the pair
 * leave, `b`'s rows arrive, and every view resets its selection.
 *
 * @param {Drawer} dr
 * @param {Block} b
 * @param {boolean} [force]
 */
export function rebuild(dr, b, force) {
  const { pipes, ear } = dr;
  if (!force && b.key === dr.block.key) return;
  for (let k = pipes.length - 1; k >= 0; k--)
    if (pipes[k].gen || pipes[k] === ear[0] || pipes[k] === ear[1]) {
      dr.raw.delete(pipes[k]);
      pipes.splice(k, 1);
    }
  pipes.unshift(...blockRows(ear, b));
  dr.block = b;
  for (const v of dr.views) v.reset?.();
}

/**
 * Follow the family's values from the first block mounted: Discard puts the last applied set back, a bypass or block
 * change rebuilds and repaints.
 *
 * @param {Drawer} dr
 * @param {Ctx} ctx
 */
export function watch(dr, ctx) {
  if (dr.watching) return;
  dr.watching = true;
  dr.ctx0 = ctx;
  ctx.init("mxpipes", JSON.stringify(dr.pipes));
  // Discard (mock): the pipeline set goes back to the last applied one; the stereo pair is found again and any crossfeed
  // block rebuilt from it (its rows share the pair's EQ objects again).
  ctx.onDiscard((b) => {
    /** @type {Pipe[]} */
    const back = JSON.parse(b.mxpipes);
    dr.pipes.splice(0, dr.pipes.length, ...back);
    dr.ear[0] = back.find((p) => !p.gen && p.src === 0 && p.mix === 0);
    dr.ear[1] = back.find((p) => !p.gen && p.src === 1 && p.mix === 1);
    dr.raw.clear();
    dr.mxWhy = dr.bypassed(b);
    rebuild(dr, want(b), true);
    paint(dr);
  });
  ctx.watch((v) => {
    const w = dr.bypassed(v),
      b = want(v);
    if (w !== dr.mxWhy || b.key !== dr.block.key) {
      dr.mxWhy = w;
      rebuild(dr, b);
      paint(dr);
    }
  });
}

/** An EQ to land, or a convolution file alone. @typedef {{ bands?: readonly Band[], pre?: number | null, conv?: string }} EqLoad */

/**
 * Land an EQ on one pipeline: a convolution file replaces its convolution stage, else the EQ's peak / shelf stages
 * replace its own and the preamp becomes its gain. An EQ with no bands lands none, and one with no preamp lands at 0 dB.
 *
 * @param {Pipe} t
 * @param {EqLoad} eq
 */
function landOn(t, { bands = [], pre, conv }) {
  if (conv) t.stages = [...t.stages.filter((st) => st.kind !== "conv"), { kind: "conv", file: conv }];
  else Object.assign(t, replacePeq(t, bandsToStages(bands), pre ?? 0));
}

/**
 * Land an EQ on the stereo pair from outside (Profile builder): its peak / shelf stages replace the pair's, its preamp
 * becomes the pipeline gain (Import EQ's path); `mirror` false = the first ear only. conv = a convolution file instead.
 *
 * @param {Drawer} dr
 * @param {EqLoad} eq
 * @param {boolean} mirror
 */
export function importEq(dr, eq, mirror) {
  const p = dr.ear[0] || dr.ear[1];
  if (!p) return;
  const target = [p];
  const twin = p === dr.ear[0] ? dr.ear[1] : dr.ear[0];
  if (mirror && twin) target.push(twin);
  for (const t of target) landOn(t, eq);
  if (dr.block.kind !== "none") rebuild(dr, dr.block, true);
  if (dr.ctx0) stage(dr, dr.ctx0);
  paint(dr);
}
