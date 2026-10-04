// The accent control kind: (D, {c, r, paintOpt}) → its element.

import { h } from "../../../lib/shell/dom.js";
import { changed } from "./state.js";

/** @typedef {import("./state.js").Drawer} Drawer */
/** @typedef {import("./state.js").Ctl} Ctl */
/** @typedef {import("./state.js").Listed} Listed */
/** @typedef {import("./state.js").SettableEl} SettableEl */

/**
 * v1 AccentPicker: swatches pick a preset; the hex box holds that preset's value and takes any custom #rrggbb.
 *
 * @param {Drawer} D
 * @param {Ctl} b
 * @returns {SettableEl}
 */
export function accentCtl(D, b) {
  const c = /** @type {Listed} */ (b.c);
  const hex = h("input.vfd.hex", {
    type: "text",
    maxlength: 7,
    spellcheck: "false",
    "aria-label": "Custom accent hex",
  });
  const sw = c.options.map((o) =>
    h("button.swatch", {
      type: "button",
      title: o.label,
      "aria-label": o.label,
      data: { v: o.v },
      style: `--sw:${o.hex}`,
      on: { click: () => pickAcc(o.v) },
    }),
  );
  /** @type {SettableEl} */
  const el = h("div.accpick", { role: "group", "aria-label": c.aria, id: c.id }, sw, hex);
  /** @param {string | number | undefined} v */
  const paintAcc = (v) => {
    const p = c.options.find((o) => o.v === v);
    for (const s of sw) s.setAttribute("aria-pressed", String(s.dataset.v === v));
    hex.value = p ? String(p.hex) : String(v);
  };
  /** @param {string} v */
  function pickAcc(v) {
    paintAcc(v);
    changed(D, { ...b, el }, v);
  }
  hex.addEventListener("change", () => {
    const v = hex.value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(v)) pickAcc(c.options.find((o) => o.hex === v)?.v ?? v);
    else paintAcc(D.vals[String(c.id)]);
  });
  paintAcc(c.value);
  el._setValue = paintAcc;
  return el;
}
