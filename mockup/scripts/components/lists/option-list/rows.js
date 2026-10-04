// Option lists, rows: one option's row (name, marks, heart; hover tip, tap to pick) and the key to the filter rows' marks.

import { h } from "../../../lib/shell/dom.js";
import { isFav, toggleFav, kindOf } from "../../../lib/narrowing/narrow.js";
import { optionStyle } from "../vselect.js";
import { apodMark } from "../../../lib/controls/apod.js";
import { showTip, hideTip } from "./tip.js";

/** @typedef {import('../option-list.js').ListUi} ListUi */
/** @typedef {import('../option-list.js').ListRequest} ListRequest */
/** @typedef {import('../../../../../hqptuner/static/model/shell/option-list.js').Opt} Opt */
/** @typedef {import('../../../lib/narrowing/narrow.js').Kind} Kind */

/**
 * The open list (rows are only built while one is open).
 *
 * @param {ListUi} ui
 */
export const cur = (ui) => /** @type {ListRequest} */ (ui.cur);

/**
 * A row's marks for its list kind: the apodizing mark and the quality stars (filters), the rate floor badge (modulators).
 *
 * @param {Kind} kind
 * @param {Opt} o
 */
function marks(kind, o) {
  const q = o.f?.q;
  if (kind === "filters")
    return [
      h("span.mk", {}, apodMark(o.f?.apod)),
      h("span.qst", { aria: { label: q ? `Quality ${q}/5` : null }, text: q ? "★".repeat(q) : "" }),
    ];
  return (
    kind === "modulators" &&
    h(
      "span.mk",
      {},
      o.tier &&
        h("span.otier", { role: "img", aria: { label: `Needs DSD${o.tier.slice(0, -1)} or higher` }, text: o.tier }),
    )
  );
}

/**
 * A row's heart: favorite / unfavorite, without picking the row.
 *
 * @param {ListUi} ui
 * @param {Opt} o
 * @param {boolean} fav
 */
const heart = (ui, o, fav) =>
  h("button.fav", {
    type: "button",
    class: fav && "on",
    aria: { pressed: fav, label: `${fav ? "Unfavorite" : "Favorite"} ${o.v}` },
    text: fav ? "♥" : "♡",
    on: {
      click: (e) => {
        e.stopPropagation();
        toggleFav(cur(ui).list, o.v);
      },
    },
  });

/**
 * Pick an option: the tip hides, the picker hears it, the list closes.
 *
 * @param {ListUi} ui
 * @param {string} v
 */
function pick(ui, v) {
  hideTip(ui);
  const open = cur(ui);
  open.value = v;
  open.onPick?.(v);
  ui.sh.close();
}

/**
 * One option's row: its name, its marks, its heart; hover or focus shows its tip, a tap picks it.
 *
 * @param {ListUi} ui
 * @param {Opt} o
 */
export function row(ui, o) {
  const open = cur(ui);
  const on = String(o.v) === String(open.value);
  const kind = kindOf(open.list);
  const fav = isFav(open.list, o.v);
  /** @param {Event} e */
  const rowOf = (e) => /** @type {HTMLElement} */ (e.currentTarget);
  return h(
    "div.orow",
    {
      role: "option",
      tabindex: -1,
      data: { v: o.v },
      aria: { selected: on },
      on: {
        click: () => pick(ui, o.v),
        pointerenter: (/** @type {PointerEvent} */ e) => e.pointerType !== "touch" && showTip(ui, o, rowOf(e)),
        pointerleave: (e) => hideTip(ui, rowOf(e)),
        focus: (e) => showTip(ui, o, rowOf(e)),
        blur: (e) => hideTip(ui, rowOf(e)),
      },
    },
    h("span.nm", { text: optionStyle() === "standard" ? o.v : o.leaf }), // Visual settings → Option style
    marks(kind, o),
    kind !== "dithers" && heart(ui, o, fav),
  );
}

/**
 * Key to the filter rows' marks, under the Polyphase sinc family: v1's `glyph = word` legend grammar (Combobox
 * `✓ = recommended`), words from v1's own labels for each mark (apod.js APOD_LABEL, the Quality facet, Favorite).
 */
export const legend = () =>
  h(
    "div.olegend",
    { role: "presentation" },
    h("span", {}, apodMark("full"), " = Apodizing"),
    h("span", {}, apodMark("half"), " = Half apodizing"),
    h("span", {}, h("span.lq", { text: "★" }), " = Quality"),
    h("span", {}, h("span.lf", { text: "♥" }), " = Favorite"),
  );
