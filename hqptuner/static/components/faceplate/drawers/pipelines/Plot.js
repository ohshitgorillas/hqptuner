// The response plot beside the dock, drawn by v1's plot frame (components/plots.js PlotFrame, as the Matrix response
// card draws it): `#n` the picked pipeline · `L → L` its crosspoint summed · `Out L` one trace per input, each trace
// the complex sum of its pipelines, gains included. The picked pipeline's peak and shelf bands ride the curve as dots
// and drag on it; a crossfeed block's row has none to drag. Which scope is drawn, its traces and its bands are
// model/shell/pipelines-edit.js's `plotInputs`; the curves are the vendored chain response.

import { signal } from "@preact/signals";
import { html } from "../../../../lib/dom.js";
import { classNames } from "../../../../model/shell/format.js";
import { groups, stageAt } from "../../../../model/shell/pipelines.js";
import { bandGain, dockState, plotInputs } from "../../../../model/shell/pipelines-edit.js";
import { chainResponse } from "../../../../vendor/eqlab/core/dsp/chain.js";
import { bandFreqs } from "../../../../vendor/eqlab/core/dsp/curves.js";
import { chName, chShort, setStages } from "../../../../store/faceplate/drawers/pipelines.js";
import { PlotFrame } from "../../../plots.js";
import { raws } from "./state.js";
import { Seg } from "./parts.js";

/** @typedef {import("../../../../model/shell/pipelines.js").Pipe} Pipe */
/** @typedef {import("../../../../model/shell/pipelines.js").Stage} Stage */
/** @typedef {import("../../../../vendor/eqlab/core/matrixspec.js").MatrixStage} WireStage */
/** @typedef {import("./Output.js").Tab} Tab */
/** @typedef {{ i: number, k: number, f: number, g: number }} Drag  a band in flight: pipeline, stage, where it is */

// The same fixed audio-band reference rate as v1's matrix plot: a biquad's shape across 20 Hz–20 kHz is near
// rate-independent once fs is well above audio.
const FS = 48000;
const FREQS = bandFreqs(160);
const NAMES = { short: chShort, long: chName };
const BAND_DB = 20; // ± the band strip's gain range, dB

/** The band being dragged, drawn where it is until it lands. */
const drag = signal(/** @type {Drag | null} */ (null));

/**
 * A model stage as the vendored chain response reads it.
 *
 * @param {Stage} st
 * @returns {WireStage}
 */
function toWire(st) {
  if (st.kind === "conv" || st.kind === "peqfile") return { kind: "conv", file: String(st.file ?? "") };
  const args = Object.entries(st).filter(([k, v]) => k !== "kind" && k !== "blk" && v !== undefined);
  return { kind: st.kind, args: Object.fromEntries(args.map(([k, v]) => [k, String(v)])) };
}

/**
 * The summed response of `members`, dB at each plotted frequency.
 *
 * @param {Pipe[]} members
 * @returns {[number, number][]}
 */
function curve(members) {
  const chains = members.map((q) => ({
    wire: q.stages.map(toWire),
    k: q.unit === "Lin" ? +q.gain : 10 ** (+q.gain / 20),
  }));
  return FREQS.map((f) => {
    let re = 0;
    let im = 0;
    for (const c of chains) {
      const r = chainResponse(c.wire, f, FS);
      const m = c.k * 10 ** (r.db / 20);
      re += m * Math.cos((r.deg * Math.PI) / 180);
      im += m * Math.sin((r.deg * Math.PI) / 180);
    }
    return /** @type {[number, number]} */ ([f, 20 * Math.log10(Math.hypot(re, im) || 1e-6)]);
  });
}

/**
 * The set with the band in flight where it is.
 *
 * @param {Pipe[]} pipes
 * @returns {Pipe[]}
 */
function dragged(pipes) {
  const d = drag.value;
  if (!d || !pipes[d.i]) return pipes;
  const p = pipes[d.i];
  const moved = { ...p, stages: p.stages.map((s, k) => (k === d.k ? { ...s, f: d.f, g: d.g } : s)) };
  return pipes.map((q, j) => (j === d.i ? moved : q));
}

/** @typedef {ReturnType<typeof plotInputs>} PlotView */

/**
 * The traces drawn, and the dB window that holds them (whole 6 dB steps, ±36 at most, ±6 at least).
 *
 * @param {PlotView} pv
 */
function traced(pv) {
  const bounds = { min: -6, max: 6 };
  const traces = pv.traces.map((tr) => {
    const points = curve(tr.members);
    for (const [, db] of points) {
      bounds.min = Math.min(bounds.min, db);
      bounds.max = Math.max(bounds.max, db);
    }
    return { points, kind: classNames("trace", tr.cls), label: tr.label, ghost: tr.cls === "ghost" };
  });
  const yMin = Math.max(Math.floor(bounds.min / 6) * 6, -36);
  return { traces, yMin, yMax: Math.min(Math.ceil(bounds.max / 6) * 6, 36) };
}

/**
 * The picked pipeline's bands as dots: grabbing one picks its chip and band, dragging moves it, letting go stages it.
 * None on a crossfeed block's row or while grayed.
 *
 * @param {Tab} t
 * @param {Pipe} p
 * @param {PlotView} pv
 */
function handlesOf(t, p, pv) {
  if (p.gen || t.off) return [];
  const i = t.cur.selPipe;
  const active = dockState(p, !!raws.value[i], t.cur.chip, t.cur.band).si;
  const at = (/** @type {number} */ k) => stageAt(groups(p), k);
  const g = (/** @type {number} */ db) => bandGain(db, pv.off);
  const land = (/** @type {number} */ k, /** @type {number} */ f, /** @type {number} */ db) => {
    drag.value = null;
    setStages(
      i,
      p.stages.map((s, j) => (j === k ? { ...s, f: Math.round(f), g: g(db) } : s)),
    );
  };
  return pv.bands.map(({ st, k, f, db }) => ({
    f,
    db,
    kind: "hdl",
    active: k === active,
    label: String(st.type),
    dbMin: pv.off - BAND_DB,
    dbMax: pv.off + BAND_DB,
    onSelect: () => t.put({ chip: Math.max(0, at(k).chip), band: at(k).band }),
    onDrag: (/** @type {number} */ nf, /** @type {number} */ nd) => (drag.value = { i, k, f: nf, g: g(nd) }),
    onEnd: (/** @type {number} */ nf, /** @type {number} */ nd) => land(k, nf, nd),
  }));
}

/**
 * The plot for the picked pipeline, its scope switch above it; hidden without one.
 *
 * @param {{ t: Tab, p: Pipe | undefined, dim: string | undefined }} props
 */
export function PlotPanel({ t, p, dim }) {
  const pv = plotInputs(
    dragged(t.v.pipes),
    { o: t.o, selPipe: t.cur.selPipe, scope: t.cur.scope, ear: t.v.ear },
    NAMES,
  );
  if (!p || !pv.shown) return html`<div class="pplotwrap" hidden></div>`;
  const { traces, yMin, yMax } = traced(pv);
  return html`
    <div class=${classNames("pplotwrap", dim)}>
      <div class="pscope">
        <span class="cl">Plot</span>
        <${Seg}
          aria="Plot scope"
          cls="mini2 view"
          value=${pv.sc}
          options=${pv.options}
          off=${t.off}
          onChange=${(/** @type {string} */ s) => t.put({ scope: s })}
        />
      </div>
      <div class="eq pplot">
        <${PlotFrame} traces=${traces} yMin=${yMin} yMax=${yMax} dbStep=${6} height=${200} handles=${handlesOf(t, p, pv)} />
      </div>
    </div>
  `;
}
