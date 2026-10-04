import { h } from "../../../lib/shell/dom.js";
import { seg } from "../../controls/seg.js";
import { PB_COPY } from "../../../data/builders/profiles.js";
import { show } from "../profile-builder.js";
import { set } from "./values.js";
import { drow } from "./parts.js";

/** @typedef {import('./records.js').PB} PB */
/** @typedef {import('./records.js').OptRow} OptRow */
/** @typedef {import('./records.js').OptList} OptList */

const OFF_ON = [
  { v: "0", label: "Off" },
  { v: "1", label: "On" },
];

// Advanced settings (only from the overview's foot): the engine rows with every option's manual line.
/**
 * An engine row's options, each with its manual line; tapping one sets value `k`.
 *
 * @param {PB} pb
 * @param {OptRow} r
 * @param {string} k
 * @returns {OptList}
 */
function optList(pb, r, k) {
  const rows = r.optMan.map((x) =>
    h(
      "button.optrow",
      { type: "button", data: { v: x.v }, on: { click: () => set(pb, { [k]: x.v }) } },
      h("code", { text: x.label ?? x.v }),
      h("span", { text: x.man }),
    ),
  );
  return {
    el: h("div.optlist", { role: "list" }, rows),
    paint: () => {
      for (const b of rows) b.classList.toggle("cur", b.dataset.v === pb.v[k]);
    },
  };
}
/**
 * Mount the Advanced settings page's controls.
 *
 * @param {PB} pb
 */
export function mountAdvanced(pb) {
  const { R } = pb;
  pb.engSeg = seg({
    aria: "Engine",
    cls: "enum",
    options: R.engine.optMan.map((x) => ({ v: x.v, label: /** @type {string} */ (x.label) })),
    value: "1",
    onChange: (x) => set(pb, { mxengine: x }),
  });
  pb.hfSeg = seg({ aria: "Expand HF", options: OFF_ON, value: "0", onChange: (x) => set(pb, { mxexpand: x }) });
  pb.iirSeg = seg({
    aria: "IIR to FIR",
    cls: "enum",
    options: R.iir.optMan.map((x) => ({ v: x.v, label: x.label ?? x.v })),
    value: "0",
    onChange: (x) => set(pb, { mxiir2fir: x }),
  });
  pb.engList = optList(pb, R.engine, "mxengine");
  pb.iirList = optList(pb, R.iir, "mxiir2fir");
}
/**
 * The Advanced settings page: the engine rows, then the way back to the overview.
 *
 * @param {PB} pb
 * @returns {HTMLElement}
 */
export function advancedPage(pb) {
  const { B, R } = pb;
  return h(
    "div.pbstepp",
    {},
    B.title(PB_COPY.advanced),
    h(
      "div.pbsrows",
      {},
      drow("Engine", pb.engSeg, R.engine.man, pb.engList.el),
      drow("Expand HF", pb.hfSeg, R.expand.man),
      drow("IIR to FIR", pb.iirSeg, R.iir.man, pb.iirList.el),
    ),
    h(
      "div.pbnav",
      {},
      h("span.grow"),
      h("button.btn.sm", { type: "button", text: PB_COPY.overview, on: { click: () => show(pb, "overview") } }),
    ),
  );
}
