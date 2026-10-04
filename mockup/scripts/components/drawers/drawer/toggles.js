// The toggles control kind: (D, {c, r, paintOpt}) → its element.

import { h } from "../../../lib/shell/dom.js";
import { changed } from "./state.js";

const lit = (v) =>
  new Set(
    String(v || "")
      .split(",")
      .filter(Boolean),
  );

/** Independent toggles in seg dress: each button lights on its own (aria-pressed). Value = comma list of lit ones. */
export function togglesCtl(D, b) {
  const { c } = b;
  let cur = lit(c.value);
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
    for (const btn of el.children) {
      const on = cur.has(btn.dataset.v);
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
