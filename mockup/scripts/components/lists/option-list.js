// Option lists: the whole filter / modulator / dither list, instead of a native dropdown. Filters fill a bottom sheet
// (lib/sheet.js) over the body; modulators and dithers open as a panel parked at the picker that opened them (PANEL: sized
// to its list, below the picker or above it, inside the plate; an outside tap, ×, Escape or a pick closes it). Same head,
// rows and narrowing in both forms. One sheet, re-filled for whichever list a picker opens. Narrowing is built in: the facet
// bar along its head (narrow-filters.js mountFacetBar).
//
// Placement is custom per list, not a general packing rule: PLACE in option-list/columns.js. Filters: Polyphase sinc over
// two columns when it needs them (split in list order at the balance point, variants whole), Pure sinc its own column
// (PCM's Misc family under it, then Analog-style under its own `Other` title), then Conventional and Interpolation together
// under `Other`.
// Option style Standard (Visual settings) drops the outline: one flat list in the engine's own order (v1: options 1:1),
// filled down a fixed number of columns (STD_COLS) and reflowed as narrowing thins it; no headers, blurbs, folds or
// column titles. Rows, marks, legend, facet bar and hover tip are the same in both styles.
// The outline is v1's Simplified dropdown: family header (`<Family> family`, the page's section grammar) and its blurb under
// it, variant subheader and its blurb under it, then the rows. Variants fold (v1: the header is the toggle); families don't
//.
// Rows: name (one line) | apodizing mark (v1's circled A / ½) | quality stars (v1: one ★ per point) | heart (♡ / ♥, v1).
// Filters: a key to those marks sits under the Polyphase sinc family (legend()).
// Modulators: name | rate floor badge | heart. Dithers: name.

import { h } from "../../lib/shell/dom.js";
import { sheet } from "../../lib/shell/sheet.js";
import { closeBtn } from "../../lib/controls/controls.js";
import { subscribe, kindOf } from "../../lib/narrowing/narrow.js";
import { mountFacetBar } from "./narrow-filters.js";
import { optionStyle } from "./vselect.js";
import { PLATFORM } from "../../../../hqptuner/static/lib/clock.js";
import { PANEL, dacFolds, render } from "./option-list/columns.js";
import { hideTip } from "./option-list/tip.js";

/** @typedef {import('../../../../hqptuner/static/model/shell/option-list.js').Opt} Opt */
/**
 * The list a picker opens: its picker (a panel parks at it; a second tap on it closes the panel), the list, stage and
 * value, the chain and field it picks for, the pick's callback, the sheet's title and its tooltip, and the chain's name.
 *
 * @typedef {object} ListRequest
 * @property {HTMLElement} [trigger]
 * @property {import('./vselect.js').ListName} list
 * @property {string} stage
 * @property {string} [chain]
 * @property {string} [field]
 * @property {string} value
 * @property {(v: string) => void} [onPick]
 * @property {string} title
 * @property {string} [sub]
 * @property {string} [band]
 */
/**
 * One mounted option list, shared by the helpers here and in option-list/columns.js and option-list/tip.js.
 *
 * @typedef {object} ListUi
 * @property {import('../../lib/shell/sheet.js').Sheet} sh
 * @property {HTMLElement} t       the title
 * @property {HTMLElement} n       its count
 * @property {ReturnType<typeof mountFacetBar>} bar
 * @property {HTMLElement} cols    the columns' host
 * @property {HTMLElement} tip     the plate-level hover tip
 * @property {ListRequest | null} cur      the open list
 * @property {HTMLElement | null} tipRow   the row the tip shows
 * @property {Opt | null} tipOpt           the option the tip shows
 */

/**
 * The option list: one sheet (filters) or panel (modulators, dithers), re-filled for whichever list a picker opens.
 *
 * @param {HTMLElement} plate
 * @param {import('../../lib/shell/bus.js').Bus} bus   folds follow `dactype`; the open list re-renders on `relayout`
 * @param {import('../../../../hqptuner/static/lib/clock.js').Clock} [clock]
 */
export function mountOptionList(plate, bus, clock = PLATFORM) {
  const ui = chrome(plate);
  bus.on("dactype", (d) => {
    dacFolds(d);
    render(ui);
  });
  ui.sh.onClose = () => hideTip(ui);
  // A panel closes on a tap outside it (its picker toggles it; facet popovers and notes opened from it count as inside).
  document.addEventListener("click", (e) => outside(ui, e));
  subscribe(() => render(ui));
  bus.on("relayout", () => clock.requestAnimationFrame(() => render(ui)));
  return {
    /** @param {ListRequest} o */
    open: (o) => open(ui, o),
    close: () => ui.sh.close(),
    sheet: ui.sh,
  };
}

/**
 * The one sheet, its head (title over its count, facet bar, ×), the columns' host and the plate-level tip; `cur` is the
 * open list ({list, stage, value, onPick, title}), `tipRow` / `tipOpt` the row and option the tip shows.
 *
 * @param {HTMLElement} plate
 * @returns {ListUi}
 */
function chrome(plate) {
  const sh = sheet(plate, { id: "osheet", aria: "Options", cls: "osheet" });
  const t = h("span.t"),
    n = h("span.ocount");
  const bar = mountFacetBar(plate);
  // Title over its count (two lines: the facet bar gets the width). No chain tag: the list is the running chain's.
  sh.head.append(
    h("span.ttl", {}, t, h("span.tsub", {}, n)),
    bar.el,
    closeBtn(() => sh.close(), "Close list"),
  );
  const cols = h("div.ocols");
  sh.body.append(cols);
  const tip = h("div.otip", { role: "tooltip", hidden: true });
  plate.append(tip);
  return { sh, t, n, bar, cols, tip, cur: null, tipRow: null, tipOpt: null };
}

/**
 * @param {ListUi} ui
 * @param {ListRequest} o
 */
function open(ui, o) {
  const { sh, bar } = ui;
  const kind0 = kindOf(o.list);
  // A panel's picker toggles it: a second tap on the same picker closes it.
  if (sh.isOpen && PANEL.has(kind0) && ui.cur?.trigger && ui.cur.trigger === o.trigger) {
    sh.close();
    return;
  }
  ui.cur = o;
  ui.t.textContent = o.title;
  ui.t.title = o.sub || "";
  const kind = kindOf(o.list);
  bar.show(kind, o.stage);
  sh.el.dataset.kind = kind;
  sh.el.dataset.style = optionStyle();
  sh.el.classList.toggle("opanel", PANEL.has(kind));
  sh.open();
  if (PANEL.has(kind)) sh.el.style.height = "auto";
  else sh.el.style.left = ""; // the sheet: sheet.js sets top / height
  bar.fit();
  render(ui);
}

/**
 * @param {ListUi} ui
 * @param {MouseEvent} e
 */
function outside(ui, e) {
  const { sh } = ui;
  const target = /** @type {Element} */ (e.target);
  if (!sh.isOpen || !sh.el.classList.contains("opanel") || !target.isConnected) return;
  if (sh.el.contains(target) || ui.cur?.trigger?.contains(target) || target.closest(".pop")) return;
  hideTip(ui);
  sh.close();
}
