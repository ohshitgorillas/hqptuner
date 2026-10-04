// The slider control kind: (D, {c, r, paintOpt}) → its element.

import { h } from "../../../lib/shell/dom.js";
import { sliderBox } from "../../../lib/controls/controls.js";
import { changed } from "./state.js";

/**
 * Slider + box, one value (crossfeed's .xsl grammar). With `auto`, a `Set manually` box gates it (v1 Blocks per
 * cycle): off = auto.v (the daemon decides) and auto.note under it; on = the slider, starting at auto.manual.
 */
export function sliderCtl(D, b) {
  const { c } = b;
  const a = c.auto;
  const { el: sl, range, box } = sliderBox(c);
  const chk = a && h("input", { type: "checkbox" });
  const note = a && h("span.cap", { text: a.note });
  const el = h("div.slctl", { id: c.id }, a && h("label.chk", {}, chk, a.label), sl, note);
  const paint = (v) => {
    const manual = !a || String(v) !== String(a.v);
    if (chk) chk.checked = manual;
    range.value = box.value = manual ? v : a.manual;
    sl.classList.toggle("grayed", !manual);
    range.disabled = box.disabled = !manual;
    if (note) note.hidden = manual;
  };
  const commit = (v) => {
    paint(v);
    changed(D, { ...b, el }, String(v));
  };
  const clamp = (v) => Math.max(c.min, Math.min(c.max, Math.round(Number(v))));
  range.addEventListener("input", () => {
    box.value = range.value;
  });
  range.addEventListener("change", () => commit(clamp(range.value)));
  box.addEventListener("change", () => commit(clamp(box.value)));
  chk?.addEventListener("change", () => commit(chk.checked ? a.manual : a.v));
  paint(c.value);
  el._setValue = paint;
  return el;
}
