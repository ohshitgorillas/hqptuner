// The option list a picker opens: the whole filter, modulator, dither or DSD processing list in place of a dropdown. A
// filter list fills a sheet risen from the plate's foot over the body; any other list opens as a panel parked at its
// picker, sized to its list. One list at a time (store/faceplate/view.js `openList`), refilled for whichever picker
// opens it. The head carries the list's name over its count, the narrowing console and ×; the body its columns. The
// console's popovers sit beside the sheet on the plate. A tap outside an open panel closes it, unless it lands on a
// popover or a picker. The sheet's height, the panel's parking and the outside tap are browser-only.

import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { html } from "../../../lib/dom.js";
import { parkAt } from "../../../model/shell/option-list.js";
import { schema } from "../../../store/schema.js";
import { plainNames } from "../../../store/ui/prefs.js";
import { openList, plate } from "../../../store/faceplate/view.js";
import { closeOptionList, hasConsole, isPanel, kindOf } from "../../../store/faceplate/lists/open.js";
import { listBlurbs, listOptions, narrowedOptions } from "../../../store/faceplate/lists/options.js";
import { originOf } from "../Popover.js";
import { Columns } from "./Columns.js";
import { Console } from "./Console.js";
import { FacetPopovers } from "./FacetPopover.js";

/** @typedef {import("../../../store/faceplate/view.js").ListRequest} ListRequest */

/** The title's tooltip for each filter list, as the drawers' rows sublabel them; a shaper's is its catalog sublabel. */
/** @type {Record<string, string>} */
const SUB = {
  pcm_filter_1x: "Sources up to 50 kHz",
  sdm_filter_1x: "Sources up to 50 kHz",
  pcm_filter_nx: "Sources above 50 kHz",
  sdm_filter_nx: "Sources above 50 kHz",
};

/**
 * An element's box on the plate, in the plate's layout px.
 *
 * @param {Element} el
 * @param {Element} face  the plate
 */
function onPlate(el, face) {
  const r = el.getBoundingClientRect(),
    p = face.getBoundingClientRect();
  const s = plate.value.scale;
  return { x: (r.left - p.left) / s, y: (r.top - p.top) / s };
}

/**
 * The element a panel parks at: the request's anchor where it names one, else the key's picker (`data-list` names the
 * key it opens).
 *
 * @param {Element} face  the plate
 * @param {ListRequest} req
 * @returns {HTMLElement | null}
 */
function triggerOf(face, req) {
  const at = req.anchor ? face.querySelector(`#${req.anchor}`) : null;
  return /** @type {HTMLElement | null} */ (at ?? face.querySelector(`[data-list="${req.key}"]`));
}

/**
 * Lay the open list out on the plate: a sheet from the body's top to the plate's foot, a panel parked at its trigger,
 * centered when the trigger is not showing. Both are placed in plate px and written from the corner of the box that
 * holds them.
 *
 * @param {HTMLElement | null} el
 * @param {ListRequest | null} req
 */
function place(el, req) {
  const face = el?.closest(".plate");
  if (!el || !face || !req) return;
  const o = originOf(el, face);
  if (!isPanel(kindOf(req.key))) {
    const b = /** @type {HTMLElement | null} */ (face.querySelector(".body"));
    const top = b?.offsetTop ?? 0;
    el.style.left = "";
    el.style.top = `${top - o.y}px`;
    el.style.height = `${face.clientHeight - top - 2}px`;
    return;
  }
  el.style.height = "auto";
  const tr = triggerOf(face, req);
  const fit = plate.value;
  const trigger = tr?.offsetParent ? { ...onPlate(tr, face), h: tr.offsetHeight } : null;
  const at = parkAt({ panel: { w: el.offsetWidth, h: el.offsetHeight }, trigger, plate: { w: fit.w, h: fit.h } });
  el.style.left = `${at.left - o.x}px`;
  el.style.top = `${at.top - o.y}px`;
}

/**
 * A tap anywhere while a panel is open: outside the list, a popover and every picker, it closes the panel.
 *
 * @param {MouseEvent} e
 */
function outside(e) {
  const req = openList.value;
  const t = e.target;
  if (!req || !isPanel(kindOf(req.key)) || !(t instanceof Element) || !t.isConnected) return;
  if (!t.closest(".osheet, [data-pop], [data-list]")) closeOptionList();
}

/** Follow the document's taps for as long as the list is mounted. */
function listen() {
  document.addEventListener("click", outside);
  return () => document.removeEventListener("click", outside);
}

/**
 * The open list's head: its name (its sublabel as the tooltip) over its count, the console where its kind has one, and
 * × on a sheet; a panel closes on a tap outside it.
 *
 * @param {ListRequest} req
 * @param {number} n
 * @param {number} total
 */
function head(req, n, total) {
  const entry = schema[req.key];
  const kind = kindOf(req.key);
  return html`
    <span class="ttl">
      <span class="t" title=${SUB[req.key] ?? entry.sublabel}>${entry.label}</span>
      <span class="tsub"><span class="ocount">${n} of ${total}</span></span>
    </span>
    ${hasConsole(kind) ? html`<${Console} kind=${kind} stage=${req.stage} />` : null}
    ${
      isPanel(kind)
        ? null
        : html`<button type="button" class="round dx" aria-label="Close list" data-testid="close-list" onClick=${closeOptionList}>×</button>`
    }
  `;
}

/**
 * What a list shows: its kind, how many options it lists, its head, its columns and its console's popovers; nothing
 * before any list has opened.
 *
 * @param {ListRequest | null} shown
 * @param {boolean} std  option style Standard
 */
function contents(shown, std) {
  if (!shown) return { kind: kindOf(""), n: 0, head: null, cols: null, pops: null };
  const kind = kindOf(shown.key);
  const full = listOptions(shown.key);
  const opts = narrowedOptions(shown.key, shown.stage, shown.value, shown.omit);
  const blurbs = listBlurbs(shown.key);
  return {
    kind,
    n: opts.length,
    head: head(shown, opts.length, full.length),
    cols: html`<${Columns} req=${shown} kind=${kind} std=${std} opts=${opts} full=${full} blurbs=${blurbs} />`,
    pops: html`<${FacetPopovers} kind=${kind} />`,
  };
}

/** The option list and its console's popovers, drawn from the open list request; closed, the last list it showed. */
export function OptionList() {
  const req = openList.value;
  const last = useRef(/** @type {ListRequest | null} */ (null));
  if (req) last.current = req;
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  const std = !plainNames.value;
  const view = contents(req ?? last.current, std);
  const fit = plate.value;
  useLayoutEffect(() => place(ref.current, req), [req, std, view.n, fit]);
  useEffect(listen, []);
  return html`
    <aside
      ref=${ref}
      class=${isPanel(view.kind) ? "sheet osheet opanel" : "sheet osheet"}
      role="dialog"
      aria-label="Options"
      data-testid="option-list"
      data-kind=${view.kind}
      data-style=${std ? "standard" : "simplified"}
      data-closed=${req ? undefined : ""}
    >
      <div class="shead">${view.head}</div>
      <div class="sbody2"><div class="ocols">${view.cols}</div></div>
    </aside>
    ${view.pops}
  `;
}
