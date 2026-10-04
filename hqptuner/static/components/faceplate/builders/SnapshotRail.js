// The Snapshot builder's rail: each station a fold, one open at a time, the open one's page of snapshots with its pager,
// then New snapshot. Which station is open and which page each shows live in module-level signals; the rail opens on
// the loaded station.

import { signal } from "@preact/signals";
import { Fragment } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { html } from "../../../lib/dom.js";
import { NEW, keyOf } from "../../../model/builders/builder.js";
import { litEntry } from "../../../model/builders/snapshot.js";
import { paging, stepPage } from "../../../model/builders/pager.js";
import { classNames } from "../../../model/shell/format.js";
import { home, editNow } from "../../../store/faceplate/builders/snapshot.js";
import { railView } from "../../../store/faceplate/builders/rail.js";
import { cur, staged, go } from "../../../store/faceplate/builders/shell.js";

/** @typedef {import("../../../model/builders/builder.js").Ref} Ref */
/** @typedef {import("../../../model/builders/snapshot.js").Edit} Edit */
/** @typedef {import("../../../model/builders/snapshot.js").Fold} Fold */

/** The open station: undefined until a fold is tapped (the loaded station), null with every fold shut. */
const openSt = signal(/** @type {string | null | undefined} */ (undefined));
/** Each station's page shown. */
const pages = signal(/** @type {Map<string, number>} */ (new Map()));
/** The rail's measured height. */
const measured = signal(0);

/**
 * Show page `k` of station `st`.
 *
 * @param {string} st
 * @param {number} k
 */
function turnTo(st, k) {
  const next = new Map(pages.value);
  next.set(st, k);
  pages.value = next;
}

/**
 * One station's fold: chevron, name, rule, count; a tap opens it, or shuts it when it is the open one.
 *
 * @param {{ f: Fold }} props
 */
function FoldHead({ f }) {
  return html`
    <button
      type="button"
      class=${classNames("brh", f.loaded && "cur", f.dirty && "dirty")}
      aria-expanded=${String(f.open)}
      onClick=${() => {
        openSt.value = f.open ? null : f.name;
      }}
    >
      <span class="chv">${f.open ? "▾" : "▸"}</span>
      <span class="sn">${f.name}</span>
      <span class="ln"></span>
      <span class="cnt">${String(f.count)}</span>
    </button>
  `;
}

/**
 * One snapshot's line, lit with the edit.
 *
 * @param {{ c: Ref, e: Edit }} props
 */
function Entry({ c, e }) {
  const lit = litEntry(c, cur.value, e);
  return html`
    <button
      type="button"
      class=${classNames("st bst", lit && "open", staged.value.has(keyOf(c)) && "dirty")}
      aria-current=${String(lit)}
      title=${c.name}
      onClick=${() => go(c)}
    >
      <span class="n">${c.name}</span>
    </button>
  `;
}

/**
 * One station: its fold, its page of snapshots, the blank lines a short last page keeps, and its pager past one page.
 *
 * @param {{ f: Fold, e: Edit, per: number }} props
 */
function Station({ f, e, per }) {
  return html`
    <${FoldHead} f=${f} />
    ${f.items.map((name) => html`<${Entry} key=${name} c=${{ st: f.name, name }} e=${e} />`)}
    ${Array.from({ length: f.fill }, (_, i) => html`<div key=${`fill${i}`} class="bfill"></div>`)}
    ${f.open && html`<${PageStrip} st=${f.name} n=${f.count} per=${per} />`}
  `;
}

/**
 * The open station's page strip: ‹, one button per page with the shown one lit, ›; none while its list fits one page.
 *
 * @param {{ st: string, n: number, per: number }} props
 */
function PageStrip({ st, n, per }) {
  const p = paging(n, per, pages.value.get(st) ?? 0);
  if (p.pages < 2) return null;
  return html`
    <div class="opg bpg">
      <button type="button" class="round pbn" aria-label="Previous page" disabled=${!p.prev} onClick=${() => turnTo(st, stepPage(p.page, -1, p.pages))}>‹</button>
      ${Array.from(
        { length: p.pages },
        (_, k) => html`
          <button
            type="button"
            class=${k === p.page ? "opb on" : "opb"}
            aria-label=${`Page ${k + 1}`}
            aria-current=${String(k === p.page)}
            onClick=${() => turnTo(st, k)}
          >
            ${k + 1}
          </button>
        `,
      )}
      <button type="button" class="round pbn" aria-label="Next page" disabled=${!p.next} onClick=${() => turnTo(st, stepPage(p.page, 1, p.pages))}>›</button>
    </div>
  `;
}

/**
 * New snapshot's entry, in the loaded station.
 *
 * @param {{ e: Edit }} props
 */
function NewEntry({ e }) {
  /** @type {Ref} */
  const nw = { st: home(), name: NEW };
  return html`
    <button
      type="button"
      class=${classNames("st bst bnew", litEntry(nw, cur.value, e) && "open", staged.value.has(keyOf(nw)) && "dirty")}
      onClick=${() => go(nw)}
    >
      <span class="n"><span class="plus">+</span>New snapshot</span>
    </button>
  `;
}

/**
 * The rail: each station's fold, the open one's snapshots and pager, then New snapshot.
 * @param {{ height?: number }} props  the rail's height; measured in a layout effect when not given
 */
export function SnapshotRail({ height }) {
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  useLayoutEffect(() => {
    if (height === undefined && ref.current) measured.value = ref.current.clientHeight;
  });
  const open = openSt.value === undefined ? home() : openSt.value;
  const { per, folds } = railView(height ?? measured.value, { open, pages: pages.value });
  const e = editNow();
  return html`
    <nav class="rail brail" aria-label="Snapshots" ref=${ref}>
      ${folds.map((f) => html`<${Fragment} key=${f.name}><${Station} f=${f} e=${e} per=${per} /><//>`)}
      <${NewEntry} e=${e} />
    </nav>
  `;
}
