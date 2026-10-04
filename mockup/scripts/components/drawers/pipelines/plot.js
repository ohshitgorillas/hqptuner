// DSP pipelines drawer: the response plot beside the dock. `#n` the selected pipeline · `L → L` the crosspoint summed ·
// `Out L` one trace per input. PEQ bands ride the curve as dots and drag on it.

import { h } from "../../../lib/shell/dom.js";
import { seg } from "../../controls/seg.js";
import { pipeH, cplx, toDb } from "../../../lib/dsp/xdsp.js";
import { chShort, chName } from "../../../data/stages/pipelines.js";
import { groups, stageAt } from "../../../../../hqptuner/static/model/shell/pipelines.js";
import { bandGain, plotInputs } from "../../../../../hqptuner/static/model/shell/pipelines-edit.js";
import { paint, stage } from "./state.js";
import { strip } from "./strip.js";
import { paintDock } from "./dock.js";

/** @typedef {import('../../../../../hqptuner/static/model/shell/pipelines.js').Pipe} Pipe */
/** @typedef {import('./output.js').Tab} Tab */
/** @typedef {ReturnType<typeof plotInputs>} PlotView */

const NAMES = { short: chShort, long: chName };

/**
 * Draw output tab `t`'s plot for its selected pipeline (hidden without one).
 *
 * @param {Tab} t
 */
export function plot(t) {
  const { dr } = t;
  const v = plotInputs(dr.pipes, { o: t.o, selPipe: t.selPipe, scope: t.scope, ear: dr.ear }, NAMES);
  /** @type {HTMLElement} */ (t.plotHost.parentElement).hidden = !v.shown;
  if (!v.shown) return;
  t.scopeHost.replaceChildren(
    h("span.cl", { text: "Plot" }),
    seg({
      aria: "Plot scope",
      cls: "mini2 view",
      value: v.sc,
      options: v.options,
      onChange: (s) => {
        t.scope = s;
        plot(t);
      },
    }),
  );
  const traces = v.traces.map(({ members, ...tr }) => ({
    ...tr,
    fn: (/** @type {number} */ f) =>
      toDb(cplx.mag(members.reduce((acc, q) => cplx.add(acc, pipeH(q, f, dr.fs)), [0, 0]))),
  }));
  t.rp.draw(traces, handles(t, v));
}

/**
 * Bands as dots on the EQ (v1 REW-style), offset by its gain so they ride the curve they shape.
 *
 * @param {Tab} t
 * @param {PlotView} v
 */
function handles(t, v) {
  const { dr } = t;
  const p = dr.pipes[t.selPipe];
  const gs = groups(p);
  const focus = (/** @type {number} */ k) => {
    const at = stageAt(gs, k);
    if (at.chip >= 0 && (at.chip !== t.selChip || at.band !== t.selBand)) {
      t.selChip = at.chip;
      t.selBand = at.band;
      paintDock(t);
      t.editor.replaceChildren(strip(t, p, t.selPipe));
    }
  };
  return v.bands.map(({ st, k, f, db }) => ({
    f,
    db,
    off: !!dr.mxWhy,
    onDrag: (/** @type {number} */ f2, /** @type {number} */ d) => {
      st.f = f2;
      st.g = bandGain(d, v.off);
      focus(k);
      plot(t);
    },
    onEnd: (/** @type {number} */ f2, /** @type {number} */ d) => {
      st.f = f2;
      st.g = bandGain(d, v.off);
      focus(k);
      stage(dr, t.ctx);
      paint(dr);
    },
  }));
}
