// The DSP pipelines drawer's small parts: segment buttons, a number box that commits on change, a field label, a
// manual line and paragraphs, a menu under its trigger, and the list's numbered page buttons.

import { useRef } from "preact/hooks";
import { html } from "../../../../lib/dom.js";
import { paging, stepPage } from "../../../../model/builders/pager.js";
import { openPopover } from "../../../../store/faceplate/view.js";
import { Popover, parkAt, triggerProps } from "../../Popover.js";

/** @typedef {{ currentTarget: { value: string } }} ChangeEv */
/** @typedef {{ v: string, label: string }} SegOption */
/** @typedef {[string, () => void]} MenuRow  a menu row's label and what it does */

/**
 * Segment buttons, `value` lit; tapping another option hands it to `onChange`.
 *
 * @param {{ aria: string, cls: string, value: string, options: SegOption[], onChange: (v: string) => void, off?: boolean }} p
 */
export function Seg({ aria, cls, value, options, onChange, off = false }) {
  return html`
    <div class=${`seg ${cls}`} role="radiogroup" aria-label=${aria}>
      ${options.map(
        (o) => html`
          <button
            type="button"
            class=${o.v === value ? "on" : undefined}
            data-v=${o.v}
            disabled=${off}
            onClick=${() => (o.v === value ? undefined : onChange(o.v))}
          >
            ${o.label}
          </button>
        `,
      )}
    </div>
  `;
}

/**
 * A number box that commits on change.
 *
 * @param {{ value: number | undefined, aria: string, onCommit: (v: number) => void, width?: number, off?: boolean,
 *   testid?: string }} p
 */
export function NumBox({ value, aria, onCommit, width, off = false, testid }) {
  return html`
    <input
      class="vfd"
      type="number"
      value=${value ?? ""}
      step="any"
      aria-label=${aria}
      data-testid=${testid}
      style=${width ? `width:${width}px` : undefined}
      disabled=${off}
      onChange=${(/** @type {ChangeEv} */ e) => onCommit(Number(e.currentTarget.value))}
    />
  `;
}

/**
 * A field's label.
 *
 * @param {string} t
 */
export const lab = (t) => html`<span class="cl pdl">${t}</span>`;

/**
 * A manual line: its wire code, then what it means.
 *
 * @param {string} code
 * @param {string} text
 */
export const tline = (code, text) => html`<p class="ptl"><code>${code}</code> ${text}</p>`;

/**
 * The manual's paragraphs, the empty ones dropped.
 *
 * @param {...string} xs
 */
export const paras = (...xs) => xs.filter(Boolean).map((x) => html`<p class="pmp">${x}</p>`);

/** @typedef {{ currentTarget: HTMLInputElement }} FileEv */

/**
 * A key that picks files and hands them over.
 *
 * @param {{ label: string, accept: string, multiple?: boolean, off?: boolean, onFiles: (files: File[]) => void }} p
 */
export function FileKey({ label, accept, multiple = false, off = false, onFiles }) {
  const input = useRef(/** @type {HTMLInputElement | null} */ (null));
  const picked = (/** @type {FileEv} */ e) => {
    const files = [...(e.currentTarget.files || [])];
    e.currentTarget.value = "";
    if (files.length) onFiles(files);
  };
  return html`
    <button type="button" class="btn xs" disabled=${off} onClick=${() => input.current?.click()}>${label}</button>
    <input ref=${input} type="file" accept=${accept} multiple=${multiple} hidden onChange=${picked} />
  `;
}

/** Drops 6 px under its trigger, kept off the plate's edges by the plate's side padding. */
/** @type {{ side: import("../../../../model/shell/place.js").Side, foot: null, at: import("../../../../model/shell/place.js").Place }} */
const HOW = { side: 22, foot: null, at: { x: "start", y: "below", gap: 6 } };

/**
 * Park a panel under its trigger.
 *
 * @param {HTMLElement} panel
 */
export function park(panel) {
  const at = parkAt(panel, HOW);
  if (at) {
    panel.style.left = `${Math.round(at.left)}px`;
    panel.style.top = `${Math.round(at.top)}px`;
  }
}

/**
 * A `+` key and the menu it opens: one row per [label, fn], a pick closing the menu.
 *
 * @param {{ id: string, aria: string, rows: MenuRow[], off?: boolean }} p
 */
export function Menu({ id, aria, rows, off = false }) {
  return html`
    <button type="button" class="chip add" aria-label=${aria} disabled=${off} ...${triggerProps(id, "menu")}>+</button>
    <${Popover} id=${id} cls="pmenu" role="menu" label=${aria} park=${park}>
      ${rows.map(
        ([label, fn]) => html`
          <button
            type="button"
            class="pmrow"
            role="menuitem"
            onClick=${() => {
              openPopover.value = null;
              fn();
            }}
          >
            ${label}
          </button>
        `,
      )}
    <//>
  `;
}

/**
 * Numbered page buttons: ‹, one per page with the shown one lit, ›, then the range shown; none while the list fits one
 * page.
 *
 * @param {{ n: number, per: number, page: number, go: (k: number) => void, off?: boolean }} p
 */
export function Pager({ n, per, page, go, off = false }) {
  const p = paging(n, per, page);
  if (p.pages < 2) return null;
  return html`
    <span class="cl">Page</span>
    <button type="button" class="round pbn" aria-label="Previous page" disabled=${off || !p.prev} onClick=${() => go(stepPage(p.page, -1, p.pages))}>‹</button>
    ${Array.from(
      { length: p.pages },
      (_, k) => html`
        <button
          type="button"
          class=${k === p.page ? "opb on" : "opb"}
          aria-label=${`Page ${k + 1}`}
          aria-current=${String(k === p.page)}
          disabled=${off}
          onClick=${() => go(k)}
        >
          ${k + 1}
        </button>
      `,
    )}
    <button type="button" class="round pbn" aria-label="Next page" disabled=${off || !p.next} onClick=${() => go(stepPage(p.page, 1, p.pages))}>›</button>
    <span class="opr">${p.start + 1}–${p.end} of ${n}</span>
  `;
}
