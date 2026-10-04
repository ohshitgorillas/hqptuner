// ── Hover tip (v1 components/controls/Combobox.js TipPop + narrowbar/facettip.js) ─────────────────────────────────
// The card beside a hovered row: the raw engine name while Simplified display hides it, the option's manual prose (v1
// prose.js: Simplified keeps description + notes; Standard adds the two-stage notes), then the facet rows in the narrowing
// bar's own words and the boolean chips. Modulators add their Generation row. Labels come from the facet bar so the tip and
// the chips never disagree on a spelling (v1 rule). What it says and where it lands: model/option-list.js.

import { h } from "../../../lib/shell/dom.js";
import { optionStyle } from "../vselect.js";
import { toPlate, PLATE_W, PLATE_H } from "../../../lib/shell/plate.js";
import { BAR } from "../../../data/lists/narrow-facets.js";
import { tipContent, tipAt } from "../../../../../hqptuner/static/model/shell/option-list.js";

/** @typedef {import('../option-list.js').ListUi} ListUi */
/** @typedef {import('../../../../../hqptuner/static/model/shell/option-list.js').Opt} Opt */

/** @type {import('../../../../../hqptuner/static/model/shell/narrow-view.js').Facet[]} */
const FACETS = BAR.flat();
/** @type {import('../../../../../hqptuner/static/model/shell/option-list.js').Labels} */
const FACET = Object.fromEntries(
  FACETS.flatMap((f) =>
    f.options ? [[String(f.key), Object.fromEntries(f.options.map((o) => [String(o.v), o.label]))]] : [],
  ),
);

/**
 * Fill the tip for option `o` and land it beside its row.
 *
 * @param {ListUi} ui
 * @param {Opt} o
 * @param {HTMLElement} rowEl
 */
export function showTip(ui, o, rowEl) {
  const tip = ui.tip;
  ui.tipOpt = o;
  const c = tipContent(o, optionStyle() === "standard", FACET);
  const parts = /** @type {HTMLDivElement[]} */ (
    [
      c.name !== null && h("div.tn", { text: c.name }),
      c.text && h("div.td", { text: c.text }),
      c.rows.length &&
        h(
          "div.tr",
          {},
          c.rows.map(([k, v]) => [h("span.tk", { text: k }), h("span.tv", { text: v })]),
        ),
      c.chips.length &&
        h(
          "div.tc",
          {},
          c.chips.map((x) => h("span", { text: x })),
        ),
    ].filter(Boolean)
  );
  tip.replaceChildren(...parts);
  tip.hidden = false;
  ui.tipRow = rowEl;
  const col = /** @type {HTMLElement} */ (rowEl.closest(".ocol") || rowEl);
  const at = tipAt({
    col: { x: toPlate(col.getBoundingClientRect()).x, w: col.offsetWidth },
    rowY: toPlate(rowEl.getBoundingClientRect()).y,
    tip: { w: tip.offsetWidth, h: tip.offsetHeight },
    plate: { w: PLATE_W, h: PLATE_H },
  });
  tip.style.left = `${at.left}px`;
  tip.style.top = `${at.top}px`;
}

/**
 * Hide the tip: always with no row, else only when it shows that row.
 *
 * @param {ListUi} ui
 * @param {Element} [rowEl]
 */
export function hideTip(ui, rowEl) {
  if (!rowEl || rowEl === ui.tipRow) {
    ui.tip.hidden = true;
    ui.tipRow = null;
    ui.tipOpt = null;
  }
}
