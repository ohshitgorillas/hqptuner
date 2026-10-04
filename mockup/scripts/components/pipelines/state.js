// DSP pipelines drawer: the state its tabs share. The pipeline set and the stereo pair, the crossfeed block it follows
// (the Crossfeed drawer's staged values), the views that repaint on every edit, and the matrix bypass that grays them.

import { grayBut } from "../../lib/dom.js";
import { withXref, xrefGo } from "../../lib/xref.js";
import { structuralRows, compRows } from "../../lib/xblocks.js";
import { bandsToStages, replacePeq } from "../../model/eq.js";
import { crosspoint } from "../../model/pipelines.js";

export const BLOCK_NAME = { structural: "Structural Crossfeed", comp: "Bauer Crossfeed compensation" };
let made = 0; // drawers built: each registers its own Crossfeed link target, since each caller opens Crossfeed its own way

/**
 * The drawer's shared state.
 * @param {object} cfg  PIPELINES (data/pipelines.js)
 * @param {{bypassed:(v:object)=>string, plate:HTMLElement, openCrossfeed:()=>void, goTab:(id:string)=>void}} deps
 */
export function createState(cfg, { bypassed, plate, openCrossfeed, goTab }) {
  const pipes = cfg.pipes.map((p) => ({ ...p, stages: p.stages.map((x) => ({ ...x })) }));
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

export const at = (dr, src, mix) => crosspoint(dr.pipes, src, mix);
export function paint(dr) {
  for (const v of dr.views) v.paint();
}
export const stage = (dr, ctx) => ctx.set("mxpipes", JSON.stringify(dr.pipes));

/** Gray a tab's body under the matrix bypass but its reason, which stays legible and links to the Matrix engine. */
export function grayed(dr, body, reason) {
  grayBut(body, reason, !!dr.mxWhy);
  for (const x of body.querySelectorAll("button,input")) x.disabled = !!dr.mxWhy;
  reason.replaceChildren(...withXref(dr.mxWhy));
  reason.hidden = !dr.mxWhy;
}

// ── Crossfeed blocks (follow the Crossfeed drawer's staged values) ──────
export function want(v) {
  const n = (k) => Number(v[k]);
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

export function rebuild(dr, b, force) {
  const { pipes, ear } = dr;
  if (!force && b.key === dr.block.key) return;
  for (let k = pipes.length - 1; k >= 0; k--)
    if (pipes[k].gen || pipes[k] === ear[0] || pipes[k] === ear[1]) {
      dr.raw.delete(pipes[k]);
      pipes.splice(k, 1);
    }
  pipes.unshift(
    ...(b.kind === "structural"
      ? structuralRows(ear, b.prm)
      : b.kind === "comp"
        ? compRows(ear, b.prm)
        : [ear[0], ear[1]].filter(Boolean)),
  );
  dr.block = b;
  for (const v of dr.views) v.reset?.();
}

export function watch(dr, ctx) {
  if (dr.watching) return;
  dr.watching = true;
  dr.ctx0 = ctx;
  ctx.init("mxpipes", JSON.stringify(dr.pipes));
  // Discard (mock): the pipeline set goes back to the last applied one; the stereo pair is found again and any crossfeed
  // block rebuilt from it (its rows share the pair's EQ objects again).
  ctx.onDiscard((b) => {
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

/**
 * Land an EQ on the stereo pair from outside (Profile builder): its peak / shelf stages replace the pair's, its preamp
 * becomes the pipeline gain (Import EQ's path); `mirror` false = the first ear only. conv = a convolution file instead.
 */
export function importEq(dr, { bands, pre, conv }, mirror) {
  const p = dr.ear[0] || dr.ear[1];
  if (!p) return;
  const target = [p];
  const twin = p === dr.ear[0] ? dr.ear[1] : dr.ear[0];
  if (mirror && twin) target.push(twin);
  for (const t of target) {
    if (conv) t.stages = [...t.stages.filter((st) => st.kind !== "conv"), { kind: "conv", file: conv }];
    else Object.assign(t, replacePeq(t, bandsToStages(bands), pre));
  }
  if (dr.block.kind !== "none") rebuild(dr, dr.block, true);
  if (dr.ctx0) stage(dr, dr.ctx0);
  paint(dr);
}
