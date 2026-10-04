// The narrowing console in an option list's head: one recessed strip of windows, one per facet of the list kind's
// console, each reading its facet's state in the list's own words (its default while idle, lit while it narrows) and
// opening its popover; Favorites is a plain switch. Reset clears this console's facets only, and holds its slot while
// hidden, so nothing in the strip moves. Each window is sized once to its longest state, in a layout effect, so the
// strip never changes width.

import { render } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { html } from "../../../lib/dom.js";
import { facetShown, stateKeys, summary } from "../../../model/shell/narrow-view.js";
import { facetsMoved, narrowState, resetFacets, setFacet } from "../../../store/faceplate/lists/facets.js";
import { triggerProps } from "../Popover.js";
import { CONSOLES, popId } from "./facets.js";
import { AMark } from "./Rows.js";

/** @typedef {import("./facets.js").BarFacet} BarFacet */
/** @typedef {import("../../../model/shell/narrow-view.js").Summary} Summary */
/** @typedef {import("../../../store/faceplate/lists/open.js").ListKind} ListKind */
/** @typedef {Record<string, unknown>} State */

/** What an idle chips, toggle or checks window reads; a segment window reads its first option. */
const IDLE = { chips: "Any", toggle: "Off", checks: "Off" };

/** The Apodizing window's two narrowing faces. */
const apodOnly = () => html`<${AMark} kind="full" /> only`;
const apodHalf = () => html`<${AMark} kind="full" /> + <${AMark} kind="half" />`;

/**
 * A narrowing facet's face: its apodizing marks, its picks' labels, a count of picks and the combine mode, a count of
 * rules, or On.
 *
 * @param {Summary} s
 */
function face(s) {
  if ("apod" in s) return s.apod === "only" ? apodOnly() : apodHalf();
  if ("labels" in s) return s.labels.join(" · ");
  if ("picks" in s) return `${s.picks} · ${s.mode.toUpperCase()}`;
  if ("rules" in s) return `${s.rules} rules`;
  return "On";
}

/**
 * An idle facet's face.
 *
 * @param {BarFacet} f
 */
const idle = (f) => (f.kind === "seg" ? String(f.rows?.[0]?.options[0]?.label ?? "") : IDLE[f.kind]);

/** Every face a window of each kind can show. @type {Record<BarFacet["kind"], (f: BarFacet) => unknown[]>} */
const FACES = {
  seg: (f) => (f.rows?.[0]?.options ?? []).map((o) => o.label),
  chips: (f) => {
    const opts = f.options ?? [];
    return [...opts.map((o) => o.label), `${opts.length} · AND`, `${opts.length} · OR`, IDLE.chips];
  },
  checks: (f) => {
    const items = f.items ?? [];
    return [...items.map((i) => i.tag), `${items.length} rules`, IDLE.checks];
  },
  toggle: () => ["On", IDLE.toggle],
};

/**
 * Every face a window can show, for sizing it once to the longest.
 *
 * @param {BarFacet} f
 * @returns {unknown[]}
 */
const faces = (f) => (f.apod ? [apodOnly(), apodHalf(), idle(f)] : FACES[f.kind](f));

/**
 * Size each shown window once to its longest face, measured on a hidden copy beside it.
 *
 * @param {HTMLElement | null} strip
 * @param {BarFacet[]} facets
 */
function fit(strip, facets) {
  if (!strip?.offsetParent) return;
  for (const b of [...strip.querySelectorAll("button")]) {
    const f = facets.find((x) => x.id === b.dataset.window);
    if (!f || b.dataset.sized || !b.offsetParent) continue;
    const probe = /** @type {HTMLElement} */ (b.cloneNode(true));
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    b.after(probe);
    const slot = probe.lastElementChild;
    let w = 0;
    if (slot) {
      slot.textContent = "";
      for (const shown of faces(f)) {
        render(html`${shown}`, slot);
        w = Math.max(w, probe.offsetWidth);
      }
      render(null, slot);
    }
    probe.remove();
    b.style.width = `${Math.ceil(w)}px`;
    b.dataset.sized = "1";
  }
}

/**
 * One facet's window.
 *
 * @param {BarFacet} f
 * @param {State} st
 * @param {"1x" | "nx"} stage
 */
function facetWindow(f, st, stage) {
  const s = summary(f, st, stage);
  const cls = s ? "fbtn on" : "fbtn";
  const inner = html`<span class="fl">${f.label}</span><span class="fv2">${s ? face(s) : idle(f)}</span>`;
  if (f.kind === "toggle") {
    const key = String(f.key);
    return html`
      <button
        type="button"
        class=${cls}
        data-window=${f.id}
        aria-pressed=${String(!!st[key])}
        title=${(f.hint ?? []).join(" ")}
        onClick=${() => setFacet(key, !st[key])}
      >
        ${inner}
      </button>
    `;
  }
  return html`
    <button type="button" class=${cls} data-window=${f.id} hidden=${!facetShown(f, stage)} ...${triggerProps(popId(f), "dialog")}>
      ${inner}
    </button>
  `;
}

/**
 * The console for the open list's kind, at its stage.
 *
 * @param {{ kind: ListKind, stage: "1x" | "nx" }} props
 */
export function Console({ kind, stage }) {
  const facets = CONSOLES[kind];
  const st = /** @type {State} */ (/** @type {unknown} */ (narrowState()));
  const keys = stateKeys(facets);
  const strip = useRef(/** @type {HTMLElement | null} */ (null));
  useLayoutEffect(() => fit(strip.current, facets));
  return html`
    <div class="fbar" role="group" aria-label="Narrow">
      <div class="fbc" key=${kind} ref=${strip} data-kind=${kind}>${facets.map((f) => facetWindow(f, st, stage))}</div>
      <button
        type="button"
        class=${facetsMoved(keys) ? "fbreset" : "fbreset idle"}
        data-testid="narrow-reset"
        onClick=${() => resetFacets(keys)}
      >
        Reset
      </button>
    </div>
  `;
}
