// Controls the matrix-family drawer blocks share (Loudness, Crossfeed): segment buttons, a number box, a manual
// paragraph led by its setting's label, and the hook that measures a drawing's box so it draws 1:1 at its size. Class
// names are the drawer stylesheet's (css/v2/drawer.css, matrix.css).

import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { html, wheelGuard, TypedInput } from "../../../../lib/dom.js";
import { classNames } from "../../../../model/shell/format.js";

/** @typedef {{ value: string | number | undefined, label: string }} SegOption */
/** @typedef {{ W: number, H: number }} Box */

/**
 * Segment buttons, the option matching `value` lit; tapping another reports it.
 *
 * @param {{ options: SegOption[], value: string, aria: string, cls?: string, disabled?: boolean,
 *   dots?: Record<string, boolean>, onPick: (v: string) => void }} props  dots: options carrying a dirty dot
 */
export function Seg({ options, value, aria, cls, disabled, dots = {}, onPick }) {
  return html`
    <div class=${classNames("seg", cls, disabled && "grayed")} role="radiogroup" aria-label=${aria}>
      ${options.map((o) => {
        const v = String(o.value);
        const on = v === value;
        return html`
          <button
            type="button"
            class=${classNames(on && "on", dots[v] && "dirty") || undefined}
            data-v=${v}
            disabled=${!!disabled}
            onClick=${() => (on ? undefined : onPick(v))}
          >
            ${o.label}
          </button>
        `;
      })}
    </div>
  `;
}

/**
 * A number box holding `value`, its unit after it; a change reports the typed number.
 *
 * @param {{ k?: string, value: string, aria: string, unit?: string, min?: number, max?: number, step?: number,
 *   disabled?: boolean, onSet: (v: number) => void }} props  k: the catalog key it edits, as data-k
 */
export function NumBox({ k, value, aria, unit, min, max, step, disabled, onSet }) {
  return html`
    <div class="num">
      <${TypedInput}
        type="number"
        class="vfd"
        data-k=${k}
        aria-label=${aria}
        value=${value}
        min=${min}
        max=${max}
        step=${step}
        disabled=${!!disabled}
        onWheel=${wheelGuard}
        onChange=${(/** @type {{ currentTarget: HTMLInputElement }} */ e) => onSet(Number(e.currentTarget.value))}
      />
      ${unit ? html`<span class="u">${unit}</span>` : null}
    </div>
  `;
}

/**
 * A manual paragraph, led by its setting's label when it has one.
 *
 * @param {{ label?: string, text: string }} props
 */
export const ManPara = ({ label, text }) => html`<p>${label ? html`<b>${label}</b> ` : null}${text}</p>`;

/**
 * Measure an element's box and follow its resizes: `fallback` until it is laid out (and under server rendering).
 *
 * @param {Box} fallback
 * @returns {[{ current: HTMLElement | null }, Box]}
 */
export function useBox(fallback) {
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  const [box, setBox] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const W = el.clientWidth;
      const H = el.clientHeight || fallback.H;
      if (W) setBox((/** @type {Box} */ b) => (b.W === W && b.H === H ? b : { W, H }));
    };
    measure();
    const ro = new globalThis.ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

/**
 * Where a pointer sits in a drawing's own units: its client position scaled from the element's rendered size to the
 * box it is drawn at, so a plate scaled to fit the window still lands on the right value.
 *
 * @param {{ clientX: number, clientY: number, currentTarget: Element }} e
 * @param {Box} box
 * @returns {[number, number]}
 */
export function pointerIn(e, box) {
  const r = e.currentTarget.getBoundingClientRect();
  return [((e.clientX - r.left) * box.W) / (r.width || box.W), ((e.clientY - r.top) * box.H) / (r.height || box.H)];
}
