// The plain control kinds: seg, select, number, text. Each (D, {c, r, paintOpt}) → its element.

import { h } from "../../lib/dom.js";
import { numBox } from "../../lib/controls.js";
import { seg, select } from "../seg.js";
import { changed } from "./state.js";

/** Segmented buttons; deps can move one from outside (setFrom), so it registers in D.segs. */
export function segCtl(D, b) {
  const { c } = b;
  const el = seg({
    aria: c.aria,
    options: c.options,
    value: c.value,
    cls: c.cls,
    attrs: { id: c.id },
    onChange: (v) => changed(D, { ...b, el }, v),
  });
  D.segs.set(c.id, { ...b, el });
  el._setValue = (v) => select(el, v);
  return el;
}

/** A dropdown. */
export function selectCtl(D, b) {
  const { c } = b;
  const el = h(
    "select.vfd",
    { id: c.id, "aria-label": c.aria },
    c.options.map((o) => h("option", { value: o.v, selected: String(o.v) === String(c.value), text: o.label })),
  );
  el.addEventListener("change", () => changed(D, { ...b, el }, el.value));
  el._setValue = (v) => {
    el.value = v;
  };
  return el;
}

/** A number box. */
export function numberCtl(D, b) {
  const { el, input } = numBox(b.c);
  input.addEventListener("change", () => changed(D, { ...b, el }, input.value));
  el._setValue = (v) => {
    input.value = v;
  };
  return el;
}

/** A one-line text box. */
export function textCtl(D, b) {
  const { c } = b;
  const input = h("input.vfd.txt", {
    type: "text",
    id: c.id,
    value: c.value,
    maxlength: c.maxlength,
    spellcheck: "false",
    "aria-label": c.aria,
  });
  input.addEventListener("change", () => changed(D, { ...b, el: input }, input.value));
  input._setValue = (v) => {
    input.value = v;
  };
  return input;
}
