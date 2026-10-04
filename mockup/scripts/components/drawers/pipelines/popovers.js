// DSP pipelines drawer: the popovers its tabs share. The add-stage / add-input menu, and Import EQ (AutoEq search onto
// a pipeline, mirrored to the stereo pair's other side).

import { h } from "../../../lib/shell/dom.js";
import { popover } from "../../../lib/shell/popover.js";
import { placeBy, scale } from "../../../lib/shell/plate.js";
import { AUTOEQ } from "../../../data/stages/pipelines.js";
import { bandsToStages, replacePeq, searchHits } from "../../../../../hqptuner/static/model/gauges/eq.js";
import { paint, rebuild, stage } from "./state.js";

/** @typedef {import('../../../../../hqptuner/static/model/shell/pipelines.js').Pipe} Pipe */
/** @typedef {import('./state.js').Drawer} Drawer */
/** @typedef {import('./state.js').Ctx} Ctx */
/** @typedef {ReturnType<typeof popover>} Popover */
/** @typedef {import('../../../../../hqptuner/static/model/gauges/eq.js').Band} Band */
/** @typedef {{ name: string, src: string, bands: readonly Band[], pre: number }} Hit  one of AUTOEQ's hits */
/** @typedef {[string, () => void]} MenuRow  a menu row's label and what it does */

/** AUTOEQ's hits, their bands read as the [f, g, q, type?] tuples they are (the data literal widens them to arrays). */
const HITS = /** @type {readonly Hit[]} */ (/** @type {unknown} */ (AUTOEQ.hits));

/** @typedef {{ btn: HTMLElement, target: () => Pipe | null | undefined, ctx: Ctx }} ImpFor  the Import EQ open now */

/**
 * The drawer's popovers: the menu, and Import EQ with its search box, hits, mirror box and the press it is open for.
 *
 * @typedef {object} Pop
 * @property {HTMLElement} menu
 * @property {Popover} menuPop
 * @property {HTMLInputElement} q
 * @property {HTMLElement} hitsHost
 * @property {HTMLInputElement} mirror
 * @property {HTMLElement} impPanel
 * @property {Popover} impPop
 * @property {ImpFor | null} impFor
 */

/**
 * Build both popovers onto the plate, menu first, and keep them on the drawer state.
 *
 * @param {Drawer} dr
 */
export function mountPopovers(dr) {
  const menu = h("div.pop.pmenu", { role: "menu" });
  dr.plate.append(menu);
  const menuPop = popover({ trigger: h("button", { hidden: true }), panel: menu, inside: [] });
  const q = /** @type {HTMLInputElement} */ (
    h("input.vfd.pq", { type: "search", placeholder: AUTOEQ.placeholder, "aria-label": "Search AutoEq" })
  );
  const hitsHost = h("div.phits");
  const mirror = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", checked: true }));
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

/**
 * The popovers, mounted with the drawer (createPipelines).
 *
 * @param {Drawer} dr
 * @returns {Pop}
 */
const pops = (dr) => /** @type {Pop} */ (dr.pop);

/**
 * Hang `panel` under `btn`: its left edge on the button's, or its right edge on the button's.
 *
 * @param {Drawer} dr
 * @param {HTMLElement} panel
 * @param {HTMLElement} btn
 * @param {boolean} alignRight
 */
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

/**
 * The menu under `btn`: one row per [label, fn].
 *
 * @param {Drawer} dr
 * @param {HTMLElement} btn
 * @param {MenuRow[]} rows
 */
export function openMenu(dr, btn, rows) {
  const { menu, menuPop } = pops(dr);
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

/**
 * Import EQ under `btn` (a second press closes it), landing on `target()`.
 *
 * @param {Drawer} dr
 * @param {HTMLElement} btn
 * @param {() => Pipe | null | undefined} target
 * @param {Ctx} ctx
 */
export function openImport(dr, btn, target, ctx) {
  const P = pops(dr);
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

/**
 * The hits for the search box's query, one row each.
 *
 * @param {Drawer} dr
 */
function paintHits(dr) {
  const P = pops(dr);
  P.hitsHost.replaceChildren(
    ...searchHits(HITS, P.q.value).map((x) =>
      h(
        "button.pmrow",
        { type: "button", on: { click: () => applyEq(dr, x) } },
        h("b", { text: x.name }),
        h("span", { text: x.src }),
      ),
    ),
  );
}

/**
 * Land hit `x` on the Import EQ's target, and on the stereo pair's other side when mirrored.
 *
 * @param {Drawer} dr
 * @param {Hit} x
 */
function applyEq(dr, x) {
  const P = pops(dr);
  const imp = /** @type {ImpFor} */ (P.impFor); // set by openImport before any hit shows
  const eq = bandsToStages(x.bands);
  const cur = imp.target();
  if (!cur) return;
  const side = /** @type {number} */ (cur.ear); // a block row always names its ear
  const p = /** @type {Pipe} */ (cur.gen ? dr.ear[side] : cur); // a block row's EQ is its ear's, there while it is
  const target = [p];
  if (P.mirror.checked) {
    // the same profile onto the stereo pair's other side, when it exists
    const twin = cur.gen
      ? dr.ear[1 - side]
      : dr.pipes.find((o) => o !== p && o.src === (p.src ^ 1) && o.mix === (p.mix ^ 1));
    if (twin && p.src < 2 && p.mix < 2) target.push(twin);
  }
  for (const t of target) Object.assign(t, replacePeq(t, eq, x.pre));
  if (dr.block.kind !== "none") rebuild(dr, dr.block, true);
  P.impPop.close();
  stage(dr, imp.ctx);
  paint(dr);
}
