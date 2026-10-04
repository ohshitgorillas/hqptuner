// The toggles control kind: (D, {c, r, paintOpt}) → its element.

import { h } from "../../../lib/shell/dom.js";
import { changed } from "./state.js";

/** @typedef {import("./state.js").Drawer} Drawer */
/** @typedef {import("./state.js").Ctl} Ctl */
/** @typedef {import("./state.js").Listed} Listed */
/** @typedef {import("./state.js").SettableEl} SettableEl */

/** @param {string | number | undefined} v */
const lit = (v) =>
  new Set(
    String(v || "")
      .split(",")
      .filter(Boolean),
  );

/**
 * Independent toggles in seg dress: each button lights on its own (aria-pressed). Value = comma list of lit ones.
 *
 * @param {Drawer} D
 * @param {Ctl} b
 * @returns {SettableEl}
 */
export function togglesCtl(D, b) {
  const c = /** @type {Listed} */ (b.c);
  let cur = lit(c.value);
  /** @type {SettableEl} */
  const el = h(
    "div.seg.tgl",
    { role: "group", "aria-label": c.aria, id: c.id },
    c.options.map((o) =>
      h("button", {
        type: "button",
        data: { v: o.v },
        text: o.label,
        on: {
          click: () => {
            if (cur.has(o.v)) cur.delete(o.v);
            else cur.add(o.v);
            paint();
            changed(D, { ...b, el }, [...cur].join(","));
          },
        },
      }),
    ),
  );
  const paint = () => {
    for (const btn of /** @type {HTMLCollectionOf<HTMLElement>} */ (el.children)) {
      const on = cur.has(/** @type {string} */ (btn.dataset.v));
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", String(on));
    }
  };
  paint();
  el._setValue = (v) => {
    cur = lit(v);
    paint();
  };
  return el;
}
