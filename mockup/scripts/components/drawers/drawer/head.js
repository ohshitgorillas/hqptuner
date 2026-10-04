// The drawer's frame: its tab strip and panels, the head (title, tabs, corner, close), the second mount's id prefix,
// and picking a tab.

import { h } from "../../../lib/shell/dom.js";
import { item } from "./rows.js";
import { paintApply } from "./state.js";

/** @typedef {import("./state.js").Drawer} Drawer */
/** @typedef {import("./state.js").Tab} Tab */

/**
 * @param {Drawer} D
 * @param {string} t
 */
const tabId = (D, t) => `${D.schema.id}-tab-${t}`;
/**
 * @param {Drawer} D
 * @param {string} t
 */
const panelId = (D, t) => `${D.schema.id}-p-${t}`;

/**
 * One tab button per part of the stage; the first starts selected.
 *
 * @param {Drawer} D
 * @returns {HTMLElement[]}
 */
export function tabStrip(D) {
  return D.schema.tabs.map((t, i) =>
    h(
      "button",
      {
        type: "button",
        role: "tab",
        id: tabId(D, t.id),
        aria: { controls: panelId(D, t.id), selected: i === 0 },
        data: { tab: t.id },
        on: { click: () => showTab(D, t.id) },
      },
      t.label,
    ),
  );
}

/**
 * One panel per tab, built from the tab's body items; only the first shows. A single part is no tabpanel.
 *
 * @param {Drawer} D
 * @returns {HTMLElement[]}
 */
export function tabPanels(D) {
  return D.schema.tabs.map((t, i) =>
    h(
      "div.dpanel",
      {
        role: D.tabs.length === 1 ? null : "tabpanel",
        id: panelId(D, t.id),
        aria: { labelledby: D.tabs.length === 1 ? null : tabId(D, t.id) },
        data: { tab: t.id },
        hidden: i > 0,
      },
      t.body.map((it) => item(D, it)),
    ),
  );
}

/**
 * The drawer element, born closed (nothing wipes at page load): head (title, tab strip, corner, close) over the panels.
 * A single-part stage gets no tab strip; its dirty dot moves to the title.
 *
 * @param {Drawer} D
 * @param {Element} corner
 * @param {HTMLElement} close
 * @returns {HTMLElement}
 */
export function drawerShell(D, corner, close) {
  const { schema } = D;
  return h(
    `aside.drawer#drawer-${schema.id}`,
    { "aria-label": schema.aria, class: D.backend === "combo" && "combo", "data-closed": "" },
    h(
      "div.dhead",
      {},
      D.title,
      !D.single && h("div.seg.dtabs", { role: "tablist", "aria-label": schema.aria }, D.tabs),
      h("span.grow"),
      corner,
      close,
    ),
    D.panels,
  );
}

/**
 * Second mount: every id (and every reference to one) gets the prefix.
 *
 * @param {HTMLElement} drawer
 * @param {string} prefix
 */
export function prefixIds(drawer, prefix) {
  for (const el of [drawer, ...drawer.querySelectorAll("[id]")]) el.id = prefix + el.id;
  for (const a of ["aria-controls", "aria-labelledby"])
    for (const el of drawer.querySelectorAll(`[${a}]`)) el.setAttribute(a, prefix + el.getAttribute(a));
}

/**
 * Show tab t: its button reads selected, its panel shows, and the apply group follows the tab's restart lane.
 *
 * @param {Drawer} D
 * @param {string} t
 */
export function showTab(D, t) {
  D.tabs.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  D.panels.forEach((p) => {
    p.hidden = p.dataset.tab !== t;
  });
  D.curTab = /** @type {Tab} */ (D.schema.tabs.find((x) => x.id === t));
  paintApply(D);
}
