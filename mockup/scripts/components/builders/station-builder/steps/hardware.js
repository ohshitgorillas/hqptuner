// Hardware step (wizard §4): the machine's, not the station's. GPUs and E-cores, the GPU questions, and the settings Save
// writes to every station.

import { h } from "../../../../lib/shell/dom.js";
import { seg } from "../../../controls/seg.js";
import { STB_HW, hwSettings } from "../../../../data/builders/station-builder.js";
import { hardwareView, optionLabel } from "../../../../model/builders/station.js";
import { choiceHead, num, paras, rich, tip } from "../frame/parts.js";

/** @typedef {import('../../station-builder.js').StationState} StationState */
/** @typedef {import('../../station-builder.js').HwRec} HwRec */
/** @typedef {import('../../../../model/builders/station.js').HardwareView} HardwareView */
/** @typedef {(fn: (y: HwRec) => void) => void} SetHw  change the hardware answers and repaint the step */
/** @typedef {import('../frame/tables.js').RowOption} RowOption */

/**
 * The GPU power line: three radio lines, no paragraphs.
 *
 * @param {HwRec} w
 * @param {SetHw} setHw
 */
function powerLine(w, setHw) {
  return h(
    "div.stbpow",
    {},
    h("div.fh", {}, h("b", { text: STB_HW.power })),
    h(
      "div.chlist.stbch",
      { role: "radiogroup", "aria-label": STB_HW.power },
      STB_HW.powers.map((op) => {
        const on = op.v === w.power;
        const go2 = () =>
          setHw((y) => {
            y.power = op.v;
          });
        return h("div.chline", { class: on && "cur" }, choiceHead(op.label, on, go2));
      }),
    ),
  );
}

/**
 * The two cards' indices and whether they are identical.
 *
 * @param {HwRec} w
 * @param {SetHw} setHw
 */
function cardIndices(w, setHw) {
  const box = { min: 0, max: 15, step: 1, unit: "" };
  return h(
    "div.cgrp.stbidx",
    {},
    h(
      "label.ci",
      {},
      h("span.cl", { text: STB_HW.idx.hi }),
      num(STB_HW.idx.hi, w.hi, box, (n) =>
        setHw((y) => {
          y.hi = n;
        }),
      ),
    ),
    h(
      "label.ci",
      {},
      h("span.cl", { text: STB_HW.idx.lo }),
      num(STB_HW.idx.lo, w.lo, box, (n) =>
        setHw((y) => {
          y.lo = n;
        }),
      ),
    ),
    h(
      "label.stbcb",
      {},
      h("button.binc", {
        type: "button",
        role: "checkbox",
        aria: { checked: w.same, label: STB_HW.idx.same },
        on: {
          click: () =>
            setHw((y) => {
              y.same = !y.same;
            }),
        },
      }),
      h("span", { text: STB_HW.idx.same }),
    ),
  );
}

/**
 * The GPU questions: the wizard's two in the control column, the manual's CUDA paragraph beside them.
 *
 * @param {StationState} sb
 * @param {HwRec} w
 * @param {SetHw} setHw
 * @param {HardwareView} v
 */
function gpuRow(sb, w, setHw, v) {
  const { HWMAN } = sb.T;
  const two = seg({
    aria: "Nvidia GPUs",
    options: STB_HW.twoOpts,
    value: w.gpus,
    onChange: (g) =>
      setHw((y) => {
        y.gpus = g;
      }),
  });
  const idx = v.twoCards && cardIndices(w, setHw);
  const power = v.power && powerLine(w, setHw);
  return h(
    "div.drow.stbq2",
    {},
    h("div.ctl", {}, h("div.fh", {}, h("b", {}, rich(STB_HW.two))), two, idx, power),
    h("div.man", {}, paras(v.twoCards ? [HWMAN.cuda, HWMAN.devs] : HWMAN.cuda)),
  );
}

/**
 * The result row: what Save writes to every station.
 *
 * @param {StationState} sb
 * @param {HwRec} w
 * @param {HardwareView} v
 */
function resultRow(sb, w, v) {
  const res = hwSettings(w);
  const optLabel = (/** @type {string} */ id, /** @type {string} */ x) =>
    optionLabel(/** @type {RowOption[]} */ (sb.T.HW[id].control.options), x);
  const ro = (/** @type {string} */ label, /** @type {string} */ x) =>
    h("div.stbrr", {}, h("span", { text: label }), h("b", { text: x }));
  return h(
    "div.drow.stbres",
    {},
    h(
      "div.ctl",
      {},
      h("div.fh", {}, h("b", { text: STB_HW.result })),
      h(
        "div.stbrrs",
        {},
        ro("Multicore DSP", optLabel("multicore", res.multicore)),
        ro("E-core allocation", optLabel("ecores", res.ecores)),
        ro("CUDA offload", optLabel("cuda", res.cuda)),
        v.twoCards && ro("CUDA devices", `DSP ${res.cudadev} · Convolution ${res.cudacdev}`),
      ),
      h("p.stbcap", { text: STB_HW.all }),
    ),
    h("div.man", {}, tip("HQPTuner Tips:", STB_HW.tip)),
  );
}

/**
 * The Hardware step's rows.
 *
 * @param {StationState} sb
 */
export function hardwareStep(sb) {
  const w = sb.e.hw;
  const v = hardwareView(w);
  /** @type {SetHw} */
  const setHw = (fn) => {
    fn(w);
    sb.show("hardware");
  };
  const box = (/** @type {'gpu' | 'ecores'} */ k, /** @type {string} */ label) =>
    h(
      "label.stbcb",
      {},
      h("button.binc", {
        type: "button",
        role: "checkbox",
        aria: { checked: !!w[k], label },
        on: {
          click: () =>
            setHw((y) => {
              y[k] = !y[k];
            }),
        },
      }),
      h("span", { text: label }),
    );
  const rows = [
    h(
      "div.drow.stbq2",
      {},
      h(
        "div.ctl",
        {},
        h("div.fh", {}, h("b", { text: STB_HW.has })),
        h(
          "div.stbcbs",
          {},
          STB_HW.hasOpts.map((op) => box(/** @type {'gpu' | 'ecores'} */ (op.v), op.label)),
        ),
      ),
      h("div.man", {}, paras(v.ecoresManual ? sb.T.HWMAN.ecores : "")),
    ),
  ];
  if (v.gpu) rows.push(gpuRow(sb, w, setHw, v));
  rows.push(resultRow(sb, w, v));
  return rows;
}
