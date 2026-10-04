// The plain control kinds: seg, select, number, text. Each (D, {c, r, paintOpt}) → its element.

import { h } from "../../../lib/shell/dom.js";
import { numBox } from "../../../lib/controls/controls.js";
import { seg, select } from "../../controls/seg.js";
import { changed } from "./state.js";

/** @typedef {import("./state.js").Drawer} Drawer */
/** @typedef {import("./state.js").Ctl} Ctl */
/** @typedef {import("./state.js").Listed} Listed */
/** @typedef {import("./state.js").Labelled} Labelled */
/**
 * @template {HTMLElement} [E=HTMLElement]
 * @typedef {import("./state.js").SettableEl<E>} SettableEl
 */

/**
 * Segmented buttons; deps can move one from outside (setFrom), so it registers in D.segs.
 *
 * @param {Drawer} D
 * @param {Ctl} b
 * @returns {SettableEl}
 */
export function segCtl(D, b) {
  const c = /** @type {Listed} */ (b.c);
  /** @type {SettableEl} */
  const el = seg({
    aria: c.aria,
    options: c.options,
    value: c.value,
    cls: c.cls,
    attrs: /** @type {Record<string, string>} */ ({ id: c.id }),
    onChange: (v) => changed(D, { ...b, el }, v),
  });
  D.segs.set(c.id, { ...b, el });
  el._setValue = (v) => select(el, v);
  return el;
}

/**
 * A dropdown.
 *
 * @param {Drawer} D
 * @param {Ctl} b
 * @returns {SettableEl}
 */
export function selectCtl(D, b) {
  const c = /** @type {Listed} */ (b.c);
  /** @type {SettableEl<HTMLSelectElement>} */
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

/**
 * A number box.
 *
 * @param {Drawer} D
 * @param {Ctl} b
 * @returns {SettableEl}
 */
export function numberCtl(D, b) {
  /** @type {{ el: SettableEl, input: HTMLInputElement }} */
  const { el, input } = numBox(/** @type {Labelled} */ (b.c));
  input.addEventListener("change", () => changed(D, { ...b, el }, input.value));
  el._setValue = (v) => {
    input.value = v;
  };
  return el;
}

/**
 * A one-line text box.
 *
 * @param {Drawer} D
 * @param {Ctl} b
 * @returns {SettableEl}
 */
export function textCtl(D, b) {
  const { c } = b;
  /** @type {SettableEl<HTMLInputElement>} */
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
