// DSP pipelines drawer: the stage dock under the strip. One shape for every stage, read top to bottom under its chip
// (the chip names the stage, so no title):
//   row 1  what it is   (stage kind, band stepper, filter type, unit) ··· a locked stage's owner link at the right end
//   row 2  its values   (labelled boxes with their units, in wire order)
//   copy   what they mean, full width under the controls it explains
// The editors for each kind live in editors.js.

import { h } from "../../../lib/shell/dom.js";
import { xref } from "../../../lib/controls/xref.js";
import { PMAN, IIR_TYPES, DELAY_ARGS, KINDS } from "../../../data/stages/pipelines.js";
import { dockState, lockedFields } from "../../../model/shell/pipelines-edit.js";
import { BLOCK_NAME, paint, stage } from "./state.js";
import { FRESH, focusStage } from "./strip.js";
import { delayEditor, fileDock, gainDock, iirEditor, lab, paras, riaaDock, tline } from "./editors.js";

/** @typedef {import('../../../model/shell/pipelines.js').Pipe} Pipe */
/** @typedef {import('../../../model/shell/pipelines.js').Group} Group */
/** @typedef {import('../../../model/shell/pipelines-edit.js').DelayArg} DelayArg */
/** @typedef {import('../../../model/shell/pipelines-edit.js').IirType} IirType */
/** @typedef {import('./output.js').Tab} Tab */
/** @typedef {import('./editors.js').Dock} Dock */
/** @typedef {import('./editors.js').After} After */
/** @typedef {ReturnType<typeof dockState>} DockState */

/**
 * Paint the dock for the selected pipeline's selected chip (hidden without one, or while its strip is raw).
 *
 * @param {Tab} t
 */
export function paintDock(t) {
  const { dr } = t;
  const p = dr.pipes[t.selPipe];
  const ds = dockState(p, !!p && dr.raw.has(p), t.selChip, t.selBand);
  t.dock.hidden = !ds.shown;
  if (t.dock.hidden) return;
  t.selChip = ds.chip;
  t.selBand = ds.band;
  const after = () => {
    stage(dr, t.ctx);
    paint(dr);
  };
  const gr = /** @type {Group} */ (ds.group); // a shown dock has its chip
  const d = ds.locked ? lockedDock(t, p, gr) : editDock(t, p, ds, after); // {what, right, values, copy}
  // Every single stage leads with its kind, so a wrong pick from `+` is one change away.
  if (ds.picker) d.what = [lab("Stage"), kindPicker(t, p, gr.idx[0], after), d.what];
  const what = [d.what].flat(3).filter(Boolean);
  t.dock.replaceChildren(
    .../** @type {HTMLElement[]} */ (
      [
        (what.length || d.right) && h("div.pdr", {}, what, h("span.grow"), d.right),
        d.values?.length && h("div.pfields", {}, d.values),
        h("div.pdcopy", {}, d.copy.flat().filter(Boolean)),
      ].filter(Boolean)
    ),
  );
}

/**
 * The dock of a stage the pipeline owns: its kind's editor.
 *
 * @param {Tab} t
 * @param {Pipe} p
 * @param {DockState} ds
 * @param {After} after
 * @returns {Dock}
 */
function editDock(t, p, ds, after) {
  const right = null; // removal lives on the pill's ×
  const gr = /** @type {Group} */ (ds.group);
  const st = p.stages[ds.si];
  switch (gr.kind) {
    case "gain":
      return gainDock(p, after);
    case "peq":
    case "iir": {
      const e = iirEditor(st, after);
      return {
        what: [gr.kind === "peq" && bandNav(t, p, ds, after), lab("Type"), e.type],
        right,
        values: e.values,
        copy: e.copy,
      };
    }
    case "delay": {
      const e = delayEditor(st, after);
      return { what: [lab("Given in"), e.unit], right, values: e.values, copy: [...e.copy, ...paras(PMAN.delay)] };
    }
    case "riaa":
      return riaaDock(st, after, right);
  }
  return fileDock(st, right);
}

/**
 * Bands step here or by their dots on the plot; one band's editor at a time.
 *
 * @param {Tab} t
 * @param {Pipe} p
 * @param {DockState} ds
 * @param {After} after
 */
function bandNav(t, p, ds, after) {
  const nb = ds.bands,
    idx = /** @type {Group} */ (ds.group).idx,
    si = ds.si;
  const step = (/** @type {number} */ k) => {
    t.selBand = (t.selBand + k + nb) % nb;
    paintDock(t);
    t.replot();
  };
  return [
    lab("Band"),
    h(
      "div.pbnav",
      {},
      h("button.round.pbn", {
        type: "button",
        text: "‹",
        "aria-label": "Previous band",
        on: { click: () => step(-1) },
      }),
      h("span.pbl", { text: `${t.selBand + 1} / ${nb}` }),
      h("button.round.pbn", { type: "button", text: "›", "aria-label": "Next band", on: { click: () => step(1) } }),
      !p.gen &&
        h("button.round.pbn", {
          type: "button",
          text: "+",
          "aria-label": "Add a band",
          on: {
            click: () => {
              p.stages.splice(idx[nb - 1] + 1, 0, { kind: "iir", type: "peak", f: 1000, q: 1, g: 0 });
              t.selBand = nb;
              after();
            },
          },
        }),
      !p.gen &&
        h("button.round.pbn", {
          type: "button",
          text: "−",
          "aria-label": `Remove band ${t.selBand + 1}`,
          on: {
            click: () => {
              p.stages.splice(si, 1);
              t.selBand = Math.max(0, t.selBand - 1);
              after();
            },
          },
        }),
    ),
  ];
}

/**
 * The stage kind picker: a change puts a fresh stage of that kind in its place.
 *
 * @param {Tab} t
 * @param {Pipe} p
 * @param {number} si
 * @param {After} after
 * @returns {HTMLSelectElement}
 */
function kindPicker(t, p, si, after) {
  const cur = p.stages[si].kind;
  const opts = [...KINDS, ...(KINDS.some((k) => k.k === cur) ? [] : [{ k: cur, label: "PEQ file" }])];
  const el = /** @type {HTMLSelectElement} */ (
    h(
      "select.vfd.pkind",
      { "aria-label": "Stage kind" },
      opts.map((k) => h("option", { value: k.k, selected: k.k === cur, text: k.label })),
    )
  );
  el.addEventListener("change", () => {
    p.stages[si] = FRESH[el.value]();
    focusStage(t, p, si);
    after();
  });
  return el;
}

/**
 * The dock of a stage a crossfeed block owns: read-only, its owner linked at the right end.
 *
 * @param {Tab} t
 * @param {Pipe} p
 * @param {Group} gr
 * @returns {Dock}
 */
function lockedDock(t, p, gr) {
  const lf = lockedFields(p, gr, { types: IIR_TYPES, delays: DELAY_ARGS });
  const right = xref(t.dr.toCrossfeed, BLOCK_NAME[/** @type {string} */ (p.gen)]);
  const ro = (/** @type {string} */ txt) => h("span.vfd.pfile.pro", { text: txt });
  if (lf.kind === "gain")
    return {
      right,
      values: [h("div.pfield", {}, lab("Gain"), ro(lf.value), h("span.u.pu", { text: lf.unit }))],
      copy: paras(PMAN.gain),
    };
  if (lf.kind === "delay") {
    const arg = /** @type {DelayArg} */ (lf.arg);
    return {
      right,
      values: [h("div.pfield", {}, lab("Delay"), ro(lf.value), h("span.u.pu", { text: lf.unit }))],
      copy: [tline(arg.a, arg.d), ...paras(PMAN.delay)],
    };
  }
  const def = /** @type {IirType} */ (lf.def);
  return {
    what: [lab("Type"), ro(`${def.d}: ${def.t}`)],
    right,
    values: [h("div.pfield", {}, lab("Arguments"), ro(lf.value))],
    copy: [tline(def.t, PMAN.iirUnits)],
  };
}
