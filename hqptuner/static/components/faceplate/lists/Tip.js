// The hover tip beside an option list's row, a plate-level card over the list: the raw engine name while Simplified has
// replaced it on the row, the option's manual prose, its facet rows in the console's own words, and its chips. It lands
// beside the row's column, right of it when there is room, in a layout effect (browser-only).

import { useLayoutEffect, useRef } from "preact/hooks";
import { html } from "../../../lib/dom.js";
import { tipAt, tipContent } from "../../../model/shell/option-list.js";
import { plainNames } from "../../../store/ui/prefs.js";
import { openList, plate } from "../../../store/faceplate/view.js";
import { hoverTip } from "../../../store/faceplate/lists/open.js";
import { listOptions } from "../../../store/faceplate/lists/options.js";
import { FACET_LABELS } from "./facets.js";

/**
 * Land the tip beside the row it describes.
 *
 * @param {HTMLElement | null} tip
 * @param {string | null} v  the row's engine name
 */
function land(tip, v) {
  const face = tip?.closest(".plate");
  if (!tip || !face || v === null || tip.hidden) return;
  const row = /** @type {HTMLElement[]} */ ([...face.querySelectorAll(".orow")]).find((r) => r.dataset.v === v);
  if (!row) return;
  const col = /** @type {HTMLElement} */ (row.closest(".ocol") ?? row);
  const fit = plate.value;
  const p = face.getBoundingClientRect();
  const at = tipAt({
    col: { x: (col.getBoundingClientRect().left - p.left) / fit.scale, w: col.offsetWidth },
    rowY: (row.getBoundingClientRect().top - p.top) / fit.scale,
    tip: { w: tip.offsetWidth, h: tip.offsetHeight },
    plate: { w: fit.w, h: fit.h },
  });
  tip.style.left = `${at.left}px`;
  tip.style.top = `${at.top}px`;
}

/** The tip for the row under the pointer of the open list, hidden while there is none. */
export function ListTip() {
  const req = openList.value;
  const v = hoverTip.value;
  const std = !plainNames.value;
  const o = req && v !== null ? listOptions(req.key).find((x) => x.v === v) : undefined;
  const c = o ? tipContent(o, std, FACET_LABELS) : null;
  const fit = plate.value;
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  useLayoutEffect(() => land(ref.current, v), [req, v, std, fit]);
  return html`
    <div ref=${ref} class="otip" role="tooltip" data-testid="option-tip" hidden=${!c}>${c ? parts(c) : null}</div>
  `;
}

/**
 * The tip's parts: the name, the prose, the facet rows and the chips, each only where it has something to say.
 *
 * @param {ReturnType<typeof tipContent>} c
 */
function parts(c) {
  return html`
    ${c.name ? html`<div class="tn" data-testid="tip-name">${c.name}</div>` : null}
    ${c.text ? html`<div class="td" data-testid="tip-text">${c.text}</div>` : null}
    ${
      c.rows.length
        ? html`<div class="tr">
          ${c.rows.map(([k, val]) => html`<span class="tk">${k}</span><span class="tv">${val}</span>`)}
        </div>`
        : null
    }
    ${c.chips.length ? html`<div class="tc">${c.chips.map((x) => html`<span>${x}</span>`)}</div>` : null}
  `;
}
