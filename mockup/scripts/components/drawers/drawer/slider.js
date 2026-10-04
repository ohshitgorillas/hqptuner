// The slider control kind: (D, {c, r, paintOpt}) → its element.

import { h } from "../../../lib/shell/dom.js";
import { sliderBox } from "../../../lib/controls/controls.js";
import { changed } from "./state.js";

/** @typedef {import("./state.js").Drawer} Drawer */
/** @typedef {import("./state.js").Ctl} Ctl */
/** @typedef {import("./state.js").SettableEl} SettableEl */
/** @typedef {import("./state.js").Labelled} Labelled */

/**
 * Slider + box, one value (crossfeed's .xsl grammar). With `auto`, a `Set manually` box gates it (v1 Blocks per
 * cycle): off = auto.v (the daemon decides) and auto.note under it; on = the slider, starting at auto.manual.
 *
 * @param {Drawer} D
 * @param {Ctl} b
 * @returns {SettableEl}
 */
export function sliderCtl(D, b) {
  const { c } = b;
  const a = c.auto;
  const { el: sl, range, box } = sliderBox(/** @type {Labelled} */ (c));
  const chk = a && h("input", { type: "checkbox" });
  const note = a && h("span.cap", { text: a.note });
  /** @type {SettableEl} */
  const el = h("div.slctl", { id: c.id }, a && h("label.chk", {}, chk, a.label), sl, note);
  /** @param {string | number | undefined} v */
  const paint = (v) => {
    const manual = !a || String(v) !== String(a.v);
    if (chk) chk.checked = manual;
    range.value = box.value = String(manual ? v : a?.manual);
    sl.classList.toggle("grayed", !manual);
    range.disabled = box.disabled = !manual;
    if (note) note.hidden = manual;
  };
  /** @param {string | number | undefined} v */
  const commit = (v) => {
    paint(v);
    changed(D, { ...b, el }, String(v));
  };
  /** @param {string} v */
  const clamp = (v) => Math.max(Number(c.min), Math.min(Number(c.max), Math.round(Number(v))));
  range.addEventListener("input", () => {
    box.value = range.value;
  });
  range.addEventListener("change", () => commit(clamp(range.value)));
  box.addEventListener("change", () => commit(clamp(box.value)));
  chk?.addEventListener("change", () => commit(chk.checked ? a?.manual : a?.v));
  paint(c.value);
  el._setValue = paint;
  return el;
}
