// DSP pipelines drawer: the popovers its tabs share. The add-stage / add-input menu, and Import EQ (AutoEq search onto
// a pipeline, mirrored to the stereo pair's other side).

import { h } from "../../lib/dom.js";
import { popover } from "../../lib/popover.js";
import { placeBy, scale } from "../../lib/plate.js";
import { AUTOEQ } from "../../data/pipelines.js";
import { bandsToStages, replacePeq, searchHits } from "../../model/eq.js";
import { paint, rebuild, stage } from "./state.js";

/** Build both popovers onto the plate, menu first, and keep them on the drawer state. */
export function mountPopovers(dr) {
  const menu = h("div.pop.pmenu", { role: "menu" });
  dr.plate.append(menu);
  const menuPop = popover({ trigger: h("button", { hidden: true }), panel: menu, inside: [] });
  const q = h("input.vfd.pq", { type: "search", placeholder: AUTOEQ.placeholder, "aria-label": "Search AutoEq" });
  const hitsHost = h("div.phits");
  const mirror = h("input", { type: "checkbox", checked: true });
  const impPanel = h(
    "div.pop.pimp",
    { role: "dialog", "aria-label": "Import EQ" },
    q,
    hitsHost,
    h(
      "div.pimpf",
      {},
      h("label.chk", {}, mirror, AUTOEQ.mirror),
      h("span.grow"),
      h("button.btn.xs", { type: "button", text: ".txt file…" }),
    ),
  );
  dr.plate.append(impPanel);
  const impPop = popover({ trigger: h("button", { hidden: true }), panel: impPanel, inside: [] });
  dr.pop = { menu, menuPop, q, hitsHost, mirror, impPanel, impPop, impFor: null }; // impFor: {btn, target: () => pipe, ctx}
  q.addEventListener("input", () => paintHits(dr));
}

function place(dr, panel, btn, alignRight) {
  const { left, top } = placeBy(panel, btn, { side: null, foot: null, at: { x: "start", y: "below", gap: 6 } });
  panel.style.top = `${top}px`;
  if (alignRight) {
    panel.style.left = "auto";
    panel.style.right = `${(dr.plate.getBoundingClientRect().right - btn.getBoundingClientRect().right) / scale()}px`;
  } else {
    panel.style.right = "auto";
    panel.style.left = `${left}px`;
  }
}

/** The menu under `btn`: one row per [label, fn]. */
export function openMenu(dr, btn, rows) {
  const { menu, menuPop } = dr.pop;
  menuPop.inside.length = 0;
  menuPop.inside.push(btn);
  place(dr, menu, btn, false);
  menu.replaceChildren(
    ...rows.map(([label, fn]) =>
      h("button.pmrow", {
        type: "button",
        role: "menuitem",
        text: label,
        on: {
          click: () => {
            menuPop.close();
            fn();
          },
        },
      }),
    ),
  );
  menuPop.open();
}

/** Import EQ under `btn` (a second press closes it), landing on `target()`. */
export function openImport(dr, btn, target, ctx) {
  const P = dr.pop;
  if (P.impPop.isOpen && P.impFor?.btn === btn) {
    P.impPop.close();
    return;
  }
  P.impFor = { btn, target, ctx };
  P.impPop.inside.length = 0;
  P.impPop.inside.push(btn);
  place(dr, P.impPanel, btn, true);
  paintHits(dr);
  P.impPop.open();
  P.q.focus();
}

function paintHits(dr) {
  const P = dr.pop;
  P.hitsHost.replaceChildren(
    ...searchHits(AUTOEQ.hits, P.q.value).map((x) =>
      h(
        "button.pmrow",
        { type: "button", on: { click: () => applyEq(dr, x) } },
        h("b", { text: x.name }),
        h("span", { text: x.src }),
      ),
    ),
  );
}

function applyEq(dr, x) {
  const P = dr.pop;
  const eq = bandsToStages(x.bands);
  const cur = P.impFor.target();
  if (!cur) return;
  const p = cur.gen ? dr.ear[cur.ear] : cur; // a block row's EQ is its ear's
  const target = [p];
  if (P.mirror.checked) {
    // the same profile onto the stereo pair's other side, when it exists
    const twin = cur.gen
      ? dr.ear[1 - cur.ear]
      : dr.pipes.find((o) => o !== p && o.src === (p.src ^ 1) && o.mix === (p.mix ^ 1));
    if (twin && p.src < 2 && p.mix < 2) target.push(twin);
  }
  for (const t of target) Object.assign(t, replacePeq(t, eq, x.pre));
  if (dr.block.kind !== "none") rebuild(dr, dr.block, true);
  P.impPop.close();
  stage(dr, P.impFor.ctx);
  paint(dr);
}
