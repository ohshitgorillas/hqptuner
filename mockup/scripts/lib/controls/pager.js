// Numbered page buttons (the DSP pipelines list's, the Snapshot builder rail's): ‹, one button per page with the shown
// one lit, ›. The decisions are model/pager.js; this only draws them.

import { h } from "../shell/dom.js";
import { paging, stepPage } from "../../model/builders/pager.js";

/**
 * Whether a pager slot holds a node (the `count` slots are falsy without it).
 *
 * @param {HTMLElement | false | undefined} x
 * @returns {x is HTMLElement}
 */
const isNode = (x) => Boolean(x);

/**
 * The pager's nodes; none while the list fits one page. `count` adds the `Page` label ahead and the shown range after.
 * @param {{n: number, per: number, page: number, go: (k: number) => void, count?: boolean}} o  go hears the page picked
 * @returns {HTMLElement[]}
 */
export function pageButtons({ n, per, page, go, count }) {
  const p = paging(n, per, page);
  if (p.pages < 2) return [];
  return [
    count && h("span.cl", { text: "Page" }),
    h("button.round.pbn", {
      type: "button",
      text: "‹",
      "aria-label": "Previous page",
      disabled: !p.prev,
      on: { click: () => go(stepPage(p.page, -1, p.pages)) },
    }),
    Array.from({ length: p.pages }, (_, k) =>
      h("button.opb", {
        type: "button",
        class: k === p.page && "on",
        text: String(k + 1),
        "aria-label": `Page ${k + 1}`,
        "aria-current": String(k === p.page),
        on: { click: () => go(k) },
      }),
    ),
    h("button.round.pbn", {
      type: "button",
      text: "›",
      "aria-label": "Next page",
      disabled: !p.next,
      on: { click: () => go(stepPage(p.page, 1, p.pages)) },
    }),
    count && h("span.opr", { text: `${p.start + 1}–${p.end} of ${n}` }),
  ]
    .flat()
    .filter(isNode);
}
